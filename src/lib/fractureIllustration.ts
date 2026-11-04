import { Box3, Matrix3, Mesh, Raycaster, Vector3 } from "three";
import type { Intersection } from "three";

/** Manual illustrative surface mark, never a clinical reconstruction or model prediction. */
export interface FractureAnchor {
  boneId: string;
  meshUuid: string;
  /** World coordinates: R3F event.point.toArray(). */
  point: [number, number, number];
  /** World normal: event.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize().toArray(). */
  normal: [number, number, number];
}

const finiteTuple = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

type Sample = { target: Vector3; point: Vector3; normal: Vector3; triangle: Vector3[] };

/** Returns a deterministic, approximate world-space annotation on this static mesh only. */
export function createFractureTrace(
  mesh: Mesh,
  anchor: FractureAnchor,
  options: { size: number; angleDegrees: number },
): { points: Vector3[]; radius: number } | null {
  if (!mesh?.isMesh || !anchor || anchor.meshUuid !== mesh.uuid ||
      typeof anchor.boneId !== "string" || !anchor.boneId.trim() ||
      !finiteTuple(anchor.point) || !finiteTuple(anchor.normal) ||
      !options || !Number.isFinite(options.size) || options.size < 0.1 || options.size > 0.6 ||
      !Number.isFinite(options.angleDegrees) ||
      ("isSkinnedMesh" in mesh && mesh.isSkinnedMesh) ||
      ("isInstancedMesh" in mesh && mesh.isInstancedMesh) ||
      mesh.morphTargetInfluences?.some((weight) => weight !== 0)) return null;

  const normal = new Vector3(...anchor.normal);
  const normalLength = normal.length();
  if (!Number.isFinite(normalLength) || normalLength < 1e-12) return null;
  normal.divideScalar(normalLength);
  mesh.updateWorldMatrix(true, false);
  if (!mesh.matrixWorld.elements.every(Number.isFinite) ||
      !Number.isFinite(mesh.matrixWorld.determinant()) || mesh.matrixWorld.determinant() === 0) return null;
  const positions = mesh.geometry?.getAttribute("position");
  if (!positions || positions.itemSize < 3 || positions.count < 3) return null;
  const bounds = new Box3();
  const vertex = new Vector3();
  for (let index = 0; index < positions.count; index++) {
    vertex.fromBufferAttribute(positions, index);
    if (!vertex.toArray().every(Number.isFinite)) return null;
    bounds.expandByPoint(vertex);
  }
  const extent = bounds.getSize(new Vector3());
  // Transformed local extents avoid a rotated long bone inflating an axis-aligned world box.
  const dimensions = [
    new Vector3(extent.x, 0, 0).applyMatrix3(new Matrix3().setFromMatrix4(mesh.matrixWorld)).length(),
    new Vector3(0, extent.y, 0).applyMatrix3(new Matrix3().setFromMatrix4(mesh.matrixWorld)).length(),
    new Vector3(0, 0, extent.z).applyMatrix3(new Matrix3().setFromMatrix4(mesh.matrixWorld)).length(),
  ];
  if (!dimensions.every(Number.isFinite)) return null;
  const positiveDimensions = dimensions.filter((value) => value > 0);
  if (positiveDimensions.length < 2) return null;
  const shortDimension = Math.min(...positiveDimensions);
  const length = shortDimension * options.size;
  const radius = length * 0.004;
  const tolerance = shortDimension * 1e-6;
  if (!(radius > 0) || !Number.isFinite(radius) || !(tolerance > 0)) return null;
  const depth = length * 0.6;
  const origin = new Vector3(...anchor.point);
  const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
  const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
  axes.sort((a, b) => Math.abs(a.dot(normal)) - Math.abs(b.dot(normal)));
  const tangent = new Vector3().crossVectors(normal, axes[0]).normalize()
    .applyAxisAngle(normal, (options.angleDegrees % 360) * Math.PI / 180);
  const across = new Vector3().crossVectors(normal, tangent).normalize();
  const raycaster = new Raycaster();
  raycaster.layers.mask = mesh.layers.mask;
  raycaster.near = 0;
  raycaster.far = depth * 2;
  let projectionBudget = 1024;

  const project = (target: Vector3): Sample | null => {
    if (projectionBudget-- <= 0) return null;
    raycaster.set(target.clone().addScaledVector(normal, depth), normal.clone().negate());
    const hit: Intersection | undefined = raycaster.intersectObject(mesh, false)[0];
    if (!hit?.face || hit.object !== mesh || !hit.point.toArray().every(Number.isFinite)) return null;
    const surfaceNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    // Reject rear-facing folds, back walls and jumps beyond the local patch.
    if (surfaceNormal.dot(normal) < 0.5 || Math.abs(hit.point.clone().sub(target).dot(normal)) > depth) return null;
    return {
      target, point: hit.point.clone(), normal: surfaceNormal,
      triangle: [hit.face.a, hit.face.b, hit.face.c].map((index) =>
        new Vector3().fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld)),
    };
  };

  const center = project(origin);
  if (!center || center.point.distanceTo(origin) > tolerance * 10) return null;

  // A segment may cross only a shared triangle edge, not a gap between mesh islands.
  const covered = (a: Sample, b: Sample): boolean => {
    const shared = a.triangle.filter((vertex) => b.triangle.some((other) => vertex.distanceTo(other) <= tolerance));
    if (shared.length === 3) return true;
    if (shared.length !== 2) return false;
    const path = b.target.clone().sub(a.target);
    const side = (point: Vector3) => new Vector3().crossVectors(path, point.clone().sub(a.target)).dot(normal);
    const edge = shared[1].clone().sub(shared[0]);
    const edgeSide = (point: Vector3) => new Vector3().crossVectors(edge, point.clone().sub(shared[0])).dot(normal);
    return side(shared[0]) * side(shared[1]) <= 0 && edgeSide(a.target) * edgeSide(b.target) <= 0;
  };

  const connect = (a: Sample, b: Sample, budget = 10): Sample[] | null => {
    const span = a.target.distanceTo(b.target);
    if (a.normal.dot(b.normal) < 0.5 || a.point.distanceTo(b.point) > span * 2.1 + tolerance) return null;
    if (covered(a, b)) return [b];
    if (budget === 0 || span < tolerance) return null;
    const middle = project(a.target.clone().lerp(b.target, 0.5));
    if (!middle) return null;
    const left = connect(a, middle, budget - 1);
    if (!left) return null;
    const right = connect(middle, b, budget - 1);
    return right ? [...left, ...right] : null;
  };

  const walk = (direction: number): Sample[] => {
    const samples: Sample[] = [];
    let previous = center;
    // Fixed zigzag knots, densely sampled so curved patches closely follow the surface.
    const jitter = [0, 0.025, -0.018, 0.035, -0.025, 0.012, 0];
    for (let i = 1; i <= 48; i++) {
      const knot = i / 8;
      const lower = Math.floor(knot);
      const offset = jitter[lower] + ((jitter[lower + 1] ?? jitter[lower]) - jitter[lower]) * (knot - lower);
      const target = origin.clone().addScaledVector(tangent, direction * length * i / 96)
        .addScaledVector(across, direction * length * offset);
      const next = project(target);
      if (!next) break;
      const bridge = connect(previous, next);
      if (!bridge) break;
      samples.push(...bridge);
      previous = next;
    }
    return samples;
  };
  const samples = [...walk(-1).reverse(), center, ...walk(1)];
  if (samples.length < 3) return null;
  const points = samples.map((sample) => sample.point.clone().addScaledVector(sample.normal, radius * 0.35));
  return points.every((point) => point.toArray().every(Number.isFinite)) ? { points, radius } : null;
}
