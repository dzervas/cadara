export type SketchPointLike = readonly [number, number]

export function distanceBetween(left: SketchPointLike, right: SketchPointLike) {
  return Math.hypot(right[0] - left[0], right[1] - left[1])
}

export function midpoint(left: SketchPointLike, right: SketchPointLike): SketchPointLike {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2]
}
