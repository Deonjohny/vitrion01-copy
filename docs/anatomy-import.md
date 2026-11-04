# Real skeleton import

`public\anatomy\manifest.json` is consumed by the existing viewer, unchanged.
The included `skeleton.glb` contains genuine Z-Anatomy geometry, not placeholders:
**208 static mesh nodes mapped by exact source names to 206 permanent catalog IDs**.
Sternum is three nodes (manubrium, body, xiphoid); coverage counts unique IDs.
This is source-label/geometry coverage, **not independent clinical verification**.

## Reproduce on Windows

Requires Python 3.11+, curl.exe and the project's existing Node dependencies.
No global Blender installation or package manifest changes are needed.
From `E:\vition01`, run:

```powershell
python tools\anatomy\import_anatomy.py fetch
python tools\anatomy\import_anatomy.py inspect
python tools\anatomy\import_anatomy.py export
npx vitest run tests\bone-registry.test.ts tests\assets.test.ts tests\anatomy.test.ts
npx eslint src\manifests\boneRegistry.ts tests\bone-registry.test.ts
```

`fetch` downloads once, checks SHA-256, and caches under ignored
`tools\anatomy\.cache`. It extracts **only Startup.blend** from Z-Anatomy.zip;
no upstream Python, add-ons, XML templates or embedded text scripts are run.
The official portable Blender 4.5.9 LTS ZIP is independently checksum-pinned.
Alternatively pass `--blender 'C:\path\to\blender.exe'` to each command to use
an existing local executable (`fetch` then skips the portable download).
All Blender invocations use `--factory-startup --disable-autoexec` and
`--python-exit-code 1`. Source automatic script execution stays disabled.
The exporter writes only base mesh datablocks selected by `source-map.json`,
not evaluated upstream modifiers, drivers, materials or scene extras.

To inspect manually:

```powershell
& 'tools\anatomy\.cache\blender-4.5.9-windows-x64\blender.exe' --background --factory-startup --disable-autoexec 'tools\anatomy\.cache\Z-Anatomy\Startup.blend' --python-exit-code 1 --python 'tools\anatomy\inspect_blend.py' -- 'tools\anatomy\source-inspection.json'
```

The source archive is **86,734,957 bytes** and contains Startup.blend
(306,838,281 bytes), Python files, XML themes and a splash image; no standalone
mesh interchange files. TA2.csv and License.txt are separate upstream files.
TA2's inspected header is `TA2ID;English;Latin;Français;Español;Portugues;Italiano;Parsi`
inside a quoted CSV record. Merely possessing this terminology table does not
establish a verified per-bone ontology crosswalk; no TA2 IDs were assigned.

Geometry revision: `bb293be456f6d2245191f37752d14ec76894740d`.
Terminology/license downloads are separately SHA-256-pinned (fail closed if
upstream master changes). Full source ZIP SHA-256:
`e029688545627bd0214b269e1063143abb580aad72b2c2445d6d8a9a0d9da736`.
Extracted blend SHA-256:
`9f08a17ea0115fed80b2a73ecdf0a1bc2ab2f6956f37c593ce23d513ea35afcd`.
Portable Blender SHA-256:
`41da973b9bf95bb312cbeff4d1982feb13259b43c821686b9bafea4dfe5477cf`.

## Selection, coordinates and metadata

Source objects were inspected directly: e.g. `Frontal bone`, `Femur.l`,
`Femur.r`, `Atlas (C1)`, `Malleus.l`, `First rib.r` and individual phalanges.
The skeletal collection also contains cartilage, teeth, sinus surfaces and
landmark overlays; collection membership alone is **not** an export allowlist.
The 208 exact object names in `source-map.json` exclude those structures.
No names are inferred from nearest geometry or array position.

Source metric coordinates have Z superior, negative Y anterior, positive X
left (verified against frontal bone, sternum/patella, vertebral column and
bilateral femur bounds). Export bakes each object's world matrix and converts
`(x, y, z)` to `(x, z, -y)`: metres, Y-up, anterior positive Z.
Meshes have one plain material and one indexed triangle primitive each;
GLB has embedded binary, no extensions, external resources, textures, skins,
animation or compression. The existing viewer computes missing normals.

`bone-spatial.json` records the actual exported world-space bounds per bone
and their midpoint (not a mass centroid). The viewer recenters the asset for
display; registry values remain in original exported metre coordinates.
`src\manifests\boneRegistry.ts` reuses the existing catalog identities and
represents missing mappings/bounds explicitly. FMA, TA2, RadLex and clinical
bone dimensions are null: no invented IDs or universal normal lengths.
Per-model bounds are geometry metadata, not normative clinical dimensions.

## Licensing

See `public\anatomy\LICENSE.txt` and `tools\anatomy\License.source.txt`.
Retain both upstream attributions: BodyParts3D / Database Center for Life Science
(CC BY-SA 2.1 Japan), and Z-Anatomy (CC BY-SA 4.0), with named authors and links.
This skeleton derivative is CC BY-SA 4.0. No separately licensed NC kidney or
inner-ear organ models, nor Wikipedia definitions, are included. Auditory
ossicles are the explicitly named skeletal bone meshes, not the inner-ear organ.

## Verified output and validation

- GLB: **9,506,892 bytes** (about 9.07 MiB, below the unchanged 64 MiB limit).
- Geometry: **521,253 triangles**, **208 mesh nodes**, **206 source-name-mapped IDs**.
- Model SHA-256: `578eaca868cb4ebcbc01a18574e09fc27a774100f13f5154d80a5513552fe315`.
- Targeted catalog, viewer and registry tests: **147 passed**.
- New TypeScript files pass ESLint.
- Whole-project TypeScript check is blocked by an existing missing implicit
  `@types/fhir` definition (TS2688); no dependencies were changed.

Tests call the existing unmodified manifest/GLB validators, parse the real asset
through GLTFLoader with external requests forbidden, resolve all exact node
associations through `prepareAsset`, verify finite geometry and world-space
bounds/centroids, and check file size/checksum, coverage and null metadata.
This is mechanical compatibility validation, not a clinician's anatomy review.
