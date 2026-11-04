import { describe, expect, it, vi, afterEach } from "vitest";
import { clinicalRequest, isFinding, parseAuditVerification, parseCase, parseClinicalSession, type CaseRecord } from "../src/lib/clinical";
import { fhirDiagnosticReport } from "../src/utils/fhirDiagnosticReport";

const caseId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const findingId = "4fa85f64-5717-4562-b3fc-2c963f66afa6";
const record: CaseRecord = {
  id: caseId, patientPseudoId: "SYNTHETIC-001", dicomSeriesInstanceUid: null, reportText: "Synthetic research finding only.", modality: "XR", boneIds: ["FEMUR_LEFT"],
  findings: [{ id: findingId, boneId: "FEMUR_LEFT", fmaId: null, label: "Synthetic finding", confidence: null, boundingBox: null, displacementMm: null, aoOtaCode: null, radlexId: null }],
  state: "PRELIMINARY", revision: 1, signatures: [], createdAt: "2026-11-04T10:00:00Z", updatedAt: "2026-11-04T10:00:00Z",
};
const options = { identifierSystem: "http://localhost/synthetic-patients", reviewerIdentifierSystem: "http://localhost/reviewers" };
afterEach(() => vi.unstubAllGlobals());
describe("clinical API contract", () => {
  it("checks authenticated roles and does not claim invalid audit chains are verified", () => {
    expect(parseClinicalSession({ subject: "reviewer-1", role: "Radiologist" }).role).toBe("Radiologist");
    expect(() => parseClinicalSession({ subject: "reviewer-1", role: "Admin" })).toThrow();
    expect(parseAuditVerification({ valid: true, entries: 3 })).toEqual({ valid: true, entries: 3 });
    expect(() => parseAuditVerification({ valid: false, entries: 3 })).toThrow();
    expect(() => parseAuditVerification({ valid: true, entries: -1 })).toThrow();
  });
  it("accepts the strict backend DTO and rejects missing or invalid clinical fields", () => {
    expect(parseCase(record)).toEqual(record);
    expect(() => parseCase({ ...record, findings: [{ ...record.findings[0], confidence: 2 }] })).toThrow();
    expect(() => parseCase({ ...record, id: "wrong" })).toThrow();
    expect(() => parseCase({ ...record, revision: 0 })).toThrow();
    expect(() => parseCase({ ...record, createdAt: "not-a-date" })).toThrow();
    expect(() => parseCase({ ...record, reportText: undefined })).toThrow();
    expect(() => parseCase({ ...record, findings: [{ ...record.findings[0], displacementMm: -1 }] })).toThrow();
  });
  it("requires finite ordered normalized ymin,xmin,ymax,xmax bounds", () => {
    expect(isFinding({ ...record.findings[0], boundingBox: [0.1, 0.2, 0.8, 0.9] })).toBe(true);
    for (const boundingBox of [[0.8, 0.2, 0.1, 0.9], [0, 0, 2, 1], [0, NaN, 1, 1], [0, 0, 0, 0]]) {
      expect(isFinding({ ...record.findings[0], boundingBox })).toBe(false);
    }
  });
  it("uses bearer authentication, no cache, and no ambient credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => record }); vi.stubGlobal("fetch", fetcher);
    await clinicalRequest(`/cases/${caseId}`, "short-lived-token");
    expect(fetcher).toHaveBeenCalledWith(`/clinical-api/cases/${caseId}`, expect.objectContaining({ cache: "no-store", credentials: "omit", redirect: "error", headers: { Authorization: "Bearer short-lived-token" } }));
  });
  it("omits Authorization entirely for server-enabled local presentation sessions", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ subject: "local-presentation", role: "Radiologist", presentationMode: true }) }); vi.stubGlobal("fetch", fetcher);
    const identity = parseClinicalSession(await clinicalRequest("/session", ""));
    expect(identity.presentationMode).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("/clinical-api/session", expect.objectContaining({ credentials: "omit", headers: {} }));
    expect(() => parseClinicalSession({ subject: "local-presentation", role: "Radiologist", presentationMode: "true" })).toThrow();
  });
  it("does not expose backend error payloads containing clinical text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: "PRIVATE REPORT" }) }));
    await expect(clinicalRequest("/cases", "token")).rejects.toThrow("submitted values failed");
  });
});
describe("FHIR R4 report collection", () => {
  it("resolves every result and subject reference within the bundle", () => {
    const bundle = fhirDiagnosticReport(record, options);
    const urls = new Set(bundle.entry.map((entry) => entry.fullUrl));
    const report = bundle.entry.find((entry) => entry.resource.resourceType === "DiagnosticReport")!.resource;
    if (report.resourceType !== "DiagnosticReport") throw new Error("Missing report");
    expect(report.code.coding?.[0].code).toBe("18748-4"); expect(report.status).toBe("preliminary");
    expect(urls.has(report.subject.reference)).toBe(true);
    expect(report.result.every((ref) => urls.has(ref.reference))).toBe(true);
    expect(new Set(bundle.entry.map((entry) => entry.resource.id)).size).toBe(bundle.entry.length);
    const observation = bundle.entry.find((entry) => entry.resource.resourceType === "Observation")!.resource;
    if (observation.resourceType !== "Observation") throw new Error("Missing observation");
    expect(observation.bodySite).toEqual({ text: "FEMUR_LEFT" });
    expect(JSON.stringify(bundle)).not.toContain("SNOMED");
  });
  it("rejects unverified final status and stale or duplicate signatures", () => {
    expect(() => fhirDiagnosticReport({ ...record, state: "VERIFIED" }, options)).toThrow("two distinct");
    const signature = { reviewerId: "r1", revision: 1, signedAt: record.updatedAt };
    expect(() => fhirDiagnosticReport({ ...record, state: "VERIFIED", signatures: [signature, signature] }, options)).toThrow();
    expect(() => fhirDiagnosticReport({ ...record, state: "VERIFIED", revision: 2, signatures: [signature, { ...signature, reviewerId: "r2" }] }, options)).toThrow();
  });
  it("exports final status with linked reviewers and provenance only after dual review", () => {
    const signatures = ["r1", "r2"].map((reviewerId) => ({ reviewerId, revision: 1, signedAt: record.updatedAt }));
    const bundle = fhirDiagnosticReport({ ...record, state: "VERIFIED", signatures }, options);
    const report = bundle.entry.find((e) => e.resource.resourceType === "DiagnosticReport")!.resource;
    if (report.resourceType !== "DiagnosticReport") throw new Error("Missing report");
    expect(report.status).toBe("final"); expect(report.resultsInterpreter).toHaveLength(2);
    expect(bundle.entry.filter((e) => e.resource.resourceType === "Provenance")).toHaveLength(2);
    expect(bundle.entry.filter((e) => e.resource.resourceType === "Practitioner")).toHaveLength(2);
  });
  it("keeps narrative text unrendered and rejects invented coding formats or collisions", () => {
    const input = { ...record, reportText: "<script>untrusted</script>" };
    const bundle = fhirDiagnosticReport(input, options);
    expect(JSON.stringify(bundle)).toContain("<script>untrusted</script>");
    expect(() => fhirDiagnosticReport(record, { ...options, idFactory: () => caseId })).toThrow("unique UUIDs");
    expect(() => fhirDiagnosticReport({ ...record, findings: [record.findings[0], record.findings[0]] }, options)).toThrow("unique");
    expect(() => fhirDiagnosticReport({ ...record, findings: [{ ...record.findings[0], id: caseId }] }, options)).toThrow("distinct");
    expect(() => fhirDiagnosticReport({ ...record, findings: [{ ...record.findings[0], fmaId: "guessed" }] }, options)).toThrow("FMA");
    expect(() => fhirDiagnosticReport(record, { ...options, identifierSystem: "not-a-uri" })).toThrow("HTTP(S)");
  });
});
