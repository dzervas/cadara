import { test } from 'bun:test'
import {
  deriveSketchRegionsCore,
  findSketchRings,
} from '@/contracts/sketch/region-extraction'
import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from '@/contracts/sketch/schema'

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

  function makeLine(entityId: string, label: string, startPointId: string, endPointId: string) {
    return {
      kind: 'lineSegment' as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: entityId as `sketch_entity_${string}` } as const,
      isConstruction: false,
      startPointId: startPointId as `sketch_point_${string}`,
      endPointId: endPointId as `sketch_point_${string}`,
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
        if (entity.kind !== 'lineSegment') {
          return []
        }
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
    assert(derived.regions.length === 1, 'Nested rectangles should derive one outer region with one inner void.')
    assert(derived.regions[0]?.loops.length === 2, 'Derived region should contain outer and inner loops.')
    assert(derived.regions[0]?.loops[0]?.role === 'outer', 'First loop should be outer.')
    assert(derived.regions[0]?.loops[1]?.role === 'inner', 'Second loop should be inner.')
  }

  async function run() {
    await testFindRingsNone()
    await testFindRingsOne()
    await testFindRingsMultipleAndDeriveRegions()
  }

  run().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
})
