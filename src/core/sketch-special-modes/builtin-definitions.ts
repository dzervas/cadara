import type { SketchSpecialModeDefinition } from "@/core/sketch-special-modes/schema";
import { referenceImageCalibrationModeDefinition } from "@/core/reference-image-calibration/mode/definition";


export const builtinSketchSpecialModeDefinitions = [
  referenceImageCalibrationModeDefinition,
] as const satisfies readonly SketchSpecialModeDefinition[];

export const sketchSpecialModeDefinitions = builtinSketchSpecialModeDefinitions;
