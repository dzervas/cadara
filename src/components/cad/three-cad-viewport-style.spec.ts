import { test } from 'bun:test'
import * as THREE from 'three'

import { expectTrue } from '@/testing/expect.spec'
import {
  buildSketchGradientMeshMaterial,
  buildSketchPolylineStrokeGeometry,
  getSketchDisplayMarkerRenderOrder,
  getSketchDisplayMeshMaterialConfig,
  getSketchDisplayMarkerMaterialConfig,
  getSketchDisplayPolylineMaterialConfig,
  shouldUseSketchStrokeMeshGeometry,
  splitSketchPolylineDashSegments,
  shouldDepthTestSketchDisplayMarker,
  shouldApplySketchDisplayStyles,
} from '@/components/cad/sketch-display-style'
import {
  SKETCH_RENDERING_PALETTE_TOKENS,
  getSketchRenderingPaletteToken,
  resolveSketchRenderingPalette,
} from '@/components/cad/sketch-rendering-palette'

test('src/components/cad/three-cad-viewport-style.spec.ts', () => {  const palette = {
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
      kind: 'solid',
      color: 0xaa33ff,
      opacity: 0.44,
    },
  } as const
  const gradientMeshRenderable = {
    ...styledMeshRenderable,
    paintStyle: {
      kind: 'linearGradient',
      startColor: 0x2266ff,
      startOpacity: 0.2,
      endColor: 0xffaa33,
      endOpacity: 0.72,
      angleRadians: Math.PI / 4,
      fallbackColor: 0x2266ff,
      fallbackOpacity: 0.2,
    },
  } as const

  expectTrue(
    shouldApplySketchDisplayStyles('sketch', true),
    'Sketch display styling should be enabled while an active sketch session is being edited.',
  )
  expectTrue(
    !shouldApplySketchDisplayStyles('part', true),
    'Sketch display styling should be disabled in part mode, even if a sketch session object exists.',
  )

  const styledLineConfig = getSketchDisplayPolylineMaterialConfig(styledPolylineRenderable, true, palette)
  expectTrue(styledLineConfig.color === 0x33ffaa, 'Sketch mode should apply stroke color from renderable style metadata.')
  expectTrue(styledLineConfig.opacity === 0.5, 'Sketch mode should apply stroke opacity from renderable style metadata.')
  expectTrue(styledLineConfig.lineWidth === 3, 'Sketch mode should apply stroke width from renderable style metadata.')
  expectTrue(styledLineConfig.linePattern === 'dashed', 'Sketch mode should use dashed materials for authored dash patterns.')
  expectTrue(styledLineConfig.dashSize === 0.5, 'Sketch mode should apply authored dash size.')
  expectTrue(styledLineConfig.gapSize === 0.2, 'Sketch mode should apply authored gap size.')
  expectTrue(styledLineConfig.lineJoin === 'miter', 'Sketch mode should preserve authored line join in material config.')
  expectTrue(styledLineConfig.miterLimit === 7, 'Sketch mode should preserve authored miter limit in material config.')
  expectTrue(
    shouldUseSketchStrokeMeshGeometry(styledPolylineRenderable, styledLineConfig, true),
    'Authored SVG stroke style should use mesh stroke geometry instead of native Three line primitives.',
  )

  const partModeLineConfig = getSketchDisplayPolylineMaterialConfig(styledPolylineRenderable, false, palette)
  expectTrue(
    partModeLineConfig.color !== 0x33ffaa,
    'Part mode should fall back to neutral CAD stroke colors instead of sketch-authored style metadata.',
  )
  expectTrue(partModeLineConfig.opacity === 0.95, 'Part mode should use the existing neutral solid-line opacity.')
  expectTrue(partModeLineConfig.lineWidth === 1, 'Part mode should preserve default line-width behavior for picking stability.')

  const styledMeshConfig = getSketchDisplayMeshMaterialConfig(styledMeshRenderable, true, palette)
  expectTrue(styledMeshConfig.color === 0xaa33ff, 'Sketch mode should apply paint color from renderable style metadata.')
  expectTrue(styledMeshConfig.opacity === 0.44, 'Sketch mode should apply paint opacity from renderable style metadata.')
  expectTrue(styledMeshConfig.fill.kind === 'solid', 'Solid sketch fills should remain explicit material input.')

  const gradientMeshConfig = getSketchDisplayMeshMaterialConfig(gradientMeshRenderable, true, palette)
  expectTrue(
    gradientMeshConfig.fill.kind === 'linearGradient',
    'Sketch mode should preserve linear-gradient fill material input instead of collapsing it to a solid color.',
  )
  expectTrue(
    gradientMeshConfig.fill.startColor === 0x2266ff
      && gradientMeshConfig.fill.startOpacity === 0.2
      && gradientMeshConfig.fill.endColor === 0xffaa33
      && gradientMeshConfig.fill.endOpacity === 0.72
      && gradientMeshConfig.fill.angleRadians === Math.PI / 4,
    'Gradient material input should preserve start/end color, opacity, and angle.',
  )
  const gradientMaterial = buildSketchGradientMeshMaterial(gradientMeshConfig)
  expectTrue(
    gradientMaterial instanceof THREE.ShaderMaterial
      && gradientMaterial.uniforms.startColor.value instanceof THREE.Color
      && gradientMaterial.uniforms.endColor.value instanceof THREE.Color,
    'Gradient region fills should build a gradient-capable shader material.',
  )
  gradientMaterial.dispose()

  const partModeMeshConfig = getSketchDisplayMeshMaterialConfig(styledMeshRenderable, false, palette)
  expectTrue(
    partModeMeshConfig.color !== 0xaa33ff,
    'Part mode should not apply sketch paint styles to display mesh renderables.',
  )
  const disabledGradientMeshConfig = getSketchDisplayMeshMaterialConfig(gradientMeshRenderable, false, palette)
  expectTrue(
    disabledGradientMeshConfig.fill.kind === 'solid' && gradientMeshRenderable.paintStyle.kind === 'linearGradient',
    'Disabling SVG rendering should suppress visual gradient effects without deleting authored gradient style data.',
  )

  const regionMeshConfig = getSketchDisplayMeshMaterialConfig({
    ...styledMeshRenderable,
    semanticClass: 'region',
  }, false, palette)
  expectTrue(regionMeshConfig.polygonOffset, 'Sketch-owned region fills should use polygon offset.')
  expectTrue(
    regionMeshConfig.polygonOffsetFactor < 0 && regionMeshConfig.polygonOffsetUnits < 0,
    'Sketch-owned region fills should be biased toward the camera to avoid coplanar flicker.',
  )

  expectTrue(
    getSketchRenderingPaletteToken('constrained') === '--workbench-tooltip-description'
      && getSketchRenderingPaletteToken('underconstrained') === '--mantine-color-blue-9'
      && getSketchRenderingPaletteToken('overconstrained') === '--workbench-shell-danger-text'
      && getSketchRenderingPaletteToken('regionFill') === '--workbench-shell-border',
    'Sketch palette roles should map to exact existing theme tokens.',
  )
  expectTrue(
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
  expectTrue(resolvedPalette.underconstrained === 0x1651b0, 'Palette resolver should convert theme CSS values for Three materials.')

  const constrainedLineConfig = getSketchDisplayPolylineMaterialConfig({
    ...styledPolylineRenderable,
    strokeStyle: undefined,
    constraintDisplay: { state: 'constrained', isAffectedOverconstraint: false },
  }, true, palette)
  expectTrue(
    constrainedLineConfig.color === palette.constrained,
    'Fully constrained sketch lines should default to the constrained theme color.',
  )

  const diagnosticLineConfig = getSketchDisplayPolylineMaterialConfig({
    ...styledPolylineRenderable,
    diagnosticStyle: { kind: 'overconstraint' },
    constraintDisplay: { state: 'overconstrained', isAffectedOverconstraint: true },
  }, true, palette)
  expectTrue(diagnosticLineConfig.color === palette.overconstrained, 'Affected overconstrained edge diagnostics should use the error color.')
  expectTrue(diagnosticLineConfig.lineWidth === 1, 'Affected overconstrained edge diagnostics should stay thin.')
  expectTrue(
    diagnosticLineConfig.color !== styledPolylineRenderable.strokeStyle.color,
    'Diagnostic edge overlays may override authored stroke color without replacing the base authored stroke.',
  )

  const affectedMarkerConfig = getSketchDisplayMarkerMaterialConfig({
    ...styledPolylineRenderable,
    geometry: { kind: 'marker', position: [0, 0, 0], displayRadius: 0.1 },
    strokeStyle: undefined,
    constraintDisplay: { state: 'overconstrained', isAffectedOverconstraint: true },
  }, true, palette)
  expectTrue(
    affectedMarkerConfig.color === palette.overconstrained,
    'Affected overconstrained sketch vertices should use the error color family.',
  )

  const overlayMarkerRenderable = {
    ...styledPolylineRenderable,
    geometry: { kind: 'marker', position: [0, 0, 0], displayRadius: 0.4 },
    markerLayer: 'overlay' as const,
  }
  expectTrue(
    !shouldDepthTestSketchDisplayMarker(overlayMarkerRenderable),
    'Overlay sketch markers should ignore depth so image-bound anchors remain visible above reference-image quads.',
  )
  expectTrue(
    getSketchDisplayMarkerRenderOrder(overlayMarkerRenderable) > getSketchDisplayMarkerRenderOrder({
      ...overlayMarkerRenderable,
      markerLayer: 'default' as const,
    }),
    'Overlay sketch markers should render after default sketch points.',
  )
})

test('src/components/cad/three-cad-viewport-style.spec.ts SVG stroke mesh geometry', () => {
  const baseConfig = {
    linePattern: 'solid' as const,
    color: 0xffffff,
    opacity: 1,
    lineWidth: 2,
    lineCap: 'butt' as const,
    lineJoin: 'miter' as const,
    miterLimit: 4,
    dashSize: 0,
    gapSize: 0,
  }
  const linePoints = [
    [0, 0, 0],
    [10, 0, 0],
  ] as const

  const butt = buildSketchPolylineStrokeGeometry({
    points: linePoints,
    isClosed: false,
    materialConfig: baseConfig,
    worldUnitsPerPixel: 1,
  })
  const square = buildSketchPolylineStrokeGeometry({
    points: linePoints,
    isClosed: false,
    materialConfig: { ...baseConfig, lineCap: 'square' },
    worldUnitsPerPixel: 1,
  })
  const round = buildSketchPolylineStrokeGeometry({
    points: linePoints,
    isClosed: false,
    materialConfig: { ...baseConfig, lineCap: 'round' },
    worldUnitsPerPixel: 1,
  })
  const buttBounds = getGeometryBounds(butt)
  const squareBounds = getGeometryBounds(square)
  const roundBounds = getGeometryBounds(round)

  expectTrue(
    nearlyEqual(buttBounds.min.x, 0) && nearlyEqual(buttBounds.max.x, 10),
    'Butt caps should not extend stroke mesh bounds past open line endpoints.',
  )
  expectTrue(
    nearlyEqual(squareBounds.min.x, -1) && nearlyEqual(squareBounds.max.x, 11),
    'Square caps should extend by half the stroke width past open line endpoints.',
  )
  expectTrue(
    roundBounds.min.x < 0 && roundBounds.max.x > 10 && getPositionCount(round) > getPositionCount(butt),
    'Round caps should add cap geometry beyond open line endpoints.',
  )

  const closedButt = buildSketchPolylineStrokeGeometry({
    points: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ],
    isClosed: true,
    materialConfig: baseConfig,
    worldUnitsPerPixel: 1,
  })
  const closedSquare = buildSketchPolylineStrokeGeometry({
    points: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ],
    isClosed: true,
    materialConfig: { ...baseConfig, lineCap: 'square' },
    worldUnitsPerPixel: 1,
  })
  expectTrue(
    getPositionCount(closedButt) === getPositionCount(closedSquare)
      && getGeometryBounds(closedButt).min.distanceTo(getGeometryBounds(closedSquare).min) < 1e-6
      && getGeometryBounds(closedButt).max.distanceTo(getGeometryBounds(closedSquare).max) < 1e-6,
    'Closed polylines should ignore endcap style and use join geometry.',
  )

  const cornerPoints = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
  ] as const
  const bevel = buildSketchPolylineStrokeGeometry({
    points: cornerPoints,
    isClosed: false,
    materialConfig: { ...baseConfig, lineJoin: 'bevel' },
    worldUnitsPerPixel: 1,
  })
  const miter = buildSketchPolylineStrokeGeometry({
    points: cornerPoints,
    isClosed: false,
    materialConfig: { ...baseConfig, lineJoin: 'miter', miterLimit: 8 },
    worldUnitsPerPixel: 1,
  })
  const roundJoin = buildSketchPolylineStrokeGeometry({
    points: cornerPoints,
    isClosed: false,
    materialConfig: { ...baseConfig, lineJoin: 'round' },
    worldUnitsPerPixel: 1,
  })
  const clippedMiter = buildSketchPolylineStrokeGeometry({
    points: cornerPoints,
    isClosed: false,
    materialConfig: { ...baseConfig, lineJoin: 'miter', miterLimit: 0.1 },
    worldUnitsPerPixel: 1,
  })

  expectTrue(
    getPositionCount(roundJoin) > getPositionCount(bevel),
    'Round joins should create more corner geometry than bevel joins.',
  )
  expectTrue(
    getPositionCount(miter) !== getPositionCount(bevel),
    'Miter joins should produce distinct corner geometry from bevel joins.',
  )
  expectTrue(
    getPositionCount(clippedMiter) !== getPositionCount(miter),
    'Miter limit should safely fall back instead of emitting the full miter corner.',
  )

  const dashedSegments = splitSketchPolylineDashSegments([
    new THREE.Vector2(0, 0),
    new THREE.Vector2(10, 0),
  ], 2, 2, false)
  expectTrue(
    dashedSegments.length === 3
      && dashedSegments[0]?.[0]?.x === 0
      && dashedSegments[0]?.at(-1)?.x === 2
      && dashedSegments[1]?.[0]?.x === 4
      && dashedSegments[2]?.at(-1)?.x === 10,
    'Dashed SVG strokes should split the path into dash subsegments before tessellation.',
  )
  const dashedSquare = buildSketchPolylineStrokeGeometry({
    points: linePoints,
    isClosed: false,
    materialConfig: { ...baseConfig, linePattern: 'dashed', lineCap: 'square', dashSize: 2, gapSize: 2 },
    worldUnitsPerPixel: 1,
  })
  expectTrue(
    hasPositionX(dashedSquare, 3) && hasPositionX(dashedSquare, 7) && getPositionCount(dashedSquare) > getPositionCount(square),
    'Dashed strokes should apply caps to every dash segment, not only to the whole path.',
  )
})

function getGeometryBounds(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox()
  expectTrue(geometry.boundingBox, 'Expected stroke geometry to have bounds.')
  return geometry.boundingBox
}

function getPositionCount(geometry: THREE.BufferGeometry) {
  return geometry.getAttribute('position').count
}

function hasPositionX(geometry: THREE.BufferGeometry, expected: number) {
  const position = geometry.getAttribute('position')
  for (let index = 0; index < position.count; index += 1) {
    if (nearlyEqual(position.getX(index), expected)) {
      return true
    }
  }
  return false
}

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= 1e-6
}
