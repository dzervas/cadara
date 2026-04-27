import { createRegistry } from '@/domain/tools/registry-factory'
import type {
  SketchSpecialModeDefinition,
  SketchSpecialModeId,
} from '@/domain/sketch-special-modes/schema'

export function createSketchSpecialModeRegistry(
  definitions: readonly SketchSpecialModeDefinition[],
) {
  return createRegistry<SketchSpecialModeId, SketchSpecialModeDefinition>(
    definitions,
    (definition) => definition.id,
    'Sketch special mode',
  )
}

export const sketchSpecialModeDefinitions = [] as const satisfies readonly SketchSpecialModeDefinition[]

let sketchSpecialModeRegistry = createSketchSpecialModeRegistry(sketchSpecialModeDefinitions)

export function getSketchSpecialModeDefinition(modeId: SketchSpecialModeId) {
  return sketchSpecialModeRegistry.get(modeId)
}

export function getRegisteredSketchSpecialModeDefinitions() {
  return sketchSpecialModeRegistry.getAll()
}

export function isRegisteredSketchSpecialModeId(modeId: string): modeId is SketchSpecialModeId {
  return sketchSpecialModeRegistry.has(modeId)
}

export function replaceRegisteredSketchSpecialModeDefinitionsForTest(
  definitions: readonly SketchSpecialModeDefinition[],
) {
  sketchSpecialModeRegistry = createSketchSpecialModeRegistry(definitions)
}
