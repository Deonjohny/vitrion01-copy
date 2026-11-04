import { bones } from "../data/anatomy";
import type { Bone } from "./types";

const byId = new Map(bones.map((bone) => [bone.id, bone]));
const normalize = (text: string) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const aliases: Record<string, string> = {
  FEMUR: "thigh bone thighbone",
  PATELLA: "kneecap knee cap",
  TIBIA: "shin bone shinbone",
  FIBULA: "calf bone",
  HUMERUS: "upper arm bone",
  RADIUS: "forearm bone",
  ULNA: "forearm bone elbow",
  CLAVICLE: "collarbone collar bone",
  SCAPULA: "shoulder blade shoulderblade",
  PELVIS: "pelvis pelvic hip coxal bone innominate ilium ischium pubis",
  STERNUM: "breastbone breast bone",
  COCCYX: "tailbone tail bone",
  MANDIBLE: "lower jaw jawbone",
  MAXILLA: "upper jaw",
  ZYGOMATIC: "cheekbone cheek bone",
  FRONTAL: "forehead",
  MALLEUS: "hammer",
  INCUS: "anvil",
  STAPES: "stirrup",
  CALCANEUS: "heel heelbone heel bone",
  TALUS: "ankle bone",
  SCAPHOID: "carpal navicular",
  TRIQUETRUM: "triquetral",
  HYOID: "tongue bone",
  INFERIOR_NASAL_CONCHA: "inferior nasal turbinate",
  C1: "atlas",
  C2: "axis",
};

function searchText(bone: Bone): string {
  const base = bone.id.replace(/_(LEFT|RIGHT)$/, "");
  const terms = [bone.id, bone.name, bone.latinName ?? "", bone.side, bone.region, bone.division, bone.group, aliases[base] ?? ""];
  if (bone.side === "Left") terms.push("lt");
  if (bone.side === "Right") terms.push("rt");
  if (bone.region === "Vertebral column") terms.push("spine backbone vertebra vertebrae");
  if (bone.region === "Auditory ossicles") terms.push("ear middle ear ossicle");
  if (bone.group === "Carpals") terms.push("wrist carpal");
  if (bone.group === "Tarsals") terms.push("tarsal");
  if (base.includes("PHALANX")) terms.push("phalanx phalanges");
  const digit = base.match(/(?:PHALANX|METACARPAL|METATARSAL)_([1-5])$/)?.[1];
  if (digit) {
    if (bone.region === "Hand") terms.push(["thumb pollex", "index finger", "middle finger", "ring finger", "little finger pinky"][Number(digit) - 1]);
    if (bone.region === "Foot") terms.push("toe", digit === "1" ? "big toe great toe hallux" : digit === "5" ? "little toe" : "");
  }
  return normalize(terms.join(" "));
}

const index = bones.map((bone) => ({ bone, tokens: new Set(searchText(bone).split(" ")) }));

export function searchBones(query: string, options?: { region?: string; side?: string; division?: string }): Bone[] {
  const normalizedQuery = normalize(query);
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  const exact = bones.filter((bone) => normalize(bone.id) === normalizedQuery || normalize(bone.name) === normalizedQuery);
  return index.filter(({ bone, tokens: searchable }) => {
    if (exact.length && !exact.includes(bone)) return false;
    for (const field of ["region", "side", "division"] as const) {
      const filter = options?.[field];
      if (filter?.trim() && normalize(bone[field]) !== normalize(filter)) return false;
    }
    // Numeric tokens are exact: rib 1 must not also match rib 10, 11 or 12.
    return tokens.every((token) => searchable.has(token) || (!/\d/.test(token) && [...searchable].some((word) => word.startsWith(token))));
  }).map(({ bone }) => bone);
}

export function getBone(id: string): Bone | undefined {
  return byId.get(normalize(id).replace(/ /g, "_").toUpperCase());
}

/** Direct curated articulations only; a counterpart is not automatically an articulation. */
export function getRelatedBones(id: string): Bone[] {
  const bone = getBone(id);
  return bone ? bone.connectedBoneIds.map((connectedId) => byId.get(connectedId)!).filter(Boolean) : [];
}

/** Same exact region, both sides, including the selected bone. Hand/Foot are separate regions. */
export function getRegionalBones(id: string): Bone[] {
  const bone = getBone(id);
  return bone ? bones.filter((candidate) => candidate.region === bone.region) : [];
}
