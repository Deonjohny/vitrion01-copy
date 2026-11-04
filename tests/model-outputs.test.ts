import { describe, expect, it } from "vitest";
import { parseMriOutput, parseRadiologyOutput } from "../src/lib/modelOutputs";

const modelSha256 = "a".repeat(64);
const finding = { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", boneId: "FEMUR_LEFT", fmaId: null, label: "Synthetic finding", confidence: 0.9, boundingBox: [0.1, 0.2, 0.8, 0.9], displacementMm: null, aoOtaCode: null, radlexId: null };
describe("model output boundary", () => {
  it("requires provenance checksum and normalized detections without invented measurements", () => {
    expect(parseRadiologyOutput({ modelSha256, detections: [finding] }).detections[0].displacementMm).toBeNull();
    expect(() => parseRadiologyOutput({ detections: [finding] })).toThrow("checksum");
    expect(() => parseRadiologyOutput({ modelSha256, detections: [finding, finding] })).toThrow("unique");
    expect(() => parseRadiologyOutput({ modelSha256, detections: [{ ...finding, confidence: 1.1 }] })).toThrow();
  });
  it("checks MRI entity offsets using Python Unicode codepoints rather than UTF16 units", () => {
    const text = "🧪 femur";
    const entity = { text: "femur", start: 2, end: 7, label: "ANATOMY", score: 0.9, radlexId: null, boneId: null };
    expect(parseMriOutput({ modelSha256, entities: [entity] }, text).entities).toEqual([entity]);
    expect(() => parseMriOutput({ modelSha256, entities: [{ ...entity, end: 100 }] }, text)).toThrow("spans");
    expect(() => parseMriOutput({ modelSha256, entities: [{ ...entity, text: "tibia" }] }, text)).toThrow("spans");
    expect(() => parseMriOutput({ modelSha256, entities: [{ ...entity, score: NaN }] }, text)).toThrow();
  });
});
