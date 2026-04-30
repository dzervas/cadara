import type {
  SketchPoint,
} from '@/contracts/modeling/schema'
import type {
  SketchDefinition,
  SketchPointDefinition,
} from '@/contracts/sketch/schema'
import {
  evaluateSketchDerivations,
} from '@/contracts/sketch/derived-geometry'
import type {
  SketchToolAnchorDescriptor,
} from '@/core/sketch-tools/editor-schema'

export function addAnchorOffset(
  anchor: SketchToolAnchorDescriptor,
  offset: { x: number; y: number },
): SketchToolAnchorDescriptor {
  const currentOffset = anchor.offset ?? { x: 0, y: 0 }

  return {
    ...anchor,
    offset: {
      x: currentOffset.x + offset.x,
      y: currentOffset.y + offset.y,
    },
  }
}

export function applyPointPositionsToDefinition(
  definition: SketchDefinition,
  positions: readonly Pick<SketchPointDefinition, 'pointId' | 'position'>[],
): SketchDefinition {
  const positionMap = new Map(positions.map((point) => [point.pointId, point.position]))

  if (positionMap.size === 0) {
    return definition
  }

  const nextDefinition = {
    ...definition,
    points: definition.points.map((point) => {
      const position = positionMap.get(point.pointId)
      return position ? { ...point, position } : point
    }),
  }

  return evaluateSketchDerivations(nextDefinition).definition
}

export function getSketchDatumGuideExtent(
  definition: SketchDefinition,
  projectedReferences: readonly import('@/contracts/solver/schema').ProjectedSketchReferenceRecord[],
) {
  const localCoordinates = definition.points.flatMap((point: SketchPointDefinition) => [Math.abs(point.position[0]), Math.abs(point.position[1])])
  const projectedCoordinates = projectedReferences.flatMap((reference) => reference.geometry.flatMap((geometry) => {
    switch (geometry.kind) {
      case 'point':
        return [Math.abs(geometry.position[0]), Math.abs(geometry.position[1])]
      case 'lineSegment':
        return [
          Math.abs(geometry.startPosition[0]),
          Math.abs(geometry.startPosition[1]),
          Math.abs(geometry.endPosition[0]),
          Math.abs(geometry.endPosition[1]),
        ]
      case 'circle':
        return [
          Math.abs(geometry.centerPosition[0]) + geometry.radius,
          Math.abs(geometry.centerPosition[1]) + geometry.radius,
        ]
      case 'arc': {
        const radius = Math.hypot(
          geometry.startPosition[0] - geometry.centerPosition[0],
          geometry.startPosition[1] - geometry.centerPosition[1],
        )
        return [
          Math.abs(geometry.centerPosition[0]) + radius,
          Math.abs(geometry.centerPosition[1]) + radius,
        ]
      }
      case 'spline':
        return geometry.fitPoints.flatMap((point: SketchPoint) => [Math.abs(point[0]), Math.abs(point[1])])
    }
  }))
  const maxCoordinate = Math.max(0, ...localCoordinates, ...projectedCoordinates)
  return Math.max(10, maxCoordinate * 1.35 || 10)
}
