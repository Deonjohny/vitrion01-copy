import { isFinding, type Finding } from "./clinical";

export interface ReportEntity { text: string; start: number; end: number; label: string; score: number; radlexId: string | null; boneId: string | null }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function envelope(value: unknown): Record<string, unknown> & { modelSha256: string } {
  if (!object(value) || typeof value.modelSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.modelSha256)) throw new Error("Model response lacks a valid artifact checksum.");
  return value as Record<string, unknown> & { modelSha256: string };
}
export function parseRadiologyOutput(value: unknown): { modelSha256: string; detections: Finding[] } {
  const result = envelope(value);
  if (!Array.isArray(result.detections) || !result.detections.every(isFinding)) throw new Error("Invalid radiology detection response.");
  if (new Set(result.detections.map((finding) => finding.id)).size !== result.detections.length) throw new Error("Detection identifiers must be unique.");
  return { modelSha256: result.modelSha256, detections: result.detections };
}
export function parseMriOutput(value: unknown, reportText: string): { modelSha256: string; entities: ReportEntity[] } {
  const result = envelope(value);
  const codepoints = Array.from(reportText);
  if (!Array.isArray(result.entities) || !result.entities.every((e: unknown) => object(e) && typeof e.text === "string" && Number.isInteger(e.start) && Number.isInteger(e.end) && Number(e.start) >= 0 && Number(e.end) > Number(e.start) && Number(e.end) <= codepoints.length && codepoints.slice(Number(e.start), Number(e.end)).join("") === e.text && typeof e.label === "string" && typeof e.score === "number" && e.score >= 0 && e.score <= 1 && (e.radlexId === null || typeof e.radlexId === "string") && (e.boneId === null || typeof e.boneId === "string"))) {
    throw new Error("Invalid MRI entity response or entity spans do not match the report.");
  }
  return { modelSha256: result.modelSha256, entities: result.entities as ReportEntity[] };
}
