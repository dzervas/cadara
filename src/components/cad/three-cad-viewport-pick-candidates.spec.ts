import { test } from "bun:test";
import * as THREE from "three";

import { expectTrue } from "@/testing/expect.spec";
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
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
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

  expectTrue(
    originCandidates.length === 1,
    "The sketch datum origin should produce a projected pick candidate.",
  );
  expectTrue(
    originCandidates[0]?.semanticClass === "sketchPoint",
    "The sketch datum origin should sort as a point, not as a reference wire.",
  );

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

  expectTrue(
    resolveAllCandidates([...axisHit, ...originCandidates])?.target ===
      originTarget,
    "The origin point should remain pickable at the datum-axis crossing.",
  );

  const axisCandidates = collectProjectedSketchCurveCandidates({
    clientX: viewportRect.left + 140,
    clientY: viewportRect.top + 100,
    camera,
    viewportRect,
    sketchSession: {
      ...createNewSketchSession(createStandardPlaneDefinition("xy")),
      sketchId: "sketch_primary",
    },
    acceptsTarget: () => true,
    currentHoverTarget: null,
  });

  expectTrue(
    axisCandidates.length === 1,
    "The sketch datum axis should have a screen-space pick candidate.",
  );
  expectTrue(
    axisCandidates[0]?.target.kind === "sketchDatumReference" &&
      axisCandidates[0].target.datumId === "xAxis",
    "The screen-space datum-axis candidate should preserve the datum reference target.",
  );

  const sessionAxisCandidates = collectProjectedSketchCurveCandidates({
    clientX: viewportRect.left + 140,
    clientY: viewportRect.top + 100,
    camera,
    viewportRect,
    sketchSession: createNewSketchSession(createStandardPlaneDefinition("xy")),
    acceptsTarget: () => true,
    currentHoverTarget: null,
  });

  expectTrue(
    sessionAxisCandidates.some(
      (candidate) =>
        candidate.target.kind === "sketchDatumReference" &&
        candidate.target.datumId === "xAxis",
    ),
    "The active sketch session should provide datum-axis pick candidates even when the line renderable is not ray-pickable.",
  );

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

  expectTrue(
    lineCandidates.some((candidate) => candidate.target === lineTarget),
    "A pointer within the 10px sketch-curve radius should pick the semantic local line.",
  );

  const constructionCandidates = collectProjectedSketchCurveCandidates({
    clientX: 100,
    clientY: 88,
    camera,
    viewportRect,
    sketchSession: session,
    acceptsTarget: () => true,
    currentHoverTarget: null,
  });

  expectTrue(
    constructionCandidates.some(
      (candidate) => candidate.target === constructionTarget,
    ),
    "Dashed construction curves should remain pickable through semantic geometry, including visual dash gaps.",
  );

  const hoveredExitCandidates = collectProjectedSketchCurveCandidates({
    clientX: 100,
    clientY: 134,
    camera,
    viewportRect,
    sketchSession: session,
    acceptsTarget: () => true,
    currentHoverTarget: lineTarget,
  });

  expectTrue(
    hoveredExitCandidates.some((candidate) => candidate.target === lineTarget),
    "Hovered sketch curves should use the larger 14px exit radius.",
  );
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

  expectTrue(
    resolveAllCandidates([curve, point])?.target === pointTarget,
    "Sketch points should outrank nearby semantic curve candidates.",
  );
  expectTrue(
    resolveAllCandidates([region, curve])?.target === curveTarget,
    "Semantic curve candidates should outrank regions.",
  );
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
    ...createNewSketchSession(createStandardPlaneDefinition("xy")).definition,
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
    ...createNewSketchSession(createStandardPlaneDefinition("xy")),
    sketchId,
    definition,
    fullDefinition: definition,
  };
}
