import type {
  SketchToolDefinition,
  SketchToolId,
} from "@/core/sketch-tools/definition";
import { createRegistry } from "@/core/tools/registry-factory";
import {
  bezierCurveSketchToolDefinition,
  conicSketchToolDefinition,
  controlPointSplineSketchToolDefinition,
  ellipseSketchToolDefinition,
  ellipticalArcSketchToolDefinition,
  profileTextSketchToolDefinition,
} from "@/core/sketch-tools/tools/advanced-curves";
import { alignedRectangleSketchToolDefinition } from "@/core/sketch-tools/tools/aligned-rectangle";
import { circleSketchToolDefinition } from "@/core/sketch-tools/tools/circle";
import { centerPointArcSketchToolDefinition } from "@/core/sketch-tools/tools/center-point-arc";
import { centerPointRectangleSketchToolDefinition } from "@/core/sketch-tools/tools/center-point-rectangle";
import { circumscribedPolygonSketchToolDefinition } from "@/core/sketch-tools/tools/circumscribed-polygon";
import { inscribedPolygonSketchToolDefinition } from "@/core/sketch-tools/tools/inscribed-polygon";
import { lineSketchToolDefinition } from "@/core/sketch-tools/tools/line";
import { midpointLineSketchToolDefinition } from "@/core/sketch-tools/tools/midpoint-line";
import { pointSketchToolDefinition } from "@/core/sketch-tools/tools/point";
import { rectangleSketchToolDefinition } from "@/core/sketch-tools/tools/rectangle";
import { splineSketchToolDefinition } from "@/core/sketch-tools/tools/spline";
import { tangentArcSketchToolDefinition } from "@/core/sketch-tools/tools/tangent-arc";
import { threePointArcSketchToolDefinition } from "@/core/sketch-tools/tools/three-point-arc";
import { threePointCircleSketchToolDefinition } from "@/core/sketch-tools/tools/three-point-circle";

export const sketchToolDefinitions = [
  pointSketchToolDefinition,
  lineSketchToolDefinition,
  midpointLineSketchToolDefinition,
  rectangleSketchToolDefinition,
  centerPointRectangleSketchToolDefinition,
  alignedRectangleSketchToolDefinition,
  circleSketchToolDefinition,
  threePointCircleSketchToolDefinition,
  centerPointArcSketchToolDefinition,
  threePointArcSketchToolDefinition,
  tangentArcSketchToolDefinition,
  ellipseSketchToolDefinition,
  ellipticalArcSketchToolDefinition,
  conicSketchToolDefinition,
  bezierCurveSketchToolDefinition,
  inscribedPolygonSketchToolDefinition,
  circumscribedPolygonSketchToolDefinition,
  splineSketchToolDefinition,
  controlPointSplineSketchToolDefinition,
  profileTextSketchToolDefinition,
] as const satisfies readonly SketchToolDefinition[];

const sketchToolRegistry = createRegistry<SketchToolId, SketchToolDefinition>(
  sketchToolDefinitions,
  (definition) => definition.metadata.id,
  "Sketch tool",
);

export function getSketchToolDefinition(
  toolId: SketchToolId,
): SketchToolDefinition {
  return sketchToolRegistry.get(toolId);
}

export function getRegisteredSketchToolDefinitions(): readonly SketchToolDefinition[] {
  return sketchToolRegistry.getAll();
}

export function isRegisteredSketchToolId(
  toolId: string,
): toolId is SketchToolId {
  return sketchToolRegistry.has(toolId);
}
