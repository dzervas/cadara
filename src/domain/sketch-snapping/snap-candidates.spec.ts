import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { SketchDefinition } from '@/contracts/sketch/schema'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import {
  collectSketchSnapGeometries,
  resolveSketchSnap,
  type SketchSnapGeometry,
} from '@/domain/sketch-snapping/snap-candidates'

test('src/domain/sketch-snapping/snap-candidates.spec.ts', () => {  function assertClosePoint(
    actual: readonly [number, number] | undefined,
    expected: readonly [number, number],
    message: string,
  ) {
    expectTrue(actual, `${message} Missing point.`)
    const distance = Math.hypot(actual[0] - expected[0], actual[1] - expected[1])
    expectTrue(distance < 1e-6, `${message} Expected ${expected.join(', ')}, received ${actual.join(', ')}.`)
  }

  const definition: SketchDefinition = {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: [
      'sketch_point_a',
      'sketch_point_b',
      'sketch_point_c',
      'sketch_point_d',
      'sketch_point_e',
      'sketch_point_f',
    ],
    points: [
      {
        pointId: 'sketch_point_a',
        label: 'A',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_a' },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_b',
        label: 'B',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_b' },
        position: [2, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_c',
        label: 'C',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_c' },
        position: [4, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_d',
        label: 'D',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_d' },
        position: [8, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_e',
        label: 'E',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_e' },
        position: [9, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_f',
        label: 'F',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_f' },
        position: [8, 1],
        isConstruction: false,
      },
    ],
    entityIds: ['sketch_entity_ab', 'sketch_entity_circle', 'sketch_entity_arc'],
    entities: [
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_ab',
        label: 'AB',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_ab' },
        isConstruction: false,
        startPointId: 'sketch_point_a',
        endPointId: 'sketch_point_b',
      },
      {
        kind: 'circle',
        entityId: 'sketch_entity_circle',
        label: 'Circle',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_circle' },
        isConstruction: false,
        centerPointId: 'sketch_point_c',
        radius: 1,
      },
      {
        kind: 'arc',
        entityId: 'sketch_entity_arc',
        label: 'Arc',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_arc' },
        isConstruction: false,
        centerPointId: 'sketch_point_d',
        startPointId: 'sketch_point_e',
        endPointId: 'sketch_point_f',
        sweepDirection: 'counterClockwise',
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  }
  const projectedReferences: ProjectedSketchReferenceRecord[] = [
    {
      referenceId: 'ref_projected_line',
      status: 'projected',
      geometry: [
        {
          geometryId: 'projected_geometry_line',
          kind: 'lineSegment',
          startPosition: [1, -1],
          endPosition: [1, 1],
        },
        {
          geometryId: 'projected_geometry_arc',
          kind: 'arc',
          centerPosition: [6, 0],
          startPosition: [7, 0],
          endPosition: [6, 1],
          sweepDirection: 'counterClockwise',
        },
      ],
      diagnostics: [],
    },
  ]
  const localGeometries = collectSketchSnapGeometries({ definition })
  const geometries = collectSketchSnapGeometries({ definition, projectedReferences })

function testCenterCandidates() {
    const circleCenter = resolveSketchSnap({
      pointer: [4, 0.03],
      geometries: localGeometries,
      tolerance: 0.2,
      activeTool: 'line',
    })
    expectTrue(circleCenter.activeCandidate?.kind === 'center', 'Pointer near a circle center should prefer a center snap.')
    expectTrue(circleCenter.activeCandidate.preview.label === 'Center', 'Circle center snap should expose center preview metadata.')
    expectTrue(circleCenter.activeCandidate.preview.glyph === 'center', 'Circle center snap should expose the center glyph.')
    assertClosePoint(circleCenter.snappedPoint, [4, 0], 'Circle center snap should use the exact center point.')

    const arcCenter = resolveSketchSnap({
      pointer: [8.03, 0],
      geometries: localGeometries,
      tolerance: 0.2,
      activeTool: 'line',
    })
    expectTrue(arcCenter.activeCandidate?.kind === 'center', 'Pointer near an arc center should prefer a center snap.')
    assertClosePoint(arcCenter.snappedPoint, [8, 0], 'Arc center snap should use the exact center point.')
  }

  function testLineMidpointCandidate() {
    const result = resolveSketchSnap({
      pointer: [1, 0.04],
      geometries: localGeometries,
      tolerance: 0.2,
      activeTool: 'line',
    })

    expectTrue(result.activeCandidate?.kind === 'midpoint', 'Pointer near a line midpoint should prefer midpoint snap.')
    assertClosePoint(result.snappedPoint, [1, 0], 'Midpoint snap should return the exact line midpoint.')
    expectTrue(
      result.activeCandidate.sources.some((source) => source.kind === 'localEntity'),
      'Midpoint snap should carry the source line reference.',
    )
  }

  function testProjectedGeometryCandidate() {
    const result = resolveSketchSnap({
      pointer: [1.1, 0.5],
      geometries,
      tolerance: 0.2,
      activeTool: 'line',
    })

    expectTrue(result.activeCandidate?.kind === 'nearestOnLine', 'Pointer near a projected line should snap onto it.')
    assertClosePoint(result.snappedPoint, [1, 0.5], 'Projected line snap should use derived projected coordinates.')
    expectTrue(
      result.activeCandidate.sources.some((source) => source.kind === 'projectedGeometry'),
      'Projected snap should reference projected geometry without creating local geometry.',
    )
  }

  function testSketchDatumCandidates() {
    const datumOnlyGeometries = collectSketchSnapGeometries({
      definition: {
        ...definition,
        pointIds: [],
        points: [],
        entityIds: [],
        entities: [],
      },
    })
    const origin = resolveSketchSnap({
      pointer: [0.04, 0.03],
      geometries: datumOnlyGeometries,
      tolerance: 0.2,
      activeTool: 'line',
    })
    expectTrue(origin.activeCandidate?.kind === 'endpoint', 'Pointer near the sketch origin should snap to the datum origin.')
    assertClosePoint(origin.snappedPoint, [0, 0], 'Datum origin snap should use exact local origin coordinates.')
    expectTrue(
      origin.activeCandidate.sources.some((source) => source.kind === 'sketchDatum' && source.datumId === 'origin'),
      'Datum origin snap should carry a sketch-datum source.',
    )

    const axis = resolveSketchSnap({
      pointer: [3, 0.04],
      geometries: datumOnlyGeometries,
      tolerance: 0.2,
      activeTool: 'line',
    })
    expectTrue(axis.activeCandidate?.kind === 'nearestOnLine', 'Pointer near a datum axis should snap onto that axis.')
    assertClosePoint(axis.snappedPoint, [3, 0], 'Datum axis snap should project to the nearest axis point.')
    expectTrue(
      axis.activeCandidate.sources.some((source) => source.kind === 'sketchDatum' && source.datumId === 'xAxis'),
      'Datum axis snap should carry a sketch-datum source.',
    )
  }

  function testCurveCandidates() {
    const circle = resolveSketchSnap({
      pointer: [4.05, 1.12],
      geometries: localGeometries,
      tolerance: 0.2,
      activeTool: 'line',
    })
    expectTrue(circle.activeCandidate?.kind === 'nearestOnCircle', 'Pointer near a circle should snap onto the circle.')
    assertClosePoint(
      circle.snappedPoint,
      [4.044598829122584, 0.9990057739466971],
      'Nearest-on-circle snap should use the radial circle point.',
    )

    const arc = resolveSketchSnap({
      pointer: [6.72, 0.72],
      geometries,
      tolerance: 0.2,
      activeTool: 'line',
    })
    expectTrue(arc.activeCandidate?.kind === 'nearestOnArc', 'Pointer near an arc should snap onto the finite arc.')
    assertClosePoint(
      arc.snappedPoint,
      [6.707106781186548, 0.7071067811865475],
      'Nearest-on-arc snap should use the radial point when it lies on the arc sweep.',
    )
  }

  function testAlignmentAndTangentCandidates() {
    const horizontal = resolveSketchSnap({
      pointer: [2.5, 0.04],
      geometries,
      activeAnchor: [0, 0],
      activeTool: 'line',
      tolerance: 0.2,
    })
    expectTrue(horizontal.activeCandidate?.kind === 'horizontalAlignment', 'Line drawing should infer horizontal alignment from the active start.')
    assertClosePoint(horizontal.snappedPoint, [2.5, 0], 'Horizontal alignment should lock the pointer y coordinate.')

    const vertical = resolveSketchSnap({
      pointer: [0.04, 2.5],
      geometries,
      activeAnchor: [0, 0],
      activeTool: 'line',
      tolerance: 0.2,
    })
    expectTrue(vertical.activeCandidate?.kind === 'verticalAlignment', 'Line drawing should infer vertical alignment from the active start.')
    assertClosePoint(vertical.snappedPoint, [0, 2.5], 'Vertical alignment should lock the pointer x coordinate.')

    const tangent = resolveSketchSnap({
      pointer: [3.5, 0.8660254037844386],
      geometries,
      activeAnchor: [2, 0],
      activeTool: 'line',
      tolerance: 0.2,
    })
    expectTrue(tangent.activeCandidate?.kind === 'tangent', 'Line drawing should expose deterministic circle tangent candidates.')
    assertClosePoint(tangent.snappedPoint, [3.5, 0.8660254037844387], 'Tangent snap should use the nearest tangent point.')
  }

  function testPerpendicularFootCandidates() {
    const lineGeometry: SketchSnapGeometry = {
      kind: 'lineSegment',
      source: {
        kind: 'localEntity',
        entityId: 'sketch_entity_perpendicular',
        geometryKind: 'lineSegment',
      },
      start: [0, 0],
      end: [4, 4],
      label: 'Long line',
    }
    const valid = resolveSketchSnap({
      pointer: [1, 1],
      geometries: [lineGeometry],
      activeAnchor: [0, 2],
      activeTool: 'line',
      tolerance: 0.2,
    })
    expectTrue(valid.activeCandidate?.kind === 'perpendicularFoot', 'True finite-segment perpendicular foot should be emitted.')
    assertClosePoint(valid.snappedPoint, [1, 1], 'Perpendicular foot should use the unclamped projection point.')

    const outside = resolveSketchSnap({
      pointer: [4, 4],
      geometries: [lineGeometry],
      activeAnchor: [7, 5],
      activeTool: 'line',
      tolerance: 0.2,
    })
    expectTrue(
      outside.candidates.every((candidate) => candidate.kind !== 'perpendicularFoot'),
      'Out-of-segment perpendicular projections should not be labeled as perpendicular-foot snaps.',
    )
  }

  function testIntersectionsAndHysteresis() {
    const intersections = resolveSketchSnap({
      pointer: [1, 0.04],
      geometries,
      tolerance: 0.2,
      activeTool: 'line',
    })
    expectTrue(
      intersections.candidates.some((candidate) => candidate.kind === 'intersection'),
      'Candidate list should include curve intersections within tolerance.',
    )
  }

  function testHysteresisKeepsNearbyPreviousCandidate() {
    const competingPoints: SketchSnapGeometry[] = [
      {
        kind: 'point',
        source: {
          kind: 'localPoint',
          pointId: 'sketch_point_hysteresis_a',
        },
        point: [0, 0],
        label: 'Hysteresis A',
      },
      {
        kind: 'point',
        source: {
          kind: 'localPoint',
          pointId: 'sketch_point_hysteresis_b',
        },
        point: [0.1, 0],
        label: 'Hysteresis B',
      },
    ]
    const baseline = resolveSketchSnap({
      pointer: [0.04, 0],
      geometries: competingPoints,
      tolerance: 0.2,
      activeTool: 'line',
    })
    assertClosePoint(baseline.snappedPoint, [0, 0], 'Baseline snap should choose the closest point without hysteresis.')

    const previous = baseline.candidates.find((candidate) => candidate.point[0] === 0.1)
    expectTrue(previous, 'Expected a nearby previous candidate for hysteresis.')

    const hysteresis = resolveSketchSnap({
      pointer: [0.04, 0],
      geometries: competingPoints,
      tolerance: 0.2,
      activeTool: 'line',
      activeCandidateKey: previous.key,
    })
    expectTrue(
      hysteresis.activeCandidate?.key === previous.key,
      'Active candidate hysteresis should keep a nearby previous candidate stable.',
    )
  }

  testCenterCandidates()
  testLineMidpointCandidate()
  testProjectedGeometryCandidate()
  testSketchDatumCandidates()
  testCurveCandidates()
  testAlignmentAndTangentCandidates()
  testPerpendicularFootCandidates()
  testIntersectionsAndHysteresis()
  testHysteresisKeepsNearbyPreviousCandidate()
})
