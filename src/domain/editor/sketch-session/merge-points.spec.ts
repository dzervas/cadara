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
import {
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import {
  requireSketchDefinition,
  validateSketchDefinition,
} from "@/contracts/sketch/runtime-schema";
import { solveSketchDefinitionCore } from "@/core/sketch-solver";
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
import {
  getEnterEvent,
  getEscapeEvent,
  getSketchMergeOfferEvents,
} from "@/domain/editor/workbench-interactions";
import { createSketchActionOwnerFixture } from "@/application/editor/sketch-action-owner.fixtures";
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

/** The triangle with a 0.5 distance between a2 and a (retained by a merge). */
function gapTriangle() {
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
        value: createLiteralAuthoredValue(0.5),
      },
    ],
  };
  const session = open({
    ...fixture,
    build: () => ({ ...fixture.build(), definition: withGap }),
  });
  return { fixture, withGap, session };
}

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
    const { fixture, withGap, session } = gapTriangle();
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

    // Save and reopen the invalid merge: the persisted definition parses
    // (the Typia persistence validator) unchanged, and the reopened session explains it again
    // (a reopened sketch knows no merge, so the T13c text alone).
    const saved = requireSketchDefinition(merged.commitRequest!.definition);
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
          definition: literalResolvedDefinition(saved),
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
    expect(centre.toolPresentation?.validation?.[0]?.message).toBe(
      "o is the centre of ring; centres are not merged. Use Concentric or Coincident instead.",
    );
    const same = pick(session, "a", "a");
    expect(same.activeEditTool?.selectedTargets).toEqual([point(session, "a")]);
    expect(same.toolPresentation?.validation?.[0]?.message).toBe(
      "Pick two different points: a point cannot be merged into itself.",
    );
    const line = pick(session, "a", "b");
    expect(line.activeEditTool?.selectedTargets).toEqual([point(session, "a")]);
    expect(line.toolPresentation?.validation?.[0]?.message).toBe(
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
    expect(projected.toolPresentation?.validation?.[0]?.message).toBe(
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
    expect(refused.toolPresentation?.validation?.[0]?.message).toBe(
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

// T13k (D26). Seam: the near-gap hint's Merge… events
// (`getSketchMergeOfferEvents`) through the real editor reducer.
describe("Merge… from the near-gap hint (T13k)", () => {
  async function editing(selection: readonly PrimitiveRef[]) {
    const session = open();
    return {
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
      selection: [...selection],
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
    } as SketchEditorState;
  }
  const run = (
    state: SketchEditorState,
    events: Parameters<typeof transitionEditorState>[1][],
  ) => {
    const next = events.reduce(
      (current, event) => transitionEditorState(current, event).state,
      state as Parameters<typeof transitionEditorState>[0],
    );
    if (next.kind !== "editingSketch") throw new Error("Expected sketch");
    return next;
  };

  test("arms Merge Points with the hovered end as source and stages its partner as the destination; nothing merges until Enter", async () => {
    const session = open();
    // A point selected before would be adopted as the source by plain
    // activation; the offer starts from a clean selection instead.
    const before = await editing([point(session, "b")]);
    const armed = run(
      before,
      getSketchMergeOfferEvents(point(session, "a2"), point(session, "a")),
    );
    expect(armed.command.toolId).toBe("sketchMergePoints");
    expect(armed.session.activeTool).toBe("sketchMergePoints");
    expect(armed.session.activeEditTool?.selectedTargets).toEqual([
      point(session, "a2"),
      point(session, "a"),
    ]);
    expect(armed.session.toolPresentation?.prompts[0]?.text).toBe(
      "Merge a2 into a \u2014 Enter or Merge to confirm",
    );
    expect(armed.session.toolPresentation?.overlays?.[0]).toEqual(
      expect.objectContaining({
        label: "Destination",
        anchor: expect.objectContaining({ point: [0, 0] }),
      }),
    );
    // The Merge… click itself changes no geometry and requests no commit.
    expect(armed.session.definition).toBe(before.session.definition);
    expect(armed.session.sequence).toBe(before.session.sequence);
    expect(armed.session.commitRequest).toBe(before.session.commitRequest);
    expect(armed.session.toolPresentation?.floatingInput).toEqual(
      expect.objectContaining({ confirmOnly: true, confirmLabel: "Merge" }),
    );

    // The explicit confirm merges.
    const enter = getEnterEvent({ sketchSession: armed.session });
    expect(enter).toEqual({
      type: "sketch.toolPatched",
      patch: { intent: "mergePoints" },
    });
    const merged = run(armed, [enter!]);
    expect(merged.session.definition.pointIds).not.toContain(pid("a2"));
    expect(merged.session.toolPresentation?.prompts[0]?.text).toBe(
      "Merged a2 into a.",
    );
  });

  test("the user can still pick another destination instead of the suggested one", async () => {
    const session = open();
    const armed = run(
      await editing([]),
      getSketchMergeOfferEvents(point(session, "a2"), point(session, "a")),
    );
    const other = run(armed, [
      { type: "viewport.selectionRequested", target: point(session, "b") },
    ]);
    expect(other.session.activeEditTool?.selectedTargets).toEqual([
      point(session, "a2"),
      point(session, "b"),
    ]);
    expect(other.session.definition).toBe(armed.session.definition);
  });
});

// T17f (T17-9′; T16d review R-1 and A-4, Mirror parity; issue 04 :49).
// Seam: the authored-action owner around the real reducer on an entered
// session (`createSketchActionOwnerFixture`), with the workbench's Enter and
// Escape routes (`getEnterEvent`, `getEscapeEvent`). The confirm popup shows
// exactly when Enter merges (base: a refused later pick hid the popup while
// Enter still merged); Escape first drops the picks with the tool armed and
// no action, then leaves the tool (base: one Escape left with picks staged).
describe("T17f: Merge Points popup ⇔ Enter ⇔ staged; two-stage Escape", () => {
  async function staged() {
    const f = await createSketchActionOwnerFixture(open());
    f.dispatch({ type: "tool.activated", toolId: "sketchMergePoints" });
    for (const name of ["a2", "a"])
      f.dispatch({
        type: "viewport.selectionRequested",
        target: point(f.session, name),
      });
    return f;
  }
  const popup = (session: SketchSessionState) =>
    session.toolPresentation?.floatingInput ?? null;
  const enter = (session: SketchSessionState) =>
    getEnterEvent({ sketchSession: session });
  const escape = (f: Awaited<ReturnType<typeof staged>>) =>
    getEscapeEvent({
      activeCommand: null,
      activeReferencePickerFieldId: null,
      selection: f.state.selection,
      sketchSession: f.session,
      annotationContext: f.state.annotationContext,
    });

  test.each([
    [
      "the centre of a circle",
      (session: SketchSessionState) => point(session, "o"),
      "o is the centre of ring; centres are not merged. Use Concentric or Coincident instead.",
    ],
    [
      "the sketch origin",
      (session: SketchSessionState): PrimitiveRef => ({
        kind: "sketchDatumReference",
        sketchId: session.sketchId as SketchId,
        datumId: "origin",
        geometryKind: "point",
      }),
      "Projected and datum points are not local sketch points; they cannot be merged.",
    ],
  ])(
    "a refused pick (%s) after a staged pair keeps the picks, the popup and Enter; Enter is one Merge Points",
    async (_, refused, message) => {
      const f = await staged();
      const picks = f.session.activeEditTool?.selectedTargets;
      const shown = popup(f.session);
      expect(shown?.readout, "premise: staged").toBe("a2 \u2192 a");
      f.dispatch({
        type: "viewport.selectionRequested",
        target: refused(f.session),
      });
      expect(f.session.activeEditTool?.selectedTargets).toEqual(picks);
      expect(f.session.toolPresentation?.validation?.[0]?.message).toBe(message);
      expect(popup(f.session), "the popup stays").toEqual(shown);
      expect(f.session.toolPresentation?.prompts[0]).toMatchObject({
        text: "Merge a2 into a \u2014 Enter or Merge to confirm",
        tone: "warning",
      });
      expect(f.session.validationMessage, "the tool is the sole refusal owner").toBeNull();
      f.dispatch({ type: "viewport.hovered", target: point(f.session, "b") });
      expect(popup(f.session), "a later hover keeps it").toEqual(shown);
      const event = enter(f.session);
      expect(event).toEqual({
        type: "sketch.toolPatched",
        patch: { intent: "mergePoints" },
      });
      f.dispatch(event!);
      expect(f.undoLabels()).toEqual(["Merge Points"]);
      expect(f.session.definition.pointIds).not.toContain(pid("a2"));
    },
  );

  test("no popup ⇔ Enter is not consumed (one pick; after the merge)", async () => {
    const f = await createSketchActionOwnerFixture(open());
    f.dispatch({ type: "tool.activated", toolId: "sketchMergePoints" });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: point(f.session, "a2"),
    });
    expect(popup(f.session)).toBe(null);
    expect(enter(f.session)).toBe(null);
    f.dispatch({
      type: "viewport.selectionRequested",
      target: point(f.session, "a"),
    });
    f.dispatch(enter(f.session)!);
    expect(popup(f.session)).toBe(null);
    expect(enter(f.session)).toBe(null);
  });

  test("Undo under a staged pair re-judges it: a pair Undo makes invalid loses its popup and Enter; a valid one keeps both", async () => {
    const f = await createSketchActionOwnerFixture(open());
    const line = (id: string): PrimitiveRef => ({
      kind: "sketchEntity",
      sketchId: f.session.sketchId as SketchId,
      entityId: `sketch_entity_${id}` as SketchEntityId,
    });
    // Delete bc, then stage b → c (no longer the ends of one line).
    f.dispatch({ type: "viewport.selectionRequested", target: line("bc") });
    f.dispatch({ type: "sketch.annotationDeleteRequested" });
    expect(f.undoLabels()).toEqual(["Delete Sketch Item"]);
    f.dispatch({ type: "tool.activated", toolId: "sketchMergePoints" });
    for (const name of ["b", "c"])
      f.dispatch({
        type: "viewport.selectionRequested",
        target: point(f.session, name),
      });
    expect(popup(f.session)?.readout, "premise: staged").toBe("b \u2192 c");
    // Undo brings bc back: b and c are its two ends, so the pair is refused.
    f.dispatch({ type: "history.undoRequested" });
    expect(f.session.activeTool).toBe("sketchMergePoints");
    expect(enter(f.session), "Enter is not consumed").toBe(null);
    expect(popup(f.session), "and no popup offers it").toBe(null);
    expect(f.session.toolPresentation?.validation?.[0]?.message).toBe(
      "Both points are ends of bc; merging them would collapse it.",
    );
    // Redo deletes bc again: the pair is valid, staged and confirmable.
    f.dispatch({ type: "history.redoRequested" });
    expect(popup(f.session)?.readout).toBe("b \u2192 c");
    expect(f.session.toolStagedEntities, "the arrow is staged").not.toEqual([]);
    expect(enter(f.session)).toEqual({
      type: "sketch.toolPatched",
      patch: { intent: "mergePoints" },
    });
  });

  test("Escape drops the picks, keeps Merge Points armed and records nothing; a second Escape leaves the tool", async () => {
    const f = await staged();
    const definition = f.session.definition;
    const first = escape(f);
    expect(first).toEqual({
      type: "sketch.toolPatched",
      patch: { intent: "cancelSketchEditOperator" },
    });
    f.dispatch(first!);
    expect(f.session.activeTool).toBe("sketchMergePoints");
    expect(f.session.activeEditTool?.selectedTargets).toEqual([]);
    expect(popup(f.session)).toBe(null);
    expect(enter(f.session)).toBe(null);
    expect(f.session.definition).toBe(definition);
    expect(f.undoLabels()).toEqual([]);
    const second = escape(f);
    expect(second).toEqual({ type: "sketch.activeToolCleared" });
    f.dispatch(second!);
    expect(f.session.activeTool).toBe(null);
    expect(f.session.activeEditTool).toBe(null);
    expect(f.state.command.toolId).toBe("sketch");
    expect(f.undoLabels()).toEqual([]);
  });
});

// T17k2 (T17k F-1): the explanation of a sketch a merge left invalid is the
// sketch's, not the tool's: leaving Merge Points (Escape) keeps it, exactly
// as Undo → Redo of the same merge shows it.
test("T17k2: Escape out of Merge Points after a conflicting merge keeps the invalid-sketch explanation (as Redo does)", async () => {
  const f = await createSketchActionOwnerFixture(gapTriangle().session);
  f.dispatch({ type: "tool.activated", toolId: "sketchMergePoints" });
  for (const name of ["a2", "a"])
    f.dispatch({
      type: "viewport.selectionRequested",
      target: point(f.session, name),
    });
  f.dispatch({ type: "sketch.toolPatched", patch: { intent: "mergePoints" } });
  expect(f.undoLabels()).toEqual(["Merge Points"]);
  const explanation =
    "Gap (0.5 mm) cannot be satisfied. The sketch is invalid; profiles from it are blocked. Change or delete it, or Undo.";
  expect(f.session.validationMessage, "premise").toBe(
    `Merging a2 into a: ${explanation}`,
  );
  const escape = getEscapeEvent({
    activeCommand: null,
    activeReferencePickerFieldId: null,
    selection: f.state.selection,
    sketchSession: f.session,
    annotationContext: f.state.annotationContext,
  });
  expect(escape).toEqual({ type: "sketch.activeToolCleared" });
  f.dispatch(escape!);
  expect(f.session.activeTool, "the tool is left").toBe(null);
  expect(f.session.validationMessage).toBe(explanation);
  f.dispatch({ type: "history.undoRequested" });
  expect(f.session.validationMessage, "Undo: valid again").toBe(null);
  f.dispatch({ type: "history.redoRequested" });
  expect(f.session.validationMessage, "Redo shows the same text").toBe(
    explanation,
  );
});
