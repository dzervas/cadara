import type { AdvancedSolidFeatureDefinition } from '@/contracts/modeling/advanced-solid'
import type { FeatureDefinition } from '@/contracts/modeling/schema'
import type { FeatureId } from '@/contracts/shared/ids'

import type { OccFeatureExecutionContext, OccFeatureExecutionResult } from '@/domain/modeling/occ/features/shared'
import { executeExtrudeFeature } from '@/domain/modeling/occ/features/extrude'
import { executeRevolveFeature } from '@/domain/modeling/occ/features/revolve'
import { executeSweepFeature } from '@/domain/modeling/occ/features/sweep'
import { executeLoftFeature } from '@/domain/modeling/occ/features/loft'
import { executeFilletFeature, executeChamferFeature } from '@/domain/modeling/occ/features/fillet-chamfer'
import { executeThickenFeature } from '@/domain/modeling/occ/features/thicken'
import { executeCombineFeature, executeSplitFeature, executeDeleteSolidFeature } from '@/domain/modeling/occ/features/combine-split-delete'
import { executeMirrorFeature, executeTransformFeature } from '@/domain/modeling/occ/features/mirror-transform'
import { executeShellFeature } from '@/domain/modeling/occ/features/shell'
import { executePlaneFeature } from '@/domain/modeling/occ/features/plane'

// Re-export public API
export type {
  OccFeatureExecutionContext,
  OccFeatureExecutionResult,
  OccFeaturePresentationArtifacts,
} from '@/domain/modeling/occ/features/shared'

export { createConstructionPresentationArtifacts, createEmptyOccRenderExport } from '@/domain/modeling/occ/features/plane'
export { createCadaraBrepTopologyFromShape } from '@/domain/modeling/occ/features/brep-topology'

export function executeOccFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: FeatureDefinition,
): OccFeatureExecutionResult {
  switch (definition.kind) {
    case 'plane':
      return executePlaneFeature(context, ownerFeatureId, definition.parameters)
    case 'extrude':
      return executeExtrudeFeature(context, ownerFeatureId, definition.parameters)
    case 'revolve':
      return executeRevolveFeature(context, ownerFeatureId, definition.parameters)
    case 'fillet':
      return executeFilletFeature(context, ownerFeatureId, definition.parameters)
    case 'shell':
      return executeShellFeature(context, ownerFeatureId, definition.parameters)
    case 'sweep':
      return executeSweepFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'sweep' })
    case 'loft':
      return executeLoftFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'loft' })
    case 'chamfer':
      return executeChamferFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'chamfer' })
    case 'thicken':
      return executeThickenFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'thicken' })
    case 'combine':
      return executeCombineFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'combine' })
    case 'split':
      return executeSplitFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'split' })
    case 'deleteSolid':
      return executeDeleteSolidFeature(context, definition as AdvancedSolidFeatureDefinition & { kind: 'deleteSolid' })
    case 'mirror':
      return executeMirrorFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'mirror' })
    case 'transform':
      return executeTransformFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'transform' })
    default:
      throw new Error(`advanced-feature-unsupported-kernel-case: OCC adapter does not implement ${definition.kind} yet.`)
  }
}
