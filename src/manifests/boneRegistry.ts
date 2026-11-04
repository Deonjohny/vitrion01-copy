import { bones } from "../data/anatomy";
import type { Bone } from "../lib/types";
import manifest from "../../public/anatomy/manifest.json";
import spatial from "../../public/anatomy/bone-spatial.json";

type Point3 = readonly [number, number, number];

export interface BoneRegistryEntry {
  /** The permanent catalog entry, not a duplicated anatomy catalog. */
  catalog: Bone;
  boneId: string;
  nodeNames: readonly string[];
  mappingStatus: "source-name-mapped" | "missing";
  clinicalVerification: false;
  ontology: { fma: string | null; ta2: string | null; radlex: string | null };
  dimensions: null;
  /** Metres; midpoint of loaded world-space bounds, not center of mass. */
  centroid: Point3 | null;
  modelBounds: { min: Point3; max: Point3 } | null;
}

type Measurement = { centroid: number[]; bounds: { min: number[]; max: number[] } };
const measurements: Record<string, Measurement> = spatial.bones;
function point(value: number[]): Point3 {
  if (value.length !== 3 || !value.every(Number.isFinite)) throw new Error("Invalid exported spatial measurement");
  return [value[0], value[1], value[2]];
}

export const boneRegistry: readonly BoneRegistryEntry[] = bones.map((catalog) => {
  const nodeNames = manifest.meshes.filter((mesh) => mesh.boneId === catalog.id).map((mesh) => mesh.nodeName);
  const measurement = nodeNames.length ? measurements[catalog.id] : undefined;
  return {
    catalog, boneId: catalog.id, nodeNames,
    mappingStatus: nodeNames.length ? "source-name-mapped" : "missing",
    clinicalVerification: false,
    // A matching English source label is not a verified ontology crosswalk.
    ontology: { fma: null, ta2: null, radlex: null },
    dimensions: null,
    centroid: measurement ? point(measurement.centroid) : null,
    modelBounds: measurement ? { min: point(measurement.bounds.min), max: point(measurement.bounds.max) } : null,
  };
});

export const boneRegistryById = new Map(boneRegistry.map((entry) => [entry.boneId, entry]));
