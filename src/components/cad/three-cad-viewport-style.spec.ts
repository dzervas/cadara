import { test } from 'bun:test'

import {
  getSketchDisplayMeshMaterialConfig,
  getSketchDisplayPolylineMaterialConfig,
  shouldApplySketchDisplayStyles,
} from '@/components/cad/sketch-display-style'

test('src/components/cad/three-cad-viewport-style.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const styledPolylineRenderable = {
    id: 'renderable_sketch_line_1',
    label: 'Styled line',
    geometry: {
      kind: 'polyline',
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      isClosed: false,
    },
    target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_1' },
    linePattern: 'solid',
    role: 'local',
    strokeStyle: {
      color: 0x33ffaa,
      opacity: 0.5,
      width: 3,
    },
  } as const

  const styledMeshRenderable = {
    id: 'renderable_sketch_mesh_1',
    label: 'Styled region',
    geometry: {
      kind: 'mesh',
      vertexPositions: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      vertexNormals: null,
      triangleIndices: [[0, 1, 2]],
    },
    target: null,
    linePattern: 'solid',
    role: 'local',
    paintStyle: {
      color: 0xaa33ff,
      opacity: 0.44,
    },
  } as const

  assert(
    shouldApplySketchDisplayStyles('sketch', true),
    'Sketch display styling should be enabled while an active sketch session is being edited.',
  )
  assert(
    !shouldApplySketchDisplayStyles('part', true),
    'Sketch display styling should be disabled in part mode, even if a sketch session object exists.',
  )

  const styledLineConfig = getSketchDisplayPolylineMaterialConfig(styledPolylineRenderable, true)
  assert(styledLineConfig.color === 0x33ffaa, 'Sketch mode should apply stroke color from renderable style metadata.')
  assert(styledLineConfig.opacity === 0.5, 'Sketch mode should apply stroke opacity from renderable style metadata.')
  assert(styledLineConfig.lineWidth === 3, 'Sketch mode should apply stroke width from renderable style metadata.')

  const partModeLineConfig = getSketchDisplayPolylineMaterialConfig(styledPolylineRenderable, false)
  assert(
    partModeLineConfig.color !== 0x33ffaa,
    'Part mode should fall back to neutral CAD stroke colors instead of sketch-authored style metadata.',
  )
  assert(partModeLineConfig.opacity === 0.95, 'Part mode should use the existing neutral solid-line opacity.')
  assert(partModeLineConfig.lineWidth === 1, 'Part mode should preserve default line-width behavior for picking stability.')

  const styledMeshConfig = getSketchDisplayMeshMaterialConfig(styledMeshRenderable, true)
  assert(styledMeshConfig.color === 0xaa33ff, 'Sketch mode should apply paint color from renderable style metadata.')
  assert(styledMeshConfig.opacity === 0.44, 'Sketch mode should apply paint opacity from renderable style metadata.')

  const partModeMeshConfig = getSketchDisplayMeshMaterialConfig(styledMeshRenderable, false)
  assert(
    partModeMeshConfig.color !== 0xaa33ff,
    'Part mode should not apply sketch paint styles to display mesh renderables.',
  )
})
