import type { AuthoredFeatureKind } from '@/contracts/modeling/schema'
import type { FeatureAuthoringDefinition } from '@/domain/feature-authoring/definition'
import { chamferAuthoringDefinition } from '@/domain/feature-authoring/features/chamfer'
import { combineAuthoringDefinition } from '@/domain/feature-authoring/features/combine'
import { deleteSolidAuthoringDefinition } from '@/domain/feature-authoring/features/delete-solid'
import { extrudeAuthoringDefinition } from '@/domain/feature-authoring/features/extrude'
import { filletAuthoringDefinition } from '@/domain/feature-authoring/features/fillet'
import { loftAuthoringDefinition } from '@/domain/feature-authoring/features/loft'
import { mirrorAuthoringDefinition } from '@/domain/feature-authoring/features/mirror'
import { planeAuthoringDefinition } from '@/domain/feature-authoring/features/plane'
import { revolveAuthoringDefinition } from '@/domain/feature-authoring/features/revolve'
import { shellAuthoringDefinition } from '@/domain/feature-authoring/features/shell'
import { splitAuthoringDefinition } from '@/domain/feature-authoring/features/split'
import { sweepAuthoringDefinition } from '@/domain/feature-authoring/features/sweep'
import { thickenAuthoringDefinition } from '@/domain/feature-authoring/features/thicken'
import { transformAuthoringDefinition } from '@/domain/feature-authoring/features/transform'

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

const featureAuthoringRegistry = new Map<AuthoredFeatureKind, FeatureAuthoringDefinition>(
  featureAuthoringDefinitions.map((definition) => [definition.metadata.kind, definition]),
)

export function getFeatureAuthoringDefinition<TKind extends AuthoredFeatureKind>(
  featureKind: TKind,
): FeatureAuthoringDefinition<TKind> {
  const definition = featureAuthoringRegistry.get(featureKind)

  if (!definition) {
    throw new Error(`No feature authoring definition registered for "${featureKind}".`)
  }

  return definition as unknown as FeatureAuthoringDefinition<TKind>
}

export function findFeatureAuthoringDefinition<TKind extends AuthoredFeatureKind>(
  featureKind: TKind,
): FeatureAuthoringDefinition<TKind> | null {
  return (featureAuthoringRegistry.get(featureKind) as FeatureAuthoringDefinition<TKind> | undefined) ?? null
}

export function getRegisteredFeatureAuthoringDefinitions() {
  return featureAuthoringDefinitions
}
