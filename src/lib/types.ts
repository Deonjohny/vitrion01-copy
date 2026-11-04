export type Side = "Left" | "Right" | "Midline";
export type Division = "Axial" | "Appendicular";
export type Region = "Skull" | "Auditory ossicles" | "Hyoid" | "Vertebral column" | "Thoracic cage" | "Shoulder girdle" | "Upper limb" | "Hand" | "Pelvic girdle" | "Lower limb" | "Foot";

export interface AnatomySource {
  id: string;
  title: string;
  url: string;
  license: string;
}

export interface Bone {
  id: string;
  meshId: string;
  name: string;
  latinName: string | null;
  side: Side;
  region: Region;
  division: Division;
  category: "Long" | "Short" | "Flat" | "Irregular" | "Sesamoid";
  group: string;
  counterpartId: string | null;
  connectedBoneIds: string[];
  joints: string[];
  landmarks: string[];
  functions: string[];
  clinicalInformation: string[];
  fractureRegions: string[];
  dimensions: null;
  spatial: null;
  sourceIds: string[];
}

export interface AssetManifest {
  schemaVersion: 1;
  name: string;
  license: string;
  sourceUrl: string;
  attribution: string;
  modelUrl: string;
  units: "m" | "cm" | "mm";
  orientation: "Y_UP_ANTERIOR_POSITIVE_Z";
  meshes: { boneId: string; nodeName: string }[];
}

export type CameraView = "anterior" | "posterior" | "left" | "right" | "superior" | "inferior" | "oblique";
export type DisplayMode = "all" | "isolate" | "connected" | "region";
export interface ViewerCommand {
  id: number;
  type: "view" | "focus" | "reset" | "zoomIn" | "zoomOut";
  view?: CameraView;
}
export interface AssetStatus {
  state: "missing" | "loading" | "ready" | "error";
  message: string;
  loadedBoneIds: string[];
}
export interface SkeletonViewerProps {
  bones: Bone[];
  selectedBoneId: string | null;
  relatedBoneIds: string[];
  displayMode: DisplayMode;
  autoRotate: boolean;
  command: ViewerCommand | null;
  assetRevision: number;
  preparedBoneIds?: string[];
  preparedFracture?: {
    boneId: string;
    positionFraction: [number, number, number];
    size: number;
    angleDegrees: number;
  };
  onSelect: (id: string) => void;
  onStatus: (status: AssetStatus) => void;
}
