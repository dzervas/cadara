import { test } from 'bun:test'

import {
  cancelCoalescedSketchGeometryDragMove,
  WORKSPACE_SCAFFOLD_RENDER_ORDER,
  configureWorkspaceScaffoldWireObject,
  createRenderIdleTracker,
  createViewportBvhSceneKey,
  projectSceneTargetCentroidToViewport,
  resizeViewCubeRenderer,
  scheduleCoalescedSketchGeometryDragMove,
} from '@/components/cad/three-cad-viewport-helpers'
import { createDimensionAnnotationPlacementPatch } from '@/components/cad/three-cad-viewport-annotation-drag'
import { bindRenderableObject } from '@/domain/workspace/render-picking'
import * as THREE from 'three'

test('src/components/cad/three-cad-viewport.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
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

  testDragMovesCoalesceToLatestPoint()
  testDragMoveCancellationDropsPendingFrame()
  testSketchBvhKeyIgnoresPositionalPolylineUpdates()
  testProjectionBridgeResolvesKnownTarget()
  testRenderIdleTrackerRequiresStableIdleFrames()
  testViewCubeResizeUpdatesCanvasCssSize()
  testWorkspaceScaffoldWiresDoNotWriteDepth()
  testDimensionAnnotationDragPatchTargetsDurablePlacement()
})
