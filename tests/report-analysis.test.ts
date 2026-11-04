import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseReportAnalysis, reviewedReportFinding, type ReportAnalysis } from "../src/lib/reportAnalysis";
import { parseAnatomyTarget } from "../src/lib/anatomyTarget";
import { isFinding } from "../src/lib/clinical";
import { bones } from "../src/data/anatomy";
import boneIds from "../src/data/bone-ids.json";

const text = "FINDINGS\nPossible right nasal bone fracture. Left nasal bone intact.";
const evidence = "Possible right nasal bone fracture.";
function sample(): ReportAnalysis {
  return { method: "rule-based-report-extraction", clinicallyValidated: false, sourceSha256: "a".repeat(64), pages: [{ page: 1, text, extraction: "digital" }], warnings: ["Not clinically validated"], findings: [{ id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", boneId: "NASAL_RIGHT", label: "Right nasal fracture", assertion: "uncertain", temporality: "unspecified", laterality: "Right", reviewRequired: true, evidence: { page: 1, section: "FINDINGS", text: evidence, start: 9, end: 9 + evidence.length } }] };
}
describe("report-to-anatomy evidence boundary", () => {
  it("accepts source-grounded draft findings and retains uncertainty and provenance", () => {
    const result = parseReportAnalysis(sample());
    const finding = reviewedReportFinding(result, result.findings[0]);
    expect(finding.boneId).toBe("NASAL_RIGHT"); expect(finding.label).toContain("Possible");
    expect(finding.reportEvidence?.evidence.text).toBe(evidence);
    expect(finding.reportEvidence?.sourceSha256).toBe("a".repeat(64)); expect(isFinding(finding)).toBe(true);
  });
  it("rejects invented source evidence, unknown anatomy, invalid assertion and coordinates", () => {
    for (const change of [ { boneId: "NOT_A_REAL_BONE" }, { assertion: "definitely" }, { evidence: { ...sample().findings[0].evidence, text: "invented diagnosis" } }, { evidence: { ...sample().findings[0].evidence, end: 100000 } } ]) {
      const result = sample(); Object.assign(result.findings[0], change);
      expect(() => parseReportAnalysis(result)).toThrow("source evidence");
    }
  });
  it("does not convert negative or unresolved statements into fractures", () => {
    const result = sample(); result.findings[0].assertion = "absent";
    expect(() => reviewedReportFinding(result, result.findings[0])).toThrow();
    result.findings[0].assertion = "present"; result.findings[0].boneId = null;
    expect(() => reviewedReportFinding(result, result.findings[0])).toThrow();
  });
  it("accepts Python Unicode codepoint offsets, including astral characters", () => {
    const result = sample(); result.pages[0].text = "🧪 " + text; result.findings[0].evidence.start += 2; result.findings[0].evidence.end += 2;
    expect(parseReportAnalysis(result).findings).toHaveLength(1);
  });
  it("validates manual image trace provenance without pretending a model produced it", () => {
    const finding = reviewedReportFinding(sample(), sample().findings[0]);
    const manual = { sourceSha256: "b".repeat(64), method: "reviewer-drawn-fracture-trace" as const, imageWidth: 1152, imageHeight: 768, points: [[0.1, 0.2], [0.2, 0.3]] as [number, number][], reviewerAssignedAnatomy: true as const };
    expect(isFinding({ ...finding, manualImageEvidence: manual })).toBe(true);
    expect(isFinding({ ...finding, manualImageEvidence: { ...manual, points: [[-1, 2], [0, 0]] } })).toBe(false);
    expect(isFinding({ ...finding, boneId: "UNKNOWN_BONE" })).toBe(false);
  });
  it("accepts only catalog-target links without patient identifiers or guessed bones", () => {
    expect(parseAnatomyTarget("?bone=C6&context=reviewed-report&assertion=uncertain")).toEqual({ boneId: "C6", context: "reviewed-report", assertion: "uncertain" });
    expect(parseAnatomyTarget("?bone=NONEXISTENT&context=reviewed-report")).toBeNull();
    expect(parseAnatomyTarget("?bone=C6&context=untrusted")).toBeNull();
    expect(parseAnatomyTarget("?bone=C6&context=reviewed-report&assertion=absent")).toBeNull();
  });
  it("keeps frontend/backend identifiers synchronized with the actual catalog", () => {
    expect([...boneIds].sort()).toEqual(bones.map((bone) => bone.id).sort());
    const serverIds = JSON.parse(readFileSync(new URL("../server/app/data/bone-ids.json", import.meta.url), "utf8"));
    expect(serverIds).toEqual(boneIds);
  });
});
