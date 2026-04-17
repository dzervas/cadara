import { test } from 'bun:test'
import {
  deriveSketchRegionsCore,
  findSketchRings,
} from '@/contracts/sketch/region-extraction'
import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from '@/contracts/sketch/schema'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type { ReferenceId } from '@/contracts/shared/ids'

test('src/contracts/sketch/region-extraction.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function makePoint(pointId: string, label: string, x: number, y: number) {
    return {
      pointId: pointId as `sketch_point_${string}`,
      label,
      target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: pointId as `sketch_point_${string}` } as const,
      position: [x, y] as const,
      isConstruction: false,
    }
  }

  function makeLine(entityId: string, label: string, startPointId: string, endPointId: string, isConstruction = false) {
    return {
      kind: 'lineSegment' as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: entityId as `sketch_entity_${string}` } as const,
      isConstruction,
      startPointId: startPointId as `sketch_point_${string}`,
      endPointId: endPointId as `sketch_point_${string}`,
    }
  }

  function makeCircle(entityId: string, label: string, centerPointId: string, radius: number) {
    return {
      kind: 'circle' as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: entityId as `sketch_entity_${string}` } as const,
      isConstruction: false,
      centerPointId: centerPointId as `sketch_point_${string}`,
      radius,
    }
  }

  function makeAuthoredReference(referenceId: ReferenceId = 'ref_projected_profile') {
    return {
      referenceId,
      kind: 'modelReference' as const,
      label: 'Projected profile',
      source: { kind: 'edge' as const, bodyId: 'body_projected', edgeId: 'edge_profile' },
      projectionMode: 'projectAlongPlaneNormal' as const,
    }
  }

  function makeProjectedReference(
    geometry: ProjectedSketchReferenceRecord['geometry'],
    referenceId: ReferenceId = 'ref_projected_profile',
  ): ProjectedSketchReferenceRecord {
    return {
      referenceId,
      status: 'projected',
      geometry,
      diagnostics: [],
    }
  }

  function makeArc(
    entityId: string,
    label: string,
    centerPointId: string,
    startPointId: string,
    endPointId: string,
    isConstruction = false,
  ) {
    return {
      kind: 'arc' as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: entityId as `sketch_entity_${string}` } as const,
      isConstruction,
      centerPointId: centerPointId as `sketch_point_${string}`,
      startPointId: startPointId as `sketch_point_${string}`,
      endPointId: endPointId as `sketch_point_${string}`,
      sweepDirection: 'counterClockwise' as const,
    }
  }

  function makeSolvedSnapshot(definition: SketchDefinition): SolvedSketchSnapshot {
    const solvedPoints = definition.points.map((point) => ({
      pointId: point.pointId,
      target: point.target,
      solvedPosition: point.position,
    }))

    const pointMap = new Map(definition.points.map((point) => [point.pointId, point]))

    return {
      schemaVersion: 'solved-sketch/v1alpha1',
      status: {
        solveState: 'solved',
        constraintState: 'wellConstrained',
      },
      solvedPoints,
      solvedEntities: definition.entities.flatMap((entity) => {
        if (entity.kind === 'lineSegment') {
          const start = pointMap.get(entity.startPointId)
          const end = pointMap.get(entity.endPointId)
          if (!start || !end) {
            return []
          }
          return [{
            kind: 'lineSegment' as const,
            entityId: entity.entityId,
            target: entity.target,
            startPosition: start.position,
            endPosition: end.position,
          }]
        }
        if (entity.kind === 'circle') {
          const center = pointMap.get(entity.centerPointId)
          if (!center) {
            return []
          }
          return [{
            kind: 'circle' as const,
            entityId: entity.entityId,
            target: entity.target,
            centerPosition: center.position,
            solvedRadius: entity.radius,
          }]
        }
        if (entity.kind === 'arc') {
          const center = pointMap.get(entity.centerPointId)
          const start = pointMap.get(entity.startPointId)
          const end = pointMap.get(entity.endPointId)
          if (!center || !start || !end) {
            return []
          }
          return [{
            kind: 'arc' as const,
            entityId: entity.entityId,
            target: entity.target,
            centerPosition: center.position,
            startPosition: start.position,
            endPosition: end.position,
            sweepDirection: entity.sweepDirection,
          }]
        }
        return []
      }),
      constraintStatuses: [],
      dimensionStatuses: [],
      diagnostics: [],
    }
  }

  async function testFindRingsNone() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 2, 0),
        makePoint('sketch_point_c', 'C', 3, 1),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_bc'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const found = findSketchRings(definition, makeSolvedSnapshot(definition))
    assert(found.rings.length === 0, 'Open chains should not produce rings.')
    assert(found.unusedSegments.length === 2, 'All open segments should remain unused.')
  }

  async function testFindRingsOne() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c', 'sketch_point_d'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 4, 0),
        makePoint('sketch_point_c', 'C', 4, 3),
        makePoint('sketch_point_d', 'D', 0, 3),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_bc', 'sketch_entity_cd', 'sketch_entity_da'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_cd', 'CD', 'sketch_point_c', 'sketch_point_d'),
        makeLine('sketch_entity_da', 'DA', 'sketch_point_d', 'sketch_point_a'),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const found = findSketchRings(definition, makeSolvedSnapshot(definition))
    assert(found.rings.length === 1, 'One rectangle should produce one ring.')
    assert(found.unusedSegments.length === 0, 'Closed rectangle should consume all segments.')
    assert(found.rings[0]?.boundaryEntityIds.length === 4, 'The ring should contain four edges.')
  }

  async function testFindRingsMultipleAndDeriveRegions() {
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
        'sketch_point_g',
        'sketch_point_h',
      ],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 8, 0),
        makePoint('sketch_point_c', 'C', 8, 8),
        makePoint('sketch_point_d', 'D', 0, 8),
        makePoint('sketch_point_e', 'E', 2, 2),
        makePoint('sketch_point_f', 'F', 6, 2),
        makePoint('sketch_point_g', 'G', 6, 6),
        makePoint('sketch_point_h', 'H', 2, 6),
      ],
      entityIds: [
        'sketch_entity_ab',
        'sketch_entity_bc',
        'sketch_entity_cd',
        'sketch_entity_da',
        'sketch_entity_ef',
        'sketch_entity_fg',
        'sketch_entity_gh',
        'sketch_entity_he',
      ],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_cd', 'CD', 'sketch_point_c', 'sketch_point_d'),
        makeLine('sketch_entity_da', 'DA', 'sketch_point_d', 'sketch_point_a'),
        makeLine('sketch_entity_ef', 'EF', 'sketch_point_e', 'sketch_point_f'),
        makeLine('sketch_entity_fg', 'FG', 'sketch_point_f', 'sketch_point_g'),
        makeLine('sketch_entity_gh', 'GH', 'sketch_point_g', 'sketch_point_h'),
        makeLine('sketch_entity_he', 'HE', 'sketch_point_h', 'sketch_point_e'),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const solvedSnapshot = makeSolvedSnapshot(definition)
    const found = findSketchRings(definition, solvedSnapshot)
    assert(found.rings.length === 2, 'Nested rectangles should produce two rings.')

    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot,
    })

    assert(derived.diagnostics.length === 0, 'Region derivation should not emit diagnostics for solved nested rectangles.')
    assert(derived.regions.length === 2, 'Nested rectangles should derive every bounded region.')
    assert(derived.regions[0]?.loops.length === 2, 'Derived region should contain outer and inner loops.')
    assert(derived.regions[0]?.loops[0]?.role === 'outer', 'First loop should be outer.')
    assert(derived.regions[0]?.loops[1]?.role === 'inner', 'Second loop should be inner.')
    assert(derived.regions[1]?.loops.length === 1, 'Inner rectangle should also be selectable as its own region.')
    assert(derived.regions[1]?.loops[0]?.role === 'outer', 'Inner selectable region should expose its boundary as an outer loop.')
  }

  async function testMixedLocalAndProjectedLoopPreservesProjectedIdentity() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: ['ref_projected_profile'],
      references: [makeAuthoredReference()],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c', 'sketch_point_d'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 4, 0),
        makePoint('sketch_point_c', 'C', 4, 3),
        makePoint('sketch_point_d', 'D', 0, 3),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_bc', 'sketch_entity_cd'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_cd', 'CD', 'sketch_point_c', 'sketch_point_d'),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }
    const projectedReferences = [
      makeProjectedReference([{
        geometryId: 'projected_geometry_left',
        kind: 'lineSegment',
        startPosition: [0, 3],
        endPosition: [0, 0],
      }]),
    ]

    const solvedSnapshot = makeSolvedSnapshot(definition)
    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot,
      projectedReferences,
    })

    assert(derived.regions.length === 1, 'Mixed local/projected edges should close one region.')
    const loop = derived.regions[0]!.loops[0]!
    const projectedSegment = loop.segments.find((segment) => segment.source.kind === 'projectedGeometry')
    assert(projectedSegment?.source.kind === 'projectedGeometry', 'Loop should include projected boundary identity.')
    assert(projectedSegment.source.reference.referenceId === 'ref_projected_profile', 'Projected segment must preserve authored reference ID.')
    assert(projectedSegment.source.reference.geometryId === 'projected_geometry_left', 'Projected segment must preserve projected geometry ID.')
    assert(definition.entityIds.length === 3, 'Projected boundaries must not be copied into sketch-owned entity IDs.')
  }

  async function testProjectedOnlyCircleLoopPreservesProjectedIdentity() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: ['ref_projected_profile'],
      references: [makeAuthoredReference()],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }
    const projectedReferences = [
      makeProjectedReference([{
        geometryId: 'projected_geometry_circle',
        kind: 'circle',
        centerPosition: [2, 2],
        radius: 1,
      }]),
    ]

    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
      projectedReferences,
    })

    assert(derived.regions.length === 1, 'Projected-only circles should derive profile regions.')
    const segment = derived.regions[0]!.loops[0]!.segments[0]
    assert(segment?.source.kind === 'projectedGeometry', 'Projected-only loop should stay projected-sourced.')
    assert(segment.source.reference.geometryId === 'projected_geometry_circle', 'Projected circle identity should survive region derivation.')
    assert(definition.points.length === 0 && definition.entities.length === 0, 'Projected-only regions must not author copied sketch geometry.')
  }

  async function testMissingProjectedReferencesReportDiagnosticsWithoutInventingGeometry() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: ['ref_projected_profile'],
      references: [makeAuthoredReference()],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
      projectedReferences: [],
    })

    assert(derived.regions.length === 0, 'Missing projected data must not invent profile regions.')
    assert(
      derived.diagnostics.some((diagnostic) => diagnostic.code === 'projected-region-reference-unresolved'),
      'Missing projected data should report a machine-readable diagnostic.',
    )
  }

  async function testUnauthoredProjectedReferencesReportDiagnosticsWithoutInventingGeometry() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }
    const projectedReferences = [
      makeProjectedReference([{
        geometryId: 'projected_geometry_stale_circle',
        kind: 'circle',
        centerPosition: [2, 2],
        radius: 1,
      }], 'ref_stale_projection'),
    ]

    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
      projectedReferences,
    })

    assert(derived.regions.length === 0, 'Unauthored projected data must not create profile regions.')
    assert(
      derived.diagnostics.some((diagnostic) => diagnostic.code === 'projected-region-reference-unauthored'),
      'Unauthored projected data should report a machine-readable diagnostic.',
    )
    assert(definition.points.length === 0 && definition.entities.length === 0, 'Rejected projected regions must not copy geometry into the sketch.')
  }

  async function testProjectedReferenceMissingAuthoredRecordIsRejected() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: ['ref_projected_profile'],
      references: [],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }
    const projectedReferences = [
      makeProjectedReference([{
        geometryId: 'projected_geometry_recordless_circle',
        kind: 'circle',
        centerPosition: [2, 2],
        radius: 1,
      }]),
    ]

    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
      projectedReferences,
    })

    assert(derived.regions.length === 0, 'Projection data without an authored reference record must not create profile regions.')
    assert(
      derived.diagnostics.some((diagnostic) => diagnostic.code === 'projected-region-reference-unauthored'),
      'Missing authored reference records should report a machine-readable diagnostic.',
    )
  }

  async function testFindCircleRegion() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_center'],
      points: [
        makePoint('sketch_point_center', 'Center', 1, 2),
      ],
      entityIds: ['sketch_entity_circle'],
      entities: [
        makeCircle('sketch_entity_circle', 'Circle', 'sketch_point_center', 3),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const solvedSnapshot = makeSolvedSnapshot(definition)
    const found = findSketchRings(definition, solvedSnapshot)
    assert(found.rings.length === 1, 'A standalone circle should produce one ring.')

    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot,
    })

    assert(derived.regions.length === 1, 'A standalone circle should derive one selectable region.')
    assert(derived.regions[0]?.loops[0]?.segments.length === 1, 'Circle regions should use the circle entity as one closed segment.')
    assert(derived.regions[0]?.loops[0]?.segments[0]?.startPointId === null, 'Circle region segments should not invent boundary points.')
  }

  async function testSquareWithInnerCircleDerivesAllBoundedCells() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_a',
        'sketch_point_b',
        'sketch_point_c',
        'sketch_point_d',
        'sketch_point_center',
      ],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 8, 0),
        makePoint('sketch_point_c', 'C', 8, 8),
        makePoint('sketch_point_d', 'D', 0, 8),
        makePoint('sketch_point_center', 'Center', 4, 4),
      ],
      entityIds: [
        'sketch_entity_ab',
        'sketch_entity_bc',
        'sketch_entity_cd',
        'sketch_entity_da',
        'sketch_entity_circle',
      ],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_cd', 'CD', 'sketch_point_c', 'sketch_point_d'),
        makeLine('sketch_entity_da', 'DA', 'sketch_point_d', 'sketch_point_a'),
        makeCircle('sketch_entity_circle', 'Circle', 'sketch_point_center', 2),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const solvedSnapshot = makeSolvedSnapshot(definition)
    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot,
    })

    assert(derived.regions.length === 2, 'A square with an inner circle should derive outer-with-hole and inner disk regions.')
    assert(derived.regions[0]?.loops.length === 2, 'Outer cell should include the circle as an inner loop.')
    assert(derived.regions[1]?.loops.length === 1, 'Inner disk should be independently selectable.')
    assert(
      derived.regions[1]?.loops[0]?.segments[0]?.source.kind === 'entity'
      && derived.regions[1]?.loops[0]?.segments[0]?.source.entityId === 'sketch_entity_circle',
      'Inner disk should be bounded by the circle entity.',
    )
  }

  async function testConstructionGeometryDoesNotSplitNormalProfile() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_a',
        'sketch_point_b',
        'sketch_point_c',
        'sketch_point_d',
        'sketch_point_cross_start',
        'sketch_point_cross_end',
        'sketch_point_arc_center',
        'sketch_point_arc_start',
        'sketch_point_arc_end',
        'sketch_point_circle_center',
      ],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 8, 0),
        makePoint('sketch_point_c', 'C', 8, 8),
        makePoint('sketch_point_d', 'D', 0, 8),
        makePoint('sketch_point_cross_start', 'Cross start', 4, -1),
        makePoint('sketch_point_cross_end', 'Cross end', 4, 9),
        makePoint('sketch_point_arc_center', 'Arc center', 4, 4),
        makePoint('sketch_point_arc_start', 'Arc start', 5, 4),
        makePoint('sketch_point_arc_end', 'Arc end', 4, 5),
        makePoint('sketch_point_circle_center', 'Circle center', 2, 2),
      ],
      entityIds: [
        'sketch_entity_ab',
        'sketch_entity_bc',
        'sketch_entity_cd',
        'sketch_entity_da',
        'sketch_entity_cross',
        'sketch_entity_arc',
        'sketch_entity_circle',
      ],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_cd', 'CD', 'sketch_point_c', 'sketch_point_d'),
        makeLine('sketch_entity_da', 'DA', 'sketch_point_d', 'sketch_point_a'),
        makeLine('sketch_entity_cross', 'Cross', 'sketch_point_cross_start', 'sketch_point_cross_end', true),
        makeArc('sketch_entity_arc', 'Arc', 'sketch_point_arc_center', 'sketch_point_arc_start', 'sketch_point_arc_end', true),
        {
          ...makeCircle('sketch_entity_circle', 'Circle', 'sketch_point_circle_center', 1),
          isConstruction: true,
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
    })

    assert(derived.regions.length === 1, 'Construction line, arc, and circle geometry must not split or remove a normal profile.')
    assert(
      derived.regions[0]?.loops[0]?.segments.every((segment) =>
        segment.source.kind === 'entity'
          && segment.source.entityId !== 'sketch_entity_cross'
          && segment.source.entityId !== 'sketch_entity_arc'
          && segment.source.entityId !== 'sketch_entity_circle',
      ),
      'Construction line, arc, and circle entities must be excluded from profile boundaries.',
    )
  }

  async function testClosedConstructionCircleDoesNotCreateRegion() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_center'],
      points: [
        makePoint('sketch_point_center', 'Center', 0, 0),
      ],
      entityIds: ['sketch_entity_circle'],
      entities: [
        {
          ...makeCircle('sketch_entity_circle', 'Circle', 'sketch_point_center', 2),
          isConstruction: true,
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const found = findSketchRings(definition, makeSolvedSnapshot(definition))
    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
    })

    assert(found.rings.length === 0, 'Closed construction circles should not produce sketch rings.')
    assert(derived.regions.length === 0, 'Closed construction circles should not create selectable profile regions.')
  }

  async function run() {
    await testFindRingsNone()
    await testFindRingsOne()
  await testFindRingsMultipleAndDeriveRegions()
  await testMixedLocalAndProjectedLoopPreservesProjectedIdentity()
  await testProjectedOnlyCircleLoopPreservesProjectedIdentity()
  await testMissingProjectedReferencesReportDiagnosticsWithoutInventingGeometry()
  await testUnauthoredProjectedReferencesReportDiagnosticsWithoutInventingGeometry()
  await testProjectedReferenceMissingAuthoredRecordIsRejected()
    await testFindCircleRegion()
    await testSquareWithInnerCircleDerivesAllBoundedCells()
    await testConstructionGeometryDoesNotSplitNormalProfile()
    await testClosedConstructionCircleDoesNotCreateRegion()
  }

  run().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
})
