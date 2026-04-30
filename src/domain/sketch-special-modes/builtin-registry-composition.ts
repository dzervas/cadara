import {
  builtinSketchSpecialModeDefinitions,
  createSketchSpecialModeRegistry,
} from '@/domain/sketch-special-modes/registry'

export function createBuiltinSketchSpecialModeRegistry() {
  return createSketchSpecialModeRegistry(builtinSketchSpecialModeDefinitions)
}
