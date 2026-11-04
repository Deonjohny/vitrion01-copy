"use client";

import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentRef, ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  Box3, BufferGeometry, Group, Line, LoadingManager, Material, Matrix3, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Points, Raycaster, Texture, Vector2, Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Camera } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  MANIFEST_URL, MAX_MANIFEST_BYTES, MAX_MODEL_BYTES, getCameraFitDistance, getVisibleBoneIds, isSelectionClick,
  readBoundedResponse, shouldAutoRotate, validateGlb, validateManifest,
} from "../lib/assets";
import type { AssetManifest, AssetStatus, CameraView, SkeletonViewerProps } from "../lib/types";
import { createFractureTrace, type FractureAnchor } from "../lib/fractureIllustration";
import { FractureOverlay, type IllustrationSettings } from "./FractureOverlay";
import "./fractureIllustration.css";

interface LoadedAsset {
  root: Group;
  manifest: AssetManifest;
  meshes: Map<Mesh, string>;
  boneBounds: Map<string, Box3>;
  bounds: Box3;
  loadedBoneIds: string[];
  dispose: () => void;
}

const IVORY = "#ded9c8";
const RELATED = "#7d8076";
const HOVER = "#eee8d8";
const SELECTED = "#d94243";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function readReducedMotion() {
  return typeof window === "undefined" || !window.matchMedia || window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const reducedMotionServerSnapshot = () => true;

function collectDisposer(gltf: GLTF) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const collect = () => gltf.scenes.forEach((scene) => scene.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof Line || object instanceof Points)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  }));
  collect();
  let disposed = false;
  return {
    collect,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      collect();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      const images = new Set<unknown>();
      textures.forEach((texture) => { images.add(texture.source.data); texture.dispose(); });
      images.forEach((image) => {
        if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
      });
    },
  };
}

export function prepareAsset(gltf: GLTF, manifest: AssetManifest, nodeNames: (string | null)[]): LoadedAsset {
  const resources = collectDisposer(gltf);
  try {
    const requested = new Map(manifest.meshes.map((mapping) => [mapping.nodeName, mapping.boneId]));
    const occurrences = new Map<string, number>();
    for (const name of nodeNames) if (name !== null) occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
    for (const name of requested.keys()) {
      if (occurrences.get(name) !== 1) {
        throw new Error(`Mapped node "${name}" must occur exactly once in the GLB nodes array.`);
      }
    }
    const meshes = new Map<Mesh, string>();
    const resolved = new Set<string>();
    gltf.scene.traverse((object) => {
      // Loader display names may be sanitized; associations preserve the exact original GLB node name.
      const index = gltf.parser.associations.get(object)?.nodes;
      const name = index === undefined ? null : nodeNames[index];
      const boneId = name ? requested.get(name) : undefined;
      if (boneId) {
        if (!(object instanceof Mesh) || (object.geometry.getAttribute("position")?.count ?? 0) < 3 ||
            (object.geometry.index !== null && object.geometry.index.count < 3) ||
            ("isSkinnedMesh" in object && object.isSkinnedMesh)) {
          throw new Error(`Mapped node "${name}" must be a static Mesh with geometry, not a group or skinned mesh.`);
        }
        if (resolved.has(name!)) throw new Error(`Mapped node "${name}" resolves to more than one scene object.`);
        resolved.add(name!);
        meshes.set(object, boneId);
      }
    });
    for (const name of requested.keys()) {
      if (!resolved.has(name)) throw new Error(`Mapped node "${name}" is absent from the GLB default scene.`);
    }
    gltf.scene.traverse((object) => {
      if (object instanceof Line || object instanceof Points) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.visible = false;
        object.raycast = () => undefined;
        return;
      }
      if (!(object instanceof Mesh)) return;
      const originals = Array.isArray(object.material) ? object.material : [object.material];
      const missingNormals = !object.geometry.hasAttribute("normal");
      if (missingNormals) object.geometry.computeVertexNormals();
      // Preserve glTF's flat shading when normals were omitted, including shared geometry instances.
      const flatShading = missingNormals || originals.some((material) => "flatShading" in material && material.flatShading === true);
      // Material visibility hides only this surface, not any mapped descendants of an unmapped mesh.
      const material = new MeshStandardMaterial({ color: IVORY, roughness: 0.62, metalness: 0.04, flatShading,
        visible: meshes.has(object) });
      object.material = material;
      object.raycast = (raycaster, intersections) => {
        if (material.visible) Mesh.prototype.raycast.call(object, raycaster, intersections);
      };
      object.castShadow = false;
      object.receiveShadow = false;
    });
    resources.collect();
    const root = new Group();
    root.add(gltf.scene);
    root.scale.setScalar(manifest.units === "mm" ? 0.001 : manifest.units === "cm" ? 0.01 : 1);
    root.updateMatrixWorld(true);
    const boundsFor = (mesh: Mesh) => {
      mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox) throw new Error("Mapped geometry has no bounds.");
      const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      if (box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite) || box.getSize(new Vector3()).lengthSq() === 0) {
        throw new Error("Mapped geometry has empty, zero-size, or non-finite bounds.");
      }
      return box;
    };
    const originalBounds = new Box3();
    meshes.forEach((_, mesh) => originalBounds.union(boundsFor(mesh)));
    if (originalBounds.getSize(new Vector3()).length() <= 0) throw new Error("Mapped geometry has zero size.");
    root.position.sub(originalBounds.getCenter(new Vector3()));
    root.updateMatrixWorld(true);
    const boneBounds = new Map<string, Box3>();
    const bounds = new Box3();
    meshes.forEach((boneId, mesh) => {
      const box = boundsFor(mesh);
      const boneBox = boneBounds.get(boneId) ?? new Box3();
      boneBox.union(box);
      boneBounds.set(boneId, boneBox);
      bounds.union(box);
    });
    return { root, manifest, meshes, boneBounds, bounds, loadedBoneIds: [...boneBounds.keys()].sort(), dispose: resources.dispose };
  } catch (error) { resources.dispose(); throw error; }
}

const viewDirections: Record<CameraView, [number, number, number]> = {
  anterior: [0, 0, 1], posterior: [0, 0, -1],
  left: [1, 0, 0], right: [-1, 0, 0],
  superior: [0, 1, 0], inferior: [0, -1, 0], oblique: [1, 0.4, 1],
};

export function findPreparedFractureAnchor(
  meshes: Map<Mesh, string>, bounds: Box3, camera: Camera,
  prepared: NonNullable<SkeletonViewerProps["preparedFracture"]>,
): FractureAnchor | null {
  if (bounds.isEmpty() || prepared.positionFraction.length !== 3 ||
      !prepared.positionFraction.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
  camera.updateMatrixWorld(true);
  const point = bounds.min.clone().add(bounds.getSize(new Vector3()).multiply(new Vector3(...prepared.positionFraction)));
  const projected = point.project(camera);
  const corners = [bounds.min, bounds.max].map((corner) => corner.clone().project(camera));
  const span = new Vector2(Math.abs(corners[1].x - corners[0].x), Math.abs(corners[1].y - corners[0].y));
  const candidates = [...meshes].filter(([, id]) => id === prepared.boneId).map(([mesh]) => mesh);
  const offsets: [number, number][] = [[0, 0]];
  // Search only a small neighborhood of the prepared location, never a different bone or arbitrary center.
  for (const distance of [0.04, 0.08, 0.16]) {
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) offsets.push([x * distance, y * distance]);
  }
  const ray = new Raycaster();
  for (const [x, y] of offsets) {
    ray.setFromCamera(new Vector2(projected.x + x * span.x, projected.y + y * span.y), camera);
    const hit = ray.intersectObjects(candidates, false).find((intersection) => intersection.face);
    if (!hit?.face || !(hit.object instanceof Mesh)) continue;
    const normal = hit.face.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    if (normal.dot(ray.ray.direction) > 0) normal.negate();
    const anchor: FractureAnchor = { boneId: prepared.boneId, meshUuid: hit.object.uuid, point: hit.point.toArray(), normal: normal.toArray() };
    if (createFractureTrace(hit.object, anchor, prepared)) return anchor;
  }
  return null;
}

function ModelScene({ asset, visibleIds, selectedBoneId, relatedBoneIds, autoRotate, command, onSelect, canSelect, onFailure, illustration, onPlaceCrack, onCrackMessage, onCrackRendered, preparedFracture, onPreparedMessage }:
  Pick<SkeletonViewerProps, "selectedBoneId" | "relatedBoneIds" | "autoRotate" | "command" | "onSelect"> & {
    asset: LoadedAsset; visibleIds: Set<string>; canSelect: () => boolean; onFailure: (message: string) => void;
    illustration: IllustrationSettings; onPlaceCrack: (anchor: FractureAnchor) => void;
    onCrackMessage: (message: string) => void; onCrackRendered: (visible: boolean) => void;
    preparedFracture?: SkeletonViewerProps["preparedFracture"];
    onPreparedMessage: (message: string) => void;
  }) {
  const { get, size } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const related = useMemo(() => new Set(relatedBoneIds), [relatedBoneIds]);
  const radius = Math.max(asset.bounds.getSize(new Vector3()).length() / 2, 0.00001);
  const visibleKey = [...visibleIds].sort().join("\0");
  const visibleBounds = useMemo(() => {
    const box = new Box3();
    visibleKey.split("\0").forEach((id) => { const boneBox = asset.boneBounds.get(id); if (boneBox) box.union(boneBox); });
    return box.isEmpty() ? asset.bounds : box;
  }, [asset, visibleKey]);
  const focusBounds = selectedBoneId && visibleIds.has(selectedBoneId)
    ? asset.boneBounds.get(selectedBoneId) ?? visibleBounds : visibleBounds;

  useLayoutEffect(() => {
    asset.meshes.forEach((id, mesh) => {
      const material = mesh.material as MeshStandardMaterial;
      material.visible = visibleIds.has(id);
      material.color.set(id === selectedBoneId ? SELECTED : id === hovered ? HOVER : related.has(id) ? RELATED : IVORY);
      material.emissive.set(id === selectedBoneId ? "#380506" : "#000000");
      material.emissiveIntensity = 0.18;
    });
  }, [asset, visibleIds, selectedBoneId, hovered, related]);

  useEffect(() => {
    const { gl } = get();
    gl.domElement.style.cursor = illustration.placing && hovered === selectedBoneId ? "crosshair" : hovered && visibleIds.has(hovered) ? "pointer" : "grab";
    return () => { gl.domElement.style.cursor = ""; };
  }, [get, hovered, visibleIds, illustration.placing, selectedBoneId]);

  useEffect(() => {
    const { gl } = get();
    const lost = (event: Event) => { event.preventDefault(); onFailure("The WebGL context was lost. Retry to rebuild the 3D viewer."); };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => gl.domElement.removeEventListener("webglcontextlost", lost);
  }, [get, onFailure]);

  const fit = useCallback((box: Box3, view?: CameraView) => {
    const { camera } = get();
    const orbit = controls.current;
    if (!(camera instanceof PerspectiveCamera) || !orbit) return;
    const center = box.getCenter(new Vector3());
    const boxRadius = Math.max(box.getSize(new Vector3()).length() / 2, radius * 0.005);
    const distance = getCameraFitDistance(boxRadius, camera.fov, size.width, size.height);
    const direction = view ? new Vector3(...viewDirections[view]) : camera.position.clone().sub(orbit.target);
    if (!direction.lengthSq()) direction.set(0, 0, 1);
    if (view) camera.up.set(0, view === "superior" || view === "inferior" ? 0 : 1,
      view === "superior" ? -1 : view === "inferior" ? 1 : 0);
    camera.near = Math.max(radius / 10000, 0.0000001);
    camera.far = Math.max(radius * 200, distance * 20);
    camera.position.copy(center).addScaledVector(direction.normalize(), distance);
    camera.updateProjectionMatrix();
    orbit.target.copy(center);
    orbit.update();
  }, [get, radius, size.width, size.height]);

  // Selection changes highlight only: auto-focusing here crops other bones in All mode.
  // Narrow framing belongs to the explicit Focus command or an active visibility filter.
  useEffect(() => { fit(visibleBounds); }, [fit, visibleBounds]);
  const lastCommand = useRef<number | null>(null);
  useEffect(() => {
    if (!command || command.id === lastCommand.current || !controls.current) return;
    const { camera } = get();
    lastCommand.current = command.id;
    if (command.type === "reset") fit(asset.bounds, "anterior");
    else if (command.type === "focus") fit(focusBounds);
    else if (command.type === "view") fit(visibleBounds, command.view ?? "anterior");
    else {
      const offset = camera.position.clone().sub(controls.current.target);
      const factor = command.type === "zoomIn" ? 0.78 : 1 / 0.78;
      const distance = Math.min(radius * 100, Math.max(radius * 0.015, offset.length() * factor));
      camera.position.copy(controls.current.target).add(offset.setLength(distance));
      controls.current.update();
    }
  }, [command, asset, get, fit, focusBounds, visibleBounds, radius]);

  const lastPlacement = useRef(0);
  useEffect(() => {
    if (!illustration.centerRequest || illustration.centerRequest === lastPlacement.current || !selectedBoneId) return;
    lastPlacement.current = illustration.centerRequest;
    const bounds = asset.boneBounds.get(selectedBoneId);
    if (!bounds || !visibleIds.has(selectedBoneId)) return;
    const camera = get().camera;
    const projected = bounds.getCenter(new Vector3()).project(camera);
    const ray = new Raycaster(); ray.setFromCamera(new Vector2(projected.x, projected.y), camera);
    const candidates = [...asset.meshes].filter(([, id]) => id === selectedBoneId).map(([mesh]) => mesh);
    const hit = ray.intersectObjects(candidates, false).find((intersection) => intersection.face);
    if (!hit?.face || !(hit.object instanceof Mesh)) {
      onCrackMessage("No selected-bone surface at the visible center. Isolate the bone, rotate, then click its surface."); return;
    }
    const normal = hit.face.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    if (normal.dot(ray.ray.direction) > 0) normal.negate();
    onPlaceCrack({ boneId: selectedBoneId, meshUuid: hit.object.uuid, point: hit.point.toArray(), normal: normal.toArray() });
  }, [illustration.centerRequest, selectedBoneId, asset, get, visibleIds, onPlaceCrack, onCrackMessage]);

  const [preparedAnchor, setPreparedAnchor] = useState<FractureAnchor | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const bounds = preparedFracture && asset.boneBounds.get(preparedFracture.boneId);
      const anchor = preparedFracture && bounds && visibleIds.has(preparedFracture.boneId)
        ? findPreparedFractureAnchor(asset.meshes, bounds, get().camera, preparedFracture) : null;
      setPreparedAnchor(anchor);
      onPreparedMessage(anchor ? "PREPARED approximate surface illustration. Not image-derived geometry."
        : "PREPARED illustration unavailable: no safe visible mapped-bone surface near the supplied approximate location. No substitute marker is shown.");
    });
    return () => { cancelled = true; };
  }, [asset, preparedFracture, visibleIds, get, fit, onPreparedMessage]);
  const onPreparedRendered = useCallback((visible: boolean) => {
    onPreparedMessage(visible ? "PREPARED approximate surface illustration. Not image-derived geometry."
      : "PREPARED crack could not be rendered safely on this surface. No substitute marker is shown.");
  }, [onPreparedMessage]);
  const preparedMesh = preparedAnchor && preparedFracture && preparedAnchor.boneId === preparedFracture.boneId
    && visibleIds.has(preparedAnchor.boneId)
    ? [...asset.meshes.keys()].find((mesh) => mesh.uuid === preparedAnchor.meshUuid) : undefined;

  const boneAt = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const id = asset.meshes.get(event.object as Mesh);
    return id && visibleIds.has(id) ? id : null;
  };
  const crackMesh = illustration.anchor && illustration.anchor.boneId === selectedBoneId && visibleIds.has(selectedBoneId)
    ? [...asset.meshes.keys()].find((mesh) => mesh.uuid === illustration.anchor?.meshUuid) : undefined;
  return <>
    <ambientLight intensity={0.65} />
    <hemisphereLight args={["#faf3de", "#3d4549", 1.5]} />
    <directionalLight position={[4, 6, 5]} intensity={2.2} />
    <directionalLight position={[-4, 1, -3]} intensity={1.1} color="#c3d5e0" />
    <primitive object={asset.root} dispose={null}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        const id = boneAt(event);
        if (id) { event.stopPropagation(); setHovered(id); }
      }}
      onPointerOut={() => setHovered(null)}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        const id = boneAt(event);
        if (!id || !isSelectionClick(event.delta, !canSelect())) return;
        event.stopPropagation();
        if (!illustration.placing) { onSelect(id); return; }
        if (id !== selectedBoneId) { onCrackMessage("Click the selected bone only, or cancel placement to choose another bone."); return; }
        if (!event.face || !(event.object instanceof Mesh)) return;
        const normal = event.face.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(event.object.matrixWorld)).normalize();
        if (normal.dot(event.ray.direction) > 0) normal.negate();
        onPlaceCrack({ boneId: id, meshUuid: event.object.uuid, point: event.point.toArray(), normal: normal.toArray() });
      }} />
    {preparedMesh && preparedAnchor && preparedFracture && <FractureOverlay mesh={preparedMesh} anchor={preparedAnchor}
      size={preparedFracture.size} angleDegrees={preparedFracture.angleDegrees} onRendered={onPreparedRendered} />}
    {!preparedFracture && crackMesh && illustration.anchor && <FractureOverlay mesh={crackMesh} anchor={illustration.anchor}
      size={illustration.size} angleDegrees={illustration.angleDegrees} onRendered={onCrackRendered} />}
    <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.1}
      autoRotate={autoRotate && !illustration.placing} autoRotateSpeed={0.65} minDistance={radius * 0.015} maxDistance={radius * 100}
      minPolarAngle={0} maxPolarAngle={Math.PI} enablePan enableZoom enableRotate />
  </>;
}

class ViewerBoundary extends Component<{ children: ReactNode; onFailure: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onFailure(`3D rendering failed: ${error.message}`); }
  render() { return this.state.failed ? null : this.props.children; }
}

function EmptyViewer({ status, catalogCount }: { status: AssetStatus; catalogCount: number }) {
  const title = status.state === "missing" ? "Anatomy, awaiting its model" : status.state === "loading" ? "Preparing the anatomy" : "3D viewer unavailable";
  return <div className={`viewer-empty viewer-empty-${status.state}`} role="status" aria-live="polite">
    <span className="viewer-empty-eyebrow">VITRION_01 · ANATOMY ASSET</span>
    <div className="viewer-empty-mark" aria-hidden="true">01</div>
    <h2 className="viewer-empty-title">{title}</h2>
    <p className="viewer-empty-description">{status.message}</p>
    <p className="viewer-empty-note">The bone catalog remains available. No substitute skeleton is displayed.</p>
    <p className="viewer-empty-coverage">0 visible · 0 loaded · {catalogCount} catalog bones</p>
  </div>;
}

function emptyIllustration(key: string) {
  return { key, settings: { placing: false, anchor: null, size: 0.5, angleDegrees: 0, centerRequest: 0 } as IllustrationSettings, rendered: false, message: "" };
}

export default function SkeletonViewer({ bones, selectedBoneId, relatedBoneIds, displayMode, autoRotate, command, assetRevision, onSelect, onStatus, preparedBoneIds, preparedFracture }: SkeletonViewerProps) {
  const preparedMode = preparedBoneIds !== undefined;
  const [preparedMessage, setPreparedMessage] = useState("");
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, reducedMotionServerSnapshot);
  const [asset, setAsset] = useState<LoadedAsset | null>(null);
  const [status, setStatus] = useState<AssetStatus>({ state: "loading", message: "Checking for a licensed local anatomy asset…", loadedBoneIds: [] });
  const selectionKey = `${assetRevision}:${asset?.root.uuid ?? ""}:${selectedBoneId ?? ""}`;
  const [illustrationState, setIllustrationState] = useState(() => emptyIllustration(selectionKey));
  if (illustrationState.key !== selectionKey) setIllustrationState(emptyIllustration(selectionKey));
  const illustration = illustrationState.key === selectionKey ? illustrationState.settings : emptyIllustration(selectionKey).settings;
  const placementSequence = useRef(0);
  const onPlaceCrack = useCallback((anchor: FractureAnchor) => {
    setIllustrationState((current) => current.key !== selectionKey || anchor.boneId !== selectedBoneId ? current : {
      ...current, settings: { ...current.settings, anchor, placing: false }, rendered: false,
      message: "Manually placed approximate crack. Shape and location are illustrative, not image-derived.",
    });
  }, [selectionKey, selectedBoneId]);
  const onCrackMessage = useCallback((message: string) => {
    setIllustrationState((current) => current.key === selectionKey ? { ...current, message } : current);
  }, [selectionKey]);
  const onCrackRendered = useCallback((rendered: boolean) => {
    const message = rendered ? "Manually placed approximate crack. Shape and location are illustrative, not image-derived."
      : "A surface trace could not be placed here. Try a flatter visible area or a smaller illustration size.";
    setIllustrationState((current) => current.key !== selectionKey || (current.rendered === rendered && current.message === message) ? current : { ...current, rendered, message });
  }, [selectionKey]);
  function changeIllustration(patch: Partial<IllustrationSettings>, message?: string) {
    setIllustrationState((current) => ({ ...current, settings: { ...current.settings, ...patch }, ...(message === undefined ? {} : { message }) }));
  }
  const onStatusRef = useRef(onStatus);
  const catalogRef = useRef(bones);
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);
  useEffect(() => { catalogRef.current = bones; }, [bones]);
  const reportedStatus = useRef<AssetStatus | null>(null);
  const publish = useCallback((next: AssetStatus) => {
    const current = reportedStatus.current;
    if (current?.state === next.state && current.message === next.message &&
        current.loadedBoneIds.join("\0") === next.loadedBoneIds.join("\0")) return;
    reportedStatus.current = next;
    setStatus(next);
    // Report in transition order, never from a delayed ready effect after a child renderer error.
    onStatusRef.current(next);
  }, []);
  const onFailure = useCallback((message: string) => {
    publish({ state: "error", message, loadedBoneIds: [] });
  }, [publish]);
  const catalogKey = bones.map((bone) => bone.id).sort().join("\0");
  useEffect(() => { if (status.state === "error") asset?.dispose(); }, [asset, status.state]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let loaded: LoadedAsset | null = null;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      if (!cancelled) onFailure("Anatomy asset loading timed out. Retry with a smaller local GLB.");
    }, 45000);
    const fetchLocal = (url: string) => fetch(url, { signal: controller.signal, mode: "same-origin", redirect: "error", cache: "no-store", credentials: "same-origin" });
    const load = async () => {
      const response = await fetchLocal(MANIFEST_URL);
      if (response.status === 404 || response.status === 410) {
        if (!cancelled) publish({ state: "missing", message: "No local anatomy manifest is installed. Add a licensed, mapped GLB and /anatomy/manifest.json to enable 3D.", loadedBoneIds: [] });
        return;
      }
      if (!response.ok) throw new Error(`Anatomy manifest request failed (HTTP ${response.status}).`);
      const manifestBytes = await readBoundedResponse(response, MAX_MANIFEST_BYTES);
      let json: unknown;
      try { json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)); }
      catch { throw new Error("Anatomy manifest is not valid UTF-8 JSON."); }
      const manifest = validateManifest(json, catalogRef.current);
      if (cancelled) return;
      publish({ state: "loading", message: `Loading ${manifest.name}…`, loadedBoneIds: [] });
      const modelResponse = await fetchLocal(manifest.modelUrl);
      if (modelResponse.status === 404 || modelResponse.status === 410) {
        if (!cancelled) publish({ state: "missing", message: "The manifest is installed, but its local GLB is missing. Supply the licensed model at its declared path.", loadedBoneIds: [] });
        return;
      }
      if (!modelResponse.ok) throw new Error(`Anatomy GLB request failed (HTTP ${modelResponse.status}).`);
      const bytes = await readBoundedResponse(modelResponse, MAX_MODEL_BYTES);
      const metadata = validateGlb(bytes);
      if (cancelled) return;
      const manager = new LoadingManager();
      manager.setURLModifier((url) => {
        // The preflight rejects every URI. Only browser-local URLs made for embedded raster images remain.
        if (!url.startsWith("blob:")) throw new Error("External GLB resources are blocked.");
        return url;
      });
      const gltf = await new GLTFLoader(manager).parseAsync(bytes, "");
      if (cancelled || timedOut) {
        collectDisposer(gltf).dispose();
        if (timedOut && !cancelled) throw new Error("Anatomy asset loading timed out. Retry with a smaller local GLB.");
        return;
      }
      loaded = prepareAsset(gltf, manifest, metadata.nodeNames);
      setAsset(loaded);
      publish({ state: "loading", message: "Local mesh data loaded. Initializing the WebGL viewer…", loadedBoneIds: [] });
    };
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setAsset(null);
      publish({ state: "loading", message: "Checking for a licensed local anatomy asset…", loadedBoneIds: [] });
      return load();
    }).catch((error: unknown) => {
      if (!cancelled) onFailure(timedOut ? "Anatomy asset loading timed out. Retry with a smaller local GLB."
        : error instanceof Error ? error.message : "Unable to load the local anatomy asset.");
    }).finally(() => clearTimeout(timeout));
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); loaded?.dispose(); };
  }, [assetRevision, catalogKey, publish, onFailure]);

  const visibleIds = useMemo(() => preparedBoneIds !== undefined
    ? new Set((asset?.loadedBoneIds ?? []).filter((id) => preparedBoneIds.includes(id)))
    : getVisibleBoneIds(asset?.loadedBoneIds ?? [], bones, selectedBoneId, displayMode, relatedBoneIds),
    [asset, bones, displayMode, selectedBoneId, relatedBoneIds, preparedBoneIds]);
  const unavailableSelection = displayMode === "isolate" && selectedBoneId && !visibleIds.has(selectedBoneId)
    ? bones.find((bone) => bone.id === selectedBoneId) : undefined;
  const gesture = useRef({ x: 0, y: 0, dragged: false, pointers: new Set<number>() });
  const canSelect = useCallback(() => !gesture.current.dragged, []);
  const ready = status.state === "ready" && asset !== null;
  const rendererReady = useCallback(() => {
    if (!asset || reportedStatus.current?.state === "error") return;
    publish({ state: "ready", message: `${asset.loadedBoneIds.length} unique bones loaded from mapped mesh nodes.`, loadedBoneIds: asset.loadedBoneIds });
  }, [asset, publish]);
  return <section className="skeleton-viewer" aria-label="Interactive 3D bone viewer" style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, minWidth: 0, overflow: "hidden" }}
    onPointerDownCapture={(event) => {
      const current = gesture.current;
      if (current.pointers.size === 0) { current.x = event.clientX; current.y = event.clientY; current.dragged = event.button !== 0; }
      current.pointers.add(event.pointerId);
      if (current.pointers.size > 1) current.dragged = true;
    }}
    onPointerMoveCapture={(event) => {
      const current = gesture.current;
      if (current.pointers.size && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 5) current.dragged = true;
    }}
    onPointerUpCapture={(event) => { gesture.current.pointers.delete(event.pointerId); }}
    onPointerCancelCapture={(event) => { gesture.current.dragged = true; gesture.current.pointers.delete(event.pointerId); }}>
    {asset && status.state !== "error" ? <>
      <ViewerBoundary key={`${assetRevision}-${catalogKey}`} onFailure={onFailure}>
        <Canvas camera={{ position: [0, 0, 3], fov: 36 }} dpr={[1, 1.75]} onCreated={rendererReady}
          gl={{ antialias: true, alpha: true }} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
          fallback={<span>WebGL is unavailable. Enable hardware acceleration or use a WebGL-capable browser.</span>}>
          <ModelScene asset={asset} visibleIds={visibleIds} selectedBoneId={selectedBoneId}
            relatedBoneIds={relatedBoneIds} autoRotate={shouldAutoRotate(autoRotate, reducedMotion, visibleIds.size)} command={command}
            onSelect={onSelect} canSelect={canSelect} onFailure={onFailure}
            illustration={illustration} onPlaceCrack={onPlaceCrack} onCrackMessage={onCrackMessage} onCrackRendered={onCrackRendered}
            preparedFracture={preparedFracture} onPreparedMessage={setPreparedMessage} />
        </Canvas>
      </ViewerBoundary>
      {!ready && <EmptyViewer status={status} catalogCount={bones.length} />}
      {ready && <><div className="viewer-coverage" role="status" aria-live="polite" style={{ position: "absolute", left: 20, top: 20, right: 20, pointerEvents: "none" }}>
        <span>{visibleIds.size} visible · {asset.loadedBoneIds.length} loaded · {bones.length} catalog bones</span>
        {visibleIds.size === 0 && <p>{unavailableSelection
          ? `No mesh is loaded for ${unavailableSelection.name}. Choose All or another bone to view this partial asset.`
          : "No loaded mesh matches this display mode or selection."}</p>}
      </div>
      {illustration.anchor && illustrationState.rendered && selectedBoneId && visibleIds.has(selectedBoneId) && <div className="fracture-illustration-label">ILLUSTRATIVE CRACK · MANUALLY PLACED · NOT A DIAGNOSIS</div>}
      {preparedMode ? <div className="fracture-tools" role="status" aria-live="polite">
        <strong>PREPARED · approximate illustration</strong>
        <p>{preparedFracture ? preparedMessage || "Preparing a surface-safe illustrative crack…" : "No fracture marker: an exact bone within this group was not supplied."}</p>
        <small>Not AI reconstruction, live AI prediction, an exact fracture gap, or a clinically validated finding.</small>
      </div> : <details className="fracture-tools">
        <summary>Approximate crack · illustration</summary>
        <p>Choose a bone, then mark its visible surface. This does not detect a fracture or reconstruct an uploaded image/report.</p>
        <div className="fracture-tool-actions">
          <button type="button" disabled={!selectedBoneId || !visibleIds.has(selectedBoneId)} aria-pressed={illustration.placing}
            onClick={() => changeIllustration({ placing: !illustration.placing }, illustration.placing ? "Placement cancelled." : "Click the selected bone where the illustrative crack should appear. Drag still rotates the model.")}>
            {illustration.placing ? "Cancel placement" : "Click to place crack"}
          </button>
          <button type="button" disabled={!selectedBoneId || !visibleIds.has(selectedBoneId)} onClick={() => changeIllustration({ centerRequest: ++placementSequence.current, placing: false }, "Placing an illustrative crack at the visible bone center…")}>Use visible center</button>
          <button type="button" disabled={!illustration.anchor && !illustration.placing} onClick={() => setIllustrationState(emptyIllustration(selectionKey))}>Clear crack</button>
        </div>
        {illustration.anchor && <div className="fracture-adjustments">
          <label>Illustration size<input aria-label="Illustrative crack size" type="range" min="0.1" max="0.6" step="0.025" value={illustration.size} onChange={(event) => changeIllustration({ size: Number(event.target.value) })} /></label>
          <label>Trace angle<input aria-label="Illustrative crack angle" type="range" min="0" max="180" step="5" value={illustration.angleDegrees} onChange={(event) => changeIllustration({ angleDegrees: Number(event.target.value) })} /></label>
        </div>}
        <p role="status" aria-live="polite">{selectedBoneId ? illustrationState.message || "Tip: isolate and focus the selected bone first. Changing bones clears the illustration." : "Select a bone from the catalog to enable placement."}</p>
        <small>Temporary reference-surface annotation only. Not saved as a clinical finding or exported as a measurement.</small>
      </details>}
      <details className="viewer-attribution" style={{ position: "absolute", right: 20, top: 78, maxWidth: "min(420px, 70%)", padding: "8px 10px", background: "#0c0c0eee", border: "1px solid #36363b", borderRadius: 4, fontSize: 10, lineHeight: 1.6 }}>
        <summary style={{ cursor: "pointer" }}>Model attribution &amp; license</summary>
        <div style={{ maxHeight: 130, overflowY: "auto", paddingTop: 8 }}>
          <span>{asset.manifest.attribution} · {asset.manifest.license}</span>{" "}
          <a href={asset.manifest.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>Asset source</a>
        </div>
      </details></>}
    </> : <EmptyViewer status={status} catalogCount={bones.length} />}
  </section>;
}
