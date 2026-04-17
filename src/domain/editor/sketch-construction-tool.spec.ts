import { test } from 'bun:test'

import type { SketchDefinition } from '@/contracts/sketch/schema'
import {
  acceptSketchDraw,
  beginSketchGeometryDrag,
  beginSketchTool,
  clearActiveSketchTool,
  createSketchSessionFromSnapshot,
  getSketchSessionDisplayRenderables,
  startSketchDraw,
  toggleSketchConstructionTarget,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import type { SketchSnapshotRecord } from '@/contracts/modeling/schema'

test('src/domain/editor/sketch-construction-tool.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function makePoint(pointId: string, label: string, x: number, y: number, isConstruction = false) {
    return {
      pointId: pointId as `sketch_point_${string}`,
      label,
      target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: pointId as `sketch_point_${string}` } as const,
      position: [x, y] as const,
      isConstruction,
    }
  }

  function makeLine(
    entityId: string,
    label: string,
    startPointId: string,
    endPointId: string,
    isConstruction = false,
  ) {
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

  function makePointEntity(entityId: string, label: string, pointId: string, isConstruction = false) {
    return {
      kind: 'point' as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: entityId as `sketch_entity_${string}` } as const,
      isConstruction,
      pointId: pointId as `sketch_point_${string}`,
    }
  }

  function createDefinition(): SketchDefinition {
    return {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 1, 0),
        makePoint('sketch_point_c', 'C', 2, 0),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_bc', 'sketch_entity_c'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
        makePointEntity('sketch_entity_c', 'C point', 'sketch_point_c'),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }
  }

  function createSession(definition: SketchDefinition = createDefinition()) {
    const plane = createStandardPlaneDefinition('xy')
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: 'bestEffort',
    })

    return createSketchSessionFromSnapshot({
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_primary',
      ownerBodyId: null,
      sketchId: 'sketch_primary',
      label: 'Sketch',
      plane,
      planeTarget: plane.support,
      planeKey: 'xy',
      sketch: {
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_0001',
        ownerFeatureId: null,
        ownerSketchId: 'sketch_primary',
        ownerBodyId: null,
        sketchId: 'sketch_primary',
        label: 'Sketch',
        planeSupport: plane.support,
        definition,
        solvedSnapshot: solved.solvedSnapshot,
        regions: [],
      },
    } satisfies SketchSnapshotRecord)
  }

  function testConstructionActivationModes() {
    let session = beginSketchTool(createSession(), 'construction')
    assert(session.activeTool === 'construction', 'Construction activation should arm target-picking.')
    assert(session.constructionTargetPicking, 'Construction target-picking should be explicit editor state.')
    assert(!session.constructionModifierActive, 'First construction activation should not immediately set the modifier.')

    session = beginSketchTool(session, 'line')
    assert(session.activeTool === 'line', 'Drawing tool activation should become the active geometry tool.')
    assert(!session.constructionTargetPicking, 'Drawing tool activation should leave target-picking mode.')
    assert(session.constructionModifierActive, 'Drawing tool activation after Construction should set persistent construction context.')

    session = beginSketchTool(session, 'construction')
    assert(session.activeTool === null, 'Second Construction activation should clear active construction state.')
    assert(!session.constructionModifierActive, 'Second Construction activation should turn off construction authoring.')
  }

  function testConstructionStateCleanup() {
    let session = beginSketchTool(createSession(), 'construction')
    session = clearActiveSketchTool(session)

    assert(session.activeTool === null, 'Clearing the active sketch tool should clear Construction target-picking.')
    assert(!session.constructionTargetPicking, 'Clearing the active sketch tool should clear target-picking state.')

    session = beginSketchTool(beginSketchTool(session, 'construction'), 'line')
    session = clearActiveSketchTool(session)

    assert(!session.constructionModifierActive, 'Clearing the active sketch tool should clear persistent construction context.')
  }

  function testConstructionToggleMutatesOnlySelectedEntity() {
    let session = beginSketchTool(createSession(), 'construction')
    session = toggleSketchConstructionTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_ab',
    })

    assert(
      session.definition.entities.find((entity) => entity.entityId === 'sketch_entity_ab')?.isConstruction,
      'Selected edge should toggle to construction.',
    )
    assert(
      session.definition.points.every((point) => !point.isConstruction),
      'Edge toggles must not mutate shared endpoint point records.',
    )
    assert(
      session.commitRequest?.definition.entities.find((entity) => entity.entityId === 'sketch_entity_ab')?.isConstruction,
      'Construction edge toggles should prepare an authored sketch commit mutation.',
    )

    session = beginSketchTool(session, 'construction')
    session = toggleSketchConstructionTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_ab',
    })
    assert(
      !session.definition.entities.find((entity) => entity.entityId === 'sketch_entity_ab')?.isConstruction,
      'Selecting a construction edge again should toggle it back to normal.',
    )
  }

  function testConstructionVertexToggleIncludesPointEntity() {
    let session = beginSketchTool(createSession(), 'construction')
    session = toggleSketchConstructionTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_primary',
      pointId: 'sketch_point_c',
    })

    assert(
      session.definition.points.find((point) => point.pointId === 'sketch_point_c')?.isConstruction,
      'Selected point should toggle to construction.',
    )
    assert(
      session.definition.entities.find((entity) => entity.entityId === 'sketch_entity_c')?.isConstruction,
      'Point-entity records associated with the selected point should toggle too.',
    )
    assert(
      !session.definition.entities.find((entity) => entity.entityId === 'sketch_entity_bc')?.isConstruction,
      'Non-point entities sharing that vertex should not be implicitly toggled.',
    )

    session = beginSketchTool(session, 'construction')
    session = toggleSketchConstructionTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_c',
    })

    assert(
      !session.definition.points.find((point) => point.pointId === 'sketch_point_c')?.isConstruction,
      'Selecting a construction point-entity should toggle its point record back to normal.',
    )
    assert(
      !session.definition.entities.find((entity) => entity.entityId === 'sketch_entity_c')?.isConstruction,
      'Selecting a construction point-entity should toggle that entity back to normal.',
    )
  }

  function testConstructionModifierAuthorsNewGeometry() {
    let session = beginSketchTool(createSession(), 'construction')
    session = beginSketchTool(session, 'rectangle')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [4, 3])

    assert(
      session.definition.points.slice(-4).every((point) => point.isConstruction),
      'Construction context should author new rectangle points as construction.',
    )
    assert(
      session.definition.entities.slice(-4).every((entity) => entity.isConstruction),
      'Construction context should author new rectangle entities as construction.',
    )

    session = beginSketchTool(session, 'construction')
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 4])
    session = acceptSketchDraw(session, [1, 4])

    assert(
      session.definition.entities.at(-1)?.isConstruction === false,
      'Toggling Construction off should restore normal geometry authoring.',
    )
  }

  function testConstructionRenderableFeedbackIsDashedAndPickable() {
    const definition = createDefinition()
    definition.entities[0] = { ...definition.entities[0]!, isConstruction: true }
    let session = createSession(definition)
    const target = { kind: 'sketchEntity' as const, sketchId: 'sketch_primary' as const, entityId: 'sketch_entity_ab' as const }
    const constructionRenderable = getSketchSessionDisplayRenderables(session).find((renderable) =>
      renderable.target?.kind === 'sketchEntity' && renderable.target.entityId === 'sketch_entity_ab',
    )

    assert(constructionRenderable?.linePattern === 'dashed', 'Construction sketch edges should use dashed edit feedback.')
    assert(constructionRenderable.target?.kind === 'sketchEntity', 'Construction sketch edges should remain bound for picking.')

    session = beginSketchTool(session, 'construction')
    session = beginSketchGeometryDrag(session, target, [0, 0])
    assert(session.activeDrag === null, 'Construction target-picking should not start direct geometry drag.')
  }

  testConstructionActivationModes()
  testConstructionStateCleanup()
  testConstructionToggleMutatesOnlySelectedEntity()
  testConstructionVertexToggleIncludesPointEntity()
  testConstructionModifierAuthorsNewGeometry()
  testConstructionRenderableFeedbackIsDashedAndPickable()
})
