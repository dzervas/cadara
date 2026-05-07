import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import { useFrame, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'

import { getMeasurementWitnessStyleConfig } from '@/components/cad/measurement-witness-style'
import type { MeasurementWitness } from '@/domain/measure/measurement'
import {
  MARKER_SPHERE_GEOMETRY,
  getVisibleMarkerRadius,
} from '@/infrastructure/viewport/render-picking'
import { createViewportCameraTransitionController } from '@/infrastructure/viewport/viewport-camera-transition'
import type { ViewportCameraControls } from '@/infrastructure/viewport/viewport-camera-controls'
import {
  applyViewportCameraFrame,
  applyViewportCameraFrameToCamera,
  captureViewportCameraFrame,
  createViewportCamera,
  getDefaultViewportCameraFrame,
  updateViewportCameraAspect,
  updateViewportCameraClipping,
  type ViewportCamera,
  type ViewportCameraFrame,
  type ViewportProjectionMode,
} from '@/infrastructure/viewport/viewport-projection'
import {
  selectViewportLodTierForRenderables,
  type OccTessellationTierId,
} from '@/domain/modeling/occ/tessellation'
import type { ViewportRenderableRecord } from '@/core/workspace/viewport-renderables'
import {
  createRenderIdleTracker,
  configureWorkspaceScaffoldWireObject,
} from '@/components/cad/three-cad-viewport-helpers'

const VIEWPORT_PROJECTION_OPTIONS: Array<{ mode: ViewportProjectionMode, label: string }> = [
  { mode: 'orthographic', label: 'Orthographic' },
  { mode: 'perspective', label: 'Perspective' },
]

export function MeasurementWitnessLayer({
  witnesses,
}: {
  witnesses: readonly MeasurementWitness[]
}) {
  const style = getMeasurementWitnessStyleConfig()

  if (witnesses.length === 0) {
    return null
  }

  return (
    <group renderOrder={28}>
      {witnesses.map((witness) => {
        if (witness.kind === 'polyline') {
          const linePoints = witness.isClosed && witness.points.length > 1
            ? [...witness.points, witness.points[0]!]
            : witness.points

          return (
            <group key={witness.id} renderOrder={28}>
              <Line
                points={linePoints}
                color={style.halo.color}
                lineWidth={style.halo.lineWidth}
                transparent
                opacity={style.halo.opacity}
                depthWrite={false}
              />
              <Line
                points={linePoints}
                color={style.core.color}
                lineWidth={style.core.lineWidth}
                transparent
                opacity={style.core.opacity}
                depthWrite={false}
              />
            </group>
          )
        }

        return (
          <mesh
            key={witness.id}
            geometry={MARKER_SPHERE_GEOMETRY}
            position={witness.position}
            scale={getVisibleMarkerRadius(witness.radius) * style.marker.scale}
            renderOrder={29}
          >
            <meshBasicMaterial
              color={style.marker.color}
              transparent
              opacity={style.marker.opacity}
              depthWrite={false}
            />
          </mesh>
        )
      })}
    </group>
  )
}

export function ViewportProjectionCameraController({
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
    updateViewportCameraClipping(cameras.orthographic, controlsRef.current?.target)
    updateViewportCameraClipping(cameras.perspective, controlsRef.current?.target)
  }, [aspect, cameras, controlsRef])

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

  useEffect(() => {
    const controls = controlsRef.current

    if (!controls) {
      return
    }

    const updateClipping = () => {
      const camera = cameraRef.current

      if (camera) {
        updateViewportCameraClipping(camera, controls.target)
      }
    }

    updateClipping()
    controls.addEventListener('change', updateClipping)

    return () => {
      controls.removeEventListener('change', updateClipping)
    }
  }, [cameraRef, controlsReadyVersion, controlsRef])

  return null
}

export function ViewportCameraTransitionDriver({
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

export function ViewportProjectionSelector({
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

export function SketchProjectionFrameWatcher({
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

export function BodyLodWatcher({
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

export function RenderIdleSignal({
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

export function FirstNonEmptyGeometryFrameSignal({
  hasNonEmptyGeometry,
  onReady,
}: {
  hasNonEmptyGeometry: boolean
  onReady: () => void
}) {
  const recordedRef = useRef(false)
  const onReadyRef = useRef(onReady)

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useFrame(() => {
    if (recordedRef.current || !hasNonEmptyGeometry) {
      return
    }

    recordedRef.current = true
    onReadyRef.current()
  })

  return null
}

export function WorkspaceSceneScaffold() {
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
