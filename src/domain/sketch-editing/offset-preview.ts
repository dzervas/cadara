/**
 * Display only (T17c4): the Offset tool's preview drawing of its shell
 * outputs. A shell is drawn from the frame's spans through the same routine
 * that writes its solved record (`offsetFrameShellSpans`: deep-trim removed
 * leaves left out, `queryDomain` the drawn part), tessellated by the one
 * display tessellator, so the preview is the curve the committed shell draws.
 */
import type { SketchEntityDefinition } from "@/contracts/sketch/schema";
import type { OffsetSolveFrame } from "@/contracts/sketch/offset-derivation-frame";
import {
  offsetFrameShellSpans,
  type OffsetFrameShellOutput,
} from "@/contracts/sketch/offset-derivation-outputs";
import { tessellateCubicSpans } from "@/contracts/sketch/spline-geometry";
import type { SketchDraftEntity } from "@/core/sketch-tools/definition";

export function createOffsetShellPreviewEntities(
  frame: OffsetSolveFrame,
  shells: readonly OffsetFrameShellOutput[],
  entities: readonly SketchEntityDefinition[],
): SketchDraftEntity[] {
  return shells.map((shell) => {
    const entity = entities.find(
      (candidate) => candidate.entityId === shell.entityId,
    )!;
    return {
      id: `preview-${shell.entityId}`,
      kind: "polyline",
      points: tessellateCubicSpans(
        offsetFrameShellSpans(frame, shell).map((span) => ({
          interval: span.sourceDomain,
          poles: span.poles,
          queryDomain: span.queryDomain,
        })),
      ),
      isClosed: false,
      entityId: null,
      status: "preview",
      label: entity.label,
      isConstruction: entity.isConstruction,
    };
  });
}
