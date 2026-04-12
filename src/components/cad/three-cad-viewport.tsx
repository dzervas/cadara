import { Canvas } from '@react-three/fiber'
import { Bvh, OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import {
  type PrimitiveRef,
  primitiveRefEquals,
  selectionFilterAllowsTarget,
} from '@/domain/editor/schema'
import type { SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
import {
  MARKER_SPHERE_GEOMETRY,
  bindRenderableObject,
  collectBindings,
  type CollectedBindings,
  createInvisiblePickMaterial,
  createMarkerPickProxy,
  createRenderableLineMaterial,
  createRenderableMarkerMaterial,
  createRenderableMeshMaterial,
  getViewportRenderableGeometryToken,
  getBoundTarget,
  isBvhAcceleratedDocumentRenderable,
  getRenderableRenderOrder,
  partitionViewportRenderablesForBvh,
  getVisibleMarkerRadius,
  isSeededDatumPlaneRenderable,
  resolvePickTarget,
  SURFACE_COLORS,
  updateWorkspaceHighlight,
} from '@/domain/workspace/render-picking'
import { applySketchCameraFrame } from '@/domain/workspace/sketch-camera-framing'
import type { ViewportCameraControls } from '@/domain/workspace/viewport-camera-controls'
import type { ViewportRenderableRecord } from '@/domain/workspace/viewport-renderables'
import { snapCameraToVector } from '@/domain/workspace/view-navigation'
import { mapWorldPointToSketch } from '@/domain/modeling/occ/planes'
import { useEditorState } from '@/hooks/use-editor-state'

const GIZMO_DIRECTIONS = {
  front: new THREE.Vector3(0, -1, 0),
  back: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(1, 0, 0),
  left: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, 0, 1),
  bottom: new THREE.Vector3(0, 0, -1),
} as const

const FACE_INDEX_TO_DIRECTION = {
  0: GIZMO_DIRECTIONS.right,
  1: GIZMO_DIRECTIONS.left,
  2: GIZMO_DIRECTIONS.top,
  3: GIZMO_DIRECTIONS.bottom,
  4: GIZMO_DIRECTIONS.front,
  5: GIZMO_DIRECTIONS.back,
} as const

const VIEW_CUBE_SIZE = 120

interface ThreeCadViewportProps {
  hoverTarget: PrimitiveRef | null
  renderables: ViewportRenderableRecord[]
  sketchDisplayRenderables: SketchSessionDisplayRenderable[]
  onHover: (target: PrimitiveRef) => void
  onSelect: (target: PrimitiveRef) => void
  onClearHover: () => void
  onSketchMove: (point: readonly [number, number]) => void
  onSketchRelease: (point: readonly [number, number]) => void
  selection: PrimitiveRef[]
}

export function ThreeCadViewport({
  hoverTarget,
  renderables,
  sketchDisplayRenderables,
  onHover,
  onSelect,
  onClearHover,
  onSketchMove,
  onSketchRelease,
  selection,
}: ThreeCadViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const viewCubeRef = useRef<HTMLDivElement | null>(null)
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<ViewportCameraControls | null>(null)
  const controlsInitializedRef = useRef(false)
  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())
  const sketchPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))
  const sketchHitPointRef = useRef(new THREE.Vector3())
  const primaryPointerDownRef = useRef<{ x: number; y: number } | null>(null)
  const documentGroupRef = useRef<THREE.Group | null>(null)
  const sketchGroupRef = useRef<THREE.Group | null>(null)
  const documentBindingsRef = useRef<CollectedBindings | null>(null)
  const sketchBindingsRef = useRef<CollectedBindings | null>(null)
  const hoverRef = useRef(onHover)
  const hoverTargetRef = useRef(hoverTarget)
  const sketchCameraSessionTokenRef = useRef<string | null>(null)
  const lastPickedTargetRef = useRef<PrimitiveRef | null>(null)
  const selectRef = useRef(onSelect)
  const clearHoverRef = useRef(onClearHover)
  const sketchMoveRef = useRef(onSketchMove)
  const sketchReleaseRef = useRef(onSketchRelease)
  const {
    state: { selectionFilter, selectionCatalog, sketchSession },
  } = useEditorState()
  const selectionRef = useRef(selection)
  const selectionFilterRef = useRef(selectionFilter)
  const selectionCatalogRef = useRef(selectionCatalog)
  const bvhManagedRenderables = useMemo(
    () => partitionViewportRenderablesForBvh(renderables),
    [renderables],
  )
  const bvhSceneKey = useMemo(
    () => bvhManagedRenderables.accelerated
      .map(({ origin, renderable }) => {
        return `${origin}:${renderable.id}:${renderable.binding.pickId}:${getViewportRenderableGeometryToken({
          origin,
          renderable,
        })}`
      })
      .join('|'),
    [bvhManagedRenderables.accelerated],
  )

  useEffect(() => {
    hoverRef.current = onHover
    selectRef.current = onSelect
    clearHoverRef.current = onClearHover
    sketchMoveRef.current = onSketchMove
    sketchReleaseRef.current = onSketchRelease
    hoverTargetRef.current = hoverTarget
    selectionRef.current = selection
    selectionFilterRef.current = selectionFilter
    selectionCatalogRef.current = selectionCatalog
  }, [
    hoverTarget,
    onClearHover,
    onHover,
    onSelect,
    onSketchMove,
    onSketchRelease,
    selection,
    selectionCatalog,
    selectionFilter,
  ])

  useEffect(() => {
    const cubeElement = viewCubeRef.current

    if (!cubeElement) {
      return
    }

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0x000000, 0)
    renderer.setSize(VIEW_CUBE_SIZE, VIEW_CUBE_SIZE, false)
    cubeElement.appendChild(renderer.domElement)

    const cubeMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x4b94ff, metalness: 0.15, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: 0x2e6fd1, metalness: 0.15, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: 0x7cc8ff, metalness: 0.15, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: 0x17365f, metalness: 0.15, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: 0x3f7fd8, metalness: 0.15, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: 0x234a8f, metalness: 0.15, roughness: 0.7 }),
    ]
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 1.2),
      cubeMaterials,
    )
    scene.add(cube)
    scene.add(new THREE.AmbientLight(0xffffff, 1.4))

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.3)
    directionalLight.position.set(3, 4, 6)
    scene.add(directionalLight)

    const pointer = new THREE.Vector2()
    const raycaster = new THREE.Raycaster()
    let animationFrameId = 0

    const handlePointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(pointer, camera)
      const [intersection] = raycaster.intersectObject(cube)

      if (!intersection?.face) {
        return
      }

      const direction =
        FACE_INDEX_TO_DIRECTION[
          intersection.face.materialIndex as keyof typeof FACE_INDEX_TO_DIRECTION
        ]

      if (!direction) {
        return
      }

      snapView(direction, cameraRef.current, controlsRef.current)
    }

    const animate = () => {
      const viewportCamera = cameraRef.current
      const viewportControls = controlsRef.current

      if (viewportCamera && viewportControls) {
        const orbitOffset = viewportCamera.position
          .clone()
          .sub(viewportControls.target)
          .normalize()
        camera.position.copy(orbitOffset.multiplyScalar(4))
        camera.up.copy(viewportCamera.up)
        camera.lookAt(0, 0, 0)
      }

      renderer.render(scene, camera)
      animationFrameId = window.requestAnimationFrame(animate)
    }

    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    animationFrameId = window.requestAnimationFrame(animate)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      cube.geometry.dispose()
      cubeMaterials.forEach((material) => material.dispose())
      renderer.dispose()
      cubeElement.removeChild(renderer.domElement)
    }
  }, [])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      documentBindingsRef.current = collectBindings(documentGroupRef.current)
      const bindings = documentBindingsRef.current

      if (bindings) {
        updateWorkspaceHighlight(bindings.targetToObjects, selectionRef.current, hoverTargetRef.current)
      }
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [renderables])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      sketchBindingsRef.current = collectBindings(sketchGroupRef.current)
      const bindings = sketchBindingsRef.current

      if (bindings) {
        updateWorkspaceHighlight(bindings.targetToObjects, selectionRef.current, hoverTargetRef.current)
      }
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [sketchDisplayRenderables])

  useEffect(() => {
    const camera = cameraRef.current
    const controls = controlsRef.current

    if (!camera || !controls || !sketchSession) {
      sketchCameraSessionTokenRef.current = null
      return
    }

    const nextToken = getSketchSessionCameraToken(sketchSession)

    if (sketchCameraSessionTokenRef.current === nextToken) {
      return
    }

    applySketchCameraFrame({
      camera,
      controls,
      plane: sketchSession.plane,
      renderables: sketchDisplayRenderables,
    })

    sketchCameraSessionTokenRef.current = nextToken
  }, [sketchDisplayRenderables, sketchSession])

  useEffect(() => {
    if (documentBindingsRef.current) {
      updateWorkspaceHighlight(documentBindingsRef.current.targetToObjects, selection, hoverTarget)
    }

    if (sketchBindingsRef.current) {
      updateWorkspaceHighlight(sketchBindingsRef.current.targetToObjects, selection, hoverTarget)
    }
  }, [hoverTarget, selection])

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
      const documentBindings = collectBindings(documentGroupRef.current)
      const sketchBindings = collectBindings(sketchGroupRef.current)

      if (!camera || !documentBindings) {
        return null
      }

      documentBindingsRef.current = documentBindings
      sketchBindingsRef.current = sketchBindings

      updatePointerFromClientPoint(pointerRef.current, canvasElement, clientX, clientY)
      raycasterRef.current.setFromCamera(pointerRef.current, camera)
      raycasterRef.current.params.Line.threshold = 0.75
      ;(raycasterRef.current as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true

      const intersections = raycasterRef.current.intersectObjects(
        [...documentBindings.pickables, ...(sketchBindings?.pickables ?? [])],
        true,
      )
      const projectedMarkerTarget = resolveProjectedMarkerTarget({
        clientX,
        clientY,
        camera,
        viewportElement: canvasElement,
        renderables,
        acceptsTarget: (target) => selectionFilterAllowsTarget(
          selectionFilterRef.current,
          selectionRef.current,
          target,
          selectionCatalogRef.current,
        ),
      })
      const workspaceTarget = resolvePickTarget(
        intersections,
        documentBindings.pickIdToRenderable,
        (target) => selectionFilterAllowsTarget(
          selectionFilterRef.current,
          selectionRef.current,
          target,
          selectionCatalogRef.current,
        ),
      )

      if (projectedMarkerTarget) {
        return projectedMarkerTarget
      }

      if (workspaceTarget) {
        return workspaceTarget
      }

      const sketchDisplayHit = intersections.find((intersection) => {
        const target = getBoundTarget(intersection.object)

        return target
          ? selectionFilterAllowsTarget(
              selectionFilterRef.current,
              selectionRef.current,
              target,
              selectionCatalogRef.current,
            )
          : false
      })

      if (!sketchDisplayHit) {
        return null
      }

      return {
        pickId: null,
        target: getBoundTarget(sketchDisplayHit.object) as PrimitiveRef,
        renderable: null,
      }
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
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.button !== 0) {
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
      primaryPointerDownRef.current = null
      clearHover()
    }

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || pointerWithinViewCube(event.clientX, event.clientY)) {
        return
      }

      const eventTarget = event.target instanceof Node ? event.target : null
      const rect = viewportElement.getBoundingClientRect()
      const withinViewport =
        (eventTarget !== null && viewportElement.contains(eventTarget))
        || (
          event.clientX >= rect.left
          && event.clientX <= rect.right
          && event.clientY >= rect.top
          && event.clientY <= rect.bottom
        )

      if (!withinViewport || sketchSession?.activeTool != null) {
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
  }, [renderables, selection, sketchSession])

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
        <group ref={documentGroupRef}>
          <Bvh key={bvhSceneKey} enabled={bvhManagedRenderables.accelerated.length > 0} firstHitOnly>
            {bvhManagedRenderables.accelerated.map((entry) => (
              <DocumentRenderableNode key={`${entry.origin}:${entry.renderable.id}`} entry={entry} />
            ))}
          </Bvh>
          {bvhManagedRenderables.fallback.map((entry) => (
            <DocumentRenderableNode key={`${entry.origin}:${entry.renderable.id}`} entry={entry} />
          ))}
        </group>
        <group ref={sketchGroupRef}>
          {sketchDisplayRenderables.map((renderable) => (
            <SketchDisplayRenderableNode key={renderable.id} renderable={renderable} />
          ))}
        </group>
        <OrbitControls
          ref={(controls) => {
            controlsRef.current = controls as unknown as ViewportCameraControls | null
            if (!controls || !cameraRef.current) {
              return
            }

            if (controlsInitializedRef.current) {
              return
            }

            cameraRef.current.position.set(14, -16, 28)
            cameraRef.current.up.set(0, 0, 1)
            controls.target.set(0, 0, 4)
            cameraRef.current.lookAt(controls.target)
            controls.update()
            controlsInitializedRef.current = true
          }}
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
        className="pointer-events-auto absolute right-4 top-4 overflow-hidden rounded-xl border border-[var(--cad-border-strong)] bg-[rgba(8,12,17,0.78)] shadow-[var(--cad-panel-shadow)]"
        style={{ width: VIEW_CUBE_SIZE, height: VIEW_CUBE_SIZE }}
      />
    </div>
  )
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
      userData={{
        bvhAccelerated: isBvhAcceleratedDocumentRenderable(entry),
      }}
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
      throw new Error(`Renderable ${renderable.id} is missing marker geometry.`)
    }

    return createMarkerPickProxy(geometryData.position, geometryData.displayRadius)
  }, [geometryData, renderable.id])
  const material = useMemo(() => createRenderableMarkerMaterial(renderable, origin), [origin, renderable])

  useEffect(() => {
    pickProxy.userData.highlightExcluded = true
  }, [pickProxy])
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
      throw new Error(`Display renderable ${renderable.id} is missing mesh geometry.`)
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
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: SURFACE_COLORS.sketchCurve,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    metalness: 0.08,
    roughness: 0.58,
    emissive: 0x214566,
    emissiveIntensity: 0.18,
  }), [renderable.id])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh
      ref={(value) => {
        if (value && renderable.target) {
          bindRenderableObject(value, null, renderable.target, 'sketchCurve', 'document')
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

    const points = geometryData.points.map((point) => new THREE.Vector3(point[0], point[1], point[2]))
    const displayPoints = geometryData.isClosed && points.length > 0 ? [...points, points[0].clone()] : points
    const nextLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(displayPoints),
      new THREE.LineBasicMaterial({
        color: SURFACE_COLORS.sketchCurve,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: false,
      }),
    )
    nextLine.renderOrder = 3

    if (renderable.target) {
      bindRenderableObject(nextLine, null, renderable.target, 'sketchCurve', 'document')
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
    color: SURFACE_COLORS.sketchPoint,
    metalness: 0.08,
    roughness: 0.34,
    emissive: 0x1c3245,
    emissiveIntensity: 0.16,
    depthTest: true,
    depthWrite: false,
  }), [renderable.id])
  const pickProxy = useMemo(() => {
    if (!geometryData) {
      throw new Error(`Display renderable ${renderable.id} is missing marker geometry.`)
    }

    const proxy = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      createInvisiblePickMaterial(),
    )
    proxy.position.set(geometryData.position[0], geometryData.position[1], geometryData.position[2])
    proxy.scale.setScalar(Math.max(geometryData.displayRadius * 1.45, geometryData.displayRadius, Number.EPSILON))
    proxy.userData.highlightExcluded = true
    return proxy
  }, [geometryData, renderable.id])

  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    const mesh = pickProxy
    return () => {
      if (mesh.geometry instanceof THREE.BufferGeometry) {
        mesh.geometry.dispose()
      }
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose()
      }
    }
  }, [pickProxy])
  return (
    <group
      ref={(value) => {
        if (value && renderable.target) {
          bindRenderableObject(value, null, renderable.target, 'sketchPoint', 'document')
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
  direction: THREE.Vector3,
  camera: THREE.PerspectiveCamera | null,
  controls: ViewportCameraControls | null,
) {
  if (!camera || !controls) {
    return
  }

  snapCameraToVector({
    camera,
    controls,
    direction,
  })
}

function resolveProjectedMarkerTarget({
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
  const maxDistance = 32
  const projectedPoint = new THREE.Vector3()

  const candidates = renderables
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
    })

  const candidate = candidates[0]

  if (!candidate) {
    return null
  }

  return {
    pickId: candidate.renderable.binding.pickId,
    target: candidate.renderable.binding.target,
    renderable: candidate.renderable,
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
