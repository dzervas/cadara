import { test } from 'bun:test'
import {
  beginSketchAnnotationEdit,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deleteSelectedSketchAnnotation,
  getSketchAnnotationDescriptors,
  getSketchToolPresentation,
  patchSketchConstraintValue,
  pinSketchConstraintPreview,
  selectSketchAnnotation,
  selectSketchConstraintTarget,
  startSketchDraw,
  acceptSketchDraw,
  updateSketchPointer,
} from '@/domain/editor/sketch-session'
import { selectPointToPointDimensionReference } from '@/domain/sketch-constraints/registry'
import { getToolById } from '@/domain/tools/tool-registry'

test('src/domain/sketch-constraints/registry.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function createSessionWithTwoLines() {
    let session = createNewSketchSessionFromSupport({
      kind: 'construction',
      constructionId: 'construction_plane-xy',
    })

    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [10, 0])

    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 5])
    session = acceptSketchDraw(session, [10, 5])

    return session
  }

  function testToolbarDefinitionsExposeConstraintFamilies() {
    const dimensionTool = getToolById('dimension')
    assert('dropdown' in dimensionTool && Boolean(dimensionTool.dropdown), 'Dimension tool should expose a dropdown family.')
    assert(
      JSON.stringify(dimensionTool.dropdown?.variantIds) === JSON.stringify([
        'dimensionDistance',
        'dimensionHorizontal',
        'dimensionVertical',
        'dimensionRadius',
      ]),
      'Dimension dropdown should expose the supported dimensional authoring variants.',
    )
  }

  function testGeometricConstraintAuthoringCommitsDurableRecord() {
    let session = createSessionWithTwoLines()
    const [firstLineId, secondLineId] = session.definition.entityIds

    session = beginSketchTool(session, 'constraintParallel')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: firstLineId!,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: secondLineId!,
    })

    assert(session.definition.constraintIds.length === 1, 'Parallel authoring should append one durable constraint record.')
    assert(session.constraintAuthoring === null, 'Geometric constraints should commit immediately after the final selection.')
    const annotation = getSketchAnnotationDescriptors(session).find((entry) => entry.target.kind === 'constraint')
    assert(annotation, 'Committed geometric constraints should be exposed as durable annotation descriptors.')
    assert(annotation.glyphKind === 'constraintParallel', 'Parallel constraints should expose a distinct glyph kind.')
    assert(annotation.anchor.kind === 'sketchPoint', 'Constraint descriptors should expose a viewport anchor.')
    assert(
      annotation.affectedGeometryRefs.length === 2
        && annotation.affectedGeometryRefs.every((target) => target.kind === 'sketchEntity'),
      'Constraint descriptors should expose affected sketch geometry refs.',
    )

    session = selectSketchAnnotation(session, annotation.target)
    session = deleteSelectedSketchAnnotation(session)

    assert(session.definition.constraintIds.length === 0, 'Deleting the selected constraint should remove the durable constraint record.')
  }

  function testDimensionalConstraintShowsFloatingInputAndSupportsDeletion() {
    let session = createSessionWithTwoLines()
    const [firstPointId, , , diagonalPointId] = session.definition.pointIds

    session = beginSketchTool(session, 'dimensionDistance')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: firstPointId!,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: diagonalPointId!,
    })

    const presentation = getSketchToolPresentation(session)
    assert(presentation?.floatingInput?.label === 'Distance', 'Distance authoring should request a floating numeric input.')

    session = patchSketchConstraintValue(session, { value: 24 })
    session = patchSketchConstraintValue(session, { intent: 'commitConstraintValue' })

    const annotation = getSketchAnnotationDescriptors(session).find(
      (entry) => entry.target.kind === 'dimension',
    )
    assert(annotation, 'Committed dimensions should be exposed as durable annotation descriptors.')
    assert(annotation.glyphKind === 'dimensionDistance', 'Distance dimensions should expose a distinct glyph kind.')
    assert(annotation.anchor.kind === 'sketchPoint', 'Dimension descriptors should expose a viewport anchor.')
    assert(
      annotation.affectedGeometryRefs.length === 2
        && annotation.affectedGeometryRefs.every((target) => target.kind === 'sketchPoint'),
      'Dimension descriptors should expose affected sketch point refs.',
    )

    session = selectSketchAnnotation(session, annotation!.target)
    session = deleteSelectedSketchAnnotation(session)

    assert(session.definition.dimensionIds.length === 0, 'Deleting the selected dimension should remove the durable dimension record.')
  }

  function testCommittedDimensionAnnotationReopensValueInputAndEditsDurableRecord() {
    let session = createSessionWithTwoLines()
    const [firstPointId, , , diagonalPointId] = session.definition.pointIds

    session = beginSketchTool(session, 'dimensionDistance')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: firstPointId!,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: diagonalPointId!,
    })
    session = patchSketchConstraintValue(session, { value: 24 })
    session = patchSketchConstraintValue(session, { intent: 'commitConstraintValue' })

    const annotation = getSketchAnnotationDescriptors(session).find(
      (entry) => entry.target.kind === 'dimension',
    )
    assert(annotation?.target.kind === 'dimension', 'Committed dimension should expose an editable annotation target.')

    session = beginSketchAnnotationEdit(session, annotation.target)

    const input = getSketchToolPresentation(session)?.floatingInput
    assert(input?.label === 'Distance', 'Double-clicking a distance annotation should reopen its value input.')
    assert(input.value === 24, 'The reopened distance input should use the durable dimension value.')

    session = patchSketchConstraintValue(session, { value: 31 })
    session = patchSketchConstraintValue(session, { intent: 'commitAnnotationValue' })

    assert(
      session.definition.dimensions[0]?.kind === 'distance' && session.definition.dimensions[0].value === 31,
      'Committing the reopened distance input should update the durable dimension record.',
    )
    assert(
      session.commitRequest?.definition.dimensions[0]?.kind === 'distance'
        && session.commitRequest.definition.dimensions[0].value === 31,
      'Committing the reopened distance input should update the durable sketch mutation payload.',
    )
  }

  function testCommittedRectangleWidthEditSolvesDraftGeometry() {
    let session = createNewSketchSessionFromSupport({
      kind: 'construction',
      constructionId: 'construction_plane-xy',
    })

    session = beginSketchTool(session, 'rectangle')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [10, 5])

    const annotation = getSketchAnnotationDescriptors(session).find(
      (entry) => entry.glyphKind === 'dimensionHorizontal' && entry.target.kind === 'dimension',
    )
    assert(annotation?.target.kind === 'dimension', 'Rectangle width should expose an editable horizontal dimension.')

    session = beginSketchAnnotationEdit(session, annotation.target)
    session = patchSketchConstraintValue(session, { value: 20 })
    session = patchSketchConstraintValue(session, { intent: 'commitAnnotationValue' })

    const dimension = session.definition.dimensions.find((entry) => entry.dimensionId === annotation.target.dimensionId)
    assert(dimension?.kind === 'distance' && dimension.value === 20, 'Width edit should update the durable dimension.')
    assert(dimension.pointIds.length === 2, 'Width dimension should keep its point pair.')

    const points = new Map(session.definition.points.map((point) => [point.pointId, point.position]))
    const left = points.get(dimension.pointIds[0]!)
    const right = points.get(dimension.pointIds[1]!)
    assert(left && right, 'Edited width dimension should reference solved draft points.')
    assert(Math.abs((right[0] - left[0]) - 20) < 1e-4, 'Width edit should solve the draft geometry before finish.')
    const payloadDimension = session.commitRequest?.definition.dimensions.find(
      (entry) => entry.dimensionId === annotation.target.dimensionId,
    )
    assert(
      payloadDimension?.kind === 'distance' && payloadDimension.value === 20,
      'Width edit should update the durable sketch mutation payload.',
    )
  }

  function testCommittedCircleRadiusEditUpdatesEntityRadius() {
    let session = createNewSketchSessionFromSupport({
      kind: 'construction',
      constructionId: 'construction_plane-xy',
    })

    session = beginSketchTool(session, 'circle')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [10, 0])

    const annotation = getSketchAnnotationDescriptors(session).find(
      (entry) => entry.glyphKind === 'dimensionRadius' && entry.target.kind === 'dimension',
    )
    assert(annotation?.target.kind === 'dimension', 'Circle radius should expose an editable radius dimension.')

    session = beginSketchAnnotationEdit(session, annotation.target)
    session = patchSketchConstraintValue(session, { value: 18 })
    session = patchSketchConstraintValue(session, { intent: 'commitAnnotationValue' })

    const dimension = session.definition.dimensions.find((entry) => entry.dimensionId === annotation.target.dimensionId)
    assert(dimension?.kind === 'circleRadius' && dimension.value === 18, 'Radius edit should update the durable dimension.')
    const circle = session.definition.entities.find((entity) => entity.kind === 'circle')
    assert(circle?.kind === 'circle' && circle.radius === 18, 'Radius edit should update the authored circle radius.')
    const payloadCircle = session.commitRequest?.definition.entities.find((entity) => entity.kind === 'circle')
    assert(
      payloadCircle?.kind === 'circle' && payloadCircle.radius === 18,
      'Radius edit should update the durable sketch mutation payload.',
    )
  }

  function testDistancePreviewUsesPartialTargetAndPointer() {
    let session = createSessionWithTwoLines()
    const [firstPointId] = session.definition.pointIds

    session = beginSketchTool(session, 'dimensionDistance')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: firstPointId!,
    })
    session = updateSketchPointer(session, [8, 3])

    const dimensionPreview = getSketchToolPresentation(session)?.overlays?.find(
      (overlay) => overlay.id === 'distance-preview',
    )

    assert(
      dimensionPreview?.kind === 'dimensionLine'
        && dimensionPreview.referenceKind === 'aligned'
        && dimensionPreview.end[0] === 8
        && dimensionPreview.end[1] === 3,
      'Distance authoring should emit a transient dimension line from one selected point to the active pointer.',
    )
  }

  function testPointDistanceReferenceSelectionFollowsPointer() {
    assert(
      selectPointToPointDimensionReference({ first: [0, 0], second: [10, 4], pointer: [5, 2] }) === 'aligned',
      'Pointer near the point-to-point segment should keep the aligned reference.',
    )
    assert(
      selectPointToPointDimensionReference({ first: [0, 0], second: [10, 4], pointer: [5, 12] }) === 'horizontal',
      'Pointer above the target span should select the horizontal distance reference.',
    )
    assert(
      selectPointToPointDimensionReference({ first: [0, 0], second: [10, 4], pointer: [18, 2] }) === 'vertical',
      'Pointer beside the target span should select the vertical distance reference.',
    )
  }

  function testDistancePreviewUpdatesWhenPointerChangesReference() {
    let session = createSessionWithTwoLines()
    const [firstPointId, , , diagonalPointId] = session.definition.pointIds

    session = beginSketchTool(session, 'dimensionDistance')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: firstPointId!,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: diagonalPointId!,
    })
    session = updateSketchPointer(session, [5, 12])

    const horizontalPreview = getSketchToolPresentation(session)?.overlays?.find(
      (overlay) => overlay.id === 'distance-preview',
    )

    session = updateSketchPointer(session, [18, 2])

    const verticalPreview = getSketchToolPresentation(session)?.overlays?.find(
      (overlay) => overlay.id === 'distance-preview',
    )

    assert(
      horizontalPreview?.kind === 'dimensionLine' && horizontalPreview.referenceKind === 'horizontal',
      'Distance preview should select a horizontal reference when the pointer is above the target span.',
    )
    assert(
      verticalPreview?.kind === 'dimensionLine' && verticalPreview.referenceKind === 'vertical',
      'Distance preview should update to a vertical reference as the pointer moves beside the target span.',
    )
  }

  function testConstraintPreviewStopsMovingAfterPinClick() {
    let session = createSessionWithTwoLines()
    const [firstPointId, , , diagonalPointId] = session.definition.pointIds

    session = beginSketchTool(session, 'dimensionDistance')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: firstPointId!,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: diagonalPointId!,
    })
    session = updateSketchPointer(session, [5, 12])
    session = pinSketchConstraintPreview(session, [5, 12])

    const pinnedPreview = getSketchToolPresentation(session)?.overlays?.find(
      (overlay) => overlay.id === 'distance-preview',
    )

    session = updateSketchPointer(session, [18, 2])

    const afterMovePreview = getSketchToolPresentation(session)?.overlays?.find(
      (overlay) => overlay.id === 'distance-preview',
    )

    assert(
      pinnedPreview?.kind === 'dimensionLine'
        && afterMovePreview?.kind === 'dimensionLine'
        && pinnedPreview.referenceKind === 'horizontal'
        && afterMovePreview.referenceKind === 'horizontal'
        && afterMovePreview.start[1] === pinnedPreview.start[1],
      'Pinned constraint previews should not move while the pointer travels to the Commit button.',
    )
  }

  testToolbarDefinitionsExposeConstraintFamilies()
  testGeometricConstraintAuthoringCommitsDurableRecord()
  testDimensionalConstraintShowsFloatingInputAndSupportsDeletion()
  testCommittedDimensionAnnotationReopensValueInputAndEditsDurableRecord()
  testCommittedRectangleWidthEditSolvesDraftGeometry()
  testCommittedCircleRadiusEditUpdatesEntityRadius()
  testDistancePreviewUsesPartialTargetAndPointer()
  testPointDistanceReferenceSelectionFollowsPointer()
  testDistancePreviewUpdatesWhenPointerChangesReference()
  testConstraintPreviewStopsMovingAfterPinClick()
})
