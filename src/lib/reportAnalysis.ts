import boneIds from "../data/bone-ids.json";
import { isUuid, type Finding } from "./clinical";

export type ReportAssertion = "present" | "absent" | "uncertain";
export interface ReportEvidence { page: number; section: string; text: string; start: number; end: number }
export interface ReportFinding {
  id: string; boneId: string | null; label: string; evidence: ReportEvidence;
  assertion: ReportAssertion; temporality: "acute" | "chronic" | "unspecified";
  laterality: "Left" | "Right" | "Midline" | "Unspecified"; reviewRequired: true;
}
export interface ReportAnalysis {
  method: "rule-based-report-extraction"; clinicallyValidated: false; sourceSha256: string;
  pages: { page: number; text: string; extraction: "digital" | "ocr" }[];
  findings: ReportFinding[]; warnings: string[];
}
const catalogIds = new Set<string>(boneIds);
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export function parseReportAnalysis(value: unknown): ReportAnalysis {
  const invalid = () => { throw new Error("The report processor returned invalid anatomy or source evidence. No results accepted."); };
  if (!object(value) || value.method !== "rule-based-report-extraction" || value.clinicallyValidated !== false || typeof value.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.sourceSha256)) return invalid();
  if (!Array.isArray(value.pages) || !value.pages.length || !value.pages.every((p: unknown) => object(p) && Number.isInteger(p.page) && Number(p.page) >= 1 && typeof p.text === "string" && ["digital", "ocr"].includes(String(p.extraction)))) return invalid();
  const pages = value.pages as ReportAnalysis["pages"];
  if (new Set(pages.map((p) => p.page)).size !== pages.length || !Array.isArray(value.findings) || !Array.isArray(value.warnings) || !value.warnings.every((w: unknown) => typeof w === "string")) return invalid();
  for (const f of value.findings as unknown[]) {
    if (!object(f) || !isUuid(f.id) || !(f.boneId === null || (typeof f.boneId === "string" && catalogIds.has(f.boneId))) || typeof f.label !== "string" || !f.label.trim() || f.reviewRequired !== true
      || !["present", "absent", "uncertain"].includes(String(f.assertion)) || !["acute", "chronic", "unspecified"].includes(String(f.temporality)) || !["Left", "Right", "Midline", "Unspecified"].includes(String(f.laterality)) || !object(f.evidence)) return invalid();
    const e = f.evidence;
    const page = pages.find((p) => p.page === e.page);
    if (!page || typeof e.section !== "string" || typeof e.text !== "string" || !e.text.trim() || !Number.isInteger(e.start) || !Number.isInteger(e.end) || Number(e.start) < 0 || Number(e.end) <= Number(e.start) || Number(e.end) > Array.from(page.text).length || Array.from(page.text).slice(Number(e.start), Number(e.end)).join("") !== e.text) return invalid();
  }
  if (new Set(value.findings.map((f) => f.id)).size !== value.findings.length) return invalid();
  return value as unknown as ReportAnalysis;
}
export function reviewedReportFinding(analysis: ReportAnalysis, finding: ReportFinding): Finding {
  if (finding.assertion === "absent" || !finding.boneId || !catalogIds.has(finding.boneId) || !analysis.findings.some((f) => f.id === finding.id)) throw new Error("Absent or unmapped findings cannot become skeletal fracture annotations.");
  return {
    id: finding.id, boneId: finding.boneId, label: `${finding.assertion === "uncertain" ? "Possible — " : ""}${finding.label}`,
    fmaId: null, confidence: null, boundingBox: null, displacementMm: null, aoOtaCode: null, radlexId: null,
    reportEvidence: { sourceSha256: analysis.sourceSha256, method: analysis.method, assertion: finding.assertion, temporality: finding.temporality, laterality: finding.laterality, evidence: finding.evidence },
  };
}
