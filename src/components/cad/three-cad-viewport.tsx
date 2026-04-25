import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bvh, OrbitControls } from '@react-three/drei'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'

import {
  SketchViewportFeedbackLayer,
} from '@/components/cad/sketch-viewport-feedback'
import {
  SketchConstraintAnnotations,
} from '@/components/cad/sketch-constraint-annotations'
import {
  getSketchDisplayMarkerMaterialConfig,
  getSketchDisplayMeshMaterialConfig,
  getSketchDisplayPolylineMaterialConfig,
  shouldApplySketchDisplayStyles,
} from '@/components/cad/sketch-display-style'
import {
  resolveSketchRenderingPalette,
  type SketchRenderingPalette,
} from '@/components/cad/sketch-rendering-palette'
import {
  collectSketchViewportFeedbackAnchors,
  getAnnotationProjectionId,
  type SketchViewportFeedbackProjection,
} from '@/components/cad/sketch-viewport-feedback-model'
import { createDimensionAnnotationPlacementPatch } from '@/components/cad/three-cad-viewport-annotation-drag'
import {
  requestViewCubeCameraTransition,
  resolveSketchCameraTransition,
  type SketchCameraTransitionState,
} from '@/components/cad/three-cad-viewport-camera-transitions'
import {
  type PrimitiveRef,
  primitiveRefEquals,
  selectionFilterAllowsTarget,
} from '@/domain/editor/schema'
import type {
  SketchAnnotationDescriptor,
  SketchSessionDisplayRenderable,
} from '@/domain/editor/sketch-session'
import type { SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from '@/contracts/shared/references'
import {
  MARKER_SPHERE_GEOMETRY,
  GEOMETRY_HIGHLIGHT_COLORS,
  applyWireMaterialDepthPolicy,
  bindFaceHoverPerimeterObject,
  bindRenderableObject,
  collectBindings,
  collectRaycastPickCandidates,
  createMeshBoundaryLineSegmentsGeometry,
  type CollectedBindings,
  createProjectedPickCandidate,
  createMarkerPickProxy,
  createRenderableLineMaterial,
  createRenderableMarkerMaterial,
  createRenderableMeshMaterial,
  DEFAULT_LINE_PICK_THRESHOLD,
  DEFAULT_PROJECTED_POINT_PICK_ENTER_RADIUS_PX,
  DEFAULT_PROJECTED_POINT_PICK_EXIT_RADIUS_PX,
  getRenderableRenderOrder,
  getVisibleMarkerRadius,
  isSeededDatumPlaneRenderable,
  resolveAllCandidates,
  shouldIncludeProjectedPickCandidate,
  type PickCandidate,
  updateWorkspaceHighlight,
} from '@/domain/workspace/render-picking'
import { createViewportCameraTransitionController } from '@/domain/workspace/viewport-camera-transition'
import {
  getViewportCanvasClickIntent,
  shouldViewportClickEventRequestConnectedSketchSelection,
  shouldViewportDoubleClickRequestConnectedSketchSelection,
  shouldViewportStartSketchGeometryDrag,
} from '@/domain/editor/workbench-interactions'
import type { ViewportCameraControls } from '@/domain/workspace/viewport-camera-controls'
import {
  DEFAULT_VIEWPORT_PROJECTION_MODE,
  applyViewportRenderableFitFrame,
  applyViewportCameraFrame,
  applyViewportCameraFrameToCamera,
  captureViewportCameraFrame,
  cloneViewportCameraFrame,
  createViewportCamera,
  getDefaultViewportCameraFrame,
  updateViewportCameraAspect,
  type ViewportCamera,
  type ViewportCameraFrame,
  type ViewportProjectionMode,
} from '@/domain/workspace/viewport-projection'
import type { ViewportRenderableRecord } from '@/domain/workspace/viewport-renderables'
import {
  selectViewportLodTierForRenderables,
  type OccTessellationTierId,
} from '@/domain/modeling/occ/tessellation'
import {
  type ViewNavigationCornerPresetId,
  type ViewNavigationFacePresetId,
  type ViewNavigationPresetId,
} from '@/domain/workspace/view-navigation'
import {
  VIEW_CUBE_CORNER_TARGETS,
  VIEW_CUBE_FACE_TARGETS,
} from '@/domain/workspace/view-cube-navigation'
import { projectSketchFeedbackAnchor } from '@/domain/workspace/sketch-feedback-projection'
import {
  mapWorldPointToWorkspaceSketch,
  type WorkspaceVec3,
} from '@/domain/workspace/sketch-plane-mapping'
import { useEditorState } from '@/hooks/use-editor-state'
import { VIEW_CUBE_SIZE_PX } from '@/components/cad/viewport-overlay-layout'
import {
  cancelCoalescedSketchGeometryDragMove,
  createRenderIdleTracker,
  createViewportBvhSceneKey,
  configureWorkspaceScaffoldWireObject,
  projectSceneTargetCentroidToViewport,
  resizeViewCubeRenderer,
  scheduleCoalescedSketchGeometryDragMove,
} from '@/components/cad/three-cad-viewport-helpers'

const VIEW_CUBE_BODY_HALF_SIZE = 0.58
const VIEW_CUBE_SURFACE_OFFSET = 0.002
const VIEW_CUBE_LABEL_OFFSET = 0.03
const VIEW_CUBE_CORNER_CUT_SIZE = 0.30
const VIEWPORT_PROJECTION_OPTIONS: Array<{ mode: ViewportProjectionMode, label: string }> = [
  { mode: 'orthographic', label: 'Orthographic' },
  { mode: 'perspective', label: 'Perspective' },
]

interface ThreeCadViewportProps {
  hoverTarget: PrimitiveRef | null
  renderables: ViewportRenderableRecord[]
  sketchDisplayRenderables: SketchSessionDisplayRenderable[]
  sketchAnnotations: SketchAnnotationDescriptor[]
  onHover: (target: PrimitiveRef) => void
  onSelect: (target: PrimitiveRef) => void
  onConnectedSketchSelect: (target: PrimitiveRef) => void
  onDeselect: () => void
  onAnnotationEdit: (target: Extract<PrimitiveRef, { kind: 'constraint' | 'dimension' }>) => void
  onClearHover: () => void
  onSketchMove: (point: readonly [number, number]) => void
  onSketchRelease: (point: readonly [number, number], target?: PrimitiveRef | null) => void
  onSketchGeometryDragStart: (target: PrimitiveRef, point: readonly [number, number]) => void
  onSketchGeometryDragMove: (point: readonly [number, number]) => void
  onSketchGeometryDragEnd: (point: readonly [number, number]) => void
  onSketchToolPatch: (patch: Record<string, unknown>) => void
  onLodTierChange: (tierId: OccTessellationTierId) => void
  selection: PrimitiveRef[]
  sketchToolPresentation: SketchToolPresentationSchema | null
  fitViewRequestId: number
}

interface ViewCubeFaceVisual {
  presetId: ViewNavigationFacePresetId
  normal: THREE.Vector3
  outlineMaterial: THREE.LineBasicMaterial
  labelMaterial: THREE.MeshBasicMaterial
  labelTexture: THREE.Texture
}

interface ViewCubeCornerVisual {
  presetId: ViewNavigationCornerPresetId
  outlineMaterial: THREE.LineBasicMaterial
  faceGeometry: THREE.BufferGeometry
  outlineGeometry: THREE.BufferGeometry
  hitGeometry: THREE.BufferGeometry
}

interface ViewCubeSceneState {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  interactiveObjects: THREE.Object3D[]
  faceVisuals: ViewCubeFaceVisual[]
  cornerVisuals: ViewCubeCornerVisual[]
  dispose: () => void
}

export function ThreeCadViewport({
  hoverTarget,
  renderables,
  sketchDisplayRenderables,
  sketchAnnotations,
  onHover,
  onSelect,
  onConnectedSketchSelect,
  onDeselect,
  onAnnotationEdit,
  onClearHover,
  onSketchMove,
  onSketchRelease,
  onSketchGeometryDragStart,
  onSketchGeometryDragMove,
  onSketchGeometryDragEnd,
  onSketchToolPatch,
  onLodTierChange,
  selection,
  sketchToolPresentation,
  fitViewRequestId,
}: ThreeCadViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const viewCubeRef = useRef<HTMLDivElement | null>(null)
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null)
  const cameraRef = useRef<ViewportCamera | null>(null)
  const controlsRef = useRef<ViewportCameraControls | null>(null)
  const controlsInitializedRef = useRef(false)
  const pendingProjectionFrameRef = useRef<ViewportCameraFrame | null>(null)
  const [canvasReadyVersion, setCanvasReadyVersion] = useState(0)
  const [controlsReadyVersion, setControlsReadyVersion] = useState(0)
  const [projectionMode, setProjectionMode] = useState<ViewportProjectionMode>(DEFAULT_VIEWPORT_PROJECTION_MODE)
  const [sketchFeedbackProjections, setSketchFeedbackProjections] = useState<SketchViewportFeedbackProjection[]>([])
  const [sketchAnnotationProjections, setSketchAnnotationProjections] = useState<SketchViewportFeedbackProjection[]>([])
  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())
  const sketchPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))
  const sketchHitPointRef = useRef(new THREE.Vector3())
  const primaryPointerDownRef = useRef<{ x: number; y: number } | null>(null)
  const sketchGeometryDragRef = useRef<{ target: PrimitiveRef } | null>(null)
  const pendingSketchGeometryDragPointRef = useRef<readonly [number, number] | null>(null)
  const pendingSketchGeometryDragFrameIdRef = useRef<number | null>(null)
  const pendingSketchGeometryDragRef = useRef<{
    target: PrimitiveRef
    startPoint: readonly [number, number]
  } | null>(null)
  const pickRootRef = useRef<THREE.Group | null>(null)
  const bindingsRef = useRef<CollectedBindings | null>(null)
  const bindingsSceneKeyRef = useRef<string | null>(null)
  const hoverRef = useRef(onHover)
  const hoverTargetRef = useRef(hoverTarget)
  const cameraTransitionControllerRef = useRef(createViewportCameraTransitionController())
  const projectionModeRef = useRef<ViewportProjectionMode>(DEFAULT_VIEWPORT_PROJECTION_MODE)
  const sketchCameraStateRef = useRef<SketchCameraTransitionState>({
    activeSessionToken: null,
    preSketchFrame: null,
  })
  const lastPickedTargetRef = useRef<PrimitiveRef | null>(null)
  const lastFitViewRequestIdRef = useRef(fitViewRequestId)
  const pendingFitViewRequestIdRef = useRef<number | null>(null)
  const selectRef = useRef(onSelect)
  const connectedSketchSelectRef = useRef(onConnectedSketchSelect)
  const deselectRef = useRef(onDeselect)
  const annotationEditRef = useRef(onAnnotationEdit)
  const clearHoverRef = useRef(onClearHover)
  const sketchMoveRef = useRef(onSketchMove)
  const sketchReleaseRef = useRef(onSketchRelease)
  const sketchGeometryDragStartRef = useRef(onSketchGeometryDragStart)
  const sketchGeometryDragMoveRef = useRef(onSketchGeometryDragMove)
  const sketchGeometryDragEndRef = useRef(onSketchGeometryDragEnd)
  const sketchToolPatchRef = useRef(onSketchToolPatch)
  const projectSketchClientPointRef = useRef<(clientX: number, clientY: number) => readonly [number, number] | null>(() => null)
  const lodTierChangeRef = useRef(onLodTierChange)
  const {
    machineState,
    state: { mode, selectionFilter, selectionCatalog, sketchSession },
  } = useEditorState()
  const sketchDisplayStylesEnabled = shouldApplySketchDisplayStyles(mode, sketchSession !== null)
  const sketchRenderingPalette = useMemo(() => resolveSketchRenderingPalette(), [])
  const selectionRef = useRef(selection)
  const renderablesRef = useRef(renderables)
  const sketchDisplayRenderablesRef = useRef(sketchDisplayRenderables)
  const requestCameraTransition = useCallback((
    targetFrame: ViewportCameraFrame,
    fromFrame?: ViewportCameraFrame,
  ) => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    const transitionStartFrame = fromFrame ?? (camera && controls
      ? captureViewportCameraFrame(camera, controls)
      : null)

    if (!transitionStartFrame) {
      return
    }

    cameraTransitionControllerRef.current.start({
      fromFrame: transitionStartFrame,
      toFrame: targetFrame,
    })

    if (projectionModeRef.current !== targetFrame.projectionMode) {
      pendingProjectionFrameRef.current = cloneViewportCameraFrame(transitionStartFrame)
      projectionModeRef.current = targetFrame.projectionMode
      setProjectionMode(targetFrame.projectionMode)
    }
  }, [])
  const handleControlsRef = useCallback((controls: unknown) => {
    const nextControls = controls as ViewportCameraControls | null

    if (controlsRef.current !== nextControls) {
      controlsRef.current = nextControls
      setControlsReadyVersion((current) => current + 1)
    }

    const camera = cameraRef.current

    if (!nextControls || !camera) {
      return
    }

    if (pendingProjectionFrameRef.current) {
      applyViewportCameraFrame(camera, nextControls, pendingProjectionFrameRef.current)
      pendingProjectionFrameRef.current = null
      return
    }

    if (controlsInitializedRef.current) {
      return
    }

    applyViewportCameraFrame(camera, nextControls, getDefaultViewportCameraFrame())
    controlsInitializedRef.current = true
  }, [])
  const handleProjectionModeChange = useCallback((nextMode: ViewportProjectionMode) => {
    if (nextMode === projectionMode) {
      return
    }

    cameraTransitionControllerRef.current.cancel()
    if (cameraRef.current && controlsRef.current) {
      pendingProjectionFrameRef.current = captureViewportCameraFrame(cameraRef.current, controlsRef.current)
    }

    projectionModeRef.current = nextMode
    setProjectionMode(nextMode)
  }, [projectionMode])
  const scheduleSketchGeometryDragMove = useCallback((point: readonly [number, number]) => {
    scheduleCoalescedSketchGeometryDragMove({
      point,
      pendingPointRef: pendingSketchGeometryDragPointRef,
      pendingFrameIdRef: pendingSketchGeometryDragFrameIdRef,
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      isDragActive: () => sketchGeometryDragRef.current !== null,
      onMove: (latestPoint) => sketchGeometryDragMoveRef.current(latestPoint),
    })
  }, [])
  const cancelSketchGeometryDragMove = useCallback(() => {
    cancelCoalescedSketchGeometryDragMove({
      pendingPointRef: pendingSketchGeometryDragPointRef,
      pendingFrameIdRef: pendingSketchGeometryDragFrameIdRef,
      cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
    })
  }, [])
  const annotationHighlightTargets = useMemo(
    () => getAnnotationHighlightTargets(sketchAnnotations, selection, hoverTarget),
    [hoverTarget, selection, sketchAnnotations],
  )
  const selectionFilterRef = useRef(selectionFilter)
  const selectionCatalogRef = useRef(selectionCatalog)
  const bvhSceneKey = useMemo(
    () => createViewportBvhSceneKey(renderables, sketchDisplayRenderables),
    [renderables, sketchDisplayRenderables],
  )
  const bvhSceneKeyRef = useRef(bvhSceneKey)

  useEffect(() => {
    hoverRef.current = onHover
    selectRef.current = onSelect
    connectedSketchSelectRef.current = onConnectedSketchSelect
    deselectRef.current = onDeselect
    annotationEditRef.current = onAnnotationEdit
    clearHoverRef.current = onClearHover
    sketchMoveRef.current = onSketchMove
    sketchReleaseRef.current = onSketchRelease
    sketchGeometryDragStartRef.current = onSketchGeometryDragStart
    sketchGeometryDragMoveRef.current = onSketchGeometryDragMove
    sketchGeometryDragEndRef.current = onSketchGeometryDragEnd
    sketchToolPatchRef.current = onSketchToolPatch
    lodTierChangeRef.current = onLodTierChange
    selectionRef.current = selection
    selectionFilterRef.current = selectionFilter
    selectionCatalogRef.current = selectionCatalog
  }, [
    onClearHover,
    onDeselect,
    onAnnotationEdit,
    onHover,
    onSelect,
    onConnectedSketchSelect,
    onSketchGeometryDragEnd,
    onSketchGeometryDragMove,
    onSketchGeometryDragStart,
    onSketchMove,
    onSketchRelease,
    onSketchToolPatch,
    onLodTierChange,
    selection,
    selectionCatalog,
    selectionFilter,
  ])

  useLayoutEffect(() => {
    renderablesRef.current = renderables
    sketchDisplayRenderablesRef.current = sketchDisplayRenderables
    bvhSceneKeyRef.current = bvhSceneKey
  }, [bvhSceneKey, renderables, sketchDisplayRenderables])

  useEffect(() => {
    projectionModeRef.current = projectionMode
  }, [projectionMode])

  useEffect(() => {
    if (lastFitViewRequestIdRef.current === fitViewRequestId) {
      return
    }

    lastFitViewRequestIdRef.current = fitViewRequestId
    pendingFitViewRequestIdRef.current = fitViewRequestId
  }, [fitViewRequestId])

  useLayoutEffect(() => {
    if (pendingFitViewRequestIdRef.current === null) {
      return
    }

    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) {
      return
    }

    cameraTransitionControllerRef.current.cancel()
    const applied = applyViewportRenderableFitFrame({
      camera,
      controls,
      renderables: renderables.map((entry) => entry.renderable),
    })

    if (applied) {
      pendingFitViewRequestIdRef.current = null
    }
  }, [bvhSceneKey, controlsReadyVersion, renderables])

  useLayoutEffect(() => {
    if (hoverTarget === null) {
      hoverTargetRef.current = null
    }
  }, [hoverTarget])

  const updateSketchFeedbackProjections = useCallback(() => {
    const camera = cameraRef.current
    const canvasElement = canvasElementRef.current
    const plane = sketchSession?.plane

    if (!camera || !canvasElement || !plane) {
      setSketchFeedbackProjections([])
      setSketchAnnotationProjections([])
      return
    }

    const rect = canvasElement.getBoundingClientRect()
    const anchors = collectSketchViewportFeedbackAnchors(sketchToolPresentation)
    const projections = anchors.flatMap((anchor) => {
      const screenPoint = projectSketchFeedbackAnchor({
        anchor: anchor.anchor,
        plane,
        viewport: {
          width: rect.width,
          height: rect.height,
        },
        projectWorldPoint: (point: WorkspaceVec3) => {
          const projected = new THREE.Vector3(point[0], point[1], point[2]).project(camera)
          return { x: projected.x, y: projected.y, z: projected.z }
        },
      })

      return screenPoint ? [{ id: anchor.id, x: screenPoint.x, y: screenPoint.y }] : []
    })

    setSketchFeedbackProjections(projections)
    setSketchAnnotationProjections(
      sketchAnnotations.flatMap((annotation) => {
        const screenPoint = projectSketchFeedbackAnchor({
          anchor: annotation.anchor,
          plane,
          viewport: {
            width: rect.width,
            height: rect.height,
          },
          projectWorldPoint: (point: WorkspaceVec3) => {
            const projected = new THREE.Vector3(point[0], point[1], point[2]).project(camera)
            return { x: projected.x, y: projected.y, z: projected.z }
          },
        })

        return screenPoint
          ? [{
              id: getAnnotationProjectionId(annotation.id),
              x: screenPoint.x,
              y: screenPoint.y,
            }]
          : []
      }),
    )
  }, [sketchAnnotations, sketchSession?.plane, sketchToolPresentation])

  useEffect(() => {
    const cubeElement = viewCubeRef.current

    if (!cubeElement) {
      return
    }

    const viewCubeScene = createViewCubeScene()
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0x000000, 0)
    cubeElement.appendChild(renderer.domElement)

    const pointer = new THREE.Vector2()
    const raycaster = new THREE.Raycaster()
    let animationFrameId = 0
    let attachedControls: ViewportCameraControls | null = null
    let hoveredPresetId: ViewNavigationPresetId | null = null

    const updatePointerFromEvent = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    }

    const getIntersectedViewCubeObject = (event: PointerEvent) => {
      updatePointerFromEvent(event)
      raycaster.setFromCamera(pointer, viewCubeScene.camera)

      return raycaster.intersectObjects(viewCubeScene.interactiveObjects, false)[0]?.object
    }

    const setHoveredPreset = (nextHoveredPresetId: ViewNavigationPresetId | null) => {
      if (hoveredPresetId === nextHoveredPresetId) {
        return
      }

      hoveredPresetId = nextHoveredPresetId
      requestRender()
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return
      }

      const presetId = resolveViewCubePresetId(getIntersectedViewCubeObject(event))

      if (!presetId) {
        return
      }

      requestViewCubeCameraTransition({
        presetId,
        camera: cameraRef.current,
        controls: controlsRef.current,
        requestTransition: requestCameraTransition,
      })
    }

    const handlePointerMove = (event: PointerEvent) => {
      const object = getIntersectedViewCubeObject(event)
      const presetId = resolveViewCubePresetId(object)

      renderer.domElement.style.cursor = presetId ? 'pointer' : ''
      setHoveredPreset(presetId)
    }

    const handlePointerLeave = () => {
      renderer.domElement.style.cursor = ''
      setHoveredPreset(null)
    }

    function renderCube() {
      const viewportCamera = cameraRef.current
      const viewportControls = controlsRef.current

      if (viewportCamera && viewportControls) {
        const orbitOffset = viewportCamera.position
          .clone()
          .sub(viewportControls.target)
          .normalize()
        viewCubeScene.camera.position.copy(orbitOffset.multiplyScalar(4))
        viewCubeScene.camera.up.copy(viewportCamera.up)
        viewCubeScene.camera.lookAt(0, 0, 0)
      }

      updateViewCubeVisibility(viewCubeScene, hoveredPresetId)
      renderer.render(viewCubeScene.scene, viewCubeScene.camera)
    }

    function requestRender() {
      if (animationFrameId !== 0) {
        return
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = 0
        renderCube()
      })
    }

    const resizeRenderer = () => {
      resizeViewCubeRenderer({ cubeElement, renderer })

      if (attachedControls) {
        requestRender()
      }
    }
    const resizeObserver = new ResizeObserver(resizeRenderer)

    const attachControls = () => {
      animationFrameId = 0
      const controls = controlsRef.current

      if (!controls) {
        animationFrameId = window.requestAnimationFrame(attachControls)
        return
      }

      attachedControls = controls
      controls.addEventListener('change', requestRender)
      requestRender()
    }

    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
    resizeObserver.observe(cubeElement)
    resizeRenderer()
    animationFrameId = window.requestAnimationFrame(attachControls)
    if (controlsReadyVersion > 0) {
      requestRender()
    }

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
      attachedControls?.removeEventListener('change', requestRender)
      viewCubeScene.dispose()
      renderer.dispose()
      cubeElement.removeChild(renderer.domElement)
    }
  }, [controlsReadyVersion, requestCameraTransition])

  useLayoutEffect(() => {
    bindingsRef.current = collectBindings(pickRootRef.current)
    bindingsSceneKeyRef.current = bvhSceneKey
    const bindings = bindingsRef.current

    if (bindings) {
      updateWorkspaceHighlight(bindings.targetToObjects, selection, hoverTarget, annotationHighlightTargets)
    }
  }, [annotationHighlightTargets, bvhSceneKey, hoverTarget, selection])

  useEffect(() => {
    const camera = cameraRef.current
    const controls = controlsRef.current

    if (!camera || !controls) {
      return
    }

    const nextTransition = resolveSketchCameraTransition({
      camera,
      controls,
      sketchSession,
      sketchDisplayRenderables,
      state: sketchCameraStateRef.current,
    })

    sketchCameraStateRef.current = nextTransition.state

    if (!nextTransition.targetFrame) {
      return
    }

    requestCameraTransition(nextTransition.targetFrame, nextTransition.fromFrame)
    window.requestAnimationFrame(updateSketchFeedbackProjections)
  }, [requestCameraTransition, sketchDisplayRenderables, sketchSession, updateSketchFeedbackProjections])

  useEffect(() => {
    const controls = controlsRef.current
    let animationFrameId = window.requestAnimationFrame(updateSketchFeedbackProjections)

    const requestProjectionUpdate = () => {
      window.cancelAnimationFrame(animationFrameId)
      animationFrameId = window.requestAnimationFrame(updateSketchFeedbackProjections)
    }

    controls?.addEventListener('change', requestProjectionUpdate)
    window.addEventListener('resize', requestProjectionUpdate)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      controls?.removeEventListener('change', requestProjectionUpdate)
      window.removeEventListener('resize', requestProjectionUpdate)
    }
  }, [canvasReadyVersion, controlsReadyVersion, updateSketchFeedbackProjections])

  useEffect(() => {
    if (bindingsRef.current) {
      updateWorkspaceHighlight(bindingsRef.current.targetToObjects, selection, hoverTarget, annotationHighlightTargets)
    }
  }, [annotationHighlightTargets, hoverTarget, selection])

  useEffect(() => {
    const viewportElement = viewportRef.current
    const canvasElement = canvasElementRef.current

    if (!viewportElement || !canvasElement) {
      return
    }

    const getCachedBindings = () => {
      if (
        bindingsRef.current
        && bindingsSceneKeyRef.current === bvhSceneKeyRef.current
        && bindingsRef.current.pickables.length > 0
      ) {
        return bindingsRef.current
      }

      const bindings = collectBindings(pickRootRef.current)
      bindingsRef.current = bindings
      bindingsSceneKeyRef.current = bvhSceneKeyRef.current
      return bindings
    }

    const pointerWithinViewCube = (clientX: number, clientY: number) => {
      const cubeElement = viewCubeRef.current

      if (!cubeElement) {
        return false
      }

      const rect = cubeElement.getBoundingClientRect()
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    }

    const getPickTargetFromClientPoint = (
      clientX: number,
      clientY: number,
      viewportRect: DOMRectReadOnly,
    ) => {
      const camera = cameraRef.current
      const bindings = getCachedBindings()

      if (!camera || !bindings) {
        return null
      }

      updatePointerFromClientPoint(pointerRef.current, viewportRect, clientX, clientY)
      raycasterRef.current.setFromCamera(pointerRef.current, camera)
      raycasterRef.current.params.Line.threshold = DEFAULT_LINE_PICK_THRESHOLD
      ;(raycasterRef.current as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = false

      const intersections = raycasterRef.current.intersectObjects(bindings.pickables, true)
      const acceptsTarget = (target: PrimitiveRef) => selectionFilterAllowsTarget(
        selectionFilterRef.current,
        selectionRef.current,
        target,
        selectionCatalogRef.current,
      )
      const candidates = [
        ...collectRaycastPickCandidates(intersections),
        ...collectProjectedSketchDisplayPointCandidates({
          clientX,
          clientY,
          camera,
          viewportRect,
          sketchDisplayRenderables: sketchDisplayRenderablesRef.current,
          acceptsTarget,
          currentHoverTarget: hoverTargetRef.current,
        }),
        ...collectProjectedVertexCandidates({
          clientX,
          clientY,
          camera,
          viewportRect,
          renderables: renderablesRef.current,
          acceptsTarget,
          currentHoverTarget: hoverTargetRef.current,
        }),
      ]

      return resolveAllCandidates(candidates, acceptsTarget)
    }

    const projectSketchPoint = (
      clientX: number,
      clientY: number,
      viewportRect: DOMRectReadOnly,
    ): readonly [number, number] | null => {
      const camera = cameraRef.current

      if (!camera || !sketchSession) {
        return null
      }

      updatePointerFromClientPoint(pointerRef.current, viewportRect, clientX, clientY)
      raycasterRef.current.setFromCamera(pointerRef.current, camera)

      const { frame } = sketchSession.plane
      sketchPlaneRef.current.set(
        new THREE.Vector3(frame.normal[0], frame.normal[1], frame.normal[2]),
        -(
          frame.normal[0] * frame.origin[0]
          + frame.normal[1] * frame.origin[1]
          + frame.normal[2] * frame.origin[2]
        ),
      )

      if (!raycasterRef.current.ray.intersectPlane(sketchPlaneRef.current, sketchHitPointRef.current)) {
        return null
      }

      return mapWorldPointToWorkspaceSketch(sketchSession.plane, [
        sketchHitPointRef.current.x,
        sketchHitPointRef.current.y,
        sketchHitPointRef.current.z,
      ])
    }

    projectSketchClientPointRef.current = (clientX, clientY) =>
      projectSketchPoint(clientX, clientY, canvasElement.getBoundingClientRect())

    const clearHover = () => {
      lastPickedTargetRef.current = null
      if (hoverTargetRef.current !== null) {
        hoverTargetRef.current = null
        clearHoverRef.current()
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      const viewportRect = canvasElement.getBoundingClientRect()

      if (sketchGeometryDragRef.current) {
        const point = projectSketchPoint(event.clientX, event.clientY, viewportRect)

        if (point) {
          scheduleSketchGeometryDragMove(point)
        }

        return
      }

      const pendingSketchGeometryDrag = pendingSketchGeometryDragRef.current
      const pointerDown = primaryPointerDownRef.current

      if (pendingSketchGeometryDrag && pointerDown) {
        const dragDistance = Math.hypot(
          event.clientX - pointerDown.x,
          event.clientY - pointerDown.y,
        )

        if (dragDistance > 6) {
          const point = projectSketchPoint(event.clientX, event.clientY, viewportRect)

          if (point) {
            event.preventDefault()
            event.stopPropagation()
            sketchGeometryDragRef.current = { target: pendingSketchGeometryDrag.target }
            pendingSketchGeometryDragRef.current = null
            sketchGeometryDragStartRef.current(pendingSketchGeometryDrag.target, pendingSketchGeometryDrag.startPoint)
            scheduleSketchGeometryDragMove(point)
          }

          return
        }
      }

      if (pointerWithinViewCube(event.clientX, event.clientY)) {
        clearHover()
        return
      }

      const target = getPickTargetFromClientPoint(event.clientX, event.clientY, viewportRect)

      if (
        target
        && selectionFilterAllowsTarget(
          selectionFilterRef.current,
          selectionRef.current,
          target.target,
          selectionCatalogRef.current,
        )
      ) {
        lastPickedTargetRef.current = target.target
        if (hoverTargetRef.current === null || !primitiveRefEquals(hoverTargetRef.current, target.target)) {
          hoverTargetRef.current = target.target
          hoverRef.current(target.target)
        }
      } else {
        clearHover()
      }

      if (!sketchSession) {
        return
      }

      const point = projectSketchPoint(event.clientX, event.clientY, viewportRect)

      if (point) {
        sketchMoveRef.current(point)
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || pointerWithinViewCube(event.clientX, event.clientY)) {
        return
      }

      primaryPointerDownRef.current = {
        x: event.clientX,
        y: event.clientY,
      }

      if (
        !sketchSession
        || !shouldViewportStartSketchGeometryDrag(sketchSession.activeTool, sketchSession.status)
      ) {
        return
      }

      const viewportRect = canvasElement.getBoundingClientRect()
      const point = projectSketchPoint(event.clientX, event.clientY, viewportRect)
      const resolvedTarget = getPickTargetFromClientPoint(event.clientX, event.clientY, viewportRect)?.target
      const dragTarget = resolvedTarget?.kind === 'sketchPoint'
        ? resolvedTarget
        : lastPickedTargetRef.current?.kind === 'sketchPoint'
          ? lastPickedTargetRef.current
          : hoverTargetRef.current?.kind === 'sketchPoint'
            ? hoverTargetRef.current
            : null

      if (point && dragTarget) {
        pendingSketchGeometryDragRef.current = {
          target: dragTarget,
          startPoint: point,
        }
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.button !== 0) {
        cancelSketchGeometryDragMove()
        primaryPointerDownRef.current = null
        sketchGeometryDragRef.current = null
        pendingSketchGeometryDragRef.current = null
        return
      }

      const activeSketchDrag = sketchGeometryDragRef.current
      if (activeSketchDrag) {
        const viewportRect = canvasElement.getBoundingClientRect()
        const point = projectSketchPoint(event.clientX, event.clientY, viewportRect)

        cancelSketchGeometryDragMove()
        if (point) {
          sketchGeometryDragEndRef.current(point)
        }

        sketchGeometryDragRef.current = null
        primaryPointerDownRef.current = null
        pendingSketchGeometryDragRef.current = null
        return
      }

      const pointerDown = primaryPointerDownRef.current
      primaryPointerDownRef.current = null

      if (!pointerDown) {
        return
      }

      const dragDistance = Math.hypot(
        event.clientX - pointerDown.x,
        event.clientY - pointerDown.y,
      )

      const pendingSketchGeometryDrag = pendingSketchGeometryDragRef.current
      pendingSketchGeometryDragRef.current = null

      if (pendingSketchGeometryDrag && dragDistance > 6) {
        const viewportRect = canvasElement.getBoundingClientRect()
        const point = projectSketchPoint(event.clientX, event.clientY, viewportRect)

        if (point) {
          sketchGeometryDragStartRef.current(pendingSketchGeometryDrag.target, pendingSketchGeometryDrag.startPoint)
          sketchGeometryDragEndRef.current(point)
        }

        return
      }

      if (dragDistance > 6 || !sketchSession) {
        return
      }

      const viewportRect = canvasElement.getBoundingClientRect()
      const point = projectSketchPoint(event.clientX, event.clientY, viewportRect)
      const resolvedTarget = getPickTargetFromClientPoint(event.clientX, event.clientY, viewportRect)

      if (point) {
        sketchReleaseRef.current(point, resolvedTarget?.target ?? null)
      }
    }

    const handlePointerLeave = () => {
      if (!sketchGeometryDragRef.current) {
        cancelSketchGeometryDragMove()
        primaryPointerDownRef.current = null
        pendingSketchGeometryDragRef.current = null
      }
      clearHover()
    }

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || pointerWithinViewCube(event.clientX, event.clientY)) {
        return
      }

      const eventTarget = event.target instanceof Node ? event.target : null
      const isCanvasClick = eventTarget === canvasElement

      if (!isCanvasClick) {
        return
      }

      const viewportRect = canvasElement.getBoundingClientRect()
      const resolvedTarget = getPickTargetFromClientPoint(event.clientX, event.clientY, viewportRect)

      if (shouldViewportClickEventRequestConnectedSketchSelection({
        activeSketchTool: sketchSession?.activeTool,
        clickDetail: event.detail,
        sketchStatus: sketchSession?.status,
        target: resolvedTarget?.target ?? null,
      })) {
        const target = resolvedTarget?.target

        if (target) {
          lastPickedTargetRef.current = target
          connectedSketchSelectRef.current(target)
        }

        return
      }

      const intent = getViewportCanvasClickIntent({
        activeSketchTool: sketchSession?.activeTool,
        hasResolvedTarget: resolvedTarget !== null,
        isBackgroundDatumTarget: resolvedTarget?.renderable
          ? isSeededDatumPlaneRenderable(resolvedTarget.renderable)
          : false,
        selectionFilterKind: selectionFilterRef.current?.kind ?? null,
      })

      if (intent === 'clearSelection') {
        deselectRef.current()
        return
      }

      if (intent === 'ignore' || !resolvedTarget) {
        return
      }

      lastPickedTargetRef.current = resolvedTarget.target
      selectRef.current(resolvedTarget.target)
    }

    const handleDoubleClick = (event: MouseEvent) => {
      if (event.button !== 0 || pointerWithinViewCube(event.clientX, event.clientY)) {
        return
      }

      const eventTarget = event.target instanceof Node ? event.target : null
      const isCanvasClick = eventTarget === canvasElement

      if (!isCanvasClick) {
        return
      }

      const viewportRect = canvasElement.getBoundingClientRect()
      const resolvedTarget = getPickTargetFromClientPoint(event.clientX, event.clientY, viewportRect)

      if (!shouldViewportDoubleClickRequestConnectedSketchSelection({
        activeSketchTool: sketchSession?.activeTool,
        sketchStatus: sketchSession?.status,
        target: resolvedTarget?.target ?? null,
      })) {
        return
      }

      const target = resolvedTarget?.target

      if (!target) {
        return
      }

      lastPickedTargetRef.current = target
      connectedSketchSelectRef.current(target)
    }

    const handleContextMenu = (event: Event) => event.preventDefault()

    canvasElement.addEventListener('pointerdown', handlePointerDown, true)
    canvasElement.addEventListener('pointermove', handlePointerMove)
    canvasElement.addEventListener('pointerleave', handlePointerLeave)
    canvasElement.addEventListener('contextmenu', handleContextMenu)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('click', handleClick, true)
    window.addEventListener('dblclick', handleDoubleClick, true)

    return () => {
      cancelSketchGeometryDragMove()
      projectSketchClientPointRef.current = () => null
      canvasElement.removeEventListener('pointerdown', handlePointerDown, true)
      canvasElement.removeEventListener('pointermove', handlePointerMove)
      canvasElement.removeEventListener('pointerleave', handlePointerLeave)
      canvasElement.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('click', handleClick, true)
      window.removeEventListener('dblclick', handleDoubleClick, true)
    }
  }, [cancelSketchGeometryDragMove, canvasReadyVersion, scheduleSketchGeometryDragMove, sketchSession])

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    window.__cadProjectToScreen = (objectId: string) => {
      const viewportElement = viewportRef.current
      const rect = viewportElement?.getBoundingClientRect()

      return projectSceneTargetCentroidToViewport({
        root: pickRootRef.current,
        camera: cameraRef.current,
        objectId,
        viewport: {
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
        },
      })
    }

    return () => {
      delete window.__cadProjectToScreen
    }
  }, [])

  const isEditorRenderIdle = machineState.kind === 'idle'

  return (
    <div ref={viewportRef} data-testid="cad-viewport" className="relative h-full w-full">
      <Canvas
        className="h-full w-full"
        frameloop="always"
        gl={{ antialias: true, alpha: true }}
        orthographic
        camera={{ near: 0.1, far: 1000, position: [14, -16, 28] }}
        onCreated={({ camera, gl, raycaster }) => {
          const viewportCamera = camera instanceof THREE.OrthographicCamera || camera instanceof THREE.PerspectiveCamera
            ? camera
            : createViewportCamera(DEFAULT_VIEWPORT_PROJECTION_MODE, 1)
          applyViewportCameraFrameToCamera(viewportCamera, getDefaultViewportCameraFrame())
          cameraRef.current = viewportCamera
          canvasElementRef.current = gl.domElement
          setCanvasReadyVersion((current) => current + 1)
          gl.setClearColor(0x000000, 0)
          raycaster.params.Line.threshold = 0.75
        }}
      >
        <ViewportProjectionCameraController
          projectionMode={projectionMode}
          cameraRef={cameraRef}
          controlsRef={controlsRef}
          pendingFrameRef={pendingProjectionFrameRef}
          controlsReadyVersion={controlsReadyVersion}
        />
        <ViewportCameraTransitionDriver
          cameraRef={cameraRef}
          controlsRef={controlsRef}
          transitionControllerRef={cameraTransitionControllerRef}
        />
        <ambientLight color={0xd7dfe9} intensity={0.56} />
        <hemisphereLight args={[0xe8edf5, 0x253447, 0.62]} position={[0, 0, 1]} />
        <directionalLight args={[0xf5eee2, 1.45]} position={[14, -16, 28]} />
        <directionalLight args={[0x91b4d8, 0.52]} position={[-12, 14, 18]} />
        <directionalLight args={[0xb6d6f5, 0.18]} position={[-14, -10, 12]} />
        <WorkspaceSceneScaffold />
        <SketchProjectionFrameWatcher
          enabled={Boolean(sketchSession)}
          onCameraChanged={updateSketchFeedbackProjections}
        />
        <BodyLodWatcher
          enabled={!sketchSession}
          renderables={renderables}
          onLodTierChange={(tierId) => lodTierChangeRef.current(tierId)}
        />
        <RenderIdleSignal
          isEditorIdle={isEditorRenderIdle}
          sceneKey={bvhSceneKey}
          viewportRef={viewportRef}
        />
        <Bvh key={bvhSceneKey} enabled>
          <group ref={pickRootRef}>
            {renderables.map((entry) => (
              <DocumentRenderableNode
                key={`${entry.origin}:${entry.renderable.id}`}
                entry={entry}
                palette={sketchRenderingPalette}
              />
            ))}
            {sketchDisplayRenderables.map((renderable) => (
              <SketchDisplayRenderableNode
                key={renderable.id}
                renderable={renderable}
                applyStyles={sketchDisplayStylesEnabled}
                palette={sketchRenderingPalette}
              />
            ))}
          </group>
        </Bvh>
        <OrbitControls
          ref={handleControlsRef}
          makeDefault
          onStart={() => cameraTransitionControllerRef.current.cancel()}
          target={[0, 0, 4]}
          enableDamping
          dampingFactor={0.08}
          screenSpacePanning
          mouseButtons={{
            LEFT: -1 as THREE.MOUSE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.ROTATE,
          }}
        />
      </Canvas>
      <div
        className="pointer-events-none absolute right-4 top-4 z-20 flex flex-col items-end gap-1"
        style={{
          width: `min(${VIEW_CUBE_SIZE_PX}px, calc(100% - 32px))`,
        }}
      >
        <div
          ref={viewCubeRef}
          data-testid="view-cube"
          className="pointer-events-auto w-full"
          style={{ aspectRatio: '1 / 1' }}
        />
        <ViewportProjectionSelector
          projectionMode={projectionMode}
          onProjectionModeChange={handleProjectionModeChange}
        />
      </div>
      <SketchViewportFeedbackLayer
        schema={sketchToolPresentation}
        projections={sketchFeedbackProjections}
        onPatch={(patch) => sketchToolPatchRef.current(patch)}
        onDragHandle={(handle, clientX, clientY) => {
          const point = projectSketchClientPointRef.current(clientX, clientY)
          if (point) {
            sketchToolPatchRef.current({
              intent: handle.dimensionId ? 'setDimensionAnnotationPlacement' : 'setConstraintAnnotationPlacement',
              handleId: handle.id,
              handleKind: handle.kind,
              dimensionId: handle.dimensionId,
              point,
            })
          }
        }}
      />
      <SketchConstraintAnnotations
        annotations={sketchAnnotations}
        projections={sketchAnnotationProjections}
        hoveredAnnotation={isAnnotationTarget(hoverTarget) ? hoverTarget : null}
        selectedAnnotation={isAnnotationTarget(selection[0] ?? null)
          ? (selection[0] as SketchConstraintRef | SketchDimensionRef)
          : null}
        onHover={(target) => {
          hoverTargetRef.current = target
          hoverRef.current(target)
        }}
        onClearHover={() => {
          if (hoverTargetRef.current !== null) {
            hoverTargetRef.current = null
          }
          clearHoverRef.current()
        }}
        onSelect={(target) => selectRef.current(target)}
        onEdit={(target) => annotationEditRef.current(target)}
        onDimensionDrag={(handle, clientX, clientY) => {
          const point = projectSketchClientPointRef.current(clientX, clientY)
          if (point) {
            sketchToolPatchRef.current(createDimensionAnnotationPlacementPatch(handle, point))
          }
        }}
      />
    </div>
  )
}

function ViewportProjectionCameraController({
  projectionMode,
  cameraRef,
  controlsRef,
  pendingFrameRef,
  controlsReadyVersion,
}: {
  projectionMode: ViewportProjectionMode
  cameraRef: RefObject<ViewportCamera | null>
  controlsRef: RefObject<ViewportCameraControls | null>
  pendingFrameRef: RefObject<ViewportCameraFrame | null>
  controlsReadyVersion: number
}) {
  const set = useThree((state) => state.set)
  const size = useThree((state) => state.size)
  const cameras = useMemo(() => ({
    orthographic: createViewportCamera('orthographic', 1),
    perspective: createViewportCamera('perspective', 1),
  }), [])
  const aspect = size.height > 0 ? size.width / size.height : 1

  useLayoutEffect(() => {
    updateViewportCameraAspect(cameras.orthographic, aspect)
    updateViewportCameraAspect(cameras.perspective, aspect)
  }, [aspect, cameras])

  useLayoutEffect(() => {
    const nextCamera = cameras[projectionMode]
    const frame = pendingFrameRef.current
      ?? (cameraRef.current && controlsRef.current
        ? captureViewportCameraFrame(cameraRef.current, controlsRef.current)
        : getDefaultViewportCameraFrame())

    updateViewportCameraAspect(nextCamera, aspect)
    applyViewportCameraFrameToCamera(nextCamera, frame)
    cameraRef.current = nextCamera
    set({ camera: nextCamera })
  }, [aspect, cameraRef, cameras, controlsRef, pendingFrameRef, projectionMode, set])

  useLayoutEffect(() => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    const frame = pendingFrameRef.current

    if (!camera || !controls || !frame) {
      return
    }

    applyViewportCameraFrame(camera, controls, frame)
    pendingFrameRef.current = null
  }, [cameraRef, controlsReadyVersion, controlsRef, pendingFrameRef])

  return null
}

function ViewportCameraTransitionDriver({
  cameraRef,
  controlsRef,
  transitionControllerRef,
}: {
  cameraRef: RefObject<ViewportCamera | null>
  controlsRef: RefObject<ViewportCameraControls | null>
  transitionControllerRef: RefObject<ReturnType<typeof createViewportCameraTransitionController>>
}) {
  useFrame((_, delta) => {
    const camera = cameraRef.current
    const controls = controlsRef.current

    if (!camera || !controls) {
      return
    }

    const transitionStep = transitionControllerRef.current.advance(delta * 1000)

    if (!transitionStep) {
      return
    }

    applyViewportCameraFrame(camera, controls, transitionStep.frame)
  })

  return null
}

function ViewportProjectionSelector({
  projectionMode,
  onProjectionModeChange,
}: {
  projectionMode: ViewportProjectionMode
  onProjectionModeChange: (mode: ViewportProjectionMode) => void
}) {
  const projectionLabel = getProjectionModeLabel(projectionMode)

  return (
    <div
      className="pointer-events-auto"
      data-testid="viewport-projection-selector"
      data-projection-mode={projectionMode}
    >
      <Menu position="bottom-end" width={160} transitionProps={{ duration: 0 }}>
        <Menu.Target>
          <Tooltip label={`Viewport projection: ${projectionLabel}`} position="left" withArrow>
            <ActionIcon
              type="button"
              aria-label={`Viewport projection: ${projectionLabel}`}
              variant="filled"
              size={28}
              style={{
                backgroundColor: 'var(--workbench-shell-overlay-strong)',
                border: '1px solid var(--workbench-shell-border)',
                color: 'var(--workbench-shell-text)',
              }}
            >
              <img src="/icons/view-cube.svg" alt="" aria-hidden="true" className="h-4 w-4" />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown
          aria-label="Viewport projection menu"
          style={{
            backgroundColor: 'var(--workbench-shell-overlay-strong)',
            borderColor: 'var(--workbench-shell-border)',
            boxShadow: 'var(--workbench-panel-shadow)',
          }}
        >
          {VIEWPORT_PROJECTION_OPTIONS.map((option) => (
            <Menu.Item
              key={option.mode}
              onClick={() => onProjectionModeChange(option.mode)}
              aria-current={projectionMode === option.mode ? 'true' : undefined}
              rightSection={projectionMode === option.mode ? 'Active' : undefined}
            >
              {option.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </div>
  )
}

function getProjectionModeLabel(mode: ViewportProjectionMode) {
  return VIEWPORT_PROJECTION_OPTIONS.find((option) => option.mode === mode)?.label ?? 'Orthographic'
}

function SketchProjectionFrameWatcher({
  enabled,
  onCameraChanged,
}: {
  enabled: boolean
  onCameraChanged: () => void
}) {
  const lastCameraTokenRef = useRef<string | null>(null)

  useFrame(({ camera }) => {
    if (!enabled) {
      lastCameraTokenRef.current = null
      return
    }

    camera.updateMatrixWorld()
    const token = [
      ...camera.matrixWorld.elements,
      ...camera.projectionMatrix.elements,
    ]
      .map((value) => value.toFixed(6))
      .join(',')

    if (lastCameraTokenRef.current === token) {
      return
    }

    lastCameraTokenRef.current = token
    onCameraChanged()
  })

  return null
}

function BodyLodWatcher({
  enabled,
  renderables,
  onLodTierChange,
}: {
  enabled: boolean
  renderables: ViewportRenderableRecord[]
  onLodTierChange: (tierId: OccTessellationTierId) => void
}) {
  const lastCameraTokenRef = useRef<string | null>(null)
  const lastTierRef = useRef<OccTessellationTierId>('startup')
  const renderablesRef = useRef(renderables)

  useEffect(() => {
    renderablesRef.current = renderables
    lastCameraTokenRef.current = null
  }, [renderables])

  useFrame(({ camera }) => {
    if (!enabled) {
      lastCameraTokenRef.current = null
      return
    }

    const token = camera.position.toArray().map((value) => value.toFixed(3)).join(',')
    if (lastCameraTokenRef.current === token) {
      return
    }

    lastCameraTokenRef.current = token
    const tierId = selectViewportLodTierForRenderables({
      cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
      renderables: renderablesRef.current.map((entry) => entry.renderable),
    })

    if (lastTierRef.current === tierId) {
      return
    }

    lastTierRef.current = tierId
    onLodTierChange(tierId)
  })

  return null
}

function RenderIdleSignal({
  isEditorIdle,
  sceneKey,
  viewportRef,
}: {
  isEditorIdle: boolean
  sceneKey: string
  viewportRef: RefObject<HTMLDivElement | null>
}) {
  const trackerRef = useRef(createRenderIdleTracker())

  useEffect(() => {
    viewportRef.current?.removeAttribute('data-render-idle')
  }, [isEditorIdle, sceneKey, viewportRef])

  useFrame((_, delta) => {
    const viewportElement = viewportRef.current

    if (!viewportElement) {
      return
    }

    const isIdle = trackerRef.current.update({
      delta,
      isEditorIdle,
      sceneKey,
    })

    if (isIdle) {
      viewportElement.setAttribute('data-render-idle', 'true')
    } else {
      viewportElement.removeAttribute('data-render-idle')
    }
  })

  return null
}

function createViewCubeScene(): ViewCubeSceneState {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
  const interactiveObjects: THREE.Object3D[] = []
  const faceVisuals: ViewCubeFaceVisual[] = []
  const cornerVisuals: ViewCubeCornerVisual[] = []

  scene.add(new THREE.AmbientLight(0xffffff, 1.1))

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9)
  directionalLight.position.set(3, 4, 6)
  scene.add(directionalLight)

  const cubeGroup = new THREE.Group()
  scene.add(cubeGroup)

  const faceFillGeometry = createViewCubeFaceGeometry(VIEW_CUBE_BODY_HALF_SIZE, VIEW_CUBE_CORNER_CUT_SIZE)
  const faceFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x314255,
  })
  const faceOutlineGeometry = createViewCubeFaceOutlineGeometry(VIEW_CUBE_BODY_HALF_SIZE, VIEW_CUBE_CORNER_CUT_SIZE)
  const faceHitGeometry = createViewCubeFaceGeometry(VIEW_CUBE_BODY_HALF_SIZE, VIEW_CUBE_CORNER_CUT_SIZE)
  const faceLabelGeometry = new THREE.PlaneGeometry(1.08, 0.54)
  const faceHitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })

  for (const faceTarget of VIEW_CUBE_FACE_TARGETS) {
    const faceNormal = new THREE.Vector3(...faceTarget.position).normalize()
    const faceSurfacePosition = faceNormal.clone().multiplyScalar(VIEW_CUBE_BODY_HALF_SIZE)
    const faceControlPosition = faceNormal.clone().multiplyScalar(VIEW_CUBE_BODY_HALF_SIZE + VIEW_CUBE_SURFACE_OFFSET)
    const fill = new THREE.Mesh(faceFillGeometry, faceFillMaterial)
    fill.position.copy(faceSurfacePosition)
    applyViewCubeRotation(fill, faceTarget.rotation)
    cubeGroup.add(fill)

    const outlineMaterial = new THREE.LineBasicMaterial({
      color: 0x8db7ff,
      transparent: true,
      opacity: 0.5,
    })
    const outline = new THREE.LineLoop(faceOutlineGeometry, outlineMaterial)
    outline.position.copy(faceControlPosition)
    applyViewCubeRotation(outline, faceTarget.rotation)
    cubeGroup.add(outline)

    const label = createViewCubeLabelMesh(faceTarget.label, faceLabelGeometry)
    label.mesh.position.copy(faceNormal.clone().multiplyScalar(VIEW_CUBE_BODY_HALF_SIZE + VIEW_CUBE_LABEL_OFFSET))
    label.mesh.quaternion.copy(
      createViewCubePlaneQuaternion(
        faceNormal,
        new THREE.Vector3(...faceTarget.labelUp),
      ),
    )
    cubeGroup.add(label.mesh)

    const hitTarget = new THREE.Mesh(faceHitGeometry, faceHitMaterial)
    hitTarget.position.copy(faceControlPosition)
    applyViewCubeRotation(hitTarget, faceTarget.rotation)
    hitTarget.userData.presetId = faceTarget.presetId
    cubeGroup.add(hitTarget)
    interactiveObjects.push(hitTarget)

    faceVisuals.push({
      presetId: faceTarget.presetId,
      normal: faceNormal,
      outlineMaterial,
      labelMaterial: label.material,
      labelTexture: label.texture,
    })
  }

  const cornerFaceMaterial = new THREE.MeshBasicMaterial({
    color: 0x314255,
  })
  const cornerHitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })

  for (const cornerTarget of VIEW_CUBE_CORNER_TARGETS) {
    const cornerDirection = new THREE.Vector3(
      Math.sign(cornerTarget.position[0]),
      Math.sign(cornerTarget.position[1]),
      Math.sign(cornerTarget.position[2]),
    )
    const cornerFaceGeometry = createViewCubeCornerFaceGeometry(cornerDirection, 0)
    const cornerFaceOutlineGeometry = createViewCubeCornerFaceOutlineGeometry(
      cornerDirection,
      VIEW_CUBE_SURFACE_OFFSET,
    )
    const cornerHitGeometry = createViewCubeCornerFaceGeometry(
      cornerDirection,
      VIEW_CUBE_SURFACE_OFFSET,
    )

    const cornerFace = new THREE.Mesh(cornerFaceGeometry, cornerFaceMaterial)
    cubeGroup.add(cornerFace)

    const cornerFaceOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0x8db7ff,
      transparent: true,
      opacity: 0.4,
    })
    const cornerOutline = new THREE.LineLoop(cornerFaceOutlineGeometry, cornerFaceOutlineMaterial)
    cubeGroup.add(cornerOutline)

    const hitTarget = new THREE.Mesh(cornerHitGeometry, cornerHitMaterial)
    hitTarget.userData.presetId = cornerTarget.presetId
    cubeGroup.add(hitTarget)
    interactiveObjects.push(hitTarget)

    cornerVisuals.push({
      presetId: cornerTarget.presetId,
      outlineMaterial: cornerFaceOutlineMaterial,
      faceGeometry: cornerFaceGeometry,
      outlineGeometry: cornerFaceOutlineGeometry,
      hitGeometry: cornerHitGeometry,
    })
  }

  return {
    scene,
    camera,
    interactiveObjects,
    faceVisuals,
    cornerVisuals,
    dispose: () => {
      faceFillGeometry.dispose()
      faceFillMaterial.dispose()
      faceOutlineGeometry.dispose()
      faceHitGeometry.dispose()
      faceLabelGeometry.dispose()
      faceHitMaterial.dispose()
      cornerFaceMaterial.dispose()
      cornerHitMaterial.dispose()
      faceVisuals.forEach((faceVisual) => {
        faceVisual.outlineMaterial.dispose()
        faceVisual.labelMaterial.dispose()
        faceVisual.labelTexture.dispose()
      })
      cornerVisuals.forEach((cornerVisual) => {
        cornerVisual.outlineMaterial.dispose()
        cornerVisual.faceGeometry.dispose()
        cornerVisual.outlineGeometry.dispose()
        cornerVisual.hitGeometry.dispose()
      })
    },
  }
}

function createViewCubeFaceGeometry(halfSize: number, cornerCutSize: number) {
  const geometry = new THREE.BufferGeometry()
  const points = createViewCubeFacePoints(halfSize, cornerCutSize)

  geometry.setFromPoints(points)
  geometry.setIndex([
    0, 1, 2,
    0, 2, 3,
    0, 3, 4,
    0, 4, 5,
    0, 5, 6,
    0, 6, 7,
  ])

  return geometry
}

function createViewCubeFaceOutlineGeometry(halfSize: number, cornerCutSize: number) {
  return new THREE.BufferGeometry().setFromPoints(createViewCubeFacePoints(halfSize, cornerCutSize))
}

function createViewCubeFacePoints(halfSize: number, cornerCutSize: number) {
  return [
    new THREE.Vector3(-halfSize + cornerCutSize, -halfSize, 0),
    new THREE.Vector3(halfSize - cornerCutSize, -halfSize, 0),
    new THREE.Vector3(halfSize, -halfSize + cornerCutSize, 0),
    new THREE.Vector3(halfSize, halfSize - cornerCutSize, 0),
    new THREE.Vector3(halfSize - cornerCutSize, halfSize, 0),
    new THREE.Vector3(-halfSize + cornerCutSize, halfSize, 0),
    new THREE.Vector3(-halfSize, halfSize - cornerCutSize, 0),
    new THREE.Vector3(-halfSize, -halfSize + cornerCutSize, 0),
  ]
}

function applyViewCubeRotation(
  object: THREE.Object3D,
  rotation: readonly [number, number, number],
) {
  object.rotation.set(rotation[0], rotation[1], rotation[2])
}

function createViewCubeCornerFaceGeometry(cornerDirection: THREE.Vector3, surfaceOffset: number) {
  const geometry = new THREE.BufferGeometry()
  const points = createViewCubeCornerFacePoints(cornerDirection, surfaceOffset)

  geometry.setFromPoints(points)
  geometry.setIndex([0, 1, 2])

  return geometry
}

function createViewCubeCornerFaceOutlineGeometry(cornerDirection: THREE.Vector3, surfaceOffset: number) {
  return new THREE.BufferGeometry().setFromPoints(
    createViewCubeCornerFacePoints(cornerDirection, surfaceOffset),
  )
}

function createViewCubeCornerFacePoints(cornerDirection: THREE.Vector3, surfaceOffset: number) {
  const x = Math.sign(cornerDirection.x)
  const y = Math.sign(cornerDirection.y)
  const z = Math.sign(cornerDirection.z)
  const normalOffset = new THREE.Vector3(x, y, z).normalize().multiplyScalar(surfaceOffset)
  const halfSize = VIEW_CUBE_BODY_HALF_SIZE
  const cutSize = VIEW_CUBE_CORNER_CUT_SIZE

  const points = [
    new THREE.Vector3(x * (halfSize - cutSize), y * halfSize, z * halfSize).add(normalOffset),
    new THREE.Vector3(x * halfSize, y * (halfSize - cutSize), z * halfSize).add(normalOffset),
    new THREE.Vector3(x * halfSize, y * halfSize, z * (halfSize - cutSize)).add(normalOffset),
  ]

  return x * y * z > 0 ? points : [points[0]!, points[2]!, points[1]!]
}

function createViewCubeLabelMesh(label: string, geometry: THREE.PlaneGeometry) {
  const width = 256
  const height = 128
  const devicePixelRatio = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = width * devicePixelRatio
  canvas.height = height * devicePixelRatio

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create view cube label context.')
  }

  const { outlineColor, textColor } = resolveViewCubeLabelColors()

  context.scale(devicePixelRatio, devicePixelRatio)
  context.clearRect(0, 0, width, height)
  context.font = '600 42px "IBM Plex Sans", "Segoe UI", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.globalAlpha = 0.92
  context.strokeStyle = outlineColor
  context.lineWidth = 10
  context.strokeText(label, width / 2, height / 2)
  context.globalAlpha = 1
  context.fillStyle = textColor
  context.fillText(label, width / 2, height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  })
  const mesh = new THREE.Mesh(geometry, material)

  return { mesh, material, texture }
}

function resolveViewCubeLabelColors() {
  const rootStyles = getComputedStyle(document.documentElement)

  return {
    outlineColor: rootStyles.getPropertyValue('--workbench-viewport-background').trim() || 'black',
    textColor: rootStyles.getPropertyValue('--workbench-shell-text').trim() || 'white',
  }
}

function createViewCubePlaneQuaternion(normal: THREE.Vector3, up: THREE.Vector3) {
  const normalizedNormal = normal.clone().normalize()
  const normalizedUp = up.clone().normalize()
  const right = normalizedUp.clone().cross(normalizedNormal).normalize()
  const labelUp = normalizedNormal.clone().cross(right).normalize()

  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, labelUp, normalizedNormal),
  )
}

function updateViewCubeVisibility(
  viewCubeScene: ViewCubeSceneState,
  hoveredPresetId: ViewNavigationPresetId | null,
) {
  const cameraDirection = viewCubeScene.camera.position.clone().normalize()

  viewCubeScene.faceVisuals.forEach((faceVisual) => {
    const facingAlignment = faceVisual.normal.dot(cameraDirection)
    const facingForward = facingAlignment > 0.12
    const isHovered = faceVisual.presetId === hoveredPresetId
    let outlineOpacity = 0.16

    if (facingForward) {
      outlineOpacity = 0.58
    }

    if (isHovered) {
      outlineOpacity = 1
    }

    faceVisual.outlineMaterial.opacity = outlineOpacity
    faceVisual.labelMaterial.opacity = facingForward ? 1 : 0
  })

  viewCubeScene.cornerVisuals.forEach((cornerVisual) => {
    cornerVisual.outlineMaterial.opacity = cornerVisual.presetId === hoveredPresetId ? 1 : 0.4
  })
}

function resolveViewCubePresetId(object: THREE.Object3D | undefined) {
  const presetId = object?.userData.presetId

  return typeof presetId === 'string' ? presetId as ViewNavigationPresetId : null
}

function WorkspaceSceneScaffold() {
  const grid = useMemo(() => {
    const helper = new THREE.GridHelper(100, 100, 0x5a7594, 0x34465a)
    helper.rotation.x = Math.PI / 2
    return configureWorkspaceScaffoldWireObject(helper)
  }, [])
  const axes = useMemo(() => {
    return configureWorkspaceScaffoldWireObject(new THREE.AxesHelper(7))
  }, [])

  useEffect(() => () => {
    grid.geometry.dispose()
    if (Array.isArray(grid.material)) {
      grid.material.forEach((material) => material.dispose())
    } else {
      grid.material.dispose()
    }
  }, [grid])

  useEffect(() => () => {
    axes.geometry.dispose()
    if (Array.isArray(axes.material)) {
      axes.material.forEach((material) => material.dispose())
    } else {
      axes.material.dispose()
    }
  }, [axes])

  return (
    <>
      <primitive object={grid} />
      <primitive object={axes} />
      <mesh>
        <sphereGeometry args={[0.24, 18, 18]} />
        <meshStandardMaterial
          color={0xffffff}
          emissive={0x2f6fd2}
          emissiveIntensity={0.72}
          roughness={0.28}
          metalness={0.14}
        />
      </mesh>
    </>
  )
}

function getDocumentRenderableMaterialOptions(
  entry: ViewportRenderableRecord,
  palette: SketchRenderingPalette,
  diagnostic = false,
) {
  const semanticClass = entry.renderable.binding.semanticClass
  const display = entry.sketchConstraintDisplay

  if (semanticClass === 'region') {
    return { color: palette.regionFill, flat: true }
  }

  if (semanticClass !== 'sketchCurve' && semanticClass !== 'sketchPoint') {
    return {}
  }

  if (diagnostic) {
    return { color: palette.overconstrained, flat: true }
  }

  if (semanticClass === 'sketchPoint' && display?.isAffectedOverconstraint) {
    return { color: palette.overconstrained, flat: true }
  }

  if (display?.state === 'constrained') {
    return { color: palette.constrained, flat: true }
  }

  return { color: palette.underconstrained, flat: true }
}

function DocumentRenderableNode({
  entry,
  palette,
}: {
  entry: ViewportRenderableRecord
  palette: SketchRenderingPalette
}) {
  switch (entry.renderable.geometry.kind) {
    case 'mesh':
      return <DocumentMeshNode entry={entry} palette={palette} />
    case 'polyline':
      return (
        <>
          <DocumentPolylineNode entry={entry} palette={palette} />
          {entry.sketchConstraintDisplay?.isAffectedOverconstraint
            ? <DocumentPolylineNode entry={entry} palette={palette} diagnostic />
            : null}
        </>
      )
    case 'marker':
      return <DocumentMarkerNode entry={entry} palette={palette} />
  }
}

function DocumentMeshNode({
  entry,
  palette,
}: {
  entry: ViewportRenderableRecord
  palette: SketchRenderingPalette
}) {
  const { renderable, origin } = entry
  const geometryData = renderable.geometry.kind === 'mesh' ? renderable.geometry : null
  const geometry = useMemo(() => {
    if (!geometryData) {
      throw new Error(`Renderable ${renderable.id} is missing mesh geometry.`)
    }

    const nextGeometry = new THREE.BufferGeometry()
    nextGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(geometryData.vertexPositions.flat(), 3),
    )
    nextGeometry.setIndex(geometryData.triangleIndices.flat())
    if (geometryData.vertexNormals) {
      nextGeometry.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(geometryData.vertexNormals.flat(), 3),
      )
    } else {
      nextGeometry.computeVertexNormals()
    }
    return nextGeometry
  }, [geometryData, renderable.id])
  const material = useMemo(() => {
    return isSeededDatumPlaneRenderable(renderable)
      ? new THREE.MeshStandardMaterial({
          color: 0x9ea8b5,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
          metalness: 0.02,
          roughness: 0.96,
          emissive: 0x000000,
          emissiveIntensity: 0,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        })
      : createRenderableMeshMaterial(renderable, origin, getDocumentRenderableMaterialOptions(entry, palette))
  }, [entry, origin, palette, renderable])
  const facePerimeterGeometry = useMemo(() => {
    if (
      !geometryData
      || (renderable.binding.semanticClass !== 'bodyFace' && renderable.binding.semanticClass !== 'planarFace')
    ) {
      return null
    }

    return createMeshBoundaryLineSegmentsGeometry(geometryData)
  }, [geometryData, renderable.binding.semanticClass])
  const facePerimeterMaterial = useMemo(() => {
    if (!facePerimeterGeometry) {
      return null
    }

    return applyWireMaterialDepthPolicy(new THREE.LineBasicMaterial({
      color: GEOMETRY_HIGHLIGHT_COLORS.hover,
      transparent: true,
      opacity: 0,
    }))
  }, [facePerimeterGeometry])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => facePerimeterGeometry?.dispose(), [facePerimeterGeometry])
  useEffect(() => () => facePerimeterMaterial?.dispose(), [facePerimeterMaterial])
  const renderOrder = isSeededDatumPlaneRenderable(renderable)
    ? 1
    : getRenderableRenderOrder(renderable, origin)

  return (
    <group>
      <mesh
        ref={(value) => {
          if (value) {
            bindRenderableObject(
              value,
              renderable.binding.pickId,
              renderable.binding.target,
              renderable.binding.semanticClass,
              origin,
              renderable,
            )
          }
        }}
        geometry={geometry}
        material={material}
        renderOrder={renderOrder}
      />
      {facePerimeterGeometry && facePerimeterMaterial ? (
        <lineSegments
          ref={(value) => {
            if (value) {
              bindFaceHoverPerimeterObject(
                value,
                renderable.binding.target,
                renderable.binding.semanticClass as 'bodyFace' | 'planarFace',
                origin,
              )
            }
          }}
          geometry={facePerimeterGeometry}
          material={facePerimeterMaterial}
          renderOrder={renderOrder + 1}
        />
      ) : null}
    </group>
  )
}

function DocumentPolylineNode({
  entry,
  palette,
  diagnostic = false,
}: {
  entry: ViewportRenderableRecord
  palette: SketchRenderingPalette
  diagnostic?: boolean
}) {
  const { renderable, origin } = entry
  const geometryData = renderable.geometry.kind === 'polyline' ? renderable.geometry : null
  const line = useMemo(() => {
    if (!geometryData) {
      throw new Error(`Renderable ${renderable.id} is missing polyline geometry.`)
    }

    const points = geometryData.points.map((point) => new THREE.Vector3(point[0], point[1], point[2]))
    const displayPoints = geometryData.isClosed && points.length > 0 ? [...points, points[0].clone()] : points
    const nextGeometry = new THREE.BufferGeometry().setFromPoints(displayPoints)
    const nextMaterial = isSeededDatumPlaneRenderable(renderable)
      ? applyWireMaterialDepthPolicy(new THREE.LineBasicMaterial({
          color: 0x7f8a98,
          transparent: true,
          opacity: 0.4,
        }))
      : createRenderableLineMaterial(renderable, origin, getDocumentRenderableMaterialOptions(entry, palette, diagnostic))
    const nextLine = new THREE.Line(nextGeometry, nextMaterial)
    nextLine.renderOrder = isSeededDatumPlaneRenderable(renderable)
      ? 2
      : getRenderableRenderOrder(renderable, origin)
    bindRenderableObject(
      nextLine,
      renderable.binding.pickId,
      renderable.binding.target,
      renderable.binding.semanticClass,
      origin,
      renderable,
    )
    return nextLine
  }, [diagnostic, entry, geometryData, origin, palette, renderable])

  useEffect(() => {
    return () => {
      line.geometry.dispose()
      if (Array.isArray(line.material)) {
        line.material.forEach((material) => material.dispose())
      } else {
        line.material.dispose()
      }
    }
  }, [line])

  return <primitive object={line} />
}

function DocumentMarkerNode({
  entry,
  palette,
}: {
  entry: ViewportRenderableRecord
  palette: SketchRenderingPalette
}) {
  const { renderable, origin } = entry
  const geometryData = renderable.geometry.kind === 'marker' ? renderable.geometry : null
  const pickProxy = useMemo(() => {
    if (!geometryData) {
      throw new Error('Renderable is missing marker geometry.')
    }

    const proxy = createMarkerPickProxy(geometryData.position, geometryData.displayRadius)
    proxy.userData.highlightExcluded = true
    return proxy
  }, [geometryData])
  const material = useMemo(
    () => createRenderableMarkerMaterial(renderable, origin, getDocumentRenderableMaterialOptions(entry, palette)),
    [entry, origin, palette, renderable],
  )

  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    const proxyMaterial = pickProxy.material

    return () => {
      if (proxyMaterial instanceof THREE.Material) {
        proxyMaterial.dispose()
      }
    }
  }, [pickProxy])
  return (
    <group
      ref={(value) => {
        if (value) {
          bindRenderableObject(
            value,
            renderable.binding.pickId,
            renderable.binding.target,
            renderable.binding.semanticClass,
            origin,
            renderable,
          )
        }
      }}
      renderOrder={getRenderableRenderOrder(renderable, origin)}
    >
      <mesh
        geometry={MARKER_SPHERE_GEOMETRY}
        material={material}
        position={geometryData?.position}
        scale={geometryData ? getVisibleMarkerRadius(geometryData.displayRadius) : 1}
        renderOrder={getRenderableRenderOrder(renderable, origin)}
      />
      <primitive object={pickProxy} />
    </group>
  )
}

interface SketchDisplayRenderableNodeProps {
  renderable: SketchSessionDisplayRenderable
  applyStyles: boolean
  palette: SketchRenderingPalette
}

function SketchDisplayRenderableNode({ renderable, applyStyles, palette }: SketchDisplayRenderableNodeProps) {
  switch (renderable.geometry.kind) {
    case 'mesh':
      return <SketchDisplayMeshNode renderable={renderable} applyStyles={applyStyles} palette={palette} />
    case 'polyline':
      return <SketchDisplayPolylineNode renderable={renderable} applyStyles={applyStyles} palette={palette} />
    case 'marker':
      return <SketchDisplayMarkerNode renderable={renderable} applyStyles={applyStyles} palette={palette} />
  }
}

function SketchDisplayMeshNode({
  renderable,
  applyStyles,
  palette,
}: {
  renderable: SketchSessionDisplayRenderable
  applyStyles: boolean
  palette: SketchRenderingPalette
}) {
  const geometryData = renderable.geometry.kind === 'mesh' ? renderable.geometry : null
  const geometry = useMemo(() => {
    if (!geometryData) {
      throw new Error('Display renderable is missing mesh geometry.')
    }

    const nextGeometry = new THREE.BufferGeometry()
    nextGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(geometryData.vertexPositions.flat(), 3),
    )
    nextGeometry.setIndex(geometryData.triangleIndices.flat())
    if (geometryData.vertexNormals) {
      nextGeometry.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(geometryData.vertexNormals.flat(), 3),
      )
    } else {
      nextGeometry.computeVertexNormals()
    }
    return nextGeometry
  }, [geometryData])
  const materialConfig = useMemo(
    () => getSketchDisplayMeshMaterialConfig(renderable, applyStyles, palette),
    [applyStyles, palette, renderable],
  )
  const material = useMemo(() => {
    const nextMaterial = new THREE.MeshBasicMaterial(materialConfig)
    nextMaterial.depthWrite = false
    return nextMaterial
  }, [materialConfig])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh
      ref={(value) => {
        if (value && renderable.target) {
          bindRenderableObject(
            value,
            null,
            renderable.target,
            renderable.semanticClass ?? (renderable.role === 'reference' ? 'sketchReference' : 'sketchCurve'),
            'document',
          )
        }
      }}
      geometry={geometry}
      material={material}
    />
  )
}

function updatePolylineGeometryBuffer(
  geometry: THREE.BufferGeometry,
  geometryData: Extract<SketchSessionDisplayRenderable['geometry'], { kind: 'polyline' }>,
) {
  const points = geometryData.isClosed && geometryData.points.length > 0
    ? [...geometryData.points, geometryData.points[0]!]
    : geometryData.points
  let position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined

  if (!position || position.count !== points.length) {
    position = new THREE.BufferAttribute(new Float32Array(points.length * 3), 3)
    geometry.setAttribute('position', position)
  }

  points.forEach((point, index) => {
    position.setXYZ(index, point[0], point[1], point[2])
  })
  position.needsUpdate = true
  geometry.computeBoundingSphere()
}

function SketchDisplayPolylineNode({
  renderable,
  applyStyles,
  palette,
}: {
  renderable: SketchSessionDisplayRenderable
  applyStyles: boolean
  palette: SketchRenderingPalette
}) {
  const geometryData = renderable.geometry.kind === 'polyline' ? renderable.geometry : null
  if (!geometryData) {
    throw new Error(`Display renderable ${renderable.id} is missing polyline geometry.`)
  }

  const geometry = useMemo(() => new THREE.BufferGeometry(), [])
  const materialConfig = getSketchDisplayPolylineMaterialConfig(renderable, applyStyles, palette)
  const {
    color,
    dashSize,
    gapSize,
    linePattern,
    lineWidth,
    opacity,
  } = materialConfig
  const material = useMemo(
    () => applyWireMaterialDepthPolicy(linePattern === 'dashed'
      ? new THREE.LineDashedMaterial({
          color,
          transparent: true,
          opacity,
          linewidth: lineWidth,
          dashSize,
          gapSize,
        })
      : new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          linewidth: lineWidth,
        })),
    [color, dashSize, gapSize, linePattern, lineWidth, opacity],
  )
  const line = useMemo(() => {
    const nextLine = new THREE.Line(geometry, material)
    nextLine.renderOrder = 3

    if (renderable.target) {
      bindRenderableObject(
        nextLine,
        null,
        renderable.target,
        renderable.role === 'reference' ? 'sketchReference' : 'sketchCurve',
        'document',
      )
    }

    return nextLine
  }, [geometry, material, renderable.role, renderable.target])

  useLayoutEffect(() => {
    updatePolylineGeometryBuffer(geometry, geometryData)

    if (linePattern === 'dashed') {
      line.computeLineDistances()
    }
  }, [geometry, geometryData, line, linePattern])

  useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])
  useEffect(() => () => material.dispose(), [material])

  return <primitive object={line} />
}

function SketchDisplayMarkerNode({
  renderable,
  applyStyles,
  palette,
}: {
  renderable: SketchSessionDisplayRenderable
  applyStyles: boolean
  palette: SketchRenderingPalette
}) {
  const geometryData = renderable.geometry.kind === 'marker' ? renderable.geometry : null
  if (!geometryData) {
    throw new Error('Display renderable is missing marker geometry.')
  }

  const materialConfig = useMemo(
    () => getSketchDisplayMarkerMaterialConfig(renderable, applyStyles, palette),
    [applyStyles, palette, renderable],
  )
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    ...materialConfig,
    depthTest: true,
    depthWrite: false,
  }), [materialConfig])
  const pickProxy = useMemo(() => {
    const proxy = createMarkerPickProxy([0, 0, 0], geometryData.displayRadius)
    proxy.userData.highlightExcluded = true
    return proxy
  }, [geometryData.displayRadius])

  useLayoutEffect(() => {
    pickProxy.position.set(geometryData.position[0], geometryData.position[1], geometryData.position[2])
  }, [geometryData.position, pickProxy])

  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    const mesh = pickProxy
    return () => {
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose()
      }
    }
  }, [pickProxy])
  return (
    <group
      ref={(value) => {
        if (value && renderable.target) {
          bindRenderableObject(
            value,
            null,
            renderable.target,
            renderable.role === 'reference' ? 'sketchReference' : 'sketchPoint',
            'document',
          )
        }
      }}
    >
      <mesh
        geometry={MARKER_SPHERE_GEOMETRY}
        material={material}
        position={geometryData.position}
        scale={getVisibleMarkerRadius(geometryData.displayRadius)}
        renderOrder={4}
      />
      <primitive object={pickProxy} />
    </group>
  )
}

function collectProjectedVertexCandidates({
  clientX,
  clientY,
  camera,
  viewportRect,
  renderables,
  acceptsTarget,
  currentHoverTarget,
}: {
  clientX: number
  clientY: number
  camera: ViewportCamera
  viewportRect: DOMRectReadOnly
  renderables: ViewportRenderableRecord[]
  acceptsTarget: (target: PrimitiveRef) => boolean
  currentHoverTarget: PrimitiveRef | null
}): PickCandidate[] {
  const pointerX = clientX - viewportRect.left
  const pointerY = clientY - viewportRect.top
  const projectedPoint = new THREE.Vector3()

  return renderables.flatMap(({ renderable }) => {
    const geometryData = renderable.geometry.kind === 'marker' ? renderable.geometry : null

    if (
      !geometryData
      || renderable.binding.semanticClass !== 'featureVertex'
      || !acceptsTarget(renderable.binding.target)
    ) {
      return []
    }

    projectedPoint.set(
      geometryData.position[0],
      geometryData.position[1],
      geometryData.position[2],
    )
    projectedPoint.project(camera)

    // Ignore vertices that project outside the view frustum; their clipped screen
    // coordinates can otherwise create false "nearest vertex" hits in blank space.
    if (!isVisibleProjectedPoint(projectedPoint)) {
      return []
    }

    const screenX = ((projectedPoint.x + 1) / 2) * viewportRect.width
    const screenY = ((-projectedPoint.y + 1) / 2) * viewportRect.height
    const distance = Math.hypot(screenX - pointerX, screenY - pointerY)
    if (!shouldIncludeProjectedPickCandidate({
      target: renderable.binding.target,
      currentHoverTarget,
      screenDistance: distance,
      enterRadius: DEFAULT_PROJECTED_POINT_PICK_ENTER_RADIUS_PX,
      exitRadius: DEFAULT_PROJECTED_POINT_PICK_EXIT_RADIUS_PX,
    })) {
      return []
    }

    return [
      createProjectedPickCandidate({
        pickId: renderable.binding.pickId,
        target: renderable.binding.target,
        renderable,
        semanticClass: renderable.binding.semanticClass,
        priority: renderable.binding.pickPriority,
        screenDistance: distance,
        depth: projectedPoint.z,
      }),
    ]
  })
}

function collectProjectedSketchDisplayPointCandidates({
  clientX,
  clientY,
  camera,
  viewportRect,
  sketchDisplayRenderables,
  acceptsTarget,
  currentHoverTarget,
}: {
  clientX: number
  clientY: number
  camera: ViewportCamera
  viewportRect: DOMRectReadOnly
  sketchDisplayRenderables: SketchSessionDisplayRenderable[]
  acceptsTarget: (target: PrimitiveRef) => boolean
  currentHoverTarget: PrimitiveRef | null
}): PickCandidate[] {
  const pointerX = clientX - viewportRect.left
  const pointerY = clientY - viewportRect.top
  const projectedPoint = new THREE.Vector3()

  return sketchDisplayRenderables.flatMap((renderable) => {
    const geometryData = renderable.geometry.kind === 'marker' ? renderable.geometry : null

    if (!geometryData || !renderable.target || renderable.target.kind !== 'sketchPoint' || !acceptsTarget(renderable.target)) {
      return []
    }

    projectedPoint.set(
      geometryData.position[0],
      geometryData.position[1],
      geometryData.position[2],
    )
    projectedPoint.project(camera)

    if (!isVisibleProjectedPoint(projectedPoint)) {
      return []
    }

    const screenX = ((projectedPoint.x + 1) / 2) * viewportRect.width
    const screenY = ((-projectedPoint.y + 1) / 2) * viewportRect.height
    const distance = Math.hypot(screenX - pointerX, screenY - pointerY)
    if (!shouldIncludeProjectedPickCandidate({
      target: renderable.target,
      currentHoverTarget,
      screenDistance: distance,
      enterRadius: DEFAULT_PROJECTED_POINT_PICK_ENTER_RADIUS_PX,
      exitRadius: DEFAULT_PROJECTED_POINT_PICK_EXIT_RADIUS_PX,
    })) {
      return []
    }

    return [
      createProjectedPickCandidate({
        pickId: null,
        target: renderable.target,
        semanticClass: renderable.role === 'reference' ? 'sketchReference' : 'sketchPoint',
        screenDistance: distance,
        depth: projectedPoint.z,
        stableKey: `sketch:${renderable.id}`,
      }),
    ]
  })
}

function isVisibleProjectedPoint(projectedPoint: THREE.Vector3) {
  return Number.isFinite(projectedPoint.x)
    && Number.isFinite(projectedPoint.y)
    && Number.isFinite(projectedPoint.z)
    && projectedPoint.z >= -1
    && projectedPoint.z <= 1
    && projectedPoint.x >= -1
    && projectedPoint.x <= 1
    && projectedPoint.y >= -1
    && projectedPoint.y <= 1
}

function updatePointerFromClientPoint(
  pointer: THREE.Vector2,
  viewportRect: DOMRectReadOnly,
  clientX: number,
  clientY: number,
) {
  pointer.x = ((clientX - viewportRect.left) / viewportRect.width) * 2 - 1
  pointer.y = -((clientY - viewportRect.top) / viewportRect.height) * 2 + 1
}

function isAnnotationTarget(
  target: PrimitiveRef | null,
): target is SketchConstraintRef | SketchDimensionRef {
  return target?.kind === 'constraint' || target?.kind === 'dimension'
}

function getAnnotationHighlightTargets(
  annotations: readonly SketchAnnotationDescriptor[],
  selection: readonly PrimitiveRef[],
  hoverTarget: PrimitiveRef | null,
) {
  const activeAnnotations = annotations.filter((annotation) => {
    if (hoverTarget && primitiveRefEquals(annotation.target, hoverTarget)) {
      return true
    }

    return selection.some((target) => primitiveRefEquals(annotation.target, target))
  })

  return activeAnnotations.flatMap((annotation) => annotation.affectedGeometryRefs)
}
