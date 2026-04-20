import type { SketchToolDefinition, SketchToolId } from '@/domain/sketch-tools/definition'
import {
  bezierCurveSketchToolDefinition,
  conicSketchToolDefinition,
  controlPointSplineSketchToolDefinition,
  ellipseSketchToolDefinition,
  ellipticalArcSketchToolDefinition,
  profileTextSketchToolDefinition,
} from '@/domain/sketch-tools/tools/advanced-curves'
import { alignedRectangleSketchToolDefinition } from '@/domain/sketch-tools/tools/aligned-rectangle'
import { circleSketchToolDefinition } from '@/domain/sketch-tools/tools/circle'
import { centerPointArcSketchToolDefinition } from '@/domain/sketch-tools/tools/center-point-arc'
import { centerPointRectangleSketchToolDefinition } from '@/domain/sketch-tools/tools/center-point-rectangle'
import { circumscribedPolygonSketchToolDefinition } from '@/domain/sketch-tools/tools/circumscribed-polygon'
import { inscribedPolygonSketchToolDefinition } from '@/domain/sketch-tools/tools/inscribed-polygon'
import { lineSketchToolDefinition } from '@/domain/sketch-tools/tools/line'
import { midpointLineSketchToolDefinition } from '@/domain/sketch-tools/tools/midpoint-line'
import { pointSketchToolDefinition } from '@/domain/sketch-tools/tools/point'
import { rectangleSketchToolDefinition } from '@/domain/sketch-tools/tools/rectangle'
import { splineSketchToolDefinition } from '@/domain/sketch-tools/tools/spline'
import { tangentArcSketchToolDefinition } from '@/domain/sketch-tools/tools/tangent-arc'
import { threePointArcSketchToolDefinition } from '@/domain/sketch-tools/tools/three-point-arc'
import { threePointCircleSketchToolDefinition } from '@/domain/sketch-tools/tools/three-point-circle'

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
] as const satisfies readonly SketchToolDefinition[]

const sketchToolMap = new Map<SketchToolId, SketchToolDefinition>(
  sketchToolDefinitions.map((definition) => [definition.metadata.id, definition]),
)

export function getSketchToolDefinition(toolId: SketchToolId): SketchToolDefinition {
  const definition = sketchToolMap.get(toolId)

  if (!definition) {
    throw new Error(`Sketch tool ${toolId} is not registered.`)
  }

  return definition
}

export function getRegisteredSketchToolDefinitions(): readonly SketchToolDefinition[] {
  return sketchToolDefinitions
}

export function isRegisteredSketchToolId(toolId: string): toolId is SketchToolId {
  return sketchToolMap.has(toolId as SketchToolId)
}
