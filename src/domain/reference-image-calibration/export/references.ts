import type { SketchDefinition } from '@/contracts/sketch/schema'
import type { SketchAuthoringOperationId, SketchId } from '@/contracts/shared/ids'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'

import type { ReferenceImageOperationStateOverride } from '@/domain/reference-image/operations'

export function createReferenceImageAnchorReferenceId(
  operationId: string,
  anchorId: string,
) {
  return `ref_reference_image_anchor:${operationId}:${anchorId}` as const
}

export function createReferenceImageAnchorGeometryId(
  operationId: string,
  anchorId: string,
) {
  return `projected_geometry_reference_image_anchor:${operationId}:${anchorId}` as const
}

export function mergeReferenceImageAnchorReferences(
  definition: SketchDefinition,
  sketchId: SketchId,
  overrides?: ReadonlyMap<SketchAuthoringOperationId, ReferenceImageOperationStateOverride>,
): SketchDefinition {
  void sketchId
  void overrides
  return definition
}

export function buildReferenceImageAnchorProjectedReferences(
  definition: SketchDefinition,
  overrides?: ReadonlyMap<SketchAuthoringOperationId, ReferenceImageOperationStateOverride>,
): ProjectedSketchReferenceRecord[] {
  void definition
  void overrides
  return []
}
