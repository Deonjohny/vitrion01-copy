# Local synthetic-data backend

**NOT CLINICALLY VALIDATED. SYNTHETIC DATA ONLY. No HIPAA certification or clinical production readiness is claimed. Do not enter real patient information, reports, images, or DICOM identifiers.** The explicit `LOCAL_NO_PHI_MODE=true` gate is an operator acknowledgement, not a PHI detector or legal compliance control.

## Run locally (PowerShell, Python 3.11)

From `E:\vition01\server`:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
$keys = .\.venv\Scripts\python -m scripts.local_auth keys | ConvertFrom-Json
$env:PHI_ENCRYPTION_KEY = $keys.PHI_ENCRYPTION_KEY
$env:JWT_SECRET = $keys.JWT_SECRET
$env:LOCAL_NO_PHI_MODE = 'true'
$env:JWT_ISSUER = 'local-orthopedic-demo'
$env:JWT_AUDIENCE = 'local-orthopedic-ui'
$env:LOCAL_USERS_JSON = '{"demo-rad-one":"Radiologist","demo-rad-two":"Radiologist","demo-researcher":"Researcher","demo-compliance":"ComplianceOfficer"}'
$env:DATABASE_URL = 'sqlite:///./data/platform.db'
$env:DEV_CORS = 'true'
$token = .\.venv\Scripts\python -m scripts.local_auth token --subject demo-rad-one --minutes 15
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

Keep keys private and persistent in an operator-controlled secret store; generating new encryption keys makes old records unreadable. The key-generation command prints independent random secrets only to its caller; no secrets are shipped or written automatically. Do not commit `.env`, tokens, keys, or database files. There is no unauthenticated token endpoint. Token minting requires access to the configured signing key and an explicitly registered subject. Mint separate tokens for the two configured Radiologists. Tokens last at most 60 minutes; default 15. Roles come **only** from the server's `LOCAL_USERS_JSON`, never browser payloads or JWT role claims. This is a local HS256 trust model, not production federation. Do not expose the service beyond loopback.

Swagger: `http://127.0.0.1:8000/docs`. Authorize using the minted bearer token. `/api/health` is unauthenticated and reports the synthetic-only/unconfigured status. All case data, exports, audit data and AI endpoints require authentication. Development CORS, when enabled, allows exactly `http://localhost:3000`; otherwise no CORS origins are enabled. The frontend's same-origin proxy forwards `/clinical-api/*` to `http://127.0.0.1:8001/api/*`; start this backend with `--port 8001` for that configuration. Do not put tokens in URLs or browser persistent storage.

### Restart from an ignored local environment file

After an operator explicitly configures `server\\.env`, `python -m scripts.run_local` (from `server`) loads its allowed settings and starts only on `127.0.0.1:8000`. Existing process environment values take precedence. This launcher does not create keys, enable synthetic mode, overwrite existing data, or mint credentials automatically. If port 8000 belongs to an unrelated service, leave it running and select another port:

```powershell
.\.venv\Scripts\python -m scripts.run_local --port 8001
```

The launcher defaults to 8000 and accepts only integer ports 1024–65535; the host remains fixed at `127.0.0.1`, with no arbitrary-host option. With the frontend proxy's current 8001 target, use `http://127.0.0.1:8001/docs` and `http://127.0.0.1:8001/api/health`. Do not stop unrelated processes to reclaim a port. `/api/session` safely identifies the authenticated subject/role, including configured ComplianceOfficer subjects, without loading clinical fields.

### Optional token-free local presentation

An operator can explicitly add `PRESENTATION_MODE=true` to the existing ignored `server\.env` before starting the owned backend on **8001**, with the frontend on **3001**. The launcher permits this setting; existing process environment values still take precedence. Preserve all other settings and secrets. `LOCAL_NO_PHI_MODE=true`, the independent encryption/signing keys, issuer/audience and configured users remain mandatory. Missing, `false`, or any value other than exact lowercase `true` leaves the normal JWT-only mode enabled. Never use real patient data, and do not expose either service beyond loopback.

Presentation mode selects the fixed absolute **`server\data\presentation.db`**, independently of the working directory and normal `DATABASE_URL`; it never imports normal workflow records. Startup rejects a normal SQLite URL pointing to that same file, including resolved aliases and hard links; SQLite `file:` URI URLs are rejected in this mode to keep isolation unambiguous. Reserve this file for synthetic presentations only. The existing encryption key protects its fields; do not regenerate or overwrite secrets. Removing the flag or setting it to `false` restores the normal database and JWT requirements at the next startup.

A token-free request is accepted only when **no Authorization header** is supplied, its client address is `127.0.0.1` or `::1`, and its single Host names `127.0.0.1`, `localhost`, or `[::1]` (optionally with a valid port). Origin must be absent for local CLI access or exactly `http://127.0.0.1:3001` / `http://localhost:3001`; `Origin: null`, unrelated origins, duplicate headers and `Sec-Fetch-Site: cross-site` are rejected with 403. Use the frontend's same-origin proxy; this does not enable additional CORS origins or trust forwarded host/client headers. Do not configure a public proxy into this local-only mode.

Accepted requests use the restricted synthetic principal `local-presentation` with role `Radiologist`. Case list/create/read/update, existing diagnostic uploads and export retain their authentication dependencies and validation. **Signing and amending reviews return 403 for this principal**: a presentation cannot stand in for either independent configured reviewer. Compliance-only audit access remains forbidden. A valid supplied JWT still identifies its configured subject/role and accesses only the presentation database while this mode is active; malformed, empty or invalid credentials return 401 rather than falling back to presentation access. No token-issuance endpoint or browser-persisted credential is introduced.

The presentation session response is `{"subject":"local-presentation","role":"Radiologist","presentationMode":true}`. JWT sessions retain `{"subject":"configured-subject","role":"configured-role"}` for compatibility: `presentationMode` is an optional Boolean defaulting to `false`, omitted when false. These responses are `Cache-Control: no-store` and contain no keys or clinical content.

### Compose

From the repository root, copy `server\.env.example` to `server\.env`; fill the two keys, issuer, audience and subject-role JSON explicitly, and set `LOCAL_NO_PHI_MODE=true` only for synthetic data. Environment files are not automatically loaded by the offline CLI; for local CLI usage export those same values into the invoking shell. Containers receive the file via Compose.

```powershell
Copy-Item server\.env.example server\.env
# Fill server\.env with the same operator-controlled values before running.
docker compose up --build -d backend
docker compose exec backend python -m scripts.local_auth token --subject demo-rad-one --minutes 15
```

Compose binds only `127.0.0.1:8000`, uses a named SQLite data volume, a non-root read-only container, and no bundled keys. Save the encryption key outside the container before using persistent data. Startup fails for missing/empty security configuration or absent explicit synthetic-mode acknowledgement. `docker compose down` retains the data volume; `down -v` destroys it. Docker execution must be verified on a host with Docker available.

## API and DTO

| Endpoint | Allowed role(s) |
| --- | --- |
| `GET /api/health` | Public |
| `GET /api/session` | Authenticated subject/role; optional `presentationMode` Boolean defaults to false |
| `GET /api/cases` | Radiologist, Researcher |
| `POST /api/cases` | Radiologist |
| `GET /api/cases/{id}` | Radiologist, Researcher |
| `PUT /api/cases/{id}` | Radiologist |
| `POST /api/cases/{id}/sign` | Configured Radiologist JWT; presentation principal forbidden |
| `POST /api/cases/{id}/amend` | Configured Radiologist JWT; presentation principal forbidden |
| `GET /api/cases/{id}/export` | Radiologist, Researcher |
| `GET /api/audit/verify`, `GET /api/audit/events` | ComplianceOfficer |
| `POST /api/radiology/infer`, `POST /api/mri/extract` | Radiologist |
| `POST /api/radiology/experimental` | Radiologist; research-only, not clinically validated |
| `POST /api/mri/report`, `POST /api/mri/report-text` | Radiologist |

ComplianceOfficer cannot list, fetch or export cases. Researcher can read/export **the same synthetic-only case fields** but cannot modify or sign. This is not a production deidentification policy. Audit metadata contains configured operator IDs, case UUIDs, revisions and actions, never report text, patient pseudo-ID, DICOM UID or amendment reason. Application access logging is disabled in the documented commands; configure reverse-proxy logging without bodies or Authorization headers.

`GET /api/cases` returns a JSON **array**, not a wrapper; `limit` defaults to 100 (maximum 100), `offset` defaults to 0. Audit events use the same bounded pagination.

Create body: `{patientPseudoId, dicomSeriesInstanceUid, reportText, modality, boneIds, findings}`. PUT replaces those editable fields and additionally requires integer `expectedRevision`; send the full editable object. Never send server-owned `id`, state, revision, signatures or timestamps in a write body. Unknown fields, including roles, are rejected. Optional editable fields default to empty collections/text or null when omitted.

Response: `{id, patientPseudoId, dicomSeriesInstanceUid, reportText, modality, boneIds, findings, state, revision, signatures, createdAt, updatedAt}`. `id` is a UUID; modality is `XR|MR|CT|OT`; state is `PRELIMINARY|VERIFIED|AMENDED`; timestamps are ISO UTC. A signature is `{reviewerId, revision, signedAt}`. Findings are `{id, boneId, fmaId, label, confidence, boundingBox, displacementMm, aoOtaCode, radlexId}`. Nullable fields return null. Bounding boxes are normalized `[ymin,xmin,ymax,xmax]` in [0,1] with strictly positive area, not physical measurements. `boneIds` and nullable `Finding.boneId` must belong to the packaged canonical `app/data/bone-ids.json` catalog. Optional nullable `reportEvidence` preserves source hash, method, assertion, temporality, laterality and the exact source evidence span; it is reviewer-supplied provenance, not independently authenticated clinical truth. Confidence must be finite in [0,1]; displacement is finite/nonnegative. User-entered ontology IDs, measurements, labels and classifications are not validated clinical predictions or verified ontology mappings.

A new case starts at revision 1/PRELIMINARY. Sign body: `{"expectedRevision":1}`. Findings must be nonempty. Two **distinct, server-configured Radiologist subjects** must sign the same revision to reach VERIFIED. A repeated subject cannot provide both signatures. Signing does not increment the content revision. Meaningful edits increment the revision and invalidate all signatures; a byte-equivalent structured no-op preserves revision/signatures. Stale revisions return 409. Verified content cannot be edited until explicit amendment: `{"expectedRevision":1,"reason":"Synthetic correction reason"}`. Amendment increments revision, encrypts the reason and clears signatures, entering AMENDED. Further changes increment revision; two fresh signatures verify the amended content. These are authenticated workflow attestations, not legally qualified digital signatures or clinical validation. The current amendment reason is retained encrypted; this local implementation does not retain a full historical report/reason archive.

Export returns the freshly authorized **same case DTO**, with an explicit committed `EXPORT` ledger event. Client-side FHIR construction is outside this service. Successful CREATE/LIST/ACCESS/EXPORT/UPDATE/SIGN/VERIFY/AMEND and compliance access are audited transactionally. Failed/denied operations roll back and are not appended to this ledger; a production denied-access security log is not implemented. Audit verification returns `{valid, entries, checkedEvents, firstInvalidSequence}` (`entries` and `checkedEvents` count the same checked snapshot); the snapshot excludes the verification event appended after a successful check. Invalid chains return `valid:false` without appending a verification event.

## Encryption, persistence and audit limits

AES-256-GCM protects each pseudo-ID, DICOM UID, report-text, bone-ID list, findings collection and amendment-reason storage field. Every write has a fresh random 12-byte nonce; authenticated associated data binds ciphertext version, case UUID and field name. Clinical finding content is encrypted as a collection, not searchable plaintext. UUIDs, modality, workflow metadata, reviewer IDs and timestamps remain plaintext. This is field encryption, not whole-database encryption. Protect disk permissions, keys, backups and metadata separately; there is no key rotation or recovery service.

SQLite uses `BEGIN IMMEDIATE` for serialized audited transactions. PostgreSQL uses a row lock on the persistent ledger-head singleton **before** case access/mutation, ensuring revision checks, signatures and SHA-256 chain appends share one transaction across workers. The deliberate global lock prioritizes local correctness over throughput. Audit UPDATE/DELETE are blocked by database triggers; PostgreSQL TRUNCATE is also blocked. Verification detects modified events, sequence gaps and trailing deletion relative to the persisted head. An unkeyed hash chain cannot prove integrity against a privileged attacker who can rewrite the entire database, triggers and head, nor detect rollback of an entire matching database snapshot. Independent signed checkpoints, immutable off-host retention, least-privilege migrations and external monitoring are not implemented.

SQLite data defaults to `server\data\platform.db` when run from `server`. PostgreSQL-ready SQLAlchemy configuration uses `postgresql+psycopg://USER:PASSWORD@HOST:5432/DATABASE` in `DATABASE_URL`; provision the database separately. Initial schema/trigger creation needs DDL permissions. The supplied Compose intentionally runs SQLite only. PostgreSQL execution, migration management and multi-host production operation have not been validated here.

## AI boundaries and request limits

`/api/radiology/infer` defaults to **503** when its model is unconfigured. Direct text endpoints `/api/mri/extract` and `/api/mri/report-text` are **disabled (410)** under the PNG/PDF-only input policy and omitted from OpenAPI. Internal Transformers/text-extraction utilities remain available for tests and processing of extracted document text, but are not alternative user inputs. Actual opt-in local YOLO and Transformers token-classification adapters are implemented. No weights are bundled or automatically downloaded; there is no remote inference. Install `requirements-models.txt` **only in an isolated virtual environment**, not a shared/global Torch environment. Set `LOCAL_MODELS_ENABLED=true` only after installing trusted task-specific artifacts and the metadata/pins described below. Local operator training/validation attestations do not establish clinical validity. Generic chest-X-ray classifiers, generic BERT embeddings and guessed measurements/AO classes are not substitutes.

Radiology accepts multipart `file` (**PNG only**) and optional `caseId` UUID. All image/PDF routes require the correct extension, exact MIME type (`image/png` or `application/pdf`) and file signature; renamed JPEG/DOCX/DICOM files and mismatched formats are rejected. PNG decoding also checks the actual image format. It returns `{modelSha256,detections:Finding[]}` using the unchanged case Finding DTO. Boxes are **normalized** `[ymin,xmin,ymax,xmax]` in [0,1] for this inference response. Review-only output is never silently persisted or signed. Physical displacement and AO/OTA codes remain null: pixel boxes are not calibrated measurements. Image files are at most 10 MiB, with a separate 12 MiB multipart request budget, 16 million pixels, 8192 pixels per edge and one frame. Pillow format/decompression checks run before model prediction. Filenames are never used as paths, and prediction does not save images/results.

The former `/api/mri/extract` JSON interface is disabled; submit a PDF to `/api/mri/report` instead. The retained internal token-classification adapter operates on written text only, not MRI pixels or DICOM. It returns `{modelSha256,entities:[{text,start,end,label,score,radlexId,boneId}]}`. Labels are `ANATOMY`, `RADLEX`, `LESION_GRADE`, `ALERT`; offsets index the original text, score is a finite probability, and identifiers stay null without a separate validated entity-linking step. Reports exceeding the model token window (at most 512 tokens including special tokens) return 413 rather than being silently truncated. Both routes require Radiologist, validate optional case existence, and append a `MODEL_INFER` event containing task, model/manifest checksums and optional case UUID/revision, **never** text, detections or image bytes. No case content or signatures change. Health configured flags require explicit configuration, existing artifacts and importable dependencies, but do not establish successful loading, valid pins or clinical validation; missing dependencies, bad pins and unsupported schemas fail closed with 503. HTTP bodies, including chunked bodies, are bounded before parsing: 12 MiB for PDF/image upload endpoints and 1 MiB otherwise. Reports are limited to 100,000 characters, findings/bone IDs to 256 entries; pseudo-IDs to 256 characters. Unconfigured radiology does not decode, save or claim to analyze uploads; no DICOM decoder or untrusted model-file loader is enabled. These limits are not a full network denial-of-service defense. There is no rate limiter, request-timeout gateway, malware scanning or PHI classifier.

### Configure trusted model artifacts

All artifact paths must be absolute local paths; do not use URLs. Leave the model fields empty/disabled in `.env.example` by default. `scripts.run_local` accepts these explicitly configured settings.

- **YOLO:** set `YOLO_WEIGHTS_PATH` to trusted task-trained `.pt` weights, `YOLO_WEIGHTS_SHA256` to their SHA-256, `YOLO_METADATA_PATH` to a local JSON manifest, and `YOLO_METADATA_SHA256` to its SHA-256. `.pt` deserialization can execute code: only independently trusted administrator-controlled weights are allowed, never uploads or downloaded-on-demand files. The manifest requires `task:"fracture_detection"`, `taskTrained:true`, nonempty `modelName`, `trainingReference`, `validationReference`, and `labels`. `labels` maps every numeric class index string to `{className,label,boneId,fmaId,ontologyVerified:true,ontologySourceReference}`. Class names/indices must exactly match the loaded model; bone/FMA mappings must be independently verified by the operator, with `fmaId` in `FMA:<digits>` form. The service never invents mappings and does not independently certify the operator's ontology verification. YOLO loads lazily and runs CPU-only, without output saving or automatic dependency installation.
- **MRI:** set `MRI_MODEL_DIR` to a self-contained local fine-tuned token-classification checkpoint directory and `MRI_MANIFEST_SHA256` to the SHA-256 of its `model_manifest.json`. The manifest requires `task:"mri_token_classification"`, `taskTrained:true`, `modelName`, `trainingReference`, `validationReference`, `entityTypes:{"ANATOMY":"anatomy","RADLEX":"radlex","LESION_GRADE":"lesionGrade","ALERT":"alert"}`, and `files` mapping **every other file's relative name to SHA-256**. Include config, tokenizer artifacts, safetensors weights, and shard indices. Weights must be safetensors; pickle/bin/python artifacts, symlinks, unpinned files and unpinned shard references are rejected. `config.json` must identify a `ForTokenClassification` architecture with exactly `O` plus B-/I- BIO labels for all four entity types. Generic `LABEL_0` classifiers and base Bio_ClinicalBERT checkpoints are rejected. Tokenizer/model loading explicitly sets `local_files_only=True`, `trust_remote_code=False`, and model `use_safetensors=True`; model libraries are imported only on first enabled inference. Offline/telemetry-disabled flags are set before import.

Compute file pins with PowerShell `Get-FileHash -Algorithm SHA256 <local-file>`; store those configuration pins under operator change control. The MRI model checksum is the pinned manifest checksum, which transitively authenticates every included artifact. No actual trained weights were supplied, so real-model accuracy/execution cannot be validated by this repository's mocked adapter tests. Administrators must secure the artifact directories against modification; checksums do not defend against a privileged operator rewriting both artifacts and trusted configuration.

### Optional local Orthanc

The **separate** `server\\compose.orthanc.yaml` does not affect normal root Compose startup. Set `ORTHANC_IMAGE` to a reviewed Orthanc image pinned by digest, and explicitly provide a username and a strong password in `ORTHANC_USERNAME`/`ORTHANC_PASSWORD`; then run `docker compose -f server\\compose.orthanc.yaml up -d`. Missing values fail closed. The REST port is published only at `127.0.0.1:8042`; authentication is enabled, the DICOM network listener is disabled, and persistence uses a named volume. Do not use quote/control characters in the credentials because they are interpolated into registered-user JSON. This is local HTTP, **not TLS**, not a PHI-ready PACS, and not automatically connected to this backend. Docker/Orthanc execution has not been validated on this host.

## Tests

```powershell
Set-Location E:\vition01\server
.\.venv\Scripts\python -m pytest
```

Tests cover ciphertext tampering/field-case binding, nonce randomness, fail-closed configuration, JWT claims and server-side roles, encrypted persistence, DTO/OpenAPI shape, export auditing, dual signatures, edits/amendment/stale revisions, concurrent changes/signatures/audit appends, restart persistence, audit edits/deletion and rollback, unconfigured AI and body limits. Test database fixtures live only in `server\tests\_runtime` and are removed afterwards. Tests use synthetic fixtures and do not require actual secret configuration. No clinical accuracy claim can follow from these software tests.


## Bounded written MRI report extraction (not image interpretation)

`POST /api/mri/report` accepts multipart `file` (PDF only) and optional UUID `caseId`. Pasted/JSON report input is disabled: `/api/mri/report-text` and `/api/mri/extract` return 410. The PDF route requires Radiologist (or the explicitly enabled loopback synthetic presentation principal), checks optional case existence, returns review-only drafts and does not change cases/signatures. PDF/text bytes are not persisted automatically; successful `REPORT_EXTRACT` ledger events contain only operator/case metadata and `{method,codeSha256,sourceSha256}` provenance, never filenames/text/findings. Saving a reviewed case remains an explicit separate operation. Hashes are linkable metadata, not deidentification.

The response is `{method:'rule-based-report-extraction',clinicallyValidated:false,sourceSha256,pages:[{page,text,extraction:'digital'|'ocr'}],findings:[{id,boneId,label,evidence:{page,section,text,start,end},assertion:'present'|'absent'|'uncertain',temporality:'acute'|'chronic'|'unspecified',laterality:'Left'|'Right'|'Midline'|'Unspecified',reviewRequired:true}],warnings}`. PDF source hash covers original bytes; paste source hash covers UTF-8 text. Evidence offsets count Python Unicode codepoints in the exact returned page text (not JavaScript UTF-16 units). Page numbers are one-based. Null anatomy is deliberately unresolved. No ontology IDs, confidence, measurements, fracture geometry or classification are fabricated.

Digital PDFs use local pypdf. Blank/image-only pages use local PyMuPDF grayscale rendering, with local Tesseract English OCR when installed or the optional pinned wheel-bundled RapidOCR CPU engine otherwise. Tesseract must be on PATH with English language data; no runtime model/binary download occurs. OCR subprocesses use stdin/stdout, never uploaded filenames or a shell. Missing OCR returns explicit 422/503; failed/empty OCR is not a successful empty analysis. Docker includes PDF libraries but does not install Tesseract or optional RapidOCR; OCR is unavailable unless deliberately provisioned. Health exposes `reportPdfAvailable`, `reportOcrAvailable`, `reportExtractionMethod`; OCR readiness requires PDF libraries plus either the Tesseract executable or the pinned RapidOCR version, dependencies and all three checksum-verified local models. Tesseract executable presence cannot certify installed language data. Missing language data fails explicitly on use.

PDF parsing/rendering runs in a separate Python process, bounded by a 60-second parent timeout, maximum 10 pages, 10 MiB PDF bytes, 40 million total OCR-rendered pixels and 200,000 extracted characters. A 12 MiB transport budget accommodates multipart overhead. Malformed/encrypted/over-limit files fail with 422 (byte oversize 413). The parser never executes embedded PDF JavaScript or external actions. These bounds are not a comprehensive adversarial-parser sandbox or network rate limiter.

The engine is deterministic pattern matching, **not an LLM, validated NLP, diagnosis or MRI/DICOM pixel interpretation**. It recognizes explicit fracture words in Findings/Impression/Conclusion (or unsectioned text), local negation/uncertainty and acute/chronic words, uppercase vertebral IDs and sided nasal bones. Pulse-sequence T1/STIR and disk levels are not fracture anatomy. Other anatomy, pronoun/coreference and ambiguous/multiple-anatomy sentences may remain unresolved or be missed; detailed assertion scope is limited. Never treat an empty result as a normal examination. Negative drafts must not mark fractures; uncertain drafts must remain explicitly uncertain. Every output and OCR transcription requires qualified human review against the source. No clinical accuracy is claimed.

`python -m pytest -q` covers generated PDFs, assertions, evidence offsets, upload authorization/audit, limits, OCR-unavailable behavior, registry equality and existing workflows. Tests do not depend on private/local sample documents.


## Optional research-only fracture detector (ONNX)

This is a **separate experimental endpoint**, not a configured clinically validated or bone-aware radiology model. `/api/radiology/infer` and its `radiologyConfigured` flag remain independent. No clinical validity, diagnosis, exact fracture line, 3D crack localization, anatomy classification or laterality inference is claimed.

Provision only into the isolated server environment, from `E:\vition01\server`:

```powershell
.\.venv\Scripts\python -m pip install -r requirements-experimental.txt
.\.venv\Scripts\python -m scripts.provision_research_detector
# Subsequent offline verification, without redownloading:
.\.venv\Scripts\python -m scripts.provision_research_detector --verify-only
.\.venv\Scripts\python -m pytest -q
```

The explicit provisioner downloads only `best.onnx` from public Hugging Face repository `Jesteban247/yolo11-fracture-onnx`, pinned revision `8227dbcdcf80f3cd06f052a8295ee42657989deb`. It bounds the artifact to 32 MiB, verifies SHA-256 `5f16fff48dc54a5ca2b4c625a8df4d55c2beaef18b202fc8dba6e1117a112686`, and writes runtime `provenance.json` and `LICENSE-WARNING.txt` beside the model. No pickle is loaded and no model is downloaded at application startup or per request. The current pinned file is 10,604,520 bytes. Existing mismatched artifacts are rejected, not silently overwritten. The fixed runtime location is `server\data\models\research-fracture\best.onnx`; no additional environment settings are required. Runtime artifacts are not source bundles or clinical approval evidence.

**License conflict:** the hosting card declares MIT, while the embedded ONNX graph declares **AGPL-3.0** and links to `https://ultralytics.com/license`. Do not assume the card's MIT covers the weights or upstream software. Resolve all applicable obligations before redistribution, deployment or commercial use. License references and the conflict are preserved in local provenance and every inference response. The reported training/benchmark claims are not independently validated clinical performance.

The app initializes the optional local CPU session once during startup, checking artifact SHA, graph domains/resources, class/task metadata and tensor input contract. If this fails the normal report/case service still starts, but `experimentalRadiologyAvailable` is false. The flag indicates cached artifact/runtime readiness, **not** clinical validity or accuracy; all health responses retain `clinicallyValidated:false`. Restart after provisioning to refresh startup readiness. OCR availability remains independent and is not enabled by installing ONNX dependencies.

`POST /api/radiology/experimental` requires Radiologist and accepts JPEG/PNG multipart `file` plus optional existing-case UUID `caseId`. File maximum is 10 MiB, total request 12 MiB, one frame, 16 million decoded pixels and 8192 pixels per edge. Pillow safely checks/decompresses; the adapter letterboxes to 640?640, executes the pinned ONNX on CPU, checks finite output and applies deterministic NMS. Unsupported inputs/invalid results fail explicitly. It returns `{modelSha256,detections,method:'experimental-onnx-fracture-detector',clinicallyValidated:false,sourceSha256,imageWidth,imageHeight,warnings}` without stripping the research warnings. Detection `boneId`, ontology IDs and measurements remain null; normalized boxes identify only suspected image regions. Scores are not calibrated diagnostic probabilities. Empty detections **do not** imply a clinically normal image or exclude injury. There is no remote inference or automatic storage of uploaded image bytes, filenames or findings.

Successful requests append existing `MODEL_INFER` metadata with task and pinned model/manifest hashes; neither image data nor filenames are logged in this ledger. Optional case association does not edit or sign a case. A reviewer must independently confirm a detection and assign catalog anatomy before visualization. Case Findings optionally accept nullable `imageEvidence:{sourceSha256,modelSha256,method:'experimental-onnx-fracture-detector',imageWidth,imageHeight,reviewerAssignedAnatomy:true}` to preserve the source and explicit reviewer mapping; hashes are 64 lowercase hex characters and dimensions are positive integers. This provenance is supplied by the authenticated reviewer and is not a server certification of diagnosis or mapping accuracy.

The suite includes **actual pinned ONNX CPU execution** on generated blank landscape/portrait images and through the authenticated endpoint, validating input letterboxing, output bounds, exact source hashes, readiness and retained warnings. It separately tests NMS, file/request limits, authorization, audit metadata and provenance roundtrips. Real-runtime tests explicitly skip if the optional pinned artifact/dependencies are absent; API-envelope unit tests use mocks and are not evidence of model accuracy. These tests establish execution contracts only, not clinical sensitivity/specificity or usefulness on injured radiographs.


### Optional scanned-report OCR, entirely local

Install only into the isolated server environment:

```powershell
.\.venv\Scripts\python -m pip install -r requirements-ocr.txt
.\.venv\Scripts\python -m pytest -q
```

Restart the backend after provisioning. `rapidocr-onnxruntime==1.4.4` includes detection, recognition and orientation ONNX weights **inside its wheel**. The adapter explicitly uses those local paths, checks their fixed SHA-256 hashes and selects CPU-only providers (CUDA/DML disabled). It does not fetch models at first use. Package source was inspected for download behavior; an actual initialization/transcription test additionally blocks socket connections and succeeds offline. Model hashes, upstream URLs and license references are preserved in `app\data\ocr-provenance.json`; the package and referenced RapidOCR/PaddleOCR repositories declare Apache-2.0. Preserve notices and review bundled-artifact obligations before redistribution. The experimental fracture graph's separate AGPL/MIT conflict is unchanged.

Tesseract remains preferred when present. Otherwise blank/image-only written-report pages use RapidOCR within the **same 60-second isolated PDF process**, 10-page/10-MiB file and 40-million-rendered-pixel limits. No MRI/DICOM pixels are interpreted. Missing optional models/dependencies, empty transcription and low-confidence transcription fail explicitly, not as an empty normal result. A multi-character recognized line scoring below 0.75 rejects the page with `REPORT_OCR_LOW_CONFIDENCE`; this avoids silently dropping potentially important negation/anatomy. Isolated low-confidence one-character regions are retained verbatim with an explicit warning rather than causing otherwise readable scanned pages to fail on tiny scan artifacts. Pages with no reliably recognized regions still fail. Recognition scores are not clinical accuracy, and even high-confidence wrong text is possible. Successful OCR responses retain `extraction:'ocr'`, exact page-text evidence offsets and warnings naming the local engine and requiring source review. Core package installation without OCR dependencies still supports digital PDFs. There is no pasted-text fallback in the upload-only interface.

Regression tests execute the actual wheel-bundled OCR models on a generated raster-only document containing **C6 acute fracture** and **suspected T8 fracture**, verifying both extracted assertions and exact evidence offsets; they are not mocks. Optional actual OCR tests skip explicitly if local models are absent. This verifies execution on clear synthetic printed text, not clinical OCR accuracy on arbitrary scans or handwriting.

### Reviewer-drawn image trace provenance

A Finding additionally accepts optional nullable `manualImageEvidence:{sourceSha256,method:'reviewer-drawn-fracture-trace',imageWidth,imageHeight,points,reviewerAssignedAnatomy:true}`. The source digest is 64 lowercase hex characters, dimensions are positive integers, and `points` contains 2?64 normalized `[x,y]` pairs in [0,1] with at least two distinct positions. Existing positive-area normalized bbox validation remains enforced when a bbox is supplied. This is explicitly human-drawn review evidence, **not** model-predicted crack segmentation, proof of fracture or patient-specific 3D localization. Evidence persists only on an explicit authorized case save.

Research detector evaluation must remain honest: a local ten-original-image check reported missed skull, lower-leg and clavicle cases and off-target boxes among other outputs. This is not a validated benchmark, but it is concrete evidence against claiming reliable detection. The experimental route remains research-only; no predictions are automatically mapped to anatomy or promoted to clinical truth.
