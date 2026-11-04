# VITRION_01 diagnostic workflow audit

**Date:** 2026-11-04. **Target:** the running frontend at `http://127.0.0.1:3001`, its `/clinical-api` proxy, and the FastAPI service at `127.0.0.1:8000`. Source inspected in this workspace. This is a functionality and evidence audit, not a diagnosis or clinical certification.

> **Historical audit:** the original findings below describe the earlier deployment. Subsequent implementation and verification are recorded immediately below; do not read the original HTTP 413/422/503 results as the current processing status.

## Subsequent implementation and actual-input verification

The application now implements a **human-reviewed research workflow**, not a fully automatic clinically reliable diagnostic system:

- Authenticated written-report PDF extraction, bounded local offline OCR and source-grounded rule-based fracture statements with assertion/temporality and catalog IDs.
- A genuine pinned local ONNX fracture-only detector, source-image box overlays, and explicit reviewer assignment of anatomy/laterality. This model is experimental and **does not identify bones or produce fracture-line segmentation**.
- Reviewer-drawn source-image traces with image hash/normalized coordinates, accepted findings with persisted evidence, and links to the corresponding real skeleton bone.
- Manually positioned approximate 3D surface crack illustrations. No patient-specific 2D-to-3D registration or exact fracture geometry is claimed.
- Synchronized anatomy catalogs, strict normalized positive-area boxes, matching 10 MiB file limits and a larger bounded multipart allowance. The previously reproduced unknown-ID and invalid-box probes now return 422.

### New actual-file results

All 14 original files remained byte-for-byte unchanged. Authenticated requests traversed the running frontend proxy to the updated backend on loopback 8001 (port 8000 belongs to a different application and was not stopped).

| Input | Current execution result | Interpretation |
| --- | --- | --- |
| Four original digital MRI PDFs | All HTTP 200; mapped C6, NASAL_RIGHT, T8, L1 with exact page-text evidence spans | Rule-based drafts; right-nasal Impression remains uncertain. Unresolved sentences retain null anatomy. Not clinical validation or full report understanding. |
| Raster-only derivatives of synthetic C6 and T8 reports | Both HTTP 200; actual offline OCR; C6 and T8 resolved after correcting OCR-joined `C6vertebral` recognition | OCR may omit lines; one Impression line was omitted in the C6 OCR sample. Warnings require source-completeness review. These are rasterized software-test reports, not an adjudicated scanned clinical cohort. |
| Original scapula PNG | HTTP 200; 1 genuine model region, score approximately 0.406; browser overlay shown near the annotated AP-region break | A suspected box, not an exact crack outline or proven diagnosis. The second view was not reconciled. |
| Original forearm PNG | HTTP 200; 3 suspected regions, scores approximately 0.494/0.365/0.360 | Includes off-target regions; reviewer confirmation mandatory. |
| Original navicular PNG | HTTP 200; 1 region, score approximately 0.590 | Detection count is not proof of correct anatomy or localization. |
| Original pelvis PNG | HTTP 200; 1 region, score approximately 0.350 | Off-target localization observed relative to supplied annotated injury; do not accept without review. |
| Original mandible PNG | HTTP 200; 1 region, score approximately 0.319 | Off-target localization relative to the visible midline annotated injury. |
| Original rib PNG | HTTP 200; 1 region, score approximately 0.291 | Off-target region; not an established rib-fracture result. |
| Original hand PNG | HTTP 200; 1 region, score approximately 0.277 | Off-target region relative to the supplied metacarpal annotation. |
| Original skull, lower-leg and clavicle PNGs | All HTTP 200; **zero model detections** | Missed supplied annotated examples. Zero detections must not be interpreted as absence of fracture. |

The checkpoint is `Jesteban247/yolo11-fracture-onnx`, immutable revision `8227dbcdcf80f3cd06f052a8295ee42657989deb`; SHA-256 `5f16fff48dc54a5ca2b4c625a8df4d55c2beaef18b202fc8dba6e1117a112686`. Inspected ONNX metadata specifies one class, `fracture`, and a 640×640 input. The graph declares **AGPL-3.0**, while the hosting card declares MIT; that conflict is preserved in UI/provisioning documentation and must be resolved before redistribution/commercial deployment. Actual CPU execution was verified; no pickle checkpoint was executed. Reported hosting-card metrics were not accepted as clinical validation or accuracy on these examples.

### Browser acceptance checks

- Uploaded the original T8 written PDF through the UI, extracted digital text, reviewed the Impression evidence, accepted only the selected T8 statement and saved its exact provenance in a case revision.
- Opened its generated skeletal link: **Thoracic vertebra 8 selected**, 7 reference articulation-context bones visible. Isolated T8 and manually placed an explicitly illustrative surface crack.
- Uploaded the original scapula PNG through the UI; actual detector returned one region and drew a source-image box. Assigned `SCAPULA_LEFT` manually and confirmed the suspected region, obtaining the correct catalog-link target.
- Drew a three-point manual trace on that source image, assigned `SCAPULA_LEFT`, and saved the trace as a manual finding—not model segmentation. Source hashes and normalized trace points are retained; the image itself is not persisted in browser storage.
- Reloaded the case in the final release, reselected the same original scapula image, and verified all three saved trace points restored only after exact source SHA-256 matching. Selecting the lower-leg image instead restored zero points and showed a source-mismatch warning. Image-derived skeletal links retain uncertain status after saving. The test session was disconnected and temporary browser-authentication helpers stopped/removed afterward.
- Validation evidence: 215 frontend unit tests passed; final targeted 18 tests, TypeScript, ESLint and production build passed after UI corrections. Backend agent reported 51 tests passed including actual pinned ONNX and offline OCR execution, followed by 30 targeted OCR/parser regression tests. These are software correctness checks, not clinical-validation metrics.

**Current conclusion:** digital/scanned written-document processing and human-reviewed anatomy visualization now execute, and the experimental X-ray model actually runs. The X-ray system is still **not reliably correct** on the supplied set; the report parser is conservative rule-based extraction, not comprehensive medical reasoning. The system must remain research-only with explicit reviewer confirmation. Approximate cracks remain manually positioned illustrations, not exact automatically inferred breaks. See [current usage](../README.md) and [backend model/OCR requirements](../server/README.md).

## Original audit verdict

| Module | Requested end-to-end verdict | What actually exists |
| --- | --- | --- |
| X-ray image → identified fracture → exact 3D finding | **Not working** | A guarded PNG/JPEG endpoint, a local YOLO adapter implementation, typed finding storage, and a separate working anatomy viewer. No configured runnable fracture model and no findings-to-viewer integration. |
| Written MRI PDF → extracted abnormalities → exact 3D finding | **Not working** | A plain-text JSON endpoint and a local token-classification adapter implementation. No PDF ingestion/OCR, no configured runnable NLP model, no entity-to-bone resolver, and no findings-to-viewer integration. |

**Direct answer:** uploading one of the supplied X-rays or MRI PDFs does not currently make VITRION understand the input and highlight that finding on the skeleton. The real skeleton works as a manually operated reference viewer. Its red selection is not evidence of AI analysis.

No predictions were produced for any supplied example. Consequently, anatomical accuracy, laterality accuracy, sensitivity, specificity, segmentation overlap, and hallucination rates cannot be calculated. Zero completed workflows is a functional result, not a measured 0% diagnostic accuracy.

## Audit method and boundaries

- Inspected the actual server adapters, input/output schemas, model configuration, case UI, model preview UI, anatomy registry, and renderer.
- Authenticated as an existing configured Radiologist using a short-lived locally generated token. Credentials were not included in this report or transmitted externally.
- Submitted all **10 original supplied PNGs** through the same frontend proxy used by the application, preserving their original bytes. Seven oversized originals were additionally tested as clearly identified, in-memory 640-pixel transport derivatives. Those derivatives were not substituted for original-resolution accuracy tests.
- Submitted all **4 original supplied PDF files** to the actual MRI endpoint as multipart uploads. Independently extracted their text with an audit-side PDF parser and submitted that text to the existing JSON endpoint to test the next boundary separately.
- Created one **in-memory raster-only derivative** of the synthetic cervical report to test an image-only PDF. No MRI scan images or MRI DICOM files were analyzed.
- Verified source-file SHA-256 hashes before and after testing: all 14 originals were unchanged. No original attachment was edited. Original image/PDF content was not saved into case records by these unsuccessful requests.
- Ran invalid-record probes against an isolated temporary database using the same application code, not against the running case database. Environment variables used for a missing-artifact readiness probe were changed only within the audit process and restored.
- Browser-tested manual left-scapula selection and its articulating-bone display; explicitly distinguished these controls from inference.

The four PDFs explicitly identify themselves as **fictional synthetic demonstration copies, not reports from actual MRI studies**. Their text is useful as a software reference but is not clinical validation. The PNGs include annotations, montages and embedded metadata. Their labels/filenames are not independently adjudicated ground truth, and anonymity labels alone do not establish full de-identification. No clinical correctness or authenticity was inferred from their appearance.

## Runtime and model availability

The live health response was:

```json
{
  "status": "ok",
  "mode": "local-synthetic-data-only",
  "clinicallyValidated": false,
  "radiologyConfigured": false,
  "mriConfigured": false
}
```

The running backend interpreter had Pillow and PyTorch available, but **Ultralytics, Transformers and Safetensors were not importable**. There was no configured, successfully loaded model for either module. A library being installed is not a trained diagnostic model.

The optional [model requirements](../server/requirements-models.txt) name Ultralytics 8.3.203, Torch 2.8.0, Transformers 4.57.1 and Safetensors 0.6.2. These are dependency specifications, not proof of active models. No active TorchXRayVision fracture model, Bio_ClinicalBERT/RadBERT task-trained checkpoint, model validation cohort, or benchmark result was demonstrated.

The three adapter unit tests passed, but [their implementations](../server/tests/test_model_adapters.py) replace the YOLO and Transformer models with test doubles and use mock weight bytes. They verify plumbing, artifact rejection and output contracts—not real image recognition or clinical language understanding.

## 1. X-ray image workflow

### Supplied-file execution results

`413` means the entire request exceeded the backend's 1 MiB limit. `503` means the local fracture model was unavailable; it does not mean that no fracture was found.

| Supplied PNG | Original bytes | Original upload result | Additional transport probe | Detection / bone ID / 3D result |
| --- | ---: | --- | --- | --- |
| Annotated Left Scapula Fracture X-rays.png | 1,651,527 | 413 | Downscaled derivative: 503 | None |
| Navicular Fracture X-ray Montage.png | 1,482,879 | 413 | Downscaled derivative: 503 | None |
| Panoramic X-Ray Showing Mandibular Fracture.png | 1,668,462 | 413 | Downscaled derivative: 503 | None |
| Dual-View Right Clavicle Fracture X-Ray.png | 1,675,490 | 413 | Downscaled derivative: 503 | None |
| Annotated AP Pelvis X-Ray Showing Left Fracture.png | 1,313,994 | 413 | Downscaled derivative: 503 | None |
| Annotated Chest X-ray Rib Fracture Study.png | 1,379,813 | 413 | Downscaled derivative: 503 | None |
| Diagnostic Skull X-Ray Fracture Montage.png | 1,611,272 | 413 | Downscaled derivative: 503 | None |
| Right Forearm Fracture X-Ray Study.png | 961,833 | 503 | Not required | None |
| Right Lower Leg X-ray Fracture.png | 760,362 | 503 | Not required | None |
| Right Hand X-Ray with Metacarpal Fracture.png | 905,333 | 503 | Not required | None |

All ten original PNGs were independently opened and verified. Direct execution of the adapter's image decoder also accepted their pixel data. This isolates the problem: these examples are not simply unreadable PNGs. However, the actual inference method loads the model **before** decoding the image, so the live 503 responses do not demonstrate that image decoding happened in the production request path.

### Stage-by-stage assessment

| Requirement | Actual result |
| --- | --- |
| Upload PNG/JPEG | Implemented as a transport interface, but the browser disables it while model configuration is absent. Direct authenticated uploads encountered the failures above. |
| Read valid image pixels | Decoder component works in isolation on all ten examples; complete inference requests stopped earlier. |
| Identify region and bone | No predictions. Adapter maps a predicted class to a static metadata `boneId`; no independently validated anatomy recognizer or catalog-membership check. |
| Detect/localize suspected fracture | Adapter has a real `YOLO(..., task="detect").predict(...)` execution path, but no usable configured weights. No actual detection was produced. |
| Segmentation | Not implemented. Detection boxes only; no mask schema or mask renderer. |
| Laterality and exact fracture location | No verified image-side-marker/OCR/orientation workflow. A class metadata bone ID could encode side, but that is not a demonstrated laterality inference system. |
| Multi-view montages | No panel splitting, projection reconciliation or study-level view association. The whole montage is passed as one image if inference is eventually configured. |
| Show image evidence | The preview renders labels/confidences/bone IDs as text. It does not render the uploaded image with detection boxes or segmentation masks. |
| Map output to 3D skeleton | Not wired. Accepted detections only update the case draft. |
| Highlight corresponding bone in red | Manual viewer selection works; AI-driven selection does not exist. |
| Show fracture location on bone | Not implemented. A normalized 2D box has no defined transform into the reference model's 3D coordinates. |
| Show surrounding bones | Manual curated articulation/region controls work, independently of any uploaded image. |
| Exact X-ray/3D correspondence | Not established. There is no patient/image registration, camera geometry or landmark-based localization. |

The adapter deliberately returns null displacement and AO/OTA classification. These are honestly unavailable, not completed measurements. Millimeters must not be inferred from arbitrary normalized boxes; annotated scale bars are not currently detected or calibrated.

## 2. MRI written-report workflow

### Supplied-file execution results

All four PDFs contain a usable digital text layer. Independent extraction is **audit tooling**, not a VITRION PDF feature.

| Supplied PDF | Pages / extracted characters | Reference statement in the supplied report | PDF upload | Independently extracted text submitted as JSON |
| --- | --- | --- | --- | --- |
| Raw_MRI_Report_Cervical_Spine_Fracture.pdf | 1 / 2,085 | Acute-appearing C6 compression fracture, approximately 20% height loss; no significant retropulsion/canal compromise/cord abnormality | 422 | 503 |
| Raw_MRI_Report_Nasal_Bone_Fracture.pdf | 1 / 2,188 | Findings suggestive of mildly displaced right nasal bone fracture; left nasal bone preserved; no definite additional acute osseous injury | 422 | 503 |
| Raw_MRI_Radiology_Report_T8_Thoracic_Fracture.pdf | 1 / 2,200 | Acute-appearing T8 compression fracture, approximately 25% height loss; negative canal/cord findings | 422 | 503 |
| Raw_MRI_Radiology_Report_L1_Lumbar_Fracture.pdf | 1 / 2,180 | Acute-appearing L1 compression fracture, approximately 35% anterior height loss; minimal posterior buckling, no significant retropulsion/high-grade canal compromise | 422 | 503 |

The PDF uploads failed because `POST /api/mri/extract` accepts **JSON `{reportText, caseId?}`**, not multipart PDF uploads. All text-only calls then failed because the local NLP model was unavailable. No report-specific abnormality, anatomical ID or visualization was returned.

The raster-only derivative of the cervical report contained **zero extractable text characters** and received the same 422 response. This was a synthetic scanned-document probe, not an actual scanned clinical report, and no OCR was performed by VITRION.

### Stage-by-stage assessment

| Requirement | Actual result |
| --- | --- |
| MRI PDF upload | Not implemented: no PDF input in the model UI, no PDF request schema/route. |
| Digital PDF text extraction | Not integrated. The audit's external parser could extract all four, but the app cannot ingest them. |
| Scanned PDF OCR | Not implemented. |
| Findings/Impression section processing | No section-aware extraction or provenance. Raw text would be passed to a token classifier. |
| Medical language understanding | No runnable model demonstrated. Planned adapter is token-classification/NER, not a deployed LLM reasoning workflow. |
| Bone, vertebral level, region, laterality | No validated anatomy resolver. MRI outputs explicitly set both `boneId` and `radlexId` to null. |
| Negation, uncertainty, acute/chronic status | No explicit assertion, temporality, laterality or anatomy–abnormality relation fields or postprocessor. Entity detection alone would not distinguish a normal left nasal bone from an abnormal right one. |
| Avoid invented findings | Extracted entity text is sliced from source offsets, a useful anti-fabrication constraint. It does not prove correct assertions, relationships or clinical interpretation, and could not be tested against a real model here. |
| Long reports | Adapter rejects reports beyond its model window, capped at 512 tokens; no chunking or section reconciliation. Actual token counts for these PDFs were not measured because no tokenizer was configured. |
| Map findings to anatomy | No output-to-registry crosswalk. Even a configured pipeline returns null bone IDs. |
| Save MRI-derived findings | UI displays entity text only. Unlike X-ray detections, MRI entities have no acceptance-to-case-findings action. |
| Highlight 3D findings | No MRI entity → case finding → viewer bridge. |
| MRI scan-image interpretation | Not performed in this audit or this text-only endpoint. The required written-report-only boundary was preserved. |

Useful acceptance checks for these reports would include: map C6/T8/L1 to those vertebrae; preserve “suggestive” for the right nasal finding; do not mark the normal left nasal bone as fractured; do not turn negative cord/canal findings into abnormalities; and do not turn L4–L5 disc desiccation in the L1 report into L4/L5 fractures. **None of these checks passed through an active model**, because none produced output.

## 3. Real skeleton and mapping audit

The installed manifest contains **208 mesh-node mappings covering 206 unique bone IDs**. Real geometry loaded in the browser. Example targets `SCAPULA_LEFT`, `NAVICULAR_LEFT`, `MANDIBLE`, `CLAVICLE_RIGHT`, `PELVIS_LEFT`, `C6`, `NASAL_RIGHT`, `T8` and `L1` exist. Other candidate hand/forearm/lower-leg structures also exist. Catalog availability is not evidence that the system selected the correct one.

Manual control test:

1. Entered `SCAPULA_LEFT` in the catalog search and selected it manually.
2. Activated “Show connected bones.”
3. Browser reported **3 visible · 206 loaded · 206 catalog bones**.
4. Screenshot showed the scapula in red with the humerus and clavicle as context.

This verifies manual ID-to-mesh selection and the supplied articulation graph for that example only. No input image/report caused the selection; no fracture line or fracture region was drawn. Generic anatomical meshes are not patient-specific anatomy. The graph is curated, not an exhaustive or measured spatial-neighbor model. Discs, spinal cord, and many soft tissues mentioned in MRI reports are not represented as bones and must not be mapped to a nearby bone merely to display something.

The source-label mapping is not a verified medical ontology crosswalk: the registry initializes FMA, TA2 and RadLex IDs to null and explicitly sets `clinicalVerification: false`.

## 4. Confirmed defects and missing integrations

### A. Upload size contract is inconsistent — reproduced

- [ModelWorkbench.tsx](../src/components/ModelWorkbench.tsx), line 49: advertises and accepts up to **10 MiB**.
- [middleware.py](../server/app/core/middleware.py), line 5: limits the **entire HTTP body** to **1 MiB**, including multipart overhead.
- [radiology_inference.py](../server/app/services/radiology_inference.py), line 87: independently limits image bytes to 1 MiB.
- Result: seven supplied original PNGs return 413 even though they satisfy the UI's stated limit.
- Required correction: agree one documented encoded-file/request/pixel budget across proxy, UI and API; account for multipart overhead and preserve meaningful clinical image fidelity.

### B. No configured runnable clinical models — reproduced

- [radiology_inference.py](../server/app/services/radiology_inference.py), lines 25 and 28: administrator-enabled local pinned YOLO weights and class manifest required.
- [mri_nlp.py](../server/app/services/mri_nlp.py), lines 25 and 28: local task-trained safetensors NER directory and pinned manifest required.
- [main.py](../server/app/main.py), lines 69 and 82: actual inference endpoints.
- Result: all requests that reach inference return `RADIOLOGY_UNCONFIGURED` or `MRI_NLP_UNCONFIGURED` with HTTP 503.
- Required correction: provide appropriately licensed task-trained models, runtime dependencies, verified labels/crosswalks, supported-body-region policy and independent validation. Do not replace these with fabricated outputs or a base language encoder.

### C. PDF ingestion/OCR/section provenance absent — reproduced and inspected

- [main.py](../server/app/main.py), line 82, and [MRIRequest](../server/app/schemas.py): JSON text only.
- [ModelWorkbench.tsx](../src/components/ModelWorkbench.tsx), line 27: sends existing case narrative text, not a PDF.
- Result: every original digital PDF and the raster-only derivative return 422.
- Required correction: bounded, isolated PDF parsing; OCR for image-only pages; page/section/span provenance; extraction-quality handling and safe rejection; report-only upload controls. Do not add MRI pixel interpretation.

### D. Clinical assertions and anatomy normalization absent

- [mri_nlp.py](../server/app/services/mri_nlp.py), line 12: only ANATOMY/RADLEX/LESION_GRADE/ALERT BIO labels.
- Same file, line 93: every output entity has null `boneId` and `radlexId`.
- [schemas.py](../server/app/schemas.py): no structured negation, certainty, temporality, laterality, vertebral-level normalization or evidence-linked abnormality relation.
- Required correction: source-grounded structured findings with assertions and relations; verified anatomy/ontology resolution; explicit unknown/ambiguous outcomes; independently tested negative and uncertain examples.

### E. Findings are not connected to the viewer

- [CaseWorkspace.tsx](../src/components/CaseWorkspace.tsx), line 132: accepted X-ray outputs only update unsaved case findings and `boneIds`.
- [ModelWorkbench.tsx](../src/components/ModelWorkbench.tsx), lines 57–58: X-ray acceptance and MRI text-list-only rendering.
- [Explorer.tsx](../src/components/Explorer.tsx), lines 54–55: selection and related structures derive from local anatomy preferences, not case findings.
- [SkeletonViewerProps](../src/lib/types.ts): no source image/report, finding IDs, fracture location or case overlay contract.
- Required correction: reviewed-finding-to-viewer state, validated catalog IDs, visible source evidence, explicit laterality, multi-finding selection and unknown handling. Manual review should not be bypassed.

### F. Exact 2D-to-3D fracture localization absent

- [radiology_inference.py](../server/app/services/radiology_inference.py), line 109: only normalized 2D bounding boxes.
- [SkeletonViewer.tsx](../src/components/SkeletonViewer.tsx), line 194: colors whole selected meshes.
- Required correction: an explicitly validated image-coordinate/landmark/registration strategy and uncertainty representation, or clearly label visualization as whole-bone localization only. A single projection does not uniquely specify a patient-specific 3D fracture location. Segmentation, projection context and patient/reference correspondence cannot be fabricated from a bone name.

### G. Unknown anatomy IDs accepted — reproduced in isolated API

A case with `boneIds: ["NOT_A_REAL_BONE"]` and a finding using that ID received **HTTP 201**. This ID has no skeletal mesh.

- [schemas.py](../server/app/schemas.py), lines 28 and 51: anatomy IDs are bounded strings, not catalog-validated identifiers.
- [radiology_inference.py](../server/app/services/radiology_inference.py): checks metadata strings and FMA formatting, not membership or semantic consistency with the skeletal catalog.
- [clinical.ts](../src/lib/clinical.ts): runtime parsing also only verifies strings for anatomy IDs.
- Required correction: one versioned authoritative registry and shared validation for model labels, findings, ontology mappings and rendered IDs.

### H. Backend/client bounding-box contracts conflict — reproduced

Isolated same-code API tests returned HTTP 201 for both `[0,0,2,3]` and `[0.5,0.5,0.5,0.5]`. The frontend rejects both.

- [schemas.py](../server/app/schemas.py), line 38: rejects negative/reversed corners but not coordinates above 1 or zero-area boxes.
- [clinical.ts](../src/lib/clinical.ts), line 38: requires finite [0,1] coordinates and strictly positive box area.
- Required correction: synchronize coordinate-space semantics and reject invalid/degenerate bounds before persistence or export. The server documentation currently describes caller image-space coordinates, while the frontend and requested inference contract require normalization.

### I. “Configured” health flag is not model readiness — reproduced

In an isolated process, setting nonempty paths/checksums to nonexistent files made both adapter `configured` properties true; execution still returned 503.

- [radiology_inference.py](../server/app/services/radiology_inference.py), line 25; [mri_nlp.py](../server/app/services/mri_nlp.py), line 25; [main.py](../server/app/main.py), line 52.
- [ModelWorkbench.tsx](../src/components/ModelWorkbench.tsx), line 18, uses those flags to enable processing controls.
- Required correction: distinguish declared configuration, artifact validation, dependency availability, loaded model, warm-up/self-test and clinical-validation status. Health must not imply successful inference.

### J. Evidence and audit linkage is incomplete for diagnostic verification

The inference result provides an artifact hash, and successful inference would append a metadata-only model event. However, case findings do not retain image/PDF source hashes, source-image dimensions/transforms, report page/section, evidence spans, assertion state, or a durable association with the model output artifact. MRI text offsets exist in transient preview results only. The 2D detection image itself is not shown with an overlay.

- [Finding](../server/app/schemas.py), [model_event](../server/app/main.py), [ModelWorkbench.tsx](../src/components/ModelWorkbench.tsx).
- Required correction: preserve privacy-conscious, access-controlled source/evidence identifiers and transform/provenance metadata with every reviewed finding; keep source content out of general audit logs.

## 5. Checks actually executed

| Check | Result | What it does not establish |
| --- | --- | --- |
| Ten original PNGs, live authenticated HTTP | 7 × 413; 3 × 503 | No inference accuracy result |
| Seven in-memory downscaled PNG transport probes | 7 × 503 | No original-resolution diagnostic result |
| Direct image decoder on all ten original PNGs | All decoded successfully | Does not run a fracture model |
| Four original PDF multipart uploads | 4 × 422 | No VITRION PDF extraction |
| Four independently extracted report texts | 4 × 503 | No medical NER/assertion result |
| Raster-only synthetic PDF derivative | 0 text characters; upload 422 | No OCR accuracy result |
| Invalid bytes labelled PNG | 503 | Model gate precedes decoding; does not prove malformed image accepted by a running detector |
| Wrong image MIME | 415 | MIME rejection only |
| Unknown bone ID / out-of-range box / zero-area box | Each accepted by isolated API with 201 | Confirms contract defects, not model predictions |
| Missing-artifact configuration probe | Both configured flags true; both loads 503 | Confirms readiness distinction |
| Adapter tests | 3 passed | Models and decoder are mocked in these tests |
| Frontend model-output, clinical/FHIR, real bone-registry tests | 14 passed | Contract/geometry validation, not clinical recognition |
| Browser manual scapula/context selection | Red scapula; 3 visible, 206 loaded | No image/report-driven highlight or fracture localization |

## 6. Required implementation order

1. Fix upload limits, shared schemas, unknown-ID rejection and truthful readiness reporting.
2. Implement written-PDF extraction/OCR with evidence provenance and appropriate error/quality states.
3. Configure task-trained validated models and approved anatomy/ontology mappings; explicitly define supported regions, ages, projections, montage handling and out-of-distribution rejection.
4. Implement negation/uncertainty/temporality/laterality and abnormality-to-anatomy relations; preserve source spans and avoid mapping negative or incidental references as fractures.
5. Add reviewed findings-to-skeleton integration, 2D source overlays and explicit whole-bone versus precise-location semantics. Do not imply patient-specific 3D localization without validated registration.
6. Run documented end-to-end regression sets including negatives, uncertain/contradictory wording, bilateral findings, wrong side markers, multiple injuries and unsupported inputs. Establish adjudicated ground truth before reporting clinical metrics.

**Completion criterion:** the actual uploaded file must yield a reproducible model result, source-grounded anatomical identity/assertion, reviewed mapping and matching final visualization. Neither a successful HTTP response nor a manually red bone satisfies that criterion. It was not achieved for any supplied example in this audit.
