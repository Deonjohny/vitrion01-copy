import { describe, expect, it } from "vitest";
import { bones, sources } from "../src/data/anatomy";
import { getBone, getRegionalBones, getRelatedBones, searchBones } from "../src/lib/anatomy";
import type { Bone, Region } from "../src/lib/types";

const ids = (items: Bone[]) => items.map((bone) => bone.id);
const paired = (bases: string[]) => bases.flatMap((base) => [`${base}_LEFT`, `${base}_RIGHT`]);
const range = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);

// Independent enumeration guards against keeping 206 records by duplicating or replacing a bone.
function expectedIds() {
  const result = [
    "FRONTAL", "OCCIPITAL", "SPHENOID", "ETHMOID", "VOMER", "MANDIBLE", "HYOID", "SACRUM", "COCCYX", "STERNUM",
    ...paired(["PARIETAL", "TEMPORAL", "MAXILLA", "ZYGOMATIC", "NASAL", "LACRIMAL", "PALATINE", "INFERIOR_NASAL_CONCHA", "MALLEUS", "INCUS", "STAPES"]),
    ...range("C", 7), ...range("T", 12), ...range("L", 5), ...paired(range("RIB_", 12)),
    ...paired(["CLAVICLE", "SCAPULA", "HUMERUS", "RADIUS", "ULNA", "PELVIS", "FEMUR", "PATELLA", "TIBIA", "FIBULA"]),
    ...paired(["SCAPHOID", "LUNATE", "TRIQUETRUM", "PISIFORM", "TRAPEZIUM", "TRAPEZOID", "CAPITATE", "HAMATE"]),
    ...paired(["TALUS", "CALCANEUS", "NAVICULAR", "CUBOID", "MEDIAL_CUNEIFORM", "INTERMEDIATE_CUNEIFORM", "LATERAL_CUNEIFORM"]),
    ...paired(range("METACARPAL_", 5)), ...paired(range("METATARSAL_", 5)),
  ];
  for (const part of ["HAND", "FOOT"]) {
    for (const digit of [1, 2, 3, 4, 5]) {
      for (const segment of digit === 1 ? ["PROXIMAL", "DISTAL"] : ["PROXIMAL", "MIDDLE", "DISTAL"]) {
        result.push(...paired([`${part}_${segment}_PHALANX_${digit}`]));
      }
    }
  }
  return result;
}

describe("adult reference catalog invariants", () => {
  it("contains exactly the expected 206 unique individual bones", () => {
    expect(bones).toHaveLength(206);
    expect(new Set(ids(bones)).size).toBe(206);
    expect(ids(bones).sort()).toEqual(expectedIds().sort());
    expect(new Set(bones.map((bone) => bone.meshId)).size).toBe(206);
  });

  it("has the conventional axial and appendicular totals", () => {
    expect(bones.filter((bone) => bone.division === "Axial")).toHaveLength(80);
    expect(bones.filter((bone) => bone.division === "Appendicular")).toHaveLength(126);
    expect(bones.filter((bone) => bone.group === "Cranial bones")).toHaveLength(8);
    expect(bones.filter((bone) => bone.group === "Facial bones")).toHaveLength(14);
    for (const side of ["Left", "Right"]) {
      expect(bones.filter((bone) => bone.side === side)).toHaveLength(86);
      expect(bones.filter((bone) => bone.side === side && ["Upper limb", "Hand"].includes(bone.region))).toHaveLength(30);
      expect(bones.filter((bone) => bone.side === side && ["Lower limb", "Foot"].includes(bone.region))).toHaveLength(30);
    }
    expect(bones.filter((bone) => bone.side === "Midline")).toHaveLength(34);
  });

  it.each<[Region, number]>([
    ["Skull", 22], ["Auditory ossicles", 6], ["Hyoid", 1], ["Vertebral column", 26], ["Thoracic cage", 25],
    ["Shoulder girdle", 4], ["Upper limb", 6], ["Hand", 54], ["Pelvic girdle", 2], ["Lower limb", 8], ["Foot", 52],
  ])("counts %s as %i", (region, count) => {
    expect(bones.filter((bone) => bone.region === region)).toHaveLength(count);
  });

  it("keeps provenance resolvable and does not fabricate clinical or geometry data", () => {
    const sourceIds = sources.map((source) => source.id);
    expect(new Set(sourceIds).size).toBe(sources.length);
    for (const source of sources) {
      expect(new URL(source.url).protocol).toBe("https:");
      expect(source.title.length).toBeGreaterThan(0);
      expect(source.license).toContain("CC BY-NC-SA 4.0");
    }
    for (const bone of bones) {
      expect(bone.id).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(bone.meshId).toBe(bone.id);
      expect(bone.name.length).toBeGreaterThan(0);
      expect(bone.group.length).toBeGreaterThan(0);
      expect(["Long", "Short", "Flat", "Irregular", "Sesamoid"]).toContain(bone.category);
      expect(bone.dimensions).toBeNull();
      expect(bone.spatial).toBeNull();
      expect(bone.clinicalInformation).toEqual([]);
      expect(bone.fractureRegions).toEqual([]);
      expect(bone.functions.length).toBeGreaterThan(0);
      expect(bone.latinName === null || bone.latinName.trim().length > 0).toBe(true);
      expect(bone.sourceIds).toContain("divisions");
      expect(bone.sourceIds.length).toBeGreaterThanOrEqual(3);
      expect(new Set(bone.sourceIds).size).toBe(bone.sourceIds.length);
      for (const sourceId of bone.sourceIds) expect(sourceIds).toContain(sourceId);
    }
    expect(getBone("FRONTAL")?.latinName).toBeNull();
  });

  it("has reciprocal same-bone counterparts, never self-pairs", () => {
    for (const bone of bones) {
      if (bone.side === "Midline") expect(bone.counterpartId).toBeNull();
      else {
        const counterpart = getBone(bone.counterpartId!);
        expect(counterpart).toBeDefined();
        expect(counterpart?.counterpartId).toBe(bone.id);
        expect(counterpart?.id).not.toBe(bone.id);
        expect(counterpart?.side).toBe(bone.side === "Left" ? "Right" : "Left");
        expect(counterpart?.region).toBe(bone.region);
        expect(counterpart?.division).toBe(bone.division);
        expect(counterpart?.group).toBe(bone.group);
        expect(counterpart?.category).toBe(bone.category);
      }
    }
  });

  it("models adult fused structures once and has no middle thumb or hallux phalanx", () => {
    for (const id of ["ILIUM_LEFT", "ISCHIUM_LEFT", "PUBIS_LEFT", "S1", "S5", "CO1", "C8", "T13", "L6", "HAND_MIDDLE_PHALANX_1_LEFT", "FOOT_MIDDLE_PHALANX_1_RIGHT"]) {
      expect(getBone(id)).toBeUndefined();
    }
    expect(getBone("PELVIS_LEFT")?.name).toBe("Left Hip bone");
    expect(getBone("PATELLA_LEFT")?.category).toBe("Sesamoid");
    expect(getBone("PISIFORM_LEFT")?.category).toBe("Sesamoid");
  });
});

describe("curated articulations", () => {
  it("has symmetric, unique, valid, non-self edges with provenance and joint labels", () => {
    for (const bone of bones) {
      expect(new Set(bone.connectedBoneIds).size).toBe(bone.connectedBoneIds.length);
      expect(new Set(bone.joints).size).toBe(bone.joints.length);
      for (const relatedId of bone.connectedBoneIds) {
        const related = getBone(relatedId);
        expect(related).toBeDefined();
        expect(relatedId).not.toBe(bone.id);
        expect(related?.connectedBoneIds).toContain(bone.id);
        expect(bone.joints.some((joint) => related?.joints.includes(joint))).toBe(true);
        expect(bone.sourceIds.some((source) => !["divisions", "classification"].includes(source) && related?.sourceIds.includes(source))).toBe(true);
      }
    }
  });

  it("mirrors every paired articulation anatomically across sides", () => {
    for (const bone of bones.filter((item) => item.counterpartId)) {
      const counterpart = getBone(bone.counterpartId!)!;
      for (const related of getRelatedBones(bone.id)) {
        expect(counterpart.connectedBoneIds).toContain(related.counterpartId ?? related.id);
      }
    }
  });

  it.each([
    ["FEMUR_LEFT", ["PELVIS_LEFT", "TIBIA_LEFT", "PATELLA_LEFT"]],
    ["PATELLA_RIGHT", ["FEMUR_RIGHT"]],
    ["C1", ["OCCIPITAL", "C2"]],
    ["MALLEUS_LEFT", ["INCUS_LEFT"]],
    ["INCUS_RIGHT", ["MALLEUS_RIGHT", "STAPES_RIGHT"]],
    ["PELVIS_LEFT", ["SACRUM", "FEMUR_LEFT", "PELVIS_RIGHT"]],
    ["HAND_PROXIMAL_PHALANX_1_LEFT", ["METACARPAL_1_LEFT", "HAND_DISTAL_PHALANX_1_LEFT"]],
    ["FOOT_MIDDLE_PHALANX_3_RIGHT", ["FOOT_PROXIMAL_PHALANX_3_RIGHT", "FOOT_DISTAL_PHALANX_3_RIGHT"]],
  ] as [string, string[]][]) ("returns expected direct neighbors of %s", (id, expected) => {
    expect(ids(getRelatedBones(id)).sort()).toEqual(expected.sort());
  });

  it("keeps ribs distinct from mere numeric neighbors and limits sternocostal connections", () => {
    for (const side of ["LEFT", "RIGHT"]) {
      for (let rib = 1; rib <= 12; rib++) {
        const related = ids(getRelatedBones(`RIB_${rib}_${side}`));
        expect(related.some((id) => id.startsWith("RIB_"))).toBe(false);
        expect(related).toContain(`T${rib}`);
        expect(related.includes("STERNUM")).toBe(rib <= 7);
        if (rib >= 2 && rib <= 9) expect(related).toContain(`T${rib - 1}`);
        if (rib >= 10) expect(related).toEqual([`T${rib}`]);
      }
    }
    expect(getBone("RIB_1_LEFT")?.joints).toContain("Sternocostal connection via costal cartilage");
  });

  it("does not invent hyoid, scapula-rib, ulna-carpal or fibula-femur articulations", () => {
    expect(getRelatedBones("HYOID")).toEqual([]);
    expect(ids(getRelatedBones("SCAPULA_LEFT"))).not.toContain("RIB_2_LEFT");
    expect(getRelatedBones("ULNA_LEFT").some((bone) => bone.region === "Hand")).toBe(false);
    expect(ids(getRelatedBones("FIBULA_LEFT"))).not.toContain("FEMUR_LEFT");
    expect(ids(getRelatedBones("FEMUR_LEFT"))).not.toContain("FEMUR_RIGHT");
    expect(ids(getRelatedBones("C7"))).toContain("T1");
    expect(ids(getRelatedBones("T12"))).toContain("L1");
    expect(ids(getRelatedBones("L5"))).toContain("SACRUM");
    expect(ids(getRelatedBones("SACRUM"))).toContain("COCCYX");
  });
});

describe("lookup, search and regions", () => {
  it.each([
    ["left femur", ["FEMUR_LEFT"]], ["FEMUR_LEFT", ["FEMUR_LEFT"]], ["femur left", ["FEMUR_LEFT"]],
    ["  LEFT---FÉMUR  ", ["FEMUR_LEFT"]], ["lt thighbone", ["FEMUR_LEFT"]],
    ["right collarbone", ["CLAVICLE_RIGHT"]], ["left shoulder blade", ["SCAPULA_LEFT"]],
    ["right kneecap", ["PATELLA_RIGHT"]], ["os coxae left", ["PELVIS_LEFT"]],
    ["ilium left", ["PELVIS_LEFT"]], ["tailbone", ["COCCYX"]], ["atlas", ["C1"]], ["axis", ["C2"]],
    ["C1", ["C1"]], ["rib 1 left", ["RIB_1_LEFT"]], ["RIB_12_RIGHT", ["RIB_12_RIGHT"]],
    ["left thumb distal phalanx", ["HAND_DISTAL_PHALANX_1_LEFT"]],
    ["right hallux proximal phalanx", ["FOOT_PROXIMAL_PHALANX_1_RIGHT"]],
    ["left index finger middle phalanx", ["HAND_MIDDLE_PHALANX_2_LEFT"]],
    ["stirrup right", ["STAPES_RIGHT"]], ["no such bone", []],
  ] as [string, string[]][]) ("searches %s", (query, expected) => {
    expect(ids(searchBones(query)).sort()).toEqual(expected.sort());
  });

  it("searches every stable ID and display name without numeric collisions", () => {
    for (const bone of bones) {
      expect(ids(searchBones(bone.id))).toEqual([bone.id]);
      expect(ids(searchBones(bone.name))).toEqual([bone.id]);
    }
  });

  it("combines normalized exact filters and handles empty queries", () => {
    expect(searchBones("")).toHaveLength(206);
    expect(searchBones("  \t ")).toHaveLength(206);
    expect(searchBones("", { region: " hand ", side: "LEFT", division: "appendicular" })).toHaveLength(27);
    expect(searchBones("", { division: "Axial" })).toHaveLength(80);
    expect(searchBones("", { side: "Midline" })).toHaveLength(34);
    expect(searchBones("femur", { division: "Axial" })).toEqual([]);
    expect(searchBones("", { region: "unknown" })).toEqual([]);
    expect(searchBones("", { side: "unknown" })).toEqual([]);
    expect(searchBones("", { division: "unknown" })).toEqual([]);
    expect(searchBones("femur", { region: "", side: " " })).toHaveLength(2);
    expect(searchBones("phalanges", { region: "Hand" })).toHaveLength(28);
  });

  it("looks up IDs with normalized case and separators", () => {
    expect(getBone(" femur-left ")).toBe(getBone("FEMUR_LEFT"));
    expect(getBone("c1")?.name).toContain("Atlas");
    expect(getBone("left femur")).toBeUndefined();
  });

  it("returns both sides of the exact region including selection, not graph neighbors", () => {
    expect(getRegionalBones("FEMUR_LEFT")).toHaveLength(8);
    expect(ids(getRegionalBones("FEMUR_LEFT"))).toContain("FEMUR_RIGHT");
    expect(ids(getRegionalBones("FEMUR_LEFT"))).not.toContain("PELVIS_LEFT");
    expect(getRegionalBones("SCAPHOID_LEFT")).toHaveLength(54);
    expect(getRegionalBones("TALUS_RIGHT")).toHaveLength(52);
    expect(getRegionalBones("HYOID")).toEqual([getBone("HYOID")]);
  });

  it("handles missing IDs without throwing and returns fresh result arrays", () => {
    for (const missing of ["", "UNKNOWN", "FEMUR", "__proto__"]) {
      expect(getBone(missing)).toBeUndefined();
      expect(getRelatedBones(missing)).toEqual([]);
      expect(getRegionalBones(missing)).toEqual([]);
    }
    const result = searchBones("");
    result.pop();
    expect(searchBones("")).toHaveLength(206);
    const related = getRelatedBones("FEMUR_LEFT");
    related.pop();
    expect(getRelatedBones("FEMUR_LEFT")).toHaveLength(3);
  });
});
