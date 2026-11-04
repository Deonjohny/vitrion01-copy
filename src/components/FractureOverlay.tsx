"use client";

import { useEffect, useMemo } from "react";
import { CurvePath, LineCurve3, Mesh, TubeGeometry, Vector3 } from "three";
import { createFractureTrace, type FractureAnchor } from "../lib/fractureIllustration";

export interface IllustrationSettings {
  placing: boolean;
  anchor: FractureAnchor | null;
  size: number;
  angleDegrees: number;
  centerRequest: number;
}

const ignoreRaycast = () => undefined;
export function FractureOverlay({ mesh, anchor, size, angleDegrees, onRendered }: {
  mesh: Mesh;
  anchor: FractureAnchor;
  size: number;
  angleDegrees: number;
  onRendered: (visible: boolean) => void;
}) {
  const geometry = useMemo(() => {
    const trace = createFractureTrace(mesh, anchor, { size, angleDegrees });
    if (!trace || trace.points.length < 2) return null;
    const path = new CurvePath<Vector3>();
    for (let i = 1; i < trace.points.length; i++) path.add(new LineCurve3(trace.points[i - 1], trace.points[i]));
    return {
      edge: new TubeGeometry(path, Math.max(32, trace.points.length * 4), trace.radius * 10, 8, false),
      seam: new TubeGeometry(path, Math.max(32, trace.points.length * 4), trace.radius * 6, 8, false),
    };
  }, [mesh, anchor, size, angleDegrees]);
  useEffect(() => { onRendered(geometry !== null); }, [geometry, onRendered]);
  useEffect(() => () => { geometry?.edge.dispose(); geometry?.seam.dispose(); }, [geometry]);
  if (!geometry) return null;
  return <group>
    <mesh geometry={geometry.edge} raycast={ignoreRaycast} renderOrder={2}>
      <meshBasicMaterial color="#ffc36b" depthTest depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
    </mesh>
    <mesh geometry={geometry.seam} raycast={ignoreRaycast} renderOrder={3}>
      <meshBasicMaterial color="#15090b" depthTest depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
  </group>;
}
