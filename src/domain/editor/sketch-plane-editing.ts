import type {
  ModelingDiagnostic,
  SketchSnapshotRecord,
  WorkspaceSnapshot,
} from '@/contracts/modeling/schema'
import type { SketchId } from '@/contracts/shared/ids'
import type {
  SketchPlaneDefinition,
  SketchPlaneKey,
} from '@/contracts/shared/sketch-plane'
import type {
  FeatureEditorFormSchema,
  FeatureEditorPatch,
} from '@/core/feature-authoring/form-schema'
import { deriveStandardPlaneKeyFromConstructionId } from '@/domain/modeling/opencascade-kernel-seed'

const ORIGIN_PLANE_ORDER = ['xy', 'yz', 'xz'] as const satisfies readonly SketchPlaneKey[]

export interface SketchPlaneEditOption {
  key: SketchPlaneKey
  label: string
  plane: SketchPlaneDefinition
}

export interface SketchPlaneEditSessionState {
  sketchId: SketchId
  sketchLabel: string
  currentPlaneKey: SketchPlaneKey
  definition: SketchSnapshotRecord['sketch']['definition']
  draft: {
    selectedPlaneKey: SketchPlaneKey
  }
  options: readonly SketchPlaneEditOption[]
  diagnostics: readonly ModelingDiagnostic[]
  status: 'idle' | 'submitting'
}

function getSketchPlaneKey(plane: SketchPlaneDefinition): SketchPlaneKey | null {
  if (plane.key) {
    return plane.key
  }

  return plane.support.kind === 'construction'
    ? deriveStandardPlaneKeyFromConstructionId(plane.support.constructionId)
    : null
}

function getOriginPlaneOptions(snapshot: WorkspaceSnapshot): SketchPlaneEditOption[] {
  const optionsByKey = new Map<SketchPlaneKey, SketchPlaneEditOption>()

  for (const construction of snapshot.document.constructions) {
    const key = getSketchPlaneKey(construction.plane)
    if (!key) {
      continue
    }

    optionsByKey.set(key, {
      key,
      label: construction.label,
      plane: construction.plane,
    })
  }

  return ORIGIN_PLANE_ORDER.flatMap((key) => {
    const option = optionsByKey.get(key)
    return option ? [option] : []
  })
}

export function hydrateSketchPlaneEditSession(
  snapshot: WorkspaceSnapshot,
  sketchId: SketchId,
): SketchPlaneEditSessionState | null {
  const sketch = snapshot.document.sketches.find((entry) => entry.sketchId === sketchId)
  if (!sketch) {
    return null
  }

  const currentPlaneKey = getSketchPlaneKey(sketch.plane)
  if (!currentPlaneKey) {
    return null
  }

  const options = getOriginPlaneOptions(snapshot)
  if (
    options.length < 2
    || !options.some((option) => option.key === currentPlaneKey)
  ) {
    return null
  }

  return {
    sketchId: sketch.sketchId,
    sketchLabel: sketch.label,
    currentPlaneKey,
    definition: sketch.sketch.definition,
    draft: {
      selectedPlaneKey: currentPlaneKey,
    },
    options,
    diagnostics: [],
    status: 'idle',
  }
}

export function canReassignCommittedSketchPlane(
  snapshot: WorkspaceSnapshot | null,
  sketchId: SketchId,
): boolean {
  return snapshot ? hydrateSketchPlaneEditSession(snapshot, sketchId) !== null : false
}

export function patchSketchPlaneEditSession(
  session: SketchPlaneEditSessionState,
  patch: FeatureEditorPatch,
): SketchPlaneEditSessionState {
  const selectedPlaneKey = patch.selectedPlaneKey
  if (typeof selectedPlaneKey !== 'string') {
    return session
  }

  const selectedOption = session.options.find((option) => option.key === selectedPlaneKey)
  if (!selectedOption) {
    return session
  }

  return {
    ...session,
    draft: {
      ...session.draft,
      selectedPlaneKey: selectedOption.key,
    },
  }
}

export function getSketchPlaneEditFormSchema(
  session: SketchPlaneEditSessionState,
): FeatureEditorFormSchema {
  return {
    sections: [
      {
        id: 'support',
        title: 'Support',
        fields: [
          {
            kind: 'enum',
            id: 'sketch-plane',
            label: 'Origin plane',
            helper: 'Retarget the committed sketch to another origin datum plane.',
            value: session.draft.selectedPlaneKey,
            options: session.options.map((option) => ({
              value: option.key,
              label: option.label,
            })),
            patch: { patchKey: 'selectedPlaneKey' },
          },
        ],
      },
      {
        id: 'diagnostics',
        title: 'Diagnostics',
        fields: [
          {
            kind: 'diagnostics',
            id: 'sketch-plane-diagnostics',
            label: 'Diagnostics',
            diagnostics: session.diagnostics,
          },
        ],
      },
    ],
  }
}

export function getSketchPlaneEditSelectionTarget(session: SketchPlaneEditSessionState) {
  return { kind: 'sketch', sketchId: session.sketchId } as const
}

export function getSketchPlaneEditPreviewLabel(session: SketchPlaneEditSessionState) {
  const selectedOption = session.options.find((option) => option.key === session.draft.selectedPlaneKey)
  return `Editing ${session.sketchLabel} on ${selectedOption?.label ?? session.draft.selectedPlaneKey.toUpperCase()}`
}

export function hasSketchPlaneEditChanges(session: SketchPlaneEditSessionState) {
  return session.draft.selectedPlaneKey !== session.currentPlaneKey
}

export function buildSketchPlaneCommitRequest(session: SketchPlaneEditSessionState) {
  const selectedOption = session.options.find((option) => option.key === session.draft.selectedPlaneKey)
  if (!selectedOption) {
    return null
  }

  return {
    sketchId: session.sketchId,
    sketchLabel: session.sketchLabel,
    plane: selectedOption.plane,
    definition: session.definition,
  }
}
