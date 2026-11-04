import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Box3, LoadingManager, Mesh, Vector3 } from "three";
import { bones } from "../src/data/anatomy";
import { boneRegistry, boneRegistryById } from "../src/manifests/boneRegistry";
import { validateGlb, validateManifest, MAX_MODEL_BYTES } from "../src/lib/assets";
import { prepareAsset } from "../src/components/SkeletonViewer";
import manifestJson from "../public/anatomy/manifest.json";
import report from "../public/anatomy/bone-spatial.json";
import sourceMap from "../tools/anatomy/source-map.json";

const bytes = readFileSync(new URL("../public/anatomy/skeleton.glb", import.meta.url));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe("real Z-Anatomy skeleton asset and registry", () => {
  it("uses every permanent catalog identity without fabricating medical metadata", () => {
    expect(boneRegistry).toHaveLength(bones.length);
    expect(bones).toHaveLength(206);
    expect(boneRegistry.map((entry) => entry.boneId)).toEqual(bones.map((bone) => bone.id));
    expect(boneRegistryById.size).toBe(bones.length);
    for (const entry of boneRegistry) {
      expect(entry.catalog).toBe(bones.find((bone) => bone.id === entry.boneId));
      expect(entry.ontology).toEqual({ fma: null, ta2: null, radlex: null });
      expect(entry.dimensions).toBeNull();
      expect(entry.clinicalVerification).toBe(false);
      expect(entry.mappingStatus).toBe("source-name-mapped");
      expect(entry.nodeNames.length).toBeGreaterThan(0);
      expect(entry.centroid).not.toBeNull();
    }
  });

  it("passes the unmodified viewer preflight and matches recorded provenance", () => {
    const manifest = validateManifest(manifestJson, bones);
    const { nodeNames } = validateGlb(buffer);
    expect(bytes.length).toBeLessThan(MAX_MODEL_BYTES);
    expect(bytes.length).toBe(report.modelBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(report.modelSha256);
    expect(manifest.meshes).toEqual(sourceMap);
    expect(manifest.meshes).toHaveLength(208);
    expect(new Set(manifest.meshes.map((mesh) => mesh.boneId)).size).toBe(206);
    expect(nodeNames).toHaveLength(208);
    for (const { nodeName } of manifest.meshes) expect(nodeNames.filter((name) => name === nodeName)).toHaveLength(1);
    expect(boneRegistryById.get("STERNUM")?.nodeNames).toHaveLength(3);
    const jsonLength = new DataView(buffer).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
    for (const key of ["images", "textures", "skins", "animations", "extensionsUsed", "extensionsRequired"]) {
      expect(json[key]).toBeUndefined();
    }
    expect(json.meshes.every((mesh: { primitives: unknown[] }) => mesh.primitives.length === 1)).toBe(true);
  });

  it("loads actual triangles with no resource requests and matches world-space bounds", async () => {
    const requested: string[] = [];
    const manager = new LoadingManager();
    manager.setURLModifier((url) => { requested.push(url); throw new Error("External resource requested"); });
    const gltf = await new GLTFLoader(manager).parseAsync(buffer, "");
    const manifest = validateManifest(manifestJson, bones);
    const { nodeNames } = validateGlb(buffer);
    const asset = prepareAsset(gltf, manifest, nodeNames);
    // prepareAsset recenters for presentation; restore file coordinates before measurement.
    asset.root.position.set(0, 0, 0);
    asset.root.updateMatrixWorld(true);
    try {
      expect(requested).toEqual([]);
      expect(asset.loadedBoneIds).toHaveLength(206);
      expect(asset.meshes.size).toBe(208);
      const calculated = new Map<string, Box3>();
      gltf.scene.updateMatrixWorld(true);
      for (const [mesh, boneId] of asset.meshes) {
        expect(mesh).toBeInstanceOf(Mesh);
        const positions = mesh.geometry.getAttribute("position");
        expect(positions.count).toBeGreaterThan(3);
        for (let i = 0; i < positions.count; i++) {
          expect(Number.isFinite(positions.getX(i)) && Number.isFinite(positions.getY(i)) && Number.isFinite(positions.getZ(i))).toBe(true);
        }
        const box = new Box3().setFromObject(mesh);
        calculated.set(boneId, calculated.has(boneId) ? calculated.get(boneId)!.union(box) : box);
      }
      for (const entry of boneRegistry) {
        const box = calculated.get(entry.boneId)!;
        const center = box.getCenter(new Vector3()).toArray();
        center.forEach((value, i) => expect(value).toBeCloseTo(entry.centroid![i], 5));
        box.min.toArray().forEach((value, i) => expect(value).toBeCloseTo(entry.modelBounds!.min[i], 5));
        box.max.toArray().forEach((value, i) => expect(value).toBeCloseTo(entry.modelBounds!.max[i], 5));
      }
      // Source .l is positive X; patella/sternum are anterior (+Z), head above feet (+Y).
      expect(boneRegistryById.get("FEMUR_LEFT")!.centroid![0]).toBeGreaterThan(0);
      expect(boneRegistryById.get("FEMUR_RIGHT")!.centroid![0]).toBeLessThan(0);
      expect(boneRegistryById.get("FRONTAL")!.centroid![1]).toBeGreaterThan(boneRegistryById.get("TALUS_LEFT")!.centroid![1]);
      expect(boneRegistryById.get("STERNUM")!.centroid![2]).toBeGreaterThan(boneRegistryById.get("T6")!.centroid![2]);
    } finally { asset.dispose(); }
  }, 30000);
});
