import { test, expect } from "vitest";
import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";

import { lineLoopSegmentsForTest } from "@/contracts/sketch/region-record.fixtures";
import type { SketchVectorExportModel } from "@/contracts/export/sketch-vector";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import type {
  RegionRecord,
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { buildSketchVectorExportModel } from "@/domain/export/sketch-vector-export-model";
import { deriveSketchValidity } from "@/contracts/sketch/derived-validity";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";

test("buildSketchVectorExportModel extracts committed sketch geometry, regions, styles, and diagnostics", () => {
  // T10e: regions resolve against the record's own solved pair, so the
  // record carries the solve its region was derived from.
  const modelOrFailure = buildSketchVectorExportModel({
    documentId: "doc_export",
    revisionId: "rev_0001",
    sketches: [createSketchSnapshot(createSolvedRectangleSnapshot())],
    target: { kind: "sketch", sketchId: "sketch_profile" },
  });

  expect(
    "diagnostic" in modelOrFailure,
    "Committed sketch targets should resolve to a sketch vector export model.",
  ).toBeFalsy();
  const model = modelOrFailure as SketchVectorExportModel;

  expect(
    model.sketchId,
    "The export model should preserve sketch identity.",
  ).toBe("sketch_profile");
  expect(
    model.revisionId,
    "The export model should preserve document revision identity.",
  ).toBe("rev_0001");
  expect(model.units, "The export model should declare document units.").toBe(
    "millimeter",
  );
  expect(
    model.entities.some(
      (entity) =>
        entity.kind === "lineSegment" &&
        entity.style?.stroke?.color === "#ff3366",
    ),
    "Styled sketch line entities should preserve authored stroke style.",
  ).toBeTruthy();
  expect(
    model.entities.some((entity) => entity.kind === "circle"),
    "Circle entities should be included in the sketch export model.",
  ).toBeTruthy();
  expect(
    model.regions[0]?.style?.fill.kind,
    "Closed regions should carry authored region fill styles for SVG export.",
  ).toBe("gradient");
  expect(
    model.diagnostics.some(
      (diagnostic) => diagnostic.code === "sketch-vector-unsupported-entity",
    ),
    "Unsupported sketch entity kinds should be reported without dropping supported geometry.",
  ).toBeTruthy();
  // T17e (B2): the unsupported entity is named by label, never by id.
  expect(
    model.diagnostics
      .filter(
        (diagnostic) => diagnostic.code === "sketch-vector-unsupported-entity",
      )
      .map((diagnostic) => diagnostic.message),
  ).toEqual([
    "‘Ellipse’ (ellipse) is not supported by sketch vector export yet.",
  ]);
  expectNoInternalIds(
    model.diagnostics.map((diagnostic) => diagnostic.message),
    ["entity_", "point_"],
  );
});

// T17d (B3, [TECH] A-5): an unsolved (not evaluated) record is not current,
// so it is refused as a whole; it used to export its authored entities.
test("an unsolved record is not current: it is refused as a whole, by the sketch's label", () => {
  const result = buildSketchVectorExportModel({
    documentId: "doc_export",
    revisionId: "rev_0001",
    sketches: [createSketchSnapshot()],
    target: { kind: "sketch", sketchId: "sketch_profile" },
  });
  expect(result).toEqual({
    diagnostic: {
      code: "sketch-vector-sketch-not-current",
      severity: "error",
      // T17e (T17d review A-1): the cause is named: no solve ran.
      message:
        "Sketch ‘Sketch Profile’ was not exported because it is invalid. It has not been solved, so its geometry is not current. Edit the sketch to solve it, or Undo.",
      target: { kind: "sketch", sketchId: "sketch_profile" },
    },
  });
});

// T17e (review A-1, A-9). Logic lane; seam: the vector export model. The
// empty-sketch, missing-point and unresolved-region texts name the sketch,
// the geometry and the region by label, never by id.
test("T17e: empty sketch, missing point and unresolved region texts are label-based", () => {
  const exportOf = (record: SketchSnapshotRecord) =>
    buildSketchVectorExportModel({
      documentId: "doc_export",
      revisionId: "rev_0001",
      sketches: [record],
      target: { kind: "sketch", sketchId: "sketch_profile" },
    }) as SketchVectorExportModel;
  const base = createSketchSnapshot(createSolvedRectangleSnapshot());
  const withSketch = (
    patch: (
      sketch: SketchSnapshotRecord["sketch"],
    ) => SketchSnapshotRecord["sketch"],
  ) => ({ ...base, sketch: patch(base.sketch) });
  const messages = (record: SketchSnapshotRecord, code: string) =>
    exportOf(record)
      .diagnostics.filter((diagnostic) => diagnostic.code === code)
      .map((diagnostic) => diagnostic.message);

  const empty = withSketch((sketch) => ({
    ...sketch,
    definition: {
      ...sketch.definition,
      entityIds: ["entity_ellipse"] as never,
      entities: sketch.definition.entities.filter(
        (entity) => entity.kind === "ellipse",
      ),
    },
    regions: [],
  }));
  const missing = withSketch((sketch) => ({
    ...sketch,
    definition: {
      ...sketch.definition,
      pointIds: sketch.definition.pointIds.filter(
        (id) => (id as string) !== "point_a",
      ),
      points: sketch.definition.points.filter(
        (point) => (point.pointId as string) !== "point_a",
      ),
      entities: sketch.definition.entities.map((entity) =>
        (entity.entityId as string) === "entity_ab"
          ? { ...entity, label: "Bottom" }
          : entity,
      ),
    },
    solvedSnapshot: {
      ...sketch.solvedSnapshot,
      solvedEntities: sketch.solvedSnapshot.solvedEntities.filter(
        (entity) => (entity.entityId as string) !== "entity_ab",
      ),
    },
    regions: [],
  }));
  const unresolved = withSketch((sketch) => ({
    ...sketch,
    regions: sketch.regions.map((region) => ({
      ...region,
      loops: region.loops.map((loop) => ({
        ...loop,
        segments: loop.segments.map((segment, index) =>
          index === 0
            ? {
                ...segment,
                sourceParameterInterval: [2, 3] as [number, number],
              }
            : segment,
        ),
      })),
    })),
  }));
  const texts = [
    messages(empty, "sketch-vector-empty-sketch"),
    messages(missing, "sketch-vector-missing-point"),
    messages(unresolved, "sketch-vector-region-unresolved"),
  ];
  expect(texts).toEqual([
    ["Sketch ‘Sketch Profile’ has no exportable vector geometry."],
    [
      "Sketch export skipped ‘Bottom’ because one of its points no longer exists.",
    ],
    ["Square region was not exported: its boundary could not be resolved."],
  ]);
  expectNoInternalIds(texts.flat(), ["entity_", "point_", "sketch_profile"]);
});

test("buildSketchVectorExportModel exports solved committed geometry for dimensioned rectangles", () => {
  const solvedSnapshot = createSolvedRectangleSnapshot();
  const modelOrFailure = buildSketchVectorExportModel({
    documentId: "doc_export",
    revisionId: "rev_0001",
    sketches: [createSketchSnapshot(solvedSnapshot)],
    target: { kind: "sketch", sketchId: "sketch_profile" },
  });

  expect(
    "diagnostic" in modelOrFailure,
    "Committed sketch targets should resolve to a sketch vector export model.",
  ).toBeFalsy();
  const model = modelOrFailure as SketchVectorExportModel;
  const redLine = model.entities.find(
    (entity) =>
      entity.kind === "lineSegment" && entity.entityId === "entity_ab",
  );
  const rightLine = model.entities.find(
    (entity) =>
      entity.kind === "lineSegment" && entity.entityId === "entity_bc",
  );

  expect(
    redLine?.kind === "lineSegment" &&
      redLine.start[0] === 0 &&
      redLine.start[1] === 0 &&
      redLine.end[0] === 5.19 &&
      redLine.end[1] === 0,
    "Sketch export should use solved line positions, not original authored draft positions.",
  ).toBeTruthy();
  expect(
    rightLine?.kind === "lineSegment" &&
      rightLine.start[0] === 5.19 &&
      rightLine.start[1] === 0 &&
      rightLine.end[0] === 5.19 &&
      rightLine.end[1] === 9.48,
    "Dimensioned vertical rectangle export should preserve the solved 5.19 by 9.48 dimensions.",
  ).toBeTruthy();
  expect(
    redLine.style?.stroke?.color,
    "Solved geometry export should preserve authored red stroke style.",
  ).toBe("#ff3366");
});

function createSketchSnapshot(
  solvedSnapshot = createSolvedSnapshot(),
): SketchSnapshotRecord {
  const definition: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: [
      "point_a",
      "point_b",
      "point_c",
      "point_d",
      "point_center",
      "point_major",
    ],
    points: [
      makePoint("point_a", [0, 0]),
      makePoint("point_b", [10, 0]),
      makePoint("point_c", [10, 6]),
      makePoint("point_d", [0, 6]),
      makePoint("point_center", [5, 3]),
      makePoint("point_major", [7, 3]),
    ],
    entityIds: [
      "entity_ab",
      "entity_bc",
      "entity_cd",
      "entity_da",
      "entity_circle",
      "entity_ellipse",
    ],
    entities: [
      makeLine("entity_ab", "point_a", "point_b", {
        strokeEnabled: true,
        strokeColor: "#ff3366",
        strokeWidth: 2,
      }),
      makeLine("entity_bc", "point_b", "point_c"),
      makeLine("entity_cd", "point_c", "point_d"),
      makeLine("entity_da", "point_d", "point_a"),
      {
        kind: "circle",
        entityId: "entity_circle",
        label: "Circle",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_profile",
          entityId: "entity_circle",
        },
        isConstruction: false,
        centerPointId: "point_center",
        radius: 2,
      },
      {
        kind: "ellipse",
        entityId: "entity_ellipse",
        label: "Ellipse",
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_profile",
          entityId: "entity_ellipse",
        },
        isConstruction: false,
        centerPointId: "point_center",
        majorAxisPointId: "point_major",
        minorRadius: 1,
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    styleIds: ["style_region"],
    styles: [
      {
        styleId: "style_region",
        label: "Region fill",
        target: { kind: "region", regionId: "region_square" },
        fill: {
          kind: "gradient",
          gradient: {
            kind: "linear",
            angleRadians: Math.PI / 4,
            startColor: "#2266ff",
            startOpacity: 0.25,
            endColor: "#ffcc33",
            endOpacity: 0.75,
          },
        },
        stroke: {
          color: "#111827",
          opacity: 0,
          width: 0,
          lineCap: "round",
          lineJoin: "round",
          miterLimit: 4,
        },
      },
    ],
  };
  const plane = createStandardPlaneDefinition("xy");
  const region = createRegion();

  return {
    ownerDocumentId: "doc_export",
    ownerRevisionId: "rev_0001",
    ownerFeatureId: null,
    ownerSketchId: "sketch_profile",
    ownerBodyId: null,
    sketchId: "sketch_profile",
    label: "Sketch Profile",
    plane,
    sketch: {
      ownerDocumentId: "doc_export",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_profile",
      ownerBodyId: null,
      sketchId: "sketch_profile",
      label: "Sketch Profile",
      planeSupport: plane.support,
      definition,
      solvedSnapshot,
      derivedValidity: deriveSketchValidity({ solvedSnapshot }),
      regions: [region],
    },
  };
}

function createSolvedRectangleSnapshot(): SolvedSketchSnapshot {
  return {
    schemaVersion: "solved-sketch/v1alpha2",
    status: { solveState: "solved", constraintState: "wellConstrained" },
    solvedPoints: [
      { pointId: "point_a", solvedPosition: [0, 0] },
      { pointId: "point_b", solvedPosition: [5.19, 0] },
      { pointId: "point_c", solvedPosition: [5.19, 9.48] },
      { pointId: "point_d", solvedPosition: [0, 9.48] },
      { pointId: "point_center", solvedPosition: [2.595, 4.74] },
      { pointId: "point_major", solvedPosition: [4.595, 4.74] },
    ],
    solvedEntities: [
      {
        entityId: "entity_ab",
        kind: "lineSegment",
        startPosition: [0, 0],
        endPosition: [5.19, 0],
      },
      {
        entityId: "entity_bc",
        kind: "lineSegment",
        startPosition: [5.19, 0],
        endPosition: [5.19, 9.48],
      },
      {
        entityId: "entity_cd",
        kind: "lineSegment",
        startPosition: [5.19, 9.48],
        endPosition: [0, 9.48],
      },
      {
        entityId: "entity_da",
        kind: "lineSegment",
        startPosition: [0, 9.48],
        endPosition: [0, 0],
      },
      {
        entityId: "entity_circle",
        kind: "circle",
        centerPosition: [2.595, 4.74],
        solvedRadius: 1,
      },
      {
        entityId: "entity_ellipse",
        kind: "ellipse",
        centerPosition: [2.595, 4.74],
        majorAxisEndpointPosition: [4.595, 4.74],
        minorRadius: 1,
      },
    ],
    constraintStatuses: [],
    dimensionStatuses: [],
    diagnostics: [],
  };
}

function makePoint(pointId: string, position: readonly [number, number]) {
  return {
    pointId,
    label: pointId,
    target: {
      kind: "sketchPoint" as const,
      sketchId: "sketch_profile" as const,
      pointId,
    },
    position,
    isConstruction: false,
  };
}

function makeLine(
  entityId: string,
  startPointId: string,
  endPointId: string,
  style?: SketchDefinition["entities"][number]["style"],
) {
  return {
    kind: "lineSegment" as const,
    entityId,
    label: entityId,
    target: {
      kind: "sketchEntity" as const,
      sketchId: "sketch_profile" as const,
      entityId,
    },
    isConstruction: false,
    startPointId,
    endPointId,
    style,
  };
}

function createSolvedSnapshot(): SolvedSketchSnapshot {
  return {
    schemaVersion: "solved-sketch/v1alpha2",
    status: { solveState: "notEvaluated", constraintState: "unknown" },
    solvedEntities: [],
    solvedPoints: [],
    constraintStatuses: [],
    dimensionStatuses: [],
    diagnostics: [],
  };
}

function createRegion(): RegionRecord {
  return {
    ownerDocumentId: "doc_export",
    ownerRevisionId: "rev_0001",
    ownerFeatureId: null,
    ownerSketchId: "sketch_profile",
    ownerBodyId: null,
    regionId: "region_square",
    signature: "hand-built square",
    label: "Square region",
    target: {
      kind: "region",
      sketchId: "sketch_profile",
      regionId: "region_square",
    },
    sourceSketch: { kind: "sketch", sketchId: "sketch_profile" },
    isClosed: true,
    loops: [
      {
        loopId: "region_loop_square_outer",
        role: "outer",
        orientation: "counterClockwise",
        isClosed: true,
        segments: lineLoopSegmentsForTest(
          [
            { pointId: "point_a", position: [0, 0] },
            { pointId: "point_b", position: [5.19, 0] },
            { pointId: "point_c", position: [5.19, 9.48] },
            { pointId: "point_d", position: [0, 9.48] },
          ] as never,
          ["entity_ab", "entity_bc", "entity_cd", "entity_da"] as never,
        ),
      },
    ],
  };
}
