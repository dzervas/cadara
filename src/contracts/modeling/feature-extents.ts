import type {
  ExtrudeEndCondition,
  ExtrudeFeatureExtent,
  ExtrudeFeatureParameters,
  RevolveEndCondition,
  RevolveFeatureExtent,
  RevolveFeatureParameters,
} from '@/contracts/modeling/schema'

export function getExtrudeFeatureExtent(parameters: ExtrudeFeatureParameters): ExtrudeFeatureExtent {
  if (parameters.extent) {
    return parameters.extent
  }

  if (parameters.endExtent) {
    return {
      mode: 'oneSide',
      end: {
        kind: 'blind',
        direction: parameters.endExtent.direction,
        distance: parameters.endExtent.distance,
      },
    }
  }

  throw new Error('Extrude parameters must include explicit extent controls.')
}

export function getRevolveFeatureExtent(parameters: RevolveFeatureParameters): RevolveFeatureExtent {
  if ('kind' in parameters.extent && parameters.extent.kind === 'angle') {
    return {
      mode: 'oneSide',
      end: {
        kind: 'blind',
        direction: parameters.extent.direction,
        angle: parameters.extent.radians,
      },
    }
  }

  return parameters.extent as RevolveFeatureExtent
}

export function getExtrudeExtentEnds(extent: ExtrudeFeatureExtent): readonly ExtrudeEndCondition[] {
  switch (extent.mode) {
    case 'oneSide':
    case 'symmetric':
      return [extent.end]
    case 'twoSide':
      return [extent.firstEnd, extent.secondEnd]
  }
}

export function getRevolveExtentEnds(extent: RevolveFeatureExtent): readonly RevolveEndCondition[] {
  switch (extent.mode) {
    case 'oneSide':
    case 'symmetric':
      return [extent.end]
    case 'twoSide':
      return [extent.firstEnd, extent.secondEnd]
  }
}
