import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";

import {
  primitiveRefEquals,
  type PrimitiveRef,
  type SelectionFilter,
} from "@/core/editor/schema";
import {
  getSketchConstraintDefinition,
  resolveSketchConstraintTarget,
} from "@/core/sketch-constraints/registry";
import { isRegisteredSketchToolId } from "@/core/sketch-tools/registry";
import { collectActiveReferenceImageOperations } from "@/domain/reference-image/operations";
import {
  canSketchConstraintSelectMoreTargets,
  isSketchConstraintReadyForValue,
} from "./constraints";
import { getActiveSketchStyleToolId } from "./styles";
import type { SketchSessionState } from "./types";

export function getSelectedSketchGeometryIds(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
) {
  const sketchId = session.sketchId ?? ("sketch_draft" as const);
  const selectedPointIds = new Set<SketchPointId>();
  const selectedEntityIds = new Set<SketchEntityId>();

  for (const target of targets) {
    if (target.kind === "sketchPoint" && target.sketchId === sketchId) {
      selectedPointIds.add(target.pointId);
    }

    if (target.kind === "sketchEntity" && target.sketchId === sketchId) {
      selectedEntityIds.add(target.entityId);
    }
  }

  const existingPointIds = new Set(session.definition.pointIds);
  const existingEntityIds = new Set(session.definition.entityIds);
  const pointIds = new Set(
    [...selectedPointIds].filter((pointId) => existingPointIds.has(pointId)),
  );
  const entityIds = new Set(
    [...selectedEntityIds].filter((entityId) =>
      existingEntityIds.has(entityId),
    ),
  );

  if (pointIds.size === 0 && entityIds.size === 0) {
    return null;
  }

  return { pointIds, entityIds };
}

/**
 * How a repeated single click on the same pick stack (T11d, T11-D4/D5)
 * changes the selection in a selection context (review R-2):
 * - `replace`: the cycle-picked target replaces the previous one.
 * - `replaceLastAdded`: the context accumulates or toggles targets; a cycle
 *   click replaces the last-added target (one event, never a second
 *   toggle/append), and only when that target is the previous click's pick.
 * - `none`: the first click already acts (or places a point); no cycle.
 */
export type SketchSelectionCycleMode = "replace" | "replaceLastAdded" | "none";

export interface SketchSelectionCycleContext {
  readonly mode: SketchSelectionCycleMode;
  /** Identifies the context; a cycle never spans two contexts. */
  readonly key: string;
}

/** Edit tools whose click acts at once (Trim) or on its completing pick. */
const IMMEDIATE_ACTION_EDIT_TOOLS = new Set([
  "trim",
  "sketchExtend",
  "sketchSplit",
  "sketchMirror",
]);

/**
 * The per-context cycle table (T11d, review R-2); the one place it lives.
 * Checked in the order the editing-sketch selection transition dispatches:
 *
 * | Context | Mode |
 * |---|---|
 * | special mode, drawing tool (clicks place points) | `none` |
 * | style focus tool | `replace` |
 * | construction toggle picking | `replaceLastAdded` (it records no list and exits after its one toggle, so it never cycles) |
 * | reference picker | `replace` |
 * | Trim, Extend, Split, Sketch Mirror | `none` |
 * | other edit tools (Offset targets, Fillet, Chamfer, Slot, patterns, Transform) | `replaceLastAdded` |
 * | constraint authoring that auto-commits, or whose next click pins the preview | `none` |
 * | other constraint authoring | `replaceLastAdded` |
 * | no tool, single-slot filter | `replace` |
 * | no tool, multi-slot filter | `replaceLastAdded` |
 *
 * Multi-slot rows: the transition's selection-filter gate runs on the
 * selection with the previous pick already removed (review A-6).
 */
export function getSketchSelectionCycleContext(
  session: SketchSessionState,
  selectionFilter: SelectionFilter | null,
): SketchSelectionCycleContext {
  const context = (mode: SketchSelectionCycleMode, name: string) => ({
    mode,
    key: `${name}:${session.activeTool ?? "none"}`,
  });
  if (session.activeSpecialMode) return context("none", "specialMode");
  const styleToolId = getActiveSketchStyleToolId(session);
  if (styleToolId) return context("replace", `style:${styleToolId}`);
  if (session.constructionTargetPicking)
    return context("replaceLastAdded", "construction");
  if (session.referenceTargetPicking) return context("replace", "reference");
  const editTool = session.activeEditTool;
  if (editTool)
    return context(
      IMMEDIATE_ACTION_EDIT_TOOLS.has(editTool.toolId)
        ? "none"
        : "replaceLastAdded",
      `edit:${editTool.toolId}`,
    );
  const authoring = session.constraintAuthoring;
  if (authoring) {
    const definition = getSketchConstraintDefinition(authoring.toolId);
    // A ready valued constraint that takes no more targets pins its
    // preview on the next click (`shouldPinSketchConstraintPreview…`).
    const clickPins =
      authoring.isPreviewPinned ||
      (isSketchConstraintReadyForValue(definition, authoring.selectedTargets) &&
        !canSketchConstraintSelectMoreTargets(
          definition,
          authoring.selectedTargets,
        ));
    return context(
      !definition.valueSpec || clickPins ? "none" : "replaceLastAdded",
      `constraint:${authoring.toolId}`,
    );
  }
  if (session.activeTool && isRegisteredSketchToolId(session.activeTool))
    return context("none", "drawing");
  return context(
    selectionFilter?.requirements.some(
      (requirement) => requirement.slots.length > 1,
    )
      ? "replaceLastAdded"
      : "replace",
    "select",
  );
}

/**
 * Single-shot pickers (construction toggle, reference picker): their first
 * successful pick acts and exits the picker, so a repeated click does not
 * cycle there in practice and the hint must not teach it (review A-1).
 */
export function isSketchSelectionContextSingleShot(
  session: SketchSessionState,
): boolean {
  return session.constructionTargetPicking || session.referenceTargetPicking;
}

/**
 * Whether the active tool can take `target` at all: Offset takes sketch
 * entities and projected geometry, the other edit tools sketch entities,
 * the construction toggle this sketch's entities and points, and constraint
 * authoring what the constraint resolves; anything else takes everything.
 * A `replaceLastAdded` cycle walks only these, so it never lands on a target
 * the tool ignores (and a following click then toggles the previous pick);
 * the hint counts only these in every context (review R-2).
 */
export function isSketchSelectionCycleTargetEligible(
  session: SketchSessionState,
  target: PrimitiveRef,
): boolean {
  const sketchId = session.sketchId ?? ("sketch_draft" as const);
  if (session.constructionTargetPicking)
    return (
      (target.kind === "sketchEntity" || target.kind === "sketchPoint") &&
      target.sketchId === sketchId
    );
  const editTool = session.activeEditTool;
  if (editTool)
    return (
      target.kind === "sketchEntity" ||
      (editTool.toolId === "offset" &&
        target.kind === "projectedReferenceGeometry")
    );
  const authoring = session.constraintAuthoring;
  if (authoring)
    return Boolean(
      resolveSketchConstraintTarget(
        authoring.toolId,
        session.definition,
        target,
        session.projectedReferences,
      ),
    );
  return true;
}

interface SketchSelectionCycleState {
  readonly session: SketchSessionState;
  readonly selection: readonly PrimitiveRef[];
  readonly selectionFilter: SelectionFilter | null;
}

/**
 * Whether the selection still holds `target`, a previous cycle pick, the
 * way the context's mode needs it: in the selection (`replace`), or as the
 * last-added target (`replaceLastAdded`; for constraint authoring compared
 * after the tool's own target resolution). `mode` defaults to the current
 * context's; a transition checks its result with the mode it started in.
 */
export function isSketchSelectionCyclePickRetained(
  state: SketchSelectionCycleState,
  target: PrimitiveRef,
  mode: SketchSelectionCycleMode = getSketchSelectionCycleContext(
    state.session,
    state.selectionFilter,
  ).mode,
): boolean {
  const { session, selection } = state;
  if (mode === "none") return false;
  if (mode === "replace")
    return selection.some((selected) => primitiveRefEquals(selected, target));
  if (session.constructionTargetPicking) return false;
  if (session.activeEditTool) {
    const last = session.activeEditTool.selectedTargets.at(-1);
    return last !== undefined && primitiveRefEquals(last, target);
  }
  const authoring = session.constraintAuthoring;
  if (authoring) {
    const last = authoring.selectedTargets.at(-1)?.target;
    const resolved = resolveSketchConstraintTarget(
      authoring.toolId,
      session.definition,
      target,
      session.projectedReferences,
    )?.target;
    return (
      last !== undefined &&
      resolved !== undefined &&
      primitiveRefEquals(last, resolved)
    );
  }
  const last = selection.at(-1);
  return last !== undefined && primitiveRefEquals(last, target);
}

/**
 * The state a `replaceLastAdded` cycle click starts from: the previous
 * pick (`replaces`) removed as the last-added target, so that selecting
 * the next stack entry adds it once instead of toggling or appending a
 * second target. `null` when the context does not hold `replaces` as its
 * last-added target (the click must not cycle). `replace` contexts are
 * returned unchanged: selecting replaces there already.
 */
export function withoutSketchSelectionCyclePick<
  TState extends SketchSelectionCycleState,
>(state: TState, replaces: PrimitiveRef): TState | null {
  if (!isSketchSelectionCyclePickRetained(state, replaces)) return null;
  const { session } = state;
  const { mode } = getSketchSelectionCycleContext(
    session,
    state.selectionFilter,
  );
  if (mode === "replace") return state;
  if (session.activeEditTool) {
    const selectedTargets = session.activeEditTool.selectedTargets.slice(0, -1);
    return {
      ...state,
      session: {
        ...session,
        activeEditTool: {
          ...session.activeEditTool,
          selectedTarget: selectedTargets[0] ?? null,
          selectedTargets,
        },
      },
    };
  }
  if (session.constraintAuthoring) {
    return {
      ...state,
      session: {
        ...session,
        constraintAuthoring: {
          ...session.constraintAuthoring,
          selectedTargets: session.constraintAuthoring.selectedTargets.slice(
            0,
            -1,
          ),
        },
      },
    };
  }
  return { ...state, selection: state.selection.slice(0, -1) };
}

export function getSelectedReferenceImageOperationIds(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
) {
  const sketchId = session.sketchId ?? ("sketch_draft" as const);
  const activeOperationIds = new Set(
    collectActiveReferenceImageOperations(session.definition).map(
      ({ operation }) => operation.operationId,
    ),
  );

  return targets.flatMap((target) =>
    target.kind === "sketchOperation" &&
    target.sketchId === sketchId &&
    activeOperationIds.has(target.operationId)
      ? [target.operationId]
      : [],
  );
}
