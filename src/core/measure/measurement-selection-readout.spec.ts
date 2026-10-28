import { defaultEditorExtensionDependencies } from "@/composition/editor-extension-dependencies";
/**
 * cadara-h026.3: the measurement readout of the plain selection, with no
 * tool armed. Logic lane; seams: `getMeasurementReadoutSource` (which
 * editor states show a readout, and of what), `deriveMeasurementViewModel`
 * with `source: "selection"` (pick order, the min / max / centre distance,
 * its X/Y/Z components, angles, the many-target summary, witnesses, dense
 * meshes), `getTopologyMeasureTargets` (what the kernel is asked) and
 * `openSketchMeasurementRecord` (an open sketch is measured live, not at its
 * last commit).
 */
import { describe, expect, test } from "vitest";

import type {
  SketchSnapshotRecord,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type {
  CommandSessionId,
  FaceId,
  SketchEntityId,
} from "@/contracts/shared/ids";
import {
  initialEditorState,
  transitionEditorState,
  type EditorState,
} from "@/core/editor/state-machine";
import type { EditorCommandToolId } from "@/core/editor/state-machine/types";
import type { PrimitiveRef } from "@/core/editor/schema";
import { enterSketchSessionState } from "@/core/editor/sketch-entry.fixtures";
import { createSketchSessionFromSnapshot } from "@/core/editor/sketch-session";
import {
  deriveMeasurementViewModel,
  getMeasurementReadoutSource,
  getTopologyMeasureTargets,
  MAX_TOPOLOGY_MEASURE_TARGETS,
  type MeasurementDistanceMode,
} from "@/core/measure/measurement";
import { createMeasurementSnapshotForTest } from "@/core/measure/measurement.fixtures";
import { openSketchMeasurementRecord } from "@/core/measure/open-sketch-measurement";
import { OCC_KERNEL_SETTINGS } from "@/core/modeling/opencascade-kernel-seed";

const snapshot = createMeasurementSnapshotForTest();

const sketchEntity = (entityId: SketchEntityId): PrimitiveRef => ({
  kind: "sketchEntity",
  sketchId: "sketch_measure",
  entityId,
});
const face = (faceId: FaceId): PrimitiveRef => ({
  kind: "face",
  bodyId: "body_measure",
  faceId,
});
const LINE_BOTTOM = sketchEntity("sketch_entity_line_bottom"); // (0,0)→(4,0)
const LINE_TOP = sketchEntity("sketch_entity_line_top"); // (4,3)→(0,3)
const CIRCLE = sketchEntity("sketch_entity_circle_primary"); // (8,1.5) r 1.25
const ARC = sketchEntity("sketch_entity_arc_primary"); // centre (12,1.5)
const REGION: PrimitiveRef = {
  kind: "region",
  sketchId: "sketch_measure",
  regionId: "region_measure",
};
const VERTEX: PrimitiveRef = {
  kind: "vertex",
  bodyId: "body_measure",
  vertexId: "vertex_top_front_left",
};

const readout = (
  selection: readonly PrimitiveRef[],
  distanceMode?: MeasurementDistanceMode,
) =>
  deriveMeasurementViewModel({
    source: "selection",
    selection,
    snapshot,
    ...(distanceMode ? { distanceMode } : {}),
  });
const rowsOf = (
  selection: readonly PrimitiveRef[],
  mode?: MeasurementDistanceMode,
) => readout(selection, mode)?.rows.map((row) => [row.label, row.value]);

describe("which editor states show a readout", () => {
  const selectionCommand = (toolId: EditorCommandToolId): EditorState => ({
    ...initialEditorState,
    kind: "selectionCommand",
    command: {
      commandSessionId: "command_readout" as CommandSessionId,
      toolId,
      phase: "collecting",
    },
    pendingRequestId: null,
  });

  test("part mode with no tool: the plain selection; the armed Measure tool: its picks; any other armed tool: none", () => {
    expect(getMeasurementReadoutSource(initialEditorState)).toBe("selection");
    expect(getMeasurementReadoutSource(selectionCommand("measure"))).toBe(
      "measureTool",
    );
    for (const toolId of ["extrude", "sketch", "sectionView"] as const)
      expect(
        getMeasurementReadoutSource(selectionCommand(toolId)),
        `${toolId} owns the selection`,
      ).toBeNull();
  });

  test("a feature dialog, an import, a section view or a sketch plane edit owns the selection: no readout", () => {
    // Only the state kind decides; the rest of each state is irrelevant here.
    for (const kind of [
      "editingFeature",
      "importing",
      "inspectingSection",
      "editingSketchPlane",
    ] as const)
      expect(
        getMeasurementReadoutSource({
          ...selectionCommand("extrude"),
          kind,
        } as unknown as EditorState),
        kind,
      ).toBeNull();
  });

  test("an open sketch with no sketch tool: the plain selection; an armed sketch tool owns it", () => {
    const record = snapshot.document.sketches[0]!;
    const sketch = enterSketchSessionState(
      createSketchSessionFromSnapshot(record, OCC_KERNEL_SETTINGS),
    );
    expect(getMeasurementReadoutSource(sketch)).toBe("selection");
    const drawing = transitionEditorState(sketch, {
      type: "tool.activated",
      toolId: "line",
    }, defaultEditorExtensionDependencies).state;
    expect(drawing.kind === "editingSketch" && drawing.session.activeTool).toBe(
      "line",
    );
    expect(getMeasurementReadoutSource(drawing)).toBeNull();
  });
});

describe("the plain selection's readout", () => {
  test("no source, no readout; one target shows its intrinsic properties without witnesses (the selection highlight shows it), unlike the Measure tool", () => {
    expect(
      deriveMeasurementViewModel({
        source: null,
        selection: [LINE_BOTTOM],
        snapshot,
      }),
    ).toBeNull();
    const line = readout([LINE_BOTTOM]);
    expect(line?.rows).toEqual([
      { id: "length", label: "Length", value: "4 mm" },
    ]);
    expect(line?.witnesses).toEqual([]);
    expect(line?.distanceMode).toBeUndefined();
    expect(
      deriveMeasurementViewModel({
        source: "measureTool",
        selection: [LINE_BOTTOM],
        snapshot,
      })?.witnesses,
      "control: the Measure tool draws the target's own witness",
    ).toHaveLength(1);
  });

  test("unmeasurable targets are skipped: a sketch and a face read as the face alone", () => {
    expect(
      readout([
        { kind: "sketch", sketchId: "sketch_measure" },
        face("face_top"),
      ])?.targetLabels,
    ).toEqual(["Face · Body A"]);
  });

  test("two targets: the minimum distance with its X/Y/Z components and the angle; only the distance witness is drawn", () => {
    const pair = readout([LINE_BOTTOM, LINE_TOP]);
    expect(pair?.distanceMode).toBe("minimum");
    expect(pair?.rows.map((row) => [row.label, row.value])).toEqual([
      ["Distance", "3 mm"],
      ["ΔX", "0 mm"],
      ["ΔY", "3 mm"],
      ["ΔZ", "0 mm"],
      ["Angle", "0 deg"],
    ]);
    expect(pair?.witnesses.map((witness) => witness.kind)).toEqual([
      "polyline",
    ]);
  });

  test("the min / max / centre switch: farthest vertices and centre to centre, with end markers", () => {
    expect(rowsOf([LINE_BOTTOM, LINE_TOP], "maximum")).toEqual([
      ["Distance", "5 mm"],
      ["ΔX", "4 mm"],
      ["ΔY", "3 mm"],
      ["ΔZ", "0 mm"],
      ["Angle", "0 deg"],
    ]);
    const centre = readout([LINE_BOTTOM, LINE_TOP], "center");
    expect(centre?.distanceMode).toBe("center");
    expect(centre?.rows.slice(0, 2)).toEqual([
      { id: "distance", label: "Distance", value: "3 mm" },
      { id: "delta-x", label: "ΔX", value: "0 mm" },
    ]);
    expect(centre?.witnesses.map((witness) => witness.kind)).toEqual([
      "polyline",
      "marker",
      "marker",
    ]);
    const connector = centre?.witnesses[0];
    expect(
      connector?.kind === "polyline" && connector.points,
      "the midpoints of the two lines",
    ).toEqual([
      [2, 0, 0],
      [2, 3, 0],
    ]);
  });

  test("a circle and an arc: the centre mode measures centre to centre, so the separate Center Distance row is only shown in the other modes", () => {
    expect(rowsOf([CIRCLE, ARC], "center")?.slice(0, 1)).toEqual([
      ["Distance", "4 mm"],
    ]);
    expect(
      rowsOf([CIRCLE, ARC], "center")?.map(([label]) => label),
    ).not.toContain("Center Distance");
    expect(rowsOf([CIRCLE, ARC])).toContainEqual(["Center Distance", "4 mm"]);
  });

  test("angles of planes: two planar faces, a line against a plane, a region against a face", () => {
    const angleOf = (selection: readonly PrimitiveRef[]) =>
      readout(selection)?.rows.find((row) => row.id === "angle")?.value;
    expect(angleOf([face("face_top"), face("face_front")])).toBe("90 deg");
    expect(angleOf([face("face_top"), face("face_bottom")])).toBe("0 deg");
    expect(angleOf([LINE_BOTTOM, face("face_front")])).toBe("0 deg");
    expect(angleOf([LINE_BOTTOM, face("face_left")])).toBe("90 deg");
    expect(angleOf([REGION, face("face_front")])).toBe("90 deg");
    expect(
      angleOf([VERTEX, face("face_front")]),
      "a point has no direction",
    ).toBeUndefined();
  });

  test("pick order: the distance runs from the oldest pick to the newest, and two alike labels are numbered in pick order", () => {
    const reversed = readout([LINE_TOP, LINE_BOTTOM], "center");
    const connector = reversed?.witnesses[0];
    expect(connector?.kind === "polyline" && connector.points).toEqual([
      [2, 3, 0],
      [2, 0, 0],
    ]);
    expect(
      readout([face("face_top"), face("face_bottom")])?.targetLabels,
    ).toEqual(["Face · Body A (1)", "Face · Body A (2)"]);
  });

  test("more than two targets: the count, the curves' total length and the surfaces' total area, no witnesses; the Measure tool still reads its first two", () => {
    const many = [LINE_BOTTOM, CIRCLE, face("face_top"), REGION, VERTEX];
    const summary = readout(many);
    expect(summary?.targetLabels).toEqual([]);
    expect(summary?.rows.map((row) => [row.label, row.value])).toEqual([
      ["Targets", "5"],
      // 4 + 2π·1.25
      ["Total Length", "11.85 mm"],
      // the face's mesh area (approximate) + the region's 12
      ["Total Area", "≈ 24 mm²"],
    ]);
    expect(summary?.witnesses).toEqual([]);
    expect(
      deriveMeasurementViewModel({
        source: "measureTool",
        selection: many,
        snapshot,
      })?.targetLabels,
    ).toHaveLength(2);
  });
});

describe("an open sketch is measured live", () => {
  test("a moved point is measured where the session has it, not at the last commit", () => {
    const committed = snapshot.document.sketches[0]!;
    const moved: SketchSnapshotRecord = {
      ...committed,
      sketch: {
        ...committed.sketch,
        definition: {
          ...committed.sketch.definition,
          points: committed.sketch.definition.points.map((point) =>
            point.pointId === "sketch_point_rect_b"
              ? { ...point, position: [6, 0] }
              : point,
          ),
        },
      },
    };
    const sketch = enterSketchSessionState(
      createSketchSessionFromSnapshot(moved, OCC_KERNEL_SETTINGS),
    );
    const openSketch = openSketchMeasurementRecord(snapshot, sketch.session);
    const length = (open: typeof openSketch | null) =>
      deriveMeasurementViewModel({
        source: "selection",
        selection: [LINE_BOTTOM],
        snapshot,
        openSketch: open,
      })?.rows;
    expect(length(null), "control: the last commit").toEqual([
      { id: "length", label: "Length", value: "4 mm" },
    ]);
    expect(length(openSketch)).toEqual([
      { id: "length", label: "Length", value: "6 mm" },
    ]);
  });
});

describe("pairs without a distance, degenerate modes and what the kernel is asked", () => {
  const withRenderables = (
    records: readonly RenderableEntityRecord[],
    extraBody = false,
  ): WorkspaceSnapshot => ({
    ...snapshot,
    document: {
      ...snapshot.document,
      bodies: extraBody
        ? [
            ...snapshot.document.bodies,
            {
              ...snapshot.document.bodies[0]!,
              bodyId: "body_b",
              ownerBodyId: "body_b",
              label: "Body B",
            },
          ]
        : snapshot.document.bodies,
      render: {
        ...snapshot.document.render,
        records: [...snapshot.document.render.records, ...records],
      },
    },
  });
  const BODY_A: PrimitiveRef = { kind: "body", bodyId: "body_measure" };
  const BODY_B: PrimitiveRef = { kind: "body", bodyId: "body_b" };

  test("two bodies, or a body and a face, are summarised (no Measure-tool hint); the Measure tool keeps its hint", () => {
    const twoBodies = withRenderables([], true);
    const bodies = deriveMeasurementViewModel({
      source: "selection",
      selection: [BODY_A, BODY_B],
      snapshot: twoBodies,
    });
    expect([bodies?.rows, bodies?.note, bodies?.distanceMode]).toEqual([
      [{ id: "targets", label: "Targets", value: "2" }],
      null,
      undefined,
    ]);
    expect(rowsOf([BODY_A, face("face_top")])).toEqual([
      ["Targets", "2"],
      ["Total Area", "≈ 12 mm²"],
    ]);
    expect(
      deriveMeasurementViewModel({
        source: "measureTool",
        selection: [BODY_A, face("face_top")],
        snapshot,
      })?.note,
    ).toBe(
      "Select a supported point, edge, face, or profile target pair to inspect distance.",
    );
  });

  test("a mode with no result for a supported pair keeps the switch and says so", () => {
    const degenerate = withRenderables([
      {
        id: "renderable_edge_degenerate",
        label: "edge_degenerate",
        ownerBodyId: "body_measure",
        ownerFeatureId: "feature_body",
        binding: {
          pickId: "pick_edge_degenerate",
          pickPriority: 5,
          target: {
            kind: "edge",
            bodyId: "body_measure",
            edgeId: "edge_degenerate",
          },
          topology: "edge",
          semanticClass: "featureEdge",
        },
        geometry: {
          kind: "polyline",
          points: [
            [9, 9, 9],
            [9, 9, 9],
          ],
          isClosed: false,
        },
      },
    ]);
    const centre = deriveMeasurementViewModel({
      source: "selection",
      selection: [
        { kind: "edge", bodyId: "body_measure", edgeId: "edge_degenerate" },
        LINE_BOTTOM,
      ],
      snapshot: degenerate,
      distanceMode: "center",
    });
    expect([centre?.rows, centre?.note, centre?.distanceMode]).toEqual([
      [],
      "The centre distance is unavailable for this pair.",
      "center",
    ]);
  });

  test("the kernel is asked for faces and edges, a body only alone, at most the cap", () => {
    const edge = (index: number): PrimitiveRef => ({
      kind: "edge",
      bodyId: "body_measure",
      edgeId: `edge_${index}`,
    });
    expect(getTopologyMeasureTargets([BODY_A])).toEqual([BODY_A]);
    expect(
      getTopologyMeasureTargets([BODY_A, face("face_top"), LINE_BOTTOM]),
    ).toEqual([face("face_top")]);
    const many = Array.from(
      { length: MAX_TOPOLOGY_MEASURE_TARGETS + 5 },
      (_, index) => edge(index),
    );
    expect(getTopologyMeasureTargets(many)).toEqual(
      many.slice(0, MAX_TOPOLOGY_MEASURE_TARGETS),
    );
  });

  test("two dense curved faces are measured in well under a second (the brute-force triangle scan took ~5 s here)", () => {
    // Two 1024-triangle cylinders (r 5, height 10), axes 20 apart.
    const cylinder = (faceId: FaceId, cx: number): RenderableEntityRecord => {
      const segments = 64;
      const rings = 8;
      const vertexPositions: [number, number, number][] = [];
      for (let ring = 0; ring <= rings; ring += 1)
        for (let step = 0; step < segments; step += 1) {
          const angle = (2 * Math.PI * step) / segments;
          vertexPositions.push([
            cx + 5 * Math.cos(angle),
            5 * Math.sin(angle),
            (10 * ring) / rings,
          ]);
        }
      const triangleIndices: [number, number, number][] = [];
      for (let ring = 0; ring < rings; ring += 1)
        for (let step = 0; step < segments; step += 1) {
          const a = ring * segments + step;
          const b = ring * segments + ((step + 1) % segments);
          triangleIndices.push(
            [a, b, b + segments],
            [a, b + segments, a + segments],
          );
        }
      return {
        id: `renderable_${faceId}`,
        label: faceId,
        ownerBodyId: "body_measure",
        ownerFeatureId: "feature_body",
        binding: {
          pickId: `pick_${faceId}`,
          pickPriority: 10,
          target: { kind: "face", bodyId: "body_measure", faceId },
          topology: "face",
          semanticClass: "bodyFace",
        },
        geometry: {
          kind: "mesh",
          vertexPositions,
          vertexNormals: null,
          triangleIndices,
        },
      };
    };
    const dense = withRenderables([
      cylinder("face_cylinder_a", 0),
      cylinder("face_cylinder_b", 20),
    ]);
    const started = performance.now();
    const pair = deriveMeasurementViewModel({
      source: "selection",
      selection: [face("face_cylinder_a"), face("face_cylinder_b")],
      snapshot: dense,
    });
    const elapsed = performance.now() - started;
    expect(pair?.rows[0]).toEqual({
      id: "distance",
      label: "Distance",
      value: "≈ 10 mm",
    });
    expect(elapsed, "milliseconds for the dense pair").toBeLessThan(1000);
  }, 15_000);
});
