import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import { nonAcceptedDerivedOutputs } from "@/contracts/sketch/offset-publication";
import type { SketchSessionState } from "@/core/editor/sketch-session";
import {
  getSketchConstraintDisplayForTarget,
  getSketchConstraintDisplaySummary,
} from "@/core/editor/sketch-session";

import { mergeSketchRenderables, type MergedSketchRenderables } from "@/infrastructure/editor/sketch-session-renderables";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";
import type { BodyId } from "@/contracts/shared/ids";
import type { BodySnapshotRecord } from "@/contracts/modeling/schema";
import { resolveBodyAppearanceHex } from "@/contracts/modeling/body-appearance";

export interface ComposeViewportRenderablesInput {
  snapshotRenderables: RenderableEntityRecord[];
  snapshotSketches?: readonly SketchSnapshotRecord[];
  previewRenderables: RenderableEntityRecord[] | null;
  sketchSession: SketchSessionState | null;
  hiddenTargetKeys: Record<string, boolean>;
  /** Face display colour per body (0xrrggbb), including a live picker preview. */
  bodyColors?: ReadonlyMap<BodyId, number>;
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

/**
 * Face display colour (0xrrggbb) per body, with an uncommitted custom colour
 * preview (from the colour picker) taking precedence for its body.
 */
export function getBodyDisplayColors(
  bodies: readonly Pick<BodySnapshotRecord, "bodyId" | "appearance">[],
  preview: { bodyId: BodyId; hex: string } | null,
): ReadonlyMap<BodyId, number> {
  const colors = new Map(
    bodies.map((body) => [
      body.bodyId,
      Number.parseInt(resolveBodyAppearanceHex(body.appearance).slice(1), 16),
    ]),
  );
  if (preview) {
    colors.set(preview.bodyId, Number.parseInt(preview.hex.slice(1), 16));
  }
  return colors;
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
    documentRenderables: mergedRenderables.documentRenderables.map((entry) => {
      const target = entry.renderable.binding.target;
      const bodyColor =
        entry.origin === "document" &&
        (target.kind === "body" || target.kind === "face")
          ? input.bodyColors?.get(target.bodyId)
          : undefined;
      return {
        ...entry,
        ...(bodyColor === undefined ? {} : { bodyColor }),
        isInactiveSketch: Boolean(
          input.sketchSession &&
            "sketchId" in target &&
            target.sketchId !== input.sketchSession.sketchId,
        ),
      };
    }),
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
