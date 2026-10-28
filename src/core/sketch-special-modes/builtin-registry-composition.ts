import { builtinSketchSpecialModeDefinitions } from "@/core/sketch-special-modes/builtin-definitions";
import { createSketchSpecialModeRegistry } from "@/core/sketch-special-modes/registry";

export function createBuiltinSketchSpecialModeRegistry() {
  return createSketchSpecialModeRegistry(builtinSketchSpecialModeDefinitions);
}
