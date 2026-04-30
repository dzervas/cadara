import type { SketchSpecialModeDefinition } from '@/core/sketch-special-modes/schema'
import { referenceImageCalibrationModeDefinition } from '@/domain/reference-image-calibration/mode/definition'

export * from '@/core/sketch-special-modes/registry'

export const builtinSketchSpecialModeDefinitions = [
  referenceImageCalibrationModeDefinition,
] as const satisfies readonly SketchSpecialModeDefinition[]

export const sketchSpecialModeDefinitions = builtinSketchSpecialModeDefinitions
