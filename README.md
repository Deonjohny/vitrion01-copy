# VITRION_01

Local anatomical research workspace with an encrypted Python case service, dual-review workflow, and FHIR R4 exports. Built with Next.js App Router, TypeScript, React Three Fiber / Three.js, GSAP, and FastAPI. This is a development integration, not an approved clinical deployment.

**Research reference only. Not a diagnostic tool or a clinically validated anatomical atlas.**

## Run locally

Use Node.js **22.13+** (recommended) and npm. The application binds to localhost by default.

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:3000` for anatomy or `/cases` for the case workspace. The deployed presentation frontend uses `http://127.0.0.1:3001`. The anatomy viewer works without the backend. Case operations require the Python service on `127.0.0.1:8001`; explicit local presentation mode connects without token entry, while normal mode requires a locally issued JWT. See [backend setup](server/README.md). The Next.js `/clinical-api` proxy uses that loopback address. The frontend is run on the host, not inside the backend Docker network. Do not use this development system to store patient information.

```powershell
npm test
npm run lint
npm run typecheck
npm run build
npm start
```

To rebuild/restart the isolated frontend release without overwriting the original port-3000 build:

```powershell
$env:VITRION_DIST_DIR = ".next-platform"
npm run build
npm start -- --port 3001
```

Start the backend separately using its setup instructions. Do not run a second server on an already occupied port. The local processes are not installed as operating-system services and do not automatically restart after reboot.

## Implemented

- Responsive black-and-red explorer, skeleton coverage view, searchable bone catalog, anatomical relationships, and settings.
- 206 individual adult reference records with stable anatomical IDs: 80 axial and 126 appendicular. Catalog count is **not** rendered mesh coverage.
- Left/right counterparts, curated symmetric articulations, regional context, original concise source-referenced facts, and honest unavailable fields.
- Selection shared across sections, local-browser preference persistence, defensive preference parsing, and JSON record exports containing sources.
- GSAP introduction with skip, once-per-session behavior, and reduced-motion support. Without licensed anatomy the introduction is typography/particles only, not a simulated skull revelation.
- Licensed GLB integration with strict manifest/asset validation, model coverage reporting, per-bone selection, highlights, isolation, connected/region context, focus, orbit, zoom, and anatomical camera presets.
- AES-256-GCM case-field encryption, JWT role enforcement, revision-checked dual-radiologist review, amendments, hash-chained access auditing, and authenticated FHIR R4 exports for synthetic cases.
- Existing restricted DICOM viewer retained, with its file input disabled under the PNG/PDF-only upload policy.
- Manually placed **approximate crack illustrations** on a selected skeletal mesh, with adjustable size/angle, surface attachment, and explicit non-diagnostic labeling. These are reference-surface annotations, not AI detections, patient-specific fractures, measurements, or clinical case findings.
- Automated catalog, asset validation, persistence, clinical contract/FHIR, DICOM, and backend workflow tests. An opt-in loopback integration test exercises actual case creation, authorization, dual review, audit verification, and FHIR generation through the frontend proxy.

## Anatomical model provisioning

A local Z-Anatomy-derived skeletal asset has been generated: 208 mapped mesh nodes cover the 206 catalog IDs, with approximately 9.5 MB of geometry. This is source-label/geometry coverage, not clinical certification. See [reproducible anatomy import and attribution](docs/anatomy-import.md). Unverified FMA, TA2, RadLex identifiers and standard anatomical dimensions remain explicitly unavailable; patient-independent model bounds are not normal population measurements.

The generated manifest and GLB remain excluded from Git. A fresh checkout or deployment must provision them using the import pipeline and preserve required source attribution and licenses. Follow [asset integration](docs/assets.md) for the supported runtime contract. The viewport reports unavailable assets instead of drawing substitute anatomy when provisioning has not been completed.

The catalog's expected mesh IDs are naming conventions, not proof of available geometry. A manifest links actual mesh node names to permanent bone IDs; coverage counts unique mapped bones.

## Using the workspace

Search by name or permanent ID (for example `FEMUR_LEFT`), filter by region/laterality, then select a record. The information panel links articulating bones and the opposite-side counterpart. On narrow screens, selection scrolls to the record. JSON export includes the selected record, its references, and the current mesh-availability flag; it is not a medical report.

With a compatible asset and WebGL-capable browser, use drag/touch to orbit, scroll/pinch to zoom, and the camera selector for anatomical views. Isolate, connected-bone, and regional-context modes change visibility; reset restores the whole loaded model. Missing assets or unavailable rendering capabilities must not be interpreted as missing biological structures.

To illustrate an approximate fracture location, select a bone, optionally **Isolate** and **Focus**, then expand **Approximate crack · illustration** inside the viewer. Choose **Click to place crack** and click the selected surface, or choose **Use visible center**. Adjust illustration size/angle and rotate the model to inspect the surface mark. The jagged line is a manually positioned illustrative overlay, not a computed fracture or a physical split of the bone mesh. Other bones cannot receive the mark while placement is active. Changing bones, reloading the asset, or choosing **Clear crack** removes it. Illustrations are not persisted, exported, or saved into clinical case findings, and they do not make the X-ray/MRI pipelines functional.

Settings resets nonclinical preferences only. Browser storage restrictions may prevent preferences from surviving a reload. Reduced-motion mode suppresses the cinematic introduction. The guide is keyboard-accessible and closes with Escape.

## Written-report and X-ray processing

The analysis navigation opens `/cases`. In the explicitly enabled **local presentation mode**, it connects automatically: no JWT entry or token copying is required. Presentation records use a separate local database; clinical signing and amendments are disabled. Normal mode retains authenticated access. Create/save an `MR` or `XR` synthetic case to reveal its processing controls.

Only **Upload PNG X-ray Image** and **Upload MRI Report (PDF)** are enabled. File extension, MIME type and content signature must match. JPG/JPEG, DICOM, DOCX, other formats, legacy uploads and pasted-text processing are disabled. Existing narrative/DICOM-link fields remain visible but read-only; standalone manual finding entry is disabled. Review, mapping and annotation of an actual uploaded file remain available. No sample files or demo results are supplied by presentation mode.

- **MRI written PDF:** digital text extraction and optional offline OCR produce conservative **rule-based draft fracture statements** with source page/section/span, assertion, temporality and catalog IDs. This is not an LLM and does not comprehensively interpret every medical abnormality. Negative/unresolved findings cannot be accepted as fractures; uncertain statements remain uncertain. Review source evidence before accepting and saving findings. No MRI scan images are interpreted.
- **X-ray PNG only:** the separately provisioned **experimental single-class ONNX detector** actually executes locally and draws suspected-region boxes over the source image. It cannot identify the bone or side; those require reviewer assignment. Tests on the supplied examples showed missed and off-target regions. Never treat a missing box as a negative diagnosis or a box as an exact fracture line. The model's graph declares AGPL-3.0 while its hosting card declares MIT; redistribution/commercial obligations require independent resolution. See [backend provisioning and limitations](server/README.md).
- **Prepared presentation for the ten supplied PNGs:** selecting one of these exact images automatically matches its SHA-256 and opens a preauthored approximate fracture illustration in the existing viewer. No case creation or detector button is needed for this prepared output. It is visibly labeled **Prepared illustration—not AI reconstruction**. Full-skeleton context, broken-bone close-up and focus controls are available. Unknown/changed image bytes receive no prepared output; filenames are never used for matching. The rib example shows the right rib group without an invented exact rib marker. Skull/bone-subregion limitations are listed beside each illustration. Prepared data is not saved as an AI diagnosis or clinical finding.
- **Manual source trace:** a reviewer can draw successive points along the visible break on the source image, assign anatomy, and save the source hash, normalized trace and image dimensions. It is explicitly manual, not segmentation generated by AI.
- **3D linkage:** reviewed report findings, confirmed detector regions and manual traces can open the actual mapped bone with articulation context. The reference viewer labels uncertain findings and supports manually positioned approximate surface cracks. A 2D trace/box is not registered to patient-specific 3D anatomy; no exact 3D fracture shape or location is inferred.

The UI, API and model adapters now agree on a 10 MiB encoded-file limit with a larger bounded multipart request allowance. Bone IDs are validated against synchronized frontend/backend catalogs; normalized boxes require positive area within [0,1].

For the currently running local release, the frontend proxy targets loopback **8001** because port 8000 is occupied by another application. Start the processing backend with:

```powershell
Set-Location E:\vition01\server
.\.venv\Scripts\python -m scripts.run_local --port 8001
```

Install the backend's base, experimental and OCR requirement files into a project virtual environment as needed. Optional model artifacts remain local ignored data. Do not stop unrelated services occupying another port.

## Case service and interoperability

The `/cases` workspace connects to the authenticated FastAPI service. Access tokens remain in React memory only; disconnect clears clinical state. It supports synthetic case creation/editing, manual anatomy-linked findings, revision-checked radiologist signatures, amendments, audited exports, and compliance-role audit verification. Verified records require two distinct radiologists reviewing the same revision; modifications invalidate earlier signatures. Permissions are enforced by the server, not by browser controls.

The TypeScript case contract is [clinical.ts](src/lib/clinical.ts); backend Pydantic serialization uses the same camelCase fields. Responses are runtime checked before display. The [FHIR generator](src/utils/fhirDiagnosticReport.ts) implements an R4 collection Bundle with Patient, DiagnosticReport (LOINC `18748-4`), Observation, Practitioner, and Provenance resources. Internal references resolve within the collection. Final/amended export requires two current-revision reviewers. Reviewer provenance is not a digital signature or an attestation of anatomical/diagnostic correctness. Missing terminology mappings remain absent rather than fabricated. Export contains sensitive fields and must only contain synthetic data in this release. Clinical effective dates are not inferred from database modification timestamps.

## Scope and limitations

The source code does **not** establish HIPAA compliance, ATNA conformance, FDA clearance, or clinical validation. Cryptographic field storage and chained audit records are technical safeguards, not complete compliance. A database administrator with control of the audit store can rewrite a chain unless independently protected checkpoints/immutable storage are deployed. Local JWT issuance is a development mechanism, not a production identity provider.

Task-specific validated X-ray fracture models, MRI entity-extraction models, calibrated displacement measurement, and validated AO/OTA mapping are not supplied by general-purpose TorchXRayVision, YOLO, or Bio_ClinicalBERT base checkpoints. The backend implements opt-in YOLO inference and local safetensors token-classification adapters with pinned artifact checksums, strict input limits, and metadata-only model audit events. Model artifacts and optional heavy model dependencies are not bundled. Unconfigured clinical inference returns HTTP 503; no generic model output is represented as a fracture diagnosis. The case UI previews configured model output without automatically saving or signing it. Displacement and AO/OTA codes remain null without a validated measurement/classification source. MRI processing is written-report only, never MRI pixel interpretation.

The `/dicom` route and its existing decoder/layout are retained, but **DICOM file selection and loading are disabled**. Existing DICOM-linked records remain readable; new diagnostic inputs must use the separated PNG/PDF workflows. This does not add PACS integration or de-identification.

Anatomical relationships are curated and incomplete, not a licensed SNOMED/FMA/UMLS crosswalk. Regional context is a catalog grouping, not computed physical proximity. Dimensions and anatomical spatial measurements remain unavailable unless a verified source is supplied. See [anatomical data notes and source licensing](docs/anatomy.md). Source material licenses must be reviewed independently before commercial reuse or redistribution.

The app is a local research integration, not a hardened multi-user medical service. Backend and optional credential-required Orthanc Compose definitions are provided; Docker was unavailable locally, so container/PACS execution has not been validated. The running local frontend is available at `http://127.0.0.1:3001`; the original service on port 3000 was not replaced. Production clinical deployment requires licensed assets, domain-expert review, external clinical validation, medical/privacy controls, accessibility review, and regulatory assessment. See [clinical deployment gates](docs/clinical-deployment.md).

## Structure

```text
src/app/                 Next.js entry, layout, visual system
src/components/          Explorer, information panel, intro, 3D viewer
src/data/anatomy.ts      Anatomical reference data and provenance
src/lib/anatomy.ts       Search and relationship mapping
src/lib/assets.ts        Asset contract and validation
src/lib/preferences.ts   Browser-only nonclinical preferences
src/lib/types.ts          Shared typed contracts
public/anatomy/           Locally provisioned licensed assets (not bundled)
tests/                   Catalog, asset, and preference regression tests
docs/                    Anatomical provenance and asset integration
```

Anatomical data is separate from UI and rendering. Future inference and medical NLP should live in independently validated services; neither belongs in the 3D renderer. There is intentionally no fake backend or mock AI pipeline.
