import * as THREE from 'three'

import {
  type PrimitiveRef,
  primitiveRefEquals,
} from '@/core/editor/schema'
import {
  getSketchDatumGuideExtent,
  mapSketchPointToWorld,
  type SketchAnnotationDescriptor,
  type SketchSessionDisplayRenderable,
  type SketchSessionState,
} from '@/domain/editor/sketch-session'
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from '@/contracts/shared/references'
import {
  createProjectedPickCandidate,
  DEFAULT_PROJECTED_POINT_PICK_ENTER_RADIUS_PX,
  DEFAULT_PROJECTED_POINT_PICK_EXIT_RADIUS_PX,
  shouldIncludeProjectedPickCandidate,
  type PickCandidate,
} from '@/infrastructure/viewport/render-picking'
import type { ViewportCamera } from '@/infrastructure/viewport/viewport-projection'
import type { ViewportRenderableRecord } from '@/core/workspace/viewport-renderables'

const DEFAULT_PROJECTED_SKETCH_DATUM_LINE_PICK_RADIUS_PX = 10

export function collectProjectedVertexCandidates({
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

export function collectProjectedSketchDisplayPointCandidates({
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

    if (
      !geometryData
      || !renderable.target
      || (renderable.target.kind !== 'sketchPoint'
        && !(renderable.target.kind === 'sketchDatumReference' && renderable.target.geometryKind === 'point'))
      || !acceptsTarget(renderable.target)
    ) {
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
        semanticClass: getProjectedSketchDisplayPointSemanticClass(renderable),
        screenDistance: distance,
        depth: projectedPoint.z,
        stableKey: `sketch:${renderable.id}`,
      }),
    ]
  })
}

export function collectProjectedSketchDatumLineCandidates({
  clientX,
  clientY,
  camera,
  viewportRect,
  sketchSession,
  sketchDisplayRenderables,
  acceptsTarget,
}: {
  clientX: number
  clientY: number
  camera: ViewportCamera
  viewportRect: DOMRectReadOnly
  sketchSession: SketchSessionState | null
  sketchDisplayRenderables: SketchSessionDisplayRenderable[]
  acceptsTarget: (target: PrimitiveRef) => boolean
}): PickCandidate[] {
  const pointerX = clientX - viewportRect.left
  const pointerY = clientY - viewportRect.top
  const projectedStart = new THREE.Vector3()
  const projectedEnd = new THREE.Vector3()

  const renderableAxes = sketchDisplayRenderables.flatMap((renderable) => {
    const geometryData = renderable.geometry.kind === 'polyline' ? renderable.geometry : null
    const target = renderable.target

    if (
      !geometryData
      || !target
      || target.kind !== 'sketchDatumReference'
      || target.geometryKind !== 'lineSegment'
      || geometryData.points.length < 2
      || !acceptsTarget(target)
    ) {
      return []
    }

    const start = geometryData.points[0]!
    const end = geometryData.points[geometryData.points.length - 1]!

    return [{
      start,
      end,
      target,
      stableKey: `sketch:${renderable.id}`,
    }]
  })

  const sessionAxes = sketchSession
    ? createSketchDatumAxisDescriptors(sketchSession)
    : []

  return [...renderableAxes, ...sessionAxes].flatMap(({ start, end, target, stableKey }) => {
    if (!acceptsTarget(target)) {
      return []
    }

    projectedStart.set(start[0], start[1], start[2])
    projectedEnd.set(end[0], end[1], end[2])
    projectedStart.project(camera)
    projectedEnd.project(camera)

    if (!hasVisibleProjectedDepth(projectedStart) || !hasVisibleProjectedDepth(projectedEnd)) {
      return []
    }

    const startScreen = {
      x: ((projectedStart.x + 1) / 2) * viewportRect.width,
      y: ((-projectedStart.y + 1) / 2) * viewportRect.height,
    }
    const endScreen = {
      x: ((projectedEnd.x + 1) / 2) * viewportRect.width,
      y: ((-projectedEnd.y + 1) / 2) * viewportRect.height,
    }
    const distance = getPointToSegmentDistance({
      x: pointerX,
      y: pointerY,
    }, startScreen, endScreen)

    if (distance > DEFAULT_PROJECTED_SKETCH_DATUM_LINE_PICK_RADIUS_PX) {
      return []
    }

    return [
      createProjectedPickCandidate({
        pickId: null,
        target,
        semanticClass: 'sketchReference',
        screenDistance: distance,
        depth: Math.min(projectedStart.z, projectedEnd.z),
        stableKey,
      }),
    ]
  })
}

function createSketchDatumAxisDescriptors(session: SketchSessionState) {
  const sketchId = session.sketchId ?? 'sketch_draft'
  const extent = getSketchDatumGuideExtent(session.definition, session.projectedReferences)

  return ([
    {
      datumId: 'xAxis',
      start: mapSketchPointToWorld(session.plane, [-extent, 0]),
      end: mapSketchPointToWorld(session.plane, [extent, 0]),
    },
    {
      datumId: 'yAxis',
      start: mapSketchPointToWorld(session.plane, [0, -extent]),
      end: mapSketchPointToWorld(session.plane, [0, extent]),
    },
  ] as const).map(({ datumId, start, end }) => ({
    start,
    end,
    target: {
      kind: 'sketchDatumReference',
      sketchId,
      datumId,
      geometryKind: 'lineSegment',
    } satisfies PrimitiveRef,
    stableKey: `sketch-session-datum:${sketchId}:${datumId}`,
  }))
}

function getProjectedSketchDisplayPointSemanticClass(renderable: SketchSessionDisplayRenderable) {
  return renderable.target?.kind === 'sketchDatumReference'
    || renderable.target?.kind === 'projectedReferenceGeometry'
    ? 'sketchPoint'
    : renderable.role === 'reference' ? 'sketchReference' : 'sketchPoint'
}

export function isVisibleProjectedPoint(projectedPoint: THREE.Vector3) {
  return hasVisibleProjectedDepth(projectedPoint)
    && projectedPoint.x >= -1
    && projectedPoint.x <= 1
    && projectedPoint.y >= -1
    && projectedPoint.y <= 1
}

function hasVisibleProjectedDepth(projectedPoint: THREE.Vector3) {
  return Number.isFinite(projectedPoint.x)
    && Number.isFinite(projectedPoint.y)
    && Number.isFinite(projectedPoint.z)
    && projectedPoint.z >= -1
    && projectedPoint.z <= 1
}

function getPointToSegmentDistance(
  point: { x: number, y: number },
  start: { x: number, y: number },
  end: { x: number, y: number },
) {
  const segmentX = end.x - start.x
  const segmentY = end.y - start.y
  const lengthSquared = segmentX * segmentX + segmentY * segmentY

  if (lengthSquared <= Number.EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const projected = (
    (point.x - start.x) * segmentX
    + (point.y - start.y) * segmentY
  ) / lengthSquared
  const clamped = Math.min(1, Math.max(0, projected))
  const closestX = start.x + segmentX * clamped
  const closestY = start.y + segmentY * clamped

  return Math.hypot(point.x - closestX, point.y - closestY)
}

export function updatePointerFromClientPoint(
  pointer: THREE.Vector2,
  viewportRect: DOMRectReadOnly,
  clientX: number,
  clientY: number,
) {
  pointer.x = ((clientX - viewportRect.left) / viewportRect.width) * 2 - 1
  pointer.y = -((clientY - viewportRect.top) / viewportRect.height) * 2 + 1
}

export function isAnnotationTarget(
  target: PrimitiveRef | null,
): target is SketchConstraintRef | SketchDimensionRef {
  return target?.kind === 'constraint' || target?.kind === 'dimension'
}

export function getAnnotationHighlightTargets(
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
