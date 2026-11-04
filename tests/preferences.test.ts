import { describe, expect, it } from "vitest";
import { bones } from "../src/data/anatomy";
import { defaultPreferences, parsePreferences } from "../src/lib/preferences";

describe("persistent workspace preferences", () => {
  it.each([null, "", "broken", "null", "[]", "false", "7"])("recovers safely from %s", (raw) => {
    expect(parsePreferences(raw, bones)).toEqual(defaultPreferences);
  });
  it("restores valid selections, filters, and settings", () => {
    const valid = { selectedBoneId: "FEMUR_LEFT", section: "relationships", region: "Lower limb", side: "Left", autoRotate: true, playIntro: false };
    expect(parsePreferences(JSON.stringify(valid), bones)).toEqual(valid);
  });
  it("rejects invalid IDs, filters, and nonboolean switches", () => {
    const raw = { selectedBoneId: "FAKE_BONE", section: "patient-upload", region: "Unknown", side: "Any", autoRotate: "true", playIntro: "false" };
    expect(parsePreferences(JSON.stringify(raw), bones)).toEqual(defaultPreferences);
  });
  it("does not preserve unknown or sensitive fields", () => {
    const parsed = parsePreferences(JSON.stringify({ patientName: "synthetic", image: "anything", selectedBoneId: "FEMUR_LEFT" }), bones);
    expect(parsed.selectedBoneId).toBe("FEMUR_LEFT");
    expect(parsed).not.toHaveProperty("patientName");
    expect(parsed).not.toHaveProperty("image");
  });
});
