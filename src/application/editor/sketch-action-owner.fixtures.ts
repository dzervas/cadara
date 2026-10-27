import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import {
  emitPendingSketchEditQuery,
  emitPendingSketchOffsetPreviewPublication,
  emitPendingSketchRegionDerivation,
  emitPendingSketchSnapQuery,
  transitionEditorState,
  type EditorEffect,
  type EditorEffectRuntime,
  type EditorEvent,
  type SketchEditorState,
} from "@/core/editor/state-machine";
import {
  enterSketchSession,
  enterSketchSessionState,
} from "@/domain/editor/sketch-entry.fixtures";
import {
  acceptSketchDraw,
  beginSketchTool,
  clearActiveSketchTool,
  createNewSketchSession,
  finalizeSketchDraw,
  startSketchDraw,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/core/editor/sketch-session/test-snap-scale";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { runEditorEffect } from "./effect-registry";
import { SketchAuthoredActions } from "./sketch-authored-actions";

/**
 * T17c3 shared fixture for the authored-action owner seam: `session` is
 * entered through the app's entry (T17-10′ builder) in the seed document,
 * then every event runs through `SketchAuthoredActions` around the real
 * reducer and the event loop's post-transition hooks, and the derivation
 * effects it emits (live regions, the offset
 * preview's publication) run through the real effect registry and solver
 * adapter (certified neutral-curve queries), their events going back
 * through the owner, as the editor event loop does.
 */
export async function createSketchActionOwnerFixture(
  session: SketchSessionState,
) {
  const owner = new SketchAuthoredActions();
  const snapshot = await createSeedDocumentSnapshot();
  const entered = enterSketchSessionState(session, {
    documentId: snapshot.document.documentId,
    revisionId: snapshot.document.revisionId,
  });
  const solver = new SketchConstraintSolverAdapter({
    neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
    documentId: snapshot.document.documentId,
    revisionId: null,
  });
  const notUsed = (name: string) => () => {
    throw new Error(`${name} is not part of the sketch action seam.`);
  };
  const runtime: EditorEffectRuntime = {
    getCurrentDocumentSnapshot: notUsed("getCurrentDocumentSnapshot"),
    commitSketch: notUsed("commitSketch"),
    commitSketchPlane: notUsed("commitSketchPlane"),
    projectSketchReferences: notUsed("projectSketchReferences"),
    evaluatePreview: notUsed("evaluatePreview"),
    commitFeature: notUsed("commitFeature"),
    deriveSketchRegions: (input) =>
      solver.deriveSketchRegions({
        contractVersion: CONTRACT_VERSION,
        solverSchemaVersion: SOLVER_SCHEMA_VERSION,
        requestId: input.requestId,
        documentId: input.documentId,
        revisionId: input.baseRevisionId,
        sketchId: input.basis.sketchId,
        definition: input.basis.definition,
        solvedSnapshot: input.basis.solvedSnapshot,
        projectedReferences: input.basis.projectedReferences,
        modelingTolerance: input.basis.modelingTolerance,
      }),
  };
  // The entry's own derivation request is re-emitted here (the builder
  // keeps the entered state, not its effects).
  const emitted = emitPendingSketchRegionDerivation({
    state: { ...entered, snapshot, pendingRegionRequest: null },
    effects: [],
  });
  let state = emitted.state as SketchEditorState;
  const pending: EditorEffect[] = [...emitted.effects];
  const derivations = new Set<EditorEffect["type"]>([
    "sketch.deriveRegions",
    "sketch.publishOffsetPreview",
  ]);

  function dispatch(event: EditorEvent) {
    const result = emitPendingSketchSnapQuery(
      emitPendingSketchEditQuery(
        emitPendingSketchOffsetPreviewPublication(
          emitPendingSketchRegionDerivation(
            owner.transition(state, event, (current) =>
              transitionEditorState(current, event),
            ),
          ),
        ),
      ),
    );
    if (result.state.kind !== "editingSketch")
      throw new Error("Expected the sketch to stay open.");
    state = result.state;
    pending.push(
      ...result.effects.filter((effect) => derivations.has(effect.type)),
    );
    return state.session;
  }
  /** Runs the emitted derivations (and the ones they cause) to the end. */
  async function settle() {
    for (let effect = pending.shift(); effect; effect = pending.shift())
      dispatch(await runEditorEffect(effect, runtime));
    return state.session;
  }
  await settle();
  return {
    dispatch,
    settle,
    get state() {
      return state;
    },
    get session() {
      return state.session;
    },
    undoLabels: () =>
      state.session.actionHistory?.undo.map((entry) => entry.label) ?? [],
  };
}

type P = readonly [number, number];

/**
 * T17c6: the points of a closed mixed outline as drawn in the browser (the
 * E2E-2 shape): Line L0→L1, 3-Point Arc L1→M0 through M1 (clicks: start,
 * through, end), Spline M0→F2→F3→L0.
 */
export const MIXED_OUTLINE = {
  L0: [1.7, 0.3],
  L1: [5.58, 0.3],
  M0: [5.58, 3.21],
  M1: [6.93, 2.31],
  F2: [4.125, 4.18],
  F3: [2.67, 3.598],
} as const satisfies Record<string, P>;

/**
 * T17c6: an entered session with the mixed outline drawn by the tools
 * (snapped ends: inferred coincidences, a Horizontal on the line), or only
 * its arc and spline (`withLine: false`, an open chain).
 */
export function drawnMixedOutlineSession(
  options: { withLine?: boolean } = {},
): SketchSessionState {
  const { L0, L1, M0, M1, F2, F3 } = MIXED_OUTLINE;
  let session = withSketchSnapScale(
    enterSketchSession(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
  const draw = (
    toolId: Parameters<typeof beginSketchTool>[1],
    points: readonly P[],
  ) => {
    session = startSketchDraw(beginSketchTool(session, toolId), points[0]!);
    for (const point of points.slice(1))
      session = acceptSketchDraw(session, point);
    if (toolId === "spline") session = finalizeSketchDraw(session);
    session = clearActiveSketchTool(session);
  };
  if (options.withLine !== false) draw("line", [L0, L1]);
  draw("threePointArc", [L1, M1, M0]);
  draw("spline", [M0, F2, F3, L0]);
  return session;
}
