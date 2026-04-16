import type { DurableRef } from '@/contracts/shared/references'
import type { DocumentFeatureCursor, FeatureDefinition, SketchSnapshotRecord, SnapshotEntityRecord } from '@/contracts/modeling/schema'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { BodyId, ConstructionId, FeatureId, SketchId } from '@/contracts/shared/ids'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
  OCC_KERNEL_SETTINGS,
  createStandardPlaneDefinition,
} from '@/domain/modeling/opencascade-kernel-seed'
import {
  createConstructionPresentationArtifacts,
  executeOccFeature,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from '@/domain/modeling/occ/features'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  createOccReferenceState,
  type OccReferenceState,
  type OccTrackedBody,
} from '@/domain/modeling/occ/topology'

export interface OccAuthoringFeatureRecord {
  featureId: FeatureId
  definition: FeatureDefinition
  label?: string
  producedTargets?: readonly DurableRef[]
}

export interface OccAuthoringState extends OccFeatureExecutionContext {
  baseBodies: readonly OccTrackedBody[]
  baseConstructions: OccFeatureExecutionContext['constructions']
  baseConstructionPlanes: ReadonlyMap<ConstructionId, SketchPlaneDefinition>
  bodyLabels: ReadonlyMap<BodyId, string>
  features: readonly OccAuthoringFeatureRecord[]
  cursor: DocumentFeatureCursor
  entities: readonly SnapshotEntityRecord[]
  renderRecords: readonly RenderableEntityRecord[]
  referenceState: OccReferenceState
}

function createTailCursor(
  features: readonly { featureId: FeatureId }[],
  sketches: readonly { sketchId: SketchId }[],
): DocumentFeatureCursor {
  const tail = features.at(-1)
  if (tail) {
    return { kind: 'feature', featureId: tail.featureId }
  }

  const sketch = sketches.at(-1)
  return sketch ? { kind: 'sketch', sketchId: sketch.sketchId } : { kind: 'empty' }
}

function applyBodyLabels(
  bodies: readonly OccTrackedBody[],
  bodyLabels: ReadonlyMap<BodyId, string>,
): OccTrackedBody[] {
  if (bodyLabels.size === 0) {
    return [...bodies]
  }

  return bodies.map((body) => {
    const label = bodyLabels.get(body.bodyId)
    return label ? { ...body, label } : body
  })
}

function createStandardConstructionState(
  documentId: OccFeatureExecutionContext['documentId'],
  revisionId: OccFeatureExecutionContext['revisionId'],
) {
  const standardPlanes = [
    createStandardPlaneDefinition('xy'),
    createStandardPlaneDefinition('yz'),
    createStandardPlaneDefinition('xz'),
  ]

  const standardPlaneLabels = {
    xy: 'Top Plane',
    yz: 'Right Plane',
    xz: 'Front Plane',
  } as const

  return {
    constructions: standardPlanes.map((plane) => {
      const support = plane.support

      if (support.kind !== 'construction') {
        throw new Error('Expected standard OCC planes to be construction-backed.')
      }

      const label = plane.key ? standardPlaneLabels[plane.key] : support.constructionId

      return {
        ownerDocumentId: documentId,
        ownerRevisionId: revisionId,
        ownerFeatureId: null,
        ownerSketchId: null,
        ownerBodyId: null,
        constructionId: support.constructionId,
        label,
        constructionType: 'plane' as const,
        plane,
        target: { kind: 'construction' as const, constructionId: support.constructionId },
      }
    }),
    constructionPlanes: new Map<ConstructionId, SketchPlaneDefinition>(
      standardPlanes.map((plane) => {
        const support = plane.support

        if (support.kind !== 'construction') {
          throw new Error('Expected standard OCC planes to be construction-backed.')
        }

        return [support.constructionId, plane]
      }),
    ),
  }
}

export function createOccAuthoringState(
  oc: OpenCascadeInstance,
  input: {
    sketches?: readonly SketchSnapshotRecord[]
    bodies?: readonly OccTrackedBody[]
    bodyLabels?: ReadonlyMap<BodyId, string>
    features?: readonly OccAuthoringFeatureRecord[]
    cursor?: DocumentFeatureCursor
    constructions?: OccFeatureExecutionContext['constructions']
    constructionPlanes?: ReadonlyMap<ConstructionId, SketchPlaneDefinition>
    documentId?: OccFeatureExecutionContext['documentId']
    revisionId?: OccFeatureExecutionContext['revisionId']
    modelingTolerance?: number
    previousReferenceState?: OccReferenceState
  } = {},
): OccAuthoringState {
  const documentId = input.documentId ?? OCC_KERNEL_DOCUMENT_ID
  const revisionId = input.revisionId ?? OCC_KERNEL_INITIAL_REVISION_ID
  const standardState = createStandardConstructionState(documentId, revisionId)
  const constructionById = new Map<ConstructionId, OccFeatureExecutionContext['constructions'][number]>(
    standardState.constructions.map((construction) => [construction.constructionId, construction]),
  )

  for (const construction of input.constructions ?? []) {
    constructionById.set(construction.constructionId, construction)
  }

  const constructionPlanes = new Map<ConstructionId, SketchPlaneDefinition>([
    ...standardState.constructionPlanes.entries(),
    ...Array.from(input.constructionPlanes?.entries() ?? []),
  ])
  const baseConstructions = [...constructionById.values()]
  const bodyLabels = new Map<BodyId, string>(input.bodyLabels ?? [])
  const baseBodies = applyBodyLabels(input.bodies ?? [], bodyLabels)
  const features = [...(input.features ?? [])]
  const sketches = input.sketches ?? []
  const cursor = input.cursor ?? createTailCursor(features, sketches)
  const referenceState = createOccReferenceState({
    documentId,
    revisionId,
    bodies: baseBodies,
    constructions: baseConstructions,
    sketches,
    features,
    previous: input.previousReferenceState,
  })

  return {
    oc,
    documentId,
    revisionId,
    modelingTolerance: input.modelingTolerance ?? OCC_KERNEL_SETTINGS.modelingTolerance,
    sketches,
    constructions: baseConstructions,
    constructionPlanes,
    bodies: baseBodies,
    baseBodies,
    baseConstructions,
    baseConstructionPlanes: constructionPlanes,
    bodyLabels,
    features,
    cursor,
    entities: [],
    renderRecords: [],
    referenceState,
  }
}

function applyFeatureResult(
  state: OccAuthoringState,
  feature: OccAuthoringFeatureRecord,
  result: OccFeatureExecutionResult,
): OccAuthoringState {
  const features = [
    ...state.features,
    {
      ...feature,
      label: feature.label ?? feature.featureId,
      producedTargets: [...result.producedTargets],
    },
  ]
  const bodies = applyBodyLabels(result.bodies, state.bodyLabels)
  const referenceState = createOccReferenceState({
    documentId: state.documentId,
    revisionId: state.revisionId,
    bodies,
    constructions: result.constructions,
    sketches: state.sketches,
    features,
    previous: state.referenceState,
    historyInvalidations: result.historyInvalidations,
  })

  return {
    ...state,
    bodies,
    constructions: result.constructions,
    constructionPlanes: result.constructionPlanes,
    features,
    cursor: { kind: 'feature', featureId: feature.featureId },
    entities: [...state.entities, ...result.entities],
    renderRecords: [...state.renderRecords, ...result.renderRecords],
    referenceState,
  }
}

export function applyOccFeatureToAuthoringState(
  state: OccAuthoringState,
  feature: OccAuthoringFeatureRecord,
) {
  return applyFeatureResult(
    state,
    feature,
    executeOccFeature(state, feature.featureId, feature.definition),
  )
}

export function rebuildOccAuthoringState(
  state: OccAuthoringState,
  features: readonly OccAuthoringFeatureRecord[],
) {
  let current = createOccAuthoringState(state.oc, {
    documentId: state.documentId,
    revisionId: state.revisionId,
    modelingTolerance: state.modelingTolerance,
    sketches: state.sketches,
    bodies: state.baseBodies,
    bodyLabels: state.bodyLabels,
    constructions: state.baseConstructions,
    constructionPlanes: state.baseConstructionPlanes,
    features: [],
    cursor: { kind: 'empty' },
    previousReferenceState: state.referenceState,
  })

  for (const feature of features) {
    current = applyOccFeatureToAuthoringState(current, feature)
  }

  return current
}

export function buildOccConstructionPresentationForState(state: OccAuthoringState) {
  return state.constructions.flatMap((construction) => {
    const plane = state.constructionPlanes.get(construction.constructionId)

    if (!plane) {
      return []
    }

    return createConstructionPresentationArtifacts(state, construction, plane).renderRecords
  })
}
