import { createRegistry, type DomainRegistry } from '@/domain/tools/registry-factory'
import type {
  SketchSpecialModeDefinition,
  SketchSpecialModeId,
} from '@/domain/sketch-special-modes/schema'
import { referenceImageCalibrationModeDefinition } from '@/domain/reference-image-calibration/mode/definition'

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

export const builtinSketchSpecialModeDefinitions = [
  referenceImageCalibrationModeDefinition,
] as const satisfies readonly SketchSpecialModeDefinition[]

export const sketchSpecialModeDefinitions = builtinSketchSpecialModeDefinitions
