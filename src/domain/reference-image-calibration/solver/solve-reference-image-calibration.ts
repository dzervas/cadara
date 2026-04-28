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
const MAX_ITERATIONS = 160
const ANCHOR_RESIDUAL_TOLERANCE = 1e-2
const CONSTRAINT_RESIDUAL_TOLERANCE = 1e-2
const DEGENERATE_DIMENSION_THRESHOLD = 1e-4
const NUMERICAL_RANK_TOLERANCE = 1e-5

export function solveReferenceImageCalibration(
  input: ReferenceImageCalibrationSolverInput,
): ReferenceImageCalibrationSolveResult {
  const diagnostics: ReferenceImageCalibrationDiagnostic[] = []
  const targets = input.anchors.filter((anchor) => anchor.worldPosition !== null)
  const anchorMap = new Map(input.anchors.map((anchor) => [anchor.anchorId, anchor] as const))
  const aspectRatio = input.image.pixelWidth / input.image.pixelHeight

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

  const placement = stabilizePlacement(
    findBestPlacement(input, targets, aspectRatio, anchorMap),
    input,
    targets,
  )
  const solvedAnchors: ReferenceImageCalibrationSolvedAnchor[] = input.anchors.map((anchor) => ({
    anchorId: anchor.anchorId,
    worldPosition: mapAnchorToWorld(anchor.uv, placement),
  }))

  if (hasDegeneratePlacement(placement)) {
    diagnostics.push({
      code: 'degenerate-calibration',
      severity: 'warning',
      message: 'Reference-image calibration collapsed to an invalid size; add stronger anchors or relax conflicting constraints.',
    })
  }

  const underconstrainedMessage = getUnderconstrainedCalibrationMessage(input, placement, aspectRatio, anchorMap)
  if (underconstrainedMessage) {
    diagnostics.push({
      code: 'underconstrained-calibration',
      severity: 'info',
      message: underconstrainedMessage,
    })
  }

  for (const anchor of input.anchors) {
    if (!anchor.worldPosition) {
      continue
    }

    const solved = solvedAnchors.find((candidate) => candidate.anchorId === anchor.anchorId)?.worldPosition
    if (!solved) {
      continue
    }

    const delta = distanceBetween(solved, anchor.worldPosition)
    if (delta > ANCHOR_RESIDUAL_TOLERANCE) {
      diagnostics.push({
        code: 'unsatisfied-anchor-target',
        severity: 'warning',
        message: `${anchor.label} is ${delta.toFixed(3)} units away from its target position.`,
      })
    }
  }

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
    if (delta > CONSTRAINT_RESIDUAL_TOLERANCE) {
      diagnostics.push({
        code: 'unsatisfied-distance-constraint',
        severity: 'warning',
        message: `${constraint.label} is ${delta.toFixed(3)} units away from its target distance.`,
      })
    }
  }

  return {
    placement,
    anchors: solvedAnchors,
    diagnostics,
  }
}

function findBestPlacement(
  input: ReferenceImageCalibrationSolverInput,
  targets: ReferenceImageCalibrationSolverInput['anchors'],
  aspectRatio: number,
  anchorMap: ReadonlyMap<string, ReferenceImageCalibrationSolverInput['anchors'][number]>,
) {
  const candidates = buildInitialPlacementCandidates(input, targets, aspectRatio)
  let bestPlacement = input.initialPlacement
  let bestLoss = Number.POSITIVE_INFINITY

  for (const initialPlacement of candidates) {
    const initialVector = input.scaleMode === 'lockedAspect'
      ? placementToLockedAspectVector(initialPlacement, aspectRatio)
      : placementToIndependentVector(initialPlacement)
    const optimizedVector = minimizeLoss(initialVector, (vector) =>
      evaluateLoss(vector, {
        ...input,
        initialPlacement,
      }, aspectRatio, anchorMap))
    const placement = input.scaleMode === 'lockedAspect'
      ? lockedAspectVectorToPlacement(optimizedVector, aspectRatio)
      : independentVectorToPlacement(optimizedVector)
    const loss = evaluateLoss(optimizedVector, {
      ...input,
      initialPlacement,
    }, aspectRatio, anchorMap)

    if (loss < bestLoss) {
      bestPlacement = placement
      bestLoss = loss
    }
  }

  return bestPlacement
}

function buildInitialPlacementCandidates(
  input: ReferenceImageCalibrationSolverInput,
  targets: ReferenceImageCalibrationSolverInput['anchors'],
  aspectRatio: number,
) {
  const candidates = [input.initialPlacement]
  if (targets.length < 2) {
    return candidates
  }

  candidates.push(estimateAxisAlignedPlacement(input, targets, aspectRatio))

  const leastSquaresPlacement = estimateLeastSquaresPlacement(input, targets, aspectRatio)
  if (leastSquaresPlacement) {
    candidates.push(leastSquaresPlacement)
  }

  if (input.scaleMode === 'lockedAspect') {
    const pairwisePlacement = estimateLockedAspectPairPlacement(targets, aspectRatio)
    if (pairwisePlacement) {
      candidates.push(pairwisePlacement)
    }
  }

  return candidates
}

function estimateAxisAlignedPlacement(
  input: ReferenceImageCalibrationSolverInput,
  targets: ReferenceImageCalibrationSolverInput['anchors'],
  aspectRatio: number,
): ReferenceImagePlacement {
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

function estimateLeastSquaresPlacement(
  input: ReferenceImageCalibrationSolverInput,
  targets: ReferenceImageCalibrationSolverInput['anchors'],
  aspectRatio: number,
): ReferenceImagePlacement | null {
  const coefficients = solveLeastSquaresSystem(targets.map((anchor) => ({
    uv: anchor.uv,
    worldPosition: anchor.worldPosition!,
  })))
  if (!coefficients) {
    return null
  }

  const { centerX, centerY, xAxisX, xAxisY, yAxisX, yAxisY } = coefficients
  const width = Math.hypot(xAxisX, xAxisY)
  const height = Math.hypot(yAxisX, yAxisY)
  if (width <= EPSILON || height <= EPSILON) {
    return null
  }

  const rotationRadians = averageAngles([
    Math.atan2(xAxisY, xAxisX),
    Math.atan2(-yAxisX, yAxisY),
  ])

  if (input.scaleMode === 'lockedAspect') {
    const scale = Math.max((width / Math.max(aspectRatio, EPSILON) + height) * 0.5, EPSILON)
    return {
      center: [centerX, centerY],
      width: scale * aspectRatio,
      height: scale,
      rotationRadians,
    }
  }

  return {
    center: [centerX, centerY],
    width,
    height,
    rotationRadians,
  }
}

function estimateLockedAspectPairPlacement(
  targets: ReferenceImageCalibrationSolverInput['anchors'],
  aspectRatio: number,
): ReferenceImagePlacement | null {
  let bestPair: [ReferenceImageCalibrationSolverInput['anchors'][number], ReferenceImageCalibrationSolverInput['anchors'][number]] | null = null
  let bestSpan = 0

  for (let firstIndex = 0; firstIndex < targets.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < targets.length; secondIndex += 1) {
      const first = targets[firstIndex]
      const second = targets[secondIndex]
      if (!first?.worldPosition || !second?.worldPosition) {
        continue
      }

      const sourceDelta = [
        (second.uv[0] - first.uv[0]) * aspectRatio,
        first.uv[1] - second.uv[1],
      ] as SketchPoint2D
      const span = Math.hypot(sourceDelta[0], sourceDelta[1])
      if (span > bestSpan) {
        bestPair = [first, second]
        bestSpan = span
      }
    }
  }

  if (!bestPair || bestSpan <= EPSILON) {
    return null
  }

  const [first, second] = bestPair
  const worldDelta = [
    second.worldPosition![0] - first.worldPosition![0],
    second.worldPosition![1] - first.worldPosition![1],
  ] as SketchPoint2D
  const worldLength = Math.hypot(worldDelta[0], worldDelta[1])
  if (worldLength <= EPSILON) {
    return null
  }

  const rotationRadians = normalizeAngle(
    Math.atan2(worldDelta[1], worldDelta[0]) - Math.atan2(first.uv[1] - second.uv[1], (second.uv[0] - first.uv[0]) * aspectRatio),
  )
  const scale = worldLength / bestSpan
  const placement = {
    center: [0, 0] as SketchPoint2D,
    width: scale * aspectRatio,
    height: scale,
    rotationRadians,
  }

  return {
    ...placement,
    center: estimatePlacementCenter(targets, placement),
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
    shortestAngleDifference(placement.rotationRadians, input.initialPlacement.rotationRadians),
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
    rotationRadians: normalizeAngle(vector[2] ?? 0),
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
    rotationRadians: normalizeAngle(vector[2] ?? 0),
  }
}

function getUnderconstrainedCalibrationMessage(
  input: ReferenceImageCalibrationSolverInput,
  placement: ReferenceImagePlacement,
  aspectRatio: number,
  anchorMap: ReadonlyMap<string, ReferenceImageCalibrationSolverInput['anchors'][number]>,
) {
  const parameterCount = input.scaleMode === 'lockedAspect' ? 4 : 5
  const residualCount = input.anchors.filter((anchor) => anchor.worldPosition !== null).length * 2
    + input.constraints.filter((constraint) =>
      anchorMap.has(constraint.firstAnchorId) && anchorMap.has(constraint.secondAnchorId)
    ).length
  if (residualCount === 0) {
    return 'Reference-image calibration is underconstrained; add anchored points or distance constraints before solving.'
  }

  const vector = input.scaleMode === 'lockedAspect'
    ? placementToLockedAspectVector(placement, aspectRatio)
    : placementToIndependentVector(placement)
  const columns = vector.map((value, index) => {
    const next = [...vector]
    const previous = [...vector]
    const step = Math.max(Math.abs(value), 1) * GRADIENT_STEP
    next[index] = value + step
    previous[index] = value - step
    const nextPlacement = input.scaleMode === 'lockedAspect'
      ? lockedAspectVectorToPlacement(next, aspectRatio)
      : independentVectorToPlacement(next)
    const previousPlacement = input.scaleMode === 'lockedAspect'
      ? lockedAspectVectorToPlacement(previous, aspectRatio)
      : independentVectorToPlacement(previous)
    const nextResiduals = buildResidualVector(input, nextPlacement, anchorMap)
    const previousResiduals = buildResidualVector(input, previousPlacement, anchorMap)
    return nextResiduals.map((nextValue, residualIndex) =>
      (nextValue - (previousResiduals[residualIndex] ?? 0)) / (2 * step)
    )
  })

  if (estimateColumnRank(columns) >= parameterCount) {
    return null
  }

  if (input.scaleMode === 'independent') {
    const uValues = input.anchors
      .filter((anchor) => anchor.worldPosition !== null)
      .map((anchor) => anchor.uv[0])
    const vValues = input.anchors
      .filter((anchor) => anchor.worldPosition !== null)
      .map((anchor) => anchor.uv[1])
    const spansU = uValues.length > 1 && Math.max(...uValues) - Math.min(...uValues) > EPSILON
    const spansV = vValues.length > 1 && Math.max(...vValues) - Math.min(...vValues) > EPSILON
    if (!spansU || !spansV) {
      return 'Independent X/Y calibration is underconstrained; anchored targets need to span both image axes.'
    }
  }

  return 'Reference-image calibration is underconstrained; add more anchored points or distance constraints for a stronger solve.'
}

function buildResidualVector(
  input: ReferenceImageCalibrationSolverInput,
  placement: ReferenceImagePlacement,
  anchorMap: ReadonlyMap<string, ReferenceImageCalibrationSolverInput['anchors'][number]>,
) {
  const residuals: number[] = []

  for (const anchor of input.anchors) {
    if (!anchor.worldPosition) {
      continue
    }

    const solved = mapAnchorToWorld(anchor.uv, placement)
    residuals.push(solved[0] - anchor.worldPosition[0], solved[1] - anchor.worldPosition[1])
  }

  for (const constraint of input.constraints) {
    const first = anchorMap.get(constraint.firstAnchorId)
    const second = anchorMap.get(constraint.secondAnchorId)
    if (!first || !second) {
      continue
    }

    const firstPosition = mapAnchorToWorld(first.uv, placement)
    const secondPosition = mapAnchorToWorld(second.uv, placement)
    residuals.push(distanceBetween(firstPosition, secondPosition) - constraint.distance)
  }

  return residuals
}

function estimateColumnRank(columns: readonly number[][]) {
  const basis: number[][] = []

  for (const column of columns) {
    const orthogonalized = [...column]
    for (const basisVector of basis) {
      const projection = dot(orthogonalized, basisVector)
      for (let index = 0; index < orthogonalized.length; index += 1) {
        orthogonalized[index] = (orthogonalized[index] ?? 0) - projection * (basisVector[index] ?? 0)
      }
    }

    const norm = Math.hypot(...orthogonalized)
    if (norm <= NUMERICAL_RANK_TOLERANCE) {
      continue
    }

    basis.push(orthogonalized.map((value) => value / norm))
  }

  return basis.length
}

function hasDegeneratePlacement(placement: ReferenceImagePlacement) {
  return !Number.isFinite(placement.width)
    || !Number.isFinite(placement.height)
    || !Number.isFinite(placement.rotationRadians)
    || placement.width <= DEGENERATE_DIMENSION_THRESHOLD
    || placement.height <= DEGENERATE_DIMENSION_THRESHOLD
}

function stabilizePlacement(
  placement: ReferenceImagePlacement,
  input: ReferenceImageCalibrationSolverInput,
  targets: ReferenceImageCalibrationSolverInput['anchors'],
) {
  let changed = false
  let stabilized = placement

  if (placement.width <= DEGENERATE_DIMENSION_THRESHOLD || !Number.isFinite(placement.width)) {
    stabilized = {
      ...stabilized,
      width: input.initialPlacement.width,
    }
    changed = true
  }

  if (placement.height <= DEGENERATE_DIMENSION_THRESHOLD || !Number.isFinite(placement.height)) {
    stabilized = {
      ...stabilized,
      height: input.initialPlacement.height,
    }
    changed = true
  }

  if (!Number.isFinite(placement.rotationRadians)) {
    stabilized = {
      ...stabilized,
      rotationRadians: input.initialPlacement.rotationRadians,
    }
    changed = true
  }

  return changed
    ? {
        ...stabilized,
        center: targets.length > 0 ? estimatePlacementCenter(targets, stabilized) : stabilized.center,
      }
    : stabilized
}

function solveLeastSquaresSystem(
  targets: ReadonlyArray<{ uv: SketchPoint2D, worldPosition: SketchPoint2D }>,
) {
  const normal = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const rightX = [0, 0, 0]
  const rightY = [0, 0, 0]

  for (const target of targets) {
    const row = [1, target.uv[0] - 0.5, 0.5 - target.uv[1]]
    for (let rowIndex = 0; rowIndex < row.length; rowIndex += 1) {
      rightX[rowIndex] = (rightX[rowIndex] ?? 0) + row[rowIndex]! * target.worldPosition[0]
      rightY[rowIndex] = (rightY[rowIndex] ?? 0) + row[rowIndex]! * target.worldPosition[1]
      for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
        normal[rowIndex]![columnIndex] = (normal[rowIndex]![columnIndex] ?? 0) + row[rowIndex]! * row[columnIndex]!
      }
    }
  }

  const x = solveLinearSystem(normal, rightX)
  const y = solveLinearSystem(normal, rightY)
  if (!x || !y) {
    return null
  }

  return {
    centerX: x[0],
    centerY: y[0],
    xAxisX: x[1],
    xAxisY: y[1],
    yAxisX: x[2],
    yAxisY: y[2],
  }
}

function solveLinearSystem(matrix: ReadonlyArray<ReadonlyArray<number>>, vector: ReadonlyArray<number>) {
  const augmented = matrix.map((row, rowIndex) => [...row, vector[rowIndex] ?? 0])

  for (let pivotIndex = 0; pivotIndex < augmented.length; pivotIndex += 1) {
    let bestRowIndex = pivotIndex
    let bestMagnitude = Math.abs(augmented[pivotIndex]?.[pivotIndex] ?? 0)
    for (let rowIndex = pivotIndex + 1; rowIndex < augmented.length; rowIndex += 1) {
      const magnitude = Math.abs(augmented[rowIndex]?.[pivotIndex] ?? 0)
      if (magnitude > bestMagnitude) {
        bestMagnitude = magnitude
        bestRowIndex = rowIndex
      }
    }

    if (bestMagnitude <= EPSILON) {
      return null
    }

    if (bestRowIndex !== pivotIndex) {
      const current = augmented[pivotIndex]
      augmented[pivotIndex] = augmented[bestRowIndex]!
      augmented[bestRowIndex] = current!
    }

    const pivot = augmented[pivotIndex]![pivotIndex]!
    for (let columnIndex = pivotIndex; columnIndex < augmented[pivotIndex]!.length; columnIndex += 1) {
      augmented[pivotIndex]![columnIndex] = augmented[pivotIndex]![columnIndex]! / pivot
    }

    for (let rowIndex = 0; rowIndex < augmented.length; rowIndex += 1) {
      if (rowIndex === pivotIndex) {
        continue
      }

      const factor = augmented[rowIndex]![pivotIndex]!
      if (Math.abs(factor) <= EPSILON) {
        continue
      }

      for (let columnIndex = pivotIndex; columnIndex < augmented[rowIndex]!.length; columnIndex += 1) {
        augmented[rowIndex]![columnIndex] -= factor * augmented[pivotIndex]![columnIndex]!
      }
    }
  }

  return augmented.map((row) => row[row.length - 1] ?? 0)
}

function averageAngles(angles: readonly number[]) {
  const vector = angles.reduce((sum, angle) => [
    sum[0] + Math.cos(angle),
    sum[1] + Math.sin(angle),
  ] as SketchPoint2D, [0, 0] as SketchPoint2D)

  return normalizeAngle(Math.atan2(vector[1], vector[0]))
}

function shortestAngleDifference(first: number, second: number) {
  return normalizeAngle(first - second)
}

function normalizeAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
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

function dot(first: readonly number[], second: readonly number[]) {
  return first.reduce((sum, value, index) => sum + value * (second[index] ?? 0), 0)
}
