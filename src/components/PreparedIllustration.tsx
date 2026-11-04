"use client";

import { useCallback, useMemo, useState } from "react";
import { bones as catalog } from "../data/anatomy";
import type { PreparedImageMatch } from "../lib/preparedIllustrations";
import type { AssetStatus, Bone, ViewerCommand } from "../lib/types";
import SkeletonViewer from "./SkeletonViewer";

const noSelection = () => undefined;

export function PreparedIllustration({ illustration, bones = catalog }: {
  illustration: PreparedImageMatch;
  bones?: Bone[];
}) {
  const [status, setStatus] = useState<AssetStatus | null>(null);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [command, setCommand] = useState<ViewerCommand | null>(null);
  const allBoneIds = useMemo(() => bones.map((bone) => bone.id), [bones]);
  const visibleBoneIds = showSkeleton ? allBoneIds : illustration.boneIds;
  const onStatus = useCallback((next: AssetStatus) => setStatus(next), []);
  const preparedFracture = useMemo(() => illustration.targetBoneId ? {
    boneId: illustration.targetBoneId,
    ...illustration.fracture,
  } : undefined, [illustration]);
  return <section className="case-panel" aria-label="Prepared illustration">
    <strong>{illustration.label}</strong>
    <h3>{illustration.title}</h3>
    <p>Prepared illustration—not AI reconstruction, not live AI prediction. Approximate preauthored anatomy and fracture location; not clinically validated.</p>
    <div className="case-actions" style={{ marginBottom: 12 }}>
      <button type="button" aria-pressed={showSkeleton} onClick={() => { setShowSkeleton(true); setCommand((previous) => ({ id: (previous?.id ?? 0) + 1, type: "reset" })); }}>Show crack in skeleton</button>
      <button type="button" aria-pressed={!showSkeleton} onClick={() => { setShowSkeleton(false); setCommand((previous) => ({ id: (previous?.id ?? 0) + 1, type: "focus" })); }}>Close-up broken bone</button>
      <button type="button" disabled={!illustration.targetBoneId || status?.state !== "ready"} onClick={() => setCommand((previous) => ({ id: (previous?.id ?? 0) + 1, type: "focus" }))}>Zoom to crack bone</button>
    </div>
    <div style={{ height: 460, width: "100%", position: "relative", background: "#08090b" }}>
      <SkeletonViewer key={illustration.sourceSha256} bones={bones} selectedBoneId={illustration.targetBoneId}
        relatedBoneIds={showSkeleton ? illustration.boneIds.filter((id) => id !== illustration.targetBoneId) : []} displayMode="all" autoRotate={false} command={command} assetRevision={0}
        preparedBoneIds={visibleBoneIds} preparedFracture={preparedFracture}
        onSelect={noSelection} onStatus={onStatus} />
    </div>
    {illustration.targetBoneId === null && <p>No exact rib number is known. All 12 right ribs are shown as context when mapped meshes are available; no fracture marker is invented.</p>}
    {status?.state === "ready" && illustration.boneIds.some((id) => !status.loadedBoneIds.includes(id)) &&
      <p role="status">Some prepared anatomy has no mapped mesh in the loaded asset. Missing anatomy is not substituted.</p>}
    <ul>{illustration.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
  </section>;
}

export default PreparedIllustration;
