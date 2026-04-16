import type {
  RegionLoopRecord,
  RegionRecord,
  SketchDefinition,
  SketchPoint2D,
  SketchSolveDiagnostic,
  SolvedSketchEntityGeometryRecord,
  SolvedSketchSnapshot,
} from '@/contracts/sketch/schema'
import type { OwnershipRecord } from '@/contracts/shared/diagnostics'
import type {
  DocumentId,
  RegionId,
  RegionLoopId,
  RevisionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'

export interface SketchRegionExtractionInput {
  documentId: DocumentId
  revisionId: RevisionId
  sketchId: SketchId
  solvedSnapshot: SolvedSketchSnapshot
  definition: SketchDefinition
}

export interface SketchRegionExtractionResult {
  regions: RegionRecord[]
  diagnostics: SketchSolveDiagnostic[]
}

export interface SketchRingCandidate {
  kind: 'segments'
  boundaryEntityIds: SketchEntityId[]
  boundaryPointIds: SketchPointId[]
  points: SketchPoint2D[]
  signedArea: number
}

type SegmentRecord = {
  entityId: SketchEntityId
  startPointId: SketchPointId | null
  endPointId: SketchPointId | null
  start: SketchPoint2D
  end: SketchPoint2D
  startAngle: number
  endAngle: number
}

const CIRCLE_REGION_SAMPLE_COUNT = 64

function makeDiagnostic(
  code: string,
  severity: SketchSolveDiagnostic['severity'],
  message: string,
  target: SketchSolveDiagnostic['target'],
): SketchSolveDiagnostic {
  return { code, severity, message, target }
}

function pointKey(point: SketchPoint2D) {
  return `${point[0].toFixed(9)},${point[1].toFixed(9)}`
}

function equalsPoint(left: SketchPoint2D, right: SketchPoint2D) {
  return pointKey(left) === pointKey(right)
}

function angleDifference(a0: number, a1: number) {
  const tau = Math.PI * 2
  let left = a0 % tau
  let right = a1 % tau

  if (left < 0) {
    left += tau
  }
  if (right < 0) {
    right += tau
  }

  let diff = right - left
  if (diff > tau) {
    diff -= tau
  }
  if (diff < 0) {
    diff += tau
  }

  return diff
}

function signedArea(points: SketchPoint2D[]) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!
    const end = points[(index + 1) % points.length]!
    area += start[0] * end[1] - end[0] * start[1]
  }
  return area / 2
}

function pointInPolygon(point: SketchPoint2D, polygon: SketchPoint2D[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i]![0]
    const yi = polygon[i]![1]
    const xj = polygon[j]![0]
    const yj = polygon[j]![1]
    const intersects = (yi > point[1]) !== (yj > point[1])
      && point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || Number.EPSILON) + xi
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

function centroid(points: SketchPoint2D[]): SketchPoint2D {
  let x = 0
  let y = 0
  for (const point of points) {
    x += point[0]
    y += point[1]
  }
  return [x / points.length, y / points.length]
}

function reverseSegment(segment: SegmentRecord): SegmentRecord {
  return {
    entityId: segment.entityId,
    startPointId: segment.endPointId,
    endPointId: segment.startPointId,
    start: segment.end,
    end: segment.start,
    startAngle: (segment.endAngle + Math.PI) % (Math.PI * 2),
    endAngle: (segment.startAngle + Math.PI) % (Math.PI * 2),
  }
}

function equalsOrReverseEquals(left: SegmentRecord, right: SegmentRecord) {
  return (
    left.entityId === right.entityId
    && ((equalsPoint(left.start, right.start) && equalsPoint(left.end, right.end))
      || (equalsPoint(left.start, right.end) && equalsPoint(left.end, right.start)))
  )
}

function continues(next: SegmentRecord, prior: SegmentRecord) {
  return equalsPoint(prior.end, next.start)
}

function cross(
  a: SketchPoint2D,
  b: SketchPoint2D,
  c: SketchPoint2D,
) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function buildSegments(
  definition: SketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
) {
  const solvedLineMap = new Map(
    solvedSnapshot.solvedEntities
      .filter((entity): entity is Extract<SolvedSketchEntityGeometryRecord, { kind: 'lineSegment' }> => entity.kind === 'lineSegment')
      .map((entity) => [entity.entityId, entity]),
  )
  const solvedArcMap = new Map(
    solvedSnapshot.solvedEntities
      .filter((entity): entity is Extract<SolvedSketchEntityGeometryRecord, { kind: 'arc' }> => entity.kind === 'arc')
      .map((entity) => [entity.entityId, entity]),
  )

  return definition.entities.flatMap((entity) => {
    if (entity.isConstruction) {
      return []
    }

    if (entity.kind === 'lineSegment') {
      const solved = solvedLineMap.get(entity.entityId)
      if (!solved) {
        return []
      }
      return [{
        entityId: entity.entityId,
        startPointId: entity.startPointId,
        endPointId: entity.endPointId,
        start: solved.startPosition,
        end: solved.endPosition,
        startAngle: Math.atan2(
          solved.endPosition[1] - solved.startPosition[1],
          solved.endPosition[0] - solved.startPosition[0],
        ),
        endAngle: Math.atan2(
          solved.endPosition[1] - solved.startPosition[1],
          solved.endPosition[0] - solved.startPosition[0],
        ),
      } satisfies SegmentRecord]
    }

    if (entity.kind === 'arc') {
      const solved = solvedArcMap.get(entity.entityId)
      if (!solved) {
        return []
      }

      return [{
        entityId: entity.entityId,
        startPointId: entity.startPointId,
        endPointId: entity.endPointId,
        start: solved.startPosition,
        end: solved.endPosition,
        startAngle: Math.atan2(
          solved.startPosition[1] - solved.centerPosition[1],
          solved.startPosition[0] - solved.centerPosition[0],
        ),
        endAngle: Math.atan2(
          solved.endPosition[1] - solved.centerPosition[1],
          solved.endPosition[0] - solved.centerPosition[0],
        ),
      } satisfies SegmentRecord]
    }

    return []
  })
}

function buildCircleRings(
  definition: SketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
) {
  const solvedCircleMap = new Map(
    solvedSnapshot.solvedEntities
      .filter((entity): entity is Extract<SolvedSketchEntityGeometryRecord, { kind: 'circle' }> => entity.kind === 'circle')
      .map((entity) => [entity.entityId, entity]),
  )

  return definition.entities.flatMap((entity) => {
    if (entity.kind !== 'circle' || entity.isConstruction) {
      return []
    }

    const solved = solvedCircleMap.get(entity.entityId)
    if (!solved) {
      return []
    }

    const points = Array.from({ length: CIRCLE_REGION_SAMPLE_COUNT }, (_, index) => {
      const angle = (Math.PI * 2 * index) / CIRCLE_REGION_SAMPLE_COUNT
      return [
        solved.centerPosition[0] + Math.cos(angle) * solved.solvedRadius,
        solved.centerPosition[1] + Math.sin(angle) * solved.solvedRadius,
      ] satisfies SketchPoint2D
    })

    return [{
      kind: 'segments' as const,
      boundaryEntityIds: [entity.entityId],
      boundaryPointIds: [],
      points,
      signedArea: signedArea(points),
    } satisfies SketchRingCandidate]
  })
}

function findNextSegment(
  segments: SegmentRecord[],
  current: SegmentRecord,
  used: Set<number>,
): [number, SegmentRecord] | null {
  let best: [number, SegmentRecord] | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const [index, candidate] of segments.entries()) {
    if (used.has(index)) {
      continue
    }
    if (!continues(candidate, current) || equalsOrReverseEquals(candidate, current)) {
      continue
    }
    const turn = cross(current.start, current.end, candidate.end)
    const diff = angleDifference(current.endAngle, candidate.startAngle)
    const score = turn * 1e6 + diff
    if (score > bestScore) {
      best = [index, candidate]
      bestScore = score
    }
  }

  return best
}

export function findSketchRings(
  definition: SketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
): { rings: SketchRingCandidate[]; unusedSegments: SegmentRecord[] } {
  const initialSegments = buildSegments(definition, solvedSnapshot)
  const allSegments = [...initialSegments, ...initialSegments.map(reverseSegment)]

  const used = new Set<number>()
  const rings: SketchRingCandidate[] = buildCircleRings(definition, solvedSnapshot)

  for (const [segmentIndex, segment] of allSegments.entries()) {
    if (used.has(segmentIndex)) {
      continue
    }

    const ringIndices: Array<[number, SegmentRecord]> = []
    const startPoint = segment.start
    let nextIndex = segmentIndex
    let nextSegment = segment

    for (let count = 1; count < allSegments.length; count += 1) {
      ringIndices.push([nextIndex, nextSegment])

      if (equalsPoint(nextSegment.end, startPoint)) {
        usedForRing(used, ringIndices)
        const ringSegments = ringIndices.map((entry) => entry[1])
        const points = ringSegments.map((entry) => entry.start)
        const area = signedArea(points)
        if (area > 0) {
          rings.push({
            kind: 'segments',
            boundaryEntityIds: ringSegments.map((entry) => entry.entityId),
            boundaryPointIds: ringSegments.flatMap((entry) => entry.startPointId ? [entry.startPointId] : []),
            points,
            signedArea: area,
          })
        }
        break
      }

      const found = findNextSegment(allSegments, nextSegment, used)
      if (!found) {
        break
      }
      ;[nextIndex, nextSegment] = found
    }
  }

  rings.sort(compareRingsByAreaThenKey)
  const unusedSegments = initialSegments.filter((_, index) => !used.has(index))
  return { rings, unusedSegments }
}

function compareRingsByAreaThenKey(left: SketchRingCandidate, right: SketchRingCandidate) {
  const areaDelta = Math.abs(right.signedArea) - Math.abs(left.signedArea)

  if (areaDelta !== 0) {
    return areaDelta
  }

  return getRingStableKey(left).localeCompare(getRingStableKey(right))
}

function getRingStableKey(ring: SketchRingCandidate) {
  return ring.boundaryEntityIds.join('|')
}

function usedForRing(used: Set<number>, ringIndices: Array<[number, SegmentRecord]>) {
  for (const [index] of ringIndices) {
    used.add(index)
  }
}

function createRegionId(sketchId: SketchId, ordinal: number): RegionId {
  const suffix = sketchId.startsWith('sketch_') ? sketchId.slice('sketch_'.length) : sketchId
  return (ordinal === 0 ? `region_${suffix}-outer` : `region_${suffix}-loop-${ordinal + 1}`) as RegionId
}

function createRegionLoopId(regionId: RegionId, ordinal: number): RegionLoopId {
  return `region_loop_${regionId}_${ordinal}` as RegionLoopId
}

function createOwnershipRecord(
  input: Pick<SketchRegionExtractionInput, 'documentId' | 'revisionId' | 'sketchId'>,
): OwnershipRecord {
  return {
    ownerDocumentId: input.documentId,
    ownerRevisionId: input.revisionId,
    ownerFeatureId: null,
    ownerSketchId: input.sketchId,
    ownerBodyId: null,
  }
}

export function deriveSketchRegionsCore(
  input: SketchRegionExtractionInput,
): SketchRegionExtractionResult {
  if (input.solvedSnapshot.status.solveState === 'failed' || input.solvedSnapshot.status.solveState === 'notEvaluated') {
    return {
      regions: [],
      diagnostics: [
        makeDiagnostic(
          'regions-unavailable',
          'warning',
          'Closed regions are unavailable until the sketch reaches a usable solved state.',
          null,
        ),
      ],
    }
  }

  const { rings } = findSketchRings(input.definition, input.solvedSnapshot)
  const sorted = [...rings].sort(compareRingsByAreaThenKey)
  const childrenByParent = new Map<number, number[]>()
  const parentByRing = new Map<number, number | null>()

  for (let childIndex = 0; childIndex < sorted.length; childIndex += 1) {
    const child = sorted[childIndex]!
    const marker = centroid(child.points)
    let parent: number | null = null
    let parentArea = Number.POSITIVE_INFINITY

    for (let parentIndex = 0; parentIndex < sorted.length; parentIndex += 1) {
      if (parentIndex === childIndex) {
        continue
      }
      const candidate = sorted[parentIndex]!
      const candidateArea = Math.abs(candidate.signedArea)
      if (candidateArea <= Math.abs(child.signedArea) || candidateArea >= parentArea) {
        continue
      }
      if (pointInPolygon(marker, candidate.points)) {
        parent = parentIndex
        parentArea = candidateArea
      }
    }

    parentByRing.set(childIndex, parent)
    if (parent !== null) {
      const children = childrenByParent.get(parent) ?? []
      children.push(childIndex)
      childrenByParent.set(parent, children)
    }
  }

  const regions = sorted.map((ring, index) => {
    const regionId = createRegionId(input.sketchId, index)
    const outerLoop = createLoopRecord(regionId, 0, 'outer', ring, false)

    const innerLoops = (childrenByParent.get(index) ?? []).map((childIndex, loopOrdinal) => {
      const child = sorted[childIndex]!
      return createLoopRecord(regionId, loopOrdinal + 1, 'inner', child, true)
    })

    return {
      ...createOwnershipRecord(input),
      regionId,
      label: index === 0 ? 'Outer region' : `Loop region ${index + 1}`,
      target: { kind: 'region', sketchId: input.sketchId, regionId },
      sourceSketch: { kind: 'sketch', sketchId: input.sketchId },
      loops: [outerLoop, ...innerLoops],
      isClosed: true,
    } satisfies RegionRecord
  })

  return {
    regions,
    diagnostics: [],
  }
}

function createLoopRecord(
  regionId: RegionId,
  ordinal: number,
  role: RegionLoopRecord['role'],
  ring: SketchRingCandidate,
  reverse: boolean,
): RegionLoopRecord {
  if (!reverse) {
    return {
      loopId: createRegionLoopId(regionId, ordinal),
      role,
      orientation: ring.signedArea >= 0 ? 'counterClockwise' : 'clockwise',
      segments: ring.boundaryEntityIds.map((entityId, segmentIndex) => ({
        source: { kind: 'entity', entityId },
        startPointId: ring.boundaryPointIds[segmentIndex] ?? null,
        endPointId: getNextBoundaryPointId(ring.boundaryPointIds, segmentIndex),
      })),
      boundaryPointIds: ring.boundaryPointIds,
      isClosed: true,
    }
  }

  const lastIndex = ring.boundaryEntityIds.length - 1
  const reversedPointIds = ring.boundaryPointIds.length > 0
    ? ring.boundaryEntityIds.map((_, index) => {
        const originalIndex = lastIndex - index
        return ring.boundaryPointIds[(originalIndex + 1) % ring.boundaryPointIds.length]!
      })
    : []

  return {
    loopId: createRegionLoopId(regionId, ordinal),
    role,
    orientation: ring.signedArea >= 0 ? 'clockwise' : 'counterClockwise',
    segments: [...ring.boundaryEntityIds].reverse().map((entityId, segmentIndex) => ({
      source: { kind: 'entity', entityId },
      startPointId: reversedPointIds[segmentIndex] ?? null,
      endPointId: getNextBoundaryPointId(reversedPointIds, segmentIndex),
    })),
    boundaryPointIds: reversedPointIds,
    isClosed: true,
  }
}

function getNextBoundaryPointId(pointIds: SketchPointId[], index: number) {
  return pointIds.length > 0 ? pointIds[(index + 1) % pointIds.length]! : null
}
