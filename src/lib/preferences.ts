import type { Bone, Region, Side } from "./types";

export const PREFERENCE_KEY = "vitrion.explorer.v1";
export const INTRO_KEY = "vitrion.intro.seen.v1";
export const sections = ["explorer", "skeleton", "catalog", "relationships", "settings"] as const;
export type Section = (typeof sections)[number];
export interface Preferences {
  selectedBoneId: string | null;
  section: Section;
  region: Region | "All";
  side: Side | "All";
  autoRotate: boolean;
  playIntro: boolean;
}
export const defaultPreferences: Preferences = {
  selectedBoneId: null,
  section: "explorer",
  region: "All",
  side: "All",
  autoRotate: false,
  playIntro: true,
};

export function parsePreferences(raw: string | null, bones: Bone[]): Preferences {
  if (!raw) return { ...defaultPreferences };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaultPreferences };
    const data = value as Record<string, unknown>;
    return {
      selectedBoneId: bones.some((bone) => bone.id === data.selectedBoneId) ? data.selectedBoneId as string : null,
      section: sections.includes(data.section as Section) ? data.section as Section : "explorer",
      region: bones.some((bone) => bone.region === data.region) ? data.region as Region : "All",
      side: ["Left", "Right", "Midline"].includes(data.side as string) ? data.side as Side : "All",
      autoRotate: data.autoRotate === true,
      playIntro: data.playIntro !== false,
    };
  } catch {
    return { ...defaultPreferences };
  }
}

export function readPreferences(bones: Bone[]): Preferences {
  try {
    return parsePreferences(localStorage.getItem(PREFERENCE_KEY), bones);
  } catch {
    return { ...defaultPreferences };
  }
}

export function shouldPlayIntro(enabled: boolean): boolean {
  if (!enabled || typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try { return sessionStorage.getItem(INTRO_KEY) !== "true"; } catch { return false; }
}

export function markIntroSeen(): void {
  try { sessionStorage.setItem(INTRO_KEY, "true"); } catch { /* Storage may be blocked by the browser. */ }
}
