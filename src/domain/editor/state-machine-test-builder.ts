import {
  defaultEditorExtensionDependencies,
  initialEditorState,
  transitionEditorState,
  type EditorExtensionDependencies,
  type EditorEffect,
  type EditorEffectRuntime,
  type EditorEvent,
  type EditorTransitionResult,
} from "@/core/editor/state-machine";
import { runEditorEffect } from "@/application/editor/effect-registry";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { querySketchEditIntersections } from "@/contracts/sketch/edit-intersections";
import {
  completeSketchTrimQuery,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";

/**
 * Fake-runtime `deriveSketchRegions` backed by the production solver adapter,
 * the same async boundary the app runtime reaches through modelingService.
 */
export const deriveSketchRegionsForTest: NonNullable<
  EditorEffectRuntime["deriveSketchRegions"]
> = (input) =>
  new SketchConstraintSolverAdapter({
    documentId: input.documentId,
    revisionId: null,
    neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
  }).deriveSketchRegions({
    contractVersion: "modeling-contract/v1alpha1",
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: input.requestId,
    documentId: input.documentId,
    revisionId: input.baseRevisionId,
    sketchId: input.basis.sketchId,
    definition: input.basis.definition,
    solvedSnapshot: input.basis.solvedSnapshot,
    projectedReferences: input.basis.projectedReferences,
    modelingTolerance: input.basis.modelingTolerance,
  });

/**
 * T10g-1: fake-runtime `querySketchEditIntersections` backed by the
 * production solver adapter (in-thread, kernel-free certified capability).
 */
export const querySketchEditIntersectionsForTest: NonNullable<
  EditorEffectRuntime["querySketchEditIntersections"]
> = async (input) =>
  (
    await new SketchConstraintSolverAdapter({
      documentId: input.documentId,
      revisionId: null,
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
    }).querySketchEditIntersections({
      contractVersion: "modeling-contract/v1alpha1",
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: input.requestId,
      documentId: input.documentId,
      revisionId: input.baseRevisionId,
      sketchId: input.sketchId,
      ...input.input,
    })
  ).result;

/**
 * T10g-1 (session seam): answers the Trim tool's in-flight queries with the
 * one contract function, as the editor loop does, until none is in flight.
 */
export async function completeSketchTrimQueriesForTest(
  session: SketchSessionState,
  queries = createCertifiedNeutralCurveQueryCapabilityForTest(),
): Promise<SketchSessionState> {
  let next = session;
  for (;;) {
    const inFlight = next.activeEditTool?.editQuery?.inFlight;
    if (!inFlight) return next;
    next = completeSketchTrimQuery(
      next,
      inFlight.queryId,
      await querySketchEditIntersections(inFlight.input, queries),
    );
  }
}

export function replayEditorEvents(
  events: readonly EditorEvent[],
  dependencies: EditorExtensionDependencies = defaultEditorExtensionDependencies,
): EditorTransitionResult {
  let state = initialEditorState;
  const effects: EditorEffect[] = [];

  for (const event of events) {
    const result = transitionEditorState(state, event, dependencies);
    state = result.state;
    effects.push(...result.effects);
  }

  return { state, effects };
}

export async function replayEditorEventsWithRuntime(
  events: readonly EditorEvent[],
  runtime: EditorEffectRuntime,
  dependencies: EditorExtensionDependencies = defaultEditorExtensionDependencies,
): Promise<EditorTransitionResult> {
  let state = initialEditorState;
  const effects: EditorEffect[] = [];

  for (const event of events) {
    const initial = transitionEditorState(state, event, dependencies);
    state = initial.state;
    effects.push(...initial.effects);

    let queue = [...initial.effects];

    while (queue.length > 0) {
      const effect = queue.shift();

      if (!effect) {
        break;
      }

      const effectEvent = await runEditorEffect(effect, runtime);
      const next = transitionEditorState(state, effectEvent, dependencies);
      state = next.state;
      effects.push(...next.effects);
      queue = [...queue, ...next.effects];
    }
  }

  return { state, effects };
}
