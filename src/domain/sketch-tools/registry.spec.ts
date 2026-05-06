import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
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
} from '@/core/sketch-tools/registry'
import {
  getRegisteredSketchEditToolDefinitions,
  isRegisteredSketchEditToolId,
} from '@/core/sketch-edit-tools/registry'
import { getToolById, getToolbarSectionsForMode, searchToolDefinitions } from '@/core/tools/tool-registry'

test('src/domain/sketch-tools/registry.spec.ts', async () => {  function testRegistryContainsCurrentSketchToolSet() {
    const registeredToolIds = getRegisteredSketchToolDefinitions()
      .map((definition) => definition.metadata.id)
      .sort()
    const registeredEditToolIds = getRegisteredSketchEditToolDefinitions()
      .map((definition) => definition.metadata.id)
      .sort()

    expectTrue(
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
    expectTrue(isRegisteredSketchToolId('line'), 'Line should resolve as a registered sketch tool.')
    expectTrue(isRegisteredSketchToolId('midpointLine'), 'Midpoint Line should resolve as a registered sketch tool.')
    expectTrue(isRegisteredSketchToolId('spline'), 'Spline should resolve as a registered sketch tool.')
    expectTrue(
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
    expectTrue(isRegisteredSketchEditToolId('sketchFillet'), 'Sketch fillet should resolve as a registered sketch edit tool.')
    expectTrue(!isRegisteredSketchEditToolId('fillet'), 'Part fillet should stay distinct from sketch fillet.')
  }

  function testToolFamiliesAndDiscoveryExposePrimitiveConstructors() {
    expectTrue(
      getToolById('line').dropdown?.variantIds.includes('midpointLine'),
      'Line family should expose the midpoint-line constructor.',
    )
    expectTrue(
      getToolById('rectangle').dropdown?.variantIds.includes('centerPointRectangle')
        && getToolById('rectangle').dropdown?.variantIds.includes('alignedRectangle'),
      'Rectangle family should expose center-point and aligned rectangle constructors.',
    )
    expectTrue(
      getToolById('circle').dropdown?.variantIds.includes('threePointCircle'),
      'Circle family should expose the 3-point circle constructor.',
    )
    expectTrue(
      getToolById('centerPointArc').dropdown?.variantIds.includes('threePointArc')
        && getToolById('centerPointArc').dropdown?.variantIds.includes('tangentArc'),
      'Arc family should expose center, 3-point, and tangent arc constructors.',
    )
    expectTrue(
      getToolById('inscribedPolygon').dropdown?.variantIds.includes('circumscribedPolygon'),
      'Polygon family should expose inscribed and circumscribed constructors.',
    )
    expectTrue(
      getToolById('ellipse').dropdown?.variantIds.includes('ellipticalArc')
        && getToolById('ellipse').dropdown?.variantIds.includes('conic')
        && getToolById('ellipse').dropdown?.variantIds.includes('bezierCurve'),
      'Advanced curve family should expose ellipse, elliptical arc, conic, and Bezier constructors.',
    )
    expectTrue(
      getToolById('spline').dropdown?.variantIds.includes('controlPointSpline'),
      'Spline family should expose fit-point and control-point spline constructors.',
    )

    const sketchDrawingSection = getToolbarSectionsForMode('sketch').find((section) => section.id === 'drawing')
    expectTrue(getToolById('point').id === 'point', 'Point should resolve through the shared tool registry.')
    expectTrue(getToolById('point').icon === 'point', 'Point should expose a dedicated toolbar icon instead of reusing Circle.')
    expectTrue(sketchDrawingSection?.toolIds.includes('point'), 'Sketch toolbar should include the Point constructor.')
    expectTrue(sketchDrawingSection?.toolIds.includes('centerPointArc'), 'Sketch toolbar should include an arc family trigger.')
    expectTrue(sketchDrawingSection?.toolIds.includes('ellipse'), 'Sketch toolbar should include an advanced curve family trigger.')
    expectTrue(sketchDrawingSection?.toolIds.includes('inscribedPolygon'), 'Sketch toolbar should include a polygon family trigger.')
    expectTrue(sketchDrawingSection?.toolIds.includes('profileText'), 'Sketch toolbar should include profile text.')
    expectTrue(!sketchDrawingSection?.toolIds.includes('anchorPoint'), 'Sketch toolbar should no longer expose the legacy image pin tool.')
    expectTrue(
      getToolbarSectionsForMode('sketch').some((section) =>
        section.id === 'sketchOps'
        && section.toolIds.includes('importImage')
        && section.toolIds.includes('sketchFillet')
        && section.toolIds.includes('sketchChamfer')
        && section.toolIds.includes('sketchExtend')
        && section.toolIds.includes('sketchSplit')
        && section.toolIds.includes('sketchSlot'),
      ),
      'Sketch toolbar should include the sketch edit operators.',
    )
    expectTrue(
      searchToolDefinitions('tangent').some((tool) => tool.id === 'tangentArc')
        && searchToolDefinitions('polygon').some((tool) => tool.id === 'circumscribedPolygon'),
      'Tool search should discover sketch constructor dropdown variants.',
    )
    expectTrue(
      searchToolDefinitions('fillet').some((tool) => tool.id === 'sketchFillet')
        && searchToolDefinitions('fillet').some((tool) => tool.id === 'fillet'),
      'Tool search should expose sketch and part fillet tools separately.',
    )
    expectTrue(
      searchToolDefinitions('bezier').some((tool) => tool.id === 'bezierCurve')
        && searchToolDefinitions('text').some((tool) => tool.id === 'profileText'),
      'Tool search should discover advanced curve and text constructors.',
    )
    expectTrue(searchToolDefinitions('point').some((tool) => tool.id === 'point'), 'Tool search should discover the Point constructor.')
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

    expectTrue(moved.stagedEntities.length === 1, 'Line pointer movement should produce one staged line entity.')
    expectTrue(moved.stagedEntities[0]?.kind === 'line', 'Line staged geometry should be a line entity.')
    expectTrue(moved.presentation.measurements?.[0]?.label === 'Length', 'Line presentation should expose live length guidance.')
    const lengthOverlay = moved.presentation.overlays?.find((overlay) => overlay.id === 'line-length-overlay')
    const angleOverlay = moved.presentation.overlays?.find((overlay) => overlay.id === 'line-angle-overlay')
    expectTrue(
      lengthOverlay?.kind === 'measurement'
        && lengthOverlay.value === 10
        && lengthOverlay.anchor.kind === 'sketchPoint',
      'Line presentation should expose anchored live length guidance.',
    )
    expectTrue(
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

    expectTrue(moved.presentation.prompts[0]?.text === 'Set radius', 'Circle presentation should update its prompt by interaction step.')
    expectTrue(moved.presentation.controls?.some((control) => control.id === 'circle-radius'), 'Circle presentation should expose radius through a generic numeric control.')
    const diameterOverlay = moved.presentation.overlays?.find((overlay) => overlay.id === 'circle-diameter-overlay')
    expectTrue(
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

    expectTrue(
      widthOverlay?.kind === 'measurement'
        && widthOverlay.value === 4
        && widthOverlay.anchor.kind === 'sketchPoint',
      'Rectangle presentation should expose anchored live width guidance.',
    )
    expectTrue(
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

    expectTrue(accepted.definition.entityIds.length === 4, 'Rectangle commit output should add four line entities.')
    expectTrue(accepted.definition.constraintIds.length === 4, 'Rectangle commit output should add horizontal and vertical constraints.')
    expectTrue(accepted.definition.dimensionIds.length === 2, 'Rectangle commit output should add width and height dimensions.')
    expectTrue(accepted.toolStagedEntities.length === 0, 'Accepted rectangle geometry should clear preview entities.')
    expectTrue(
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
    expectTrue(pointSession.definition.entities[0]?.kind === 'point', 'Point constructor should commit a durable point entity.')
    expectTrue(pointSession.commitRequest?.definition.entities[0]?.kind === 'point', 'Point commit request should include durable point geometry.')

    const midpointSession = drawSketchTool('midpointLine', [[1, 1], [3, 1]])
    const line = midpointSession.definition.entities.find((entity) => entity.kind === 'lineSegment')
    const midpointConstraint = midpointSession.definition.constraints.find((constraint) => constraint.kind === 'midpoint')
    expectTrue(line?.kind === 'lineSegment', 'Midpoint line should commit a durable line segment.')
    expectTrue(midpointConstraint?.kind === 'midpoint', 'Midpoint line should commit midpoint intent.')
  }

  function testRectangleConstructorsCommitDurableIntent() {
    const centerRectangle = drawSketchTool('centerPointRectangle', [[0, 0], [2, 1]])
    expectTrue(centerRectangle.definition.entities.filter((entity) => entity.kind === 'lineSegment').length === 6, 'Center rectangle should commit four edges and two construction diagonals.')
    expectTrue(
      centerRectangle.definition.constraints.filter((constraint) => constraint.kind === 'midpoint').length === 2,
      'Center rectangle should preserve center intent through midpoint constraints.',
    )

    const alignedRectangle = drawSketchTool('alignedRectangle', [[0, 0], [4, 0], [4, 3]])
    expectTrue(alignedRectangle.definition.entities.length === 4, 'Aligned rectangle should commit four line entities.')
    expectTrue(
      alignedRectangle.definition.constraints.some((constraint) => constraint.kind === 'parallel')
        && alignedRectangle.definition.constraints.some((constraint) => constraint.kind === 'perpendicular')
        && alignedRectangle.definition.constraints.some((constraint) => constraint.kind === 'equalLength'),
      'Aligned rectangle should preserve parallel, perpendicular, and equal-length intent.',
    )
  }

  function testCircleArcAndPolygonConstructorsCommitDurableIntent() {
    const threePointCircle = drawSketchTool('threePointCircle', [[0, 1], [1, 0], [0, -1]])
    expectTrue(threePointCircle.definition.entities[0]?.kind === 'circle', '3-point circle should commit a durable circle.')
    expectTrue(
      threePointCircle.definition.constraints.filter((constraint) => constraint.kind === 'pointOnCurve').length === 3,
      '3-point circle should preserve its defining perimeter points.',
    )

    const centerArc = drawSketchTool('centerPointArc', [[0, 0], [1, 0], [0, 1]])
    expectTrue(centerArc.definition.entities[0]?.kind === 'arc', 'Center-point arc should commit a durable arc.')

    const threePointArc = drawSketchTool('threePointArc', [[1, 0], [0, 1], [-1, 0]])
    expectTrue(threePointArc.definition.entities[0]?.kind === 'arc', '3-point arc should commit a durable arc.')
    expectTrue(
      threePointArc.definition.constraints.some((constraint) => constraint.kind === 'pointOnCurve'),
      '3-point arc should preserve its through-point relationship.',
    )

    const tangentArc = drawSketchTool('tangentArc', [[0, 0], [1, 0], [1, 1]])
    expectTrue(tangentArc.definition.entities[0]?.kind === 'arc', 'Tangent arc should commit a durable arc.')

    const inscribedPolygon = drawSketchTool('inscribedPolygon', [[0, 0], [0, 2]])
    expectTrue(inscribedPolygon.definition.entities.filter((entity) => entity.kind === 'lineSegment').length === 6, 'Inscribed polygon should commit a closed line loop.')
    expectTrue(
      inscribedPolygon.definition.constraints.some((constraint) => constraint.kind === 'pointOnCurve'),
      'Inscribed polygon should constrain vertices to its construction circle.',
    )

    const circumscribedPolygon = drawSketchTool('circumscribedPolygon', [[0, 0], [0, 2]])
    expectTrue(circumscribedPolygon.definition.entities.filter((entity) => entity.kind === 'lineSegment').length === 6, 'Circumscribed polygon should commit a closed line loop.')
    expectTrue(
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

    expectTrue(session.status === 'drawing', 'Spline should keep collecting after the second point.')
    expectTrue(session.definition.entities.length === 0, 'Spline should not commit before it has enough points.')
    expectTrue(
      session.toolStagedEntities.some((entity) => entity.kind === 'spline' && entity.status === 'preview'),
      'Spline should stage preview geometry while collecting points.',
    )

    session = acceptSketchDraw(session, [3, 0])

    expectTrue(session.status === 'idle', 'Spline should return to idle after its first complete curve.')
    expectTrue(session.definition.entities[0]?.kind === 'spline', 'Spline commit output should add a durable spline entity.')
    expectTrue(session.definition.points.length === 3, 'Spline commit output should add its fit points.')
    expectTrue(session.commitRequest?.definition.entities[0]?.kind === 'spline', 'Spline commit request should include durable spline geometry.')
    expectTrue(session.toolStagedEntities.length === 0, 'Spline commit should clear staged preview geometry.')
  }

  function testAdvancedCurveConstructorsCommitDurableIntent() {
    const ellipse = drawSketchTool('ellipse', [[0, 0], [2, 0], [0, 1]])
    expectTrue(ellipse.definition.entities[0]?.kind === 'ellipse', 'Ellipse tool should commit a durable ellipse entity.')
    expectTrue(ellipse.definition.points.length === 2, 'Ellipse tool should persist center and major-axis defining points.')
    expectTrue(
      getSketchSessionDisplayRenderables(ellipse).some((renderable) =>
        renderable.target?.kind === 'sketchEntity'
        && renderable.target.entityId === ellipse.definition.entities[0]?.entityId
        && renderable.geometry.kind === 'polyline',
      ),
      'Committed ellipse should render with a stable sketch entity target.',
    )

    const ellipticalArc = drawSketchTool('ellipticalArc', [[0, 0], [3, 0], [0, 1], [3, 0], [0, 1]])
    expectTrue(ellipticalArc.definition.entities[0]?.kind === 'ellipticalArc', 'Elliptical arc tool should commit durable elliptical arc geometry.')

    const conic = drawSketchTool('conic', [[0, 0], [1, 2], [2, 0]])
    expectTrue(conic.definition.entities[0]?.kind === 'conic', 'Conic tool should commit durable conic geometry.')
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
    expectTrue(
      conicRegions.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-profile-entity'),
      'Valid advanced curves that are not profile-capable yet should emit unsupported-case diagnostics.',
    )

    const bezier = drawSketchTool('bezierCurve', [[0, 0], [1, 2], [2, 2], [3, 0]])
    expectTrue(bezier.definition.entities[0]?.kind === 'bezierCurve', 'Bezier tool should commit durable Bezier geometry.')
    expectTrue(bezier.definition.entities[0]?.kind === 'bezierCurve' && bezier.definition.entities[0].degree === 3, 'Bezier tool should preserve cubic degree.')

    const controlSpline = drawSketchTool('controlPointSpline', [[0, 0], [1, 2], [2, 2], [3, 0]])
    expectTrue(controlSpline.definition.entities[0]?.kind === 'spline', 'Control-point spline should still commit durable spline geometry.')
    expectTrue(controlSpline.definition.entities[0]?.kind === 'spline' && controlSpline.definition.entities[0].degree === 3, 'Control-point spline should stay distinct from fit-point spline degree.')

    const fitSpline = drawSketchTool('spline', [[0, 0], [1, 2], [2, 0]])
    expectTrue(fitSpline.definition.entities[0]?.kind === 'spline' && fitSpline.definition.entities[0].degree === 2, 'Fit-point spline behavior should remain unchanged.')
  }

  function testAdvancedToolValidationRejectsDegenerateInput() {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      'ellipse',
    )
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [1, 0])
    session = acceptSketchDraw(session, [2, 0])

    expectTrue(session.definition.entities.length === 0, 'Invalid ellipse input should not mutate the authored sketch definition.')
    expectTrue(session.validationMessage === 'Ellipse requires non-zero major and minor radii.', 'Invalid ellipse input should report validation feedback.')
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
    expectTrue(textEntity?.kind === 'profileText', 'Text tool should commit a durable profileText entity.')
    expectTrue(textEntity.kind === 'profileText' && textEntity.text === 'CUT', 'Text tool should preserve editable text content.')
    expectTrue(textEntity.kind === 'profileText' && textEntity.horizontalAlign === 'center', 'Text tool should persist placement options.')
    expectTrue(
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

    expectTrue(regions.regions.length >= 1, 'Supported profile-generating text should expose downstream profile regions.')
    expectTrue(
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

    expectTrue(session.definition.entities.length === 0, 'Invalid text input should not commit a partial profileText entity.')
    expectTrue(session.validationMessage === 'Text content is required.', 'Invalid text should report validation feedback.')
  }

  function testGenericPresentationAccessFromSession() {
    const session = beginSketchTool(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      'line',
    )
    const presentation = getSketchToolPresentation(session)

    expectTrue(presentation?.prompts[0]?.text === 'Pick line start', 'Session presentation should be resolved through the active sketch tool schema.')
    expectTrue(
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
