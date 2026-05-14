import { test, expect } from "vitest";

import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SolvedSketchSnapshot } from "@/contracts/sketch/schema";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import {
  createSketchSessionFromSnapshot,
  getSketchConstraintDisplayForTarget,
  getSketchConstraintDisplaySummary,
  getSketchSessionDisplayRenderables,
  normalizeSketchConstraintDisplayState,
} from "@/domain/editor/sketch-session";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";

test("src/domain/editor/sketch-session-style.spec.ts", () => {
  const definition = {
    schemaVersion: "sketch-definition/v1alpha1",
    referenceIds: [],
    references: [],
    pointIds: ["sketch_point_a", "sketch_point_b"],
    points: [
      {
        pointId: "sketch_point_a",
        label: "A",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary",
          pointId: "sketch_point_a",
        },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: "sketch_point_b",
        label: "B",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary",
          pointId: "sketch_point_b",
        },
        position: [4, 0],
        isConstruction: false,
      },
    ],
    entityIds: ["sketch_entity_ab"],
    entities: [
      {
        kind: "lineSegment",
        entityId: "sketch_entity_ab",
        label: "AB",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_primary",
          entityId: "sketch_entity_ab",
        },
        isConstruction: false,
        startPointId: "sketch_point_a",
        endPointId: "sketch_point_b",
        styleId: "style_primary",
      },
    ],
    styles: [
      {
        styleId: "style_primary",
        paint: { color: "#3366ff", opacity: 0.42 },
        stroke: {
          color: "#ff8844",
          opacity: 0.63,
          width: 2.5,
          lineCap: "butt",
          lineJoin: "bevel",
          miterLimit: 5,
          dashSize: 0.8,
          gapSize: 0.3,
        },
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    svgRenderingEnabled: true,
  } as SketchDefinition & {
    styles: Array<{
      styleId: string;
      paint: { color: string; opacity: number };
      stroke: {
        color: string;
        opacity: number;
        width: number;
        lineCap: "butt";
        lineJoin: "bevel";
        miterLimit: number;
        dashSize: number;
        gapSize: number;
      };
    }>;
  };

  const solved = solveSketchDefinitionCore({
    definition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: "bestEffort",
  });
  const plane = createStandardPlaneDefinition("xy");
  const session = createSketchSessionFromSnapshot({
    ownerDocumentId: "doc_workspace",
    ownerRevisionId: "rev_0001",
    ownerFeatureId: null,
    ownerSketchId: "sketch_primary",
    ownerBodyId: null,
    sketchId: "sketch_primary",
    label: "Sketch",
    plane,
    planeTarget: plane.support,
    planeKey: "xy",
    sketch: {
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_primary",
      ownerBodyId: null,
      sketchId: "sketch_primary",
      label: "Sketch",
      planeSupport: plane.support,
      definition,
      solvedSnapshot: solved.solvedSnapshot,
      regions: [],
    },
  } satisfies SketchSnapshotRecord);

  const lineRenderable = getSketchSessionDisplayRenderables(session).find(
    (entry) => entry.id.includes("line"),
  );
  expect(
    lineRenderable,
    "Sketch line display renderable should exist.",
  ).toBeTruthy();
  expect(
    lineRenderable.target?.kind,
    "Styled renderables should preserve selection/picking target bindings.",
  ).toBe("sketchEntity");
  expect(
    lineRenderable.linePattern,
    "Style metadata should not alter construction/line-pattern state.",
  ).toBe("solid");
  expect(
    lineRenderable.paintStyle?.color,
    "Paint style color should resolve from persisted style records.",
  ).toBe(0x3366ff);
  expect(
    lineRenderable.paintStyle?.opacity,
    "Paint style opacity should resolve from persisted style records.",
  ).toBe(0.42);
  expect(
    lineRenderable.strokeStyle?.color,
    "Stroke style color should resolve from persisted style records.",
  ).toBe(0xff8844);
  expect(
    lineRenderable.strokeStyle?.opacity,
    "Stroke style opacity should resolve from persisted style records.",
  ).toBe(0.63);
  expect(
    lineRenderable.strokeStyle?.width,
    "Stroke style width should resolve from persisted style records.",
  ).toBe(2.5);
  expect(
    lineRenderable.strokeStyle?.lineCap,
    "Persisted stroke cap should resolve through display renderables.",
  ).toBe("butt");
  expect(
    lineRenderable.strokeStyle?.lineJoin,
    "Persisted stroke join should resolve through display renderables.",
  ).toBe("bevel");
  expect(
    lineRenderable.strokeStyle?.miterLimit,
    "Persisted stroke miter limit should resolve through display renderables.",
  ).toBe(5);
  expect(
    lineRenderable.strokeStyle?.dashSize,
    "Stroke dash size should resolve from persisted style records.",
  ).toBe(0.8);
  expect(
    lineRenderable.strokeStyle?.gapSize,
    "Stroke gap size should resolve from persisted style records.",
  ).toBe(0.3);

  const localDefinition = {
    ...definition,
    entities: [
      {
        ...definition.entities[0]!,
        styleId: undefined,
        style: {
          fillMode: "gradient",
          fillColor: "#111111",
          gradientStartColor: "#2266ff",
          strokeEnabled: true,
          strokeColor: "#33ffaa",
          strokeWidth: 3,
          strokeCap: "square",
          strokeJoin: "miter",
          strokeMiterLimit: 7,
          strokeDashSize: 0.45,
          strokeGapSize: 0.15,
        },
      },
    ],
    styleIds: [],
    styles: [],
  } as SketchDefinition & {
    styles: [];
  };
  const localSolved = solveSketchDefinitionCore({
    definition: localDefinition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: "bestEffort",
  });
  const localSession = createSketchSessionFromSnapshot({
    ownerDocumentId: "doc_workspace",
    ownerRevisionId: "rev_0001",
    ownerFeatureId: null,
    ownerSketchId: "sketch_primary",
    ownerBodyId: null,
    sketchId: "sketch_primary",
    label: "Sketch",
    plane,
    planeTarget: plane.support,
    planeKey: "xy",
    sketch: {
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_primary",
      ownerBodyId: null,
      sketchId: "sketch_primary",
      label: "Sketch",
      planeSupport: plane.support,
      definition: localDefinition,
      solvedSnapshot: localSolved.solvedSnapshot,
      regions: [],
    },
  } satisfies SketchSnapshotRecord);

  const localLineRenderable = getSketchSessionDisplayRenderables(
    localSession,
  ).find((entry) => entry.id.includes("line"));
  expect(
    localLineRenderable?.paintStyle?.color,
    "Local gradient fill should render with the documented fill-color fallback.",
  ).toBe(0x111111);
  expect(
    localLineRenderable.strokeStyle?.color,
    "Local stroke color should render from inline style metadata.",
  ).toBe(0x33ffaa);
  expect(
    localLineRenderable.strokeStyle?.lineCap,
    "Local stroke cap should remain available to display helpers.",
  ).toBe("square");
  expect(
    localLineRenderable.strokeStyle?.lineJoin,
    "Local stroke join should remain available to display helpers.",
  ).toBe("miter");
  expect(
    localLineRenderable.strokeStyle?.miterLimit,
    "Local stroke miter limit should remain available to display helpers.",
  ).toBe(7);
  expect(
    localLineRenderable.strokeStyle?.dashSize,
    "Local stroke dash size should render from inline style metadata.",
  ).toBe(0.45);
  expect(
    localLineRenderable.strokeStyle?.gapSize,
    "Local stroke gap size should render from inline style metadata.",
  ).toBe(0.15);

  const regionDefinition = {
    ...definition,
    pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_c"],
    points: [
      definition.points[0]!,
      definition.points[1]!,
      {
        pointId: "sketch_point_c",
        label: "C",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_primary",
          pointId: "sketch_point_c",
        },
        position: [0, 4],
        isConstruction: false,
      },
    ],
    entityIds: [],
    entities: [],
    styles: [
      {
        styleId: "style_region_gradient",
        label: "Region gradient",
        target: { kind: "region", regionId: "region_primary" },
        fill: {
          kind: "gradient",
          gradient: {
            kind: "linear",
            angleRadians: Math.PI / 3,
            startColor: "#2266ff",
            startOpacity: 0.21,
            endColor: "#ffaa33",
            endOpacity: 0.74,
          },
        },
        stroke: {
          color: "#1188aa",
          opacity: 0.52,
          width: 4,
          lineCap: "square",
          lineJoin: "miter",
          miterLimit: 9,
          dashSize: 1.25,
          gapSize: 0.5,
        },
      },
    ],
  } as SketchDefinition;
  const regionSolved = solveSketchDefinitionCore({
    definition: regionDefinition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: "bestEffort",
  });
  const regionSession = {
    ...createSketchSessionFromSnapshot({
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_primary",
      ownerBodyId: null,
      sketchId: "sketch_primary",
      label: "Sketch",
      plane,
      planeTarget: plane.support,
      planeKey: "xy",
      sketch: {
        ownerDocumentId: "doc_workspace",
        ownerRevisionId: "rev_0001",
        ownerFeatureId: null,
        ownerSketchId: "sketch_primary",
        ownerBodyId: null,
        sketchId: "sketch_primary",
        label: "Sketch",
        planeSupport: plane.support,
        definition: regionDefinition,
        solvedSnapshot: regionSolved.solvedSnapshot,
        regions: [
          {
            ownerDocumentId: "doc_workspace",
            ownerRevisionId: "rev_0001",
            ownerFeatureId: null,
            ownerSketchId: "sketch_primary",
            ownerBodyId: null,
            regionId: "region_primary",
            label: "Primary region",
            target: {
              kind: "region",
              sketchId: "sketch_primary",
              regionId: "region_primary",
            },
            sourceSketch: { kind: "sketch", sketchId: "sketch_primary" },
            loops: [
              {
                role: "outer",
                segments: [],
                boundaryPointIds: [
                  "sketch_point_a",
                  "sketch_point_b",
                  "sketch_point_c",
                ],
                isClosed: true,
              },
            ],
            isClosed: true,
          },
        ],
      },
    } satisfies SketchSnapshotRecord),
    definition: regionDefinition,
  };
  const regionRenderable = getSketchSessionDisplayRenderables(
    regionSession,
  ).find((entry) => entry.semanticClass === "region");
  expect(
    regionRenderable?.paintStyle?.kind,
    "Region style records should preserve gradient fill metadata through display renderables.",
  ).toBe("linearGradient");
  expect(
    regionRenderable.paintStyle.startColor === 0x2266ff &&
      regionRenderable.paintStyle.startOpacity === 0.21 &&
      regionRenderable.paintStyle.endColor === 0xffaa33 &&
      regionRenderable.paintStyle.endOpacity === 0.74 &&
      regionRenderable.paintStyle.angleRadians === Math.PI / 3,
    "Region gradient display metadata should preserve colors, opacities, and angle.",
  ).toBeTruthy();
  expect(
    regionRenderable.strokeStyle?.lineCap,
    "Region style record stroke cap should reach display renderables.",
  ).toBe("square");
  expect(
    regionRenderable.strokeStyle.lineJoin,
    "Region style record stroke join should reach display renderables.",
  ).toBe("miter");
  expect(
    regionRenderable.strokeStyle.miterLimit,
    "Region style record miter limit should reach display renderables.",
  ).toBe(9);
  expect(
    regionRenderable.strokeStyle.dashSize === 1.25 &&
      regionRenderable.strokeStyle.gapSize === 0.5,
    "Region style record dash and gap should reach display renderables.",
  ).toBeTruthy();

  const disabledStrokeDefinition = {
    ...localDefinition,
    entities: [
      {
        ...localDefinition.entities[0]!,
        style: {
          strokeColor: "#ff00ff",
          strokeWidth: 6,
        },
      },
    ],
  } as SketchDefinition;
  const disabledStrokeSolved = solveSketchDefinitionCore({
    definition: disabledStrokeDefinition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: "bestEffort",
  });
  const disabledStrokeSession = createSketchSessionFromSnapshot({
    ownerDocumentId: "doc_workspace",
    ownerRevisionId: "rev_0001",
    ownerFeatureId: null,
    ownerSketchId: "sketch_primary",
    ownerBodyId: null,
    sketchId: "sketch_primary",
    label: "Sketch",
    plane,
    planeTarget: plane.support,
    planeKey: "xy",
    sketch: {
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_primary",
      ownerBodyId: null,
      sketchId: "sketch_primary",
      label: "Sketch",
      planeSupport: plane.support,
      definition: disabledStrokeDefinition,
      solvedSnapshot: disabledStrokeSolved.solvedSnapshot,
      regions: [],
    },
  } satisfies SketchSnapshotRecord);
  const disabledStrokeLineRenderable = getSketchSessionDisplayRenderables(
    disabledStrokeSession,
  ).find((entry) => entry.id.includes("line"));
  expect(
    disabledStrokeLineRenderable?.strokeStyle,
    "Local stroke fields should not render unless stroke styling is explicitly enabled.",
  ).toBe(undefined);

  const pointStyledDefinition = {
    ...localDefinition,
    points: [
      {
        ...localDefinition.points[0]!,
        style: {
          strokeEnabled: true,
          strokeColor: "#dd44aa",
          strokeWidth: 2,
        },
      },
      localDefinition.points[1]!,
    ],
  } as SketchDefinition;
  const pointStyledSolved = solveSketchDefinitionCore({
    definition: pointStyledDefinition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: "bestEffort",
  });
  const pointStyledSession = createSketchSessionFromSnapshot({
    ownerDocumentId: "doc_workspace",
    ownerRevisionId: "rev_0001",
    ownerFeatureId: null,
    ownerSketchId: "sketch_primary",
    ownerBodyId: null,
    sketchId: "sketch_primary",
    label: "Sketch",
    plane,
    planeTarget: plane.support,
    planeKey: "xy",
    sketch: {
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_primary",
      ownerBodyId: null,
      sketchId: "sketch_primary",
      label: "Sketch",
      planeSupport: plane.support,
      definition: pointStyledDefinition,
      solvedSnapshot: pointStyledSolved.solvedSnapshot,
      regions: [],
    },
  } satisfies SketchSnapshotRecord);
  const pointRenderable = getSketchSessionDisplayRenderables(
    pointStyledSession,
  ).find(
    (entry) =>
      entry.target?.kind === "sketchPoint" &&
      entry.target.pointId === "sketch_point_a",
  );
  expect(
    pointRenderable?.strokeStyle?.color,
    "Point marker renderables should resolve enabled local stroke style.",
  ).toBe(0xdd44aa);

  expect(
    normalizeSketchConstraintDisplayState(
      { solveState: "solved", constraintState: "wellConstrained" },
      0,
    ),
    "Well constrained solver status should normalize to constrained display state.",
  ).toBe("constrained");
  expect(
    normalizeSketchConstraintDisplayState(
      { solveState: "solved", constraintState: "unknown" },
      0,
    ),
    "Unknown solver constrainedness should normalize to underconstrained display state.",
  ).toBe("underconstrained");
  expect(
    normalizeSketchConstraintDisplayState(
      { solveState: "solved", constraintState: "inconsistent" },
      0,
    ),
    "Inconsistent solver constrainedness should normalize to overconstrained display state.",
  ).toBe("overconstrained");
  expect(
    normalizeSketchConstraintDisplayState(
      { solveState: "partiallySolved", constraintState: "underConstrained" },
      1,
    ),
    "Partial solves with known affected geometry should normalize to overconstrained display state.",
  ).toBe("overconstrained");

  const constrainedDefinition = {
    ...definition,
    constraintIds: ["constraint_horizontal"],
    constraints: [
      {
        kind: "horizontal",
        constraintId: "constraint_horizontal",
        label: "Horizontal",
        entityId: "sketch_entity_ab",
      },
    ],
  } as SketchDefinition;
  const unsatisfiedSnapshot: SolvedSketchSnapshot = {
    schemaVersion: "solved-sketch/v1alpha1",
    status: {
      solveState: "partiallySolved",
      constraintState: "underConstrained",
    },
    solvedEntities: [],
    solvedPoints: [],
    constraintStatuses: [
      { constraintId: "constraint_horizontal", status: "unsatisfied" },
    ],
    dimensionStatuses: [],
    diagnostics: [],
  };
  const displaySummary = getSketchConstraintDisplaySummary({
    sketchId: "sketch_primary",
    definition: constrainedDefinition,
    solvedSnapshot: unsatisfiedSnapshot,
  });
  expect(
    displaySummary.state,
    "Unsatisfied partial solve display summary should be overconstrained.",
  ).toBe("overconstrained");
  expect(
    getSketchConstraintDisplayForTarget(
      {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: "sketch_entity_ab",
      },
      displaySummary,
    ).isAffectedOverconstraint,
    "Unsatisfied constraints should mark only their affected sketch geometry targets.",
  ).toBeTruthy();
  expect(
    getSketchConstraintDisplayForTarget(
      {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId: "sketch_point_b",
      },
      displaySummary,
    ).isAffectedOverconstraint,
    "Unaffected geometry should not receive overconstraint diagnostics.",
  ).toBeFalsy();
});
