import { test } from 'bun:test'
import { deriveSketchRegionsCore } from '@/contracts/sketch/region-extraction'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deriveSketchDisplayEntities,
  getSketchSessionDisplayRenderables,
  getSketchToolPresentation,
  patchSketchDrawingToolValue,
  startSketchDraw,
  updateSketchPointer,
} from '@/domain/editor/sketch-session'
import {
  getRegisteredSketchToolDefinitions,
  getSketchToolDefinition,
  isRegisteredSketchToolId,
} from '@/domain/sketch-tools/registry'
import {
  getRegisteredSketchEditToolDefinitions,
  isRegisteredSketchEditToolId,
} from '@/domain/sketch-edit-tools/registry'
import { getToolById, getToolbarSectionsForMode, searchToolDefinitions } from '@/domain/tools/tool-registry'

test('src/domain/sketch-tools/registry.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function testRegistryContainsCurrentSketchToolSet() {
    const registeredToolIds = getRegisteredSketchToolDefinitions()
      .map((definition) => definition.metadata.id)
      .sort()
    const registeredEditToolIds = getRegisteredSketchEditToolDefinitions()
      .map((definition) => definition.metadata.id)
      .sort()

    assert(
      JSON.stringify(registeredToolIds) === JSON.stringify([
        'alignedRectangle',
        'bezierCurve',
        'centerPointArc',
        'centerPointRectangle',
        'circle',
        'circumscribedPolygon',
        'conic',
        'controlPointSpline',
        'ellipse',
        'ellipticalArc',
        'inscribedPolygon',
        'line',
        'midpointLine',
        'point',
        'profileText',
        'rectangle',
        'spline',
        'tangentArc',
        'threePointArc',
        'threePointCircle',
      ]),
      'The sketch tool registry should contain every current drawing tool.',
    )
    assert(isRegisteredSketchToolId('line'), 'Line should resolve as a registered sketch tool.')
    assert(isRegisteredSketchToolId('midpointLine'), 'Midpoint Line should resolve as a registered sketch tool.')
    assert(isRegisteredSketchToolId('spline'), 'Spline should resolve as a registered sketch tool.')
    assert(
      JSON.stringify(registeredEditToolIds) === JSON.stringify([
        'offset',
        'sketchChamfer',
        'sketchCircularPattern',
        'sketchExtend',
        'sketchFillet',
        'sketchLinearPattern',
        'sketchMirror',
        'sketchSlot',
        'sketchSplit',
        'sketchTransform',
        'trim',
      ]),
      'The sketch edit registry should contain every current edit operator.',
    )
    assert(isRegisteredSketchEditToolId('sketchFillet'), 'Sketch fillet should resolve as a registered sketch edit tool.')
    assert(!isRegisteredSketchEditToolId('fillet'), 'Part fillet should stay distinct from sketch fillet.')
  }

  function testToolFamiliesAndDiscoveryExposePrimitiveConstructors() {
    assert(
      getToolById('line').dropdown?.variantIds.includes('midpointLine'),
      'Line family should expose the midpoint-line constructor.',
    )
    assert(
      getToolById('rectangle').dropdown?.variantIds.includes('centerPointRectangle')
        && getToolById('rectangle').dropdown?.variantIds.includes('alignedRectangle'),
      'Rectangle family should expose center-point and aligned rectangle constructors.',
    )
    assert(
      getToolById('circle').dropdown?.variantIds.includes('threePointCircle'),
      'Circle family should expose the 3-point circle constructor.',
    )
    assert(
      getToolById('centerPointArc').dropdown?.variantIds.includes('threePointArc')
        && getToolById('centerPointArc').dropdown?.variantIds.includes('tangentArc'),
      'Arc family should expose center, 3-point, and tangent arc constructors.',
    )
    assert(
      getToolById('inscribedPolygon').dropdown?.variantIds.includes('circumscribedPolygon'),
      'Polygon family should expose inscribed and circumscribed constructors.',
    )
    assert(
      getToolById('ellipse').dropdown?.variantIds.includes('ellipticalArc')
        && getToolById('ellipse').dropdown?.variantIds.includes('conic')
        && getToolById('ellipse').dropdown?.variantIds.includes('bezierCurve'),
      'Advanced curve family should expose ellipse, elliptical arc, conic, and Bezier constructors.',
    )
    assert(
      getToolById('spline').dropdown?.variantIds.includes('controlPointSpline'),
      'Spline family should expose fit-point and control-point spline constructors.',
    )

    const sketchDrawingSection = getToolbarSectionsForMode('sketch').find((section) => section.id === 'drawing')
    assert(sketchDrawingSection?.toolIds.includes('centerPointArc'), 'Sketch toolbar should include an arc family trigger.')
    assert(sketchDrawingSection?.toolIds.includes('ellipse'), 'Sketch toolbar should include an advanced curve family trigger.')
    assert(sketchDrawingSection?.toolIds.includes('inscribedPolygon'), 'Sketch toolbar should include a polygon family trigger.')
    assert(sketchDrawingSection?.toolIds.includes('profileText'), 'Sketch toolbar should include profile text.')
    assert(
      getToolbarSectionsForMode('sketch').some((section) =>
        section.id === 'sketchOps'
        && section.toolIds.includes('sketchFillet')
        && section.toolIds.includes('sketchChamfer')
        && section.toolIds.includes('sketchExtend')
        && section.toolIds.includes('sketchSplit')
        && section.toolIds.includes('sketchSlot'),
      ),
      'Sketch toolbar should include the sketch edit operators.',
    )
    assert(
      searchToolDefinitions('tangent').some((tool) => tool.id === 'tangentArc')
        && searchToolDefinitions('polygon').some((tool) => tool.id === 'circumscribedPolygon'),
      'Tool search should discover sketch constructor dropdown variants.',
    )
    assert(
      searchToolDefinitions('fillet').some((tool) => tool.id === 'sketchFillet')
        && searchToolDefinitions('fillet').some((tool) => tool.id === 'fillet'),
      'Tool search should expose sketch and part fillet tools separately.',
    )
    assert(
      searchToolDefinitions('bezier').some((tool) => tool.id === 'bezierCurve')
        && searchToolDefinitions('text').some((tool) => tool.id === 'profileText'),
      'Tool search should discover advanced curve and text constructors.',
    )
  }

  function testLinePointerLifecycleProducesStagedGeometry() {
    const tool = getSketchToolDefinition('line')
    const activated = tool.activate()
    const started = tool.pointerRelease({
      state: activated.state,
      point: [0, 0],
    })
    const moved = tool.pointerMove({
      state: started.state,
      point: [10, 0],
    })

    assert(moved.stagedEntities.length === 1, 'Line pointer movement should produce one staged line entity.')
    assert(moved.stagedEntities[0]?.kind === 'line', 'Line staged geometry should be a line entity.')
    assert(moved.presentation.measurements?.[0]?.label === 'Length', 'Line presentation should expose live length guidance.')
    const lengthOverlay = moved.presentation.overlays?.find((overlay) => overlay.id === 'line-length-overlay')
    const angleOverlay = moved.presentation.overlays?.find((overlay) => overlay.id === 'line-angle-overlay')
    assert(
      lengthOverlay?.kind === 'measurement'
        && lengthOverlay.value === 10
        && lengthOverlay.anchor.kind === 'sketchPoint',
      'Line presentation should expose anchored live length guidance.',
    )
    assert(
      angleOverlay?.kind === 'measurement'
        && angleOverlay.label === 'Angle'
        && angleOverlay.value === 0
        && angleOverlay.unit === 'deg',
      'Line presentation should expose anchored live angle guidance.',
    )
  }

  function testCirclePresentationSchemaExposesPromptControlAndDiameterOverlay() {
    const tool = getSketchToolDefinition('circle')
    const activated = tool.activate()
    const started = tool.pointerRelease({
      state: activated.state,
      point: [1, 1],
    })
    const moved = tool.pointerMove({
      state: started.state,
      point: [4, 5],
    })

    assert(moved.presentation.prompts[0]?.text === 'Set radius', 'Circle presentation should update its prompt by interaction step.')
    assert(moved.presentation.controls?.some((control) => control.id === 'circle-radius'), 'Circle presentation should expose radius through a generic numeric control.')
    const diameterOverlay = moved.presentation.overlays?.find((overlay) => overlay.id === 'circle-diameter-overlay')
    assert(
      diameterOverlay?.kind === 'measurement'
        && diameterOverlay.label === 'Diameter'
        && diameterOverlay.value === 10
        && diameterOverlay.anchor.kind === 'cursor',
      'Circle presentation should expose diameter at the active circle edge.',
    )
  }

  function testRectanglePresentationSchemaExposesAnchoredWidthAndHeightOverlays() {
    const tool = getSketchToolDefinition('rectangle')
    const activated = tool.activate()
    const started = tool.pointerRelease({
      state: activated.state,
      point: [0, 0],
    })
    const moved = tool.pointerMove({
      state: started.state,
      point: [4, 3],
    })
    const widthOverlay = moved.presentation.overlays?.find((overlay) => overlay.id === 'rectangle-width-overlay')
    const heightOverlay = moved.presentation.overlays?.find((overlay) => overlay.id === 'rectangle-height-overlay')

    assert(
      widthOverlay?.kind === 'measurement'
        && widthOverlay.value === 4
        && widthOverlay.anchor.kind === 'sketchPoint',
      'Rectangle presentation should expose anchored live width guidance.',
    )
    assert(
      heightOverlay?.kind === 'measurement'
        && heightOverlay.value === 3
        && heightOverlay.anchor.kind === 'sketchPoint',
      'Rectangle presentation should expose anchored live height guidance.',
    )
  }

  function testSessionRuntimeDelegatesCommitOutputToToolModule() {
    const session = beginSketchTool(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      'rectangle',
    )
    const started = startSketchDraw(session, [0, 0])
    const moved = updateSketchPointer(started, [4, 3])
    const accepted = acceptSketchDraw(moved, [4, 3])

    assert(accepted.definition.entityIds.length === 4, 'Rectangle commit output should add four line entities.')
    assert(accepted.definition.constraintIds.length === 4, 'Rectangle commit output should add horizontal and vertical constraints.')
    assert(accepted.definition.dimensionIds.length === 2, 'Rectangle commit output should add width and height dimensions.')
    assert(accepted.toolStagedEntities.length === 0, 'Accepted rectangle geometry should clear preview entities.')
    assert(
      deriveSketchDisplayEntities(accepted).every((entity) => entity.status === 'accepted'),
      'Accepted rectangle display geometry should derive from committed entities.',
    )
  }

  function drawSketchTool(toolId: Parameters<typeof beginSketchTool>[1], points: readonly [number, number][]) {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      toolId,
    )
    session = startSketchDraw(session, points[0]!)
    for (const point of points.slice(1)) {
      session = acceptSketchDraw(session, point)
    }

    return session
  }

  function testPointAndMidpointLineConstructorsCommitDurableIntent() {
    const pointSession = drawSketchTool('point', [[1, 2], [1, 2]])
    assert(pointSession.definition.entities[0]?.kind === 'point', 'Point constructor should commit a durable point entity.')
    assert(pointSession.commitRequest?.definition.entities[0]?.kind === 'point', 'Point commit request should include durable point geometry.')

    const midpointSession = drawSketchTool('midpointLine', [[1, 1], [3, 1]])
    const line = midpointSession.definition.entities.find((entity) => entity.kind === 'lineSegment')
    const midpointConstraint = midpointSession.definition.constraints.find((constraint) => constraint.kind === 'midpoint')
    assert(line?.kind === 'lineSegment', 'Midpoint line should commit a durable line segment.')
    assert(midpointConstraint?.kind === 'midpoint', 'Midpoint line should commit midpoint intent.')
  }

  function testRectangleConstructorsCommitDurableIntent() {
    const centerRectangle = drawSketchTool('centerPointRectangle', [[0, 0], [2, 1]])
    assert(centerRectangle.definition.entities.filter((entity) => entity.kind === 'lineSegment').length === 6, 'Center rectangle should commit four edges and two construction diagonals.')
    assert(
      centerRectangle.definition.constraints.filter((constraint) => constraint.kind === 'midpoint').length === 2,
      'Center rectangle should preserve center intent through midpoint constraints.',
    )

    const alignedRectangle = drawSketchTool('alignedRectangle', [[0, 0], [4, 0], [4, 3]])
    assert(alignedRectangle.definition.entities.length === 4, 'Aligned rectangle should commit four line entities.')
    assert(
      alignedRectangle.definition.constraints.some((constraint) => constraint.kind === 'parallel')
        && alignedRectangle.definition.constraints.some((constraint) => constraint.kind === 'perpendicular')
        && alignedRectangle.definition.constraints.some((constraint) => constraint.kind === 'equalLength'),
      'Aligned rectangle should preserve parallel, perpendicular, and equal-length intent.',
    )
  }

  function testCircleArcAndPolygonConstructorsCommitDurableIntent() {
    const threePointCircle = drawSketchTool('threePointCircle', [[0, 1], [1, 0], [0, -1]])
    assert(threePointCircle.definition.entities[0]?.kind === 'circle', '3-point circle should commit a durable circle.')
    assert(
      threePointCircle.definition.constraints.filter((constraint) => constraint.kind === 'pointOnCurve').length === 3,
      '3-point circle should preserve its defining perimeter points.',
    )

    const centerArc = drawSketchTool('centerPointArc', [[0, 0], [1, 0], [0, 1]])
    assert(centerArc.definition.entities[0]?.kind === 'arc', 'Center-point arc should commit a durable arc.')

    const threePointArc = drawSketchTool('threePointArc', [[1, 0], [0, 1], [-1, 0]])
    assert(threePointArc.definition.entities[0]?.kind === 'arc', '3-point arc should commit a durable arc.')
    assert(
      threePointArc.definition.constraints.some((constraint) => constraint.kind === 'pointOnCurve'),
      '3-point arc should preserve its through-point relationship.',
    )

    const tangentArc = drawSketchTool('tangentArc', [[0, 0], [1, 0], [1, 1]])
    assert(tangentArc.definition.entities[0]?.kind === 'arc', 'Tangent arc should commit a durable arc.')

    const inscribedPolygon = drawSketchTool('inscribedPolygon', [[0, 0], [0, 2]])
    assert(inscribedPolygon.definition.entities.filter((entity) => entity.kind === 'lineSegment').length === 6, 'Inscribed polygon should commit a closed line loop.')
    assert(
      inscribedPolygon.definition.constraints.some((constraint) => constraint.kind === 'pointOnCurve'),
      'Inscribed polygon should constrain vertices to its construction circle.',
    )

    const circumscribedPolygon = drawSketchTool('circumscribedPolygon', [[0, 0], [0, 2]])
    assert(circumscribedPolygon.definition.entities.filter((entity) => entity.kind === 'lineSegment').length === 6, 'Circumscribed polygon should commit a closed line loop.')
    assert(
      circumscribedPolygon.definition.constraints.some((constraint) => constraint.kind === 'tangent'),
      'Circumscribed polygon should constrain sides tangent to its construction circle.',
    )
  }

  function testSplineCollectsThreePointsAndCommitsDurableGeometry() {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      'spline',
    )

    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [1, 2])

    assert(session.status === 'drawing', 'Spline should keep collecting after the second point.')
    assert(session.definition.entities.length === 0, 'Spline should not commit before it has enough points.')
    assert(
      session.toolStagedEntities.some((entity) => entity.kind === 'spline' && entity.status === 'preview'),
      'Spline should stage preview geometry while collecting points.',
    )

    session = acceptSketchDraw(session, [3, 0])

    assert(session.status === 'idle', 'Spline should return to idle after its first complete curve.')
    assert(session.definition.entities[0]?.kind === 'spline', 'Spline commit output should add a durable spline entity.')
    assert(session.definition.points.length === 3, 'Spline commit output should add its fit points.')
    assert(session.commitRequest?.definition.entities[0]?.kind === 'spline', 'Spline commit request should include durable spline geometry.')
    assert(session.toolStagedEntities.length === 0, 'Spline commit should clear staged preview geometry.')
  }

  function testAdvancedCurveConstructorsCommitDurableIntent() {
    const ellipse = drawSketchTool('ellipse', [[0, 0], [2, 0], [0, 1]])
    assert(ellipse.definition.entities[0]?.kind === 'ellipse', 'Ellipse tool should commit a durable ellipse entity.')
    assert(ellipse.definition.points.length === 2, 'Ellipse tool should persist center and major-axis defining points.')
    assert(
      getSketchSessionDisplayRenderables(ellipse).some((renderable) =>
        renderable.target?.kind === 'sketchEntity'
        && renderable.target.entityId === ellipse.definition.entities[0]?.entityId
        && renderable.geometry.kind === 'polyline',
      ),
      'Committed ellipse should render with a stable sketch entity target.',
    )

    const ellipticalArc = drawSketchTool('ellipticalArc', [[0, 0], [3, 0], [0, 1], [3, 0], [0, 1]])
    assert(ellipticalArc.definition.entities[0]?.kind === 'ellipticalArc', 'Elliptical arc tool should commit durable elliptical arc geometry.')

    const conic = drawSketchTool('conic', [[0, 0], [1, 2], [2, 0]])
    assert(conic.definition.entities[0]?.kind === 'conic', 'Conic tool should commit durable conic geometry.')
    const solvedConic = solveSketchDefinitionCore({
      definition: conic.definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: 'bestEffort',
    })
    const conicRegions = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_draft',
      definition: conic.definition,
      solvedSnapshot: solvedConic.solvedSnapshot,
    })
    assert(
      conicRegions.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-profile-entity'),
      'Valid advanced curves that are not profile-capable yet should emit unsupported-case diagnostics.',
    )

    const bezier = drawSketchTool('bezierCurve', [[0, 0], [1, 2], [2, 2], [3, 0]])
    assert(bezier.definition.entities[0]?.kind === 'bezierCurve', 'Bezier tool should commit durable Bezier geometry.')
    assert(bezier.definition.entities[0]?.kind === 'bezierCurve' && bezier.definition.entities[0].degree === 3, 'Bezier tool should preserve cubic degree.')

    const controlSpline = drawSketchTool('controlPointSpline', [[0, 0], [1, 2], [2, 2], [3, 0]])
    assert(controlSpline.definition.entities[0]?.kind === 'spline', 'Control-point spline should still commit durable spline geometry.')
    assert(controlSpline.definition.entities[0]?.kind === 'spline' && controlSpline.definition.entities[0].degree === 3, 'Control-point spline should stay distinct from fit-point spline degree.')

    const fitSpline = drawSketchTool('spline', [[0, 0], [1, 2], [2, 0]])
    assert(fitSpline.definition.entities[0]?.kind === 'spline' && fitSpline.definition.entities[0].degree === 2, 'Fit-point spline behavior should remain unchanged.')
  }

  function testAdvancedToolValidationRejectsDegenerateInput() {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      'ellipse',
    )
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [1, 0])
    session = acceptSketchDraw(session, [2, 0])

    assert(session.definition.entities.length === 0, 'Invalid ellipse input should not mutate the authored sketch definition.')
    assert(session.validationMessage === 'Ellipse requires non-zero major and minor radii.', 'Invalid ellipse input should report validation feedback.')
  }

  function testProfileTextCommitsEditableTextAndDerivedProfile() {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      'profileText',
    )
    session = patchSketchDrawingToolValue(session, { intent: 'setToolSetting', key: 'text', value: 'CUT' })
    session = patchSketchDrawingToolValue(session, { intent: 'setToolSetting', key: 'horizontalAlign', value: 'center' })
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [0, 2])

    const textEntity = session.definition.entities[0]
    assert(textEntity?.kind === 'profileText', 'Text tool should commit a durable profileText entity.')
    assert(textEntity.kind === 'profileText' && textEntity.text === 'CUT', 'Text tool should preserve editable text content.')
    assert(textEntity.kind === 'profileText' && textEntity.horizontalAlign === 'center', 'Text tool should persist placement options.')
    assert(
      getSketchSessionDisplayRenderables(session).some((renderable) =>
        renderable.target?.kind === 'sketchEntity'
        && renderable.target.entityId === textEntity.entityId
        && renderable.geometry.kind === 'polyline',
      ),
      'Committed text should render with a stable sketch entity target.',
    )

    const solved = solveSketchDefinitionCore({
      definition: session.definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: 'bestEffort',
    })
    const regions = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_draft',
      definition: session.definition,
      solvedSnapshot: solved.solvedSnapshot,
    })

    assert(regions.regions.length >= 1, 'Supported profile-generating text should expose downstream profile regions.')
    assert(
      regions.regions.some((region) =>
        region.loops.some((loop) =>
          loop.segments.some((segment) =>
            segment.source.kind === 'entity' && segment.source.entityId === textEntity.entityId,
          ),
        ),
      ),
      'Derived text profile should preserve the text entity as its selectable boundary source.',
    )
  }

  function testInvalidProfileTextDoesNotCommitPartialEntity() {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      'profileText',
    )
    session = patchSketchDrawingToolValue(session, { intent: 'setToolSetting', key: 'text', value: '   ' })
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [0, 2])

    assert(session.definition.entities.length === 0, 'Invalid text input should not commit a partial profileText entity.')
    assert(session.validationMessage === 'Text content is required.', 'Invalid text should report validation feedback.')
  }

  function testGenericPresentationAccessFromSession() {
    const session = beginSketchTool(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      'line',
    )
    const presentation = getSketchToolPresentation(session)

    assert(presentation?.prompts[0]?.text === 'Pick line start', 'Session presentation should be resolved through the active sketch tool schema.')
    assert(
      presentation.validation?.length === 0,
      'Newly activated sketch tools should expose validation as declarative schema state.',
    )
  }

  testRegistryContainsCurrentSketchToolSet()
  testToolFamiliesAndDiscoveryExposePrimitiveConstructors()
  testLinePointerLifecycleProducesStagedGeometry()
  testCirclePresentationSchemaExposesPromptControlAndDiameterOverlay()
  testRectanglePresentationSchemaExposesAnchoredWidthAndHeightOverlays()
  testSessionRuntimeDelegatesCommitOutputToToolModule()
  testPointAndMidpointLineConstructorsCommitDurableIntent()
  testRectangleConstructorsCommitDurableIntent()
  testCircleArcAndPolygonConstructorsCommitDurableIntent()
  testSplineCollectsThreePointsAndCommitsDurableGeometry()
  testAdvancedCurveConstructorsCommitDurableIntent()
  testAdvancedToolValidationRejectsDegenerateInput()
  testProfileTextCommitsEditableTextAndDerivedProfile()
  testInvalidProfileTextDoesNotCommitPartialEntity()
  testGenericPresentationAccessFromSession()
})
