import { test } from 'bun:test'

import {
  cancelCoalescedSketchGeometryDragMove,
  getViewportPickTuning,
  WORKSPACE_SCAFFOLD_RENDER_ORDER,
  configureWorkspaceScaffoldWireObject,
  createRenderIdleTracker,
  createViewportBvhSceneKey,
  projectWorldPointToViewport,
  projectSceneTargetCentroidToViewport,
  resolveSectionScreenDragOffset,
  resizeViewCubeRenderer,
  scheduleCoalescedSketchGeometryDragMove,
} from '@/components/cad/three-cad-viewport-helpers'
import {
  requestViewCubeCameraTransition,
  resolveSketchCameraTransition,
} from '@/components/cad/three-cad-viewport-camera-transitions'
import { createDimensionAnnotationPlacementPatch } from '@/components/cad/three-cad-viewport-annotation-drag'
import { bindRenderableObject } from '@/domain/workspace/render-picking'
import { measureSelectionFilter } from '@/domain/editor/schema'
import type { ViewportCameraControls } from '@/domain/workspace/viewport-camera-controls'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import * as THREE from 'three'

test('src/components/cad/three-cad-viewport.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function createControls(target: THREE.Vector3): ViewportCameraControls {
    return {
      target,
      update: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
  }

  function testDragMovesCoalesceToLatestPoint() {
    const pendingPointRef = { current: null as readonly [number, number] | null }
    const pendingFrameIdRef = { current: null as number | null }
    const frameCallbacks = new Map<number, FrameRequestCallback>()
    const movedPoints: readonly [number, number][] = []
    let nextFrameId = 1

    const schedule = (point: readonly [number, number]) => scheduleCoalescedSketchGeometryDragMove({
      point,
      pendingPointRef,
      pendingFrameIdRef,
      requestFrame: (callback) => {
        const frameId = nextFrameId
        nextFrameId += 1
        frameCallbacks.set(frameId, callback)
        return frameId
      },
      isDragActive: () => true,
      onMove: (latestPoint) => movedPoints.push(latestPoint),
    })

    schedule([1, 1])
    schedule([2, 2])
    schedule([3, 3])

    assert(frameCallbacks.size === 1, 'Drag scheduler should request one frame for multiple pending moves.')
    frameCallbacks.get(1)?.(0)

    assert(movedPoints.length === 1, 'Drag scheduler should dispatch once per frame.')
    assert(movedPoints[0]?.[0] === 3 && movedPoints[0]?.[1] === 3, 'Drag scheduler should dispatch the latest point.')
  }

  function testDragMoveCancellationDropsPendingFrame() {
    const pendingPointRef = { current: null as readonly [number, number] | null }
    const pendingFrameIdRef = { current: null as number | null }
    const frameCallbacks = new Map<number, FrameRequestCallback>()
    const cancelledFrames: number[] = []
    const movedPoints: readonly [number, number][] = []

    scheduleCoalescedSketchGeometryDragMove({
      point: [4, 5],
      pendingPointRef,
      pendingFrameIdRef,
      requestFrame: (callback) => {
        frameCallbacks.set(7, callback)
        return 7
      },
      isDragActive: () => true,
      onMove: (latestPoint) => movedPoints.push(latestPoint),
    })
    cancelCoalescedSketchGeometryDragMove({
      pendingPointRef,
      pendingFrameIdRef,
      cancelFrame: (frameId) => cancelledFrames.push(frameId),
    })
    frameCallbacks.get(7)?.(0)

    assert(cancelledFrames[0] === 7, 'Drag cancellation should cancel the pending frame.')
    assert(pendingFrameIdRef.current === null, 'Drag cancellation should clear the pending frame id.')
    assert(pendingPointRef.current === null, 'Drag cancellation should clear the pending point.')
    assert(movedPoints.length === 0, 'Cancelled drag frame should not dispatch a stale move.')
  }

  function testSketchBvhKeyIgnoresPositionalPolylineUpdates() {
    const renderable = {
      id: 'renderable_sketch_line_0',
      label: 'Line',
      geometry: {
        kind: 'polyline',
        points: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        isClosed: false,
      },
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_ab' },
      linePattern: 'solid',
      role: 'local',
    } as const
    const movedRenderable = {
      ...renderable,
      geometry: {
        ...renderable.geometry,
        points: [
          [3, 4, 0],
          [5, 4, 0],
        ],
      },
    } as const
    const dashedRenderable = {
      ...movedRenderable,
      linePattern: 'dashed',
    } as const

    assert(
      createViewportBvhSceneKey([], [renderable]) === createViewportBvhSceneKey([], [movedRenderable]),
      'Sketch BVH key should stay stable for positional-only polyline updates.',
    )
    assert(
      createViewportBvhSceneKey([], [movedRenderable]) !== createViewportBvhSceneKey([], [dashedRenderable]),
      'Sketch BVH key should change when structural line styling changes.',
    )
  }

  function testSketchBvhKeyDoesNotEmbedInlineImagePayloads() {
    const renderable = {
      id: 'renderable_sketch_reference_image_0',
      label: 'Reference image',
      geometry: {
        kind: 'mesh',
        vertexPositions: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
          [0, 1, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [[0, 1, 2], [0, 2, 3]],
      },
      target: { kind: 'sketchOperation', sketchId: 'sketch_primary', operationId: 'sketch_operation_1_reference-image' },
      linePattern: 'solid',
      role: 'local',
      semanticClass: 'sketchImage',
      textureFill: {
        kind: 'inlineImage',
        sourceKey: 'sketch_operation_1_reference-image:image/png:reference.png:640x480',
        mediaType: 'image/png',
        base64Data: 'cG5n',
        uvCoordinates: [
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
        opacity: 0.55,
      },
    } as const
    const changedPayloadRenderable = {
      ...renderable,
      textureFill: {
        ...renderable.textureFill,
        base64Data: 'dXBkYXRlZA==',
      },
    } as const

    assert(
      createViewportBvhSceneKey([], [renderable]) === createViewportBvhSceneKey([], [changedPayloadRenderable]),
      'Sketch BVH keys should stay independent from inline image payload bytes.',
    )
  }

  function testProjectionBridgeResolvesKnownTarget() {
    const root = new THREE.Group()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())

    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    bindRenderableObject(
      mesh,
      null,
      { kind: 'body', bodyId: 'body_feature_extrude-1' },
      'bodyFace',
      'document',
    )
    root.add(mesh)

    const point = projectSceneTargetCentroidToViewport({
      root,
      camera,
      objectId: 'body_feature_extrude-1',
      viewport: { width: 200, height: 100 },
    })
    const missingPoint = projectSceneTargetCentroidToViewport({
      root,
      camera,
      objectId: 'missing-target',
      viewport: { width: 200, height: 100 },
    })

    assert(point !== null, 'Projection bridge should return coordinates for a known target.')
    assert(Math.abs(point.x - 100) < 0.001, 'Projected target should be centered horizontally.')
    assert(Math.abs(point.y - 50) < 0.001, 'Projected target should be centered vertically.')
    assert(missingPoint === null, 'Projection bridge should return null for unknown targets.')

    mesh.geometry.dispose()
    if (mesh.material instanceof THREE.Material) {
      mesh.material.dispose()
    }
  }

  function testWorldPointProjectionMapsViewportCoordinates() {
    const camera = new THREE.PerspectiveCamera(45, 2, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()

    const centeredPoint = projectWorldPointToViewport({
      camera,
      point: [0, 0, 0],
      viewport: { width: 240, height: 120 },
    })
    const offsetPoint = projectWorldPointToViewport({
      camera,
      point: [1, 0, 0],
      viewport: { width: 240, height: 120 },
    })
    const hiddenPoint = projectWorldPointToViewport({
      camera,
      point: [0, 0, 20],
      viewport: { width: 240, height: 120 },
    })

    assert(centeredPoint !== null, 'World-point projection should resolve visible points.')
    assert(Math.abs(centeredPoint.x - 120) < 0.001, 'Projection should center the world origin horizontally.')
    assert(Math.abs(centeredPoint.y - 60) < 0.001, 'Projection should center the world origin vertically.')
    assert(offsetPoint !== null && offsetPoint.x > centeredPoint.x, 'Projection should preserve horizontal ordering for visible points.')
    assert(hiddenPoint === null, 'Projection should reject points that fall behind the active camera.')
  }

  function testSectionScreenDragOffsetTracksProjectedNormalMotion() {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(8, -10, 6)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()

    const section = {
      seed: { kind: 'construction', constructionId: 'construction_plane-xy' },
      plane: createStandardPlaneDefinition('xy'),
      offset: 0,
      retainedSide: 'positive',
    } as const

    const center = projectWorldPointToViewport({
      camera,
      point: [0, 0, 0],
      viewport: { width: 200, height: 200 },
    })
    const normalPoint = projectWorldPointToViewport({
      camera,
      point: [0, 0, 1],
      viewport: { width: 200, height: 200 },
    })

    assert(center !== null && normalPoint !== null, 'Section drag projection should be testable with visible handle points.')

    const axisDelta = {
      x: normalPoint.x - center.x,
      y: normalPoint.y - center.y,
    }
    const axisLength = Math.hypot(axisDelta.x, axisDelta.y)
    const axisUnit = { x: axisDelta.x / axisLength, y: axisDelta.y / axisLength }
    const offset = resolveSectionScreenDragOffset({
      camera,
      viewport: { width: 200, height: 200 },
      sectionAtDragStart: section,
      dragStartClientPoint: center,
      currentClientPoint: {
        x: center.x + axisUnit.x * axisLength * 2,
        y: center.y + axisUnit.y * axisLength * 2,
      },
    })

    assert(offset !== null, 'Section drag projection should resolve a numeric offset for visible axis motion.')
    assert(Math.abs(offset - 2) < 0.05, 'Section drag projection should convert two projected world units into offset motion along the section normal.')
  }

  function testSectionScreenDragOffsetFallsBackWhenNormalProjectsToPoint() {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()

    const offset = resolveSectionScreenDragOffset({
      camera,
      viewport: { width: 200, height: 200 },
      sectionAtDragStart: {
        seed: { kind: 'construction', constructionId: 'construction_plane-xy' },
        plane: createStandardPlaneDefinition('xy'),
        offset: 0,
        retainedSide: 'positive',
      },
      dragStartClientPoint: { x: 100, y: 100 },
      currentClientPoint: { x: 100, y: 80 },
    })

    assert(offset !== null, 'Section drag projection should still resolve an offset when the section normal is view-aligned.')
    assert(Math.abs(offset) > 0.001, 'Section drag projection fallback should produce visible motion for aligned views.')
  }

  function testRenderIdleTrackerRequiresStableIdleFrames() {
    const tracker = createRenderIdleTracker({ requiredStableFrames: 2, maxStableDelta: 0.05 })
    const active = tracker.update({
      delta: 0.016,
      isEditorIdle: false,
      sceneKey: 'scene-a',
    })
    const firstIdle = tracker.update({
      delta: 0.016,
      isEditorIdle: true,
      sceneKey: 'scene-a',
    })
    const secondIdle = tracker.update({
      delta: 0.016,
      isEditorIdle: true,
      sceneKey: 'scene-a',
    })
    const sceneChanged = tracker.update({
      delta: 0.016,
      isEditorIdle: true,
      sceneKey: 'scene-b',
    })

    assert(active === false, 'Render idle should stay false while the editor is active.')
    assert(firstIdle === false, 'Render idle should require consecutive stable frames.')
    assert(secondIdle === true, 'Render idle should become true after enough stable idle frames.')
    assert(sceneChanged === false, 'Render idle should clear when the scene changes.')
  }

  function testViewCubeResizeUpdatesCanvasCssSize() {
    const setSizeCalls: Array<{ width: number, height: number, updateStyle?: boolean }> = []
    const cubeSize = resizeViewCubeRenderer({
      cubeElement: { clientWidth: 120, clientHeight: 96 },
      renderer: {
        setSize: (width, height, updateStyle) => {
          setSizeCalls.push({ width, height, updateStyle })
        },
      },
    })

    assert(cubeSize === 96, 'View cube renderer should fit within the smaller cube container dimension.')
    assert(setSizeCalls.length === 1, 'View cube resize should issue one renderer size update.')
    assert(setSizeCalls[0]?.width === 96, 'View cube renderer width should match the computed CSS size.')
    assert(setSizeCalls[0]?.height === 96, 'View cube renderer height should match the computed CSS size.')
    assert(
      setSizeCalls[0]?.updateStyle === true,
      'View cube renderer should update canvas CSS size so devicePixelRatio does not enlarge the visible overlay.',
    )
  }

  function testWorkspaceScaffoldWiresDoNotWriteDepth() {
    const grid = configureWorkspaceScaffoldWireObject(new THREE.GridHelper(10, 10))
    const axes = configureWorkspaceScaffoldWireObject(new THREE.AxesHelper(4))
    const materials = [
      ...(Array.isArray(grid.material) ? grid.material : [grid.material]),
      ...(Array.isArray(axes.material) ? axes.material : [axes.material]),
    ]

    assert(grid.renderOrder === WORKSPACE_SCAFFOLD_RENDER_ORDER, 'Grid should render before model and sketch wires.')
    assert(axes.renderOrder === WORKSPACE_SCAFFOLD_RENDER_ORDER, 'Axes should render before model and sketch wires.')
    assert(
      materials.every((material) => material.depthTest && !material.depthWrite),
      'Scaffold wire materials should depth-test without writing depth.',
    )

    grid.geometry.dispose()
    axes.geometry.dispose()
    materials.forEach((material) => material.dispose())
  }

  function testMeasurePickTuningTightensWirePassThroughTolerance() {
    const defaultTuning = getViewportPickTuning(null)
    const measureTuning = getViewportPickTuning(measureSelectionFilter)

    assert(
      defaultTuning.linePickThreshold > measureTuning.linePickThreshold,
      'Measure picking should reduce the line threshold to avoid selecting hidden wires through faces.',
    )
    assert(
      (measureTuning.resolutionOptions.wireOcclusionTolerance ?? Number.POSITIVE_INFINITY) < Number.POSITIVE_INFINITY,
      'Measure picking should install an explicit wire occlusion tolerance override.',
    )
    assert(
      (measureTuning.resolutionOptions.wireOcclusionTolerance ?? 0)
        < (defaultTuning.resolutionOptions.wireOcclusionTolerance ?? Number.POSITIVE_INFINITY),
      'Measure picking should use a tighter face-over-wire occlusion tolerance than the default picker.',
    )
  }

  function testDimensionAnnotationDragPatchTargetsDurablePlacement() {
    const patch = createDimensionAnnotationPlacementPatch(
      { id: 'dimension_1-annotation-drag', dimensionId: 'dimension_1' },
      [8, 3],
    )

    assert(
      patch.intent === 'setDimensionAnnotationPlacement'
        && patch.handleId === 'dimension_1-annotation-drag'
        && patch.dimensionId === 'dimension_1'
        && patch.point[0] === 8
        && patch.point[1] === 3,
      'Dimension annotation drags should route through the committed dimension placement patch path.',
    )
  }

  function testViewCubeRequestsAnimatedTransition() {
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    camera.position.set(12, -12, 12)
    const controls = createControls(new THREE.Vector3(1, 2, 3))
    const requests: Array<{ fromFrameProjectionMode: string, targetFrameProjectionMode: string }> = []

    const result = requestViewCubeCameraTransition({
      presetId: 'front',
      camera,
      controls,
      requestTransition: (targetFrame, fromFrame) => {
        requests.push({
          fromFrameProjectionMode: fromFrame?.projectionMode ?? 'unknown',
          targetFrameProjectionMode: targetFrame.projectionMode,
        })
      },
    })

    assert(result !== null, 'View cube clicks should produce a camera transition request when the viewport is ready.')
    assert(requests.length === 1, 'View cube navigation should request one shared animated transition.')
    assert(
      requests[0]?.fromFrameProjectionMode === 'orthographic' && requests[0]?.targetFrameProjectionMode === 'orthographic',
      'View cube navigation should preserve the active projection when requesting the transition.',
    )
  }

  function testSketchEntryRequestsAnimatedFraming() {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(14, -16, 28)
    const controls = createControls(new THREE.Vector3(0, 0, 4))
    const sketchSession = {
      sketchId: 'sketch_1',
      plane: {
        support: { kind: 'construction', constructionId: 'construction_plane-xy' },
        key: 'xy',
        frame: {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
          linearUnit: 'documentLength',
          handedness: 'rightHanded',
        },
      },
    } as Parameters<typeof resolveSketchCameraTransition>[0]['sketchSession']

    const resolution = resolveSketchCameraTransition({
      camera,
      controls,
      sketchSession,
      sketchDisplayRenderables: [],
      state: {
        activeSessionToken: null,
        preSketchFrame: null,
      },
    })

    assert(resolution.targetFrame !== null, 'Entering sketch mode should request a transition into the sketch frame.')
    assert(resolution.fromFrame?.projectionMode === 'perspective', 'Sketch entry should capture the pre-entry camera pose.')
    assert(resolution.state.activeSessionToken !== null, 'Sketch entry should scope the saved camera pose to the active session token.')
  }

  function testSketchExitRequestsRestoreTransition() {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(8, 8, 8)
    const controls = createControls(new THREE.Vector3(0, 0, 0))

    const resolution = resolveSketchCameraTransition({
      camera,
      controls,
      sketchSession: null,
      sketchDisplayRenderables: [],
      state: {
        activeSessionToken: 'sketch_1:construction:construction_plane-xy:0,0,0',
        preSketchFrame: {
          projectionMode: 'orthographic',
          position: new THREE.Vector3(20, -20, 20),
          target: new THREE.Vector3(0, 0, 4),
          up: new THREE.Vector3(0, 0, 1),
          cameraDistance: Math.sqrt((20 ** 2) * 3),
          perspectiveDistance: 18,
          orthographicZoom: 1.4,
        },
      },
    })

    assert(resolution.targetFrame?.projectionMode === 'orthographic', 'Sketch exit should restore the captured pre-entry projection.')
    assert(resolution.fromFrame?.projectionMode === 'perspective', 'Sketch exit should animate back from the current sketch camera pose.')
    assert(
      resolution.state.activeSessionToken === null && resolution.state.preSketchFrame === null,
      'Sketch exit should clear the active session-scoped camera snapshot after requesting restoration.',
    )
  }

  testDragMovesCoalesceToLatestPoint()
  testDragMoveCancellationDropsPendingFrame()
  testSketchBvhKeyIgnoresPositionalPolylineUpdates()
  testSketchBvhKeyDoesNotEmbedInlineImagePayloads()
  testProjectionBridgeResolvesKnownTarget()
  testWorldPointProjectionMapsViewportCoordinates()
  testSectionScreenDragOffsetTracksProjectedNormalMotion()
  testSectionScreenDragOffsetFallsBackWhenNormalProjectsToPoint()
  testRenderIdleTrackerRequiresStableIdleFrames()
  testViewCubeResizeUpdatesCanvasCssSize()
  testWorkspaceScaffoldWiresDoNotWriteDepth()
  testMeasurePickTuningTightensWirePassThroughTolerance()
  testDimensionAnnotationDragPatchTargetsDurablePlacement()
  testViewCubeRequestsAnimatedTransition()
  testSketchEntryRequestsAnimatedFraming()
  testSketchExitRequestsRestoreTransition()
})
