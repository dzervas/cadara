import { describe, expect, test } from "vitest";

import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  DimensionId,
  ProjectedGeometryId,
  ReferenceId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import { validateSketchDefinition } from "@/contracts/sketch/runtime-schema";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  beginSketchTool,
  createSketchSessionFromSnapshot,
  isSketchMergePointsReady,
  patchSketchEditToolValue,
  selectSketchEditToolTarget,
  updateSketchEditToolHover,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { updateSketchReferenceProjection } from "@/domain/editor/sketch-session/references";
import {
  getSketchSelectionCycleContext,
  isSketchSelectionCycleTargetEligible,
} from "@/domain/editor/sketch-session/selection";
import { createSketchMergePointsMutation } from "@/domain/sketch-editing/merge-points";
import { normalizeSketchDefinition } from "@/domain/modeling/modeling-service/normalization";
import { getEnterEvent } from "@/domain/editor/workbench-interactions";
import {
  initialEditorState,
  transitionEditorState,
  type SketchEditorState,
} from "@/core/editor/state-machine";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";

// Lane: logic (docs/testing.md). Seam: the sketch session's Merge Points
// tool (T13j, D25): picks, the destination presentation, confirm and
// cancel, the commit solve and its conflict explanation, selection-first
// activation through the editor reducer, the cycle context and Enter.

const pid = (name: string) => `sketch_point_${name}` as SketchPointId;

/** A triangle a→b→c→(gap)→a2 whose last side ends 0.01 from a. */
function triangle(extra?: (f: ReturnType<typeof makeSketchFixture>) => void) {
  const f = makeSketchFixture();
  f.point("a", 0, 0);
  f.point("b", 4, 0);
  f.point("c", 2, 3);
  f.point("a2", 0.01, 0.005);
  f.point("o", 10, 0);
  f.line("ab", "a", "b");
  f.line("bc", "b", "c");
  f.line("ca", "c", "a2");
  f.circle("ring", "o", 1);
  extra?.(f);
  return f;
}

function open(fixture = triangle()): SketchSessionState {
  return updateSketchReferenceProjection(
    createSketchSessionFromSnapshot(
      sketchSnapshotRecordForTest(
        fixture.build(),
        [],
        createStandardPlaneDefinition("xy"),
      ),
      OCC_KERNEL_SETTINGS,
    ),
    [],
    [],
  );
}

function point(session: SketchSessionState, name: string): PrimitiveRef {
  return {
    kind: "sketchPoint",
    sketchId: session.sketchId as SketchId,
    pointId: pid(name),
  };
}

function pick(session: SketchSessionState, ...names: string[]) {
  return names.reduce(
    (current, name) =>
      selectSketchEditToolTarget(current, point(current, name)),
    beginSketchTool(session, "sketchMergePoints"),
  );
}

const merge = (session: SketchSessionState) =>
  patchSketchEditToolValue(session, { intent: "mergePoints" });

describe("Merge Points session (T13j)", () => {
  test("source then destination: the destination is labelled, an arrow previews the merge, nothing is authored before confirm", () => {
    const session = open();
    const source = pick(session, "a2");
    expect(source.toolPresentation?.prompts[0]?.text).toBe(
      "Pick the destination for a2",
    );
    expect(source.toolPresentation?.overlays).toEqual([
      expect.objectContaining({
        kind: "referenceLabel",
        label: "Source",
        anchor: expect.objectContaining({ point: [0.01, 0.005] }),
      }),
    ]);
    expect(isSketchMergePointsReady(source)).toBe(false);

    const ready = selectSketchEditToolTarget(source, point(source, "a"));
    expect(ready.definition, "picking authors nothing").toBe(
      session.definition,
    );
    expect(ready.activeEditTool?.selectedTargets).toEqual([
      point(session, "a2"),
      point(session, "a"),
    ]);
    expect(ready.toolPresentation?.prompts[0]).toEqual({
      id: "sketchMergePoints-prompt",
      text: "Merge a2 into a \u2014 Enter or Merge to confirm",
      tone: "neutral",
    });
    expect(ready.toolPresentation?.overlays).toEqual([
      {
        id: "merge-points-destination",
        kind: "referenceLabel",
        label: "Destination",
        anchor: {
          kind: "sketchPoint",
          point: [0, 0],
          offset: { x: 0, y: -24 },
        },
      },
    ]);
    const arrow = ready.toolStagedEntities[0];
    expect(arrow?.kind).toBe("polyline");
    expect(arrow?.kind === "polyline" && arrow.points.slice(0, 2)).toEqual([
      [0.01, 0.005],
      [0, 0],
    ]);
    expect(arrow?.kind === "polyline" && arrow.points[3]).toEqual([0, 0]);
    expect(ready.toolPresentation?.floatingInput).toEqual(
      expect.objectContaining({
        confirmOnly: true,
        confirmLabel: "Merge",
        cancelLabel: "Cancel",
        readout: "a2 \u2192 a",
        // Review R-3: below the destination, clear of the label above it.
        anchor: {
          kind: "sketchPoint",
          point: [0, 0],
          offset: { x: -110, y: 140 },
        },
        submitAction: { type: "patch", patch: { intent: "mergePoints" } },
        cancelAction: {
          type: "patch",
          patch: { intent: "cancelSketchEditOperator" },
        },
      }),
    );
    expect(isSketchMergePointsReady(ready)).toBe(true);
    // Hovering keeps the merge presentation (no generic "Unsupported target").
    expect(
      updateSketchEditToolHover(ready, point(ready, "b")).toolPresentation
        ?.overlays,
    ).toEqual(ready.toolPresentation?.overlays);
  });

  test("confirm commits exactly the merge as one definition change; the tool stays armed", () => {
    const session = open();
    const ready = pick(session, "a2", "a");
    const merged = merge(ready);
    const expected = createSketchMergePointsMutation({
      definition: session.definition,
      sourcePointId: pid("a2"),
      destinationPointId: pid("a"),
    });
    expect(expected.valid).toBe(true);
    expect(merged.definition).toEqual(expected.valid && expected.definition);
    expect(merged.sequence).toBe(ready.sequence + 1);
    expect(merged.commitRequest?.definition.pointIds).not.toContain(pid("a2"));
    expect(merged.liveSolve?.accepted).toBe(true);
    expect(merged.validationMessage).toBeNull();
    expect(merged.activeEditTool).toEqual(
      expect.objectContaining({
        toolId: "sketchMergePoints",
        selectedTargets: [],
      }),
    );
    expect(merged.toolPresentation?.prompts[0]).toEqual({
      id: "sketchMergePoints-prompt",
      text: "Merged a2 into a.",
      tone: "success",
    });
    expect(merged.toolStagedEntities).toEqual([]);
  });

  test("an absorbed coincident is announced", () => {
    const session = open(triangle((f) => f.coincident("a2", "a")));
    const merged = merge(pick(session, "a2", "a"));
    expect(merged.definition.constraints).toEqual([]);
    expect(merged.toolPresentation?.prompts[0]?.text).toBe(
      "Merged a2 into a. 1 coincident between them is now part of the merge.",
    );
  });

  test("a distance between the pair is retained: the invalid merge is explained with blocked profiles", () => {
    const fixture = triangle();
    const definition = fixture.definition();
    const withGap: SketchDefinition = {
      ...definition,
      dimensionIds: ["dimension_gap" as DimensionId],
      dimensions: [
        {
          dimensionId: "dimension_gap" as DimensionId,
          kind: "distance",
          label: "Gap",
          axis: "aligned",
          pointIds: [pid("a2"), pid("a")],
          value: 0.5,
        },
      ],
    };
    const session = open({
      ...fixture,
      build: () => ({ ...fixture.build(), definition: withGap }),
    });
    expect(session.liveSolve?.accepted, "premise: accepted before").toBe(true);
    const merged = merge(pick(session, "a2", "a"));
    expect(merged.definition.dimensions[0]).toEqual({
      ...withGap.dimensions[0],
      pointIds: [pid("a"), pid("a")],
    });
    expect(merged.liveSolve?.accepted).toBe(false);
    const explanation =
      "Gap (0.5 mm) cannot be satisfied. The sketch is invalid; profiles from it are blocked. Change or delete it, or Undo.";
    // Review A-1: the persistent explanation names the merge, the change
    // the user committed.
    expect(merged.validationMessage).toBe(`Merging a2 into a: ${explanation}`);
    expect(merged.toolPresentation?.prompts[0]).toEqual(
      expect.objectContaining({ text: "Merged a2 into a.", tone: "warning" }),
    );

    // Save and reopen the invalid merge: the persisted definition validates
    // and normalizes unchanged, and the reopened session explains it again
    // (a reopened sketch knows no merge, so the T13c text alone).
    const saved = normalizeSketchDefinition(merged.commitRequest!.definition);
    expect(validateSketchDefinition(saved).success).toBe(true);
    expect(saved.pointIds).toEqual(merged.definition.pointIds);
    expect(saved.dimensions[0]).toEqual(
      expect.objectContaining({
        dimensionId: "dimension_gap",
        pointIds: [pid("a"), pid("a")],
      }),
    );
    const reopened = open({
      ...fixture,
      build: () => ({
        ...fixture.build(),
        definition: saved,
        solvedSnapshot: solveSketchDefinitionCore({
          definition: saved,
          tolerances: merged.solverTolerances,
          modelingTolerance: merged.modelingTolerance,
          partialSolvePolicy: "bestEffort",
        }).solvedSnapshot,
      }),
    });
    expect(reopened.definition).toEqual(saved);
    expect(reopened.validationMessage).toBe(explanation);
  });

  test("no solve gate: a merge on an already invalid sketch commits", () => {
    const session = open(
      triangle((f) => {
        f.lineLength("bc", 2);
        f.lineLength("bc", 9);
      }),
    );
    expect(session.liveSolve?.accepted, "premise: invalid").toBe(false);
    const merged = merge(pick(session, "a2", "a"));
    expect(merged.definition.pointIds).not.toContain(pid("a2"));
    expect(merged.validationMessage).toContain("conflict");
  });

  test("refused picks are not taken and say why; a refused pair keeps the source", () => {
    const session = open();
    const centre = pick(session, "o");
    expect(centre.activeEditTool?.selectedTargets).toEqual([]);
    expect(centre.validationMessage).toBe(
      "o is the centre of ring; centres are not merged. Use Concentric or Coincident instead.",
    );
    const same = pick(session, "a", "a");
    expect(same.activeEditTool?.selectedTargets).toEqual([point(session, "a")]);
    expect(same.validationMessage).toBe(
      "Pick two different points: a point cannot be merged into itself.",
    );
    const line = pick(session, "a", "b");
    expect(line.activeEditTool?.selectedTargets).toEqual([point(session, "a")]);
    expect(line.validationMessage).toBe(
      "Both points are ends of ab; merging them would collapse it.",
    );
    expect(isSketchMergePointsReady(line)).toBe(false);
    expect(merge(line).definition, "a refused pair commits nothing").toBe(
      session.definition,
    );
    const projected = selectSketchEditToolTarget(
      beginSketchTool(session, "sketchMergePoints"),
      {
        kind: "sketchDatumReference",
        sketchId: session.sketchId as SketchId,
        datumId: "origin",
        geometryKind: "point",
      } satisfies PrimitiveRef,
    );
    expect(projected.validationMessage).toBe(
      "Projected and datum points are not local sketch points; they cannot be merged.",
    );
    expect(projected.activeEditTool?.selectedTargets).toEqual([]);
  });

  // Review A-4: a refused third pick keeps the current destination.
  test("a refused third pick keeps the source and the current destination", () => {
    const session = open();
    // a2 and c are both ends of line ca.
    const refused = pick(session, "a2", "a", "c");
    expect(refused.activeEditTool?.selectedTargets).toEqual([
      point(session, "a2"),
      point(session, "a"),
    ]);
    expect(refused.validationMessage).toBe(
      "Both points are ends of ca; merging them would collapse it.",
    );
    expect(refused.toolPresentation?.overlays?.[0]).toEqual(
      expect.objectContaining({ label: "Destination" }),
    );
  });

  test("R-5: closing a spline by merge announces it", () => {
    const session = open(
      triangle((f) => {
        f.point("s0", 20, 0);
        f.point("s1", 24, 0);
        f.point("s2", 22, 3);
        f.point("s3", 20.02, 0.01);
        f.spline("loop", ["s0", "s1", "s2", "s3"], "open");
      }),
    );
    const merged = merge(pick(session, "s3", "s0"));
    const spline = merged.definition.entities.find(
      (entity) => entity.entityId === "sketch_entity_loop",
    );
    expect(spline?.kind === "spline" && spline.closure).toBe("positional");
    expect(merged.toolPresentation?.prompts[0]?.text).toBe(
      "Merged s3 into s0. loop is now closed.",
    );
  });

  test("picking the destination again unpicks it; a third point replaces the destination", () => {
    const session = open();
    expect(
      pick(session, "a2", "a", "a").activeEditTool?.selectedTargets,
    ).toEqual([point(session, "a2")]);
    expect(
      pick(session, "a2", "a", "b").activeEditTool?.selectedTargets,
    ).toEqual([point(session, "a2"), point(session, "b")]);
  });

  test("cancel authors nothing and keeps the tool armed", () => {
    const session = open();
    const cancelled = patchSketchEditToolValue(pick(session, "a2", "a"), {
      intent: "cancelSketchEditOperator",
    });
    expect(cancelled.definition).toBe(session.definition);
    expect(cancelled.activeEditTool?.selectedTargets).toEqual([]);
    expect(cancelled.toolPresentation?.floatingInput).toBeNull();
  });

  test("T11 cycle context: replace-last-added over this sketch's points and Point-tool entities only (review R-2)", () => {
    const fixture = triangle();
    const definition = fixture.definition();
    const pointEntity = {
      ...definition.entities[0]!,
      kind: "point",
      entityId: "sketch_entity_dot",
      label: "dot",
      pointId: pid("o"),
    } as SketchDefinition["entities"][number];
    const session = pick(
      open({
        ...fixture,
        build: () => ({
          ...fixture.build(),
          definition: {
            ...definition,
            entityIds: [...definition.entityIds, pointEntity.entityId],
            entities: [...definition.entities, pointEntity],
          },
        }),
      }),
      "a2",
    );
    const entityRef = (entityId: string): PrimitiveRef => ({
      kind: "sketchEntity",
      sketchId: session.sketchId as SketchId,
      entityId: entityId as SketchEntityId,
    });
    expect(
      isSketchSelectionCycleTargetEligible(
        session,
        entityRef("sketch_entity_ab"),
      ),
      "a line the tool refuses is not cycled to",
    ).toBe(false);
    expect(
      isSketchSelectionCycleTargetEligible(
        session,
        entityRef("sketch_entity_dot"),
      ),
      "a Point-tool entity is",
    ).toBe(true);
    expect(getSketchSelectionCycleContext(session, null).mode).toBe(
      "replaceLastAdded",
    );
    expect(
      isSketchSelectionCycleTargetEligible(session, point(session, "a")),
    ).toBe(true);
    expect(
      isSketchSelectionCycleTargetEligible(session, {
        kind: "projectedReferenceGeometry",
        referenceId: "ref_r" as ReferenceId,
        geometryId: "projected_geometry_g" as ProjectedGeometryId,
        geometryKind: "point",
      }),
    ).toBe(false);
  });

  test("Enter confirms only a ready merge", () => {
    const session = open();
    expect(getEnterEvent({ sketchSession: pick(session, "a2") })).toBeNull();
    expect(getEnterEvent({ sketchSession: pick(session, "a2", "a") })).toEqual({
      type: "sketch.toolPatched",
      patch: { intent: "mergePoints" },
    });
  });
});

describe("selection-first activation (T13j)", () => {
  async function activate(selection: readonly string[]) {
    const session = open();
    const state = {
      ...initialEditorState,
      kind: "editingSketch",
      mode: "sketch",
      snapshot: await createSeedDocumentSnapshot(),
      document: { documentId: "doc_workspace", revisionId: "rev_1" },
      command: {
        commandSessionId: "command_test",
        toolId: "sketch",
        phase: "editing",
      },
      session,
      selection: selection.map((name) => point(session, name)),
      pendingCommitRequestId: null,
      pendingImportRequestId: null,
      pendingProjectionRequestId: null,
    } as SketchEditorState;
    const result = transitionEditorState(state, {
      type: "tool.activated",
      toolId: "sketchMergePoints",
    });
    if (result.state.kind !== "editingSketch")
      throw new Error("Expected sketch state");
    return { session, next: result.state.session };
  }

  test.each([[["a2", "a"]], [["a", "a2"]]])(
    "two selected points are adopted in selection order (%j)",
    async (names) => {
      const { session, next } = await activate(names);
      expect(next.activeEditTool?.selectedTargets).toEqual(
        names.map((name) => point(session, name)),
      );
      expect(next.toolPresentation?.prompts[0]?.text).toBe(
        `Merge ${names[0]} into ${names[1]} \u2014 Enter or Merge to confirm`,
      );
    },
  );

  test("one selected point is adopted as the source", async () => {
    const { session, next } = await activate(["a2"]);
    expect(next.activeEditTool?.selectedTargets).toEqual([
      point(session, "a2"),
    ]);
    expect(next.toolPresentation?.prompts[0]?.text).toBe(
      "Pick the destination for a2",
    );
  });
});
