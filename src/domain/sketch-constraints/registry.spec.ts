import { test } from 'bun:test'
import {
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
    assert(
      getSketchAnnotationDescriptors(session).some((annotation) => annotation.target.kind === 'constraint'),
      'Committed geometric constraints should be exposed as durable annotation descriptors.',
    )
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

    session = selectSketchAnnotation(session, annotation!.target)
    session = deleteSelectedSketchAnnotation(session)

    assert(session.definition.dimensionIds.length === 0, 'Deleting the selected dimension should remove the durable dimension record.')
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
  testDistancePreviewUsesPartialTargetAndPointer()
  testPointDistanceReferenceSelectionFollowsPointer()
  testDistancePreviewUpdatesWhenPointerChangesReference()
  testConstraintPreviewStopsMovingAfterPinClick()
})
