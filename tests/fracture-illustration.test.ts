import { describe, expect, it } from "vitest";
import {
  BoxGeometry, BufferGeometry, CylinderGeometry, Group, Matrix3, Mesh,
  InstancedMesh, InterleavedBuffer, InterleavedBufferAttribute, MeshBasicMaterial,
  PerspectiveCamera, Raycaster, SkinnedMesh, SphereGeometry, Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createFractureTrace, type FractureAnchor } from "../src/lib/fractureIllustration";

const options = { size: 0.4, angleDegrees: 0 };
function anchorAt(mesh: Mesh, point = new Vector3(0, 0, 1), normal = new Vector3(0, 0, 1)): FractureAnchor {
  mesh.updateWorldMatrix(true, false);
  return {
    boneId: "MANUAL-ILLUSTRATION", meshUuid: mesh.uuid,
    point: point.clone().applyMatrix4(mesh.matrixWorld).toArray(),
    normal: normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize().toArray(),
  };
}
function assertSurface(mesh: Mesh, anchor: FractureAnchor, settings = options) {
  const trace = createFractureTrace(mesh, anchor, settings);
  expect(trace).not.toBeNull();
  if (!trace) throw new Error("Expected a surface trace");
  expect(trace.points.length).toBeGreaterThan(2);
  expect(Number.isFinite(trace.radius)).toBe(true);
  expect(trace.radius).toBeGreaterThan(0);
  const normal = new Vector3(...anchor.normal);
  const ray = new Raycaster();
  ray.layers.mask = mesh.layers.mask;
  for (const point of trace.points) {
    expect(point.toArray().every(Number.isFinite)).toBe(true);
    ray.set(point.clone().addScaledVector(normal, 10), normal.clone().negate());
    const hit = ray.intersectObject(mesh, false)[0];
    expect(hit).toBeDefined();
    expect(hit.point.distanceTo(point)).toBeLessThan(trace.radius);
    expect(point.clone().sub(hit.point).dot(normal)).toBeGreaterThan(0);
  }
  expect(Math.min(...trace.points.map((point) => point.distanceTo(new Vector3(...anchor.point)))))
    .toBeLessThan(trace.radius);
  return trace;
}

describe("manual illustrative fracture surface trace (not clinical reconstruction)", () => {
  it("is deterministic, jagged, centered on the click and slightly above a real box", () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    const anchor = anchorAt(mesh);
    const trace = assertSurface(mesh, anchor);
    expect(createFractureTrace(mesh, anchor, options)).toEqual(trace);
    expect(new Set(trace.points.map((point) => point.x.toFixed(5))).size).toBeGreaterThan(5);
    const before = trace.points.map((point) => point.toArray());
    const camera = new PerspectiveCamera();
    camera.position.set(10, -4, 3);
    camera.lookAt(0, 0, 0);
    expect(createFractureTrace(mesh, anchor, options)?.points.map((point) => point.toArray())).toEqual(before);
    const moved = assertSurface(mesh, anchorAt(mesh, new Vector3(0.4, 0.2, 1)));
    expect(moved.points[0].clone().sub(trace.points[0]).toArray()).toEqual([0.4, 0.2, 0]);
  });

  it("rotates the path around the clicked normal without moving its center", () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    const anchor = anchorAt(mesh);
    const initial = assertSurface(mesh, anchor);
    const rotated = assertSurface(mesh, anchor, { ...options, angleDegrees: 90 });
    initial.points.forEach((point, index) => {
      const expected = point.clone().sub(new Vector3(...anchor.point))
        .applyAxisAngle(new Vector3(...anchor.normal), Math.PI / 2).add(new Vector3(...anchor.point));
      expect(rotated.points[index].distanceTo(expected)).toBeLessThan(1e-10);
    });
    expect(createFractureTrace(mesh, anchor, { ...options, angleDegrees: 360 })).toEqual(initial);
  });

  it.each([
    ["box", () => new BoxGeometry(2, 3, 2), new Vector3(0, 0, 1)],
    ["cylinder", () => new CylinderGeometry(1, 1, 12, 64), new Vector3(0, 0, 1)],
    ["sphere", () => new SphereGeometry(1, 48, 32), new Vector3(0, 0, 1)],
  ] as const)("conforms to a translated, rotated, nonuniformly scaled %s with parent transforms", (_name, geometry, point) => {
    const parent = new Group();
    parent.position.set(3, -2, 5);
    parent.rotation.set(0.2, -0.4, 0.1);
    parent.scale.set(1.2, 0.8, 1.5);
    const mesh = new Mesh(geometry());
    mesh.position.set(0.5, 1, -0.5);
    mesh.rotation.set(-0.15, 0.3, -0.2);
    mesh.scale.set(0.7, 1.4, 0.9);
    mesh.layers.set(2);
    parent.add(mesh);
    assertSurface(mesh, anchorAt(mesh, point), { size: 0.6, angleDegrees: 39 });
  });

  it("keeps long-bone marks proportional to the short dimension, not its length", () => {
    const mesh = new Mesh(new CylinderGeometry(1, 1, 1000, 64));
    const anchor = anchorAt(mesh);
    const trace = assertSurface(mesh, anchor, { size: 0.6, angleDegrees: 0 });
    expect(trace.points[0].distanceTo(trace.points.at(-1)!)).toBeLessThanOrEqual(1.21);
    expect(trace.radius).toBeCloseTo(1.2 * 0.004);
  });

  it("truncates at an edge instead of snapping onto another bone or a child mesh", () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    const child = new Mesh(new BoxGeometry(10, 10, 0.1));
    child.position.z = 1.2;
    mesh.add(child);
    const anchor = anchorAt(mesh, new Vector3(0.99, 0, 1));
    const trace = assertSurface(mesh, anchor, { size: 0.6, angleDegrees: 90 });
    expect(trace.points.every((point) => point.x <= 1 && point.z < 1.01)).toBe(true);
    expect(trace.points.length).toBeLessThan(97);
    expect(createFractureTrace(child, anchor, options)).toBeNull();
  });

  it("does not bridge even a sub-sample-width gap between disconnected parts of the SAME mesh", () => {
    const center = new BoxGeometry(0.1, 2, 1);
    const island = new BoxGeometry(0.1, 2, 1).translate(0.10001, 0, 0);
    const mesh = new Mesh(mergeGeometries([center, island]));
    const trace = assertSurface(mesh, anchorAt(mesh, new Vector3(0, 0, 0.5)), { size: 0.6, angleDegrees: 90 });
    expect(trace.points.every((point) => point.x <= 0.050001)).toBe(true);
  });

  it("never drops from an edge to a disconnected lower surface", () => {
    const upper = new BoxGeometry(0.1, 2, 0.02);
    const lower = new BoxGeometry(1, 2, 0.02).translate(0, 0, -0.04);
    const mesh = new Mesh(mergeGeometries([upper, lower]));
    const trace = assertSurface(mesh, anchorAt(mesh, new Vector3(0.049, 0, 0.01)), { size: 0.6, angleDegrees: 90 });
    expect(trace.points.every((point) => point.z > 0.009 && point.x <= 0.050001)).toBe(true);
  });

  it("rejects anchors away from the surface, inward normals and mismatched mesh IDs", () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    const anchor = anchorAt(mesh);
    expect(createFractureTrace(mesh, { ...anchor, meshUuid: new Mesh().uuid }, options)).toBeNull();
    for (const point of [[0, 0, 1.1], [0, 0, 0], [20, 0, 1]] as [number, number, number][]) {
      expect(createFractureTrace(mesh, { ...anchor, point }, options)).toBeNull();
    }
    expect(createFractureTrace(mesh, { ...anchor, normal: [0, 0, -1] }, options)).toBeNull();
  });

  it.each([0, -1, 0.099, 0.601, 20, NaN, Infinity])("rejects invalid/out-of-range size %s", (size) => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    expect(createFractureTrace(mesh, anchorAt(mesh), { size, angleDegrees: 0 })).toBeNull();
  });

  it.each([0.1, 0.6])("accepts the UI size boundary %s", (size) => {
    const mesh = new Mesh(new SphereGeometry(1, 32, 24));
    assertSurface(mesh, anchorAt(mesh), { size, angleDegrees: 12 });
  });

  it("supports interleaved static asset positions without rewriting them", () => {
    const geometry = new BoxGeometry(2, 2, 2);
    const data = new InterleavedBuffer(new Float32Array(geometry.getAttribute("position").array), 3);
    const attribute = new InterleavedBufferAttribute(data, 3, 0);
    geometry.setAttribute("position", attribute);
    const mesh = new Mesh(geometry);
    assertSurface(mesh, anchorAt(mesh));
    expect(geometry.getAttribute("position")).toBe(attribute);
  });

  it("accepts a real oblique R3F-style ray hit with its face normal transformed to world space", () => {
    const mesh = new Mesh(new SphereGeometry(1, 48, 32));
    mesh.scale.set(0.5, 2, 1);
    mesh.position.set(2, 3, 4);
    mesh.rotation.set(0.3, 0.2, -0.1);
    mesh.updateWorldMatrix(true, false);
    const origin = new Vector3(3, 4, 6);
    const ray = new Raycaster(origin, mesh.position.clone().sub(origin).normalize());
    const hit = ray.intersectObject(mesh)[0];
    expect(hit.face).toBeDefined();
    const anchor: FractureAnchor = {
      boneId: "MANUAL-ILLUSTRATION", meshUuid: mesh.uuid, point: hit.point.toArray(),
      normal: hit.face!.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize().toArray(),
    };
    assertSurface(mesh, anchor, { size: 0.6, angleDegrees: -37 });
  });

  it("rejects nonstatic meshes, nonfinite vertices, and a mesh with no raycast hits", () => {
    const geometry = new BoxGeometry(2, 2, 2);
    for (const mesh of [new SkinnedMesh(geometry), new InstancedMesh(geometry, new MeshBasicMaterial(), 1)]) {
      expect(createFractureTrace(mesh, anchorAt(mesh), options)).toBeNull();
    }
    const mesh = new Mesh(geometry);
    const anchor = anchorAt(mesh);
    mesh.morphTargetInfluences = [0.5];
    expect(createFractureTrace(mesh, anchor, options)).toBeNull();
    mesh.morphTargetInfluences = [];
    geometry.setDrawRange(0, 0);
    expect(createFractureTrace(mesh, anchor, options)).toBeNull();
    geometry.setDrawRange(0, Infinity);
    geometry.getAttribute("position").setX(0, NaN);
    expect(createFractureTrace(mesh, anchor, options)).toBeNull();
  });

  it("rejects malformed/nonfinite data and degenerate geometry/transforms", () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    const anchor = anchorAt(mesh);
    for (const normal of [[0, 0, 0], [NaN, 0, 1], [0, Infinity, 1], [0, 1], null]) {
      expect(createFractureTrace(mesh, { ...anchor, normal } as FractureAnchor, options)).toBeNull();
    }
    expect(createFractureTrace(mesh, { ...anchor, point: [0, NaN, 1] }, options)).toBeNull();
    expect(createFractureTrace(mesh, anchor, { ...options, angleDegrees: Infinity })).toBeNull();
    const empty = new Mesh(new BufferGeometry());
    expect(createFractureTrace(empty, anchorAt(empty), options)).toBeNull();
    mesh.scale.z = 0;
    expect(createFractureTrace(mesh, anchor, options)).toBeNull();
    mesh.scale.z = Infinity;
    expect(createFractureTrace(mesh, anchor, options)).toBeNull();
  });
});
