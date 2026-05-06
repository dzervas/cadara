import type { SketchPoint } from '@/contracts/modeling/schema'
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
} from '@/core/sketch-tools/definition'
import type { SketchToolPresentationSchema } from '@/core/sketch-tools/editor-schema'
import { createIdleState } from '@/core/sketch-tools/shared'

function buildPointPreview(point: SketchPoint): readonly SketchDraftEntity[] {
  return [
    {
      id: 'preview-point',
      kind: 'circle',
      center: point,
      radius: 0.1,
      entityId: null,
      status: 'preview',
      label: 'Point preview',
      isConstruction: false,
    },
  ]
}

function buildPointPresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema {
  const point = state.livePoint ?? state.pointerDownPoint

  return {
    prompts: [
      {
        id: 'point-prompt',
        text: point ? 'Place point' : 'Pick point location',
      },
    ],
    steps: [{ id: 'point-step', label: point ? 'Location' : 'Pick' }],
    cursor: { id: 'point-cursor', label: 'Point', icon: 'crosshair' },
    completionHints: [
      {
        id: 'point-completion',
        text: point ? 'Click to accept the point' : 'Click to set the point location',
        ready: point !== null,
      },
    ],
    overlays: point
      ? [
          {
            id: 'point-marker',
            kind: 'helperMarker',
            label: 'Point',
            point,
          },
        ]
      : [],
    validation: [],
  }
}

export const pointSketchToolDefinition: SketchToolDefinition<'point'> = {
  metadata: {
    id: 'point',
    group: 'drawing',
    name: 'Point',
    tooltip: 'Create a sketch point.',
    icon: 'point',
    modes: ['sketch'],
  },
  activate() {
    const state = createIdleState()

    return {
      state,
      stagedEntities: [],
      presentation: buildPointPresentation(state),
    }
  },
  pointerMove({ state, point }) {
    const nextState = {
      ...state,
      livePoint: point,
    }

    return {
      state: nextState,
      stagedEntities: point ? buildPointPreview(point) : [],
      presentation: buildPointPresentation(nextState),
    }
  },
  pointerRelease({ state, point }) {
    if (!point) {
      return {
        state,
        stagedEntities: [],
        presentation: buildPointPresentation(state),
      }
    }

    const complete = state.status === 'drawing'
    const nextState = {
      status: complete ? 'idle' : 'drawing',
      pointerDownPoint: complete ? null : point,
      livePoint: point,
      placedPoints: [point],
      validationMessage: null,
    } satisfies SketchToolRuntimeState

    return {
      state: nextState,
      stagedEntities: complete ? [] : buildPointPreview(point),
      presentation: buildPointPresentation(nextState),
    }
  },
  getStagedEntities(state) {
    const point = state.livePoint ?? state.pointerDownPoint

    return point ? buildPointPreview(point) : []
  },
  validate() {
    return { valid: true, message: null }
  },
  getPresentation: buildPointPresentation,
  createCommitContribution({ sequence, end, factories }): SketchToolCommitContribution {
    const pointId = factories.createPointId('point')
    const entityId = factories.createEntityId('point')

    return {
      points: [
        factories.createPoint(`Point ${sequence}`, pointId, end),
      ],
      entities: [
        factories.createPointEntity(`Point ${sequence}`, entityId, pointId),
      ],
    }
  },
}
