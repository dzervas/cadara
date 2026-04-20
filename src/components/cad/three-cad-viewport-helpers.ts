import type { SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
import type { ViewportRenderableRecord } from '@/domain/workspace/viewport-renderables'

interface MutableRef<T> {
  current: T
}

export function scheduleCoalescedSketchGeometryDragMove(input: {
  point: readonly [number, number]
  pendingPointRef: MutableRef<readonly [number, number] | null>
  pendingFrameIdRef: MutableRef<number | null>
  requestFrame: (callback: FrameRequestCallback) => number
  isDragActive: () => boolean
  onMove: (point: readonly [number, number]) => void
}) {
  input.pendingPointRef.current = input.point

  if (input.pendingFrameIdRef.current !== null) {
    return
  }

  input.pendingFrameIdRef.current = input.requestFrame(() => {
    input.pendingFrameIdRef.current = null
    const point = input.pendingPointRef.current
    input.pendingPointRef.current = null

    if (point && input.isDragActive()) {
      input.onMove(point)
    }
  })
}

export function cancelCoalescedSketchGeometryDragMove(input: {
  pendingPointRef: MutableRef<readonly [number, number] | null>
  pendingFrameIdRef: MutableRef<number | null>
  cancelFrame: (frameId: number) => void
}) {
  if (input.pendingFrameIdRef.current !== null) {
    input.cancelFrame(input.pendingFrameIdRef.current)
  }

  input.pendingFrameIdRef.current = null
  input.pendingPointRef.current = null
}

export function createViewportBvhSceneKey(
  renderables: readonly ViewportRenderableRecord[],
  sketchDisplayRenderables: readonly SketchSessionDisplayRenderable[],
) {
  return [
    ...renderables.map(({ origin, renderable }) => {
      return `${origin}:${renderable.id}:${renderable.binding.pickId}:${getGeometryToken(renderable.geometry)}`
    }),
    ...sketchDisplayRenderables.map((renderable) => {
      return [
        'sketch',
        renderable.id,
        renderable.linePattern,
        renderable.target ? JSON.stringify(renderable.target) : 'none',
        getSketchStructuralGeometryToken(renderable.geometry),
      ].join(':')
    }),
  ].join('|')
}

export function getSketchStructuralGeometryToken(geometry: SketchSessionDisplayRenderable['geometry']) {
  switch (geometry.kind) {
    case 'mesh':
      return `mesh:${geometry.vertexPositions.length}:${geometry.triangleIndices.length}`
    case 'polyline':
      return `polyline:${geometry.isClosed ? 'closed' : 'open'}:${geometry.points.length}`
    case 'marker':
      return `marker:${geometry.displayRadius}`
  }
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
