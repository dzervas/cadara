import type {
  ReferenceImageCalibrationDiagnostic,
  ReferenceImageCalibrationSolveResult,
  ReferenceImageCalibrationSolvedAnchor,
  ReferenceImagePlacement,
} from '@/contracts/reference-image/schema'
import type { SketchPoint2D } from '@/contracts/sketch/schema'

import type { ReferenceImageCalibrationSolverInput } from '@/domain/reference-image-calibration/solver/contracts'

const EPSILON = 1e-6
const GRADIENT_STEP = 1e-4
const MAX_ITERATIONS = 120

export function solveReferenceImageCalibration(
  input: ReferenceImageCalibrationSolverInput,
): ReferenceImageCalibrationSolveResult {
  const diagnostics: ReferenceImageCalibrationDiagnostic[] = []
  const targets = input.anchors.filter((anchor) => anchor.worldPosition !== null)
  const anchorMap = new Map(input.anchors.map((anchor) => [anchor.anchorId, anchor] as const))
  const aspectRatio = input.image.pixelWidth / input.image.pixelHeight
  const initialPlacement = estimateInitialPlacement(input, targets, aspectRatio)

  if (targets.length === 0 && input.constraints.length === 0) {
    return {
      placement: input.initialPlacement,
      anchors: input.anchors.map((anchor) => ({
        anchorId: anchor.anchorId,
        worldPosition: mapAnchorToWorld(anchor.uv, input.initialPlacement),
      })),
      diagnostics,
    }
  }

  if (targets.length === 0) {
    diagnostics.push({
      code: 'missing-anchor-targets',
      severity: 'warning',
      message: 'Add at least one anchored calibration point to solve the reference image.',
    })
  }

  const initialVector = input.scaleMode === 'lockedAspect'
    ? placementToLockedAspectVector(initialPlacement, aspectRatio)
    : placementToIndependentVector(initialPlacement)
  const optimized = minimizeLoss(initialVector, (vector) =>
    evaluateLoss(vector, {
      ...input,
      initialPlacement,
    }, aspectRatio, anchorMap))
  const placement = input.scaleMode === 'lockedAspect'
    ? lockedAspectVectorToPlacement(optimized, aspectRatio)
    : independentVectorToPlacement(optimized)

  const solvedAnchors: ReferenceImageCalibrationSolvedAnchor[] = input.anchors.map((anchor) => ({
    anchorId: anchor.anchorId,
    worldPosition: mapAnchorToWorld(anchor.uv, placement),
  }))

  for (const constraint of input.constraints) {
    const first = solvedAnchors.find((anchor) => anchor.anchorId === constraint.firstAnchorId)?.worldPosition
    const second = solvedAnchors.find((anchor) => anchor.anchorId === constraint.secondAnchorId)?.worldPosition
    if (!first || !second) {
      diagnostics.push({
        code: 'missing-constraint-anchor',
        severity: 'warning',
        message: `Constraint ${constraint.label} references a missing calibration anchor.`,
      })
      continue
    }

    const delta = Math.abs(distanceBetween(first, second) - constraint.distance)
    if (delta > 1e-2) {
      diagnostics.push({
        code: 'unsatisfied-distance-constraint',
        severity: 'warning',
        message: `${constraint.label} is ${delta.toFixed(3)} units away from its target distance.`,
      })
    }
  }

  if (targets.length < 2) {
    diagnostics.push({
      code: 'underconstrained-calibration',
      severity: 'info',
      message: 'Reference-image calibration is underconstrained; add more anchored points for a stronger solve.',
    })
  }

  return {
    placement,
    anchors: solvedAnchors,
    diagnostics,
  }
}

function estimateInitialPlacement(
  input: ReferenceImageCalibrationSolverInput,
  targets: ReferenceImageCalibrationSolverInput['anchors'],
  aspectRatio: number,
): ReferenceImagePlacement {
  if (targets.length < 2) {
    return input.initialPlacement
  }

  const xTargets = targets.map((anchor) => anchor.worldPosition?.[0] ?? 0)
  const yTargets = targets.map((anchor) => anchor.worldPosition?.[1] ?? 0)
  const uValues = targets.map((anchor) => anchor.uv[0])
  const vValues = targets.map((anchor) => anchor.uv[1])
  const uSpan = Math.max(Math.max(...uValues) - Math.min(...uValues), EPSILON)
  const vSpan = Math.max(Math.max(...vValues) - Math.min(...vValues), EPSILON)
  const width = Math.max((Math.max(...xTargets) - Math.min(...xTargets)) / uSpan, EPSILON)
  const height = Math.max((Math.max(...yTargets) - Math.min(...yTargets)) / vSpan, EPSILON)

  if (input.scaleMode === 'lockedAspect') {
    const lockedHeight = Math.max(height, width / Math.max(aspectRatio, EPSILON))
    return {
      center: estimatePlacementCenter(targets, {
        center: input.initialPlacement.center,
        width: lockedHeight * aspectRatio,
        height: lockedHeight,
        rotationRadians: input.initialPlacement.rotationRadians,
      }),
      width: lockedHeight * aspectRatio,
      height: lockedHeight,
      rotationRadians: input.initialPlacement.rotationRadians,
    }
  }

  return {
    center: estimatePlacementCenter(targets, {
      center: input.initialPlacement.center,
      width,
      height,
      rotationRadians: input.initialPlacement.rotationRadians,
    }),
    width,
    height,
    rotationRadians: input.initialPlacement.rotationRadians,
  }
}

function estimatePlacementCenter(
  targets: ReferenceImageCalibrationSolverInput['anchors'],
  placement: ReferenceImagePlacement,
): SketchPoint2D {
  const cos = Math.cos(placement.rotationRadians)
  const sin = Math.sin(placement.rotationRadians)
  const estimatedCenters = targets.map((anchor) => {
    const localX = (anchor.uv[0] - 0.5) * placement.width
    const localY = (0.5 - anchor.uv[1]) * placement.height
    const rotatedX = localX * cos - localY * sin
    const rotatedY = localX * sin + localY * cos
    return [
      (anchor.worldPosition?.[0] ?? 0) - rotatedX,
      (anchor.worldPosition?.[1] ?? 0) - rotatedY,
    ] as SketchPoint2D
  })

  return [
    estimatedCenters.reduce((sum, center) => sum + center[0], 0) / estimatedCenters.length,
    estimatedCenters.reduce((sum, center) => sum + center[1], 0) / estimatedCenters.length,
  ]
}

function evaluateLoss(
  vector: number[],
  input: ReferenceImageCalibrationSolverInput,
  aspectRatio: number,
  anchorMap: ReadonlyMap<string, ReferenceImageCalibrationSolverInput['anchors'][number]>,
) {
  const placement = input.scaleMode === 'lockedAspect'
    ? lockedAspectVectorToPlacement(vector, aspectRatio)
    : independentVectorToPlacement(vector)
  let loss = 0

  for (const anchor of input.anchors) {
    const solved = mapAnchorToWorld(anchor.uv, placement)
    if (anchor.worldPosition) {
      const dx = solved[0] - anchor.worldPosition[0]
      const dy = solved[1] - anchor.worldPosition[1]
      loss += dx * dx + dy * dy
    }
  }

  for (const constraint of input.constraints) {
    const first = anchorMap.get(constraint.firstAnchorId)
    const second = anchorMap.get(constraint.secondAnchorId)
    if (!first || !second) {
      loss += 50
      continue
    }

    const firstPosition = mapAnchorToWorld(first.uv, placement)
    const secondPosition = mapAnchorToWorld(second.uv, placement)
    const distanceError = distanceBetween(firstPosition, secondPosition) - constraint.distance
    loss += distanceError * distanceError
  }

  const regularization = [
    placement.center[0] - input.initialPlacement.center[0],
    placement.center[1] - input.initialPlacement.center[1],
    placement.rotationRadians - input.initialPlacement.rotationRadians,
    placement.width - input.initialPlacement.width,
    placement.height - input.initialPlacement.height,
  ]
  loss += regularization.reduce((sum, value) => sum + value * value, 0) * 1e-4

  return loss
}

function minimizeLoss(initial: number[], evaluate: (vector: number[]) => number) {
  let current = [...initial]
  let bestLoss = evaluate(current)
  let learningRate = 0.2

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const gradient = current.map((value, index) => {
      const next = [...current]
      next[index] = value + GRADIENT_STEP
      return (evaluate(next) - bestLoss) / GRADIENT_STEP
    })

    const candidate = current.map((value, index) => value - gradient[index]! * learningRate)
    const candidateLoss = evaluate(candidate)
    if (candidateLoss + EPSILON < bestLoss) {
      current = candidate
      bestLoss = candidateLoss
      learningRate = Math.min(0.4, learningRate * 1.05)
      continue
    }

    learningRate *= 0.5
    if (learningRate < 1e-4) {
      break
    }
  }

  return current
}

function placementToLockedAspectVector(
  placement: ReferenceImagePlacement,
  aspectRatio: number,
) {
  const scale = Math.max(
    placement.width / Math.max(aspectRatio, EPSILON),
    placement.height,
    EPSILON,
  )
  return [
    placement.center[0],
    placement.center[1],
    placement.rotationRadians,
    Math.log(scale),
  ]
}

function lockedAspectVectorToPlacement(
  vector: readonly number[],
  aspectRatio: number,
): ReferenceImagePlacement {
  const scale = Math.exp(vector[3] ?? 0)
  return {
    center: [vector[0] ?? 0, vector[1] ?? 0],
    width: Math.max(aspectRatio * scale, EPSILON),
    height: Math.max(scale, EPSILON),
    rotationRadians: vector[2] ?? 0,
  }
}

function placementToIndependentVector(placement: ReferenceImagePlacement) {
  return [
    placement.center[0],
    placement.center[1],
    placement.rotationRadians,
    Math.log(Math.max(placement.width, EPSILON)),
    Math.log(Math.max(placement.height, EPSILON)),
  ]
}

function independentVectorToPlacement(vector: readonly number[]): ReferenceImagePlacement {
  return {
    center: [vector[0] ?? 0, vector[1] ?? 0],
    width: Math.max(Math.exp(vector[3] ?? 0), EPSILON),
    height: Math.max(Math.exp(vector[4] ?? 0), EPSILON),
    rotationRadians: vector[2] ?? 0,
  }
}

function mapAnchorToWorld(
  uv: SketchPoint2D,
  placement: ReferenceImagePlacement,
): SketchPoint2D {
  const localX = (uv[0] - 0.5) * placement.width
  const localY = (0.5 - uv[1]) * placement.height
  const cos = Math.cos(placement.rotationRadians)
  const sin = Math.sin(placement.rotationRadians)
  return [
    placement.center[0] + localX * cos - localY * sin,
    placement.center[1] + localX * sin + localY * cos,
  ]
}

function distanceBetween(first: SketchPoint2D, second: SketchPoint2D) {
  return Math.hypot(first[0] - second[0], first[1] - second[1])
}
