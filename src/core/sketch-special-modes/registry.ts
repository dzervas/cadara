import { createRegistry, type DomainRegistry } from '@/core/tools/registry-factory'
import type {
  SketchSpecialModeDefinition,
  SketchSpecialModeId,
} from '@/core/sketch-special-modes/schema'

export type SketchSpecialModeRegistry = DomainRegistry<SketchSpecialModeId, SketchSpecialModeDefinition>

export function createSketchSpecialModeRegistry(
  definitions: readonly SketchSpecialModeDefinition[],
): SketchSpecialModeRegistry {
  return createRegistry<SketchSpecialModeId, SketchSpecialModeDefinition>(
    definitions,
    (definition) => definition.id,
    'Sketch special mode',
  )
}
