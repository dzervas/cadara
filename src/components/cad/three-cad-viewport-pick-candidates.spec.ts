import { test, expect } from "vitest";
import * as THREE from "three";

import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  RegionId,
  RenderableId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import {
  createLineEntityDefinition,
  createCircleEntityDefinition,
  createArcEntityDefinition,
  createPointDefinition,
  createSplineEntityDefinition,
} from "@/domain/editor/sketch-session/internals";
import {
  createNewSketchSession,
  type SketchSessionDisplayRenderable,
} from "@/domain/editor/sketch-session";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import {
  collectProjectedSketchCurveCandidates,
  collectProjectedSketchDisplayPointCandidates,
} from "@/components/cad/three-cad-viewport-pick-candidates";
import {
  bindRenderableObject,
  collectRaycastPickCandidates,
  createProjectedPickCandidate,
  resolveAllCandidates,
} from "@/infrastructure/viewport/render-picking";
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import { curveLength } from "@/contracts/sketch/region-boundary-curves";
import {
  closestPointOnSolvedCubicSpans,
  solvedCubicSpans,
  tessellateCubicSpans,
  type SolvedCubicSpan,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";
import {
  createSketchSessionFromSnapshot,
  getSketchSessionDisplayRenderables,
} from "@/domain/editor/sketch-session";
import {
  collectSketchSnapGeometries,
  resolveSketchSnap,
} from "@/domain/sketch-snapping/snap-candidates";
import { deriveMeasurementViewModel } from "@/domain/measure/measurement";
import { buildSketchVectorExportModel } from "@/domain/export/sketch-vector-export-model";
import { svgSketchExportProvider } from "@/domain/export/providers/svg-sketch-export-provider";
import type { ExportCapabilities } from "@/contracts/export/capabilities";

test("src/components/cad/three-cad-viewport-pick-candidates.spec.ts", () => {
  const viewportRect = {
    left: 10,
    top: 20,
    width: 200,
    height: 200,
  } as DOMRectReadOnly;
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const originTarget = {
    kind: "sketchDatumReference",
    sketchId: "sketch_primary",
    datumId: "origin",
    geometryKind: "point",
  } satisfies PrimitiveRef;
  const xAxisTarget = {
    kind: "sketchDatumReference",
    sketchId: "sketch_primary",
    datumId: "xAxis",
    geometryKind: "lineSegment",
  } satisfies PrimitiveRef;

  const originRenderable = {
    id: "renderable_sketch_datum_origin_sketch_primary" as RenderableId,
    label: "Sketch origin",
    target: originTarget,
    geometry: {
      kind: "marker",
      position: [0, 0, 0],
      displayRadius: 0.18,
    },
    linePattern: "solid",
    role: "reference",
  } satisfies SketchSessionDisplayRenderable;
  const xAxisRenderable = {
    id: "renderable_sketch_datum_xAxis_sketch_primary" as RenderableId,
    label: "Sketch X axis",
    target: xAxisTarget,
    geometry: {
      kind: "polyline",
      points: [
        [-20, 0, 0],
        [20, 0, 0],
      ],
      isClosed: false,
    },
    linePattern: "dashed",
    role: "reference",
  } satisfies SketchSessionDisplayRenderable;

  const originCandidates = collectProjectedSketchDisplayPointCandidates({
    clientX: viewportRect.left + 100,
    clientY: viewportRect.top + 100,
    camera,
    viewportRect,
    sketchDisplayRenderables: [originRenderable, xAxisRenderable],
    acceptsTarget: () => true,
    currentHoverTarget: null,
  });

  expect(
    originCandidates.length,
    "The sketch datum origin should produce a projected pick candidate.",
  ).toBe(1);
  expect(
    originCandidates[0]?.semanticClass,
    "The sketch datum origin should sort as a point, not as a reference wire.",
  ).toBe("sketchPoint");

  const axisLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-10, 0, 0),
      new THREE.Vector3(10, 0, 0),
    ]),
    new THREE.LineBasicMaterial(),
  );
  bindRenderableObject(
    axisLine,
    null,
    xAxisTarget,
    "sketchReference",
    "document",
  );
  const axisHit = collectRaycastPickCandidates([
    {
      object: axisLine,
      distance: 10,
      point: new THREE.Vector3(0, 0, 0),
    } as THREE.Intersection<THREE.Object3D>,
  ]);

  expect(
    resolveAllCandidates([...axisHit, ...originCandidates])?.target,
    "The origin point should remain pickable at the datum-axis crossing.",
  ).toBe(originTarget);

  const axisCandidates = collectProjectedSketchCurveCandidates({
    clientX: viewportRect.left + 140,
    clientY: viewportRect.top + 100,
    camera,
    viewportRect,
    sketchSession: {
      ...createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      sketchId: "sketch_primary",
    },
    acceptsTarget: () => true,
    currentHoverTarget: null,
  });

  expect(
    axisCandidates.length,
    "The sketch datum axis should have a screen-space pick candidate.",
  ).toBe(1);
  expect(
    axisCandidates[0]?.target.kind === "sketchDatumReference" &&
      axisCandidates[0].target.datumId === "xAxis",
    "The screen-space datum-axis candidate should preserve the datum reference target.",
  ).toBeTruthy();

  const sessionAxisCandidates = collectProjectedSketchCurveCandidates({
    clientX: viewportRect.left + 140,
    clientY: viewportRect.top + 100,
    camera,
    viewportRect,
    sketchSession: createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
    acceptsTarget: () => true,
    currentHoverTarget: null,
  });

  expect(
    sessionAxisCandidates.some(
      (candidate) =>
        candidate.target.kind === "sketchDatumReference" &&
        candidate.target.datumId === "xAxis",
    ),
    "The active sketch session should provide datum-axis pick candidates even when the line renderable is not ray-pickable.",
  ).toBeTruthy();

  axisLine.geometry.dispose();
  (axisLine.material as THREE.Material).dispose();
});

test("active sketch curves are collected as screen-space semantic candidates", () => {
  const viewportRect = {
    left: 0,
    top: 0,
    width: 200,
    height: 200,
  } as DOMRectReadOnly;
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const sketchId = "sketch_primary" as SketchId;
  const session = makeCurveSession(sketchId);
  const lineTarget = session.definition.entities.find(
    (entry) => entry.entityId === "sketch_entity_line",
  )!.target;
  const constructionTarget = session.definition.entities.find(
    (entry) => entry.entityId === "sketch_entity_construction",
  )!.target;

  const lineCandidates = collectProjectedSketchCurveCandidates({
    clientX: 100,
    clientY: 128,
    camera,
    viewportRect,
    sketchSession: session,
    acceptsTarget: () => true,
    currentHoverTarget: null,
  });

  expect(
    lineCandidates.some((candidate) => candidate.target === lineTarget),
    "A pointer within the 10px sketch-curve radius should pick the semantic local line.",
  ).toBeTruthy();

  const constructionCandidates = collectProjectedSketchCurveCandidates({
    clientX: 100,
    clientY: 88,
    camera,
    viewportRect,
    sketchSession: session,
    acceptsTarget: () => true,
    currentHoverTarget: null,
  });

  expect(
    constructionCandidates.some(
      (candidate) => candidate.target === constructionTarget,
    ),
    "Dashed construction curves should remain pickable through semantic geometry, including visual dash gaps.",
  ).toBeTruthy();

  const hoveredExitCandidates = collectProjectedSketchCurveCandidates({
    clientX: 100,
    clientY: 134,
    camera,
    viewportRect,
    sketchSession: session,
    acceptsTarget: () => true,
    currentHoverTarget: lineTarget,
  });

  expect(
    hoveredExitCandidates.some((candidate) => candidate.target === lineTarget),
    "Hovered sketch curves should use the larger 14px exit radius.",
  ).toBeTruthy();
});

test("semantic sketch curves keep existing candidate ranking against points and regions", () => {
  const pointTarget = {
    kind: "sketchPoint",
    sketchId: "sketch_primary",
    pointId: "sketch_point_nearby",
  } satisfies PrimitiveRef;
  const curveTarget = {
    kind: "sketchEntity",
    sketchId: "sketch_primary",
    entityId: "sketch_entity_line",
  } satisfies PrimitiveRef;
  const regionTarget = {
    kind: "region",
    sketchId: "sketch_primary",
    regionId: "region_profile" as RegionId,
  } satisfies PrimitiveRef;

  const point = createProjectedPickCandidate({
    pickId: null,
    target: pointTarget,
    semanticClass: "sketchPoint",
    screenDistance: 6,
    depth: 0,
  });
  const curve = createProjectedPickCandidate({
    pickId: null,
    target: curveTarget,
    semanticClass: "sketchCurve",
    screenDistance: 0,
    depth: 0,
  });
  const region = createProjectedPickCandidate({
    pickId: null,
    target: regionTarget,
    semanticClass: "region",
    screenDistance: 0,
    depth: 0,
  });

  expect(
    resolveAllCandidates([curve, point])?.target,
    "Sketch points should outrank nearby semantic curve candidates.",
  ).toBe(pointTarget);
  expect(
    resolveAllCandidates([region, curve])?.target,
    "Semantic curve candidates should outrank regions.",
  ).toBe(curveTarget);
});

// Lane: ui (docs/testing.md). Seam: screen-space sketch-curve pick wiring of
// a derived offset shell (T08b-g5b): the candidate is the shell entity, along
// its solved spans clipped to `queryDomain` (fabricated solved record: the
// render-local contract, not offset geometry).
test("a derived offset shell is picked along its drawn (queryDomain) spans and never along its trimmed-off tail", () => {
  const viewportRect = {
    left: 0,
    top: 0,
    width: 200,
    height: 200,
  } as DOMRectReadOnly;
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const sketchId = "sketch_primary" as SketchId;
  const shellId = "sketch_entity_shell" as SketchEntityId;
  const base = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  const shell = {
    kind: "derivedPiecewiseCubic",
    entityId: shellId,
    label: "Offset shell",
    target: { kind: "sketchEntity", sketchId, entityId: shellId },
    isConstruction: false,
    derivationId: "derivation_shell",
  } as const;
  // One straight cubic from x = -8 to x = 8 on y = 0, drawn on [-4, 8] only.
  const record = {
    entityId: shellId,
    kind: "derivedPiecewiseCubic",
    publication: "certified",
    spans: [
      {
        outputSpanId: "a>b",
        subIndex: 0,
        sourceLocalInterval: [0, 1],
        sourceDomain: [0, 1],
        queryDomain: [0.25, 1],
        poles: [
          [-8, 0],
          [-8 / 3, 0],
          [8 / 3, 0],
          [8, 0],
        ],
        certifiedError: 0,
      },
    ],
  } as const;
  const definition = {
    ...base.definition,
    entityIds: [shellId],
    entities: [shell],
  } as unknown as SketchDefinition;
  const session = {
    ...base,
    sketchId,
    definition,
    liveSolve: {
      definition,
      projectedReferences: [],
      solvedSnapshot: { solvedEntities: [record], solvedPoints: [] },
      accepted: true,
    },
  } as never;
  const at = (x: number) =>
    collectProjectedSketchCurveCandidates({
      clientX: 100 + x * 10,
      clientY: 100,
      camera,
      viewportRect,
      sketchSession: session,
      acceptsTarget: () => true,
      currentHoverTarget: null,
    }).some(
      (candidate) =>
        candidate.target.kind === "sketchEntity" &&
        candidate.target.entityId === shellId,
    );
  expect(at(4), "The drawn part of the shell picks the shell entity.").toBe(
    true,
  );
  expect(
    at(-7),
    "The trimmed-off tail (x < -4) is not drawn and never picks the shell.",
  ).toBe(false);

  // Under a perspective camera (T11b: the clipped poles' rational cubic).
  const perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  perspective.position.set(0, -20, 8);
  perspective.up.set(0, 0, 1);
  perspective.lookAt(0, 0, 0);
  perspective.updateProjectionMatrix();
  perspective.updateMatrixWorld(true);
  const atPerspective = (x: number) => {
    const projected = new THREE.Vector3(x, 0, 0).project(perspective);
    return collectProjectedSketchCurveCandidates({
      clientX: ((projected.x + 1) / 2) * viewportRect.width,
      clientY: ((-projected.y + 1) / 2) * viewportRect.height,
      camera: perspective,
      viewportRect,
      sketchSession: session,
      acceptsTarget: () => true,
      currentHoverTarget: null,
    }).find(
      (candidate) =>
        candidate.target.kind === "sketchEntity" &&
        candidate.target.entityId === shellId,
    );
  };
  expect(
    atPerspective(4)?.screenDistance,
    "Perspective: the drawn part picks the shell exactly.",
  ).toBeLessThan(1e-9);
  expect(
    atPerspective(-7),
    "Perspective: the trimmed-off tail never picks the shell.",
  ).toBeUndefined();
});

function makeCurveSession(sketchId: SketchId) {
  const point = (suffix: string, position: SketchPoint2D) =>
    createPointDefinition(
      sketchId,
      `sketch_point_${suffix}` as SketchPointId,
      suffix,
      position,
    );
  const points = [
    point("line_a", [-4, -2]),
    point("line_b", [4, -2]),
    point("construction_a", [-4, 2]),
    point("construction_b", [4, 2]),
    point("center", [0, 0]),
    point("arc_start", [2, 0]),
    point("arc_end", [0, 2]),
    point("spline_a", [-2, -4]),
    point("spline_b", [0, -3]),
    point("spline_c", [2, -4]),
  ];
  const line = createLineEntityDefinition(
    sketchId,
    "sketch_entity_line" as SketchEntityId,
    "Line",
    points[0]!.pointId,
    points[1]!.pointId,
  );
  const constructionLine = createLineEntityDefinition(
    sketchId,
    "sketch_entity_construction" as SketchEntityId,
    "Construction",
    points[2]!.pointId,
    points[3]!.pointId,
    true,
  );
  const circle = createCircleEntityDefinition(
    sketchId,
    "sketch_entity_circle" as SketchEntityId,
    "Circle",
    points[4]!.pointId,
    2,
  );
  const arc = createArcEntityDefinition(
    sketchId,
    "sketch_entity_arc" as SketchEntityId,
    "Arc",
    points[4]!.pointId,
    points[5]!.pointId,
    points[6]!.pointId,
    "counterClockwise",
  );
  const spline = createSplineEntityDefinition(
    sketchId,
    "sketch_entity_spline" as SketchEntityId,
    "Spline",
    [points[7]!.pointId, points[8]!.pointId, points[9]!.pointId],
  );
  const definition: SketchDefinition = {
    ...createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ).definition,
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: [
      line.entityId,
      constructionLine.entityId,
      circle.entityId,
      arc.entityId,
      spline.entityId,
    ],
    entities: [line, constructionLine, circle, arc, spline],
  };

  return {
    ...createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
    sketchId,
    definition,
  };
}

// Lane: ui (docs/testing.md). Seam: `collectProjectedSketchCurveCandidates`
// for a spline (T10f, review A6). The metric: the pointer ray meets the
// sketch plane at P; the candidate distance is |screen(C) - pointer| with C
// the curve's closest point to P. Expected values use an independent
// closest point (dense grid + golden section on Bernstein cubics).
function waveSession() {
  const sketch = makeSketchFixture();
  sketch.point("a", 0, 0);
  sketch.point("b", 3, 4);
  sketch.point("c", 6, -1);
  sketch.point("d", 10, 3);
  sketch.spline("wave", ["a", "b", "c", "d"], "open");
  const input = sketch.build();
  const record = sketchSnapshotRecordForTest(
    input,
    [],
    createStandardPlaneDefinition("xy"),
  );
  const session = createSketchSessionFromSnapshot(record, OCC_KERNEL_SETTINGS);
  const spans = solvedCubicSpans(
    input.solvedSnapshot.solvedEntities.find(
      (entry) => entry.entityId === "sketch_entity_wave",
    )!,
  );
  return { session, record, spans };
}

function bernsteinPoint(span: SolvedCubicSpan, t: number): SplineVector {
  const s = 1 - t;
  const weights = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
  return [0, 1].map((axis) =>
    span.poles.reduce(
      (sum, pole, index) => sum + weights[index]! * pole[axis]!,
      0,
    ),
  ) as unknown as SplineVector;
}

function oracleClosestPoint(
  spans: readonly SolvedCubicSpan[],
  point: SplineVector,
): SplineVector {
  const gap = (at: SplineVector) =>
    Math.hypot(at[0] - point[0], at[1] - point[1]);
  let best: SplineVector = spans[0]!.poles[0];
  for (const span of spans) {
    const grid = 4000;
    let k0 = 0;
    for (let k = 0; k <= grid; k += 1)
      if (
        gap(bernsteinPoint(span, k / grid)) <
        gap(bernsteinPoint(span, k0 / grid))
      )
        k0 = k;
    let low = Math.max(0, (k0 - 1) / grid);
    let high = Math.min(1, (k0 + 1) / grid);
    const ratio = (Math.sqrt(5) - 1) / 2;
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const a = high - ratio * (high - low);
      const b = low + ratio * (high - low);
      if (gap(bernsteinPoint(span, a)) < gap(bernsteinPoint(span, b))) high = b;
      else low = a;
    }
    const candidate = bernsteinPoint(span, (low + high) / 2);
    if (gap(candidate) < gap(best)) best = candidate;
  }
  return best;
}

const PICK_RECT = {
  left: 0,
  top: 0,
  width: 200,
  height: 200,
} as DOMRectReadOnly;

function screenOf(camera: THREE.Camera, point: SplineVector) {
  const projected = new THREE.Vector3(point[0], point[1], 0).project(camera);
  return {
    x: ((projected.x + 1) / 2) * PICK_RECT.width,
    y: ((-projected.y + 1) / 2) * PICK_RECT.height,
  };
}

function planePointOf(camera: THREE.Camera, pointer: { x: number; y: number }) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2(
      (pointer.x / PICK_RECT.width) * 2 - 1,
      -(pointer.y / PICK_RECT.height) * 2 + 1,
    ),
    camera,
  );
  const hit = raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    new THREE.Vector3(),
  )!;
  return [hit.x, hit.y] as SplineVector;
}

function waveCandidates(
  session: ReturnType<typeof waveSession>["session"],
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera,
  pointer: { x: number; y: number },
  hovered = false,
) {
  const target = session.definition.entities.find(
    (entity) => entity.entityId === "sketch_entity_wave",
  )!.target;
  return collectProjectedSketchCurveCandidates({
    clientX: pointer.x,
    clientY: pointer.y,
    camera,
    viewportRect: PICK_RECT,
    sketchSession: session,
    acceptsTarget: () => true,
    currentHoverTarget: hovered ? target : null,
  }).filter(
    (candidate) =>
      candidate.target.kind === "sketchEntity" &&
      candidate.target.entityId === "sketch_entity_wave",
  );
}

/**
 * Independent exact screen distance of cubic spans under any camera: each
 * span evaluated as a polynomial cubic and projected point by point on a
 * 4000-step grid, refined by golden section around every grid local
 * minimum (untrimmed spans). Also returns the NDC depth of the closest
 * point.
 */
function screenOracle(
  spans: readonly SolvedCubicSpan[],
  camera: THREE.Camera,
  rect: DOMRectReadOnly,
  pointer: { x: number; y: number },
) {
  const grid = 4000;
  const project = (span: SolvedCubicSpan, t: number) => {
    const point = bernsteinPoint(span, t);
    const projected = new THREE.Vector3(point[0], point[1], 0).project(camera);
    const x = ((projected.x + 1) / 2) * rect.width;
    const y = ((-projected.y + 1) / 2) * rect.height;
    return {
      distance: Math.hypot(x - pointer.x, y - pointer.y),
      depth: projected.z,
    };
  };
  let best = project(spans[0]!, 0);
  const ratio = (Math.sqrt(5) - 1) / 2;
  for (const span of spans) {
    const values = Array.from(
      { length: grid + 1 },
      (_, k) => project(span, k / grid).distance,
    );
    for (let k = 0; k <= grid; k += 1) {
      if (
        (k > 0 && values[k - 1]! < values[k]!) ||
        (k < grid && values[k + 1]! < values[k]!)
      )
        continue;
      let low = Math.max(0, (k - 1) / grid);
      let high = Math.min(1, (k + 1) / grid);
      for (let iteration = 0; iteration < 200; iteration += 1) {
        const a = high - ratio * (high - low);
        const b = low + ratio * (high - low);
        if (project(span, a).distance < project(span, b).distance) high = b;
        else low = a;
      }
      for (const candidate of [
        project(span, k / grid),
        project(span, (low + high) / 2),
      ])
        if (candidate.distance < best.distance) best = candidate;
    }
  }
  return best;
}

function topCamera() {
  // 12.5 px per sketch unit, looking down -z at the wave.
  const camera = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 100);
  camera.position.set(5, 1.5, 10);
  camera.lookAt(5, 1.5, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function perspectiveCamera(position: [number, number, number]) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(...position);
  camera.up.set(0, 0, 1);
  camera.lookAt(5, 1.5, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

test("a spline's pick distance is the exact metric, not its display polyline's", () => {
  const { session, spans } = waveSession();
  const camera = topCamera();
  // Between two display samples of span 1 (16 per span), 0.3 units off the
  // curve along its normal: 3.75 px away.
  const u = 7.5 / 16;
  const on = bernsteinPoint(spans[1]!, u);
  const ahead = bernsteinPoint(spans[1]!, u + 1e-6);
  const tangent = [ahead[0] - on[0], ahead[1] - on[1]];
  const length = Math.hypot(tangent[0]!, tangent[1]!);
  const probe: SplineVector = [
    on[0] - (0.3 * tangent[1]!) / length,
    on[1] + (0.3 * tangent[0]!) / length,
  ];
  const pointer = screenOf(camera, probe);
  const candidates = waveCandidates(session, camera, pointer);
  expect(candidates, "The spline is a candidate.").toHaveLength(1);
  const expected = screenOf(camera, oracleClosestPoint(spans, probe));
  const metric = Math.hypot(expected.x - pointer.x, expected.y - pointer.y);
  expect(
    Math.abs(candidates[0]!.screenDistance - metric),
    "The candidate distance is the exact closest point's screen distance.",
  ).toBeLessThan(1e-6);
  expect(Math.abs(metric - 3.75)).toBeLessThan(1e-6);
  // Premise: the 16-per-span display polyline is measurably closer.
  const polyline = tessellateCubicSpans(spans).map((point) =>
    screenOf(camera, point),
  );
  let polylineDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < polyline.length; index += 1) {
    const a = polyline[index - 1]!;
    const b = polyline[index]!;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((pointer.x - a.x) * (b.x - a.x) + (pointer.y - a.y) * (b.y - a.y)) /
          ((b.x - a.x) ** 2 + (b.y - a.y) ** 2),
      ),
    );
    polylineDistance = Math.min(
      polylineDistance,
      Math.hypot(
        pointer.x - a.x - t * (b.x - a.x),
        pointer.y - a.y - t * (b.y - a.y),
      ),
    );
  }
  expect(Math.abs(polylineDistance - metric)).toBeGreaterThan(1e-4);

  // 12 px off: outside the 10 px enter radius, inside the 14 px exit radius
  // (the exact box prefilter keeps a hovered curve up to its exit radius).
  const far: SplineVector = [
    on[0] - (0.96 * tangent[1]!) / length,
    on[1] + (0.96 * tangent[0]!) / length,
  ];
  expect(waveCandidates(session, camera, screenOf(camera, far))).toHaveLength(
    0,
  );
  expect(
    waveCandidates(session, camera, screenOf(camera, far), true),
  ).toHaveLength(1);
});

test("at an oblique perspective view the spline picks exactly; below 1° grazing only a spline reaching behind the camera gives no candidate", () => {
  const { session, spans } = waveSession();
  const camera = perspectiveCamera([1, -9, 7]);
  const on = bernsteinPoint(spans[0]!, 0.6);
  const onScreen = screenOf(camera, on);
  const pointer = { x: onScreen.x + 2, y: onScreen.y - 3 };
  const candidates = waveCandidates(session, camera, pointer);
  expect(candidates).toHaveLength(1);
  const exact = screenOracle(spans, camera, PICK_RECT, pointer);
  expect(
    Math.abs(candidates[0]!.screenDistance - exact.distance),
    "The candidate distance is the exact screen distance (T11b).",
  ).toBeLessThan(1e-6);
  const planeMetric = screenOf(
    camera,
    oracleClosestPoint(spans, planePointOf(camera, pointer)),
  );
  expect(
    Math.hypot(planeMetric.x - pointer.x, planeMetric.y - pointer.y) -
      exact.distance,
    "premise: the former plane metric over-reports here",
  ).toBeGreaterThan(1e-3);

  // Pointer over the curve's own projection at 0.4° (grazing) vs 4°. With
  // every pole in front of the camera, the exact metric picks at both.
  for (const height of [0.3, 3]) {
    const view = perspectiveCamera([5, -40, height]);
    const picked = waveCandidates(session, view, screenOf(view, on));
    expect(picked, `${height}: picked exactly`).toHaveLength(1);
    expect(picked[0]!.screenDistance).toBeLessThan(1e-6);
  }

  // A camera inside the wave's extent, looking along +x: span 0 has poles
  // behind it (clip w ≤ 0), so the wave keeps the plane metric there, with
  // the 1° floor. Pointer over a visible point of the curve (x ≈ 8).
  const target = bernsteinPoint(spans[2]!, 0.5);
  const fallbackCamera = (height: number) => {
    const view = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    view.position.set(2.5, 1.5, height);
    view.up.set(0, 0, 1);
    view.lookAt(target[0], target[1], 0);
    view.updateProjectionMatrix();
    view.updateMatrixWorld(true);
    return view;
  };
  const behind = (view: THREE.Camera) =>
    spans.some((span) =>
      span.poles.some(
        (pole) =>
          new THREE.Vector3(pole[0], pole[1], 0).applyMatrix4(
            view.matrixWorldInverse,
          ).z >= 0,
      ),
    );
  const grazing = fallbackCamera(0.04);
  expect(behind(grazing), "premise: a pole lies behind the camera").toBe(true);
  expect(
    waveCandidates(session, grazing, screenOf(grazing, target)),
    "Grazing and behind the camera: the plane metric is ill-conditioned, no candidate.",
  ).toHaveLength(0);
  const shallow = fallbackCamera(0.4);
  expect(behind(shallow), "premise: a pole lies behind the camera").toBe(true);
  const shallowPointer = screenOf(shallow, target);
  shallowPointer.y -= 0.5;
  const fallback = waveCandidates(session, shallow, shallowPointer);
  expect(fallback).toHaveLength(1);
  expect(
    fallback[0]!.screenDistance,
    "premise: the inflated plane metric, not the 0.5 px screen offset",
  ).toBeGreaterThan(1);
  const fallbackExpected = screenOf(
    shallow,
    oracleClosestPoint(spans, planePointOf(shallow, shallowPointer)),
  );
  expect(
    Math.abs(
      fallback[0]!.screenDistance -
        Math.hypot(
          fallbackExpected.x - shallowPointer.x,
          fallbackExpected.y - shallowPointer.y,
        ),
    ),
    "Behind the camera: the plane metric (fallback).",
  ).toBeLessThan(1e-6);
});

// Lane: ui (docs/testing.md). Seam: one shared spline fixture through every
// consumer (T10f acceptance): display tessellation, pick closest point, snap
// point, measured length and the exported cubic come from the same spans.
test("display, pick, snap, measure and vector export (model and SVG) of one spline read the same solved spans", async () => {
  const { session, record, spans } = waveSession();
  const camera = topCamera();
  const entityId = "sketch_entity_wave";

  const display = getSketchSessionDisplayRenderables(session).find(
    (renderable) =>
      renderable.target?.kind === "sketchEntity" &&
      renderable.target.entityId === entityId &&
      renderable.geometry.kind === "polyline",
  );
  expect(
    display?.geometry.kind === "polyline" &&
      display.geometry.points.map((point) => [point[0], point[1]]),
    "Display draws the one tessellation of the spans.",
  ).toEqual(tessellateCubicSpans(spans).map((point) => [...point]));

  const probe: SplineVector = [4.4, 1.6];
  const exact = closestPointOnSolvedCubicSpans(probe, spans)!;
  const pick = waveCandidates(session, camera, screenOf(camera, probe));
  const pickedAt = screenOf(camera, exact.point);
  const pointer = screenOf(camera, probe);
  // Top view: the exact screen-space minimum is the screen image of the
  // plane's exact closest point (equal up to rounding).
  expect(
    Math.abs(
      pick[0]!.screenDistance -
        Math.hypot(pickedAt.x - pointer.x, pickedAt.y - pointer.y),
    ),
  ).toBeLessThan(1e-9);

  const snap = resolveSketchSnap({
    pointer: probe,
    geometries: collectSketchSnapGeometries({
      definition: record.sketch.definition,
      solvedSnapshot: record.sketch.solvedSnapshot,
    }),
    tolerance: 1,
  }).candidates.find((candidate) => candidate.kind === "nearestOnSpline");
  expect(snap?.point, "Snap is the same exact closest point.").toEqual(
    exact.point,
  );

  const measured = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [{ kind: "sketchEntity", sketchId: record.sketchId, entityId }],
    snapshot: { document: { sketches: [record] } } as never,
  });
  const length = spans.reduce(
    (sum, span) =>
      sum +
      curveLength({ kind: "cubicBezier", poles: span.poles }, [0, 1]).value,
    0,
  );
  const row = measured?.rows.find((entry) => entry.label === "Length");
  expect(
    row?.value,
    "Measure reports the spans' length (formatted as measurement does).",
  ).toBe(
    `${length
      .toFixed(2)
      .replace(/\.00$/, "")
      .replace(/(\.\d)0$/, "$1")} mm`,
  );

  const exported = buildSketchVectorExportModel({
    documentId: "doc_arrangement" as never,
    revisionId: "rev_arrangement" as never,
    sketches: [record],
    target: { kind: "sketch", sketchId: record.sketchId },
  });
  if ("diagnostic" in exported) throw new Error(exported.diagnostic.message);
  const entity = exported.entities.find(
    (candidate) => candidate.entityId === entityId,
  );
  expect(
    entity?.kind === "spline" && entity.spans,
    "Vector export writes the spans' own cubic poles.",
  ).toEqual(spans.map((span) => span.poles));
  // The SVG output writes those poles as one `C` per span (6 decimals),
  // in coordinates relative to the drawing's minimum corner.
  const svg = await svgSketchExportProvider.export({
    target: { kind: "sketch", sketchId: record.sketchId },
    targetLabel: "Sketch",
    options: {},
    capabilities: {
      sketchVector: { resolveSketchVectorModel: async () => exported },
    } as unknown as ExportCapabilities,
  });
  if (!svg.ok) throw new Error(JSON.stringify(svg.diagnostics));
  const path = (svg.payload as string).match(
    new RegExp(`<path d="([^"]*)" data-entity-id="${entityId}"`),
  )?.[1];
  const numbers = path!.match(/-?\d+(\.\d+)?/g)!.map(Number);
  expect(path!.match(/C/g), "One cubic command per span.").toHaveLength(
    spans.length,
  );
  const origin = spans[0]!.poles[0];
  const written = [
    numbers.slice(0, 2),
    ...spans.flatMap((_, index) =>
      [0, 1, 2].map((pole) =>
        numbers.slice(2 + index * 6 + pole * 2, 4 + index * 6 + pole * 2),
      ),
    ),
  ];
  const expected = [origin, ...spans.flatMap((span) => span.poles.slice(1))];
  written.forEach((point, index) => {
    expect(
      Math.hypot(
        point[0]! - written[0]![0]! - (expected[index]![0] - origin[0]),
        point[1]! - written[0]![1]! - (expected[index]![1] - origin[1]),
      ),
      `SVG pole ${index} is the span pole (to the 6-decimal output)`,
    ).toBeLessThan(2e-6);
  });
});

// Lane: ui (docs/testing.md). Seam: `collectProjectedSketchCurveCandidates`
// at oblique orthographic views (T10f review A-1, its rejection cases):
// lines and cubic spans are picked by their exact screen-space distance, so
// every pointer truly within the 10 px radius picks and none beyond it.
test("at oblique orthographic views lines and splines pick by their exact screen-space distance", () => {
  const sketch = makeSketchFixture();
  sketch.point("a", 0, 0);
  sketch.point("b", 3, 4);
  sketch.point("c", 6, -1);
  sketch.point("d", 10, 3);
  sketch.spline("wave", ["a", "b", "c", "d"], "open");
  sketch.point("l0", 0, -4);
  sketch.point("l1", 8, 4);
  sketch.line("diag", "l0", "l1");
  const input = sketch.build();
  const session = createSketchSessionFromSnapshot(
    sketchSnapshotRecordForTest(input, [], createStandardPlaneDefinition("xy")),
    OCC_KERNEL_SETTINGS,
  );
  const spans = solvedCubicSpans(
    input.solvedSnapshot.solvedEntities.find(
      (entry) => entry.entityId === "sketch_entity_wave",
    )!,
  );
  const rect = { left: 0, top: 0, width: 800, height: 800 } as DOMRectReadOnly;
  const curves = [
    {
      entityId: "sketch_entity_wave",
      points: spans.flatMap((span) =>
        Array.from({ length: 4001 }, (_, k) => bernsteinPoint(span, k / 4000)),
      ),
    },
    {
      entityId: "sketch_entity_diag",
      points: Array.from(
        { length: 4001 },
        (_, k) => [k / 500, -4 + k / 500] as SplineVector,
      ),
    },
  ];
  let within = 0;
  for (const elevation of [35.26, 20, 10, 5, 2]) {
    for (const azimuth of [-90, -45, 0, 30]) {
      const camera = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 200);
      const el = (elevation * Math.PI) / 180;
      const az = (azimuth * Math.PI) / 180;
      camera.position.set(
        5 + 50 * Math.cos(el) * Math.cos(az),
        1.5 + 50 * Math.cos(el) * Math.sin(az),
        50 * Math.sin(el),
      );
      camera.up.set(0, 0, 1);
      camera.lookAt(5, 1.5, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const screen = (point: SplineVector) => {
        const projected = new THREE.Vector3(point[0], point[1], 0).project(
          camera,
        );
        return {
          x: ((projected.x + 1) / 2) * rect.width,
          y: ((-projected.y + 1) / 2) * rect.height,
        };
      };
      for (const { entityId, points } of curves) {
        const projected = points.map(screen);
        // Independent truth: the dense projected polyline's distance.
        const truth = (pointer: { x: number; y: number }) => {
          let best = Number.POSITIVE_INFINITY;
          for (let index = 1; index < projected.length; index += 1) {
            const a = projected[index - 1]!;
            const b = projected[index]!;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const lengthSquared = dx * dx + dy * dy;
            const t =
              lengthSquared === 0
                ? 0
                : Math.max(
                    0,
                    Math.min(
                      1,
                      ((pointer.x - a.x) * dx + (pointer.y - a.y) * dy) /
                        lengthSquared,
                    ),
                  );
            best = Math.min(
              best,
              Math.hypot(a.x + t * dx - pointer.x, a.y + t * dy - pointer.y),
            );
          }
          return best;
        };
        for (let k = 0; k < 40; k += 1) {
          const base =
            projected[Math.floor(((k + 0.5) / 40) * projected.length)]!;
          const angle = (k * 2.399) % (2 * Math.PI);
          const radius = 2 + (k % 10);
          const pointer = {
            x: base.x + radius * Math.cos(angle),
            y: base.y + radius * Math.sin(angle),
          };
          const expected = truth(pointer);
          const candidate = collectProjectedSketchCurveCandidates({
            clientX: pointer.x,
            clientY: pointer.y,
            camera,
            viewportRect: rect,
            sketchSession: session,
            acceptsTarget: () => true,
            currentHoverTarget: null,
          }).find(
            (entry) =>
              entry.target.kind === "sketchEntity" &&
              entry.target.entityId === entityId,
          );
          const at = `${entityId} elevation ${elevation}° azimuth ${azimuth}° pointer ${k}`;
          if (expected <= 9.99) {
            within += 1;
            expect(candidate, `${at}: within the radius picks`).toBeDefined();
            expect(
              Math.abs(candidate!.screenDistance - expected),
              `${at}: exact screen-space distance`,
            ).toBeLessThan(1e-3);
          } else if (expected > 10.01) {
            expect(
              candidate,
              `${at}: beyond the radius does not`,
            ).toBeUndefined();
          }
        }
      }
    }
  }
  expect(
    within,
    "premise: many pointers lie within the radius",
  ).toBeGreaterThan(200);
});

// Lane: ui (docs/testing.md). Seam: `collectProjectedSketchCurveCandidates`
// at oblique orthographic and perspective views (review A-1, T11b): arcs and
// circles (projected rational quadratics), lines and cubic spans (projected
// rational cubics under perspective) are exact under both.
test("arcs, circles, lines and splines pick exactly at oblique orthographic and perspective views", () => {
  const sketch = makeSketchFixture();
  sketch.point("o", 5, 1.5);
  sketch.circle("ring", "o", 3);
  sketch.point("k", 5, -4);
  sketch.point("s", 9, -4);
  sketch.point("e", 5, 0);
  sketch.arc("bow", "k", "s", "e");
  sketch.point("e2", 5, -6);
  sketch.point("s2", 3, -4);
  sketch.arc("hook", "k", "e2", "s2", "clockwise");
  sketch.point("l0", 0, -4);
  sketch.point("l1", 8, 4);
  sketch.line("diag", "l0", "l1");
  sketch.point("a", 0, 0);
  sketch.point("b", 3, 4);
  sketch.point("c", 6, -1);
  sketch.point("d", 10, 3);
  sketch.spline("wave", ["a", "b", "c", "d"], "open");
  const input = sketch.build();
  const session = createSketchSessionFromSnapshot(
    sketchSnapshotRecordForTest(input, [], createStandardPlaneDefinition("xy")),
    OCC_KERNEL_SETTINGS,
  );
  const spans = solvedCubicSpans(
    input.solvedSnapshot.solvedEntities.find(
      (entry) => entry.entityId === "sketch_entity_wave",
    )!,
  );
  const ring = (
    center: SplineVector,
    radius: number,
    from: number,
    sweep: number,
  ) =>
    Array.from({ length: 20001 }, (_, k): SplineVector => {
      const angle = from + (sweep * k) / 20000;
      return [
        center[0] + radius * Math.cos(angle),
        center[1] + radius * Math.sin(angle),
      ];
    });
  const curves = [
    {
      entityId: "sketch_entity_ring",
      points: ring([5, 1.5], 3, 0, 2 * Math.PI),
    },
    {
      entityId: "sketch_entity_bow",
      points: ring([5, -4], 4, 0, Math.PI / 2),
    },
    {
      // Clockwise quarter from the bottom (5, -6) to the left (3, -4).
      entityId: "sketch_entity_hook",
      points: ring([5, -4], 2, -Math.PI / 2, -Math.PI / 2),
    },
    {
      entityId: "sketch_entity_diag",
      points: Array.from(
        { length: 4001 },
        (_, k) => [k / 500, -4 + k / 500] as SplineVector,
      ),
    },
    {
      entityId: "sketch_entity_wave",
      points: spans.flatMap((span) =>
        Array.from({ length: 4001 }, (_, k) => bernsteinPoint(span, k / 4000)),
      ),
    },
  ];
  const rect = { left: 0, top: 0, width: 800, height: 800 } as DOMRectReadOnly;
  let exactWithin = 0;
  for (const perspective of [false, true])
    for (const elevation of [35.26, 20, 10])
      for (const azimuth of [-90, 0, 30]) {
        const camera = perspective
          ? new THREE.PerspectiveCamera(45, 1, 0.1, 200)
          : new THREE.OrthographicCamera(-9, 9, 9, -9, 0.1, 200);
        const distance = perspective ? 22 : 50;
        const el = (elevation * Math.PI) / 180;
        const az = (azimuth * Math.PI) / 180;
        camera.position.set(
          5 + distance * Math.cos(el) * Math.cos(az),
          1.5 + distance * Math.cos(el) * Math.sin(az),
          distance * Math.sin(el),
        );
        camera.up.set(0, 0, 1);
        camera.lookAt(5, 1.5, 0);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        const screen = (point: SplineVector) => {
          const projected = new THREE.Vector3(point[0], point[1], 0).project(
            camera,
          );
          return {
            x: ((projected.x + 1) / 2) * rect.width,
            y: ((-projected.y + 1) / 2) * rect.height,
          };
        };
        for (const { entityId, points } of curves) {
          const projected = points.map(screen);
          const truth = (pointer: { x: number; y: number }) => {
            let best = Number.POSITIVE_INFINITY;
            for (let index = 1; index < projected.length; index += 1) {
              const a = projected[index - 1]!;
              const b = projected[index]!;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const lengthSquared = dx * dx + dy * dy;
              const t =
                lengthSquared === 0
                  ? 0
                  : Math.max(
                      0,
                      Math.min(
                        1,
                        ((pointer.x - a.x) * dx + (pointer.y - a.y) * dy) /
                          lengthSquared,
                      ),
                    );
              best = Math.min(
                best,
                Math.hypot(a.x + t * dx - pointer.x, a.y + t * dy - pointer.y),
              );
            }
            return best;
          };
          for (let k = 0; k < 30; k += 1) {
            const base =
              projected[Math.floor(((k + 0.5) / 30) * projected.length)]!;
            const angle = (k * 2.399) % (2 * Math.PI);
            const radius = 2 + (k % 10);
            const pointer = {
              x: base.x + radius * Math.cos(angle),
              y: base.y + radius * Math.sin(angle),
            };
            const expected = truth(pointer);
            const candidate = collectProjectedSketchCurveCandidates({
              clientX: pointer.x,
              clientY: pointer.y,
              camera,
              viewportRect: rect,
              sketchSession: session,
              acceptsTarget: () => true,
              currentHoverTarget: null,
            }).find(
              (entry) =>
                entry.target.kind === "sketchEntity" &&
                entry.target.entityId === entityId,
            );
            const at = `${entityId} ${perspective ? "perspective" : "orthographic"} elevation ${elevation}° azimuth ${azimuth}° pointer ${k}`;
            if (expected <= 9.99) {
              exactWithin += 1;
              expect(candidate, `${at}: within the radius picks`).toBeDefined();
              expect(
                Math.abs(candidate!.screenDistance - expected),
                `${at}: exact screen-space distance`,
              ).toBeLessThan(1e-3);
            } else if (expected > 10.01) {
              expect(
                candidate,
                `${at}: beyond the radius does not`,
              ).toBeUndefined();
            }
          }
        }
      }
  expect(
    exactWithin,
    "premise: many pointers within the radius",
  ).toBeGreaterThan(400);
});

// Lane: ui (docs/testing.md). Seam: `collectProjectedSketchCurveCandidates`
// for a spline under perspective cameras (T11b, T11-D15): each drawn span is
// picked by its exact screen-space distance (a projected rational cubic),
// against an independent oracle (the polynomial span projected point by
// point, 4000-step grid + golden section), and its depth is the hit's.
test("perspective views at 5°, 10°, 45° and 90° pick a spline span by its exact screen distance", () => {
  const { session, spans } = waveSession();
  const rect = { left: 0, top: 0, width: 800, height: 800 } as DOMRectReadOnly;
  let within = 0;
  let beyond = 0;
  for (const elevation of [5, 10, 45, 90])
    for (const azimuth of [-90, 0, 30]) {
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
      const el = (elevation * Math.PI) / 180;
      const az = (azimuth * Math.PI) / 180;
      camera.position.set(
        5 + 22 * Math.cos(el) * Math.cos(az),
        1.5 + 22 * Math.cos(el) * Math.sin(az),
        22 * Math.sin(el),
      );
      if (elevation === 90) camera.up.set(0, 1, 0);
      else camera.up.set(0, 0, 1);
      camera.lookAt(5, 1.5, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      for (let k = 0; k < 30; k += 1) {
        const span = spans[k % spans.length]!;
        const base = new THREE.Vector3(
          ...bernsteinPoint(span, (k + 0.5) / 30),
          0,
        ).project(camera);
        const angle = (k * 2.399) % (2 * Math.PI);
        const radius = 2 + (k % 16);
        const pointer = {
          x: ((base.x + 1) / 2) * rect.width + radius * Math.cos(angle),
          y: ((-base.y + 1) / 2) * rect.height + radius * Math.sin(angle),
        };
        const expected = screenOracle(spans, camera, rect, pointer);
        const candidate = collectProjectedSketchCurveCandidates({
          clientX: pointer.x,
          clientY: pointer.y,
          camera,
          viewportRect: rect,
          sketchSession: session,
          acceptsTarget: () => true,
          currentHoverTarget: null,
        }).find(
          (entry) =>
            entry.target.kind === "sketchEntity" &&
            entry.target.entityId === "sketch_entity_wave",
        );
        const at = `elevation ${elevation}° azimuth ${azimuth}° pointer ${k}`;
        if (expected.distance <= 9.999) {
          within += 1;
          expect(candidate, `${at}: within the radius picks`).toBeDefined();
          expect(
            Math.abs(candidate!.screenDistance - expected.distance),
            `${at}: exact screen-space distance`,
          ).toBeLessThan(1e-6);
          expect(
            Math.abs(candidate!.depth - expected.depth),
            `${at}: the hit's depth`,
          ).toBeLessThan(1e-9);
        } else if (expected.distance > 10.001) {
          beyond += 1;
          expect(
            candidate,
            `${at}: beyond the radius does not`,
          ).toBeUndefined();
        }
      }
    }
  expect(within, "premise: pointers within the radius").toBeGreaterThan(200);
  expect(beyond, "premise: pointers beyond the radius").toBeGreaterThan(40);
});

// Lane: ui (docs/testing.md). Seam: `collectProjectedSketchCurveCandidates`
// for a spline crossing the far plane (T11b review REQ-1): the pointer sits
// on a knot beyond the far plane (the nearest drawn span end, out of depth
// range), and the in-range end of the last span is about 7 px away. The span
// prefilter must not skip that span on the out-of-range end's bound.
test("a perspective spline partly beyond the far plane still picks its in-range span near an out-of-range knot", () => {
  const sketch = makeSketchFixture();
  const fit: SplineVector[] = [
    [-6, 0],
    [0, 12],
    [6, 0],
    [0.15, 11.85],
  ];
  fit.forEach(([x, y], index) => sketch.point(`f${index}`, x, y));
  sketch.spline(
    "hook",
    fit.map((_, index) => `f${index}`),
    "open",
  );
  const input = sketch.build();
  const session = createSketchSessionFromSnapshot(
    sketchSnapshotRecordForTest(input, [], createStandardPlaneDefinition("xy")),
    OCC_KERNEL_SETTINGS,
  );
  const spans = solvedCubicSpans(
    input.solvedSnapshot.solvedEntities.find(
      (entry) => entry.entityId === "sketch_entity_hook",
    )!,
  );
  const rect = { left: 0, top: 0, width: 800, height: 800 } as DOMRectReadOnly;
  const eye = new THREE.Vector3(0, -8, 10);
  const look = new THREE.Vector3(0, 8, 0);
  const view = look.clone().sub(eye).normalize();
  const along = (point: SplineVector) =>
    new THREE.Vector3(point[0], point[1], 0).sub(eye).dot(view);
  const knot = fit[1]!;
  const end = spans.at(-1)!.poles[3];
  // The far plane lies between the knot and the in-range end.
  const camera = new THREE.PerspectiveCamera(
    45,
    1,
    10,
    (along(knot) + along(end)) / 2,
  );
  camera.position.copy(eye);
  camera.up.set(0, 0, 1);
  camera.lookAt(look);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const screen = (point: SplineVector) => {
    const projected = new THREE.Vector3(point[0], point[1], 0).project(camera);
    return {
      x: ((projected.x + 1) / 2) * rect.width,
      y: ((-projected.y + 1) / 2) * rect.height,
      depth: projected.z,
    };
  };
  const pointer = screen(knot);
  const endOnScreen = screen(end);
  expect(
    pointer.depth,
    "premise: the knot lies beyond the far plane",
  ).toBeGreaterThan(1);
  expect(endOnScreen.depth, "premise: the end lies in range").toBeLessThan(1);
  const expected = Math.hypot(
    endOnScreen.x - pointer.x,
    endOnScreen.y - pointer.y,
  );
  expect(
    expected,
    "premise: the in-range end is within the radius",
  ).toBeLessThan(9);
  expect(expected, "premise: and farther than the knot").toBeGreaterThan(5);
  const candidate = collectProjectedSketchCurveCandidates({
    clientX: pointer.x,
    clientY: pointer.y,
    camera,
    viewportRect: rect,
    sketchSession: session,
    acceptsTarget: () => true,
    currentHoverTarget: null,
  }).find(
    (entry) =>
      entry.target.kind === "sketchEntity" &&
      entry.target.entityId === "sketch_entity_hook",
  );
  expect(
    candidate,
    "The in-range span near the out-of-range knot picks.",
  ).toBeDefined();
  expect(Math.abs(candidate!.screenDistance - expected)).toBeLessThan(1e-6);
  expect(Math.abs(candidate!.depth - endOnScreen.depth)).toBeLessThan(1e-9);
});
