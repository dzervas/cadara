import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { SketchSnapshotRecord } from '@/contracts/modeling/schema'
import type { SketchSessionState } from '@/domain/editor/sketch-session'
import {
  getSketchConstraintDisplayForTarget,
  getSketchConstraintDisplaySummary,
} from '@/domain/editor/sketch-session'
import { mergeSketchRenderables, type MergedSketchRenderables } from '@/domain/editor/sketch-session-controller'
import { getPrimitiveRefKey } from '@/domain/editor/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import type { ViewportRenderableRecord } from '@/domain/workspace/viewport-renderables'

export interface ComposeViewportRenderablesInput {
  snapshotRenderables: RenderableEntityRecord[]
  snapshotSketches?: readonly SketchSnapshotRecord[]
  previewRenderables: RenderableEntityRecord[] | null
  sketchSession: SketchSessionState | null
  hiddenTargetKeys: Record<string, boolean>
}

export interface ComposedViewportRenderables extends MergedSketchRenderables {
  documentRenderables: ViewportRenderableRecord[]
}

export function getHiddenTargetKeyForTarget(
  target: PrimitiveRef,
  hiddenTargetKeys: Record<string, boolean>,
) {
  const targetKey = getPrimitiveRefKey(target)

  if (hiddenTargetKeys[targetKey]) {
    return targetKey
  }

  if (
    target.kind === 'sketchEntity'
    || target.kind === 'sketchPoint'
    || target.kind === 'constraint'
    || target.kind === 'dimension'
    || target.kind === 'region'
  ) {
    const sketchKey = getPrimitiveRefKey({ kind: 'sketch', sketchId: target.sketchId })
    return hiddenTargetKeys[sketchKey] ? sketchKey : null
  }

  return null
}

export function isTargetHidden(
  target: PrimitiveRef,
  hiddenTargetKeys: Record<string, boolean>,
) {
  return getHiddenTargetKeyForTarget(target, hiddenTargetKeys) !== null
}

export function composeViewportRenderables(
  input: ComposeViewportRenderablesInput,
): ComposedViewportRenderables {
  const sketchConstraintDisplayById = createCommittedSketchConstraintDisplayLookup(input.snapshotSketches ?? [])
  const layeredRenderables = [
    ...input.snapshotRenderables.map((renderable) => ({
      origin: 'document' as const,
      renderable,
      sketchConstraintDisplay: getCommittedSketchConstraintDisplay(renderable, sketchConstraintDisplayById),
    })),
    ...(input.previewRenderables ?? []).map((renderable) => ({
      origin: 'preview' as const,
      renderable,
    })),
  ].filter(({ renderable }) => !isTargetHidden(renderable.binding.target, input.hiddenTargetKeys))

  const mergedRenderables = mergeSketchRenderables(
    layeredRenderables,
    input.sketchSession,
  )

  return {
    ...mergedRenderables,
    documentRenderables: mergedRenderables.documentRenderables,
  }
}

function createCommittedSketchConstraintDisplayLookup(sketches: readonly SketchSnapshotRecord[]) {
  return new Map(
    sketches.map((sketch) => [
      sketch.sketchId,
      getSketchConstraintDisplaySummary({
        sketchId: sketch.sketchId,
        definition: sketch.sketch.definition,
        solvedSnapshot: sketch.sketch.solvedSnapshot,
      }),
    ] as const),
  )
}

function getCommittedSketchConstraintDisplay(
  renderable: RenderableEntityRecord,
  displayBySketchId: ReturnType<typeof createCommittedSketchConstraintDisplayLookup>,
) {
  const target = renderable.binding.target

  if (
    target.kind !== 'sketchEntity'
    && target.kind !== 'sketchPoint'
    && target.kind !== 'region'
  ) {
    return undefined
  }

  const summary = displayBySketchId.get(target.sketchId)
  return summary ? getSketchConstraintDisplayForTarget(target, summary) : undefined
}
