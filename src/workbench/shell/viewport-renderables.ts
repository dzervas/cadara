import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import { nonAcceptedDerivedOutputs } from "@/contracts/sketch/offset-publication";
import type { SketchSessionState } from "@/domain/editor/sketch-session";
import {
  getSketchConstraintDisplayForTarget,
  getSketchConstraintDisplaySummary,
} from "@/domain/editor/sketch-session";
import {
  mergeSketchRenderables,
  type MergedSketchRenderables,
} from "@/domain/editor/sketch-session-controller";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";

export interface ComposeViewportRenderablesInput {
  snapshotRenderables: RenderableEntityRecord[];
  snapshotSketches?: readonly SketchSnapshotRecord[];
  previewRenderables: RenderableEntityRecord[] | null;
  sketchSession: SketchSessionState | null;
  hiddenTargetKeys: Record<string, boolean>;
}

export interface ComposedViewportRenderables extends MergedSketchRenderables {
  documentRenderables: ViewportRenderableRecord[];
}

export function getHiddenTargetKeyForTarget(
  target: PrimitiveRef,
  hiddenTargetKeys: Record<string, boolean>,
) {
  const targetKey = getPrimitiveRefKey(target);

  if (hiddenTargetKeys[targetKey]) {
    return targetKey;
  }

  if (
    target.kind === "face" ||
    target.kind === "edge" ||
    target.kind === "vertex" ||
    target.kind === "loop"
  ) {
    const bodyKey = getPrimitiveRefKey({ kind: "body", bodyId: target.bodyId });
    return hiddenTargetKeys[bodyKey] ? bodyKey : null;
  }

  if (
    target.kind === "sketchEntity" ||
    target.kind === "sketchPoint" ||
    target.kind === "constraint" ||
    target.kind === "dimension" ||
    target.kind === "region"
  ) {
    const sketchKey = getPrimitiveRefKey({
      kind: "sketch",
      sketchId: target.sketchId,
    });
    return hiddenTargetKeys[sketchKey] ? sketchKey : null;
  }

  return null;
}

export function isTargetHidden(
  target: PrimitiveRef,
  hiddenTargetKeys: Record<string, boolean>,
) {
  return getHiddenTargetKeyForTarget(target, hiddenTargetKeys) !== null;
}

export function composeViewportRenderables(
  input: ComposeViewportRenderablesInput,
): ComposedViewportRenderables {
  const snapshotSketches = input.snapshotSketches ?? [];
  const sketchConstraintDisplayById =
    createCommittedSketchConstraintDisplayLookup(snapshotSketches);
  const nonCurrentSketchStates = new Map(
    snapshotSketches.flatMap((sketch) => {
      const { state } = sketch.sketch.derivedValidity;
      return state === "current" ? [] : [[sketch.sketchId, state] as const];
    }),
  );
  const nonAcceptedDerivedOutputsById =
    createCommittedNonAcceptedOffsetOutputLookup(snapshotSketches);
  const layeredRenderables = [
    ...input.snapshotRenderables.map((renderable) => ({
      origin: "document" as const,
      renderable,
      sketchConstraintDisplay: getCommittedSketchConstraintDisplay(
        renderable,
        sketchConstraintDisplayById,
      ),
      ...getCommittedSketchGeometryValidity(
        renderable,
        nonAcceptedDerivedOutputsById,
        nonCurrentSketchStates,
      ),
    })),
    ...(input.previewRenderables ?? []).map((renderable) => ({
      origin: "preview" as const,
      renderable,
    })),
  ].filter(({ renderable }) => {
    const target = renderable.binding.target;
    return (
      !isTargetHidden(target, input.hiddenTargetKeys) &&
      !(target.kind === "region" && nonCurrentSketchStates.has(target.sketchId))
    );
  });

  const mergedRenderables = mergeSketchRenderables(
    layeredRenderables,
    input.sketchSession,
  );

  return {
    ...mergedRenderables,
    documentRenderables: mergedRenderables.documentRenderables,
  };
}

function createCommittedSketchConstraintDisplayLookup(
  sketches: readonly SketchSnapshotRecord[],
) {
  return new Map(
    sketches.map(
      (sketch) =>
        [
          sketch.sketchId,
          getSketchConstraintDisplaySummary({
            sketchId: sketch.sketchId,
            definition: sketch.sketch.definition,
            solvedSnapshot: sketch.sketch.solvedSnapshot,
          }),
        ] as const,
    ),
  );
}

function getCommittedSketchConstraintDisplay(
  renderable: RenderableEntityRecord,
  displayBySketchId: ReturnType<
    typeof createCommittedSketchConstraintDisplayLookup
  >,
) {
  const target = renderable.binding.target;

  if (
    target.kind !== "sketchEntity" &&
    target.kind !== "sketchPoint" &&
    target.kind !== "region"
  ) {
    return undefined;
  }

  const summary = displayBySketchId.get(target.sketchId);
  return summary
    ? getSketchConstraintDisplayForTarget(target, summary)
    : undefined;
}

/** [TECH] G19: the non-accepted offset outputs of each committed sketch. */
function createCommittedNonAcceptedOffsetOutputLookup(
  sketches: readonly SketchSnapshotRecord[],
) {
  return new Map(
    sketches.map(
      (sketch) =>
        [
          sketch.sketchId,
          nonAcceptedDerivedOutputs(
            sketch.sketch.definition,
            sketch.sketch.solvedSnapshot,
          ),
        ] as const,
    ),
  );
}

/**
 * A non-accepted offset output ([TECH] G19) is `invalid`; any other curve or
 * point of a sketch that is not current takes the sketch's state (T17d2:
 * part mode draws its held geometry, marked).
 */
function getCommittedSketchGeometryValidity(
  renderable: RenderableEntityRecord,
  nonAcceptedOutputs: ReturnType<
    typeof createCommittedNonAcceptedOffsetOutputLookup
  >,
  nonCurrentSketchStates: ReadonlyMap<string, "invalid" | "stale">,
): { sketchGeometryValidity?: "invalid" | "stale" } {
  const target = renderable.binding.target;
  if (target.kind !== "sketchEntity" && target.kind !== "sketchPoint")
    return {};
  const validity =
    target.kind === "sketchEntity" &&
    nonAcceptedOutputs.get(target.sketchId)?.has(target.entityId)
      ? "invalid"
      : nonCurrentSketchStates.get(target.sketchId);
  return validity ? { sketchGeometryValidity: validity } : {};
}
