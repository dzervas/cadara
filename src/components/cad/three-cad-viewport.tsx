import { Canvas, useFrame } from '@react-three/fiber'
import { Bvh, OrbitControls } from '@react-three/drei'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import {
  SketchViewportFeedbackLayer,
} from '@/components/cad/sketch-viewport-feedback'
import {
  SketchConstraintAnnotations,
} from '@/components/cad/sketch-constraint-annotations'
import {
  collectSketchViewportFeedbackAnchors,
  getAnnotationProjectionId,
  type SketchViewportFeedbackProjection,
} from '@/components/cad/sketch-viewport-feedback-model'
import {
  type PrimitiveRef,
  primitiveRefEquals,
  selectionFilterAllowsTarget,
} from '@/domain/editor/schema'
import type { SketchAnnotationDescriptor, SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
import type { SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from '@/contracts/shared/references'
import {
  MARKER_SPHERE_GEOMETRY,
  bindRenderableObject,
  collectBindings,
  type CollectedBindings,
  createMarkerPickProxy,
  createRenderableLineMaterial,
  createRenderableMarkerMaterial,
  createRenderableMeshMaterial,
  DEFAULT_LINE_PICK_THRESHOLD,
  getRenderableRenderOrder,
  getVisibleMarkerRadius,
  isSeededDatumPlaneRenderable,
  resolvePickTarget,
  SURFACE_COLORS,
  updateWorkspaceHighlight,
} from '@/domain/workspace/render-picking'
import { applySketchCameraFrame } from '@/domain/workspace/sketch-camera-framing'
import {
  shouldViewportClickRequestSelection,
  shouldViewportStartSketchGeometryDrag,
} from '@/domain/editor/workbench-interactions'
import type { ViewportCameraControls } from '@/domain/workspace/viewport-camera-controls'
import type { ViewportRenderableRecord } from '@/domain/workspace/viewport-renderables'
import {
  type ViewNavigationPresetId,
  snapCameraToPreset,
} from '@/domain/workspace/view-navigation'
import {
  VIEW_CUBE_CORNER_TARGETS,
  VIEW_CUBE_FACE_TARGETS,
} from '@/domain/workspace/view-cube-navigation'
import { projectSketchFeedbackAnchor } from '@/domain/workspace/sketch-feedback-projection'
import type { Vec3 } from '@/domain/modeling/occ/math'
import { mapWorldPointToSketch } from '@/domain/modeling/occ/planes'
import { useEditorState } from '@/hooks/use-editor-state'
import { VIEW_CUBE_SIZE_PX } from '@/components/cad/viewport-overlay-layout'

const VIEW_CUBE_EDGE_SIZE = 1.24
const VIEW_CUBE_FACE_FILL_SIZE = 1.1
const VIEW_CUBE_FACE_FILL_OFFSET = 0.58
const VIEW_CUBE_FACE_OUTLINE_SIZE = 0.78
const VIEW_CUBE_FACE_HIT_SIZE = 0.72
const VIEW_CUBE_CORNER_FACE_SIZE = 0.26
const VIEW_CUBE_CORNER_HIT_SIZE = 0.34
const PROJECTED_VERTEX_PICK_RADIUS_PX = 48

interface ThreeCadViewportProps {
  hoverTarget: PrimitiveRef | null
  renderables: ViewportRenderableRecord[]
  sketchDisplayRenderables: SketchSessionDisplayRenderable[]
  sketchAnnotations: SketchAnnotationDescriptor[]
  onHover: (target: PrimitiveRef) => void
  onSelect: (target: PrimitiveRef) => void
  onAnnotationEdit: (target: Extract<PrimitiveRef, { kind: 'constraint' | 'dimension' }>) => void
  onClearHover: () => void
  onSketchMove: (point: readonly [number, number]) => void
  onSketchRelease: (point: readonly [number, number]) => void
  onSketchGeometryDragStart: (target: PrimitiveRef, point: readonly [number, number]) => void
  onSketchGeometryDragMove: (point: readonly [number, number]) => void
  onSketchGeometryDragEnd: (point: readonly [number, number]) => void
  onSketchToolPatch: (patch: Record<string, unknown>) => void
  selection: PrimitiveRef[]
  sketchToolPresentation: SketchToolPresentationSchema | null
}

interface ViewportCameraFrame {
  position: THREE.Vector3
  target: THREE.Vector3
  up: THREE.Vector3
}

interface ViewCubeFaceVisual {
  normal: THREE.Vector3
  outlineMaterial: THREE.LineBasicMaterial
  labelMaterial: THREE.MeshBasicMaterial
  labelTexture: THREE.Texture
}

interface ViewCubeSceneState {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  interactiveObjects: THREE.Object3D[]
  faceVisuals: ViewCubeFaceVisual[]
  dispose: () => void
}

export function ThreeCadViewport({
  hoverTarget,
  renderables,
  sketchDisplayRenderables,
  sketchAnnotations,
  onHover,
  onSelect,
  onAnnotationEdit,
  onClearHover,
  onSketchMove,
  onSketchRelease,
  onSketchGeometryDragStart,
  onSketchGeometryDragMove,
  onSketchGeometryDragEnd,
  onSketchToolPatch,
  selection,
  sketchToolPresentation,
}: ThreeCadViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const viewCubeRef = useRef<HTMLDivElement | null>(null)
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<ViewportCameraControls | null>(null)
  const controlsInitializedRef = useRef(false)
  const [canvasReadyVersion, setCanvasReadyVersion] = useState(0)
  const [controlsReadyVersion, setControlsReadyVersion] = useState(0)
  const [sketchFeedbackProjections, setSketchFeedbackProjections] = useState<SketchViewportFeedbackProjection[]>([])
  const [sketchAnnotationProjections, setSketchAnnotationProjections] = useState<SketchViewportFeedbackProjection[]>([])
  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())
  const sketchPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))
  const sketchHitPointRef = useRef(new THREE.Vector3())
  const primaryPointerDownRef = useRef<{ x: number; y: number } | null>(null)
  const sketchGeometryDragRef = useRef<{ target: PrimitiveRef } | null>(null)
  const pickRootRef = useRef<THREE.Group | null>(null)
  const bindingsRef = useRef<CollectedBindings | null>(null)
  const hoverRef = useRef(onHover)
  const hoverTargetRef = useRef(hoverTarget)
  const sketchCameraSessionTokenRef = useRef<string | null>(null)
  const partCameraFrameRef = useRef<ViewportCameraFrame | null>(null)
  const lastPickedTargetRef = useRef<PrimitiveRef | null>(null)
  const selectRef = useRef(onSelect)
  const annotationEditRef = useRef(onAnnotationEdit)
  const clearHoverRef = useRef(onClearHover)
  const sketchMoveRef = useRef(onSketchMove)
  const sketchReleaseRef = useRef(onSketchRelease)
  const sketchGeometryDragStartRef = useRef(onSketchGeometryDragStart)
  const sketchGeometryDragMoveRef = useRef(onSketchGeometryDragMove)
  const sketchGeometryDragEndRef = useRef(onSketchGeometryDragEnd)
  const sketchToolPatchRef = useRef(onSketchToolPatch)
  const {
    state: { selectionFilter, selectionCatalog, sketchSession },
  } = useEditorState()
  const selectionRef = useRef(selection)
  const handleControlsRef = useCallback((controls: unknown) => {
    const nextControls = controls as ViewportCameraControls | null

    if (controlsRef.current !== nextControls) {
      controlsRef.current = nextControls
      setControlsReadyVersion((current) => current + 1)
    }

    if (!nextControls || !cameraRef.current) {
      return
    }

    if (controlsInitializedRef.current) {
      return
    }

    cameraRef.current.position.set(14, -16, 28)
    cameraRef.current.up.set(0, 0, 1)
    nextControls.target.set(0, 0, 4)
    cameraRef.current.lookAt(nextControls.target)
    nextControls.update()
    controlsInitializedRef.current = true
  }, [])
  const annotationHighlightTargets = useMemo(
    () => getAnnotationHighlightTargets(sketchAnnotations, selection, hoverTarget),
    [hoverTarget, selection, sketchAnnotations],
  )
  const selectionFilterRef = useRef(selectionFilter)
  const selectionCatalogRef = useRef(selectionCatalog)
  const bvhSceneKey = useMemo(
    () => [
      ...renderables.map(({ origin, renderable }) => {
        return `${origin}:${renderable.id}:${renderable.binding.pickId}:${getGeometryToken(renderable.geometry)}`
      }),
      ...sketchDisplayRenderables.map((renderable) => {
        return `sketch:${renderable.id}:${renderable.linePattern}:${renderable.target ? JSON.stringify(renderable.target) : 'none'}:${getGeometryToken(renderable.geometry)}`
      }),
    ]
      .join('|'),
    [renderables, sketchDisplayRenderables],
  )

  useEffect(() => {
    hoverRef.current = onHover
    selectRef.current = onSelect
    annotationEditRef.current = onAnnotationEdit
    clearHoverRef.current = onClearHover
    sketchMoveRef.current = onSketchMove
    sketchReleaseRef.current = onSketchRelease
    sketchGeometryDragStartRef.current = onSketchGeometryDragStart
    sketchGeometryDragMoveRef.current = onSketchGeometryDragMove
    sketchGeometryDragEndRef.current = onSketchGeometryDragEnd
    sketchToolPatchRef.current = onSketchToolPatch
    hoverTargetRef.current = hoverTarget
    selectionRef.current = selection
    selectionFilterRef.current = selectionFilter
    selectionCatalogRef.current = selectionCatalog
  }, [
    hoverTarget,
    onClearHover,
    onAnnotationEdit,
    onHover,
    onSelect,
    onSketchGeometryDragEnd,
    onSketchGeometryDragMove,
    onSketchGeometryDragStart,
    onSketchMove,
    onSketchRelease,
    onSketchToolPatch,
    selection,
    selectionCatalog,
    selectionFilter,
  ])

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
        projectWorldPoint: (point: Vec3) => {
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
          projectWorldPoint: (point: Vec3) => {
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
    renderer.setSize(VIEW_CUBE_SIZE_PX, VIEW_CUBE_SIZE_PX, false)
    cubeElement.appendChild(renderer.domElement)

    const pointer = new THREE.Vector2()
    const raycaster = new THREE.Raycaster()
    let animationFrameId = 0
    let attachedControls: ViewportCameraControls | null = null

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return
      }

      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(pointer, viewCubeScene.camera)
      const [intersection] = raycaster.intersectObjects(viewCubeScene.interactiveObjects, false)
      const presetId = resolveViewCubePresetId(intersection?.object)

      if (!presetId) {
        return
      }

      snapView(presetId, cameraRef.current, controlsRef.current)
    }

    const renderCube = () => {
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

      updateViewCubeFaceVisibility(viewCubeScene.faceVisuals, viewCubeScene.camera)
      renderer.render(viewCubeScene.scene, viewCubeScene.camera)
    }

    const requestRender = () => {
      if (animationFrameId !== 0) {
        return
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = 0
        renderCube()
      })
    }

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
    animationFrameId = window.requestAnimationFrame(attachControls)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      attachedControls?.removeEventListener('change', requestRender)
      viewCubeScene.dispose()
      renderer.dispose()
      cubeElement.removeChild(renderer.domElement)
    }
  }, [])

  useLayoutEffect(() => {
    bindingsRef.current = null
    bindingsRef.current = collectBindings(pickRootRef.current)
    const bindings = bindingsRef.current

    if (bindings) {
      updateWorkspaceHighlight(bindings.targetToObjects, selection, hoverTarget, annotationHighlightTargets)
    }
  }, [annotationHighlightTargets, hoverTarget, renderables, selection, sketchDisplayRenderables])

  useEffect(() => {
    const camera = cameraRef.current
    const controls = controlsRef.current

    if (!camera || !controls) {
      return
    }

    if (!sketchSession) {
      if (partCameraFrameRef.current) {
        applyViewportCameraFrame(camera, controls, partCameraFrameRef.current)
        partCameraFrameRef.current = null
      }

      sketchCameraSessionTokenRef.current = null
      return
    }

    const nextToken = getSketchSessionCameraToken(sketchSession)

    if (sketchCameraSessionTokenRef.current === nextToken) {
      return
    }

    if (partCameraFrameRef.current === null) {
      partCameraFrameRef.current = captureViewportCameraFrame(camera, controls)
    }

    applySketchCameraFrame({
      camera,
      controls,
      plane: sketchSession.plane,
      renderables: sketchDisplayRenderables,
    })

    sketchCameraSessionTokenRef.current = nextToken
    window.requestAnimationFrame(updateSketchFeedbackProjections)
  }, [sketchDisplayRenderables, sketchSession, updateSketchFeedbackProjections])

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

    const pointerWithinViewCube = (clientX: number, clientY: number) => {
      const cubeElement = viewCubeRef.current

      if (!cubeElement) {
        return false
      }

      const rect = cubeElement.getBoundingClientRect()
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    }

    const getPickTargetFromClientPoint = (clientX: number, clientY: number) => {
      const camera = cameraRef.current
      const bindings = collectBindings(pickRootRef.current)

      if (!camera || !bindings) {
        return null
      }

      bindingsRef.current = bindings

      updatePointerFromClientPoint(pointerRef.current, canvasElement, clientX, clientY)
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
      const workspaceTarget = resolvePickTarget(
        intersections,
        acceptsTarget,
      )

      const sketchPointTarget = resolveProjectedSketchDisplayPointTarget({
        clientX,
        clientY,
        camera,
        viewportElement: canvasElement,
        sketchDisplayRenderables,
        acceptsTarget,
      })

      if (sketchPointTarget) {
        return sketchPointTarget
      }

      if (workspaceTarget) {
        return workspaceTarget
      }

      return resolveProjectedVertexTarget({
        clientX,
        clientY,
        camera,
        viewportElement: canvasElement,
        renderables,
        acceptsTarget,
      })
    }

    const projectSketchPoint = (clientX: number, clientY: number): readonly [number, number] | null => {
      const camera = cameraRef.current

      if (!camera || !sketchSession) {
        return null
      }

      updatePointerFromClientPoint(pointerRef.current, canvasElement, clientX, clientY)
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

      return mapWorldPointToSketch(sketchSession.plane, [
        sketchHitPointRef.current.x,
        sketchHitPointRef.current.y,
        sketchHitPointRef.current.z,
      ])
    }

    const clearHover = () => {
      lastPickedTargetRef.current = null
      if (hoverTargetRef.current !== null) {
        hoverTargetRef.current = null
        clearHoverRef.current()
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (sketchGeometryDragRef.current) {
        const point = projectSketchPoint(event.clientX, event.clientY)

        if (point) {
          sketchGeometryDragMoveRef.current(point)
        }

        return
      }

      if (pointerWithinViewCube(event.clientX, event.clientY)) {
        clearHover()
        return
      }

      const target = getPickTargetFromClientPoint(event.clientX, event.clientY)

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

      const point = projectSketchPoint(event.clientX, event.clientY)

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

      const point = projectSketchPoint(event.clientX, event.clientY)
      const resolvedTarget = getPickTargetFromClientPoint(event.clientX, event.clientY)?.target
      const dragTarget = resolvedTarget?.kind === 'sketchPoint'
        ? resolvedTarget
        : lastPickedTargetRef.current?.kind === 'sketchPoint'
          ? lastPickedTargetRef.current
          : hoverTargetRef.current?.kind === 'sketchPoint'
            ? hoverTargetRef.current
            : null

      if (point && dragTarget) {
        event.preventDefault()
        event.stopPropagation()
        sketchGeometryDragRef.current = { target: dragTarget }
        sketchGeometryDragStartRef.current(dragTarget, point)
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.button !== 0) {
        primaryPointerDownRef.current = null
        sketchGeometryDragRef.current = null
        return
      }

      const activeSketchDrag = sketchGeometryDragRef.current
      if (activeSketchDrag) {
        const point = projectSketchPoint(event.clientX, event.clientY)

        if (point) {
          sketchGeometryDragEndRef.current(point)
        }

        sketchGeometryDragRef.current = null
        primaryPointerDownRef.current = null
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

      if (dragDistance > 6 || !sketchSession) {
        return
      }

      const point = projectSketchPoint(event.clientX, event.clientY)

      if (point) {
        sketchReleaseRef.current(point)
      }
    }

    const handlePointerLeave = () => {
      if (!sketchGeometryDragRef.current) {
        primaryPointerDownRef.current = null
      }
      clearHover()
    }

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || pointerWithinViewCube(event.clientX, event.clientY)) {
        return
      }

      const eventTarget = event.target instanceof Node ? event.target : null
      const isCanvasClick = eventTarget === canvasElement

      if (!isCanvasClick || !shouldViewportClickRequestSelection(sketchSession?.activeTool)) {
        return
      }

      const resolvedTarget = getPickTargetFromClientPoint(event.clientX, event.clientY)
        ?? (lastPickedTargetRef.current
          ? { target: lastPickedTargetRef.current }
          : hoverTargetRef.current
            ? { target: hoverTargetRef.current }
            : null)

      if (!resolvedTarget) {
        return
      }

      lastPickedTargetRef.current = resolvedTarget.target
      selectRef.current(resolvedTarget.target)
    }

    const handleContextMenu = (event: Event) => event.preventDefault()

    canvasElement.addEventListener('pointerdown', handlePointerDown, true)
    canvasElement.addEventListener('pointermove', handlePointerMove)
    canvasElement.addEventListener('pointerleave', handlePointerLeave)
    canvasElement.addEventListener('contextmenu', handleContextMenu)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('click', handleClick, true)

    return () => {
      canvasElement.removeEventListener('pointerdown', handlePointerDown, true)
      canvasElement.removeEventListener('pointermove', handlePointerMove)
      canvasElement.removeEventListener('pointerleave', handlePointerLeave)
      canvasElement.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('click', handleClick, true)
    }
  }, [canvasReadyVersion, renderables, selection, sketchDisplayRenderables, sketchSession])

  return (
    <div ref={viewportRef} data-testid="cad-viewport" className="relative h-full w-full">
      <Canvas
        className="h-full w-full"
        frameloop="always"
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: 45, near: 0.1, far: 1000, position: [14, -16, 28] }}
        onCreated={({ camera, gl, raycaster }) => {
          const perspectiveCamera = camera instanceof THREE.PerspectiveCamera
            ? camera
            : new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
          perspectiveCamera.up.set(0, 0, 1)
          perspectiveCamera.lookAt(0, 0, 4)
          cameraRef.current = perspectiveCamera
          canvasElementRef.current = gl.domElement
          setCanvasReadyVersion((current) => current + 1)
          gl.setClearColor(0x000000, 0)
          raycaster.params.Line.threshold = 0.75
        }}
      >
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
        <Bvh key={bvhSceneKey} enabled>
          <group ref={pickRootRef}>
            {renderables.map((entry) => (
              <DocumentRenderableNode key={`${entry.origin}:${entry.renderable.id}`} entry={entry} />
            ))}
            {sketchDisplayRenderables.map((renderable) => (
              <SketchDisplayRenderableNode key={renderable.id} renderable={renderable} />
            ))}
          </group>
        </Bvh>
        <OrbitControls
          ref={handleControlsRef}
          makeDefault
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
        ref={viewCubeRef}
        data-testid="view-cube"
        className="pointer-events-auto absolute right-4 top-4 z-20"
        style={{ width: VIEW_CUBE_SIZE_PX, height: VIEW_CUBE_SIZE_PX }}
      />
      <SketchViewportFeedbackLayer
        schema={sketchToolPresentation}
        projections={sketchFeedbackProjections}
        onPatch={(patch) => sketchToolPatchRef.current(patch)}
      />
      <SketchConstraintAnnotations
        annotations={sketchAnnotations}
        projections={sketchAnnotationProjections}
        hoveredAnnotation={isAnnotationTarget(hoverTarget) ? hoverTarget : null}
        selectedAnnotation={isAnnotationTarget(selection[0] ?? null)
          ? (selection[0] as SketchConstraintRef | SketchDimensionRef)
          : null}
        onHover={(target) => hoverRef.current(target)}
        onClearHover={() => clearHoverRef.current()}
        onSelect={(target) => selectRef.current(target)}
        onEdit={(target) => annotationEditRef.current(target)}
      />
    </div>
  )
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

function createViewCubeScene(): ViewCubeSceneState {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
  const interactiveObjects: THREE.Object3D[] = []
  const faceVisuals: ViewCubeFaceVisual[] = []

  scene.add(new THREE.AmbientLight(0xffffff, 1.1))

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9)
  directionalLight.position.set(3, 4, 6)
  scene.add(directionalLight)

  const cubeGroup = new THREE.Group()
  scene.add(cubeGroup)

  const edgeGeometry = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(VIEW_CUBE_EDGE_SIZE, VIEW_CUBE_EDGE_SIZE, VIEW_CUBE_EDGE_SIZE),
  )
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0xd9e8ff,
  })
  cubeGroup.add(new THREE.LineSegments(edgeGeometry, edgeMaterial))

  const faceFillGeometry = new THREE.PlaneGeometry(VIEW_CUBE_FACE_FILL_SIZE, VIEW_CUBE_FACE_FILL_SIZE)
  const faceFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x314255,
  })
  const faceOutlineGeometry = createViewCubeFaceOutlineGeometry(VIEW_CUBE_FACE_OUTLINE_SIZE)
  const faceHitGeometry = new THREE.PlaneGeometry(VIEW_CUBE_FACE_HIT_SIZE, VIEW_CUBE_FACE_HIT_SIZE)
  const faceLabelGeometry = new THREE.PlaneGeometry(1.08, 0.54)
  const faceHitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })

  for (const faceTarget of VIEW_CUBE_FACE_TARGETS) {
    const faceNormal = new THREE.Vector3(...faceTarget.position).normalize()
    const fill = new THREE.Mesh(faceFillGeometry, faceFillMaterial)
    fill.position.copy(faceNormal.clone().multiplyScalar(VIEW_CUBE_FACE_FILL_OFFSET))
    applyViewCubeRotation(fill, faceTarget.rotation)
    cubeGroup.add(fill)

    const outlineMaterial = new THREE.LineBasicMaterial({
      color: 0x8db7ff,
      transparent: true,
      opacity: 0.5,
    })
    const outline = new THREE.LineLoop(faceOutlineGeometry, outlineMaterial)
    outline.position.fromArray(faceTarget.position)
    applyViewCubeRotation(outline, faceTarget.rotation)
    cubeGroup.add(outline)

    const label = createViewCubeLabelMesh(faceTarget.label, faceLabelGeometry)
    label.mesh.position.fromArray(faceTarget.position)
    label.mesh.position.add(faceNormal.clone().multiplyScalar(0.02))
    label.mesh.quaternion.copy(
      createViewCubePlaneQuaternion(
        faceNormal,
        new THREE.Vector3(...faceTarget.labelUp),
      ),
    )
    cubeGroup.add(label.mesh)

    const hitTarget = new THREE.Mesh(faceHitGeometry, faceHitMaterial)
    hitTarget.position.fromArray(faceTarget.position)
    applyViewCubeRotation(hitTarget, faceTarget.rotation)
    hitTarget.userData.presetId = faceTarget.presetId
    cubeGroup.add(hitTarget)
    interactiveObjects.push(hitTarget)

    faceVisuals.push({
      normal: faceNormal,
      outlineMaterial,
      labelMaterial: label.material,
      labelTexture: label.texture,
    })
  }

  const cornerFaceGeometry = createViewCubeCornerFaceGeometry(VIEW_CUBE_CORNER_FACE_SIZE)
  const cornerFaceOutlineGeometry = createViewCubeCornerFaceOutlineGeometry(VIEW_CUBE_CORNER_FACE_SIZE)
  const cornerHitGeometry = createViewCubeCornerFaceGeometry(VIEW_CUBE_CORNER_HIT_SIZE)
  const cornerFaceMaterial = new THREE.MeshBasicMaterial({
    color: 0x8db7ff,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
  })
  const cornerFaceOutlineMaterial = new THREE.LineBasicMaterial({
    color: 0xbfd7ff,
    transparent: true,
    opacity: 0.74,
  })
  const cornerHitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })

  for (const cornerTarget of VIEW_CUBE_CORNER_TARGETS) {
    const cornerNormal = new THREE.Vector3(...cornerTarget.position).normalize()
    const cornerQuaternion = createViewCubePlaneQuaternion(
      cornerNormal,
      resolveViewCubePlaneUp(cornerNormal),
    )

    const cornerFace = new THREE.Mesh(cornerFaceGeometry, cornerFaceMaterial)
    cornerFace.position.fromArray(cornerTarget.position)
    cornerFace.quaternion.copy(cornerQuaternion)
    cubeGroup.add(cornerFace)

    const cornerOutline = new THREE.LineLoop(cornerFaceOutlineGeometry, cornerFaceOutlineMaterial)
    cornerOutline.position.fromArray(cornerTarget.position)
    cornerOutline.quaternion.copy(cornerQuaternion)
    cubeGroup.add(cornerOutline)

    const hitTarget = new THREE.Mesh(cornerHitGeometry, cornerHitMaterial)
    hitTarget.position.fromArray(cornerTarget.position)
    hitTarget.quaternion.copy(cornerQuaternion)
    hitTarget.userData.presetId = cornerTarget.presetId
    cubeGroup.add(hitTarget)
    interactiveObjects.push(hitTarget)
  }

  return {
    scene,
    camera,
    interactiveObjects,
    faceVisuals,
    dispose: () => {
      edgeGeometry.dispose()
      edgeMaterial.dispose()
      faceFillGeometry.dispose()
      faceFillMaterial.dispose()
      faceOutlineGeometry.dispose()
      faceHitGeometry.dispose()
      faceLabelGeometry.dispose()
      faceHitMaterial.dispose()
      cornerFaceGeometry.dispose()
      cornerFaceOutlineGeometry.dispose()
      cornerFaceMaterial.dispose()
      cornerFaceOutlineMaterial.dispose()
      cornerHitGeometry.dispose()
      cornerHitMaterial.dispose()
      faceVisuals.forEach((faceVisual) => {
        faceVisual.outlineMaterial.dispose()
        faceVisual.labelMaterial.dispose()
        faceVisual.labelTexture.dispose()
      })
    },
  }
}

function createViewCubeFaceOutlineGeometry(size: number) {
  const halfSize = size / 2

  return new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-halfSize, -halfSize, 0),
    new THREE.Vector3(halfSize, -halfSize, 0),
    new THREE.Vector3(halfSize, halfSize, 0),
    new THREE.Vector3(-halfSize, halfSize, 0),
  ])
}

function applyViewCubeRotation(
  object: THREE.Object3D,
  rotation: readonly [number, number, number],
) {
  object.rotation.set(rotation[0], rotation[1], rotation[2])
}

function createViewCubeCornerFaceGeometry(size: number) {
  const height = size * Math.sqrt(3) * 0.5
  const halfBase = size / 2
  const geometry = new THREE.BufferGeometry()

  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([
      0, height * (2 / 3), 0,
      -halfBase, -height / 3, 0,
      halfBase, -height / 3, 0,
    ], 3),
  )
  geometry.setIndex([0, 1, 2])

  return geometry
}

function createViewCubeCornerFaceOutlineGeometry(size: number) {
  const height = size * Math.sqrt(3) * 0.5
  const halfBase = size / 2

  return new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, height * (2 / 3), 0),
    new THREE.Vector3(-halfBase, -height / 3, 0),
    new THREE.Vector3(halfBase, -height / 3, 0),
  ])
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

function resolveViewCubePlaneUp(normal: THREE.Vector3) {
  const normalizedNormal = normal.clone().normalize()
  const preferredUp = Math.abs(normalizedNormal.z) < 0.92
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0)

  return preferredUp
    .sub(normalizedNormal.clone().multiplyScalar(preferredUp.dot(normalizedNormal)))
    .normalize()
}

function updateViewCubeFaceVisibility(
  faceVisuals: ViewCubeFaceVisual[],
  camera: THREE.PerspectiveCamera,
) {
  const cameraDirection = camera.position.clone().normalize()

  faceVisuals.forEach((faceVisual) => {
    const facingAlignment = faceVisual.normal.dot(cameraDirection)
    const facingForward = facingAlignment > 0.12

    faceVisual.outlineMaterial.opacity = facingForward ? 0.58 : 0.16
    faceVisual.labelMaterial.opacity = facingForward ? 1 : 0
  })
}

function resolveViewCubePresetId(object: THREE.Object3D | undefined) {
  const presetId = object?.userData.presetId

  return typeof presetId === 'string' ? presetId as ViewNavigationPresetId : null
}

function captureViewportCameraFrame(
  camera: THREE.PerspectiveCamera,
  controls: ViewportCameraControls,
): ViewportCameraFrame {
  return {
    position: camera.position.clone(),
    target: controls.target.clone(),
    up: camera.up.clone(),
  }
}

function applyViewportCameraFrame(
  camera: THREE.PerspectiveCamera,
  controls: ViewportCameraControls,
  frame: ViewportCameraFrame,
) {
  camera.up.copy(frame.up)
  camera.position.copy(frame.position)
  controls.target.copy(frame.target)
  camera.lookAt(frame.target)
  controls.update()
}

function WorkspaceSceneScaffold() {
  const grid = useMemo(() => {
    const helper = new THREE.GridHelper(100, 100, 0x5a7594, 0x34465a)
    helper.rotation.x = Math.PI / 2
    return helper
  }, [])
  const axes = useMemo(() => new THREE.AxesHelper(7), [])

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

function DocumentRenderableNode({ entry }: { entry: ViewportRenderableRecord }) {
  switch (entry.renderable.geometry.kind) {
    case 'mesh':
      return <DocumentMeshNode entry={entry} />
    case 'polyline':
      return <DocumentPolylineNode entry={entry} />
    case 'marker':
      return <DocumentMarkerNode entry={entry} />
  }
}

function DocumentMeshNode({ entry }: { entry: ViewportRenderableRecord }) {
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
      : createRenderableMeshMaterial(renderable, origin)
  }, [origin, renderable])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  return (
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
      renderOrder={
        isSeededDatumPlaneRenderable(renderable)
          ? 1
          : getRenderableRenderOrder(renderable, origin)
      }
    />
  )
}

function DocumentPolylineNode({ entry }: { entry: ViewportRenderableRecord }) {
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
      ? new THREE.LineBasicMaterial({
          color: 0x7f8a98,
          transparent: true,
          opacity: 0.4,
          depthTest: true,
          depthWrite: false,
        })
      : createRenderableLineMaterial(renderable, origin)
    nextMaterial.depthTest = true
    nextMaterial.depthWrite = false
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
  }, [geometryData, origin, renderable])

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

function DocumentMarkerNode({ entry }: { entry: ViewportRenderableRecord }) {
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
  const material = useMemo(() => createRenderableMarkerMaterial(renderable, origin), [origin, renderable])

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

function SketchDisplayRenderableNode({ renderable }: { renderable: SketchSessionDisplayRenderable }) {
  switch (renderable.geometry.kind) {
    case 'mesh':
      return <SketchDisplayMeshNode renderable={renderable} />
    case 'polyline':
      return <SketchDisplayPolylineNode renderable={renderable} />
    case 'marker':
      return <SketchDisplayMarkerNode renderable={renderable} />
  }
}

function SketchDisplayMeshNode({ renderable }: { renderable: SketchSessionDisplayRenderable }) {
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
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: renderable.role === 'reference' ? SURFACE_COLORS.sketchReference : SURFACE_COLORS.sketchCurve,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    metalness: 0.08,
    roughness: 0.58,
    emissive: renderable.role === 'reference' ? 0x4a3511 : 0x214566,
    emissiveIntensity: renderable.role === 'reference' ? 0.2 : 0.18,
  }), [renderable.role])

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
            renderable.role === 'reference' ? 'sketchReference' : 'sketchCurve',
            'document',
          )
        }
      }}
      geometry={geometry}
      material={material}
    />
  )
}

function SketchDisplayPolylineNode({ renderable }: { renderable: SketchSessionDisplayRenderable }) {
  const geometryData = renderable.geometry.kind === 'polyline' ? renderable.geometry : null
  const line = useMemo(() => {
    if (!geometryData) {
      throw new Error(`Display renderable ${renderable.id} is missing polyline geometry.`)
    }

    const nextLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        geometryData.isClosed && geometryData.points.length > 0
          ? [
              ...geometryData.points.map((point) => new THREE.Vector3(point[0], point[1], point[2])),
              new THREE.Vector3(
                geometryData.points[0]![0],
                geometryData.points[0]![1],
                geometryData.points[0]![2],
              ),
            ]
          : geometryData.points.map((point) => new THREE.Vector3(point[0], point[1], point[2])),
      ),
      renderable.linePattern === 'dashed'
        ? new THREE.LineDashedMaterial({
            color: renderable.role === 'reference' ? 0xf0c56c : SURFACE_COLORS.sketchCurve,
            transparent: true,
            opacity: renderable.role === 'reference' ? 0.7 : 0.88,
            depthTest: true,
            depthWrite: false,
            dashSize: 0.24,
            gapSize: 0.14,
          })
        : new THREE.LineBasicMaterial({
            color: renderable.role === 'reference' ? 0xf0c56c : SURFACE_COLORS.sketchCurve,
            transparent: true,
            opacity: 0.95,
            depthTest: true,
            depthWrite: false,
          }),
    )
    if (renderable.linePattern === 'dashed') {
      nextLine.computeLineDistances()
    }
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
  }, [geometryData, renderable])

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

function SketchDisplayMarkerNode({ renderable }: { renderable: SketchSessionDisplayRenderable }) {
  const geometryData = renderable.geometry.kind === 'marker' ? renderable.geometry : null
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: renderable.role === 'reference' ? 0xf0c56c : SURFACE_COLORS.sketchPoint,
    metalness: 0.08,
    roughness: 0.34,
    emissive: renderable.role === 'reference' ? 0x4a3511 : 0x1c3245,
    emissiveIntensity: renderable.role === 'reference' ? 0.2 : 0.16,
    depthTest: true,
    depthWrite: false,
  }), [renderable.role])
  const pickProxy = useMemo(() => {
    if (!geometryData) {
      throw new Error('Display renderable is missing marker geometry.')
    }

    const proxy = createMarkerPickProxy(geometryData.position, geometryData.displayRadius)
    proxy.userData.highlightExcluded = true
    return proxy
  }, [geometryData])

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
        position={geometryData?.position}
        scale={geometryData ? getVisibleMarkerRadius(geometryData.displayRadius) : 1}
        renderOrder={4}
      />
      <primitive object={pickProxy} />
    </group>
  )
}

function snapView(
  presetId: ViewNavigationPresetId,
  camera: THREE.PerspectiveCamera | null,
  controls: ViewportCameraControls | null,
) {
  if (!camera || !controls) {
    return
  }

  snapCameraToPreset({
    camera,
    controls,
    presetId,
  })
}

function resolveProjectedVertexTarget({
  clientX,
  clientY,
  camera,
  viewportElement,
  renderables,
  acceptsTarget,
}: {
  clientX: number
  clientY: number
  camera: THREE.PerspectiveCamera
  viewportElement: HTMLElement
  renderables: ViewportRenderableRecord[]
  acceptsTarget: (target: PrimitiveRef) => boolean
}) {
  const rect = viewportElement.getBoundingClientRect()
  const pointerX = clientX - rect.left
  const pointerY = clientY - rect.top
  const maxDistance = PROJECTED_VERTEX_PICK_RADIUS_PX
  const projectedPoint = new THREE.Vector3()

  const candidate = renderables
    .flatMap(({ renderable }) => {
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
      if (
        !Number.isFinite(projectedPoint.x)
        || !Number.isFinite(projectedPoint.y)
        || !Number.isFinite(projectedPoint.z)
        || projectedPoint.z < -1
        || projectedPoint.z > 1
        || projectedPoint.x < -1
        || projectedPoint.x > 1
        || projectedPoint.y < -1
        || projectedPoint.y > 1
      ) {
        return []
      }

      const screenX = ((projectedPoint.x + 1) / 2) * rect.width
      const screenY = ((-projectedPoint.y + 1) / 2) * rect.height
      const distance = Math.hypot(screenX - pointerX, screenY - pointerY)

      return [{
        distance,
        depth: projectedPoint.z,
        renderable,
      }]
    })
    .filter((entry) => entry.distance <= maxDistance)
    .sort((left, right) => {
      const distanceDelta = left.distance - right.distance

      if (distanceDelta !== 0) {
        return distanceDelta
      }

      return left.depth - right.depth
    })[0]

  if (!candidate) {
    return null
  }

  return {
    pickId: candidate.renderable.binding.pickId,
    target: candidate.renderable.binding.target,
    renderable: candidate.renderable,
  }
}

function resolveProjectedSketchDisplayPointTarget({
  clientX,
  clientY,
  camera,
  viewportElement,
  sketchDisplayRenderables,
  acceptsTarget,
}: {
  clientX: number
  clientY: number
  camera: THREE.PerspectiveCamera
  viewportElement: HTMLElement
  sketchDisplayRenderables: SketchSessionDisplayRenderable[]
  acceptsTarget: (target: PrimitiveRef) => boolean
}) {
  const rect = viewportElement.getBoundingClientRect()
  const pointerX = clientX - rect.left
  const pointerY = clientY - rect.top
  const projectedPoint = new THREE.Vector3()
  const candidate = sketchDisplayRenderables
    .flatMap((renderable) => {
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

      if (
        !Number.isFinite(projectedPoint.x)
        || !Number.isFinite(projectedPoint.y)
        || !Number.isFinite(projectedPoint.z)
        || projectedPoint.z < -1
        || projectedPoint.z > 1
        || projectedPoint.x < -1
        || projectedPoint.x > 1
        || projectedPoint.y < -1
        || projectedPoint.y > 1
      ) {
        return []
      }

      const screenX = ((projectedPoint.x + 1) / 2) * rect.width
      const screenY = ((-projectedPoint.y + 1) / 2) * rect.height
      const distance = Math.hypot(screenX - pointerX, screenY - pointerY)

      return [{
        distance,
        depth: projectedPoint.z,
        renderable,
      }]
    })
    .filter((entry) => entry.distance <= PROJECTED_VERTEX_PICK_RADIUS_PX)
    .sort((left, right) => {
      const distanceDelta = left.distance - right.distance

      if (distanceDelta !== 0) {
        return distanceDelta
      }

      return left.depth - right.depth
    })[0]

  if (!candidate?.renderable.target) {
    return null
  }

  return {
    pickId: null,
    target: candidate.renderable.target,
    renderable: null,
  }
}

function updatePointerFromClientPoint(
  pointer: THREE.Vector2,
  viewportElement: HTMLElement,
  clientX: number,
  clientY: number,
) {
  const rect = viewportElement.getBoundingClientRect()
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
}

function getGeometryToken(
  geometry: ViewportRenderableRecord['renderable']['geometry'] | SketchSessionDisplayRenderable['geometry'],
) {
  switch (geometry.kind) {
    case 'mesh':
      return [
        'mesh',
        geometry.vertexPositions.flat().join(','),
        geometry.triangleIndices.flat().join(','),
        geometry.vertexNormals ? geometry.vertexNormals.flat().join(',') : 'auto-normals',
      ].join(':')
    case 'polyline':
      return [
        'polyline',
        geometry.points.flat().join(','),
        geometry.isClosed ? 'closed' : 'open',
      ].join(':')
    case 'marker':
      return [
        'marker',
        geometry.position.join(','),
        geometry.displayRadius,
      ].join(':')
  }
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

function getSketchSessionCameraToken(
  session: NonNullable<ReturnType<typeof useEditorState>['state']['sketchSession']>,
) {
  const support = session.plane.support
  const supportToken = support.kind === 'construction'
    ? support.constructionId
    : `${support.bodyId}:${support.faceId}`
  const origin = session.plane.frame.origin.join(',')

  return `${session.sketchId ?? 'draft'}:${support.kind}:${supportToken}:${origin}`
}
