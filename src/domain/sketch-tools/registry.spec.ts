import { test } from 'bun:test'
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  getSketchToolPresentation,
  startSketchDraw,
  updateSketchPointer,
} from '@/domain/editor/sketch-session'
import {
  getRegisteredSketchToolDefinitions,
  getSketchToolDefinition,
  isRegisteredSketchToolId,
} from '@/domain/sketch-tools/registry'

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

    assert(
      JSON.stringify(registeredToolIds) === JSON.stringify(['circle', 'line', 'rectangle']),
      'The sketch tool registry should contain every current drawing tool.',
    )
    assert(isRegisteredSketchToolId('line'), 'Line should resolve as a registered sketch tool.')
    assert(!isRegisteredSketchToolId('spline'), 'Unmigrated drawing tools should not resolve as registered sketch tools.')
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
    assert(accepted.entities.every((entity) => entity.status === 'accepted'), 'Accepted rectangle geometry should replace preview entities.')
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
  testLinePointerLifecycleProducesStagedGeometry()
  testCirclePresentationSchemaExposesPromptControlAndDiameterOverlay()
  testRectanglePresentationSchemaExposesAnchoredWidthAndHeightOverlays()
  testSessionRuntimeDelegatesCommitOutputToToolModule()
  testGenericPresentationAccessFromSession()
})
