import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
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

test('src/contracts/sketch/region-extraction.spec.ts', async () => {  function assertNear(actual: number, expected: number, message: string) {
    if (Math.abs(actual - expected) > 1e-9) {
      throw new Error(`${message}: expected ${expected}, received ${actual}`)
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
    expectTrue(found.rings.length === 0, 'Open chains should not produce rings.')
    expectTrue(found.unusedSegments.length === 2, 'All open segments should remain unused.')
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
    expectTrue(found.rings.length === 1, 'One rectangle should produce one ring.')
    expectTrue(found.unusedSegments.length === 0, 'Closed rectangle should consume all segments.')
    expectTrue(found.rings[0]?.boundaryEntityIds.length === 4, 'The ring should contain four edges.')
  }

  async function testJiggledRectangleRegionsStayStableAndPositioned() {
    const baseDefinition: SketchDefinition = {
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

    const translateDefinition = (dx: number, dy: number): SketchDefinition => ({
      ...baseDefinition,
      points: baseDefinition.points.map((point) => ({
        ...point,
        position: [point.position[0] + dx, point.position[1] + dy] as const,
      })),
    })

    let expectedRegionId: string | null = null
    let expectedLoopSignature: string | null = null

    for (const [dx, dy] of [[0, 0], [0.125, -0.25], [-0.2, 0.3], [0.05, 0.05], [0, 0]] as const) {
      const definition = translateDefinition(dx, dy)
      const solvedSnapshot = makeSolvedSnapshot(definition)
      const found = findSketchRings(definition, solvedSnapshot)
      const derived = deriveSketchRegionsCore({
        documentId: 'doc_workspace',
        revisionId: 'rev_0001',
        sketchId: 'sketch_primary',
        definition,
        solvedSnapshot,
      })

      expectTrue(found.rings.length === 1, 'Jiggled rectangle should keep producing exactly one ring.')
      expectTrue(derived.regions.length === 1, 'Jiggled rectangle should keep producing exactly one region.')

      const ring = found.rings[0]!
      const region = derived.regions[0]!
      const xs = ring.points.map((point) => point[0])
      const ys = ring.points.map((point) => point[1])
      const loopSignature = region.loops[0]!.segments.map((segment) =>
        segment.source.kind === 'entity' ? segment.source.entityId : segment.source.reference.geometryId,
      ).join('|')

      expectedRegionId ??= region.regionId
      expectedLoopSignature ??= loopSignature

      expectTrue(region.regionId === expectedRegionId, 'Region id should remain stable while the profile is jiggled.')
      expectTrue(loopSignature === expectedLoopSignature, 'Region boundary sources should remain stable while the profile is jiggled.')
      assertNear(Math.min(...xs), dx, 'Jiggled region should keep the translated minimum x.')
      assertNear(Math.max(...xs), dx + 4, 'Jiggled region should keep the translated maximum x.')
      assertNear(Math.min(...ys), dy, 'Jiggled region should keep the translated minimum y.')
      assertNear(Math.max(...ys), dy + 3, 'Jiggled region should keep the translated maximum y.')
      assertNear(Math.abs(ring.signedArea), 12, 'Jiggled region should preserve its profile area.')
    }
  }

  async function testEndpointSelectionResidualsDeriveAdjacentProfiles() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_1_rect-bottom-left',
        'sketch_point_1_rect-bottom-right',
        'sketch_point_1_rect-top-right',
        'sketch_point_1_rect-top-left',
        'sketch_point_2_line-start',
        'sketch_point_2_line-end',
        'sketch_point_4_line-start',
        'sketch_point_4_line-end',
        'sketch_point_5_line-start',
        'sketch_point_5_line-end',
      ],
      points: [
        makePoint('sketch_point_1_rect-bottom-left', 'Bottom left', -14.291285910941498, -1.091872713913713),
        makePoint('sketch_point_1_rect-bottom-right', 'Bottom right', -3.820764551724851, -1.0918727118189422),
        makePoint('sketch_point_1_rect-top-right', 'Top right', -3.8207645448174223, 6.534128625935561),
        makePoint('sketch_point_1_rect-top-left', 'Top left', -14.291285906887033, 6.534128628579854),
        makePoint('sketch_point_2_line-start', 'Line 2 start', -17.50622951036383, -4.747048831429789),
        makePoint('sketch_point_2_line-end', 'Line 2 end', -14.291285908581912, -1.0918727156232404),
        makePoint('sketch_point_4_line-start', 'Line 4 start', -17.50622951036383, -4.747048831429789),
        makePoint('sketch_point_4_line-end', 'Line 4 end', -19.066456551723654, 5.886265464155363),
        makePoint('sketch_point_5_line-start', 'Line 5 start', -19.066456551723654, 5.886265464155363),
        makePoint('sketch_point_5_line-end', 'Line 5 end', -14.291285911202246, 6.534128625935561),
      ],
      entityIds: [
        'sketch_entity_1_rect-bottom',
        'sketch_entity_1_rect-right',
        'sketch_entity_1_rect-top',
        'sketch_entity_1_rect-left',
        'sketch_entity_2_line',
        'sketch_entity_4_line',
        'sketch_entity_5_line',
      ],
      entities: [
        makeLine('sketch_entity_1_rect-bottom', 'Bottom', 'sketch_point_1_rect-bottom-left', 'sketch_point_1_rect-bottom-right'),
        makeLine('sketch_entity_1_rect-right', 'Right', 'sketch_point_1_rect-bottom-right', 'sketch_point_1_rect-top-right'),
        makeLine('sketch_entity_1_rect-top', 'Top', 'sketch_point_1_rect-top-right', 'sketch_point_1_rect-top-left'),
        makeLine('sketch_entity_1_rect-left', 'Left', 'sketch_point_1_rect-top-left', 'sketch_point_1_rect-bottom-left'),
        makeLine('sketch_entity_2_line', 'Line 2', 'sketch_point_2_line-start', 'sketch_point_2_line-end'),
        makeLine('sketch_entity_4_line', 'Line 4', 'sketch_point_4_line-start', 'sketch_point_4_line-end'),
        makeLine('sketch_entity_5_line', 'Line 5', 'sketch_point_5_line-start', 'sketch_point_5_line-end'),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const solvedSnapshot = makeSolvedSnapshot(definition)
    const found = findSketchRings(definition, solvedSnapshot)
    expectTrue(found.rings.length === 2, 'Endpoint selections with floating-point residuals should produce both adjacent rings.')
    expectTrue(found.unusedSegments.length === 0, 'Endpoint-selection residuals should not leave profile segments unused.')

    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot,
    })

    expectTrue(derived.regions.length === 2, 'Endpoint selections from existing vertices should derive both selectable profiles.')
    expectTrue(
      derived.regions.some((region) =>
        region.loops[0]?.segments.some((segment) =>
          segment.source.kind === 'entity' && segment.source.entityId === 'sketch_entity_2_line',
        ),
      ),
      'Derived profiles should include the second loop bounded by the referenced line endpoints.',
    )
  }

  async function testRegionIdsSurviveSortOrderChanges() {
    function makeDefinition(secondWidth: number): SketchDefinition {
      const points = [
        makePoint('sketch_point_a0', 'A0', 0, 0),
        makePoint('sketch_point_a1', 'A1', 2, 0),
        makePoint('sketch_point_a2', 'A2', 2, 2),
        makePoint('sketch_point_a3', 'A3', 0, 2),
        makePoint('sketch_point_b0', 'B0', 4, 0),
        makePoint('sketch_point_b1', 'B1', 4 + secondWidth, 0),
        makePoint('sketch_point_b2', 'B2', 4 + secondWidth, secondWidth),
        makePoint('sketch_point_b3', 'B3', 4, secondWidth),
      ]
      const entities = [
        makeLine('sketch_entity_a_bottom', 'A bottom', 'sketch_point_a0', 'sketch_point_a1'),
        makeLine('sketch_entity_a_right', 'A right', 'sketch_point_a1', 'sketch_point_a2'),
        makeLine('sketch_entity_a_top', 'A top', 'sketch_point_a2', 'sketch_point_a3'),
        makeLine('sketch_entity_a_left', 'A left', 'sketch_point_a3', 'sketch_point_a0'),
        makeLine('sketch_entity_b_bottom', 'B bottom', 'sketch_point_b0', 'sketch_point_b1'),
        makeLine('sketch_entity_b_right', 'B right', 'sketch_point_b1', 'sketch_point_b2'),
        makeLine('sketch_entity_b_top', 'B top', 'sketch_point_b2', 'sketch_point_b3'),
        makeLine('sketch_entity_b_left', 'B left', 'sketch_point_b3', 'sketch_point_b0'),
      ]
      return {
        schemaVersion: 'sketch-definition/v1alpha1',
        referenceIds: [],
        references: [],
        pointIds: points.map((point) => point.pointId),
        points,
        entityIds: entities.map((entity) => entity.entityId),
        entities,
        constraintIds: [],
        constraints: [],
        dimensionIds: [],
        dimensions: [],
      }
    }

    function regionIdForEntity(definition: SketchDefinition, entityId: string) {
      const derived = deriveSketchRegionsCore({
        documentId: 'doc_workspace',
        revisionId: 'rev_0001',
        sketchId: 'sketch_primary',
        definition,
        solvedSnapshot: makeSolvedSnapshot(definition),
      })
      const region = derived.regions.find((candidate) =>
        candidate.loops[0]?.segments.some((segment) =>
          segment.source.kind === 'entity' && segment.source.entityId === entityId,
        ),
      )
      expectTrue(region, `Expected a region containing ${entityId}.`)
      return region.regionId
    }

    const stableRegionId = regionIdForEntity(makeDefinition(1), 'sketch_entity_a_bottom')
    const resortedRegionId = regionIdForEntity(makeDefinition(4), 'sketch_entity_a_bottom')

    expectTrue(stableRegionId === resortedRegionId, 'Region ids should be based on boundary content, not sorted position.')
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
    expectTrue(found.rings.length === 2, 'Nested rectangles should produce two rings.')

    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot,
    })

    expectTrue(derived.diagnostics.length === 0, 'Region derivation should not emit diagnostics for solved nested rectangles.')
    expectTrue(derived.regions.length === 1, 'Nested rectangles should derive one even-parity solid region.')
    expectTrue(derived.regions[0]?.loops.length === 2, 'Derived region should contain outer and inner loops.')
    expectTrue(derived.regions[0]?.loops[0]?.role === 'outer', 'First loop should be outer.')
    expectTrue(derived.regions[0]?.loops[1]?.role === 'inner', 'Second loop should be inner.')
  }

  async function testThreeLevelNestingKeepsIslandSolid() {
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
        'sketch_point_i',
        'sketch_point_j',
        'sketch_point_k',
        'sketch_point_l',
      ],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 10, 0),
        makePoint('sketch_point_c', 'C', 10, 10),
        makePoint('sketch_point_d', 'D', 0, 10),
        makePoint('sketch_point_e', 'E', 2, 2),
        makePoint('sketch_point_f', 'F', 8, 2),
        makePoint('sketch_point_g', 'G', 8, 8),
        makePoint('sketch_point_h', 'H', 2, 8),
        makePoint('sketch_point_i', 'I', 4, 4),
        makePoint('sketch_point_j', 'J', 6, 4),
        makePoint('sketch_point_k', 'K', 6, 6),
        makePoint('sketch_point_l', 'L', 4, 6),
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
        'sketch_entity_ij',
        'sketch_entity_jk',
        'sketch_entity_kl',
        'sketch_entity_li',
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
        makeLine('sketch_entity_ij', 'IJ', 'sketch_point_i', 'sketch_point_j'),
        makeLine('sketch_entity_jk', 'JK', 'sketch_point_j', 'sketch_point_k'),
        makeLine('sketch_entity_kl', 'KL', 'sketch_point_k', 'sketch_point_l'),
        makeLine('sketch_entity_li', 'LI', 'sketch_point_l', 'sketch_point_i'),
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

    expectTrue(derived.regions.length === 2, 'Outer/hole/island nesting should derive the outer solid and island solid.')
    expectTrue(derived.regions[0]?.loops.length === 2, 'Outer solid should use the middle loop as a hole.')
    expectTrue(derived.regions[1]?.loops.length === 1, 'Island solid should not be treated as an inner loop of the hole.')
    expectTrue(
      derived.regions[1]?.loops[0]?.segments.some((segment) =>
        segment.source.kind === 'entity' && segment.source.entityId === 'sketch_entity_ij',
      ),
      'Island region should be bounded by the innermost loop.',
    )
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

    expectTrue(derived.regions.length === 1, 'Mixed local/projected edges should close one region.')
    const loop = derived.regions[0]!.loops[0]!
    const projectedSegment = loop.segments.find((segment) => segment.source.kind === 'projectedGeometry')
    expectTrue(projectedSegment?.source.kind === 'projectedGeometry', 'Loop should include projected boundary identity.')
    expectTrue(projectedSegment.source.reference.referenceId === 'ref_projected_profile', 'Projected segment must preserve authored reference ID.')
    expectTrue(projectedSegment.source.reference.geometryId === 'projected_geometry_left', 'Projected segment must preserve projected geometry ID.')
    expectTrue(definition.entityIds.length === 3, 'Projected boundaries must not be copied into sketch-owned entity IDs.')
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

    expectTrue(derived.regions.length === 1, 'Projected-only circles should derive profile regions.')
    const segment = derived.regions[0]!.loops[0]!.segments[0]
    expectTrue(segment?.source.kind === 'projectedGeometry', 'Projected-only loop should stay projected-sourced.')
    expectTrue(segment.source.reference.geometryId === 'projected_geometry_circle', 'Projected circle identity should survive region derivation.')
    expectTrue(definition.points.length === 0 && definition.entities.length === 0, 'Projected-only regions must not author copied sketch geometry.')
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

    expectTrue(derived.regions.length === 0, 'Missing projected data must not invent profile regions.')
    expectTrue(
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

    expectTrue(derived.regions.length === 0, 'Unauthored projected data must not create profile regions.')
    expectTrue(
      derived.diagnostics.some((diagnostic) => diagnostic.code === 'projected-region-reference-unauthored'),
      'Unauthored projected data should report a machine-readable diagnostic.',
    )
    expectTrue(definition.points.length === 0 && definition.entities.length === 0, 'Rejected projected regions must not copy geometry into the sketch.')
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

    expectTrue(derived.regions.length === 0, 'Projection data without an authored reference record must not create profile regions.')
    expectTrue(
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
    expectTrue(found.rings.length === 1, 'A standalone circle should produce one ring.')

    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot,
    })

    expectTrue(derived.regions.length === 1, 'A standalone circle should derive one selectable region.')
    expectTrue(derived.regions[0]?.loops[0]?.segments.length === 1, 'Circle regions should use the circle entity as one closed segment.')
    expectTrue(derived.regions[0]?.loops[0]?.segments[0]?.startPointId === null, 'Circle region segments should not invent boundary points.')
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

    expectTrue(derived.regions.length === 1, 'A square with an inner circle should derive one even-parity solid region.')
    expectTrue(derived.regions[0]?.loops.length === 2, 'Outer cell should include the circle as an inner loop.')
    expectTrue(
      derived.regions[0]?.loops[1]?.segments[0]?.source.kind === 'entity'
      && derived.regions[0]?.loops[1]?.segments[0]?.source.entityId === 'sketch_entity_circle',
      'The inner loop should be bounded by the circle entity.',
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

    expectTrue(derived.regions.length === 1, 'Construction line, arc, and circle geometry must not split or remove a normal profile.')
    expectTrue(
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

    expectTrue(found.rings.length === 0, 'Closed construction circles should not produce sketch rings.')
    expectTrue(derived.regions.length === 0, 'Closed construction circles should not create selectable profile regions.')
  }

  async function testSelfIntersectingProfileIsRejectedWithDiagnostic() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c', 'sketch_point_d'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 2, 2),
        makePoint('sketch_point_c', 'C', 0, 2),
        makePoint('sketch_point_d', 'D', 2, 0),
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

    const solvedSnapshot = makeSolvedSnapshot(definition)
    const found = findSketchRings(definition, solvedSnapshot)
    const derived = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot,
    })

    expectTrue(found.rings.length === 0, 'Self-intersecting profile loops should not produce valid rings.')
    expectTrue(derived.regions.length === 0, 'Self-intersecting profile loops should not become selectable regions.')
    expectTrue(
      derived.diagnostics.some((diagnostic) => diagnostic.code === 'profile-invalid-ring'),
      'Rejected self-intersections should emit a diagnostic before reaching OCC.',
    )
  }

  async function testOpenAndDegenerateSegmentsAreSurfacedAsDiagnostics() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 2, 0),
        makePoint('sketch_point_c', 'C', 2, 0),
      ],
      entityIds: ['sketch_entity_open', 'sketch_entity_zero'],
      entities: [
        makeLine('sketch_entity_open', 'Open', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_zero', 'Zero', 'sketch_point_b', 'sketch_point_c'),
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

    expectTrue(derived.regions.length === 0, 'Open and degenerate profile segments should not create regions.')
    expectTrue(
      derived.diagnostics.some((diagnostic) => diagnostic.code === 'profile-open-segment'),
      'Open profile segments should be reported as diagnostics.',
    )
    expectTrue(
      derived.diagnostics.some((diagnostic) => diagnostic.code === 'profile-degenerate-segment'),
      'Degenerate profile segments should be reported as diagnostics.',
    )
  }

  async function testArcAndChordDeriveSingleClosedRegion() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_center', 'sketch_point_start', 'sketch_point_end'],
      points: [
        makePoint('sketch_point_center', 'Center', 0, 0),
        makePoint('sketch_point_start', 'Start', 1, 0),
        makePoint('sketch_point_end', 'End', -1, 0),
      ],
      entityIds: ['sketch_entity_arc', 'sketch_entity_chord'],
      entities: [
        makeArc('sketch_entity_arc', 'Arc', 'sketch_point_center', 'sketch_point_start', 'sketch_point_end'),
        makeLine('sketch_entity_chord', 'Chord', 'sketch_point_end', 'sketch_point_start'),
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

    expectTrue(derived.regions.length === 1, 'An arc and its chord should derive one closed D-shaped region.')
    const outerLoop = derived.regions[0]?.loops[0]
    expectTrue(!!outerLoop, 'Derived arc-chord region should include an outer loop.')
    expectTrue(outerLoop?.segments.length === 2, 'Derived arc-chord loop should preserve the two authored boundary segments.')
    expectTrue(
      outerLoop?.segments[0]?.source.kind === 'entity' && outerLoop.segments[0].source.entityId === 'sketch_entity_arc',
      'Derived arc-chord loop should keep the arc as the first boundary segment.',
    )
    expectTrue(
      outerLoop?.segments[1]?.source.kind === 'entity' && outerLoop.segments[1].source.entityId === 'sketch_entity_chord',
      'Derived arc-chord loop should keep the chord as the second boundary segment.',
    )
  }

  async function run() {
    await testFindRingsNone()
    await testFindRingsOne()
    await testJiggledRectangleRegionsStayStableAndPositioned()
    await testEndpointSelectionResidualsDeriveAdjacentProfiles()
    await testRegionIdsSurviveSortOrderChanges()
    await testFindRingsMultipleAndDeriveRegions()
    await testThreeLevelNestingKeepsIslandSolid()
    await testMixedLocalAndProjectedLoopPreservesProjectedIdentity()
    await testProjectedOnlyCircleLoopPreservesProjectedIdentity()
    await testMissingProjectedReferencesReportDiagnosticsWithoutInventingGeometry()
    await testUnauthoredProjectedReferencesReportDiagnosticsWithoutInventingGeometry()
    await testProjectedReferenceMissingAuthoredRecordIsRejected()
    await testFindCircleRegion()
    await testSquareWithInnerCircleDerivesAllBoundedCells()
    await testConstructionGeometryDoesNotSplitNormalProfile()
    await testClosedConstructionCircleDoesNotCreateRegion()
    await testSelfIntersectingProfileIsRejectedWithDiagnostic()
    await testOpenAndDegenerateSegmentsAreSurfacedAsDiagnostics()
    await testArcAndChordDeriveSingleClosedRegion()
  }

  run().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
})
