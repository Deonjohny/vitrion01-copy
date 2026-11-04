import boneIds from "../data/bone-ids.json";
const ids = new Set<string>(boneIds);
export interface PreparedImageMatch {
  matched: true; method: "prepared-image-illustration"; label: string; clinicallyValidated: false;
  sourceSha256: string; title: string; boneIds: string[]; targetBoneId: string | null;
  fracture: { positionFraction: [number, number, number]; angleDegrees: number; size: number };
  limitations: string[];
}
export interface UnpreparedImage { matched: false; method: "prepared-image-illustration"; clinicallyValidated: false; sourceSha256: string; message: string }
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export function parsePreparedIllustration(value: unknown): PreparedImageMatch | UnpreparedImage {
  const fail = () => { throw new Error("Invalid prepared illustration response. No model was substituted."); };
  if (!object(value) || value.method !== "prepared-image-illustration" || value.clinicallyValidated !== false || typeof value.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceSha256)) return fail();
  if (value.matched === false && typeof value.message === "string") return value as unknown as UnpreparedImage;
  if (value.matched !== true || typeof value.label !== "string" || !value.label.includes("Prepared illustration") || typeof value.title !== "string" || !Array.isArray(value.boneIds) || value.boneIds.length < 1 || !value.boneIds.every((id: unknown) => typeof id === "string" && ids.has(id)) || !(value.targetBoneId === null || (typeof value.targetBoneId === "string" && value.boneIds.includes(value.targetBoneId))) || !object(value.fracture) || !Array.isArray(value.limitations) || !value.limitations.every((text: unknown) => typeof text === "string")) return fail();
  const f = value.fracture;
  if (!Array.isArray(f.positionFraction) || f.positionFraction.length !== 3 || !f.positionFraction.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) || typeof f.size !== "number" || !Number.isFinite(f.size) || f.size < .1 || f.size > .6 || typeof f.angleDegrees !== "number" || !Number.isFinite(f.angleDegrees)) return fail();
  return value as unknown as PreparedImageMatch;
}
