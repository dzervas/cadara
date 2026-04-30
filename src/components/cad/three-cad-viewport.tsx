import { Button } from '@mantine/core'
import { Canvas } from '@react-three/fiber'
import { Bvh, OrbitControls } from '@react-three/drei'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import {
  SketchViewportFeedbackLayer,
} from '@/components/cad/sketch-viewport-feedback'
import {
  SketchSpecialModeViewportFeedback,
} from '@/components/cad/sketch-special-mode-viewport-feedback'
import {
  SketchConstraintAnnotations,
} from '@/components/cad/sketch-constraint-annotations'
import {
  shouldApplySketchDisplayStyles,
} from '@/components/cad/sketch-display-style'
import {
  resolveSketchRenderingPalette,
} from '@/components/cad/sketch-rendering-palette'
import {
  collectSketchViewportFeedbackAnchors,
  getAnnotationProjectionId,
  type SketchViewportFeedbackProjection,
} from '@/components/cad/sketch-viewport-feedback-model'
import {
  collectSketchSpecialModeFeedbackAnchors,
  type SketchSpecialModeFeedbackProjection,
} from '@/components/cad/sketch-special-mode-feedback-model'
import { createDimensionAnnotationPlacementPatch } from '@/components/cad/three-cad-viewport-annotation-drag'
import {
  requestViewCubeCameraTransition,
  resolveSketchCameraTransition,
  type SketchCameraTransitionState,
} from '@/components/cad/three-cad-viewport-camera-transitions'
import {
  createViewCubeScene,
  resolveViewCubePresetId,
  updateViewCubeVisibility,
} from '@/components/cad/three-cad-viewport-view-cube'
import { DocumentRenderableNode } from '@/components/cad/three-cad-viewport-document-nodes'
import { SketchDisplayRenderableNode } from '@/components/cad/three-cad-viewport-sketch-nodes'
import {
  collectProjectedSketchDisplayPointCandidates,
  collectProjectedVertexCandidates,
  getAnnotationHighlightTargets,
  isAnnotationTarget,
  updatePointerFromClientPoint,
} from '@/components/cad/three-cad-viewport-pick-candidates'
import { SectionCapLayer, SectionViewOverlay } from '@/components/cad/three-cad-viewport-section'
import {
  BodyLodWatcher,
  MeasurementWitnessLayer,
  RenderIdleSignal,
  SketchProjectionFrameWatcher,
  ViewportCameraTransitionDriver,
  ViewportProjectionCameraController,
  ViewportProjectionSelector,
  WorkspaceSceneScaffold,
} from '@/components/cad/three-cad-viewport-inner-components'
import {
  type PrimitiveRef,
  primitiveRefEquals,
  selectionFilterAllowsTarget,
} from '@/core/editor/schema'
import { getSectionPlaneOrigin, type SectionViewSession, type Vec3 } from '@/core/section-view/session'
import type {
  SketchAnnotationDescriptor,
  SketchSessionDisplayRenderable,
} from '@/domain/editor/sketch-session'
import type { SketchToolPresentationSchema } from '@/core/sketch-tools/editor-schema'
import type {
  SketchSpecialModeHandleRef,
  SketchSpecialModeViewportPresentation,
} from '@/core/sketch-special-modes/schema'
import { doesSketchSpecialModeAcceptTarget } from '@/core/sketch-special-modes/presentation'
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from '@/contracts/shared/references'
import type { MeasurementWitness } from '@/domain/measure/measurement'
import {
  collectBindings,
  collectRaycastPickCandidates,
  type CollectedBindings,
  isSeededDatumPlaneRenderable,
  resolveAllCandidates,
  updateWorkspaceHighlight,
} from '@/infrastructure/viewport/render-picking'
import { createViewportCameraTransitionController } from '@/infrastructure/viewport/viewport-camera-transition'
import {
  getViewportCanvasClickIntent,
  shouldViewportClickEventRequestConnectedSketchSelection,
  shouldViewportDoubleClickRequestConnectedSketchSelection,
  shouldViewportStartSketchGeometryDrag,
} from '@/domain/editor/workbench-interactions'
import type { ViewportCameraControls } from '@/infrastructure/viewport/viewport-camera-controls'
import {
  DEFAULT_VIEWPORT_PROJECTION_MODE,
  applyViewportRenderableFitFrame,
  applyViewportCameraFrame,
  applyViewportCameraFrameToCamera,
  captureViewportCameraFrame,
  cloneViewportCameraFrame,
  createViewportCamera,
  getDefaultViewportCameraFrame,
  type ViewportCamera,
  type ViewportCameraFrame,
  type ViewportProjectionMode,
} from '@/infrastructure/viewport/viewport-projection'
import { computeSketchCameraFrame } from '@/infrastructure/viewport/sketch-camera-framing'
import type { ViewportRenderableRecord } from '@/core/workspace/viewport-renderables'
import type { OccTessellationTierId } from '@/domain/modeling/occ/tessellation'
import type { ViewNavigationPresetId } from '@/infrastructure/viewport/view-navigation'
import {
  createSectionCapRenderables,
  createSectionClippingPlane,
  getSectionRenderableBounds,
} from '@/infrastructure/section-view/rendering'
import { projectSketchFeedbackAnchor } from '@/core/workspace/sketch-feedback-projection'
import {
  mapWorldPointToWorkspaceSketch,
  type WorkspaceVec3,
} from '@/core/workspace/sketch-plane-mapping'
import { useEditorState } from '@/hooks/use-editor-state'
import { useRuntimeExtensionRegistry } from '@/hooks/use-runtime-extension-registry'
import { VIEW_CUBE_SIZE_PX } from '@/components/cad/viewport-overlay-layout'
import {
  cancelCoalescedSketchGeometryDragMove,
  createViewportBvhSceneKey,
  getViewportPickTuning,
  projectWorldPointToViewport,
  projectSceneTargetCentroidToViewport,
  resolveSectionScreenDragOffset,
  resizeViewCubeRenderer,
  scheduleCoalescedSketchGeometryDragMove,
} from '@/components/cad/three-cad-viewport-helpers'

interface ThreeCadViewportProps {
  activeSectionView: SectionViewSession | null
  hoverTarget: PrimitiveRef | null
  measurementWitnesses: readonly MeasurementWitness[]
  renderables: ViewportRenderableRecord[]
  sketchDisplayRenderables: SketchSessionDisplayRenderable[]
  sketchAnnotations: SketchAnnotationDescriptor[]
  onHover: (target: PrimitiveRef) => void
  onSelect: (target: PrimitiveRef, cameraPosition?: Vec3) => void
  onConnectedSketchSelect: (target: PrimitiveRef) => void
  onDeselect: () => void
  onAnnotationEdit: (target: Extract<PrimitiveRef, { kind: 'constraint' | 'dimension' }>) => void
  onClearHover: () => void
  onSketchMove: (point: readonly [number, number]) => void
  onSketchRelease: (point: readonly [number, number], target?: PrimitiveRef | null) => void
  onSketchGeometryDragStart: (target: PrimitiveRef, point: readonly [number, number]) => void
  onSketchGeometryDragMove: (point: readonly [number, number]) => void
  onSketchGeometryDragEnd: (point: readonly [number, number]) => void
  onSpecialModeClick: (point: readonly [number, number], target?: PrimitiveRef | null) => void
  onSpecialModeDoubleClick: (point: readonly [number, number], target?: PrimitiveRef | null) => void
  onSpecialModeDragStart: (handle: SketchSpecialModeHandleRef, point: readonly [number, number]) => void
  onSpecialModeDragMove: (handle: SketchSpecialModeHandleRef, point: readonly [number, number]) => void
  onSpecialModeDragEnd: (handle: SketchSpecialModeHandleRef, point: readonly [number, number]) => void
  onSectionOffsetChange: (offset: number) => void
  onSectionFlip: () => void
  onSectionClear: () => void
  onSketchToolPatch: (patch: Record<string, unknown>) => void
  onLodTierChange: (tierId: OccTessellationTierId) => void
  selection: PrimitiveRef[]
  sketchToolPresentation: SketchToolPresentationSchema | null
  specialModePresentation: SketchSpecialModeViewportPresentation | null
  fitViewRequestId: number
}

export function ThreeCadViewport({
  activeSectionView,
  hoverTarget,
  measurementWitnesses,
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
  onSpecialModeClick,
  onSpecialModeDoubleClick,
  onSpecialModeDragStart,
  onSpecialModeDragMove,
  onSpecialModeDragEnd,
  onSectionOffsetChange,
  onSectionFlip,
  onSectionClear,
  onSketchToolPatch,
  onLodTierChange,
  selection,
  sketchToolPresentation,
  specialModePresentation,
  fitViewRequestId,
}: ThreeCadViewportProps) {
  const { sketchSpecialModes } = useRuntimeExtensionRegistry()
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
  const [specialModeFeedbackProjections, setSpecialModeFeedbackProjections] = useState<SketchSpecialModeFeedbackProjection[]>([])
  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())
  const sketchPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))
  const sketchHitPointRef = useRef(new THREE.Vector3())
  const primaryPointerDownRef = useRef<{ x: number; y: number } | null>(null)
  const sketchGeometryDragRef = useRef<{ target: PrimitiveRef } | null>(null)
  const sectionDragRef = useRef<{
    pointerId: number
    sectionAtDragStart: SectionViewSession
    dragStartClientPoint: { x: number; y: number }
  } | null>(null)
  const sectionDragOffsetRef = useRef<number | null>(null)
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
  const specialModeClickRef = useRef(onSpecialModeClick)
  const specialModeDoubleClickRef = useRef(onSpecialModeDoubleClick)
  const specialModeDragStartRef = useRef(onSpecialModeDragStart)
  const specialModeDragMoveRef = useRef(onSpecialModeDragMove)
  const specialModeDragEndRef = useRef(onSpecialModeDragEnd)
  const sectionOffsetChangeRef = useRef(onSectionOffsetChange)
  const sectionFlipRef = useRef(onSectionFlip)
  const sectionClearRef = useRef(onSectionClear)
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
  const sketchSessionRef = useRef(sketchSession)
  const sectionViewRef = useRef(activeSectionView)
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
  const activeSectionClippingPlane = useMemo(
    () => activeSectionView ? createSectionClippingPlane(activeSectionView) : null,
    [activeSectionView],
  )
  const activeSectionCaps = useMemo(
    () => activeSectionView
      ? createSectionCapRenderables(
          renderables
            .filter((entry) => entry.renderable.geometry.kind === 'mesh')
            .map((entry) => entry.renderable),
          activeSectionView,
        )
      : [],
    [activeSectionView, renderables],
  )
  const activeSectionBounds = useMemo(
    () => getSectionRenderableBounds(renderables.map((entry) => entry.renderable)),
    [renderables],
  )
  const activeSectionBoundsRef = useRef(activeSectionBounds)

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
    specialModeClickRef.current = onSpecialModeClick
    specialModeDoubleClickRef.current = onSpecialModeDoubleClick
    specialModeDragStartRef.current = onSpecialModeDragStart
    specialModeDragMoveRef.current = onSpecialModeDragMove
    specialModeDragEndRef.current = onSpecialModeDragEnd
    sectionOffsetChangeRef.current = onSectionOffsetChange
    sectionFlipRef.current = onSectionFlip
    sectionClearRef.current = onSectionClear
    sketchToolPatchRef.current = onSketchToolPatch
    lodTierChangeRef.current = onLodTierChange
    selectionRef.current = selection
    sketchSessionRef.current = sketchSession
    sectionViewRef.current = activeSectionView
    selectionFilterRef.current = selectionFilter
    selectionCatalogRef.current = selectionCatalog
  }, [
    activeSectionView,
    onClearHover,
    onDeselect,
    onAnnotationEdit,
    onHover,
    onSelect,
    onConnectedSketchSelect,
    onSpecialModeClick,
    onSpecialModeDoubleClick,
    onSpecialModeDragEnd,
    onSpecialModeDragMove,
    onSpecialModeDragStart,
    onSketchGeometryDragEnd,
    onSketchGeometryDragMove,
    onSketchGeometryDragStart,
    onSketchMove,
    onSketchRelease,
    onSectionClear,
    onSectionFlip,
    onSectionOffsetChange,
    onSketchToolPatch,
    onLodTierChange,
    selection,
    sketchSession,
    selectionCatalog,
    selectionFilter,
  ])

  useLayoutEffect(() => {
    activeSectionBoundsRef.current = activeSectionBounds
    sectionViewRef.current = activeSectionView
    renderablesRef.current = renderables
    sketchDisplayRenderablesRef.current = sketchDisplayRenderables
    bvhSceneKeyRef.current = bvhSceneKey
  }, [activeSectionBounds, activeSectionView, bvhSceneKey, renderables, sketchDisplayRenderables])

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
      setSpecialModeFeedbackProjections([])
      return
    }

    const rect = canvasElement.getBoundingClientRect()
    const anchors = collectSketchViewportFeedbackAnchors(sketchToolPresentation)
    const specialModeAnchors = collectSketchSpecialModeFeedbackAnchors(specialModePresentation)
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
    setSpecialModeFeedbackProjections(
      specialModeAnchors.flatMap((anchor) => {
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
      }),
    )
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
  }, [sketchAnnotations, sketchSession?.plane, sketchToolPresentation, specialModePresentation])
  const updateSketchFeedbackProjectionsRef = useRef(updateSketchFeedbackProjections)

  useEffect(() => {
    updateSketchFeedbackProjectionsRef.current = updateSketchFeedbackProjections
  }, [updateSketchFeedbackProjections])

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
  }, [controlsReadyVersion, requestCameraTransition, sketchDisplayRenderables, sketchSession, updateSketchFeedbackProjections])

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

    const acceptsViewportTarget = (target: PrimitiveRef) => {
      const activeSpecialModeSession = sketchSessionRef.current

      if (activeSpecialModeSession?.activeSpecialMode) {
        return doesSketchSpecialModeAcceptTarget(
          activeSpecialModeSession,
          target,
          selectionRef.current,
          selectionCatalogRef.current,
          sketchSpecialModes,
        )
      }

      return selectionFilterAllowsTarget(
        selectionFilterRef.current,
        selectionRef.current,
        target,
        selectionCatalogRef.current,
      )
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
      const pickTuning = getViewportPickTuning(selectionFilterRef.current)
      raycasterRef.current.params.Line.threshold = pickTuning.linePickThreshold
      ;(raycasterRef.current as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = false

      const intersections = raycasterRef.current.intersectObjects(bindings.pickables, true)
      const candidates = [
        ...collectRaycastPickCandidates(intersections),
        ...collectProjectedSketchDisplayPointCandidates({
          clientX,
          clientY,
          camera,
          viewportRect,
          sketchDisplayRenderables: sketchDisplayRenderablesRef.current,
          acceptsTarget: acceptsViewportTarget,
          currentHoverTarget: hoverTargetRef.current,
        }),
        ...collectProjectedVertexCandidates({
          clientX,
          clientY,
          camera,
          viewportRect,
          renderables: renderablesRef.current,
          acceptsTarget: acceptsViewportTarget,
          currentHoverTarget: hoverTargetRef.current,
        }),
      ]

      return resolveAllCandidates(candidates, acceptsViewportTarget, pickTuning.resolutionOptions)
    }

    const getViewportCameraPosition = (): Vec3 | null => {
      const camera = cameraRef.current

      return camera
        ? [camera.position.x, camera.position.y, camera.position.z]
        : null
    }

    const getSectionHandleHitFromClientPoint = (
      clientX: number,
      clientY: number,
      viewportRect: DOMRectReadOnly,
    ) => {
      const activeSection = sectionViewRef.current
      const camera = cameraRef.current

      if (!activeSection || !camera) {
        return null
      }

      const handlePosition = getSectionPlaneOrigin(activeSection)
      const projectedHandleCenter = projectWorldPointToViewport({
        camera,
        point: handlePosition,
        viewport: {
          width: viewportRect.width,
          height: viewportRect.height,
        },
      })

      if (!projectedHandleCenter) {
        return null
      }

      const boundsSize = activeSectionBoundsRef.current?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(24, 24, 24)
      const planeSize = Math.max(boundsSize.length() * 0.6, 12)
      const handleRadius = Math.max(planeSize * 0.045, 0.6)
      const handleEdgePoint: Vec3 = [
        handlePosition[0] + activeSection.plane.frame.xAxis[0] * handleRadius,
        handlePosition[1] + activeSection.plane.frame.xAxis[1] * handleRadius,
        handlePosition[2] + activeSection.plane.frame.xAxis[2] * handleRadius,
      ]
      const projectedHandleEdge = projectWorldPointToViewport({
        camera,
        point: handleEdgePoint,
        viewport: {
          width: viewportRect.width,
          height: viewportRect.height,
        },
      })
      const pixelRadius = projectedHandleEdge
        ? Math.hypot(
            projectedHandleEdge.x - projectedHandleCenter.x,
            projectedHandleEdge.y - projectedHandleCenter.y,
          )
        : 0
      const hitRadiusPx = Math.max(pixelRadius, 14)
      const localClientX = clientX - viewportRect.left
      const localClientY = clientY - viewportRect.top

      return Math.hypot(
        projectedHandleCenter.x - localClientX,
        projectedHandleCenter.y - localClientY,
      ) <= hitRadiusPx
        ? true
        : null
    }

    const projectSketchPoint = (
      clientX: number,
      clientY: number,
      viewportRect: DOMRectReadOnly,
    ): readonly [number, number] | null => {
      const camera = cameraRef.current
      const activeSketchSession = sketchSessionRef.current
      const controls = controlsRef.current

      if (!camera || !activeSketchSession || !controls) {
        return null
      }

      const transitionTargetFrame = cameraTransitionControllerRef.current.getTargetFrame()

      if (transitionTargetFrame) {
        applyViewportCameraFrame(camera, controls, transitionTargetFrame)
        cameraTransitionControllerRef.current.cancel()
        window.requestAnimationFrame(() => updateSketchFeedbackProjectionsRef.current())
      }

      updatePointerFromClientPoint(pointerRef.current, viewportRect, clientX, clientY)
      raycasterRef.current.setFromCamera(pointerRef.current, camera)

      const { frame } = activeSketchSession.plane
      sketchPlaneRef.current.set(
        new THREE.Vector3(frame.normal[0], frame.normal[1], frame.normal[2]),
        -(
          frame.normal[0] * frame.origin[0]
          + frame.normal[1] * frame.origin[1]
          + frame.normal[2] * frame.origin[2]
        ),
      )

      if (!raycasterRef.current.ray.intersectPlane(sketchPlaneRef.current, sketchHitPointRef.current)) {
        const fallbackFrame = computeSketchCameraFrame({
          camera,
          plane: activeSketchSession.plane,
          renderables: sketchDisplayRenderablesRef.current,
        })

        applyViewportCameraFrame(camera, controls, fallbackFrame)
        cameraTransitionControllerRef.current.cancel()
        window.requestAnimationFrame(() => updateSketchFeedbackProjectionsRef.current())
        raycasterRef.current.setFromCamera(pointerRef.current, camera)

        if (!raycasterRef.current.ray.intersectPlane(sketchPlaneRef.current, sketchHitPointRef.current)) {
          return null
        }
      }

      return mapWorldPointToWorkspaceSketch(activeSketchSession.plane, [
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

      if (sectionDragRef.current !== null) {
        const offset = resolveSectionScreenDragOffset({
          camera: cameraRef.current,
          viewport: {
            width: viewportRect.width,
            height: viewportRect.height,
          },
          sectionAtDragStart: sectionDragRef.current.sectionAtDragStart,
          dragStartClientPoint: {
            x: sectionDragRef.current.dragStartClientPoint.x - viewportRect.left,
            y: sectionDragRef.current.dragStartClientPoint.y - viewportRect.top,
          },
          currentClientPoint: {
            x: event.clientX - viewportRect.left,
            y: event.clientY - viewportRect.top,
          },
        })

        if (offset !== null && offset !== sectionDragOffsetRef.current) {
          sectionDragOffsetRef.current = offset
          sectionOffsetChangeRef.current(offset)
        }

        event.preventDefault()
        event.stopPropagation()
        return
      }

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
        && acceptsViewportTarget(target.target)
      ) {
        lastPickedTargetRef.current = target.target
        if (hoverTargetRef.current === null || !primitiveRefEquals(hoverTargetRef.current, target.target)) {
          hoverTargetRef.current = target.target
          hoverRef.current(target.target)
        }
      } else {
        clearHover()
      }

      const activeSketchSession = sketchSessionRef.current

      if (!activeSketchSession) {
        return
      }

      if (activeSketchSession.activeSpecialMode) {
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

      const viewportRect = canvasElement.getBoundingClientRect()

      primaryPointerDownRef.current = {
        x: event.clientX,
        y: event.clientY,
      }

      const sectionHandleHit = getSectionHandleHitFromClientPoint(event.clientX, event.clientY, viewportRect)

      if (sectionHandleHit && sectionViewRef.current) {
        event.preventDefault()
        event.stopPropagation()
        sectionDragRef.current = {
          pointerId: event.pointerId,
          sectionAtDragStart: sectionViewRef.current,
          dragStartClientPoint: {
            x: event.clientX,
            y: event.clientY,
          },
        }
        sectionDragOffsetRef.current = sectionViewRef.current.offset
        canvasElement.setPointerCapture(event.pointerId)
        if (controlsRef.current) {
          ;(controlsRef.current as ViewportCameraControls & { enabled?: boolean }).enabled = false
        }
        return
      }

      const activeSketchSession = sketchSessionRef.current

      if (
        !activeSketchSession
        || activeSketchSession.activeSpecialMode
        || !shouldViewportStartSketchGeometryDrag(activeSketchSession.activeTool, activeSketchSession.status)
      ) {
        return
      }

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
      const activeSectionDrag = sectionDragRef.current !== null

      if (activeSectionDrag) {
        const pointerId = sectionDragRef.current?.pointerId
        sectionDragRef.current = null
        sectionDragOffsetRef.current = null
        if (pointerId !== undefined && canvasElement.hasPointerCapture(pointerId)) {
          canvasElement.releasePointerCapture(pointerId)
        }
        if (controlsRef.current) {
          ;(controlsRef.current as ViewportCameraControls & { enabled?: boolean }).enabled = true
        }
        primaryPointerDownRef.current = null
        return
      }

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

      const activeSketchSession = sketchSessionRef.current

      if (dragDistance > 6 || !activeSketchSession) {
        return
      }

      if (activeSketchSession.activeSpecialMode) {
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
      if (sectionDragRef.current === null && !sketchGeometryDragRef.current) {
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
      const sectionHandleHit = getSectionHandleHitFromClientPoint(event.clientX, event.clientY, viewportRect)

      if (sectionViewRef.current) {
        if (sectionHandleHit) {
          return
        }

        return
      }

      const resolvedTarget = getPickTargetFromClientPoint(event.clientX, event.clientY, viewportRect)

      if (sketchSessionRef.current?.activeSpecialMode) {
        const point = projectSketchPoint(event.clientX, event.clientY, viewportRect)

        if (point) {
          specialModeClickRef.current(point, resolvedTarget?.target ?? null)
        }

        return
      }

      if (shouldViewportClickEventRequestConnectedSketchSelection({
        activeSketchTool: sketchSessionRef.current?.activeTool,
        clickDetail: event.detail,
        sketchStatus: sketchSessionRef.current?.status,
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
        activeSketchTool: sketchSessionRef.current?.activeTool,
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
      selectRef.current(resolvedTarget.target, getViewportCameraPosition() ?? undefined)
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

      if (sketchSessionRef.current?.activeSpecialMode) {
        const point = projectSketchPoint(event.clientX, event.clientY, viewportRect)

        if (point) {
          specialModeDoubleClickRef.current(point, resolvedTarget?.target ?? null)
        }

        return
      }

      if (resolvedTarget?.target?.kind === 'sketchOperation') {
        const point = projectSketchPoint(event.clientX, event.clientY, viewportRect)

        if (point) {
          specialModeDoubleClickRef.current(point, resolvedTarget.target)
        }

        return
      }

      if (!shouldViewportDoubleClickRequestConnectedSketchSelection({
        activeSketchTool: sketchSessionRef.current?.activeTool,
        sketchStatus: sketchSessionRef.current?.status,
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
      if (sectionDragRef.current && canvasElement.hasPointerCapture(sectionDragRef.current.pointerId)) {
        canvasElement.releasePointerCapture(sectionDragRef.current.pointerId)
      }
      sectionDragRef.current = null
      sectionDragOffsetRef.current = null
      primaryPointerDownRef.current = null
      sketchGeometryDragRef.current = null
      pendingSketchGeometryDragRef.current = null
      canvasElement.removeEventListener('pointerdown', handlePointerDown, true)
      canvasElement.removeEventListener('pointermove', handlePointerMove)
      canvasElement.removeEventListener('pointerleave', handlePointerLeave)
      canvasElement.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('click', handleClick, true)
      window.removeEventListener('dblclick', handleDoubleClick, true)
    }
  }, [cancelSketchGeometryDragMove, canvasReadyVersion, scheduleSketchGeometryDragMove, sketchSpecialModes])

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

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    window.__cadProjectSectionHandleToScreen = () => {
      const viewportElement = viewportRef.current
      const section = sectionViewRef.current
      const camera = cameraRef.current
      const rect = viewportElement?.getBoundingClientRect()

      if (!section || !camera || !rect) {
        return null
      }

      const handle = projectWorldPointToViewport({
        camera,
        point: getSectionPlaneOrigin(section),
        viewport: {
          width: rect.width,
          height: rect.height,
        },
      })
      const normal = projectWorldPointToViewport({
        camera,
        point: [
          section.plane.frame.origin[0] + section.plane.frame.normal[0] * (section.offset + 1),
          section.plane.frame.origin[1] + section.plane.frame.normal[1] * (section.offset + 1),
          section.plane.frame.origin[2] + section.plane.frame.normal[2] * (section.offset + 1),
        ],
        viewport: {
          width: rect.width,
          height: rect.height,
        },
      })

      return handle ? { handle, normal, offset: section.offset } : null
    }

    return () => {
      delete window.__cadProjectSectionHandleToScreen
    }
  }, [activeSectionView])

  const isEditorRenderIdle = machineState.kind === 'idle'

  return (
    <div ref={viewportRef} data-testid="cad-viewport" className="relative h-full w-full">
      <Canvas
        className="h-full w-full"
        frameloop="always"
        gl={{ antialias: true, alpha: true, localClippingEnabled: true }}
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
                clippingPlane={activeSectionClippingPlane}
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
        <MeasurementWitnessLayer witnesses={measurementWitnesses} />
        {activeSectionView ? (
          <>
            <SectionCapLayer caps={activeSectionCaps} />
            <SectionViewOverlay
              bounds={activeSectionBounds}
              section={activeSectionView}
            />
          </>
        ) : null}
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
        {activeSectionView ? (
          <div className="pointer-events-auto flex items-center gap-2">
            <Button
              size="compact-xs"
              variant="filled"
              color="gray"
              onClick={() => sectionFlipRef.current()}
            >
              Flip
            </Button>
            <Button
              size="compact-xs"
              variant="default"
              onClick={() => sectionClearRef.current()}
            >
              Clear
            </Button>
          </div>
        ) : null}
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
      <SketchSpecialModeViewportFeedback
        presentation={specialModePresentation}
        projections={specialModeFeedbackProjections}
        onHandleDragStart={(handle, clientX, clientY) => {
          const point = projectSketchClientPointRef.current(clientX, clientY)
          if (point) {
            specialModeDragStartRef.current(handle, point)
          }
        }}
        onHandleDragMove={(handle, clientX, clientY) => {
          const point = projectSketchClientPointRef.current(clientX, clientY)
          if (point) {
            specialModeDragMoveRef.current(handle, point)
          }
        }}
        onHandleDragEnd={(handle, clientX, clientY) => {
          const point = projectSketchClientPointRef.current(clientX, clientY)
          if (point) {
            specialModeDragEndRef.current(handle, point)
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
