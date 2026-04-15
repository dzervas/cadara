import { test } from 'bun:test'
import {
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deleteSelectedSketchAnnotation,
  getSketchAnnotationDescriptors,
  getSketchToolPresentation,
  patchSketchConstraintValue,
  selectSketchAnnotation,
  selectSketchConstraintTarget,
  startSketchDraw,
  acceptSketchDraw,
} from '@/domain/editor/sketch-session'
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
    const [firstPointId, secondPointId] = session.definition.pointIds

    session = beginSketchTool(session, 'dimensionDistance')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: firstPointId!,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: secondPointId!,
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

  testToolbarDefinitionsExposeConstraintFamilies()
  testGeometricConstraintAuthoringCommitsDurableRecord()
  testDimensionalConstraintShowsFloatingInputAndSupportsDeletion()
})
