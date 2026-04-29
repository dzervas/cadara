import * as THREE from 'three'

import {
  type PrimitiveRef,
  primitiveRefEquals,
} from '@/domain/editor/schema'
import type { SketchAnnotationDescriptor } from '@/domain/editor/sketch-session'
import type { SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
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
} from '@/domain/workspace/render-picking'
import type { ViewportCamera } from '@/domain/workspace/viewport-projection'
import type { ViewportRenderableRecord } from '@/domain/workspace/viewport-renderables'

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
        semanticClass: renderable.role === 'reference' ? 'sketchReference' : 'sketchPoint',
        screenDistance: distance,
        depth: projectedPoint.z,
        stableKey: `sketch:${renderable.id}`,
      }),
    ]
  })
}

export function isVisibleProjectedPoint(projectedPoint: THREE.Vector3) {
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
