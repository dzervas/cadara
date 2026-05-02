import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import {
  acceptSketchDraw,
  beginSketchAnnotationEdit,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deleteSelectedSketchAnnotation,
  deleteSelectedSketchGeometry,
  deriveSketchDisplayEntities,
  getSketchHistoryItems,
  moveSketchHistoryCursor,
  patchSketchConstraintValue,
  selectSketchAnnotation,
  selectSketchConstraintTarget,
  startSketchDraw,
} from '@/domain/editor/sketch-session'

test('src/domain/editor/durable-sketch-authoring-operations.spec.ts', () => {  function createRectangleSession() {
    let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    session = beginSketchTool(session, 'rectangle')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [4, 2])
    return session
  }

  const rectangle = createRectangleSession()
  const rectangleOperation = rectangle.fullDefinition.authoringOperations?.[0]
  expectTrue(rectangleOperation?.kind === 'rectangle', 'Rectangle creation should append one rectangle operation.')
  expectTrue(rectangle.fullDefinition.authoringOperations?.length === 1, 'One accepted rectangle action should create one operation row.')
  expectTrue(rectangleOperation.targets.created?.filter((target) => target.kind === 'entity').length === 4, 'Rectangle operation should reference created line entities.')
  expectTrue(rectangleOperation.targets.created?.filter((target) => target.kind === 'constraint').length === 4, 'Rectangle operation should include constructor constraints.')
  expectTrue(rectangleOperation.targets.created?.filter((target) => target.kind === 'dimension').length === 2, 'Rectangle operation should include constructor dimensions.')
  expectTrue(getSketchHistoryItems(rectangle.fullDefinition).length === 1, 'Sketch history should show one rectangle operation row.')

  const edgeId = rectangle.definition.entityIds[0]
  expectTrue(edgeId, 'Rectangle should create an edge to delete.')
  const deleted = deleteSelectedSketchGeometry(rectangle, [
    { kind: 'sketchEntity', sketchId: 'sketch_draft', entityId: edgeId },
  ])
  const deleteOperation = deleted.fullDefinition.authoringOperations?.[1]
  expectTrue(deleteOperation?.kind === 'delete', 'Deleting rectangle geometry should append a delete operation.')
  expectTrue(deleted.definition.entityIds.length === 3, 'Deleted geometry should be removed from the live flat graph.')
  expectTrue(!deleted.definition.entityIds.includes(edgeId), 'Deleted edge should be absent from the current definition.')
  expectTrue(!deleted.commitRequest?.definition.entityIds.includes(edgeId), 'Deleted edge should be absent from commit payloads.')
  expectTrue(
    !deriveSketchDisplayEntities(deleted).some((entity) => entity.entityId === edgeId),
    'Deleted edge should be absent from renderable sketch display output.',
  )

  const rolledBack = moveSketchHistoryCursor(deleted, { kind: 'item', itemId: rectangleOperation.operationId })
  expectTrue(rolledBack.definition.entityIds.length === 4, 'Cursor rollback before delete should rebuild the rectangle graph.')
  const rolledForward = moveSketchHistoryCursor(deleted, { kind: 'item', itemId: deleteOperation.operationId })
  expectTrue(rolledForward.definition.entityIds.length === 3, 'Cursor at delete operation should keep deleted members absent.')

  const widthDimension = rectangle.definition.dimensions.find((dimension) => dimension.label.includes('width'))
  expectTrue(widthDimension, 'Rectangle should create an editable width dimension.')
  let edited = beginSketchAnnotationEdit(rectangle, {
    kind: 'dimension',
    sketchId: 'sketch_draft',
    dimensionId: widthDimension.dimensionId,
  })
  edited = patchSketchConstraintValue(edited, { value: 6 })
  edited = patchSketchConstraintValue(edited, { intent: 'commitAnnotationValue' })
  expectTrue(edited.fullDefinition.authoringOperations?.length === 1, 'Explicit dimension edit should not append delete/add operations.')
  expectTrue(
    edited.definition.dimensions.find((dimension) => dimension.dimensionId === widthDimension.dimensionId)?.value === 6,
    'Explicit dimension edit should update the live graph value.',
  )
  expectTrue(
    edited.fullDefinition.authoringOperations?.[0]?.createdGraph?.dimensions?.find((dimension) =>
      dimension.dimensionId === widthDimension.dimensionId,
    )?.value === 6,
    'Explicit dimension edit should update the original operation metadata.',
  )

  const graphWithMetadata = rectangle.fullDefinition
  const graphWithDifferentMetadata = {
    ...graphWithMetadata,
    authoringOperations: [
      {
        operationId: 'sketch_operation_999_metadata_only',
        label: 'Different metadata',
        kind: 'operation',
        targets: { removed: [{ kind: 'entity', entityId: edgeId }] },
      },
    ],
  }
  const firstSolve = solveSketchDefinitionCore({
    definition: graphWithMetadata,
    projectedReferences: [],
    tolerances: { coincidence: 1e-6, angleRadians: 1e-6, minimumSegmentLength: 1e-6 },
    partialSolvePolicy: 'bestEffort',
  })
  const secondSolve = solveSketchDefinitionCore({
    definition: graphWithDifferentMetadata,
    projectedReferences: [],
    tolerances: { coincidence: 1e-6, angleRadians: 1e-6, minimumSegmentLength: 1e-6 },
    partialSolvePolicy: 'bestEffort',
  })
  expectTrue(
    JSON.stringify(firstSolve.solvedSnapshot.solvedEntities) === JSON.stringify(secondSolve.solvedSnapshot.solvedEntities),
    'Different operation metadata over the same flat graph should not change solved output.',
  )

  let constraintSession = createRectangleSession()
  const firstEdge = constraintSession.definition.entityIds[0]
  const oppositeEdge = constraintSession.definition.entityIds[2]
  expectTrue(firstEdge && oppositeEdge, 'Rectangle should create two edges for manual constraint testing.')
  constraintSession = beginSketchTool(constraintSession, 'constraintEqual')
  constraintSession = selectSketchConstraintTarget(constraintSession, {
    kind: 'sketchEntity',
    sketchId: 'sketch_draft',
    entityId: firstEdge,
  })
  constraintSession = selectSketchConstraintTarget(constraintSession, {
    kind: 'sketchEntity',
    sketchId: 'sketch_draft',
    entityId: oppositeEdge,
  })
  const firstManualConstraint = constraintSession.definition.constraints.find((constraint) => constraint.kind === 'equalLength')
  expectTrue(firstManualConstraint, 'Manual constraint authoring should add a live constraint.')
  expectTrue(
    constraintSession.fullDefinition.authoringOperations?.at(-1)?.kind === 'constraint',
    'Manual constraint authoring should append its own operation.',
  )

  constraintSession = selectSketchAnnotation(constraintSession, {
    kind: 'constraint',
    sketchId: 'sketch_draft',
    constraintId: firstManualConstraint.constraintId,
  })
  constraintSession = deleteSelectedSketchAnnotation(constraintSession)
  expectTrue(
    !constraintSession.definition.constraintIds.includes(firstManualConstraint.constraintId),
    'Deleted manual constraint should be absent from the live graph.',
  )
  expectTrue(
    constraintSession.fullDefinition.authoringOperations?.at(-1)?.kind === 'delete',
    'Manual constraint deletion should append a delete operation.',
  )

  constraintSession = beginSketchTool(constraintSession, 'constraintEqual')
  constraintSession = selectSketchConstraintTarget(constraintSession, {
    kind: 'sketchEntity',
    sketchId: 'sketch_draft',
    entityId: firstEdge,
  })
  constraintSession = selectSketchConstraintTarget(constraintSession, {
    kind: 'sketchEntity',
    sketchId: 'sketch_draft',
    entityId: oppositeEdge,
  })
  const liveEqualLengthConstraints = constraintSession.definition.constraints.filter((constraint) => constraint.kind === 'equalLength')
  expectTrue(liveEqualLengthConstraints.length === 1, 'Add/delete/add constraint flow should leave only the newly added live constraint.')
  expectTrue(
    liveEqualLengthConstraints[0]?.constraintId !== firstManualConstraint.constraintId,
    'Recreated constraint should have a new durable constraint id.',
  )
  expectTrue(
    constraintSession.fullDefinition.authoringOperations?.map((operation) => operation.kind).slice(-3).join(',') === 'constraint,delete,constraint',
    'Durable operation history should preserve add/delete/add constraint operations in order.',
  )

  const recreatedSource = createRectangleSession()
  const firstRectangleEntityIds = [...recreatedSource.definition.entityIds]
  let recreated = deleteSelectedSketchGeometry(
    recreatedSource,
    firstRectangleEntityIds.map((entityId) => ({
      kind: 'sketchEntity' as const,
      sketchId: 'sketch_draft' as const,
      entityId,
    })),
  )
  expectTrue(recreated.definition.entityIds.length === 0, 'Deleting all rectangle geometry should clear the live flat graph.')
  recreated = beginSketchTool(recreated, 'rectangle')
  recreated = startSketchDraw(recreated, [6, 0])
  recreated = acceptSketchDraw(recreated, [9, 3])
  expectTrue(
    recreated.definition.entityIds.every((entityId) => !firstRectangleEntityIds.includes(entityId)),
    'Rectangle delete/recreate should leave only the recreated rectangle geometry live.',
  )
  expectTrue(
    recreated.fullDefinition.authoringOperations?.map((operation) => operation.kind).join(',') === 'rectangle,delete,rectangle',
    'Durable operation history should preserve original rectangle, delete, and recreated rectangle operations.',
  )
})
