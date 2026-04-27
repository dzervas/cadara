import type {
  ReferenceImageCalibrationAnchor,
  ReferenceImageOperationState,
  SolvedReferenceImageCalibrationState,
} from '@/contracts/reference-image/schema'
import type { SketchDefinition, SketchReferenceDefinition } from '@/contracts/sketch/schema'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type { ProjectedGeometryId, ReferenceId, SketchAuthoringOperationId, SketchId } from '@/contracts/shared/ids'

import { collectActiveReferenceImageOperations } from '@/domain/reference-image/operations'
import type { ReferenceImageOperationStateOverride } from '@/domain/reference-image/operations'
import {
  canExportSolvedReferenceImageAnchors,
  solveReferenceImageOperationState,
} from '@/domain/reference-image-calibration/state'

function getCalibrationState(state: ReferenceImageOperationState) {
  const calibration = solveReferenceImageOperationState(state).calibration
  if (!calibration) {
    throw new Error('Reference-image calibration state must exist before exporting anchor references.')
  }

  return calibration
}

export function createReferenceImageAnchorReferenceId(
  operationId: string,
  anchorId: string,
) {
  return `ref_reference_image_anchor:${operationId}:${anchorId}` as ReferenceId
}

export function createReferenceImageAnchorGeometryId(
  operationId: string,
  anchorId: string,
) {
  return `projected_geometry_reference_image_anchor:${operationId}:${anchorId}` as ProjectedGeometryId
}

export function mergeReferenceImageAnchorReferences(
  definition: SketchDefinition,
  sketchId: SketchId,
  overrides?: ReadonlyMap<SketchAuthoringOperationId, ReferenceImageOperationStateOverride>,
): SketchDefinition {
  const externalReferences = definition.references.filter((reference) => reference.kind !== 'referenceImageAnchor')
  const activeOperations = collectActiveReferenceImageOperations(definition, overrides)
  const anchorReferences = activeOperations.flatMap(({ operation, state }) =>
    getCalibrationState(state).anchors.map((anchor) => createReferenceImageAnchorReferenceDefinition({
      sketchId,
      operationId: operation.operationId,
      operationLabel: operation.label,
      anchor,
    })),
  )

  return {
    ...definition,
    referenceIds: [...externalReferences.map((reference) => reference.referenceId), ...anchorReferences.map((reference) => reference.referenceId)],
    references: [...externalReferences, ...anchorReferences],
  }
}

export function buildReferenceImageAnchorProjectedReferences(
  definition: SketchDefinition,
  overrides?: ReadonlyMap<SketchAuthoringOperationId, ReferenceImageOperationStateOverride>,
): ProjectedSketchReferenceRecord[] {
  return collectActiveReferenceImageOperations(definition, overrides).flatMap(({ operation, state }) =>
    buildProjectedAnchorRecordsForOperation(operation.operationId, state),
  )
}

function createReferenceImageAnchorReferenceDefinition(input: {
  sketchId: SketchId
  operationId: SketchAuthoringOperationId
  operationLabel: string
  anchor: ReferenceImageCalibrationAnchor
}) {
  return {
    referenceId: createReferenceImageAnchorReferenceId(input.operationId, input.anchor.anchorId),
    kind: 'referenceImageAnchor',
    label: `${input.operationLabel} ${input.anchor.label}`,
    source: {
      kind: 'sketchOperation',
      sketchId: input.sketchId,
      operationId: input.operationId,
    },
    anchorId: input.anchor.anchorId,
    projectionMode: 'referenceImageAnchor',
  } satisfies SketchReferenceDefinition
}

function buildProjectedAnchorRecordsForOperation(
  operationId: SketchAuthoringOperationId,
  state: ReferenceImageOperationState,
): ProjectedSketchReferenceRecord[] {
  const calibration = getCalibrationState(state)
  const canExport = canExportSolvedReferenceImageAnchors(calibration)
  const solvedByAnchorId = new Map(
    calibration.solveResult.anchors.map((anchor) => [anchor.anchorId, anchor.worldPosition] as const),
  )

  return calibration.anchors.map((anchor) => {
    const referenceId = createReferenceImageAnchorReferenceId(operationId, anchor.anchorId)
    const solvedPosition = solvedByAnchorId.get(anchor.anchorId)
    return solvedPosition && canExport
      ? {
          referenceId,
          status: 'projected' as const,
          geometry: [{
            geometryId: createReferenceImageAnchorGeometryId(operationId, anchor.anchorId),
            kind: 'point' as const,
            position: solvedPosition,
          }],
          diagnostics: [],
        }
      : buildUnexportedAnchorRecord(referenceId, anchor, calibration)
  })
}

function buildUnexportedAnchorRecord(
  referenceId: ReferenceId,
  anchor: ReferenceImageCalibrationAnchor,
  calibration: SolvedReferenceImageCalibrationState,
): ProjectedSketchReferenceRecord {
  if (calibration.solveResult.diagnostics.length > 0) {
    return {
      referenceId,
      status: 'ambiguous' as const,
      geometry: [],
      diagnostics: calibration.solveResult.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        target: null,
      })),
    }
  }

  return {
    referenceId,
    status: 'missingSource' as const,
    geometry: [],
    diagnostics: [{
      code: 'reference-image-anchor-unsolved',
      severity: 'warning' as const,
      message: `${anchor.label} is not solved yet.`,
      target: null,
    }],
  }
}
