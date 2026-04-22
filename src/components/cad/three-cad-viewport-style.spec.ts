import { test } from 'bun:test'

import {
  getSketchDisplayMeshMaterialConfig,
  getSketchDisplayMarkerMaterialConfig,
  getSketchDisplayPolylineMaterialConfig,
  shouldApplySketchDisplayStyles,
} from '@/components/cad/sketch-display-style'
import {
  SKETCH_RENDERING_PALETTE_TOKENS,
  getSketchRenderingPaletteToken,
  resolveSketchRenderingPalette,
} from '@/components/cad/sketch-rendering-palette'

test('src/components/cad/three-cad-viewport-style.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const palette = {
    constrained: 0x222222,
    underconstrained: 0x1651b0,
    overconstrained: 0xff5555,
    regionFill: 0x343a40,
  } as const

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
      lineCap: 'square',
      lineJoin: 'miter',
      miterLimit: 7,
      dashSize: 0.5,
      gapSize: 0.2,
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

  const styledLineConfig = getSketchDisplayPolylineMaterialConfig(styledPolylineRenderable, true, palette)
  assert(styledLineConfig.color === 0x33ffaa, 'Sketch mode should apply stroke color from renderable style metadata.')
  assert(styledLineConfig.opacity === 0.5, 'Sketch mode should apply stroke opacity from renderable style metadata.')
  assert(styledLineConfig.lineWidth === 3, 'Sketch mode should apply stroke width from renderable style metadata.')
  assert(styledLineConfig.linePattern === 'dashed', 'Sketch mode should use dashed materials for authored dash patterns.')
  assert(styledLineConfig.dashSize === 0.5, 'Sketch mode should apply authored dash size.')
  assert(styledLineConfig.gapSize === 0.2, 'Sketch mode should apply authored gap size.')
  assert(styledLineConfig.lineJoin === 'miter', 'Sketch mode should preserve authored line join in material config.')
  assert(styledLineConfig.miterLimit === 7, 'Sketch mode should preserve authored miter limit in material config.')

  const partModeLineConfig = getSketchDisplayPolylineMaterialConfig(styledPolylineRenderable, false, palette)
  assert(
    partModeLineConfig.color !== 0x33ffaa,
    'Part mode should fall back to neutral CAD stroke colors instead of sketch-authored style metadata.',
  )
  assert(partModeLineConfig.opacity === 0.95, 'Part mode should use the existing neutral solid-line opacity.')
  assert(partModeLineConfig.lineWidth === 1, 'Part mode should preserve default line-width behavior for picking stability.')

  const styledMeshConfig = getSketchDisplayMeshMaterialConfig(styledMeshRenderable, true, palette)
  assert(styledMeshConfig.color === 0xaa33ff, 'Sketch mode should apply paint color from renderable style metadata.')
  assert(styledMeshConfig.opacity === 0.44, 'Sketch mode should apply paint opacity from renderable style metadata.')

  const partModeMeshConfig = getSketchDisplayMeshMaterialConfig(styledMeshRenderable, false, palette)
  assert(
    partModeMeshConfig.color !== 0xaa33ff,
    'Part mode should not apply sketch paint styles to display mesh renderables.',
  )

  const regionMeshConfig = getSketchDisplayMeshMaterialConfig({
    ...styledMeshRenderable,
    semanticClass: 'region',
  }, false, palette)
  assert(regionMeshConfig.polygonOffset, 'Sketch-owned region fills should use polygon offset.')
  assert(
    regionMeshConfig.polygonOffsetFactor < 0 && regionMeshConfig.polygonOffsetUnits < 0,
    'Sketch-owned region fills should be biased toward the camera to avoid coplanar flicker.',
  )

  assert(
    getSketchRenderingPaletteToken('constrained') === '--workbench-tooltip-description'
      && getSketchRenderingPaletteToken('underconstrained') === '--mantine-color-blue-9'
      && getSketchRenderingPaletteToken('overconstrained') === '--workbench-shell-danger-text'
      && getSketchRenderingPaletteToken('regionFill') === '--workbench-shell-border',
    'Sketch palette roles should map to exact existing theme tokens.',
  )
  assert(
    Object.values(SKETCH_RENDERING_PALETTE_TOKENS).every((token) =>
      [
        '--workbench-tooltip-description',
        '--mantine-color-blue-9',
        '--workbench-shell-danger-text',
        '--workbench-shell-border',
      ].includes(token),
    ),
    'Sketch palette resolver should not introduce non-theme color tokens.',
  )

  const resolvedPalette = resolveSketchRenderingPalette((token) => {
    const values: Record<string, string> = {
      '--workbench-tooltip-description': 'rgb(34, 34, 34)',
      '--mantine-color-blue-9': 'rgb(22, 81, 176)',
      '--workbench-shell-danger-text': 'rgb(255, 85, 85)',
      '--workbench-shell-border': 'rgb(52, 58, 64)',
    }
    return values[token] ?? ''
  })
  assert(resolvedPalette.underconstrained === 0x1651b0, 'Palette resolver should convert theme CSS values for Three materials.')

  const constrainedLineConfig = getSketchDisplayPolylineMaterialConfig({
    ...styledPolylineRenderable,
    strokeStyle: undefined,
    constraintDisplay: { state: 'constrained', isAffectedOverconstraint: false },
  }, true, palette)
  assert(
    constrainedLineConfig.color === palette.constrained,
    'Fully constrained sketch lines should default to the constrained theme color.',
  )

  const diagnosticLineConfig = getSketchDisplayPolylineMaterialConfig({
    ...styledPolylineRenderable,
    diagnosticStyle: { kind: 'overconstraint' },
    constraintDisplay: { state: 'overconstrained', isAffectedOverconstraint: true },
  }, true, palette)
  assert(diagnosticLineConfig.color === palette.overconstrained, 'Affected overconstrained edge diagnostics should use the error color.')
  assert(diagnosticLineConfig.lineWidth === 1, 'Affected overconstrained edge diagnostics should stay thin.')
  assert(
    diagnosticLineConfig.color !== styledPolylineRenderable.strokeStyle.color,
    'Diagnostic edge overlays may override authored stroke color without replacing the base authored stroke.',
  )

  const affectedMarkerConfig = getSketchDisplayMarkerMaterialConfig({
    ...styledPolylineRenderable,
    geometry: { kind: 'marker', position: [0, 0, 0], displayRadius: 0.1 },
    strokeStyle: undefined,
    constraintDisplay: { state: 'overconstrained', isAffectedOverconstraint: true },
  }, true, palette)
  assert(
    affectedMarkerConfig.color === palette.overconstrained,
    'Affected overconstrained sketch vertices should use the error color family.',
  )
})
