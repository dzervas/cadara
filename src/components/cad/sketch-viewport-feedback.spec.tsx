import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SketchViewportFeedbackLayer } from '@/components/cad/sketch-viewport-feedback'
import type { SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'

test('src/components/cad/sketch-viewport-feedback.spec.tsx', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const schema: SketchToolPresentationSchema = {
    prompts: [],
    overlays: [
      {
        id: 'rectangle-width-overlay',
        kind: 'measurement',
        label: 'Width',
        value: 4,
        unit: 'mm',
        anchor: { kind: 'sketchPoint', point: [2, 0] },
      },
      {
        id: 'distance-preview',
        kind: 'dimensionLine',
        label: 'Horizontal 12.00 mm',
        referenceKind: 'horizontal',
        start: [0, 2],
        end: [4, 2],
        value: 12,
        unit: 'mm',
        labelAnchor: { kind: 'sketchPoint', point: [2, 2] },
        extensionLines: [
          { id: 'distance-preview-extension-a', label: 'Extension', start: [0, 0], end: [0, 2] },
          { id: 'distance-preview-extension-b', label: 'Extension', start: [4, 0], end: [4, 2] },
        ],
      },
      {
        id: 'parallel-angle-preview',
        kind: 'angleArc',
        label: 'Angle preview',
        center: [0, 0],
        start: [1, 0],
        end: [0, 1],
        radius: 1,
        labelAnchor: { kind: 'sketchPoint', point: [0.5, 0.5] },
      },
      {
        id: 'rectangle-start-anchor',
        kind: 'anchor',
        label: 'First corner',
        point: [0, 0],
      },
      {
        id: 'rectangle-completion-cue',
        kind: 'completionCue',
        label: 'Place corner',
        point: [4, 3],
        ready: true,
      },
    ],
    floatingInput: {
      id: 'distance-value-input',
      label: 'Distance',
      value: 12,
      unit: 'mm',
      confirmLabel: 'Commit',
      cancelLabel: 'Cancel',
      anchor: { kind: 'sketchPoint', point: [4, 0] },
      submitAction: { type: 'patch', patch: { intent: 'commitConstraintValue' } },
      cancelAction: { type: 'patch', patch: { intent: 'cancelConstraintValue' } },
    },
  }

  const markup = renderToStaticMarkup(
    <SketchViewportFeedbackLayer
      schema={schema}
      projections={[
        { id: 'overlay:rectangle-width-overlay', x: 120, y: 80 },
        { id: 'overlay:distance-preview', x: 140, y: 70 },
        { id: 'overlay-geometry:distance-preview:start', x: 100, y: 100 },
        { id: 'overlay-geometry:distance-preview:end', x: 180, y: 100 },
        { id: 'overlay-geometry:distance-preview-extension-a:start', x: 100, y: 140 },
        { id: 'overlay-geometry:distance-preview-extension-a:end', x: 100, y: 100 },
        { id: 'overlay-geometry:distance-preview-extension-b:start', x: 180, y: 140 },
        { id: 'overlay-geometry:distance-preview-extension-b:end', x: 180, y: 100 },
        { id: 'overlay:parallel-angle-preview', x: 160, y: 60 },
        { id: 'overlay-geometry:parallel-angle-preview:center', x: 200, y: 120 },
        { id: 'overlay-geometry:parallel-angle-preview:start', x: 240, y: 120 },
        { id: 'overlay-geometry:parallel-angle-preview:end', x: 200, y: 80 },
        { id: 'overlay:rectangle-start-anchor', x: 100, y: 140 },
        { id: 'overlay:rectangle-completion-cue', x: 200, y: 60 },
        { id: 'floating-input:distance-value-input', x: 180, y: 90 },
      ]}
      onPatch={() => undefined}
    />,
  )

  assert(
    markup.includes('data-sketch-viewport-overlay="measurement"'),
    'Viewport feedback should render measurement overlays from generic descriptors.',
  )
  assert(markup.includes('Width') && markup.includes('4.00 mm'), 'Viewport feedback should render anchored measurement text.')
  assert(
    markup.includes('left:120px') && markup.includes('top:80px'),
    'Viewport feedback should place measurement labels at projected screen positions.',
  )
  assert(
    markup.includes('data-sketch-viewport-floating-input="distance-value-input"'),
    'Viewport feedback should render floating numeric input from projected anchors.',
  )
  assert(markup.includes('Distance') && markup.includes('Commit'), 'Viewport feedback should preserve numeric input controls.')
  assert(
    markup.includes('data-sketch-viewport-geometry="dimensionLine"') && markup.includes('x1="100"'),
    'Viewport feedback should render dimension preview line geometry from projected endpoints.',
  )
  assert(
    markup.includes('data-sketch-viewport-geometry="angleArc"') && markup.includes('A 40 40'),
    'Viewport feedback should render angle preview arcs from projected line references.',
  )
  assert(
    !markup.includes('First corner') && !markup.includes('Place corner'),
    'Viewport feedback should suppress non-dimensional anchor and completion tooltips.',
  )
})
