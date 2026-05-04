import { test } from 'bun:test'
import * as THREE from 'three'

import { expectTrue } from '@/testing/expect.spec'
import type { PrimitiveRef } from '@/core/editor/schema'
import type { RenderableId } from '@/contracts/shared/ids'
import {
  createNewSketchSession,
  type SketchSessionDisplayRenderable,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import {
  collectProjectedSketchDatumLineCandidates,
  collectProjectedSketchDisplayPointCandidates,
} from '@/components/cad/three-cad-viewport-pick-candidates'
import {
  bindRenderableObject,
  collectRaycastPickCandidates,
  resolveAllCandidates,
} from '@/infrastructure/viewport/render-picking'

test('src/components/cad/three-cad-viewport-pick-candidates.spec.ts', () => {
  const viewportRect = {
    left: 10,
    top: 20,
    width: 200,
    height: 200,
  } as DOMRectReadOnly
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  const originTarget = {
    kind: 'sketchDatumReference',
    sketchId: 'sketch_primary',
    datumId: 'origin',
    geometryKind: 'point',
  } satisfies PrimitiveRef
  const xAxisTarget = {
    kind: 'sketchDatumReference',
    sketchId: 'sketch_primary',
    datumId: 'xAxis',
    geometryKind: 'lineSegment',
  } satisfies PrimitiveRef

  const originRenderable = {
    id: 'renderable_sketch_datum_origin_sketch_primary' as RenderableId,
    label: 'Sketch origin',
    target: originTarget,
    geometry: {
      kind: 'marker',
      position: [0, 0, 0],
      displayRadius: 0.18,
    },
    linePattern: 'solid',
    role: 'reference',
  } satisfies SketchSessionDisplayRenderable
  const xAxisRenderable = {
    id: 'renderable_sketch_datum_xAxis_sketch_primary' as RenderableId,
    label: 'Sketch X axis',
    target: xAxisTarget,
    geometry: {
      kind: 'polyline',
      points: [
        [-20, 0, 0],
        [20, 0, 0],
      ],
      isClosed: false,
    },
    linePattern: 'dashed',
    role: 'reference',
  } satisfies SketchSessionDisplayRenderable

  const originCandidates = collectProjectedSketchDisplayPointCandidates({
    clientX: viewportRect.left + 100,
    clientY: viewportRect.top + 100,
    camera,
    viewportRect,
    sketchDisplayRenderables: [originRenderable, xAxisRenderable],
    acceptsTarget: () => true,
    currentHoverTarget: null,
  })

  expectTrue(originCandidates.length === 1, 'The sketch datum origin should produce a projected pick candidate.')
  expectTrue(
    originCandidates[0]?.semanticClass === 'sketchPoint',
    'The sketch datum origin should sort as a point, not as a reference wire.',
  )

  const axisLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-10, 0, 0),
      new THREE.Vector3(10, 0, 0),
    ]),
    new THREE.LineBasicMaterial(),
  )
  bindRenderableObject(axisLine, null, xAxisTarget, 'sketchReference', 'document')
  const axisHit = collectRaycastPickCandidates([
    {
      object: axisLine,
      distance: 10,
      point: new THREE.Vector3(0, 0, 0),
    } as THREE.Intersection<THREE.Object3D>,
  ])

  expectTrue(
    resolveAllCandidates([...axisHit, ...originCandidates])?.target === originTarget,
    'The origin point should remain pickable at the datum-axis crossing.',
  )

  const axisCandidates = collectProjectedSketchDatumLineCandidates({
    clientX: viewportRect.left + 140,
    clientY: viewportRect.top + 100,
    camera,
    viewportRect,
    sketchSession: null,
    sketchDisplayRenderables: [originRenderable, xAxisRenderable],
    acceptsTarget: () => true,
  })

  expectTrue(axisCandidates.length === 1, 'The sketch datum axis should have a screen-space pick candidate.')
  expectTrue(
    axisCandidates[0]?.target === xAxisTarget,
    'The screen-space datum-axis candidate should preserve the datum reference target.',
  )

  const sessionAxisCandidates = collectProjectedSketchDatumLineCandidates({
    clientX: viewportRect.left + 140,
    clientY: viewportRect.top + 100,
    camera,
    viewportRect,
    sketchSession: createNewSketchSession(createStandardPlaneDefinition('xy')),
    sketchDisplayRenderables: [originRenderable],
    acceptsTarget: () => true,
  })

  expectTrue(
    sessionAxisCandidates.some((candidate) =>
      candidate.target.kind === 'sketchDatumReference' && candidate.target.datumId === 'xAxis',
    ),
    'The active sketch session should provide datum-axis pick candidates even when the line renderable is not ray-pickable.',
  )

  axisLine.geometry.dispose()
  ;(axisLine.material as THREE.Material).dispose()
})
