import { describe, expect, test } from "vitest";

import type { PrimitiveRef } from "@/core/editor/schema";
import { REFERENCE_IMAGE_CALIBRATION_MODE_ID } from "@/domain/reference-image-calibration/mode/shared";
import { getEscapeEvent } from "@/domain/editor/workbench-interactions";
import { makeAnnotationLifecycleState } from "@/domain/editor/annotation-lifecycle.fixtures";
import { transitionEditorState } from "./reducer-root";
import { getEditorViewState } from "./selectors";
import type { EditorEvent, EditorState, SketchEditorState } from "./types";

// Logic lane (editor transition seam `transitionEditorState`): the T14c
// annotation selection lifecycle (issue 10 Answer, prototype `selectEntity`,
// `hadFocusedConstraint`, `deleteAnnotation`; T14 plan §2.4, T-3/R-7, T-6/R-9,
// A2/T-14). The active annotation is `selection[0]`; the retained owners and
// the last selected annotation are `annotationContext`.

function apply(state: EditorState, event: EditorEvent) {
  const next = transitionEditorState(state, event).state;
  expect(next.kind, `${event.type} stays in sketch editing`).toBe(
    "editingSketch",
  );
  return next as SketchEditorState;
}

const select = (state: EditorState, target: PrimitiveRef) =>
  apply(state, { type: "viewport.selectionRequested", target });
const blank = (state: EditorState) =>
  apply(state, { type: "selection.cleared" });
const contextOf = (state: SketchEditorState) => state.annotationContext ?? null;

describe("T14c annotation selection lifecycle", () => {
  test("prototype sibling sequence: select G, its constraint A, blank, sibling B is selectable, blank, blank clears", async () => {
    const { state, g, a, b } = await makeAnnotationLifecycleState();

    const geometry = select(state, g);
    expect(geometry.selection).toEqual([g]);
    expect(contextOf(geometry)).toEqual({ owners: [g], last: null });

    const annotation = select(geometry, a);
    expect(annotation.selection, "A is the active selection").toEqual([a]);
    expect(
      contextOf(annotation),
      "A is in G's context: G stays the owner, A is `last`",
    ).toEqual({ owners: [g], last: a });

    const firstBlank = blank(annotation);
    expect(firstBlank.selection).toEqual([]);
    expect(
      contextOf(firstBlank),
      "The first blank clears only the active annotation (the defect: base lost every sibling here)",
    ).toEqual({ owners: [g], last: a });

    const sibling = select(firstBlank, b);
    expect(sibling.selection, "the sibling is selected directly").toEqual([b]);
    expect(contextOf(sibling)).toEqual({ owners: [g], last: b });

    const secondStageFirst = blank(sibling);
    expect(contextOf(secondStageFirst)).toEqual({ owners: [g], last: b });
    const cleared = blank(secondStageFirst);
    expect(cleared.selection).toEqual([]);
    expect(
      contextOf(cleared),
      "The second blank (no active annotation) clears the context",
    ).toBe(null);
  });

  test("R-7: lifecycle clicks keep the sketch session object (nothing keyed on it re-solves)", async () => {
    const { state, g, a, b } = await makeAnnotationLifecycleState();
    const geometry = select(state, g);
    const session = geometry.session;

    let current = geometry;
    for (const step of [
      (s: SketchEditorState) => select(s, a),
      blank,
      (s: SketchEditorState) => select(s, b),
      blank,
      blank,
    ]) {
      current = step(current);
      expect(
        current.session,
        "an annotation selection or a blank is editor state, not session state",
      ).toBe(session);
    }
  });

  test("with geometry selected and no annotation active one blank clears everything", async () => {
    const { state, g } = await makeAnnotationLifecycleState();
    const cleared = blank(select(state, g));
    expect(cleared.selection).toEqual([]);
    expect(contextOf(cleared)).toBe(null);
  });

  test("selecting geometry keeps `last` only when it is in the new owners' context", async () => {
    const { state, g, h, k, c } = await makeAnnotationLifecycleState();
    const parallel = blank(select(select(state, g), c));
    expect(contextOf(parallel)).toEqual({ owners: [g], last: c });

    const otherOwner = select(parallel, h);
    expect(
      contextOf(otherOwner),
      "C (Parallel G, H) is in H's context: kept",
    ).toEqual({ owners: [h], last: c });
    expect(
      contextOf(select(otherOwner, k)),
      "C is not in K's context: dropped",
    ).toEqual({ owners: [k], last: null });
  });

  test("selecting an annotation outside the owners' context (list, problem, history) makes its affected geometry the owners", async () => {
    const { state, g, k, a, d } = await makeAnnotationLifecycleState();
    const fromK = select(select(state, k), a);
    expect(contextOf(fromK)).toEqual({ owners: [g], last: a });
    const fromNothing = select(state, d);
    expect(fromNothing.selection).toEqual([d]);
    expect(contextOf(fromNothing)).toEqual({ owners: [k], last: d });
  });

  test("Escape takes the same two stages: active annotation, then the retained context, then nothing", async () => {
    const { state, g, a } = await makeAnnotationLifecycleState();
    let current = select(select(state, g), a);
    const escape = (s: SketchEditorState) =>
      getEscapeEvent(getEditorViewState(s));

    expect(escape(current)).toEqual({ type: "selection.cleared" });
    current = apply(current, escape(current)!);
    expect(current.selection).toEqual([]);
    expect(contextOf(current)).toEqual({ owners: [g], last: a });

    expect(
      escape(current),
      "a retained context is Escape's second stage",
    ).toEqual({ type: "selection.cleared" });
    current = apply(current, escape(current)!);
    expect(contextOf(current)).toBe(null);

    expect(escape(current), "nothing left: Escape is not consumed").toBe(null);
  });

  test("deleting the active constraint keeps its owners: siblings stay reachable", async () => {
    const { state, g, a, b } = await makeAnnotationLifecycleState();
    const deleted = apply(select(select(state, g), a), {
      type: "sketch.annotationDeleteRequested",
    });
    expect(
      deleted.session.definition.constraintIds,
      "A is deleted through `selection[0]`",
    ).not.toContain(a.constraintId);
    expect(deleted.selection).toEqual([]);
    expect(contextOf(deleted)).toEqual({ owners: [g], last: null });

    const sibling = select(deleted, b);
    expect(contextOf(sibling)).toEqual({ owners: [g], last: b });
  });

  test("deleting the owner prunes it from the context", async () => {
    const { state, g, a } = await makeAnnotationLifecycleState();
    const withLast = select(blank(select(select(state, g), a)), g);
    expect(contextOf(withLast)).toEqual({ owners: [g], last: a });

    const deleted = apply(withLast, {
      type: "sketch.annotationDeleteRequested",
    });
    expect(
      deleted.session.definition.entityIds,
      "premise: G is deleted (with A)",
    ).not.toContain((g as { entityId: string }).entityId);
    expect(contextOf(deleted)).toBe(null);
  });

  test("history strip Select then Delete still deletes the annotation (selection-based)", async () => {
    const { state, k, d } = await makeAnnotationLifecycleState();
    const deleted = apply(select(state, d), {
      type: "sketch.annotationDeleteRequested",
    });
    expect(deleted.session.definition.constraintIds).not.toContain(
      d.constraintId,
    );
    expect(deleted.session.definition.constraintIds).toHaveLength(3);
    expect(contextOf(deleted)).toEqual({ owners: [k], last: null });

    const entityDeleted = apply(select(deleted, k), {
      type: "sketch.annotationDeleteRequested",
    });
    expect(entityDeleted.session.definition.entityIds).not.toContain(
      (k as { entityId: string }).entityId,
    );
  });

  test("tool activation, special-mode entry and Finish drop the context", async () => {
    const { state, g, a, image } = await makeAnnotationLifecycleState();
    const retained = blank(select(select(state, g), a));
    expect(contextOf(retained), "premise").toEqual({ owners: [g], last: a });

    for (const toolId of ["line", "constraintHorizontal", "trim"] as const) {
      expect(
        contextOf(apply(retained, { type: "tool.activated", toolId })),
        `activating ${toolId}`,
      ).toBe(null);
    }

    const special = apply(retained, {
      type: "sketch.specialModeEntered",
      modeId: REFERENCE_IMAGE_CALIBRATION_MODE_ID,
      operationId: (image as { operationId: string }).operationId as never,
    });
    expect(
      special.session.activeSpecialMode?.modeId,
      "premise: the mode is entered",
    ).toBe(REFERENCE_IMAGE_CALIBRATION_MODE_ID);
    expect(contextOf(special)).toBe(null);

    // Review R-1: the canvas entry (double-click on the image) drops it too.
    const doubleClicked = apply(retained, {
      type: "sketch.specialModeDoubleClickRequested",
      point: [1, 1],
      target: image,
    });
    expect(
      doubleClicked.session.activeSpecialMode?.modeId,
      "premise: the double-click entered the mode",
    ).toBe(REFERENCE_IMAGE_CALIBRATION_MODE_ID);
    expect(contextOf(doubleClicked)).toBe(null);

    // Finish through the toolbar tool and through the commit request (A-1).
    for (const event of [
      { type: "tool.activated", toolId: "finishSketch" },
      {
        type: "command.commitRequested",
        commandSessionId: retained.command.commandSessionId,
      },
    ] as const) {
      const finish = transitionEditorState(retained, event);
      expect(
        finish.effects.map((effect) => effect.type),
        `premise: ${event.type} commits`,
      ).toContain("sketch.commit");
      expect(contextOf(finish.state as SketchEditorState), event.type).toBe(
        null,
      );
    }
  });

  test("review R-3: a point selection, a connected-chain selection and a double-click edit set the context", async () => {
    const { state, g, gStart, k, a, b, d } =
      await makeAnnotationLifecycleState();

    expect(
      contextOf(select(blank(select(select(state, g), b)), gStart)),
      "B (Fix on G's start) is in the point's context: kept",
    ).toEqual({ owners: [gStart], last: b });
    expect(
      contextOf(select(blank(select(select(state, g), a)), gStart)),
      "A (Horizontal on G) is not in the point's context: dropped",
    ).toEqual({ owners: [gStart], last: null });

    const chain = apply(blank(select(select(state, g), a)), {
      type: "sketch.connectedSelectionRequested",
      target: k,
    });
    expect(chain.selection, "premise: K's chain is selected").toEqual([k]);
    expect(contextOf(chain), "the chain is the owners").toEqual({
      owners: [k],
      last: null,
    });

    const edited = apply(select(state, g), {
      type: "sketch.annotationEditRequested",
      target: d,
    });
    expect(edited.selection).toEqual([d]);
    expect(contextOf(edited)).toEqual({ owners: [k], last: d });
  });

  test("leaving the sketch and opening it again starts without a context", async () => {
    const { state, g, a } = await makeAnnotationLifecycleState();
    const retained = blank(select(select(state, g), a));
    const left = transitionEditorState(retained, {
      type: "command.cancelled",
      commandSessionId: retained.command.commandSessionId,
    }).state;
    expect(left.kind).toBe("idle");

    const command = transitionEditorState(left, {
      type: "tool.activated",
      toolId: "sketch",
    }).state;
    expect(command.kind).toBe("selectionCommand");
    const reopened = transitionEditorState(
      { ...command, pendingRequestId: "request_reopen" } as EditorState,
      {
        type: "effect.sketchSessionOpened",
        requestId: "request_reopen",
        documentId: state.document.documentId!,
        revisionId: state.document.revisionId!,
        commandSessionId: (command as SketchEditorState).command
          .commandSessionId,
        session: retained.session,
      },
    ).state;
    expect(reopened.kind, "premise: reopened").toBe("editingSketch");
    expect(contextOf(reopened as SketchEditorState)).toBe(null);
  });

  test("R-9: a consumed first-stage blank on a region keeps the context; the second-stage region click selects it and drops the context", async () => {
    const { state, g, a } = await makeAnnotationLifecycleState();
    const region: PrimitiveRef = {
      kind: "region",
      sketchId: "sketch_draft",
      regionId: "region_1",
    } as PrimitiveRef;
    const active = select(select(state, g), a);
    // The viewport consumes the first-stage region click as a blank
    // (`getViewportCanvasClickIntent`, workbench-interactions.spec.ts).
    const consumed = blank(active);
    expect(contextOf(consumed)).toEqual({ owners: [g], last: a });

    const selected = select(consumed, region);
    expect(selected.selection, "the region is selected").toEqual([region]);
    expect(
      contextOf(selected),
      "the previous owners and `last` are gone in the same click",
    ).toEqual({ owners: [region], last: null });
  });

  test("A2/T-14: a duplicate refusal selects the existing constraint with the tool armed; A-10: the next pick starts a fresh pick set", async () => {
    const { state, g, h, k, c } = await makeAnnotationLifecycleState();
    const armed = apply(state, {
      type: "tool.activated",
      toolId: "constraintParallel",
    });
    const refused = select(select(armed, g), h);

    expect(refused.session.activeTool, "the tool stays armed").toBe(
      "constraintParallel",
    );
    expect(refused.session.toolPresentation?.validation?.[0]?.message).toBe(
      "Already constrained: Parallel",
    );
    expect(
      refused.session.definition.constraintIds,
      "nothing authored",
    ).toHaveLength(4);
    expect(refused.selection, "the existing Parallel is selected").toEqual([c]);
    expect(contextOf(refused)).toEqual({ owners: [g, h], last: c });

    const fresh = select(refused, k);
    expect(
      fresh.session.constraintAuthoring?.selectedTargets.map(
        (entry) => entry.target,
      ),
      "the next pick is the first of a fresh pick set",
    ).toEqual([k]);
    expect(fresh.selection).toEqual([k]);
    expect(contextOf(fresh)).toBe(null);

    // Review A-2: Escape after a refusal exits the tool and drops the
    // context (the refusal's context is the only one set with a tool armed).
    const escape = getEscapeEvent(getEditorViewState(refused));
    expect(escape).toEqual({ type: "sketch.activeToolCleared" });
    const escaped = apply(refused, escape!);
    expect(escaped.session.activeTool).toBe(null);
    expect(escaped.selection).toEqual([]);
    expect(contextOf(escaped)).toBe(null);

    const committed = select(fresh, g);
    expect(
      committed.session.definition.constraints.filter(
        (constraint) => constraint.kind === "parallel",
      ),
      "the fresh pair commits a new Parallel",
    ).toHaveLength(2);
  });
});
