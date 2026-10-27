import type {
  SketchEditToolState,
  SketchSessionState,
  SketchEditQueryState,
  SketchEditQueryClick,
} from "./types";
import {
  EXTEND_TARGET_UNSUPPORTED_MESSAGE,
  SPLIT_ENTITY_KINDS,
  SPLIT_TARGET_UNSUPPORTED_MESSAGE,
  sketchTrimPreviewPoints,
} from "@/contracts/sketch/edit-intersections";
import type {
  SketchEditOperation,
  SketchEditIntersectionInput,
  SketchEditIntersectionResult,
} from "@/contracts/sketch/edit-intersections";
import { getSketchEditToolDefinition } from "@/core/sketch-edit-tools/registry";
import { buildSketchEditToolPresentation } from "./edit-tool-activation";
import type { SketchPoint } from "@/contracts/modeling/schema";
import { offsetEditInputGate } from "./offset-editing";
import {
  trimTargetRefusal,
  mirrorEditRefusal,
  createSketchTrimMutation,
  createSketchExtendMutation,
  createSketchSplitMutation,
} from "@/core/sketch-editing/operations";
import type {
  SketchMutationResult,
  SketchEditOperationResult,
} from "@/core/sketch-editing/operations";
import {
  hasAcceptedLiveSolveOfDefinition,
  withLiveSolveBasis,
} from "./session-live-solve";
import type { SketchEntityId, SketchId } from "@/contracts/shared/ids";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import {
  createSessionCommitFactories,
  rebuildSessionCommitRequest,
} from "./tool-authoring";
import type { SketchDraftEntity } from "@/core/sketch-tools/definition";
import { withSketchToolValidation } from "./session-definition";
import { getEntityPointIds } from "@/core/sketch-editing/definition-references";
import { getSelectedSketchEntityIds } from "./edit-geometry-operations";
import { applySketchContribution } from "./definition-authoring";

const SKETCH_EDIT_QUERY_CHECKING_MESSAGE = "Checking intersections…";

export const TRIM_STALE_MESSAGE = editQueryStaleMessage("trim");

export const TRIM_BASIS_NOT_ACCEPTED_MESSAGE =
  editQueryBasisNotAcceptedMessage("trim");

/** The tools whose edits wait for exact edit intersections (T10g-1, T10g-2). */
type SketchEditQueryToolId = "trim" | "sketchExtend" | "sketchSplit";

export function isSketchEditQueryTool(
  toolId: SketchEditToolState["toolId"],
): toolId is SketchEditQueryToolId {
  return (
    toolId === "trim" || toolId === "sketchExtend" || toolId === "sketchSplit"
  );
}

const EDIT_QUERY_KINDS = {
  trim: "trim",
  sketchExtend: "extend",
  sketchSplit: "split",
} as const;

/** "<Tool> was not applied: the sketch changed …" (design §2.9 `edit-stale`). */
export function editQueryStaleMessage(
  kind: SketchEditOperation["kind"],
): string {
  return `${editQueryToolName(kind)} was not applied: the sketch changed while its intersections were being checked. Click again.`;
}

/** "<Tool> needs a solved sketch; …" (design §2.9 `edit-basis-not-accepted`). */
function editQueryBasisNotAcceptedMessage(
  kind: SketchEditOperation["kind"],
): string {
  return `${editQueryToolName(kind)} needs a solved sketch; fix the problem shown above first, or Undo.`;
}

function editQueryToolName(kind: SketchEditOperation["kind"]) {
  return kind === "trim" ? "Trim" : kind === "extend" ? "Extend" : "Split";
}

/** The C3 `use` of an edit-query input (Extend/Split keep T10i's wording). */
function editQueryInputUse(toolId: SketchEditQueryToolId, click: boolean) {
  return toolId === "trim"
    ? click
      ? "a Trim target"
      : "a Trim input"
    : `a ${getSketchEditToolDefinition(toolId).metadata.name} input`;
}

/** The edit-query tool with `editQuery`; `message` is shown (else "Checking…" while clicks wait). */
function withEditQuery(
  session: SketchSessionState,
  editQuery: SketchEditQueryState,
  message: string | null,
): SketchSessionState {
  const tool = { ...session.activeEditTool!, editQuery };
  return {
    ...session,
    activeEditTool: tool,
    toolPresentation: buildSketchEditToolPresentation(
      tool,
      message ??
        (editQuery.queue.length > 0
          ? SKETCH_EDIT_QUERY_CHECKING_MESSAGE
          : null),
    ),
  };
}

/**
 * Split and Trim record the last sketch pointer (the preview scheduler
 * flushes a pending move before any other event, so at a selection it is
 * the click position); none while the pointer is off the sketch.
 */
export function updateSketchSplitPointer(
  session: SketchSessionState,
  point: SketchPoint | null,
): SketchSessionState {
  const tool = session.activeEditTool;
  if (tool?.toolId !== "sketchSplit" && tool?.toolId !== "trim") return session;
  if (!point) {
    if (!tool.pointer) return session;
    const withoutPointer = { ...tool };
    delete withoutPointer.pointer;
    return stageSketchTrimHover({ ...session, activeEditTool: withoutPointer });
  }
  return stageSketchTrimHover({ ...session, activeEditTool: { ...tool, pointer: point } });
}

/** O14: reuse the exact edit-query effect and the edit tools' staged entities.
 * Replacing a hover query cancels its identity; a late worker reply cannot
 * publish a piece under an old pointer, and clicks always supersede hovers.
 */
export function stageSketchTrimHover(session: SketchSessionState): SketchSessionState {
  const tool = session.activeEditTool;
  if (tool?.toolId !== "trim" || tool.editQuery?.queue.some(click => !click.preview)) return session;
  const cleared = { ...session, toolStagedEntities: [], activeEditTool: {
    ...tool, editQuery: { queue: [], inFlight: null },
  }, toolPresentation: buildSketchEditToolPresentation(tool, (session.toolPresentation?.validation?.[0]?.message ?? null)) };
  if (!tool.pointer || tool.hoverTarget?.kind !== "sketchEntity") return cleared;
  const click = editQueryClick(cleared, tool.hoverTarget.entityId, null);
  if (!click || editQueryClickRefusal(cleared, "trim", click)) return cleared;
  return queueSketchEditQueryClick(cleared, cleared.activeEditTool, { ...click, preview: true });
}

/** The click's entity ids: the target, then the Extend/Split boundary. */
function clickEntityIds(click: SketchEditQueryClick) {
  return click.boundary
    ? [click.targetEntityId, click.boundary.entityId]
    : [click.targetEntityId];
}

/**
 * Why a click cannot be queried now, decided before any query runs: the
 * target kind (Trim: `trimTargetRefusal`; Extend/Split: a line and a line,
 * Q-g3), the accepted live solve of the current definition, and a decided
 * C3 refusal of an input (a pending one defers instead, review R-1).
 */
function editQueryClickRefusal(
  session: SketchSessionState,
  toolId: SketchEditQueryToolId,
  click: SketchEditQueryClick,
) {
  const kind = EDIT_QUERY_KINDS[toolId];
  const gate = offsetEditInputGate(
    session,
    clickEntityIds(click),
    editQueryInputUse(toolId, true),
  );
  const kindRefusal =
    toolId === "trim"
      ? trimTargetRefusal(click.entity)
      : toolId === "sketchExtend"
        ? click.entity.kind === "lineSegment" &&
          click.boundary?.entity.kind === "lineSegment"
          ? null
          : EXTEND_TARGET_UNSUPPORTED_MESSAGE
        : SPLIT_ENTITY_KINDS.has(click.entity.kind) &&
            SPLIT_ENTITY_KINDS.has(click.boundary?.entity.kind ?? "")
          ? null
          : SPLIT_TARGET_UNSUPPORTED_MESSAGE;
  return (
    kindRefusal ??
    // T15d ([TECH] T-11): a mirror seed or output target, before any query.
    mirrorEditRefusal(
      session.definition,
      [{ kind: "entity", entityId: click.targetEntityId }],
      kind,
    ) ??
    (hasAcceptedLiveSolveOfDefinition(session)
      ? null
      : editQueryBasisNotAcceptedMessage(kind)) ??
    (gate && !gate.pending ? gate.message : null)
  );
}

/** The click on `targetEntityId` (and an Extend/Split `boundaryEntityId`), or null if gone. */
export function editQueryClick(
  session: SketchSessionState,
  targetEntityId: SketchEntityId,
  boundaryEntityId: SketchEntityId | null,
): SketchEditQueryClick | null {
  const find = (entityId: SketchEntityId) =>
    session.definition.entities.find(
      (candidate) => candidate.entityId === entityId,
    );
  const entity = find(targetEntityId);
  const boundary = boundaryEntityId ? find(boundaryEntityId) : null;
  if (!entity || (boundaryEntityId && !boundary)) return null;
  return {
    targetEntityId,
    entity,
    ...(session.activeEditTool?.toolId === "trim" && session.activeEditTool.pointer
      ? { pick: session.activeEditTool.pointer } : {}),
    ...(boundary
      ? { boundary: { entityId: boundaryEntityId!, entity: boundary } }
      : {}),
  };
}

/**
 * T10g-1 (design §2.7): a Trim click, or (T10g-2) a completed Extend/Split
 * selection. Target kind and the accepted live solve of the current
 * definition are checked now (every sketch entry establishes a live solve,
 * T11a); C3 refuses a decided non-accepted input
 * and defers a pending one (review R-1). The click is queued with its
 * entities' identities (R-5); nothing is authored until its exact
 * intersections arrive.
 */
export function queueSketchEditQueryClick(
  session: SketchSessionState,
  tool: SketchEditToolState,
  click: SketchEditQueryClick,
): SketchSessionState {
  const editQuery = tool.editQuery ?? { queue: [], inFlight: null };
  const refusal = editQueryClickRefusal(
    session,
    tool.toolId as SketchEditQueryToolId,
    click,
  );
  if (refusal) return withEditQuery(session, editQuery, refusal);
  return advanceSketchEditQueryQueue(
    withEditQuery(
      session,
      { ...editQuery, queue: [...editQuery.queue, click] },
      null,
    ),
  );
}

/**
 * T10g-1: issues the head click's query when nothing is in flight (Trim,
 * and T10g-2 Extend/Split). A head whose target or boundary changed since
 * its click is dropped as stale (R-5). The query runs on the accepted live
 * solve of the current definition only (R-6); with offset relationships it
 * waits while the publication round is pending (R-1: the basis must say
 * which offset outputs are accepted), and so does a click whose C3 gate is
 * still pending. Unchanged when nothing waits.
 */
export function advanceSketchEditQueryQueue(
  session: SketchSessionState,
  initialMessage: string | null = null,
): SketchSessionState {
  const tool = session.activeEditTool;
  const editQuery = tool?.editQuery;
  if (!tool || !isSketchEditQueryTool(tool.toolId) || !editQuery)
    return session;
  if (editQuery.inFlight || (editQuery.queue.length === 0 && !initialMessage))
    return session;
  const kind = EDIT_QUERY_KINDS[tool.toolId];
  let message = initialMessage;
  const queue = [...editQuery.queue];
  for (;;) {
    const head = queue[0];
    if (!head) return withEditQuery(session, { ...editQuery, queue }, message);
    const current = (entityId: SketchEntityId) =>
      session.definition.entities.find(
        (entity) => entity.entityId === entityId,
      );
    const gate = offsetEditInputGate(
      session,
      clickEntityIds(head),
      editQueryInputUse(tool.toolId, true),
    );
    const refusal =
      current(head.targetEntityId) !== head.entity ||
      (head.boundary &&
        current(head.boundary.entityId) !== head.boundary.entity)
        ? editQueryStaleMessage(kind)
        : !hasAcceptedLiveSolveOfDefinition(session)
          ? editQueryBasisNotAcceptedMessage(kind)
          : gate && !gate.pending
            ? gate.message
            : null;
    if (refusal) {
      queue.shift();
      message = refusal;
      continue;
    }
    const offsets = (session.definition.derivedRelationships ?? []).some(
      (relationship) => relationship.kind === "offset",
    );
    if (gate || (offsets && session.liveRegions.status === "pending"))
      return withEditQuery(
        session,
        { ...editQuery, queue },
        message ?? gate?.message ?? null,
      );
    const operation: SketchEditOperation = head.boundary
      ? {
          kind: kind as "extend" | "split",
          targetEntityId: head.targetEntityId,
          boundaryEntityId: head.boundary.entityId,
          // T13m: Split cuts at the crossing nearest its boundary click.
          ...(head.pick ? { pick: [head.pick[0], head.pick[1]] } : {}),
        }
      : { kind: "trim", targetEntityId: head.targetEntityId,
          ...(head.pick ? { pick: [head.pick[0], head.pick[1]] } : {}) };
    return withEditQuery(
      session,
      {
        queue,
        inFlight: {
          // Review R-1: unique across tool activations (a new tool after
          // Esc starts a fresh queue), so a result of a cancelled query
          // never matches a later click's query.
          queryId: `${kind}-query-${crypto.randomUUID()}`,
          definition: session.definition,
          generation: session.liveRegions.generation,
          input: sketchEditIntersectionInput(session, operation),
        },
      },
      message,
    );
  }
}

/** Shared accepted-basis preparation; clients supply explicit entities, not clicks. */
export function prepareSketchIntersectionEdit(
  session: SketchSessionState,
  operation: SketchEditOperation,
): { input: SketchEditIntersectionInput; definition: SketchDefinition; generation: number } | { message: string } {
  const toolId = operation.kind === "trim" ? "trim" : operation.kind === "extend" ? "sketchExtend" : "sketchSplit";
  const target = editQueryClick(session, operation.targetEntityId, operation.kind === "trim" ? null : operation.boundaryEntityId);
  if (!target) return { message: "Sketch edit target or boundary is unavailable." };
  const refusal = editQueryClickRefusal(session, toolId, target);
  if (refusal) return { message: refusal };
  const gate = offsetEditInputGate(session, clickEntityIds(target), editQueryInputUse(toolId, true));
  const offsets = (session.definition.derivedRelationships ?? []).some(r => r.kind === "offset");
  if (gate || (offsets && session.liveRegions.status === "pending"))
    return { message: gate?.message ?? "Sketch edit needs current derived geometry." };
  if ((operation.kind === "split" || operation.kind === "trim") && operation.pick && !operation.pick.every(Number.isFinite))
    return { message: `${editQueryToolName(operation.kind)} crossing selection must be finite.` };
  return { input: sketchEditIntersectionInput(session, operation), definition: session.definition, generation: session.liveRegions.generation };
}

function sketchEditIntersectionInput(session: SketchSessionState, operation: SketchEditOperation): SketchEditIntersectionInput {
  const liveSolve = session.liveSolve!;
  return { definition: liveSolve.definition, solvedSnapshot: liveSolve.solvedSnapshot,
    projectedReferences: liveSolve.projectedReferences, modelingTolerance: session.modelingTolerance, operation };
}

/** The builder of the operation on the snapshot its intersections were certified on. */
function buildEditQueryMutation(
  session: SketchSessionState,
  input: SketchEditIntersectionInput,
  result: Extract<SketchEditIntersectionResult, { kind: "verified" }>,
  sequence: number,
): SketchMutationResult {
  const { operation } = input;
  const factories = createSessionCommitFactories(
    sequence,
    session.sketchId ?? ("sketch_draft" as SketchId),
  );
  const common = {
    definition: session.definition,
    targetEntityId: operation.targetEntityId,
    intersections: result,
    factories,
  };
  switch (operation.kind) {
    case "trim":
      return createSketchTrimMutation({
        ...common,
        solvedSnapshot: input.solvedSnapshot,
      });
    case "extend":
      return createSketchExtendMutation({ ...common, sequence });
    case "split":
      return createSketchSplitMutation({
        ...common,
        sequence,
        solvedSnapshot: input.solvedSnapshot,
      });
  }
}

/**
 * T10g-1 (design §2.7/§2.8), for Trim and (T10g-2) Extend/Split: the exact
 * intersections of the in-flight query `queryId` (ignored unless it is
 * still the one in flight).
 * - The definition changed meanwhile (an edit, Undo/Redo): discarded with
 *   the stale message.
 * - Only the live solve changed (a re-solve, a publication: a new
 *   generation or snapshot, review A-4): queried again for the head.
 * - Otherwise a failure shows its message, and a verified result applies as
 *   one authored edit, after C3 over target, cut cutters (Extend/Split: the
 *   boundary) and the non-accepted outputs near a Trim target (T-g5); the
 *   next click follows.
 */
export function completeSketchEditQuery(
  session: SketchSessionState,
  queryId: string,
  result: SketchEditIntersectionResult,
): SketchSessionState {
  const tool = session.activeEditTool;
  const editQuery = tool?.editQuery;
  const inFlight = editQuery?.inFlight;
  if (
    !tool ||
    !isSketchEditQueryTool(tool.toolId) ||
    inFlight?.queryId !== queryId
  )
    return session;
  const { operation } = inFlight.input;
  const cleared = { ...editQuery!, inFlight: null };
  const popped = { ...cleared, queue: cleared.queue.slice(1) };
  if (session.definition !== inFlight.definition)
    return advanceSketchEditQueryQueue(
      withEditQuery(session, popped, null),
      editQueryStaleMessage(operation.kind),
    );
  if (
    session.liveRegions.generation !== inFlight.generation ||
    session.liveSolve?.solvedSnapshot !== inFlight.input.solvedSnapshot
  )
    return advanceSketchEditQueryQueue(withEditQuery(session, cleared, null));
  if (editQuery!.queue[0]?.preview) {
    const gate = offsetEditInputGate(session, [operation.targetEntityId,
      ...result.nonAcceptedNearTarget,
      ...(result.kind === "verified" ? result.cuts.flatMap(cut => cut.cutters.map(cutter => cutter.entityId)) : []),
    ], "a Trim input");
    const points = !gate && result.kind === "verified" ? sketchTrimPreviewPoints(inFlight.input, result) : [];
    const entity = editQuery!.queue[0]!.entity;
    const preview: SketchDraftEntity[] = points.length > 1 ? [{
      id: `preview-trim-${entity.entityId}`, kind: "spline", points,
      entityId: null, status: "preview", label: "Trim removes this piece",
      isConstruction: entity.isConstruction,
    }] : [];
    return { ...withEditQuery(session, popped, null), toolStagedEntities: preview,
      toolPresentation: buildSketchEditToolPresentation(tool, null, preview) };
  }
  const completed = completeSketchIntersectionEdit(session, inFlight, result);
  if (completed.pending)
    return advanceSketchEditQueryQueue(withEditQuery(session, cleared, null));
  return advanceSketchEditQueryQueue(
    withEditQuery(completed.session, popped, null),
    completed.session.toolPresentation?.validation?.[0]?.message ?? null,
  );
}

/** Shared exact-result gate and authored mutation for browser and explicit edits. */
export function completeSketchIntersectionEdit(
  session: SketchSessionState,
  basis: { definition: SketchDefinition; generation: number; input: SketchEditIntersectionInput },
  result: SketchEditIntersectionResult,
): { session: SketchSessionState; pending: boolean } {
  const { operation } = basis.input;
  // Explicit clients have no active tool; interactive refusals belong to its prompt.
  const refuse = (message: string | null, pending = false) => ({
    session: session.activeEditTool
      ? withSketchToolValidation(session, message)
      : { ...session, validationMessage: message },
    pending,
  });
  if (session.definition !== basis.definition || session.liveRegions.generation !== basis.generation || session.liveSolve?.solvedSnapshot !== basis.input.solvedSnapshot)
    return refuse(editQueryStaleMessage(operation.kind));
  const gate = offsetEditInputGate(session, [operation.targetEntityId,
    ...(operation.kind === "trim" ? [] : [operation.boundaryEntityId]),
    ...(result.kind === "verified" ? result.cuts.flatMap(cut => cut.cutters.map(cutter => cutter.entityId)) : []),
    ...result.nonAcceptedNearTarget], `a ${editQueryToolName(operation.kind)} input`);
  if (gate) return refuse(gate.message, gate.pending);
  if (result.kind === "failed") return refuse(result.message);
  const nextSequence = session.sequence + 1;
  const mutation = buildEditQueryMutation(session, basis.input, result, nextSequence);
  if (!mutation.changed) return refuse(mutation.message);
  const next = withLiveSolveBasis({ ...session,
    definition: mutation.definition, toolStagedEntities: [], sequence: nextSequence,
    commitRequest: rebuildSessionCommitRequest(session, mutation.definition), activeEditTarget: null, activeDrag: null,
  }, mutation.definition);
  const message = freedFitPointsMessage(session.definition, mutation.definition, operation.targetEntityId);
  return {
    pending: false,
    session: session.activeEditTool
      ? withSketchToolValidation(next, message)
      : { ...next, validationMessage: message },
  };
}

/**
 * T10g-3b (user decision Q-g2): the fit points of a trimmed spline that no
 * curve uses any more stay as free points with their constraints; the
 * tool message says how many. Null when there are none (every other edit).
 */
function freedFitPointsMessage(
  before: SketchDefinition,
  after: SketchDefinition,
  targetEntityId: SketchEntityId,
) {
  const target = before.entities.find(
    (entity) => entity.entityId === targetEntityId,
  );
  if (target?.kind !== "spline") return null;
  const used = new Set(after.entities.flatMap(getEntityPointIds));
  const freed = new Set(
    getEntityPointIds(target).filter((pointId) => !used.has(pointId)),
  ).size;
  if (freed === 0) return null;
  return freed === 1
    ? `Trim left 1 fit point of ${target.label} as a free point (with its constraints): the removed part used it.`
    : `Trim left ${freed} fit points of ${target.label} as free points (with their constraints): the removed part used them.`;
}

/** T10g-1: the in-flight edit query failed (a real error): nothing is applied. */
export function failSketchEditQuery(
  session: SketchSessionState,
  queryId: string,
  message: string,
): SketchSessionState {
  const tool = session.activeEditTool;
  const editQuery = tool?.editQuery;
  const inFlight = editQuery?.inFlight;
  if (
    !tool ||
    !isSketchEditQueryTool(tool.toolId) ||
    inFlight?.queryId !== queryId
  )
    return session;
  return advanceSketchEditQueryQueue(
    withEditQuery(
      session,
      { ...editQuery!, inFlight: null, queue: editQuery!.queue.slice(1) },
      null,
    ),
    `${editQueryToolName(inFlight.input.operation.kind)} failed: ${message}`,
  );
}

/**
 * C3 over an Extend/Split selection still being made (decided or still
 * being checked), or the refusal of a complete selection; null when none.
 */
export function editSelectionMessage(
  session: SketchSessionState,
  tool: SketchEditToolState,
) {
  const entityIds = getSelectedSketchEntityIds(tool);
  if (entityIds.length === 2) {
    const click = editQueryClick(session, entityIds[0]!, entityIds[1]!);
    return click
      ? editQueryClickRefusal(
          session,
          tool.toolId as SketchEditQueryToolId,
          click,
        )
      : null;
  }
  return (
    offsetEditInputGate(
      session,
      entityIds,
      editQueryInputUse(tool.toolId as SketchEditQueryToolId, true),
    )?.message ?? null
  );
}

/**
 * T10g-2: an Extend/Split selection (target, then boundary). A complete one
 * is queued as one click (`queueSketchEditQueryClick`) and the selection
 * restarts; a refused one keeps the selection and shows why. An incomplete
 * one shows its C3 state.
 */
export function selectSketchEditQueryTargets(
  session: SketchSessionState,
  tool: SketchEditToolState,
): SketchSessionState {
  const entityIds = getSelectedSketchEntityIds(tool);
  // T16a (B7, [TECH] T16-3): a mirror seed or copy is refused at the
  // target pick, which is not kept; the tool stays armed.
  const targetRefusal =
    entityIds.length === 1
      ? mirrorEditRefusal(
          session.definition,
          [{ kind: "entity", entityId: entityIds[0]! }],
          EDIT_QUERY_KINDS[tool.toolId as SketchEditQueryToolId],
        )
      : null;
  if (targetRefusal) {
    const reset = { ...tool, selectedTarget: null, selectedTargets: [] };
    return {
      ...session,
      activeEditTool: reset,
      toolStagedEntities: [],
      toolPresentation: buildSketchEditToolPresentation(reset, targetRefusal),
    };
  }
  const click =
    entityIds.length === 2
      ? editQueryClick(session, entityIds[0]!, entityIds[1]!)
      : null;
  const message = editSelectionMessage(session, tool);
  if (click && !message) {
    const reset = { ...tool, selectedTarget: null, selectedTargets: [] };
    // T13m: the completing click is the boundary's; Split records where.
    const pick = tool.toolId === "sketchSplit" ? tool.pointer : undefined;
    return queueSketchEditQueryClick(
      { ...session, activeEditTool: reset, toolStagedEntities: [] },
      reset,
      pick ? { ...click, pick } : click,
    );
  }
  return {
    ...session,
    activeEditTool: tool,
    toolStagedEntities: [],
    toolPresentation: buildSketchEditToolPresentation(tool, message),
  };
}

export function applySketchEditOperationResult(
  session: SketchSessionState,
  result: SketchEditOperationResult,
) {
  const nextSequence = session.sequence + 1;
  if (result.definition) {
    return {
      definition: result.definition,
      sequence: nextSequence,
      commitRequest: rebuildSessionCommitRequest(session, result.definition),
    };
  }

  if (result.contribution) {
    const history = applySketchContribution(session, result.contribution);
    return {
      definition: history.definition,
      sequence: nextSequence,
      commitRequest: rebuildSessionCommitRequest(session, history.definition),
    };
  }

  return null;
}
