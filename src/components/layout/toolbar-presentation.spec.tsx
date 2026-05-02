import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

import { ToolbarToolIcon } from '@/components/layout/toolbar-tool-icon'
import { ToolbarTooltipContent } from '@/components/layout/toolbar-tooltip-content'
import { getToolIconSrc, toolIconAssetFileNames } from '@/core/tools/tool-icons'

test('src/components/layout/toolbar-presentation.spec.tsx', async () => {  const iconMarkup = renderToStaticMarkup(<ToolbarToolIcon icon="extrude" />)

  expectTrue(iconMarkup.includes('/icons/extrude.svg'), 'Toolbar icons should resolve to local SVG assets.')
  expectTrue(!iconMarkup.includes('lucide'), 'Toolbar icons should not render Lucide glyph markup.')
  expectTrue(!iconMarkup.includes('filter:'), 'Toolbar icons should preserve their authored SVG colors.')

  const sketchLineAsset = readFileSync('public/icons/sketch-line-segment.svg', 'utf8')
  expectTrue(
    sketchLineAsset.includes('#CDCDCD') && sketchLineAsset.includes('#1651B0'),
    'Sketch toolbar assets should use light neutral strokes while preserving blue highlights.',
  )
  expectTrue(!sketchLineAsset.includes('#333333'), 'Sketch toolbar assets should not use dark neutral strokes.')

  for (const iconPath of [
    'public/icons/undo.svg',
    'public/icons/redo.svg',
    'public/icons/measure.svg',
    'public/icons/SectionView-Linked.svg',
  ]) {
    const asset = readFileSync(iconPath, 'utf8')
    expectTrue(asset.includes('#CDCDCD'), `${iconPath} should use a light neutral toolbar stroke.`)
    expectTrue(!asset.includes('#333333'), `${iconPath} should not use dark neutral toolbar strokes.`)
  }

  const runtimeGlobal = globalThis as typeof globalThis & {
    __CADARA_SINGLE_ASSETS__?: Window['__CADARA_SINGLE_ASSETS__']
  }
  const previousAssets = runtimeGlobal.__CADARA_SINGLE_ASSETS__

  try {
    runtimeGlobal.__CADARA_SINGLE_ASSETS__ = {
      icons: {
        'extrude.svg': 'data:image/svg+xml;base64,PHN2Zy8+',
      },
    }

    expectTrue(
      getToolIconSrc('extrude') === 'data:image/svg+xml;base64,PHN2Zy8+',
      'Toolbar icons should use injected single-file SVG assets when present.',
    )
  } finally {
    runtimeGlobal.__CADARA_SINGLE_ASSETS__ = previousAssets
  }

  const tooltipMarkup = renderToStaticMarkup(
    <ToolbarTooltipContent title="Pattern" description="Choose a pattern tool." />,
  )

  expectTrue(tooltipMarkup.includes('Pattern'), 'Tooltips should show the tool name as the heading.')
  expectTrue(
    tooltipMarkup.includes('Choose a pattern tool.'),
    'Tooltips should show descriptive copy beneath the heading.',
  )
  expectTrue(
    tooltipMarkup.includes('--workbench-tooltip-title') &&
      tooltipMarkup.includes('--workbench-tooltip-description'),
    'Toolbar tooltip copy should derive its contrast treatment from shared workbench theme variables.',
  )
  expectTrue(
    tooltipMarkup.includes('whitespace-normal') && tooltipMarkup.includes('break-words'),
    'Toolbar tooltip copy should wrap instead of forcing long text onto one line.',
  )
})

test('tool icon assets stay centralized outside toolbar, sidebar, and history components', () => {  const expectedCurrentToolbarAssets: typeof toolIconAssetFileNames = {
    undo: 'undo.svg',
    redo: 'redo.svg',
    sketch: 'new-sketch.svg',
    line: 'sketch-line-segment.svg',
    rectangle: 'sketch-rectangle.svg',
    circle: 'sketch-circle.svg',
    ellipse: 'sketch-ellipse.svg',
    ellipticalArc: 'elliptical-arc.svg',
    conic: 'sketch-conic.svg',
    bezierCurve: 'sketch-bezier.svg',
    construction: 'sketch-construction.svg',
    spline: 'sketch-spline.svg',
    controlPointSpline: 'add-spline-handle.svg',
    profileText: 'sketch-text-rectangle.svg',
    dimension: 'sketch-dimension.svg',
    constraintCoincident: 'sketch-coincident.svg',
    constraintParallel: 'sketch-parallel.svg',
    constraintPerpendicular: 'sketch-perpendicular.svg',
    constraintTangent: 'sketch-tangent.svg',
    constraintEqual: 'sketch-equal.svg',
    constraintHorizontal: 'sketch-horizontal.svg',
    constraintVertical: 'sketch-vertical.svg',
    constraintConcentric: 'sketch-concentric.svg',
    constraintMidpoint: 'sketch-midpoint.svg',
    constraintNormal: 'sketch-normal.svg',
    constraintPierce: 'sketch-pierce.svg',
    constraintSymmetric: 'sketch-symmetric.svg',
    constraintFix: 'sketch-fix.svg',
    extrude: 'extrude.svg',
    revolve: 'revolve.svg',
    sweep: 'sweep.svg',
    loft: 'loft.svg',
    split: 'split-part.svg',
    fillet: 'fillet.svg',
    chamfer: 'chamfer.svg',
    thicken: 'thicken.svg',
    deleteSolid: 'delete-bodies.svg',
    shell: 'shell.svg',
    linearPattern: 'linear-pattern.svg',
    circularPattern: 'circular-pattern.svg',
    curvePattern: 'curve-pattern.svg',
    moveFace: 'move-face.svg',
    mirror: 'mirror.svg',
    transform: 'transform.svg',
    measure: 'measure.svg',
    sectionView: 'SectionView-Linked.svg',
    trim: 'sketch-trim.svg',
    offset: 'sketch-offset.svg',
    sketchFillet: 'sketch-fillet.svg',
    sketchChamfer: 'sketch-chamfer.svg',
    sketchExtend: 'sketch-extend.svg',
    sketchSplit: 'sketch_split_icon.svg',
    sketchSlot: 'sketch-slot.svg',
    finishSketch: 'check_mark.svg',
    import: 'import-part.svg',
    search: 'search.svg',
    plane: 'c-plane.svg',
    combine: 'boolean-bodies.svg',
    history: 'change-history.svg',
    svgRendering: 'eye_open.svg',
    svgFill: 'svg-fill.svg',
    svgStroke: 'svg-stroke.svg',
    svgStrokeCap: 'svg-stroke-cap.svg',
    svgStrokeJoin: 'svg-stroke-join.svg',
    svgGradient: 'svg-gradient.svg',
  }

  expectTrue(
    JSON.stringify(toolIconAssetFileNames) === JSON.stringify(expectedCurrentToolbarAssets),
    'The shared tool icon source should preserve every current toolbar SVG filename.',
  )

  for (const componentPath of [
    'src/components/layout/toolbar-tool-icon.tsx',
    'src/components/layout/feature-timeline-bar.tsx',
    'src/components/layout/history-timeline-shell.tsx',
    'src/components/layout/feature-sidebar.tsx',
  ]) {
    const source = readFileSync(componentPath, 'utf8')
    expectTrue(!source.includes('Record<ToolIconId, string>'), `${componentPath} should not define a tool icon asset filename map.`)
    expectTrue(!source.includes('toolbarToolIconAssetMap'), `${componentPath} should not import the old toolbar-local icon map.`)
    expectTrue(!source.includes('getToolbarToolIconSrc'), `${componentPath} should not import the old toolbar-local icon helper.`)
  }
})
