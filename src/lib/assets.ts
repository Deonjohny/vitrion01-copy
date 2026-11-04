import type { AssetManifest, Bone, DisplayMode } from "./types";

export function getVisibleBoneIds(loadedBoneIds: readonly string[], bones: readonly Bone[], selectedBoneId: string | null,
  displayMode: DisplayMode, relatedBoneIds: readonly string[]): Set<string> {
  const catalog = new Map(bones.map((bone) => [bone.id, bone]));
  const selected = selectedBoneId ? catalog.get(selectedBoneId) : undefined;
  const related = new Set(relatedBoneIds);
  return new Set(loadedBoneIds.filter((id) => {
    const bone = catalog.get(id);
    return bone && (displayMode === "all" || (displayMode === "isolate" && id === selectedBoneId) ||
      (displayMode === "connected" && (id === selectedBoneId || related.has(id))) ||
      (displayMode === "region" && selected && bone.region === selected.region));
  }));
}

export function shouldAutoRotate(requested: boolean, reducedMotion: boolean, visibleCount: number): boolean {
  return requested && !reducedMotion && visibleCount > 0;
}

export function getCameraFitDistance(radius: number, fovDegrees: number, width: number, height: number): number {
  const vertical = fovDegrees * Math.PI / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(width / Math.max(height, 1), 0.05));
  return radius / Math.sin(Math.min(vertical, horizontal)) * 1.16;
}

export function isSelectionClick(delta: number, dragged: boolean): boolean {
  return Number.isFinite(delta) && delta >= 0 && delta <= 5 && !dragged;
}

export const MANIFEST_URL = "/anatomy/manifest.json";
export const MAX_MANIFEST_BYTES = 256 * 1024;
export const MAX_MODEL_BYTES = 64 * 1024 * 1024;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label} must be a non-empty string (at most ${max} characters).`);
  }
  if (value !== value.trim()) throw new Error(`${label} must not have surrounding whitespace.`);
  return value;
}

export function validateManifest(value: unknown, bones: Bone[]): AssetManifest {
  const manifest = record(value, "Manifest");
  if (manifest.schemaVersion !== 1) throw new Error("Manifest schemaVersion must be 1.");
  const name = text(manifest.name, "Manifest name", 200);
  const license = text(manifest.license, "Manifest license");
  const attribution = text(manifest.attribution, "Manifest attribution");
  const sourceUrl = text(manifest.sourceUrl, "Manifest sourceUrl");
  let source: URL;
  try { source = new URL(sourceUrl); } catch { throw new Error("Manifest sourceUrl must be an absolute HTTP(S) provenance URL."); }
  if (!["https:", "http:"].includes(source.protocol) || source.username || source.password) {
    throw new Error("Manifest sourceUrl must be an absolute HTTP(S) provenance URL without credentials.");
  }
  const modelUrl = text(manifest.modelUrl, "Manifest modelUrl");
  if (!/^\/(?!\/)[a-zA-Z0-9_./-]+\.glb$/i.test(modelUrl) ||
      modelUrl.slice(1).split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Manifest modelUrl must be a same-origin, root-relative .glb path; no remote URLs, traversal, escapes, query, or fragment.");
  }
  if (manifest.units !== "m" && manifest.units !== "cm" && manifest.units !== "mm") {
    throw new Error("Manifest units must be m, cm, or mm.");
  }
  if (manifest.orientation !== "Y_UP_ANTERIOR_POSITIVE_Z") {
    throw new Error("Manifest orientation must be Y_UP_ANTERIOR_POSITIVE_Z; reorient the asset before importing.");
  }
  if (!Array.isArray(manifest.meshes) || manifest.meshes.length === 0 || manifest.meshes.length > 8192) {
    throw new Error("Manifest meshes must contain between 1 and 8192 node mappings.");
  }
  const knownBones = new Set(bones.map((bone) => bone.id));
  const nodeNames = new Set<string>();
  const meshes = manifest.meshes.map((value, index) => {
    const mapping = record(value, `meshes[${index}]`);
    const boneId = text(mapping.boneId, `meshes[${index}].boneId`, 200);
    const nodeName = text(mapping.nodeName, `meshes[${index}].nodeName`, 500);
    if (!knownBones.has(boneId)) throw new Error(`Unknown boneId "${boneId}" at meshes[${index}].`);
    if (nodeNames.has(nodeName)) throw new Error(`Duplicate nodeName "${nodeName}"; every mesh node may be mapped only once.`);
    nodeNames.add(nodeName);
    return { boneId, nodeName };
  });
  return { schemaVersion: 1, name, license, sourceUrl, attribution, modelUrl,
    units: manifest.units, orientation: manifest.orientation, meshes };
}

/** Inspect the binary container before GLTFLoader can resolve any resources. */
export function validateGlb(bytes: ArrayBuffer): { nodeNames: (string | null)[] } {
  if (bytes.byteLength > MAX_MODEL_BYTES) throw new Error("GLB exceeds the 64 MiB model limit.");
  if (bytes.byteLength < 20) throw new Error("GLB is truncated (missing header/JSON chunk).");
  const data = new DataView(bytes);
  if (data.getUint32(0, true) !== 0x46546c67) throw new Error("Model is not a binary GLB file.");
  if (data.getUint32(4, true) !== 2) throw new Error("Only GLB version 2 is supported.");
  if (data.getUint32(8, true) !== bytes.byteLength) throw new Error("GLB declared length does not match its bytes.");
  let offset = 12;
  let json: Record<string, unknown> | null = null;
  let binaryLength: number | null = null;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error("GLB chunk header is truncated.");
    const length = data.getUint32(offset, true);
    const type = data.getUint32(offset + 4, true);
    offset += 8;
    if (length % 4 !== 0 || length > bytes.byteLength - offset) throw new Error("GLB chunk has an invalid length/alignment.");
    if (type === 0x4e4f534a) {
      if (json || offset !== 20) throw new Error("GLB must start with exactly one JSON chunk.");
      // Bound the JSON separately: compressed or enormous metadata is not a supported asset.
      if (length > 4 * 1024 * 1024) throw new Error("GLB JSON exceeds the 4 MiB metadata limit.");
      try {
        json = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes, offset, length))), "GLB JSON");
      } catch { throw new Error("GLB JSON chunk is invalid UTF-8/JSON."); }
    } else if (type === 0x004e4942) {
      if (!json || binaryLength !== null) throw new Error("GLB must have at most one BIN chunk, after JSON.");
      binaryLength = length;
    } else {
      throw new Error("GLB contains an unsupported chunk type.");
    }
    offset += length;
  }
  if (!json) throw new Error("GLB JSON chunk is missing.");
  const asset = record(json.asset, "GLB asset");
  if (asset.version !== "2.0" || (asset.minVersion !== undefined && asset.minVersion !== "2.0")) {
    throw new Error("Only glTF 2.0 assets are supported.");
  }
  // No loader plugins, decoder downloads, alternate LOD resources, or URI-backed images/buffers.
  // Reject extensions even when they were omitted from extensionsUsed/Required.
  const pending: unknown[] = [json];
  let visited = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++visited > 250000) throw new Error("GLB metadata is too complex.");
    if (Array.isArray(item)) { for (const value of item) pending.push(value); continue; }
    if (!item || typeof item !== "object") continue;
    for (const [key, value] of Object.entries(item)) {
      if (key === "uri" || key === "url") throw new Error("GLB must be self-contained: URI/URL resources (including data URIs) are not allowed.");
      if ((key === "extensionsUsed" || key === "extensionsRequired") &&
          (!Array.isArray(value) || value.length !== 0)) {
        throw new Error("GLB extensions are unsupported; export plain, uncompressed glTF 2.0.");
      }
      if (key === "extensions" && Object.keys(record(value, "GLB extensions")).length) {
        throw new Error("GLB extensions are unsupported; embedded/network extensions are not allowed.");
      }
      pending.push(value);
    }
  }
  const array = (key: string): unknown[] => {
    const value = json[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`GLB ${key} must be an array.`);
    return value;
  };
  if (array("skins").length) throw new Error("Skinned GLB assets are unsupported; export static bone meshes.");
  const nodeNames = array("nodes").map((value) => {
    const node = record(value, "GLB node");
    if (node.skin !== undefined) throw new Error("Skinned GLB nodes are unsupported; export static bone meshes.");
    if (node.name !== undefined && typeof node.name !== "string") throw new Error("GLB node names must be strings.");
    return typeof node.name === "string" ? node.name : null;
  });
  const buffers = array("buffers");
  if (buffers.length > 1) throw new Error("GLB must use a single embedded binary buffer.");
  if (buffers.length === 1) {
    const buffer = record(buffers[0], "GLB buffer");
    const length = buffer.byteLength;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1 ||
        binaryLength === null || length > binaryLength || binaryLength - length > 3) {
      throw new Error("GLB buffer byteLength does not match the embedded BIN chunk.");
    }
  } else if (binaryLength !== null) {
    throw new Error("GLB BIN chunk has no declared buffer.");
  }
  const views = array("bufferViews");
  views.forEach((value) => {
    const view = record(value, "GLB bufferView");
    const start = view.byteOffset ?? 0;
    const length = view.byteLength;
    const bufferLength = buffers.length ? record(buffers[0], "GLB buffer").byteLength as number : 0;
    if (view.buffer !== 0 || typeof start !== "number" || !Number.isSafeInteger(start) || start < 0 ||
        typeof length !== "number" || !Number.isSafeInteger(length) || length <= 0 || start + length > bufferLength) {
      throw new Error("GLB bufferView is outside its embedded buffer.");
    }
  });
  let accessorBytes = 0;
  const componentBytes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const componentCounts: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  array("accessors").forEach((value) => {
    const accessor = record(value, "GLB accessor");
    const count = accessor.count;
    const width = typeof accessor.componentType === "number" ? componentBytes[accessor.componentType] : undefined;
    const components = typeof accessor.type === "string" && Object.hasOwn(componentCounts, accessor.type)
      ? componentCounts[accessor.type] : undefined;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || !width || !components) {
      throw new Error("GLB accessor has an invalid count, componentType, or type.");
    }
    // Sparse and zero-initialized accessors can allocate far more memory than the downloaded BIN chunk.
    accessorBytes += count * width * components;
    if (accessorBytes > MAX_MODEL_BYTES * 2) throw new Error("GLB decoded accessors exceed the 128 MiB memory budget.");
  });
  array("images").forEach((value) => {
    const image = record(value, "GLB image");
    if (typeof image.bufferView !== "number" || !Number.isInteger(image.bufferView) || !views[image.bufferView] ||
        (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg")) {
      throw new Error("GLB images must be embedded PNG/JPEG bufferViews.");
    }
  });
  return { nodeNames };
}

export async function readBoundedResponse(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Asset exceeds the ${Math.round(maxBytes / 1024)} KiB download limit.`);
  }
  if (!response.body) throw new Error("Asset response has no readable body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error(`Asset exceeds the ${Math.round(maxBytes / 1024)} KiB download limit.`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}
