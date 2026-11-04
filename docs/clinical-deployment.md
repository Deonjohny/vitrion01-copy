# Clinical deployment gates

This repository runs locally with synthetic data. It is not a HIPAA-certified product, an IHE ATNA-conformant system, or a clinically validated diagnostic device. Do not place PHI in the application, downloaded exports, test fixtures, browser storage, or development logs.

## Integration boundary

- The existing Next.js application remains at the repository root. The case UI is `/cases`; requests use the same-origin `/clinical-api` proxy to a loopback FastAPI service.
- Case storage and review authorization belong to the Python service. A client cannot grant itself a role by editing case JSON. Local tokens are issued offline by an administrator and are never stored in localStorage/sessionStorage.
- Each signed revision is a specific saved payload. Changes require a new revision and invalidate prior review. Two distinct radiologist subjects are required; two JWTs for the same subject are not two reviewers.
- FHIR export is a collection, not a transaction that automatically writes to a hospital FHIR server. It includes reference-resolved resources and reviewer provenance, not cryptographic clinician signatures. Organizations must choose their own identifier namespaces, terminology versions, target profiles, and receiving-system validation.
- A DICOM UID is a linkage identifier, not an image, an ingest pipeline, or evidence of de-identification.
- Anatomy models are reference geometry, not patient-specific geometry. A model-derived bounding-box length is not a population-standard bone length. Ontology identifiers require source-verified crosswalks.

## Requirements before PHI or clinical use

1. **Governance and intended use:** name clinical owners, define populations/modalities/body parts, complete legal/regulatory classification and risk assessment, and implement applicable medical-device quality processes.
2. **Clinical validation:** supply task-trained weights, immutable checksums, provenance and license; validate external representative cohorts, calibration, sensitivity/specificity, out-of-distribution handling, pediatric/adult limits, and human oversight. Base encoders are not trained entity extractors. Normalized boxes cannot establish displacement in millimeters without validated image calibration and measurement.
3. **Identity and access:** replace local shared-secret token issuance with managed identity, MFA, workforce provisioning/deprovisioning, short-lived audience-bound sessions, service identities, revocation, least privilege, and organization/case-level authorization. Assess emergency access and break-glass policy.
4. **Cryptographic operations:** TLS with managed certificates; managed KMS/HSM secrets, rotation and key-version migration; protected backups and recovery exercises. Field encryption does not encrypt every database column, filesystem metadata, or all exported information. Lost keys mean lost encrypted data.
5. **Audit durability:** independent append-only storage and protected checkpoints, authenticated forwarding, retention/access policies, clock synchronization, monitoring and alerting. Hash chaining alone cannot prevent truncation or a privileged complete rewrite. ATNA requires additional authenticated node/transport and standardized event integration.
6. **Infrastructure:** approved hosting and applicable BAAs, network segmentation, hardened images, patching, resource limits, dependency scanning, secure DICOM/PACS configuration, upload/decompression limits, and deployment-specific load/reliability tests.
7. **Privacy and operations:** minimum-necessary policies, patient rights, retention/deletion rules, export controls, incident response, breach handling, staff training, and access reviews. Pseudonymization alone is not HIPAA de-identification.
8. **Acceptance:** receiving-system FHIR profile/terminology validation, radiologist-reviewed anatomy mappings, accessibility and usability testing, independent security assessment, backup restore and disaster recovery approval.

## Regulatory and standards references

- [HHS HIPAA Security guidance](https://www.hhs.gov/hipaa/for-professionals/security/guidance/index.html)
- [IHE ATNA](https://profiles.ihe.net/ITI/TF/Volume1/ch-9.html)
- [FHIR R4 DiagnosticReport](https://hl7.org/fhir/R4/diagnosticreport.html)
- [FHIR R4 Observation](https://hl7.org/fhir/R4/observation.html)
- [OWASP cryptographic storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)

These are deployment acceptance criteria, not a statement that those criteria have been met.
