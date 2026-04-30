import type { AuthoredFeatureKind } from '@/contracts/modeling/schema'
import type { FeatureAuthoringDefinition } from '@/core/feature-authoring/definition'
import { createRegistry } from '@/core/tools/registry-factory'
import { chamferAuthoringDefinition } from '@/core/feature-authoring/features/chamfer'
import { combineAuthoringDefinition } from '@/core/feature-authoring/features/combine'
import { deleteSolidAuthoringDefinition } from '@/core/feature-authoring/features/delete-solid'
import { extrudeAuthoringDefinition } from '@/core/feature-authoring/features/extrude'
import { filletAuthoringDefinition } from '@/core/feature-authoring/features/fillet'
import { loftAuthoringDefinition } from '@/core/feature-authoring/features/loft'
import { mirrorAuthoringDefinition } from '@/core/feature-authoring/features/mirror'
import { planeAuthoringDefinition } from '@/core/feature-authoring/features/plane'
import { revolveAuthoringDefinition } from '@/core/feature-authoring/features/revolve'
import { shellAuthoringDefinition } from '@/core/feature-authoring/features/shell'
import { splitAuthoringDefinition } from '@/core/feature-authoring/features/split'
import { sweepAuthoringDefinition } from '@/core/feature-authoring/features/sweep'
import { thickenAuthoringDefinition } from '@/core/feature-authoring/features/thicken'
import { transformAuthoringDefinition } from '@/core/feature-authoring/features/transform'

export const featureAuthoringDefinitions = [
  extrudeAuthoringDefinition,
  revolveAuthoringDefinition,
  filletAuthoringDefinition,
  planeAuthoringDefinition,
  shellAuthoringDefinition,
  sweepAuthoringDefinition,
  loftAuthoringDefinition,
  chamferAuthoringDefinition,
  thickenAuthoringDefinition,
  combineAuthoringDefinition,
  splitAuthoringDefinition,
  deleteSolidAuthoringDefinition,
  mirrorAuthoringDefinition,
  transformAuthoringDefinition,
] as const satisfies readonly FeatureAuthoringDefinition[]

const featureAuthoringRegistry = createRegistry<AuthoredFeatureKind, FeatureAuthoringDefinition>(
  featureAuthoringDefinitions,
  (definition) => definition.metadata.kind,
  'Feature authoring definition',
)

function isFeatureAuthoringDefinitionForKind<TKind extends AuthoredFeatureKind>(
  definition: unknown,
  featureKind: TKind,
): definition is FeatureAuthoringDefinition<TKind> {
  return Boolean(
    definition
      && typeof definition === 'object'
      && 'metadata' in definition
      && (definition as { metadata?: { kind?: unknown } }).metadata?.kind === featureKind,
  )
}

export function getFeatureAuthoringDefinition<TKind extends AuthoredFeatureKind>(
  featureKind: TKind,
): FeatureAuthoringDefinition<TKind> {
  const definition = featureAuthoringRegistry.get(featureKind)

  if (isFeatureAuthoringDefinitionForKind(definition, featureKind)) {
    return definition
  }

  throw new Error(`Feature authoring definition ${featureKind} resolved to a mismatched feature kind.`)
}

export function findFeatureAuthoringDefinition<TKind extends AuthoredFeatureKind>(
  featureKind: TKind,
): FeatureAuthoringDefinition<TKind> | null {
  const definition = featureAuthoringRegistry.find?.(featureKind)
  return definition && isFeatureAuthoringDefinitionForKind(definition, featureKind) ? definition : null
}

export function getRegisteredFeatureAuthoringDefinitions() {
  return featureAuthoringRegistry.getAll()
}
