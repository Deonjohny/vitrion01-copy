# Local anatomy assets — phases 1–2

The local installation now includes a source-derived Z-Anatomy skeletal model; see [reproducible import, coverage, and attribution](anatomy-import.md). Generated GLB/manifest files are excluded from Git and must be provisioned separately for a fresh checkout or deployment. The contract below also supports independently licensed assets. The 206-entry catalog alone is never evidence of 206 loaded meshes: actual mapped geometry is validated before reporting coverage. Missing assets produce a neutral unavailable state, never primitive substitute anatomy. Source-label mapping is not clinical anatomical certification.

## Supply an asset

1. Obtain a model with permission for your intended distribution/use. Verify the creator, source, license terms, attribution, modifications, and any share-alike/noncommercial requirements. Catalog/textbook licensing does **not** license an unrelated model.
2. Prepare a static, uncompressed, self-contained GLB 2.0 in the canonical coordinates below. Name each actual mesh node distinctly. Export each mapped node as one mesh primitive (not a multi-primitive group).
3. Place it under `public/anatomy/`, then add `public/anatomy/manifest.json`. The public URL is `/anatomy/manifest.json`; do not include `public` in a URL.
4. Map exact GLB **node names**, not mesh resource names or guessed catalog identifiers. Use current `Bone.id` values from the catalog. Retry through the app's asset reload control (`assetRevision`).

### INCOMPLETE manifest example — one bone only, no corresponding asset included

This illustrates the schema, **not** a usable license or complete model. Replace all example provenance/licensing/name/path values with verified information and map every bone actually present. Do not install this example while pretending the asset exists.

```json
{
  "schemaVersion": 1,
  "name": "INCOMPLETE — replace with actual asset title",
  "license": "REPLACE with verified model license and terms",
  "sourceUrl": "https://example.org/replace-with-actual-model-source",
  "attribution": "REPLACE with creator, title, license, and modifications",
  "modelUrl": "/anatomy/licensed-skeleton.glb",
  "units": "m",
  "orientation": "Y_UP_ANTERIOR_POSITIVE_Z",
  "meshes": [
    { "boneId": "FRONTAL", "nodeName": "Exact_Frontal_Node" }
  ]
}
```

`name`, `license`, `sourceUrl`, and `attribution` are required, nonempty strings. `sourceUrl` is an HTTP(S) provenance link with no credentials; it is **not fetched by the loader**. License strings are provenance declarations, not proof that redistribution is permitted. `modelUrl` must be a root-relative same-origin `.glb` path with ASCII letters/digits, underscores, hyphens, dots, and slashes. Remote/protocol-relative URLs, relative paths, traversal segments, encoded paths, backslashes, query strings, and fragments are rejected.

## Canonical coordinates and scale

- Right-handed coordinates: **+Y superior/up**, **+Z anterior/front**, **+X the subject's anatomical left**.
- From the anterior camera (+Z looking toward the subject), anatomical left appears on the **viewer's right**. The Left camera command moves to +X; Right moves to −X. Posterior uses −Z, superior +Y, inferior −Y.
- `units` must be `m`, `cm`, or `mm`. The loader converts to meters; it does not guess scale or orientation.
- Apply/export the coordinate convention before import. The orientation declaration is checked, but anatomy/orientation cannot be inferred or medically verified from arbitrary vertex data.
- Bounds of mapped mesh geometry determine centering, camera fit, clipping planes, selection focus, and resize fitting. Superior and inferior views use −Z and +Z respectively as screen-up to avoid a degenerate camera up vector.

## Node mapping and honest coverage

- Every `boneId` must exist in the supplied catalog; unknown IDs fail validation.
- Every `nodeName` must be unique in the manifest and occur exactly once in the GLB node list. Names resolve case-sensitively through loader node associations, preserving original names even when Three.js sanitizes display names.
- The mapped object must exist in the GLB default scene and be an actual static `Mesh` with at least three position vertices (and three indices if indexed), plus finite, nonzero per-mesh bounds. A transform group, multi-primitive group, point cloud, line, or missing node does not count as a bone mesh.
- Multiple **different nodes** may map to one bone; these count as **one** loaded bone. A node cannot map to two bones.
- Unmapped mesh surfaces are hidden and cannot be selected. Their geometry never counts toward loaded coverage or camera fit. Hiding a parent surface does not hide a mapped child mesh.
- Coverage is shown as **visible / unique loaded / catalog** counts. Partial assets remain explicitly partial. Empty filtered selections show no surfaces instead of silently falling back to an unrelated skeleton.
- `all` shows all mapped surfaces; `isolate` shows the selection; `connected` shows the selection plus the supplied related IDs; `region` shows loaded bones in the selected catalog region. Without a selection, isolate/region show no meshes.
- Selection is red, related bones are darker, normal bones are ivory, and hover is subtle. Colors restore when state changes. Original model materials are deliberately replaced for a consistent anatomy display. Missing vertex normals are generated and glTF flat shading is preserved, including shared geometry instances.
- Initial/resize/filter fitting uses the full visible set, not the selected bone. Merely selecting a bone in All mode must not zoom in and crop its neighbors. Only the explicit Focus command fits selection bounds; anatomical view commands fit the visible set, and Reset fits the full asset. A consumed command ID is not replayed when selection changes.

## Import restrictions and network policy

The GLB bytes are downloaded and inspected **before** `GLTFLoader.parseAsync` runs:

- GLB version 2, exact declared file length, one first JSON chunk, at most one subsequent BIN chunk; no unknown/duplicate chunks or invalid alignment.
- One embedded binary buffer, valid buffer lengths/view ranges; raster images must use embedded PNG/JPEG bufferViews.
- **No resource URIs**, including external, root-relative, data, or blob URI fields inside the asset. The loader allows only browser-local blob URLs that it creates for already-embedded raster images.
- **No glTF extensions**, even if omitted from `extensionsUsed`/`extensionsRequired`. Re-export plain glTF 2.0 without Draco, Meshopt, Basis/KTX, LOD, instancing, lighting/material extensions, or other loader plugins. No decoder/transcoder/CDN requests are made.
- No skins or skinned nodes. This viewer does not implement animated skeletal deformation. Static node transforms are retained; animation clips are not played.
- Same-origin fetches only, redirects forbidden, cache bypassed on retry; no external model download or environment-map fetch. The source link opens only when explicitly followed.
- Limits: **256 KiB manifest**, **64 MiB GLB**, **4 MiB GLB JSON**, **128 MiB decoded accessor data**, **8,192 mappings**, and a **45-second loading timeout**. Both reported response size and actual streamed bytes are bounded. Invalid, oversized, unsupported, missing, or failed assets produce visible status messages.

For reliability, optimize mesh topology and raster resolution before shipping. The checks enforce the supported import format; they do not certify anatomical accuracy or clinical suitability.

## Viewer integration

`SkeletonViewer` is a default-exported client component implementing the shared `SkeletonViewerProps` contract. `onStatus` reports `missing`, `loading`, `ready`, or `error` with unique `loadedBoneIds`; unrelated rerenders/callback identity changes do not refetch or repeatedly emit the same status. Parsing mesh data alone does not report ready: readiness waits for Canvas renderer initialization. Status changes are reported synchronously in transition order; initialization/render-boundary/context-loss errors clear `loadedBoneIds`, and a delayed renderer-ready callback cannot override an error. The Canvas HTML fallback has no effects (it is mounted even on supported browsers). Missing assets are still checked before attempting WebGL. `assetRevision` forces an aborted/cleaned-up reload and resets the rendering boundary.

Mouse/touch orbit, pan, wheel/pinch zoom, autorotation, anatomical view presets, selection focus, zoom commands, and full-model reset use OrbitControls. Pointer movement beyond 5 CSS pixels and multitouch gestures do not select a bone. All/isolate/connected/region filters affect both surface visibility and picking. WebGL initialization/render/context-loss failures surface as errors instead of a blank/fake model. Owned geometries, original/replacement materials, textures, and ImageBitmaps are disposed on replacement/unmount or renderer failure.

The viewer takes its parent's explicit height (including `.viewer-stage` and `.settings-viewer`); it imposes no minimum height, clips overflow, and positions the canvas absolutely inside its own bounds. Autorotation is disabled while `prefers-reduced-motion: reduce` is active (including preference changes) or no bones are visible. An unavailable selection in isolate mode shows zero meshes and an explicit partial-asset message. Empty-state hooks are `viewer-empty`, `viewer-empty-missing`, `viewer-empty-loading`, `viewer-empty-error`, and `viewer-empty-{eyebrow,mark,title,description,note}`. Other integration hooks include `skeleton-viewer`, `viewer-coverage`, and `viewer-attribution`.

## Validation

Run `npm test -- tests/assets.test.ts`. The original 67 cases covered 42 manifest validations, 20 binary/preflight checks, four bounded downloads, and one in-memory GLTFLoader parse with resource access blocked. They did not exercise viewer visibility, selection/picking, or camera calculations.

The current 90 cases additionally cover eight pure visibility/selection-filter cases (including unavailable isolate selections), five autorotation-policy cases, two server-rendered containment-markup checks, four prepared-scene/camera/raycast cases, and four click-threshold cases. The prepared-scene tests use two translated instances of a normal-less triangle: they verify generated normals/flat shading, world-space bounds, bilateral picking at the 842.6 × 470 viewport, hidden-mesh exclusion, and portrait fitting distance. The markup checks do not measure actual browser layout. Actual R3F pointer-event delivery, rendered colors, camera command/effect lifecycle, live media-query subscription, and WebGL/error callback lifecycle still require browser integration QA; these are not claimed as unit-tested. Synthetic triangle bytes are test data only, never a displayed fallback model. A licensed real anatomical asset and browser/WebGL visual QA are still needed before claiming full anatomical coverage.
