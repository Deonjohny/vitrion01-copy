import boneIds from "../data/bone-ids.json";
const ids = new Set<string>(boneIds);
export interface AnatomyTarget { boneId: string; context: "reviewed-report" | "reviewed-finding"; assertion: "present" | "uncertain" }
export function parseAnatomyTarget(search: string): AnatomyTarget | null {
  const params = new URLSearchParams(search);
  const boneId = params.get("bone");
  const context = params.get("context");
  const assertion = params.get("assertion");
  if (!boneId || !ids.has(boneId) || (context !== "reviewed-report" && context !== "reviewed-finding") || (assertion !== "present" && assertion !== "uncertain")) return null;
  return { boneId, context, assertion };
}
