import boneIds from "../data/bone-ids.json";
const catalogIds = new Set<string>(boneIds);
export type ReviewState = "PRELIMINARY" | "VERIFIED" | "AMENDED";
export type ClinicalRole = "Radiologist" | "Researcher" | "ComplianceOfficer";
export interface ClinicalSession { subject: string; role: ClinicalRole; presentationMode?: boolean }
export type Modality = "XR" | "MR" | "CT" | "OT";
export interface Finding {
  manualImageEvidence?: {
    sourceSha256: string; method: "reviewer-drawn-fracture-trace";
    imageWidth: number; imageHeight: number; points: [number, number][]; reviewerAssignedAnatomy: true;
  } | null;
  imageEvidence?: {
    sourceSha256: string; modelSha256: string; method: "experimental-onnx-fracture-detector";
    imageWidth: number; imageHeight: number; reviewerAssignedAnatomy: true;
  } | null;
  reportEvidence?: {
    sourceSha256: string; method: "rule-based-report-extraction";
    assertion: "present" | "absent" | "uncertain"; temporality: "acute" | "chronic" | "unspecified";
    laterality: "Left" | "Right" | "Midline" | "Unspecified";
    evidence: { page: number; section: string; text: string; start: number; end: number };
  } | null;
  id: string;
  boneId: string | null;
  fmaId: string | null;
  label: string;
  confidence: number | null;
  boundingBox: [number, number, number, number] | null;
  displacementMm: number | null;
  aoOtaCode: string | null;
  radlexId: string | null;
}
export interface ReviewSignature { reviewerId: string; revision: number; signedAt: string }
export interface CaseInput {
  patientPseudoId: string;
  dicomSeriesInstanceUid: string | null;
  reportText: string;
  modality: Modality;
  boneIds: string[];
  findings: Finding[];
}
export interface CaseRecord extends CaseInput {
  id: string;
  state: ReviewState;
  revision: number;
  signatures: ReviewSignature[];
  createdAt: string;
  updatedAt: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string { return typeof value === "string" && uuid.test(value); }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nullableString(value: unknown): boolean { return value === null || typeof value === "string"; }
function finiteNullable(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isFinite(value)); }
function timestamp(value: unknown): boolean { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }
export function isFinding(value: unknown): value is Finding {
  if (!object(value) || !isUuid(value.id) || typeof value.label !== "string" || !value.label.trim()) return false;
  if (![value.boneId, value.fmaId, value.aoOtaCode, value.radlexId].every(nullableString)) return false;
  if (typeof value.boneId === "string" && !catalogIds.has(value.boneId)) return false;
  if (value.manualImageEvidence !== undefined && value.manualImageEvidence !== null) {
    const e = value.manualImageEvidence;
    if (!object(e) || e.method !== "reviewer-drawn-fracture-trace" || e.reviewerAssignedAnatomy !== true || typeof e.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(e.sourceSha256) || !Number.isInteger(e.imageWidth) || Number(e.imageWidth) < 1 || !Number.isInteger(e.imageHeight) || Number(e.imageHeight) < 1 || !Array.isArray(e.points) || e.points.length < 2 || e.points.length > 64 || !e.points.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every((v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1))) return false;
  }
  if (value.imageEvidence !== undefined && value.imageEvidence !== null) {
    const e = value.imageEvidence;
    if (!object(e) || e.method !== "experimental-onnx-fracture-detector" || e.reviewerAssignedAnatomy !== true || typeof e.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(e.sourceSha256) || typeof e.modelSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(e.modelSha256) || !Number.isInteger(e.imageWidth) || Number(e.imageWidth) < 1 || !Number.isInteger(e.imageHeight) || Number(e.imageHeight) < 1) return false;
  }
  if (value.reportEvidence !== undefined && value.reportEvidence !== null) {
    const p = value.reportEvidence;
    if (!object(p) || typeof p.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(p.sourceSha256) || p.method !== "rule-based-report-extraction" || !["present", "absent", "uncertain"].includes(String(p.assertion)) || !["acute", "chronic", "unspecified"].includes(String(p.temporality)) || !["Left", "Right", "Midline", "Unspecified"].includes(String(p.laterality)) || !object(p.evidence)) return false;
    const e = p.evidence;
    if (!Number.isInteger(e.page) || Number(e.page) < 1 || typeof e.section !== "string" || typeof e.text !== "string" || !e.text.trim() || !Number.isInteger(e.start) || !Number.isInteger(e.end) || Number(e.start) < 0 || Number(e.end) <= Number(e.start)) return false;
  }
  if (!finiteNullable(value.confidence) || !finiteNullable(value.displacementMm)) return false;
  if (typeof value.confidence === "number" && (value.confidence < 0 || value.confidence > 1)) return false;
  if (typeof value.displacementMm === "number" && value.displacementMm < 0) return false;
  if (value.boundingBox !== null) {
    const box = value.boundingBox;
    if (!Array.isArray(box) || box.length !== 4 || !box.every((v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) return false;
    if (box[0] >= box[2] || box[1] >= box[3]) return false;
  }
  return true;
}
export function parseCase(value: unknown): CaseRecord {
  if (!object(value) || !isUuid(value.id) || typeof value.patientPseudoId !== "string" || !nullableString(value.dicomSeriesInstanceUid)
    || typeof value.reportText !== "string" || !["XR", "MR", "CT", "OT"].includes(String(value.modality))
    || !["PRELIMINARY", "VERIFIED", "AMENDED"].includes(String(value.state))
    || !Number.isInteger(value.revision) || Number(value.revision) < 1 || !timestamp(value.createdAt) || !timestamp(value.updatedAt)
    || !Array.isArray(value.boneIds) || !value.boneIds.every((id: unknown) => typeof id === "string" && catalogIds.has(id))
    || !Array.isArray(value.findings) || !value.findings.every(isFinding)
    || !Array.isArray(value.signatures) || !value.signatures.every((s: unknown) => object(s) && typeof s.reviewerId === "string" && Number.isInteger(s.revision) && timestamp(s.signedAt))) {
    throw new Error("The server returned an invalid case record. No clinical data was accepted.");
  }
  return value as unknown as CaseRecord;
}
export function parseClinicalSession(value: unknown): ClinicalSession {
  if (!object(value) || typeof value.subject !== "string" || !value.subject || !["Radiologist", "Researcher", "ComplianceOfficer"].includes(String(value.role)) || (value.presentationMode !== undefined && typeof value.presentationMode !== "boolean")) {
    throw new Error("The server returned an invalid session.");
  }
  return { subject: value.subject, role: value.role as ClinicalRole, ...(value.presentationMode === undefined ? {} : { presentationMode: value.presentationMode }) };
}
export function parseAuditVerification(value: unknown): { valid: true; entries: number } {
  if (!object(value) || value.valid !== true || !Number.isInteger(value.entries) || Number(value.entries) < 0) {
    throw new Error("Audit integrity could not be verified. Contact the compliance administrator.");
  }
  return { valid: true, entries: Number(value.entries) };
}
export async function clinicalRequest(path: string, token: string, method = "GET", body?: unknown, timeoutMs = 20000): Promise<unknown> {
  const response = await fetch(`/clinical-api${path}`, {
    method, cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "Session expired or invalid. Supply a valid access token.", 403: "Your role cannot perform this action.",
      404: "Record or service not found.", 409: "The record changed or this review is not permitted. Reload it before continuing.",
      413: "The request exceeds the allowed size.", 422: "The submitted values failed server validation.",
      503: "This service is unavailable or requires validated model configuration.",
    };
    throw new Error(messages[response.status] ?? "The clinical service could not complete the request. Check the local backend.");
  }
  return response.json();
}
