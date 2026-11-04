import { readFileSync } from "node:fs";
import { createElement } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from "three";
import { PreparedIllustration } from "../src/components/PreparedIllustration";
import { findPreparedFractureAnchor, prepareAsset } from "../src/components/SkeletonViewer";
import { validateGlb, validateManifest, getCameraFitDistance } from "../src/lib/assets";
import { bones } from "../src/data/anatomy";
import { createFractureTrace } from "../src/lib/fractureIllustration";
import type { PreparedImageMatch } from "../src/lib/preparedIllustrations";

const match: PreparedImageMatch = {
  matched: true, method: "prepared-image-illustration", label: "Prepared illustration",
  clinicallyValidated: false, sourceSha256: "a".repeat(64), title: "Approximate clavicle illustration",
  boneIds: ["CLAVICLE_RIGHT"], targetBoneId: "CLAVICLE_RIGHT",
  fracture: { positionFraction: [0.5, 0.5, 0.5], size: 0.4, angleDegrees: 25 },
  limitations: ["Approximate location only; not a diagnosis."],
};
const prepared = { boneId: "CLAVICLE_RIGHT", ...match.fracture };
function fixture() {
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(mesh);
  const camera = new PerspectiveCamera(36, 1, 0.01, 100);
  camera.position.set(0, 0, 7);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return { mesh, bounds, camera, meshes: new Map([[mesh, prepared.boneId]]) };
}

describe("prepared approximate illustrations", () => {
  it("labels the existing viewer and shows limitations without clinical or AI claims", () => {
    const html = renderToStaticMarkup(createElement(PreparedIllustration, { illustration: match }));
    expect(html).toContain("Prepared illustration");
    expect(html).toContain(match.title);
    expect(html).toContain(match.limitations[0]);
    expect(html).toContain("not live AI prediction");
    expect(html).toContain("height:460px");
    expect(html).not.toContain("Click to place crack");
    expect(html).toContain("206 catalog bones");
  });

  it("keeps an unspecified rib group free of an invented exact rib marker", () => {
    const html = renderToStaticMarkup(createElement(PreparedIllustration, { illustration: {
      ...match, title: "Right rib group", targetBoneId: null,
      boneIds: Array.from({ length: 12 }, (_, i) => `RIB_${i + 1}_RIGHT`),
    } }));
    expect(html).toContain("No exact rib number is known");
    expect(html).toContain("All 12 right ribs");
    expect(html).toContain("no fracture marker is invented");
  });

  it("anchors automatically to a real front-facing mapped surface without changing geometry", () => {
    const { mesh, bounds, camera, meshes } = fixture();
    const before = Array.from(mesh.geometry.getAttribute("position").array);
    const anchor = findPreparedFractureAnchor(meshes, bounds, camera, prepared);
    expect(anchor).not.toBeNull();
    expect(anchor?.meshUuid).toBe(mesh.uuid);
    expect(anchor?.point[2]).toBeCloseTo(1);
    expect(anchor?.normal[2]).toBeCloseTo(1);
    expect(createFractureTrace(mesh, anchor!, prepared)?.points.length).toBeGreaterThan(2);
    expect(Array.from(mesh.geometry.getAttribute("position").array)).toEqual(before);
    mesh.geometry.dispose();
  });

  it("uses the supplied normalized location, not the bone center", () => {
    const { mesh, bounds, camera, meshes } = fixture();
    const anchor = findPreparedFractureAnchor(meshes, bounds, camera, {
      ...prepared, positionFraction: [0.65, 0.6, 1],
    });
    expect(anchor).not.toBeNull();
    expect(new Vector3(...anchor!.point).distanceTo(new Vector3(0.3, 0.2, 1))).toBeLessThan(1e-6);
    mesh.geometry.dispose();
  });

  it("renders real surface traces for every specifically mapped prepared bone in the installed asset", async () => {
    const bytes = readFileSync("public/anatomy/skeleton.glb");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const manifest = validateManifest(JSON.parse(readFileSync("public/anatomy/manifest.json", "utf8")), bones);
    const metadata = validateGlb(buffer);
    const gltf = await new GLTFLoader().parseAsync(buffer, "");
    const asset = prepareAsset(gltf, manifest, metadata.nodeNames);
    try {
      const entries = JSON.parse(readFileSync("server/app/data/prepared-illustrations.json", "utf8")) as PreparedImageMatch[];
      for (const entry of entries) {
        const boneId = entry.targetBoneId === null ? null : entry.targetBoneId ?? entry.boneIds[0];
        if (!boneId) continue;
        const bounds = asset.boneBounds.get(boneId)!;
        expect(bounds, boneId).toBeDefined();
        const visibleBounds = new Box3();
        entry.boneIds.forEach((id) => visibleBounds.union(asset.boneBounds.get(id)!));
        const camera = new PerspectiveCamera(36, 1.4, 0.000001, 100);
        const center = visibleBounds.getCenter(new Vector3());
        const distance = getCameraFitDistance(visibleBounds.getSize(new Vector3()).length() / 2, 36, 644, 460);
        camera.position.copy(center).add(new Vector3(0, 0, distance));
        camera.lookAt(center);
        camera.updateMatrixWorld(true);
        const anchor = findPreparedFractureAnchor(asset.meshes, bounds, camera, { boneId, ...entry.fracture });
        expect(anchor, `${entry.title}: ${boneId}`).not.toBeNull();
      }
    } finally { asset.dispose(); }
  }, 30000);

  it("never substitutes a different bone or fabricates an off-surface marker", () => {
    const { mesh, bounds, camera, meshes } = fixture();
    expect(findPreparedFractureAnchor(meshes, bounds, camera, { ...prepared, boneId: "UNKNOWN" })).toBeNull();
    expect(findPreparedFractureAnchor(meshes, bounds, camera, { ...prepared, positionFraction: [2, 0, 0] })).toBeNull();
    expect(findPreparedFractureAnchor(meshes, bounds, camera, { ...prepared, size: 10 })).toBeNull();
    mesh.geometry.dispose();
  });
});
