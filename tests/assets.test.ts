import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { LoadingManager, Mesh, MeshStandardMaterial, PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import { bones } from "../src/data/anatomy";
import { MAX_MODEL_BYTES, getCameraFitDistance, getVisibleBoneIds, isSelectionClick, readBoundedResponse, shouldAutoRotate, validateGlb, validateManifest } from "../src/lib/assets";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SkeletonViewer, { prepareAsset } from "../src/components/SkeletonViewer";

const manifest = () => ({
  schemaVersion: 1,
  name: "Partial test asset",
  license: "CC0-1.0 (test fixture only)",
  sourceUrl: "https://example.org/provenance",
  attribution: "Synthetic validation fixture, not anatomical geometry",
  modelUrl: "/anatomy/test.glb",
  units: "m",
  orientation: "Y_UP_ANTERIOR_POSITIVE_Z",
  meshes: [{ boneId: "FRONTAL", nodeName: "frontal_surface" }],
});

function glb(json: unknown, binary?: Uint8Array): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const binLength = binary ? Math.ceil(binary.length / 4) * 4 : 0;
  const bytes = new ArrayBuffer(20 + jsonLength + (binary ? 8 + binLength : 0));
  const view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(bytes, 20, jsonLength).fill(0x20);
  new Uint8Array(bytes, 20, encoded.length).set(encoded);
  if (binary) {
    view.setUint32(20 + jsonLength, binLength, true);
    view.setUint32(24 + jsonLength, 0x004e4942, true);
    new Uint8Array(bytes, 28 + jsonLength, binary.length).set(binary);
  }
  return bytes;
}

const minimalGlb = () => ({ asset: { version: "2.0" } });

function triangleGlb() {
  const binary = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  return glb({
    asset: { version: "2.0" }, scene: 0,
    scenes: [{ nodes: [0] }], nodes: [{ name: "Exact node.name", mesh: 0 }],
    buffers: [{ byteLength: binary.length }], bufferViews: [{ buffer: 0, byteLength: binary.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  }, binary);
}

describe("anatomy asset manifest validation", () => {
  it("accepts an explicitly partial, minimal mapping without claiming 206 meshes", () => {
    const result = validateManifest(manifest(), bones);
    expect(result.meshes).toEqual([{ boneId: "FRONTAL", nodeName: "frontal_surface" }]);
    expect(result.schemaVersion).toBe(1);
  });

  it("allows separate mesh nodes for one bone; coverage is by unique bone ID", () => {
    const value = manifest();
    value.meshes.push({ boneId: "FRONTAL", nodeName: "frontal_second_surface" });
    const result = validateManifest(value, bones);
    expect(result.meshes).toHaveLength(2);
    expect(new Set(result.meshes.map((mapping) => mapping.boneId)).size).toBe(1);
  });

  it.each(["FRONTAL", "MANDIBLE"])("rejects a mesh node mapped twice (second bone %s)", (boneId) => {
    const value = manifest();
    value.meshes.push({ boneId, nodeName: "frontal_surface" });
    expect(() => validateManifest(value, bones)).toThrow(/Duplicate nodeName/);
  });

  it("rejects nonexistent catalog IDs", () => {
    const value = manifest();
    value.meshes[0].boneId = "NOT_A_BONE";
    expect(() => validateManifest(value, bones)).toThrow(/Unknown boneId.*NOT_A_BONE/);
  });

  it.each([null, [], true, "manifest", 12])("rejects non-object JSON: %j", (value) => {
    expect(() => validateManifest(value, bones)).toThrow(/object/);
  });

  it.each(["license", "sourceUrl", "attribution", "name"])("requires nonempty %s", (field) => {
    expect(() => validateManifest({ ...manifest(), [field]: "" }, bones)).toThrow(field);
    const value: Record<string, unknown> = manifest();
    delete value[field];
    expect(() => validateManifest(value, bones)).toThrow(field);
  });

  it.each(["https://evil.example/model.glb", "http://localhost/model.glb", "//evil.example/model.glb", "data:model/gltf-binary;base64,abc", "blob:https://example.org/id", "models/test.glb", "/anatomy/test.gltf", "/anatomy/../test.glb", "/anatomy/%2e%2e/test.glb", "/anatomy/test.glb?url=remote", "/anatomy/test.glb#node", "/\\evil.example/test.glb", "/anatomy//test.glb", "/anatomy/%5cevil.glb"])("rejects unsafe/non-GLB model path %s", (modelUrl) => {
    expect(() => validateManifest({ ...manifest(), modelUrl }, bones)).toThrow(/modelUrl/);
  });

  it.each(["javascript:alert(1)", "file:///model.glb", "/provenance", "https://user:password@example.org/model"])("rejects unsafe provenance URL %s", (sourceUrl) => {
    expect(() => validateManifest({ ...manifest(), sourceUrl }, bones)).toThrow(/sourceUrl/);
  });

  it.each(["m", "cm", "mm"])("accepts declared %s units", (units) => {
    expect(validateManifest({ ...manifest(), units }, bones).units).toBe(units);
  });

  it.each([
    ["schemaVersion", 2], ["units", "inches"], ["orientation", "Z_UP"], ["meshes", []],
    ["meshes", [null]], ["meshes", [{ boneId: "FRONTAL", nodeName: " " }]],
    ["meshes", [{ boneId: "FRONTAL", nodeName: " frontal_surface" }]],
  ])("rejects invalid %s = %j", (field, value) => {
    expect(() => validateManifest({ ...manifest(), [field as string]: value }, bones)).toThrow();
  });
});

describe("self-contained GLB preflight", () => {
  it("accepts a valid minimal GLB container without promising any mesh coverage", () => {
    expect(validateGlb(glb(minimalGlb()))).toEqual({ nodeNames: [] });
  });

  it("parses validated embedded geometry without any external resource request", async () => {
    const bytes = triangleGlb();
    expect(validateGlb(bytes).nodeNames).toEqual(["Exact node.name"]);
    const manager = new LoadingManager();
    manager.setURLModifier(() => { throw new Error("Unexpected resource request"); });
    const parsed = await new GLTFLoader(manager).parseAsync(bytes, "");
    const mesh = parsed.scene.children[0];
    expect(mesh).toBeInstanceOf(Mesh);
    expect(parsed.parser.associations.get(mesh)?.nodes).toBe(0);
    if (mesh instanceof Mesh) {
      expect(mesh.geometry.getAttribute("position").count).toBe(3);
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    }
  });

  it.each(["https://external.example/buffer.bin", "//external.example/buffer.bin", "/buffer.bin", "data:application/octet-stream;base64,AAAA", "blob:https://example.org/fake"])("blocks URI resources before parsing: %s", (uri) => {
    expect(() => validateGlb(glb({ ...minimalGlb(), buffers: [{ byteLength: 4, uri }] }))).toThrow(/self-contained/);
    expect(() => validateGlb(glb({ ...minimalGlb(), images: [{ uri }] }))).toThrow(/self-contained/);
  });

  it.each([
    { extensionsUsed: ["KHR_draco_mesh_compression"] },
    { extensionsRequired: ["KHR_texture_basisu"] },
    { extensionsUsed: ["KHR_materials_unlit"] },
    { nodes: [{ extensions: { MSFT_lod: { ids: [1] } } }] },
    { meshes: [{ primitives: [{ extensions: { EXT_meshopt_compression: {} } }] }] },
    { extensions: { UNKNOWN_extension: {} } },
  ])("rejects declared or hidden extensions: %j", (extra) => {
    expect(() => validateGlb(glb({ ...minimalGlb(), ...extra }))).toThrow(/extensions/);
  });

  it.each([{ skins: [{}] }, { nodes: [{ name: "bone", skin: 0 }] }])("rejects unsupported skinning: %j", (extra) => {
    expect(() => validateGlb(glb({ ...minimalGlb(), ...extra }))).toThrow(/Skinned/);
  });

  it("rejects truncated, non-GLB, wrong-version and mismatched-length containers", () => {
    expect(() => validateGlb(new ArrayBuffer(4))).toThrow(/truncated/);
    const bytes = glb(minimalGlb());
    const view = new DataView(bytes);
    view.setUint32(0, 123, true);
    expect(() => validateGlb(bytes)).toThrow(/not a binary GLB/);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 1, true);
    expect(() => validateGlb(bytes)).toThrow(/version 2/);
    view.setUint32(4, 2, true);
    view.setUint32(8, bytes.byteLength + 4, true);
    expect(() => validateGlb(bytes)).toThrow(/declared length/);
  });

  it("rejects oversized files before reading metadata", () => {
    expect(() => validateGlb(new ArrayBuffer(MAX_MODEL_BYTES + 1))).toThrow(/64 MiB/);
  });

  it("rejects invalid JSON, unsupported chunks, and misaligned chunks", () => {
    const invalid = glb(minimalGlb());
    new Uint8Array(invalid)[20] = 0xff;
    expect(() => validateGlb(invalid)).toThrow(/UTF-8\/JSON/);
    const unknown = glb(minimalGlb());
    new DataView(unknown).setUint32(16, 0x12345678, true);
    expect(() => validateGlb(unknown)).toThrow(/unsupported chunk/);
    const alignment = glb(minimalGlb());
    new DataView(alignment).setUint32(12, 3, true);
    expect(() => validateGlb(alignment)).toThrow(/alignment/);
  });

  it("rejects duplicate JSON chunks", () => {
    const bytes = glb(minimalGlb(), new Uint8Array(4));
    const view = new DataView(bytes);
    view.setUint32(24 + view.getUint32(12, true), 0x4e4f534a, true);
    expect(() => validateGlb(bytes)).toThrow(/exactly one JSON/);
  });

  it("bounds decoded accessor memory even when a GLB has no binary payload", () => {
    expect(() => validateGlb(glb({ ...minimalGlb(), accessors: [{ count: 100000000, type: "VEC3", componentType: 5126 }] }))).toThrow(/memory budget/);
    expect(() => validateGlb(glb({ ...minimalGlb(), accessors: [{ count: -1, type: "VEC3", componentType: 5126 }] }))).toThrow(/invalid count/);
    expect(() => validateGlb(glb({ ...minimalGlb(), accessors: [{ count: 1, type: "__proto__", componentType: 5126 }] }))).toThrow(/invalid count/);
  });

  it("validates embedded buffer lengths, views, and raster images", () => {
    const binary = new Uint8Array(8);
    expect(() => validateGlb(glb({ ...minimalGlb(), buffers: [{ byteLength: 20 }] }, binary))).toThrow(/byteLength/);
    expect(() => validateGlb(glb({ ...minimalGlb(), buffers: [{ byteLength: 8 }] }))).toThrow(/byteLength/);
    expect(() => validateGlb(glb(minimalGlb(), binary))).toThrow(/no declared buffer/);
    const base = { ...minimalGlb(), buffers: [{ byteLength: 8 }] };
    expect(() => validateGlb(glb({ ...base, bufferViews: [{ buffer: 0, byteOffset: 4, byteLength: 8 }] }, binary))).toThrow(/outside/);
    expect(() => validateGlb(glb({ ...base, images: [{ bufferView: 0, mimeType: "image/png" }] }, binary))).toThrow(/embedded PNG\/JPEG/);
    expect(() => validateGlb(glb({ ...base, bufferViews: [{ buffer: 0, byteLength: 8 }], images: [{ bufferView: 0, mimeType: "image/svg+xml" }] }, binary))).toThrow(/embedded PNG\/JPEG/);
    expect(() => validateGlb(glb({ ...base, bufferViews: [{ buffer: 0, byteLength: 8 }], images: [{ bufferView: 0, mimeType: "image/png" }] }, binary))).not.toThrow();
  });
});

async function preparedTrianglePair() {
  const binary = new Uint8Array(new Float32Array([-.25, -.6, 0, .25, -.6, 0, 0, .6, 0]).buffer);
  const bytes = glb({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: "test_left", mesh: 0, translation: [.7, 0, 0] }, { name: "test_right", mesh: 0, translation: [-.7, 0, 0] }],
    buffers: [{ byteLength: binary.byteLength }], bufferViews: [{ buffer: 0, byteLength: binary.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-.25, -.6, 0], max: [.25, .6, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  }, binary);
  const mapping = validateManifest({ ...manifest(), meshes: [
    { boneId: "FEMUR_LEFT", nodeName: "test_left" }, { boneId: "FEMUR_RIGHT", nodeName: "test_right" },
  ] }, bones);
  const parsed = await new GLTFLoader().parseAsync(bytes, "");
  return prepareAsset(parsed, mapping, validateGlb(bytes).nodeNames);
}

describe("prepared scene geometry, camera fit, and ray picking", () => {
  it("generates missing normals and preserves flat shading on shared geometry", async () => {
    const asset = await preparedTrianglePair();
    try {
      expect(asset.meshes.size).toBe(2);
      for (const mesh of asset.meshes.keys()) {
        const normal = mesh.geometry.getAttribute("normal");
        expect(normal.count).toBe(3);
        for (let index = 0; index < normal.count; index++) {
          expect(normal.getX(index)).toBeCloseTo(0);
          expect(normal.getY(index)).toBeCloseTo(0);
          expect(normal.getZ(index)).toBeCloseTo(1);
        }
        expect((mesh.material as MeshStandardMaterial).flatShading).toBe(true);
        expect((mesh.material as MeshStandardMaterial).color.getHexString()).toBe("ded9c8");
      }
    } finally { asset.dispose(); }
  });

  it("keeps both translated nodes in full-model bounds with the expected anatomical sides", async () => {
    const asset = await preparedTrianglePair();
    try {
      expect(asset.bounds.min.x).toBeCloseTo(-.95);
      expect(asset.bounds.max.x).toBeCloseTo(.95);
      expect(asset.bounds.getCenter(new Vector3()).length()).toBeCloseTo(0);
      expect(asset.boneBounds.get("FEMUR_LEFT")!.getCenter(new Vector3()).x).toBeCloseTo(.7);
      expect(asset.boneBounds.get("FEMUR_RIGHT")!.getCenter(new Vector3()).x).toBeCloseTo(-.7);
    } finally { asset.dispose(); }
  });

  it("picks both actual mapped intersection objects after fitting the 842.6 x 470 viewport", async () => {
    const asset = await preparedTrianglePair();
    try {
      const camera = new PerspectiveCamera(36, 842.6 / 470, .001, 100);
      camera.position.set(0, 0, getCameraFitDistance(asset.bounds.getSize(new Vector3()).length() / 2, 36, 842.6, 470));
      camera.lookAt(asset.bounds.getCenter(new Vector3()));
      camera.updateMatrixWorld(true);
      const raycaster = new Raycaster();
      for (const [fraction, boneId] of [[.35, "FEMUR_RIGHT"], [.65, "FEMUR_LEFT"]] as const) {
        raycaster.setFromCamera(new Vector2(fraction * 2 - 1, 0), camera);
        const hits = raycaster.intersectObject(asset.root, true);
        expect(hits).toHaveLength(1);
        expect(asset.meshes.get(hits[0].object as Mesh)).toBe(boneId);
        expect(hits[0].object.name).toBe(boneId === "FEMUR_LEFT" ? "test_left" : "test_right");
      }
      raycaster.setFromCamera(new Vector2(0, 0), camera);
      expect(raycaster.intersectObject(asset.root, true)).toHaveLength(0);
      const left = [...asset.meshes].find(([, id]) => id === "FEMUR_LEFT")![0];
      (left.material as MeshStandardMaterial).visible = false;
      raycaster.setFromCamera(new Vector2(.3, 0), camera);
      expect(raycaster.intersectObject(asset.root, true)).toHaveLength(0);
    } finally { asset.dispose(); }
  });

  it("fits portrait viewports farther away than landscape viewports", () => {
    expect(getCameraFitDistance(1, 36, 300, 600)).toBeGreaterThan(getCameraFitDistance(1, 36, 600, 300));
  });
});

describe("selection click threshold", () => {
  it.each([[0, false, true], [5, false, true], [6, false, false], [0, true, false]] as const)("delta=%s dragged=%s selects=%s", (delta, dragged, expected) => {
    expect(isSelectionClick(delta, dragged)).toBe(expected);
  });
});

describe("viewer visibility policy", () => {
  const loaded = ["FRONTAL", "MANDIBLE", "FEMUR_LEFT"];
  it("all shows only loaded catalog bones", () => {
    expect([...getVisibleBoneIds([...loaded, "UNKNOWN"], bones, "HYOID", "all", [])]).toEqual(loaded);
  });
  it("isolate shows only the available selection", () => {
    expect([...getVisibleBoneIds(loaded, bones, "MANDIBLE", "isolate", [])]).toEqual(["MANDIBLE"]);
  });
  it("isolate stays empty for a valid catalog bone missing from a partial asset", () => {
    expect(getVisibleBoneIds(loaded, bones, "HYOID", "isolate", []).size).toBe(0);
  });
  it("isolate stays empty without a selection", () => {
    expect(getVisibleBoneIds(loaded, bones, null, "isolate", []).size).toBe(0);
  });
  it("connected includes only loaded selection/related bones", () => {
    expect([...getVisibleBoneIds(loaded, bones, "FRONTAL", "connected", ["MANDIBLE", "HYOID"])]).toEqual(["FRONTAL", "MANDIBLE"]);
  });
  it("region uses the catalog region even when the selected bone has no mesh", () => {
    expect([...getVisibleBoneIds(loaded, bones, "OCCIPITAL", "region", [])]).toEqual(["FRONTAL", "MANDIBLE"]);
  });
  it("region stays empty without a selection", () => {
    expect(getVisibleBoneIds(loaded, bones, null, "region", []).size).toBe(0);
  });
  it("counts multiple loaded nodes of a bone once", () => {
    expect([...getVisibleBoneIds(["FRONTAL", "FRONTAL"], bones, null, "all", [])]).toEqual(["FRONTAL"]);
  });
});

describe("viewer autorotation policy", () => {
  it.each([
    [true, false, 2, true], [true, true, 2, false], [false, false, 2, false],
    [false, true, 2, false], [true, false, 0, false],
  ] as const)("requested=%s reduced=%s visible=%s yields %s", (requested, reduced, count, expected) => {
    expect(shouldAutoRotate(requested, reduced, count)).toBe(expected);
  });
});

describe("viewer containment markup", () => {
  it.each([["viewer-stage", 180], ["settings-viewer", 240]] as const)("does not impose a 320px minimum inside %s", (className, height) => {
    const markup = renderToStaticMarkup(createElement("div", { className, style: { height } },
      createElement(SkeletonViewer, { bones, selectedBoneId: null, relatedBoneIds: [], displayMode: "all",
        autoRotate: true, command: null, assetRevision: 0, onSelect: () => undefined, onStatus: () => undefined })));
    expect(markup).toContain("width:100%;height:100%;min-height:0;min-width:0;overflow:hidden");
    expect(markup).not.toContain("min-height:320");
    expect(markup).toContain("0 visible · 0 loaded");
  });
});

describe("bounded response downloads", () => {
  it("reads a response within its limit", async () => {
    const result = await readBoundedResponse(new Response("test"), 4);
    expect(new TextDecoder().decode(result)).toBe("test");
  });

  it("rejects an oversized Content-Length and cancels its body", async () => {
    let cancelled = false;
    const stream = new ReadableStream({ cancel() { cancelled = true; } });
    await expect(readBoundedResponse(new Response(stream, { headers: { "Content-Length": "100" } }), 4)).rejects.toThrow(/download limit/);
    expect(cancelled).toBe(true);
  });

  it("enforces the streamed limit even without a truthful Content-Length", async () => {
    await expect(readBoundedResponse(new Response("too large", { headers: { "Content-Length": "1" } }), 4)).rejects.toThrow(/download limit/);
  });

  it("rejects an empty response body", async () => {
    await expect(readBoundedResponse(new Response(null), 4)).rejects.toThrow(/no readable body/);
  });
});
