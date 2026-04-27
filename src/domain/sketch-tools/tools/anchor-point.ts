import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  SketchDraftEntity,
  SketchToolDefinition,
  SketchToolRuntimeState,
} from '@/domain/sketch-tools/definition'
import type { SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'
import { createIdleState } from '@/domain/sketch-tools/shared'

function buildAnchorPointPreview(point: SketchPoint): readonly SketchDraftEntity[] {
  return [
    {
      id: 'preview-anchor-point',
      kind: 'circle',
      center: point,
      radius: 0.12,
      entityId: null,
      status: 'preview',
      label: 'Anchor point preview',
      isConstruction: true,
    },
  ]
}

function buildAnchorPointPresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema {
  const point = state.livePoint ?? state.pointerDownPoint

  return {
    prompts: [
      {
        id: 'anchor-point-prompt',
        text: point ? 'Place anchor point on image' : 'Click on the image to place an anchor point',
      },
    ],
    steps: [{ id: 'anchor-point-step', label: point ? 'Location' : 'Pick' }],
    cursor: { id: 'anchor-point-cursor', label: 'Anchor Point', icon: 'crosshair' },
    completionHints: [
      {
        id: 'anchor-point-completion',
        text: point ? 'Click on the image to pin the point' : 'Click on the image to create an anchor point',
        ready: point !== null,
      },
    ],
    overlays: point
      ? [
          {
            id: 'anchor-point-marker',
            kind: 'helperMarker',
            label: 'Anchor Point',
            point,
          },
        ]
      : [],
    validation: [],
  }
}

/**
 * Anchor point tool — places a point pinned to an image reference via a
 * `pointOnImage` constraint. The actual commit logic lives in
 * `startSketchDraw` because it needs access to the sketch definition
 * for image quad hit-testing and UV computation.
 */
export const anchorPointSketchToolDefinition: SketchToolDefinition<'anchorPoint'> = {
  metadata: {
    id: 'anchorPoint',
    group: 'drawing',
    name: 'Anchor Point',
    tooltip: 'Pin a point to an image for calibration.',
    icon: 'anchorPoint',
    modes: ['sketch'],
  },
  activate() {
    const state = createIdleState()

    return {
      state,
      stagedEntities: [],
      presentation: buildAnchorPointPresentation(state),
    }
  },
  pointerMove({ state, point }) {
    const nextState = {
      ...state,
      livePoint: point,
    }

    return {
      state: nextState,
      stagedEntities: point ? buildAnchorPointPreview(point) : [],
      presentation: buildAnchorPointPresentation(nextState),
    }
  },
  pointerRelease({ state, point }) {
    // Actual placement is handled by startSketchDraw in sketch-session.ts
    // which has access to the sketch definition for image hit-testing.
    return {
      state,
      stagedEntities: point ? buildAnchorPointPreview(point) : [],
      presentation: buildAnchorPointPresentation(state),
    }
  },
  getStagedEntities(state) {
    const point = state.livePoint ?? state.pointerDownPoint

    return point ? buildAnchorPointPreview(point) : []
  },
  validate() {
    return { valid: true, message: null }
  },
  getPresentation: buildAnchorPointPresentation,
  createCommitContribution({ sequence, end, factories }) {
    // This is not used — anchor point commits are handled directly in
    // startSketchDraw because they require the sketch definition.
    const pointId = factories.createPointId('anchor_point')
    const entityId = factories.createEntityId('anchor_point')

    return {
      points: [
        factories.createPoint(`Anchor point ${sequence}`, pointId, end),
      ],
      entities: [
        factories.createPointEntity(`Anchor point ${sequence}`, entityId, pointId),
      ],
    }
  },
}
