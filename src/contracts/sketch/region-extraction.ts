import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
} from '@/contracts/solver/schema'
import type {
  RegionLoopRecord,
  RegionBoundarySegmentRecord,
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
  ReferenceId,
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
  projectedReferences?: readonly ProjectedSketchReferenceRecord[]
}

export interface SketchRegionExtractionResult {
  regions: RegionRecord[]
  diagnostics: SketchSolveDiagnostic[]
}

export interface SketchRingCandidate {
  kind: 'segments'
  boundarySegments: RingBoundarySegment[]
  boundaryEntityIds: SketchEntityId[]
  boundaryPointIds: SketchPointId[]
  points: SketchPoint2D[]
  signedArea: number
}

type SegmentRecord = {
  source: RegionBoundarySegmentRecord['source']
  sourceKey: string
  startPointId: SketchPointId | null
  endPointId: SketchPointId | null
  start: SketchPoint2D
  end: SketchPoint2D
  startAngle: number
  endAngle: number
  traversalDirection: 'forward' | 'reverse'
}

type RingBoundarySegment = {
  source: RegionBoundarySegmentRecord['source']
  startPointId: SketchPointId | null
  endPointId: SketchPointId | null
  traversalDirection: 'forward' | 'reverse'
}

const CIRCLE_REGION_SAMPLE_COUNT = 64

function projectedKindForGeometry(geometry: ProjectedSketchReferenceGeometry): NonNullable<RegionBoundarySegmentRecord['source'] extends infer Source
  ? Source extends { kind: 'projectedGeometry'; reference: infer Reference }
    ? Reference extends { kind?: infer Kind }
      ? Kind
      : never
    : never
  : never> {
  switch (geometry.kind) {
    case 'point':
      return 'projectedPoint'
    case 'lineSegment':
      return 'projectedLineSegment'
    case 'circle':
      return 'projectedCircle'
    case 'arc':
      return 'projectedArc'
    case 'spline':
      return 'projectedSpline'
  }
}

function getProjectedGeometrySource(
  reference: ProjectedSketchReferenceRecord,
  geometry: ProjectedSketchReferenceGeometry,
): Extract<RegionBoundarySegmentRecord['source'], { kind: 'projectedGeometry' }> {
  return {
    kind: 'projectedGeometry',
    reference: {
      kind: projectedKindForGeometry(geometry),
      referenceId: reference.referenceId,
      geometryId: geometry.geometryId,
    },
  }
}

function getSegmentSourceKey(source: RegionBoundarySegmentRecord['source']) {
  if (source.kind === 'entity') {
    return `entity:${source.entityId}`
  }

  return `projected:${source.reference.referenceId}:${source.reference.geometryId}`
}

function makeDiagnostic(
  code: string,
  severity: SketchSolveDiagnostic['severity'],
  message: string,
  target: SketchSolveDiagnostic['target'],
): SketchSolveDiagnostic {
  return { code, severity, message, target }
}

function getAuthoredReferenceIds(definition: SketchDefinition): Set<ReferenceId> {
  const recordedReferenceIds = new Set(definition.references.map((reference) => reference.referenceId))

  return new Set(definition.referenceIds.filter((referenceId) => recordedReferenceIds.has(referenceId)))
}

function isAuthoredReference(definition: SketchDefinition, referenceId: ReferenceId) {
  return getAuthoredReferenceIds(definition).has(referenceId)
}

function filterAuthoredProjectedReferences(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
) {
  const authoredReferenceIds = getAuthoredReferenceIds(definition)
  return projectedReferences.filter((reference) => authoredReferenceIds.has(reference.referenceId))
}

function pointKey(point: SketchPoint2D) {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`
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

function ringContainsRing(parent: SketchRingCandidate, child: SketchRingCandidate) {
  return child.points.every((point) => pointInPolygon(point, parent.points))
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
    source: segment.source,
    sourceKey: segment.sourceKey,
    startPointId: segment.endPointId,
    endPointId: segment.startPointId,
    start: segment.end,
    end: segment.start,
    startAngle: (segment.endAngle + Math.PI) % (Math.PI * 2),
    endAngle: (segment.startAngle + Math.PI) % (Math.PI * 2),
    traversalDirection: segment.traversalDirection === 'forward' ? 'reverse' : 'forward',
  }
}

function equalsOrReverseEquals(left: SegmentRecord, right: SegmentRecord) {
  return (
    left.sourceKey === right.sourceKey
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
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
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

  const authoredSegments = definition.entities.flatMap((entity): SegmentRecord[] => {
    if (entity.isConstruction) {
      return []
    }

    if (entity.kind === 'lineSegment') {
      const solved = solvedLineMap.get(entity.entityId)
      if (!solved) {
        return []
      }
      return [{
        source: { kind: 'entity', entityId: entity.entityId },
        sourceKey: getSegmentSourceKey({ kind: 'entity', entityId: entity.entityId }),
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
        traversalDirection: 'forward' as const,
      } satisfies SegmentRecord]
    }

    if (entity.kind === 'arc') {
      const solved = solvedArcMap.get(entity.entityId)
      if (!solved) {
        return []
      }

      return [{
        source: { kind: 'entity', entityId: entity.entityId },
        sourceKey: getSegmentSourceKey({ kind: 'entity', entityId: entity.entityId }),
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
        traversalDirection: 'forward' as const,
      } satisfies SegmentRecord]
    }

    return []
  })

  return authoredSegments.concat(buildProjectedSegments(projectedReferences))
}

function buildProjectedSegments(
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SegmentRecord[] {
  return projectedReferences.flatMap((reference) => {
    if (reference.status !== 'projected') {
      return []
    }

    return reference.geometry.flatMap((geometry): SegmentRecord[] => {
      const source = getProjectedGeometrySource(reference, geometry)
      const sourceKey = getSegmentSourceKey(source)

      if (geometry.kind === 'lineSegment') {
        return [{
          source,
          sourceKey,
          startPointId: null,
          endPointId: null,
          start: geometry.startPosition,
          end: geometry.endPosition,
          startAngle: Math.atan2(
            geometry.endPosition[1] - geometry.startPosition[1],
            geometry.endPosition[0] - geometry.startPosition[0],
          ),
          endAngle: Math.atan2(
            geometry.endPosition[1] - geometry.startPosition[1],
            geometry.endPosition[0] - geometry.startPosition[0],
          ),
          traversalDirection: 'forward',
        }]
      }

      if (geometry.kind === 'arc') {
        return [{
          source,
          sourceKey,
          startPointId: null,
          endPointId: null,
          start: geometry.startPosition,
          end: geometry.endPosition,
          startAngle: Math.atan2(
            geometry.startPosition[1] - geometry.centerPosition[1],
            geometry.startPosition[0] - geometry.centerPosition[0],
          ),
          endAngle: Math.atan2(
            geometry.endPosition[1] - geometry.centerPosition[1],
            geometry.endPosition[0] - geometry.centerPosition[0],
          ),
          traversalDirection: 'forward',
        }]
      }

      return []
    })
  })
}

function buildCircleRings(
  definition: SketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
) {
  const solvedCircleMap = new Map(
    solvedSnapshot.solvedEntities
      .filter((entity): entity is Extract<SolvedSketchEntityGeometryRecord, { kind: 'circle' }> => entity.kind === 'circle')
      .map((entity) => [entity.entityId, entity]),
  )
  const localCircleRings = definition.entities.flatMap((entity) => {
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
      boundarySegments: [{
        source: { kind: 'entity', entityId: entity.entityId },
        startPointId: null,
        endPointId: null,
        traversalDirection: 'forward',
      }],
      boundaryEntityIds: [entity.entityId],
      boundaryPointIds: [],
      points,
      signedArea: signedArea(points),
    } satisfies SketchRingCandidate]
  })

  const projectedCircleRings = projectedReferences.flatMap((reference) => {
    if (reference.status !== 'projected') {
      return []
    }

    return reference.geometry.flatMap((geometry) => {
      if (geometry.kind !== 'circle') {
        return []
      }

      const points = Array.from({ length: CIRCLE_REGION_SAMPLE_COUNT }, (_, index) => {
        const angle = (Math.PI * 2 * index) / CIRCLE_REGION_SAMPLE_COUNT
        return [
          geometry.centerPosition[0] + Math.cos(angle) * geometry.radius,
          geometry.centerPosition[1] + Math.sin(angle) * geometry.radius,
        ] satisfies SketchPoint2D
      })

      return [{
        kind: 'segments' as const,
        boundarySegments: [{
          source: getProjectedGeometrySource(reference, geometry),
          startPointId: null,
          endPointId: null,
          traversalDirection: 'forward',
        }],
        boundaryEntityIds: [],
        boundaryPointIds: [],
        points,
        signedArea: signedArea(points),
      } satisfies SketchRingCandidate]
    })
  })

  return [...localCircleRings, ...projectedCircleRings]
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
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
): { rings: SketchRingCandidate[]; unusedSegments: SegmentRecord[] } {
  const authoredProjectedReferences = filterAuthoredProjectedReferences(definition, projectedReferences)
  const initialSegments = buildSegments(definition, solvedSnapshot, authoredProjectedReferences)
  const allSegments = [...initialSegments, ...initialSegments.map(reverseSegment)]

  const used = new Set<number>()
  const rings: SketchRingCandidate[] = buildCircleRings(definition, solvedSnapshot, authoredProjectedReferences)

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
            boundarySegments: ringSegments.map((entry) => ({
              source: entry.source,
              startPointId: entry.startPointId,
              endPointId: entry.endPointId,
              traversalDirection: entry.traversalDirection,
            })),
            boundaryEntityIds: ringSegments.flatMap((entry) => entry.source.kind === 'entity' ? [entry.source.entityId] : []),
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
  return ring.boundarySegments.map((segment) => getSegmentSourceKey(segment.source)).join('|')
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

  const projectedReferences = input.projectedReferences ?? []
  const authoredProjectedReferences = filterAuthoredProjectedReferences(input.definition, projectedReferences)
  const { rings } = findSketchRings(input.definition, input.solvedSnapshot, authoredProjectedReferences)
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
      if (pointInPolygon(marker, candidate.points) && ringContainsRing(candidate, child)) {
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
    diagnostics: createProjectedReferenceRegionDiagnostics(input.definition, projectedReferences),
  }
}

function createProjectedReferenceRegionDiagnostics(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SketchSolveDiagnostic[] {
  const projectedById = new Map(projectedReferences.map((reference) => [reference.referenceId, reference]))
  const diagnostics: SketchSolveDiagnostic[] = projectedReferences
    .filter((projected) => !isAuthoredReference(definition, projected.referenceId))
    .map((projected) => makeDiagnostic(
      'projected-region-reference-unauthored',
      'warning',
      `Projected reference ${projected.referenceId} cannot participate in live-derived region extraction because it is not backed by the current authored sketch references.`,
      null,
    ))

  return diagnostics.concat(definition.referenceIds.flatMap((referenceId) => {
    if (!isAuthoredReference(definition, referenceId)) {
      return [makeDiagnostic(
        'projected-region-reference-unauthored',
        'warning',
        `Reference ${referenceId} cannot participate in live-derived projected region extraction because it is not backed by both referenceIds and references.`,
        null,
      )]
    }

    const projected = projectedById.get(referenceId)

    if (!projected) {
      return [makeDiagnostic(
        'projected-region-reference-unresolved',
        'warning',
        `Reference ${referenceId} is unavailable for live-derived projected region extraction.`,
        null,
      )]
    }

    if (projected.status !== 'projected') {
      return [makeDiagnostic(
        'projected-region-reference-invalid',
        'warning',
        `Reference ${referenceId} cannot participate in live-derived projected region extraction because projection status is ${projected.status}.`,
        null,
      )]
    }

    return []
  }))
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
      segments: ring.boundarySegments.map((segment) => toRegionSegmentRecord(segment)),
      boundaryPointIds: ring.boundaryPointIds,
      isClosed: true,
    }
  }

  const lastIndex = ring.boundarySegments.length - 1
  const reversedPointIds = ring.boundaryPointIds.length > 0
    ? ring.boundarySegments.map((_, index) => {
        const originalIndex = lastIndex - index
        return ring.boundaryPointIds[(originalIndex + 1) % ring.boundaryPointIds.length]!
      })
    : []

  return {
    loopId: createRegionLoopId(regionId, ordinal),
    role,
    orientation: ring.signedArea >= 0 ? 'clockwise' : 'counterClockwise',
    segments: [...ring.boundarySegments].reverse().map((segment) => toRegionSegmentRecord(reverseRingBoundarySegment(segment))),
    boundaryPointIds: reversedPointIds,
    isClosed: true,
  }
}

function toRegionSegmentRecord(segment: RingBoundarySegment): RegionBoundarySegmentRecord {
  return {
    source: segment.source,
    startPointId: segment.startPointId,
    endPointId: segment.endPointId,
    ...(segment.traversalDirection === 'reverse' ? { traversalDirection: 'reverse' as const } : {}),
  }
}

function reverseRingBoundarySegment(segment: RingBoundarySegment): RingBoundarySegment {
  return {
    source: segment.source,
    startPointId: segment.endPointId,
    endPointId: segment.startPointId,
    traversalDirection: segment.traversalDirection === 'forward' ? 'reverse' : 'forward',
  }
}
