import { test } from 'bun:test'
import {
  beginSketchAnnotationEdit,
  beginSketchTool,
  createNewSketchSession,
  createNewSketchSessionFromSupport,
  deleteSelectedSketchAnnotation,
  getSketchAnnotationDescriptors,
  getSketchToolPresentation,
  patchSketchConstraintValue,
  patchSketchDimensionAnnotationPlacement,
  pinSketchConstraintPreview,
  selectSketchAnnotation,
  selectSketchConstraintTarget,
  startSketchDraw,
  acceptSketchDraw,
  updateSketchReferenceProjection,
  updateSketchPointer,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { toolIconAssetFileNames } from '@/core/tools/tool-icons'
import {
  getRegisteredSketchConstraintDefinitions,
  selectPointToPointDimensionReference,
} from '@/core/sketch-constraints/registry'
import { getToolById, getToolbarSectionsForMode } from '@/core/tools/tool-registry'
import { mapSketchPointToWorkspaceWorld } from '@/core/workspace/sketch-plane-mapping'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'

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
    session = acceptSketchDraw(session, [10, 1])

    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 5])
    session = acceptSketchDraw(session, [10, 6])

    return session
  }

  function createSessionWithTwoCircles() {
    let session = createNewSketchSessionFromSupport({
      kind: 'construction',
      constructionId: 'construction_plane-xy',
    })

    session = beginSketchTool(session, 'circle')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [4, 0])

    session = beginSketchTool(session, 'circle')
    session = startSketchDraw(session, [10, 0])
    session = acceptSketchDraw(session, [12, 0])

    return session
  }

  function createSessionWithLineAndCircle() {
    let session = createNewSketchSessionFromSupport({
      kind: 'construction',
      constructionId: 'construction_plane-xy',
    })

    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [1, 4])
    session = acceptSketchDraw(session, [5, 4])

    session = beginSketchTool(session, 'circle')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [4, 0])

    return session
  }

  function addProjectedReference(
    session: ReturnType<typeof createNewSketchSessionFromSupport>,
    projectedReference: ProjectedSketchReferenceRecord,
  ) {
    const definitionWithReference = {
      ...session.definition,
      referenceIds: [projectedReference.referenceId],
      references: [{
        referenceId: projectedReference.referenceId,
        kind: 'modelReference',
        label: 'Projected reference',
        source: { kind: 'edge', bodyId: 'body_1', edgeId: 'edge_1' },
        projectionMode: 'projectAlongPlaneNormal',
      }],
    } as typeof session.definition

    return {
      ...updateSketchReferenceProjection(session, [projectedReference], []),
      definition: definitionWithReference,
      fullDefinition: definitionWithReference,
    }
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

    const newConstraintTools = {
      constraintHorizontal: 'sketch-horizontal.svg',
      constraintVertical: 'sketch-vertical.svg',
      constraintConcentric: 'sketch-concentric.svg',
      constraintMidpoint: 'sketch-midpoint.svg',
      constraintNormal: 'sketch-normal.svg',
      constraintPierce: 'sketch-pierce.svg',
      constraintSymmetric: 'sketch-symmetric.svg',
      constraintFix: 'sketch-fix.svg',
    } as const
    const sketchConstraintSection = getToolbarSectionsForMode('sketch').find((section) => section.id === 'constraints')
    const partToolIds = getToolbarSectionsForMode('part').flatMap((section) => section.toolIds)
    const registeredConstraintIds = new Set(
      getRegisteredSketchConstraintDefinitions().map((definition) => definition.metadata.id),
    )

    for (const [toolId, asset] of Object.entries(newConstraintTools)) {
      const tool = getToolById(toolId as keyof typeof newConstraintTools)
      assert(tool.group === 'constraints', `${toolId} should register in the sketch constraint group.`)
      assert(tool.modes.length === 1 && tool.modes[0] === 'sketch', `${toolId} should be sketch-only.`)
      assert(tool.icon === toolId, `${toolId} should use a stable matching icon id.`)
      assert(toolIconAssetFileNames[tool.icon] === asset, `${toolId} should map to ${asset}.`)
      assert(sketchConstraintSection?.toolIds.includes(tool.id), `${toolId} should be exposed in the sketch toolbar.`)
      assert(!partToolIds.includes(tool.id), `${toolId} should not be exposed in part mode.`)
      assert(registeredConstraintIds.has(tool.id), `${toolId} should have sketch constraint behavior registered.`)
    }
  }

  function testHorizontalAndVerticalAuthoringCommitDurableConstraints() {
    let horizontalSession = createSessionWithTwoLines()
    const [horizontalLineId] = horizontalSession.definition.entityIds
    assert(horizontalLineId, 'Expected a local line for horizontal authoring.')

    horizontalSession = beginSketchTool(horizontalSession, 'constraintHorizontal')
    horizontalSession = selectSketchConstraintTarget(horizontalSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: horizontalLineId,
    })

    const horizontalConstraint = horizontalSession.definition.constraints.at(-1)
    assert(horizontalConstraint?.kind === 'horizontal', 'Horizontal should commit a durable horizontal constraint.')
    assert(horizontalConstraint.entityId === horizontalLineId, 'Horizontal should target the selected line entity.')
    assert(horizontalSession.definition.dimensions.length === 0, 'Horizontal should not append a dimension record.')
    assert(
      getSketchAnnotationDescriptors(horizontalSession).some((entry) => entry.glyphKind === 'constraintHorizontal'),
      'Horizontal constraints should expose the horizontal glyph in committed annotations.',
    )

    let verticalSession = createSessionWithTwoLines()
    const [, verticalLineId] = verticalSession.definition.entityIds
    assert(verticalLineId, 'Expected a second local line for vertical authoring.')

    verticalSession = beginSketchTool(verticalSession, 'constraintVertical')
    verticalSession = selectSketchConstraintTarget(verticalSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: verticalLineId,
    })

    const verticalConstraint = verticalSession.definition.constraints.at(-1)
    assert(verticalConstraint?.kind === 'vertical', 'Vertical should commit a durable vertical constraint.')
    assert(verticalConstraint.entityId === verticalLineId, 'Vertical should target the selected line entity.')
    assert(verticalSession.definition.dimensions.length === 0, 'Vertical should not append a dimension record.')
    assert(
      getSketchAnnotationDescriptors(verticalSession).some((entry) => entry.glyphKind === 'constraintVertical'),
      'Vertical constraints should expose the vertical glyph in committed annotations.',
    )
  }

  function testHorizontalAndVerticalRejectUnsupportedTargets() {
    let session = createSessionWithLineAndCircle()
    const circle = session.definition.entities.find((entity) => entity.kind === 'circle')
    assert(circle?.kind === 'circle', 'Expected a circle target for unsupported constraint picks.')
    const initialConstraintCount = session.definition.constraints.length
    const initialDimensionCount = session.definition.dimensions.length

    session = beginSketchTool(session, 'constraintHorizontal')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: circle.entityId,
    })

    assert(
      session.definition.constraints.length === initialConstraintCount,
      'Unsupported horizontal targets should not commit partial constraints.',
    )
    assert(
      session.definition.dimensions.length === initialDimensionCount,
      'Unsupported horizontal targets should not append dimensions.',
    )
    assert(session.constraintAuthoring?.selectedTargets.length === 0, 'Unsupported horizontal targets should not stay selected.')
    assert(
      getSketchToolPresentation(session)?.validation?.[0]?.message === 'Horizontal needs the supported target combination.',
      'Unsupported horizontal targets should surface validation feedback.',
    )

    session = beginSketchTool(session, 'constraintVertical')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: circle.entityId,
    })

    assert(
      session.definition.constraints.length === initialConstraintCount,
      'Unsupported vertical targets should not commit partial constraints.',
    )
    assert(
      session.definition.dimensions.length === initialDimensionCount,
      'Unsupported vertical targets should not append dimensions.',
    )
    assert(session.constraintAuthoring?.selectedTargets.length === 0, 'Unsupported vertical targets should not stay selected.')
    assert(
      getSketchToolPresentation(session)?.validation?.[0]?.message === 'Vertical needs the supported target combination.',
      'Unsupported vertical targets should surface validation feedback.',
    )
  }

  function testHorizontalAndVerticalUseSketchPlaneAxes() {
    let horizontalSession = createNewSketchSession(createStandardPlaneDefinition('yz'))
    horizontalSession = beginSketchTool(horizontalSession, 'line')
    horizontalSession = startSketchDraw(horizontalSession, [2, 1])
    horizontalSession = acceptSketchDraw(horizontalSession, [5, 4])

    const [horizontalLineId] = horizontalSession.definition.entityIds
    assert(horizontalLineId, 'Expected a local line on the YZ plane.')

    horizontalSession = beginSketchTool(horizontalSession, 'constraintHorizontal')
    horizontalSession = selectSketchConstraintTarget(horizontalSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: horizontalLineId,
    })

    const horizontalLine = horizontalSession.definition.entities.find((entity) => entity.entityId === horizontalLineId)
    assert(horizontalLine?.kind === 'lineSegment', 'Expected the authored horizontal line to remain available.')
    const horizontalStart = horizontalSession.definition.points.find((point) => point.pointId === horizontalLine.startPointId)
    const horizontalEnd = horizontalSession.definition.points.find((point) => point.pointId === horizontalLine.endPointId)
    assert(horizontalStart && horizontalEnd, 'Expected solved horizontal line endpoints.')

    const horizontalStartWorld = mapSketchPointToWorkspaceWorld(horizontalSession.plane, horizontalStart.position)
    const horizontalEndWorld = mapSketchPointToWorkspaceWorld(horizontalSession.plane, horizontalEnd.position)
    assert(
      Math.abs(horizontalEnd.position[1] - horizontalStart.position[1]) < 1e-6,
      'Horizontal should solve in local sketch coordinates.',
    )
    assert(
      Math.abs(horizontalEndWorld[2] - horizontalStartWorld[2]) < 1e-6 && Math.abs(horizontalEndWorld[1] - horizontalStartWorld[1]) > 1e-3,
      'Horizontal on the YZ plane should align to world Y, not reinterpret against world X.',
    )

    let verticalSession = createNewSketchSession(createStandardPlaneDefinition('xz'))
    verticalSession = beginSketchTool(verticalSession, 'line')
    verticalSession = startSketchDraw(verticalSession, [1, 2])
    verticalSession = acceptSketchDraw(verticalSession, [4, 5])

    const [verticalLineId] = verticalSession.definition.entityIds
    assert(verticalLineId, 'Expected a local line on the XZ plane.')

    verticalSession = beginSketchTool(verticalSession, 'constraintVertical')
    verticalSession = selectSketchConstraintTarget(verticalSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: verticalLineId,
    })

    const verticalLine = verticalSession.definition.entities.find((entity) => entity.entityId === verticalLineId)
    assert(verticalLine?.kind === 'lineSegment', 'Expected the authored vertical line to remain available.')
    const verticalStart = verticalSession.definition.points.find((point) => point.pointId === verticalLine.startPointId)
    const verticalEnd = verticalSession.definition.points.find((point) => point.pointId === verticalLine.endPointId)
    assert(verticalStart && verticalEnd, 'Expected solved vertical line endpoints.')

    const verticalStartWorld = mapSketchPointToWorkspaceWorld(verticalSession.plane, verticalStart.position)
    const verticalEndWorld = mapSketchPointToWorkspaceWorld(verticalSession.plane, verticalEnd.position)
    assert(
      Math.abs(verticalEnd.position[0] - verticalStart.position[0]) < 1e-6,
      'Vertical should solve in local sketch coordinates.',
    )
    assert(
      Math.abs(verticalEndWorld[0] - verticalStartWorld[0]) < 1e-6
        && Math.abs(verticalEndWorld[2] - verticalStartWorld[2]) > 1e-3
        && Math.abs(verticalEndWorld[1] - verticalStartWorld[1]) < 1e-6,
      'Vertical on the XZ plane should align to world Z, not reinterpret against world Y.',
    )
  }

  function testConcentricAuthoringCommitsLocalAndProjectedConstraints() {
    let localSession = createSessionWithTwoCircles()
    const [firstCircle, secondCircle] = localSession.definition.entities.filter((entity) => entity.kind === 'circle')
    assert(firstCircle?.kind === 'circle' && secondCircle?.kind === 'circle', 'Expected two local circles.')

    localSession = beginSketchTool(localSession, 'constraintConcentric')
    localSession = selectSketchConstraintTarget(localSession, firstCircle.target)
    localSession = selectSketchConstraintTarget(localSession, secondCircle.target)

    assert(localSession.definition.constraints[0]?.kind === 'concentric', 'Concentric should commit a local durable constraint.')
    const localAnnotation = getSketchAnnotationDescriptors(localSession).find((entry) => entry.target.kind === 'constraint')
    assert(localAnnotation?.glyphKind === 'constraintConcentric', 'Concentric constraints should expose a concentric glyph.')

    let projectedSession = createSessionWithTwoCircles()
    const projectedCircle = projectedSession.definition.entities.find((entity) => entity.kind === 'circle')
    assert(projectedCircle?.kind === 'circle', 'Expected a local circle for projected concentric authoring.')
    projectedSession = addProjectedReference(projectedSession, {
      referenceId: 'ref_circle',
      status: 'projected',
      geometry: [{
        geometryId: 'projected_geometry_circle',
        kind: 'circle',
        centerPosition: [6, 3],
        radius: 2,
      }],
      diagnostics: [],
    })

    projectedSession = beginSketchTool(projectedSession, 'constraintConcentric')
    projectedSession = selectSketchConstraintTarget(projectedSession, projectedCircle.target)
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: 'projectedReferenceGeometry',
      referenceId: 'ref_circle',
      geometryId: 'projected_geometry_circle',
      geometryKind: 'circle',
    })

    const projectedConstraint = projectedSession.definition.constraints[0]
    assert(
      projectedConstraint?.kind === 'concentricProjectedCurve',
      'Concentric should commit a projected-curve durable constraint when one target is projected.',
    )
    const center = projectedSession.definition.points.find((point) => point.pointId === projectedCircle.centerPointId)
    assert(center && Math.hypot(center.position[0] - 6, center.position[1] - 3) < 1e-4, 'Projected concentric should solve the local center onto the projected center.')
  }

  function testMidpointAuthoringCommitsLocalAndProjectedConstraints() {
    let localSession = createSessionWithTwoLines()
    const [lineId] = localSession.definition.entityIds
    const pointId = localSession.definition.pointIds[2]

    localSession = beginSketchTool(localSession, 'constraintMidpoint')
    localSession = selectSketchConstraintTarget(localSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: pointId!,
    })
    localSession = selectSketchConstraintTarget(localSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: lineId!,
    })

    assert(localSession.definition.constraints[0]?.kind === 'midpoint', 'Midpoint should commit a local midpoint constraint.')
    assert(getSketchAnnotationDescriptors(localSession)[0]?.glyphKind === 'constraintMidpoint', 'Midpoint should expose a midpoint glyph.')

    let projectedSession = createSessionWithTwoLines()
    const projectedPointId = projectedSession.definition.pointIds[0]
    projectedSession = addProjectedReference(projectedSession, {
      referenceId: 'ref_line_midpoint',
      status: 'projected',
      geometry: [{
        geometryId: 'projected_geometry_line_midpoint',
        kind: 'lineSegment',
        startPosition: [2, 2],
        endPosition: [8, 2],
      }],
      diagnostics: [],
    })

    projectedSession = beginSketchTool(projectedSession, 'constraintMidpoint')
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: 'projectedReferenceGeometry',
      referenceId: 'ref_line_midpoint',
      geometryId: 'projected_geometry_line_midpoint',
      geometryKind: 'lineSegment',
    })
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: projectedPointId!,
    })

    assert(
      projectedSession.definition.constraints[0]?.kind === 'midpointProjectedLine',
      'Midpoint should commit a projected-line midpoint constraint.',
    )
  }

  function testPierceAuthoringCommitsLocalAndProjectedConstraints() {
    let localSession = createSessionWithTwoLines()
    const [lineId] = localSession.definition.entityIds
    const pointId = localSession.definition.pointIds[2]

    localSession = beginSketchTool(localSession, 'constraintPierce')
    localSession = selectSketchConstraintTarget(localSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: lineId!,
    })
    localSession = selectSketchConstraintTarget(localSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: pointId!,
    })

    assert(localSession.definition.constraints[0]?.kind === 'pointOnCurve', 'Pierce should commit a local point-on-curve constraint.')
    assert(getSketchAnnotationDescriptors(localSession)[0]?.glyphKind === 'constraintPierce', 'Pierce should expose a pierce glyph.')

    let projectedSession = createSessionWithTwoLines()
    const projectedPointId = projectedSession.definition.pointIds[0]
    projectedSession = addProjectedReference(projectedSession, {
      referenceId: 'ref_pierce',
      status: 'projected',
      geometry: [{
        geometryId: 'projected_geometry_pierce',
        kind: 'circle',
        centerPosition: [0, 0],
        radius: 3,
      }],
      diagnostics: [],
    })

    projectedSession = beginSketchTool(projectedSession, 'constraintPierce')
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: projectedPointId!,
    })
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: 'projectedReferenceGeometry',
      referenceId: 'ref_pierce',
      geometryId: 'projected_geometry_pierce',
      geometryKind: 'circle',
    })

    assert(
      projectedSession.definition.constraints[0]?.kind === 'pointOnProjectedCurve',
      'Pierce should commit a projected point-on-curve constraint.',
    )
  }

  function testFixGeometryCommitsSupportedTargets() {
    let pointSession = createSessionWithTwoLines()
    const pointId = pointSession.definition.pointIds[0]
    pointSession = beginSketchTool(pointSession, 'constraintFix')
    pointSession = selectSketchConstraintTarget(pointSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: pointId!,
    })
    assert(pointSession.definition.constraints.length === 1, 'Fixing a point should commit one fix-point constraint.')
    assert(pointSession.definition.constraints[0]?.kind === 'fixPoint', 'Point fix should use fixPoint.')
    assert(getSketchAnnotationDescriptors(pointSession)[0]?.glyphKind === 'constraintFixed', 'Fix constraints should expose the fixed glyph.')

    let lineSession = createSessionWithTwoLines()
    const lineId = lineSession.definition.entityIds[0]
    lineSession = beginSketchTool(lineSession, 'constraintFix')
    lineSession = selectSketchConstraintTarget(lineSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: lineId!,
    })
    assert(lineSession.definition.constraints.length === 2, 'Fixing a line should fix both endpoints.')
    assert(lineSession.definition.constraints.every((constraint) => constraint.kind === 'fixPoint'), 'Line fix should use fixPoint constraints.')

    let circleSession = createSessionWithTwoCircles()
    const circle = circleSession.definition.entities.find((entity) => entity.kind === 'circle')
    assert(circle?.kind === 'circle', 'Expected a local circle.')
    circleSession = beginSketchTool(circleSession, 'constraintFix')
    circleSession = selectSketchConstraintTarget(circleSession, circle.target)
    assert(circleSession.definition.constraints.length === 1, 'Fixing a circle should fix its center point.')
    assert(circleSession.definition.dimensions[0]?.kind === 'circleRadius', 'Fixing a circle should add a radius dimension for the current size.')
  }

  function testNormalAuthoringCommitsValidTargetsAndRejectsInvalidTargets() {
    let session = createSessionWithLineAndCircle()
    const line = session.definition.entities.find((entity) => entity.kind === 'lineSegment')
    const circle = session.definition.entities.find((entity) => entity.kind === 'circle')
    assert(line?.kind === 'lineSegment' && circle?.kind === 'circle', 'Expected a line and circle for normal authoring.')

    session = beginSketchTool(session, 'constraintNormal')
    session = selectSketchConstraintTarget(session, line.target)
    session = selectSketchConstraintTarget(session, circle.target)
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: line.startPointId,
    })

    assert(
      session.definition.constraints.some((constraint) => constraint.kind === 'normal'),
      'Normal should commit a local normal constraint.',
    )
    assert(
      getSketchAnnotationDescriptors(session).some((annotation) => annotation.glyphKind === 'constraintNormal'),
      'Normal should expose a normal glyph.',
    )

    let invalidSession = createSessionWithTwoCircles()
    const [firstCircle, secondCircle] = invalidSession.definition.entities.filter((entity) => entity.kind === 'circle')
    assert(firstCircle?.kind === 'circle' && secondCircle?.kind === 'circle', 'Expected two circles for invalid normal authoring.')
    invalidSession = beginSketchTool(invalidSession, 'constraintNormal')
    invalidSession = selectSketchConstraintTarget(invalidSession, firstCircle.target)
    invalidSession = selectSketchConstraintTarget(invalidSession, secondCircle.target)
    invalidSession = selectSketchConstraintTarget(invalidSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: invalidSession.definition.pointIds[0]!,
    })

    assert(invalidSession.definition.constraints.length === 0, 'Invalid normal targets should not commit a partial constraint.')
    assert(invalidSession.validationMessage?.includes('Normal needs'), 'Invalid normal targets should report validation feedback.')
  }

  function testSymmetricAuthoringCommitsLocalAndProjectedAxes() {
    let localSession = createSessionWithTwoLines()
    const [axisId] = localSession.definition.entityIds
    const pointA = localSession.definition.pointIds[2]
    const pointB = localSession.definition.pointIds[3]

    localSession = beginSketchTool(localSession, 'constraintSymmetric')
    localSession = selectSketchConstraintTarget(localSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: pointA!,
    })
    localSession = selectSketchConstraintTarget(localSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: pointB!,
    })
    localSession = selectSketchConstraintTarget(localSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: axisId!,
    })

    assert(localSession.definition.constraints[0]?.kind === 'symmetric', 'Symmetric should commit a local-axis constraint.')
    assert(getSketchAnnotationDescriptors(localSession)[0]?.glyphKind === 'constraintSymmetric', 'Symmetric should expose a symmetric glyph.')

    let projectedSession = createSessionWithTwoLines()
    projectedSession = addProjectedReference(projectedSession, {
      referenceId: 'ref_axis',
      status: 'projected',
      geometry: [{
        geometryId: 'projected_geometry_axis',
        kind: 'lineSegment',
        startPosition: [0, 0],
        endPosition: [0, 10],
      }],
      diagnostics: [],
    })
    projectedSession = beginSketchTool(projectedSession, 'constraintSymmetric')
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: 'projectedReferenceGeometry',
      referenceId: 'ref_axis',
      geometryId: 'projected_geometry_axis',
      geometryKind: 'lineSegment',
    })
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: projectedSession.definition.pointIds[0]!,
    })
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: projectedSession.definition.pointIds[1]!,
    })

    assert(
      projectedSession.definition.constraints[0]?.kind === 'symmetricProjectedLine',
      'Symmetric should commit a projected-axis constraint.',
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

  function testProjectedCoincidentAuthoringCommitsTypedOperand() {
    let session = createSessionWithTwoLines()
    const [firstPointId] = session.definition.pointIds
    session = addProjectedReference(session, {
      referenceId: 'ref_point',
      status: 'projected',
      geometry: [{
        geometryId: 'projected_geometry_point',
        kind: 'point',
        position: [3, 3],
      }],
      diagnostics: [],
    })

    session = beginSketchTool(session, 'constraintCoincident')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: firstPointId!,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'projectedReferenceGeometry',
      referenceId: 'ref_point',
      geometryId: 'projected_geometry_point',
      geometryKind: 'point',
    })

    const constraint = session.definition.constraints[0]
    assert(
      constraint?.kind === 'coincidentProjectedPoint',
      'Coincident authoring should commit a projected-point constraint through normal target selection.',
    )
    assert(
      constraint.projectedPoint.reference.referenceId === 'ref_point'
        && constraint.projectedPoint.reference.geometryId === 'projected_geometry_point',
      'Projected-point coincident authoring should store the selected reference geometry operand.',
    )
  }

  function testProjectedCoincidentAuthoringCanConstrainCircleCenter() {
    let session = createNewSketchSessionFromSupport({
      kind: 'construction',
      constructionId: 'construction_plane-xy',
    })

    session = beginSketchTool(session, 'circle')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [4, 0])
    session = addProjectedReference(session, {
      referenceId: 'ref_circle_center',
      status: 'projected',
      geometry: [{
        geometryId: 'projected_geometry_circle_center',
        kind: 'point',
        position: [3, 3],
      }],
      diagnostics: [],
    })

    const circle = session.definition.entities.find((entity) => entity.kind === 'circle')
    assert(circle?.kind === 'circle', 'Circle authoring should create a local circle entity.')

    session = beginSketchTool(session, 'constraintCoincident')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: circle.entityId,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'projectedReferenceGeometry',
      referenceId: 'ref_circle_center',
      geometryId: 'projected_geometry_circle_center',
      geometryKind: 'point',
    })

    const constraint = session.definition.constraints.find(
      (entry) => entry.kind === 'coincidentProjectedPoint',
    )
    assert(
      constraint?.kind === 'coincidentProjectedPoint',
      'Coincident authoring should support selecting a circle and a projected point to constrain the circle center.',
    )
    assert(
      constraint.point.pointId === circle.centerPointId,
      'Circle-to-projected-point coincident authoring should target the circle center point.',
    )
    const center = session.definition.points.find((point) => point.pointId === circle.centerPointId)
    assert(
      center && Math.hypot(center.position[0] - 3, center.position[1] - 3) < 1e-6,
      'Circle-to-projected-point coincident authoring should solve the circle center onto the projected point immediately.',
    )
  }

  function testProjectedParallelAuthoringCommitsTypedOperand() {
    let session = createSessionWithTwoLines()
    const [firstLineId] = session.definition.entityIds
    session = addProjectedReference(session, {
      referenceId: 'ref_line',
      status: 'projected',
      geometry: [{
        geometryId: 'projected_geometry_line',
        kind: 'lineSegment',
        startPosition: [0, 0],
        endPosition: [10, 0],
      }],
      diagnostics: [],
    })

    session = beginSketchTool(session, 'constraintParallel')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: firstLineId!,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'projectedReferenceGeometry',
      referenceId: 'ref_line',
      geometryId: 'projected_geometry_line',
      geometryKind: 'lineSegment',
    })

    const constraint = session.definition.constraints[0]
    assert(
      constraint?.kind === 'parallelProjectedLine',
      'Parallel authoring should commit a projected-line constraint through normal target selection.',
    )
    assert(
      constraint.projectedLine.reference.referenceId === 'ref_line'
        && constraint.projectedLine.reference.geometryId === 'projected_geometry_line',
      'Projected parallel authoring should store the selected reference geometry operand.',
    )
  }

  function testSketchDatumAuthoringCommitsTypedOperands() {
    let coincidentSession = createSessionWithTwoLines()
    const [pointId] = coincidentSession.definition.pointIds
    coincidentSession = beginSketchTool(coincidentSession, 'constraintCoincident')
    coincidentSession = selectSketchConstraintTarget(coincidentSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: pointId!,
    })
    coincidentSession = selectSketchConstraintTarget(coincidentSession, {
      kind: 'sketchDatumReference',
      sketchId: 'sketch_draft',
      datumId: 'origin',
      geometryKind: 'point',
    })

    const coincident = coincidentSession.definition.constraints[0]
    assert(
      coincident?.kind === 'coincidentProjectedPoint'
        && coincident.projectedPoint.kind === 'sketchDatum'
        && coincident.projectedPoint.datum === 'origin',
      'Coincident authoring should store the sketch origin as a durable datum operand.',
    )

    let parallelSession = createSessionWithTwoLines()
    const [lineId] = parallelSession.definition.entityIds
    parallelSession = beginSketchTool(parallelSession, 'constraintParallel')
    parallelSession = selectSketchConstraintTarget(parallelSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: lineId!,
    })
    parallelSession = selectSketchConstraintTarget(parallelSession, {
      kind: 'sketchDatumReference',
      sketchId: 'sketch_draft',
      datumId: 'xAxis',
      geometryKind: 'lineSegment',
    })

    const parallel = parallelSession.definition.constraints[0]
    assert(
      parallel?.kind === 'parallelProjectedLine'
        && parallel.projectedLine.kind === 'sketchDatum'
        && parallel.projectedLine.datum === 'xAxis',
      'Parallel authoring should store the sketch X axis as a durable datum operand.',
    )
  }

  function testSketchDatumDimensionAuthoringCommitsTypedOperands() {
    let pointSession = createSessionWithTwoLines()
    const [pointId] = pointSession.definition.pointIds
    pointSession = beginSketchTool(pointSession, 'dimensionDistance')
    pointSession = selectSketchConstraintTarget(pointSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: pointId!,
    })
    pointSession = selectSketchConstraintTarget(pointSession, {
      kind: 'sketchDatumReference',
      sketchId: 'sketch_draft',
      datumId: 'origin',
      geometryKind: 'point',
    })
    pointSession = patchSketchConstraintValue(pointSession, { value: 3 })
    pointSession = patchSketchConstraintValue(pointSession, { intent: 'commitConstraintValue' })

    const pointDatum = pointSession.definition.dimensions.find((dimension) => dimension.kind === 'pointDatumDistance')
    assert(
      pointDatum?.kind === 'pointDatumDistance'
        && pointDatum.point.pointId === pointId
        && pointDatum.datum.datum === 'origin',
      'Point-to-origin distance authoring should commit a durable datum-point dimension.',
    )

    let lineSession = createNewSketchSessionFromSupport({
      kind: 'construction',
      constructionId: 'construction_plane-xy',
    })
    lineSession = beginSketchTool(lineSession, 'line')
    lineSession = startSketchDraw(lineSession, [0, 2])
    lineSession = acceptSketchDraw(lineSession, [10, 2])
    const [lineId] = lineSession.definition.entityIds
    lineSession = beginSketchTool(lineSession, 'dimensionDistance')
    lineSession = selectSketchConstraintTarget(lineSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: lineId!,
    })
    lineSession = selectSketchConstraintTarget(lineSession, {
      kind: 'sketchDatumReference',
      sketchId: 'sketch_draft',
      datumId: 'xAxis',
      geometryKind: 'lineSegment',
    })
    lineSession = patchSketchConstraintValue(lineSession, { value: 2 })
    lineSession = patchSketchConstraintValue(lineSession, { intent: 'commitConstraintValue' })

    const lineDatum = lineSession.definition.dimensions.find((dimension) => dimension.kind === 'lineDistance')
    assert(
      lineDatum?.kind === 'lineDistance'
        && lineDatum.lines.some((line) => line.kind === 'sketchDatum' && line.datum === 'xAxis'),
      'Line-to-axis distance authoring should commit a durable datum-axis operand.',
    )
  }

  function testPointOnProjectedCurveAuthoringCommitsTypedOperand() {
    const cases = [
      {
        geometry: {
          geometryId: 'projected_geometry_line',
          kind: 'lineSegment' as const,
          startPosition: [0, 0] as const,
          endPosition: [10, 0] as const,
        },
        geometryKind: 'lineSegment' as const,
      },
      {
        geometry: {
          geometryId: 'projected_geometry_circle',
          kind: 'circle' as const,
          centerPosition: [0, 0] as const,
          radius: 5,
        },
        geometryKind: 'circle' as const,
      },
      {
        geometry: {
          geometryId: 'projected_geometry_arc',
          kind: 'arc' as const,
          centerPosition: [0, 0] as const,
          startPosition: [5, 0] as const,
          endPosition: [0, 5] as const,
          sweepDirection: 'counterClockwise' as const,
        },
        geometryKind: 'arc' as const,
      },
    ]

    for (const testCase of cases) {
      let session = createSessionWithTwoLines()
      const [firstPointId] = session.definition.pointIds
      session = addProjectedReference(session, {
        referenceId: 'ref_curve',
        status: 'projected',
        geometry: [testCase.geometry],
        diagnostics: [],
      })

      session = beginSketchTool(session, 'constraintCoincident')
      session = selectSketchConstraintTarget(session, {
        kind: 'sketchPoint',
        sketchId: 'sketch_draft',
        pointId: firstPointId!,
      })
      session = selectSketchConstraintTarget(session, {
        kind: 'projectedReferenceGeometry',
        referenceId: 'ref_curve',
        geometryId: testCase.geometry.geometryId,
        geometryKind: testCase.geometryKind,
      })

      const constraint = session.definition.constraints[0]
      assert(
        constraint?.kind === 'pointOnProjectedCurve',
        `Coincident authoring should commit a point-on-projected-${testCase.geometryKind} constraint.`,
      )
      assert(
        constraint.projectedCurve.reference.geometryId === testCase.geometry.geometryId,
        'Point-on-projected-curve authoring should store the selected reference geometry operand.',
      )
    }
  }

  function testReferenceTargetedConstraintAuthoringCommitsTypedOperands() {
    let session = createSessionWithTwoLines()
    const [firstLineId] = session.definition.entityIds
    const projectedReference: ProjectedSketchReferenceRecord = {
      referenceId: 'ref_edge',
      status: 'projected',
      geometry: [{
        geometryId: 'projected_geometry_line',
        kind: 'lineSegment',
        startPosition: [0, 0],
        endPosition: [10, 0],
      }],
      diagnostics: [],
    }

    session = addProjectedReference(session, projectedReference)
    session = beginSketchTool(session, 'constraintPerpendicular')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: firstLineId!,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'projectedReferenceGeometry',
      referenceId: 'ref_edge',
      geometryId: 'projected_geometry_line',
      geometryKind: 'lineSegment',
    })

    const constraint = session.definition.constraints[0]
    assert(
      constraint?.kind === 'perpendicularProjectedLine',
      'Perpendicular authoring should commit a durable projected-line constraint when the second target is projected.',
    )
    assert(
      constraint.projectedLine.reference.referenceId === 'ref_edge'
        && constraint.projectedLine.reference.geometryId === 'projected_geometry_line',
      'Projected-line constraint should store typed reference and geometry IDs.',
    )
    assert(
      session.commitRequest?.definition.constraints[0]?.kind === 'perpendicularProjectedLine',
      'Reference-targeted constraint should be present in the modeling-boundary commit payload.',
    )

    const annotation = getSketchAnnotationDescriptors(session).find((entry) => entry.target.kind === 'constraint')
    assert(annotation?.glyphKind === 'constraintPerpendicular', 'Reference-targeted line constraint should render a perpendicular annotation.')
    assert(
      annotation.affectedGeometryRefs.some((target) => target.kind === 'projectedReferenceGeometry'),
      'Reference-targeted annotation should highlight the projected target.',
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
    session = pinSketchConstraintPreview(session, [5, 12])

    const presentation = getSketchToolPresentation(session)
    assert(presentation?.floatingInput?.label === 'Distance', 'Distance authoring should request a floating numeric input.')

    session = patchSketchConstraintValue(session, { value: 24 })
    session = patchSketchConstraintValue(session, { intent: 'commitConstraintValue' })

    const annotation = getSketchAnnotationDescriptors(session).find(
      (entry) => entry.target.kind === 'dimension',
    )
    assert(annotation, 'Committed dimensions should be exposed as durable annotation descriptors.')
    assert(
      annotation.glyphKind === 'dimensionDistance'
        || annotation.glyphKind === 'dimensionHorizontal'
        || annotation.glyphKind === 'dimensionVertical',
      'Distance dimensions should expose a dimension-specific glyph kind.',
    )
    assert(annotation.anchor.kind === 'sketchPoint', 'Dimension descriptors should expose a viewport anchor.')
    assert(annotation.visibleLabel === '24.00', 'Committed dimensions should expose compact visible value text.')
    assert(
      annotation.detail === '24.00 mm distance',
      'Committed distance dimension details should avoid deprecated directional role labels.',
    )
    assert(
      annotation.dragHandle?.dimensionId === annotation.target.dimensionId,
      'Committed dimensions should expose annotation-chip drag metadata for durable placement updates.',
    )
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

    session = patchSketchDimensionAnnotationPlacement(session, {
      intent: 'setDimensionAnnotationPlacement',
      dimensionId: annotation.target.dimensionId,
      point: [5, -4],
    })
    const movedAnnotation = getSketchAnnotationDescriptors(session).find(
      (entry) => entry.target.kind === 'dimension' && entry.target.dimensionId === annotation.target.dimensionId,
    )
    assert(
      movedAnnotation?.anchor.kind === 'sketchPoint'
        && Math.abs(movedAnnotation.anchor.point[0] - 5) < 1e-9
        && Math.abs(movedAnnotation.anchor.point[1] + 4) < 1e-9,
      'Committed dimension annotation chips should use the dynamic dimension label placement.',
    )

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

  function testExpandedDimensionAuthoringCommitsDurablePayloads() {
    let circleSession = createNewSketchSessionFromSupport({
      kind: 'construction',
      constructionId: 'construction_plane-xy',
    })
    circleSession = beginSketchTool(circleSession, 'circle')
    circleSession = startSketchDraw(circleSession, [0, 0])
    circleSession = acceptSketchDraw(circleSession, [5, 0])
    const circleId = circleSession.definition.entities.find((entity) => entity.kind === 'circle')?.entityId
    assert(circleId, 'Circle fixture should create a circle entity.')

    circleSession = beginSketchTool(circleSession, 'dimensionDistance')
    circleSession = selectSketchConstraintTarget(circleSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: circleId,
    })
    assert(
      getSketchToolPresentation(circleSession)?.overlays?.some((overlay) =>
        overlay.kind === 'dimensionLine' && overlay.referenceKind === 'diameter'
      ),
      'Selecting one circle with Dimension should start a diameter preview before committing the value.',
    )
    circleSession = patchSketchConstraintValue(circleSession, { intent: 'setConstraintAnnotationPlacement', point: [0, 5] })
    circleSession = patchSketchConstraintValue(circleSession, { value: 12 })
    circleSession = patchSketchConstraintValue(circleSession, { intent: 'commitConstraintValue' })
    const diameter = circleSession.definition.dimensions.find((dimension) => dimension.kind === 'diameter')
    assert(
      diameter?.kind === 'diameter'
        && diameter.entityId === circleId
        && diameter.value === 12
        && diameter.annotationPlacement?.kind === 'dimensionLine',
      'Diameter authoring should commit a durable diameter dimension with annotation placement.',
    )
    assert(
      getSketchToolPresentation(circleSession)?.overlays?.some((overlay) =>
        overlay.kind === 'dimensionLine'
          && overlay.referenceKind === 'diameter'
          && !overlay.dragHandle,
      ),
      'Committed diameter dimensions should keep overlay geometry visible without reusing it as the durable drag handle.',
    )
    circleSession = patchSketchDimensionAnnotationPlacement(circleSession, {
      intent: 'setDimensionAnnotationPlacement',
      dimensionId: diameter.dimensionId,
      point: [5, 0],
    })
    const movedDiameter = circleSession.definition.dimensions.find((dimension) => dimension.dimensionId === diameter.dimensionId)
    assert(
      movedDiameter?.kind === 'diameter'
        && movedDiameter.annotationPlacement?.kind === 'dimensionLine'
        && Math.abs((movedDiameter.annotationPlacement.angleRadians ?? 0)) < 1e-9,
      'Dragging a committed diameter annotation should update its durable annotation placement.',
    )

    let lengthSession = createSessionWithTwoLines()
    const [lengthLineId] = lengthSession.definition.entityIds
    assert(lengthLineId, 'Line length fixture should create a line entity.')
    lengthSession = beginSketchTool(lengthSession, 'dimensionDistance')
    lengthSession = selectSketchConstraintTarget(lengthSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: lengthLineId,
    })
    const lengthPreview = getSketchToolPresentation(lengthSession)?.overlays?.find((overlay) => overlay.kind === 'dimensionLine')
    assert(
      lengthPreview?.kind === 'dimensionLine' && lengthPreview.referenceKind === 'lineLength',
      'Selecting one local line with Dimension should preview an editable line-length dimension.',
    )
    lengthSession = pinSketchConstraintPreview(lengthSession, [5, -2])
    assert(
      getSketchToolPresentation(lengthSession)?.floatingInput?.label === 'Length',
      'Pinning a single-line Dimension preview should open line-length value entry.',
    )
    lengthSession = patchSketchConstraintValue(lengthSession, { value: 8 })
    lengthSession = patchSketchConstraintValue(lengthSession, { intent: 'commitConstraintValue' })
    const lineLength = lengthSession.definition.dimensions.find((dimension) => dimension.kind === 'lineLength')
    assert(
      lineLength?.kind === 'lineLength'
        && lineLength.entityId === lengthLineId
        && lineLength.value === 8
        && lineLength.annotationPlacement?.kind === 'dimensionLine',
      'Single-line Dimension authoring should commit a durable line-length dimension tied to the selected edge.',
    )

    let lineSession = createSessionWithTwoLines()
    const [firstLineId, secondLineId] = lineSession.definition.entityIds
    assert(firstLineId && secondLineId, 'Line fixture should create two line entities.')
    lineSession = beginSketchTool(lineSession, 'dimensionDistance')
    lineSession = selectSketchConstraintTarget(lineSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: firstLineId,
    })
    lineSession = selectSketchConstraintTarget(lineSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: secondLineId,
    })
    lineSession = patchSketchConstraintValue(lineSession, { value: 6 })
    lineSession = patchSketchConstraintValue(lineSession, { intent: 'commitConstraintValue' })
    const lineDistance = lineSession.definition.dimensions.find((dimension) => dimension.kind === 'lineDistance')
    assert(
      lineDistance?.kind === 'lineDistance'
        && lineDistance.lines.every((line) => line.kind === 'localEntity')
        && lineDistance.value === 6,
      'Parallel line targets should commit a durable line-to-line distance dimension.',
    )

    let pointLineSession = createSessionWithTwoLines()
    const lineId = pointLineSession.definition.entityIds[0]
    const pointId = pointLineSession.definition.pointIds[3]
    assert(lineId && pointId, 'Point-line fixture should expose a line and a point.')
    pointLineSession = beginSketchTool(pointLineSession, 'dimensionDistance')
    pointLineSession = selectSketchConstraintTarget(pointLineSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId,
    })
    pointLineSession = selectSketchConstraintTarget(pointLineSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: lineId,
    })
    pointLineSession = patchSketchConstraintValue(pointLineSession, { value: 4 })
    pointLineSession = patchSketchConstraintValue(pointLineSession, { intent: 'commitConstraintValue' })
    const pointLineDistance = pointLineSession.definition.dimensions.find((dimension) => dimension.kind === 'linePointDistance')
    assert(
      pointLineDistance?.kind === 'linePointDistance'
        && pointLineDistance.line.kind === 'localEntity'
        && pointLineDistance.point.kind === 'localPoint'
        && pointLineDistance.value === 4,
      'Line and point targets should commit a durable line-to-point distance dimension in either selection order.',
    )

    let angleSession = createNewSketchSessionFromSupport({
      kind: 'construction',
      constructionId: 'construction_plane-xy',
    })
    angleSession = beginSketchTool(angleSession, 'line')
    angleSession = startSketchDraw(angleSession, [0, 0])
    angleSession = acceptSketchDraw(angleSession, [10, 0])
    angleSession = beginSketchTool(angleSession, 'line')
    angleSession = startSketchDraw(angleSession, [5, -5])
    angleSession = acceptSketchDraw(angleSession, [5, 5])
    const [horizontalLineId, verticalLineId] = angleSession.definition.entityIds
    assert(horizontalLineId && verticalLineId, 'Angle fixture should create two non-parallel line entities.')
    angleSession = beginSketchTool(angleSession, 'dimensionDistance')
    angleSession = selectSketchConstraintTarget(angleSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: horizontalLineId,
    })
    angleSession = selectSketchConstraintTarget(angleSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: verticalLineId,
    })
    const anglePreview = getSketchToolPresentation(angleSession)?.overlays?.find((overlay) => overlay.kind === 'angleArc')
    assert(
      anglePreview?.kind === 'angleArc'
        && Math.abs(anglePreview.center[0] - 5) < 1e-9
        && Math.abs(anglePreview.center[1]) < 1e-9
        && Math.abs(anglePreview.start[1]) < 1e-9
        && Math.abs(anglePreview.end[0] - 5) < 1e-9
        && anglePreview.side === 'minor',
      'Angle preview arc should be centered at the line intersection and start/end on the selected line references.',
    )
    angleSession = pinSketchConstraintPreview(angleSession, [4, -1])
    const majorAnglePreview = getSketchToolPresentation(angleSession)?.overlays?.find((overlay) => overlay.kind === 'angleArc')
    assert(
      majorAnglePreview?.kind === 'angleArc' && majorAnglePreview.side === 'major',
      'Dragging an angle preview across the opposite sector should select the major complement arc.',
    )
    assert(
      getSketchToolPresentation(angleSession)?.floatingInput?.label === 'Angle'
        && getSketchToolPresentation(angleSession)?.floatingInput?.unit === 'deg',
      'Pinned non-parallel line dimensions should open degree-based angle value entry.',
    )

    let angleHandleSession = createNewSketchSessionFromSupport({
      kind: 'construction',
      constructionId: 'construction_plane-xy',
    })
    angleHandleSession = beginSketchTool(angleHandleSession, 'line')
    angleHandleSession = startSketchDraw(angleHandleSession, [0, 0])
    angleHandleSession = acceptSketchDraw(angleHandleSession, [10, 0])
    angleHandleSession = beginSketchTool(angleHandleSession, 'line')
    angleHandleSession = startSketchDraw(angleHandleSession, [5, -5])
    angleHandleSession = acceptSketchDraw(angleHandleSession, [5, 5])
    const [handleHorizontalLineId, handleVerticalLineId] = angleHandleSession.definition.entityIds
    assert(handleHorizontalLineId && handleVerticalLineId, 'Angle handle fixture should create two non-parallel line entities.')
    angleHandleSession = beginSketchTool(angleHandleSession, 'dimensionDistance')
    angleHandleSession = selectSketchConstraintTarget(angleHandleSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: handleHorizontalLineId,
    })
    angleHandleSession = selectSketchConstraintTarget(angleHandleSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: handleVerticalLineId,
    })
    angleHandleSession = patchSketchConstraintValue(angleHandleSession, {
      intent: 'setConstraintAnnotationPlacement',
      point: [4, -1],
    })
    assert(
      angleHandleSession.constraintAuthoring?.isPreviewPinned === true
        && getSketchToolPresentation(angleHandleSession)?.floatingInput?.label === 'Angle',
      'Clicking or dragging an uncommitted angle preview handle should pin the preview and open value entry.',
    )

    angleSession = patchSketchConstraintValue(angleSession, { value: 90 })
    angleSession = patchSketchConstraintValue(angleSession, { intent: 'commitConstraintValue' })
    const angle = angleSession.definition.dimensions.find((dimension) => dimension.kind === 'lineAngle')
    assert(
      angle?.kind === 'lineAngle'
        && Math.abs(angle.valueRadians - Math.PI / 2) < 1e-9
        && angle.lines.every((line) => line.kind === 'localEntity')
        && angle.annotationPlacement?.side === 'major',
      'Non-parallel line targets should commit a durable line angle dimension with the selected arc side.',
    )
    const angleAnnotation = getSketchAnnotationDescriptors(angleSession).find(
      (entry) => entry.target.kind === 'dimension' && entry.target.dimensionId === angle.dimensionId,
    )
    assert(
      angleAnnotation?.glyphKind === 'dimensionAngle'
        && angleAnnotation.visibleLabel === '90.0°'
        && angleAnnotation.detail === '90.0 deg angle',
      'Committed angle dimensions should expose angle-specific glyph metadata and degree-based detail text.',
    )
    assert(angleAnnotation?.target.kind === 'dimension', 'Committed angle annotation should expose a dimension target.')
    let angleEditSession = beginSketchAnnotationEdit(angleSession, angleAnnotation.target)
    assert(
      getSketchToolPresentation(angleEditSession)?.floatingInput?.label === 'Angle'
        && getSketchToolPresentation(angleEditSession)?.floatingInput?.unit === 'deg'
        && getSketchToolPresentation(angleEditSession)?.floatingInput?.value === 90,
      'Reopened angle dimension edits should be seeded in degrees.',
    )
    angleEditSession = patchSketchConstraintValue(angleEditSession, { value: 90 })
    angleEditSession = patchSketchConstraintValue(angleEditSession, { intent: 'commitAnnotationValue' })
    const editedAngle = angleEditSession.definition.dimensions.find((dimension) => dimension.dimensionId === angle.dimensionId)
    assert(
      angleEditSession.status === 'idle'
        && editedAngle?.kind === 'lineAngle'
        && Math.abs(editedAngle.valueRadians - Math.PI / 2) < 1e-9,
      'Committed angle dimension edits should accept degree input and preserve durable radians.',
    )
    const committedAngleOverlay = getSketchToolPresentation(angleSession)?.overlays?.find((overlay) => overlay.kind === 'angleArc')
    assert(
      committedAngleOverlay?.kind === 'angleArc'
        && Math.abs(committedAngleOverlay.center[0] - 5) < 1e-9
        && Math.abs(committedAngleOverlay.center[1]) < 1e-9
        && Math.abs(committedAngleOverlay.start[1]) < 1e-9
        && Math.abs(committedAngleOverlay.end[0] - 5) < 1e-9
        && committedAngleOverlay.side === 'major'
        && !committedAngleOverlay.dragHandle,
      'Committed line angle dimensions should render durable angle arcs without using them as a second drag handle.',
    )
    assert(
      committedAngleOverlay?.kind === 'angleArc'
        && (committedAngleOverlay.witnessLines?.length ?? 0) === 0,
      'Committed line angle dimensions should avoid extra witness geometry when the true intersection lies on both segments.',
    )
    angleSession = patchSketchDimensionAnnotationPlacement(angleSession, {
      intent: 'setDimensionAnnotationPlacement',
      dimensionId: angle.dimensionId,
      point: [6, 1],
    })
    const movedAngle = angleSession.definition.dimensions.find((dimension) => dimension.dimensionId === angle.dimensionId)
    assert(
      movedAngle?.kind === 'lineAngle' && movedAngle.annotationPlacement?.side === 'minor',
      'Dragging a committed angle annotation back across the close sector should update the durable arc side.',
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

  function testAngleWitnessLinesAppearForOffSegmentIntersections() {
    let session = createNewSketchSessionFromSupport({
      kind: 'construction',
      constructionId: 'construction_plane-xy',
    })
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [4, 0])
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [6, -3])
    session = acceptSketchDraw(session, [6, 3])
    const [horizontalLineId, verticalLineId] = session.definition.entityIds
    assert(horizontalLineId && verticalLineId, 'Off-segment angle fixture should create two non-parallel line entities.')

    session = beginSketchTool(session, 'dimensionDistance')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: horizontalLineId,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: verticalLineId,
    })

    const preview = getSketchToolPresentation(session)?.overlays?.find((overlay) => overlay.kind === 'angleArc')
    assert(
      preview?.kind === 'angleArc'
        && preview.witnessLines?.some((line) =>
          Math.abs(line.start[0] - 4) < 1e-9
            && line.end[0] > line.start[0]
            && line.end[0] < 6,
        ),
      'Angle previews should add witness geometry when the true intersection lies beyond a selected segment.',
    )

    session = patchSketchConstraintValue(session, { value: 90 })
    session = patchSketchConstraintValue(session, { intent: 'commitConstraintValue' })
    const committed = getSketchToolPresentation(session)?.overlays?.find((overlay) => overlay.kind === 'angleArc')
    assert(
      committed?.kind === 'angleArc'
        && committed.witnessLines?.some((line) =>
          Math.abs(line.start[0] - 4) < 1e-9
            && line.end[0] > line.start[0]
            && line.end[0] < 6,
        ),
      'Committed angle dimensions should preserve witness geometry for off-segment intersections.',
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

  function testDistancePreviewFollowsPointerUntilPlacementClick() {
    let session = createSessionWithTwoLines()
    const [firstPointId, , , diagonalPointId] = session.definition.pointIds

    session = beginSketchTool(session, 'dimensionDistance')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: firstPointId!,
    })
    session = updateSketchPointer(session, [5, 12])
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: diagonalPointId!,
    })

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
      session.constraintAuthoring?.isPreviewPinned === false
        && verticalPreview?.kind === 'dimensionLine'
        && verticalPreview.referenceKind === 'vertical',
      'Distance preview should keep following the pointer after value entry opens.',
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
    session = updateSketchPointer(session, [5, 12])
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: diagonalPointId!,
    })
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

    let targetClickSession = createSessionWithTwoLines()
    const [targetClickLineId] = targetClickSession.definition.entityIds
    const [targetClickFirstPointId, , , targetClickDiagonalPointId] = targetClickSession.definition.pointIds

    targetClickSession = beginSketchTool(targetClickSession, 'dimensionDistance')
    targetClickSession = selectSketchConstraintTarget(targetClickSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: targetClickFirstPointId!,
    })
    targetClickSession = updateSketchPointer(targetClickSession, [18, 2])
    targetClickSession = selectSketchConstraintTarget(targetClickSession, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: targetClickDiagonalPointId!,
    })
    targetClickSession = pinSketchConstraintPreview(targetClickSession, [18, 2])
    targetClickSession = selectSketchConstraintTarget(targetClickSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: targetClickLineId!,
    })

    const targetClickPreview = getSketchToolPresentation(targetClickSession)?.overlays?.find(
      (overlay) => overlay.id === 'distance-preview',
    )

    targetClickSession = updateSketchPointer(targetClickSession, [5, 12])

    const afterTargetClickMovePreview = getSketchToolPresentation(targetClickSession)?.overlays?.find(
      (overlay) => overlay.id === 'distance-preview',
    )

    assert(
      targetClickSession.constraintAuthoring?.isPreviewPinned === true
        && targetClickSession.constraintAuthoring.selectedTargets.length === 2
        && targetClickPreview?.kind === 'dimensionLine'
        && afterTargetClickMovePreview?.kind === 'dimensionLine'
        && targetClickPreview.referenceKind === 'vertical'
        && afterTargetClickMovePreview.referenceKind === 'vertical',
      'Pinned dimension previews should ignore later target selections instead of replacing operands.',
    )
  }

  testToolbarDefinitionsExposeConstraintFamilies()
  testHorizontalAndVerticalAuthoringCommitDurableConstraints()
  testHorizontalAndVerticalRejectUnsupportedTargets()
  testHorizontalAndVerticalUseSketchPlaneAxes()
  testConcentricAuthoringCommitsLocalAndProjectedConstraints()
  testMidpointAuthoringCommitsLocalAndProjectedConstraints()
  testPierceAuthoringCommitsLocalAndProjectedConstraints()
  testFixGeometryCommitsSupportedTargets()
  testNormalAuthoringCommitsValidTargetsAndRejectsInvalidTargets()
  testSymmetricAuthoringCommitsLocalAndProjectedAxes()
  testGeometricConstraintAuthoringCommitsDurableRecord()
  testProjectedCoincidentAuthoringCommitsTypedOperand()
  testProjectedCoincidentAuthoringCanConstrainCircleCenter()
  testProjectedParallelAuthoringCommitsTypedOperand()
  testSketchDatumAuthoringCommitsTypedOperands()
  testSketchDatumDimensionAuthoringCommitsTypedOperands()
  testPointOnProjectedCurveAuthoringCommitsTypedOperand()
  testReferenceTargetedConstraintAuthoringCommitsTypedOperands()
  testDimensionalConstraintShowsFloatingInputAndSupportsDeletion()
  testCommittedDimensionAnnotationReopensValueInputAndEditsDurableRecord()
  testCommittedRectangleWidthEditSolvesDraftGeometry()
  testCommittedCircleRadiusEditUpdatesEntityRadius()
  testExpandedDimensionAuthoringCommitsDurablePayloads()
  testAngleWitnessLinesAppearForOffSegmentIntersections()
  testDistancePreviewUsesPartialTargetAndPointer()
  testPointDistanceReferenceSelectionFollowsPointer()
  testDistancePreviewFollowsPointerUntilPlacementClick()
  testConstraintPreviewStopsMovingAfterPinClick()
})
