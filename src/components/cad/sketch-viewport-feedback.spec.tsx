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
        dragHandle: { id: 'distance-preview-drag', kind: 'dimensionLine' },
        labelAnchor: { kind: 'sketchPoint', point: [2, 2] },
        extensionLines: [
          { id: 'distance-preview-extension-a', label: 'Extension', start: [0, 0], end: [0, 2] },
          { id: 'distance-preview-extension-b', label: 'Extension', start: [4, 0], end: [4, 2] },
        ],
      },
      {
        id: 'committed-width-overlay',
        kind: 'dimensionLine',
        label: 'Rectangle 1 width',
        referenceKind: 'horizontal',
        start: [0, 3],
        end: [4, 3],
        value: 4,
        unit: 'mm',
        labelAnchor: { kind: 'sketchPoint', point: [2, 3] },
      },
      {
        id: 'parallel-angle-preview',
        kind: 'angleArc',
        label: 'Angle preview',
        center: [0, 0],
        start: [1, 0],
        end: [0, 1],
        radius: 1,
        side: 'major',
        labelAnchor: { kind: 'sketchPoint', point: [0.5, 0.5] },
        dragHandle: { id: 'parallel-angle-preview-drag', kind: 'angleArc' },
        witnessLines: [
          {
            id: 'parallel-angle-preview-witness-a',
            label: 'Witness',
            start: [0.5, 0],
            end: [1, 0],
          },
          {
            id: 'parallel-angle-preview-witness-b',
            label: 'Witness',
            start: [0, 0.5],
            end: [0, 1],
          },
        ],
      },
      {
        id: 'committed-angle-overlay',
        kind: 'angleArc',
        label: 'Angle dimension',
        center: [0, 0],
        start: [1.5, 0],
        end: [0, 1.5],
        radius: 1.5,
        side: 'minor',
        labelAnchor: { kind: 'sketchPoint', point: [0.75, 0.75] },
        witnessLines: [
          {
            id: 'committed-angle-overlay-witness-a',
            label: 'Witness',
            start: [1, 0],
            end: [1.5, 0],
          },
        ],
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
      {
        id: 'active-snap',
        kind: 'snapIndicator',
        label: 'Midpoint',
        point: [2, 0],
        candidateKind: 'midpoint',
        glyphKind: 'midpoint',
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
        { id: 'overlay:committed-width-overlay', x: 140, y: 40 },
        { id: 'overlay-geometry:committed-width-overlay:start', x: 100, y: 60 },
        { id: 'overlay-geometry:committed-width-overlay:end', x: 180, y: 60 },
        { id: 'overlay:parallel-angle-preview', x: 160, y: 60 },
        { id: 'overlay-geometry:parallel-angle-preview:center', x: 200, y: 120 },
        { id: 'overlay-geometry:parallel-angle-preview:start', x: 240, y: 120 },
        { id: 'overlay-geometry:parallel-angle-preview:end', x: 200, y: 80 },
        { id: 'overlay-geometry:parallel-angle-preview-witness-a:start', x: 220, y: 120 },
        { id: 'overlay-geometry:parallel-angle-preview-witness-a:end', x: 240, y: 120 },
        { id: 'overlay-geometry:parallel-angle-preview-witness-b:start', x: 200, y: 100 },
        { id: 'overlay-geometry:parallel-angle-preview-witness-b:end', x: 200, y: 80 },
        { id: 'overlay:committed-angle-overlay', x: 190, y: 70 },
        { id: 'overlay-geometry:committed-angle-overlay:center', x: 200, y: 120 },
        { id: 'overlay-geometry:committed-angle-overlay:start', x: 260, y: 120 },
        { id: 'overlay-geometry:committed-angle-overlay:end', x: 200, y: 60 },
        { id: 'overlay-geometry:committed-angle-overlay-witness-a:start', x: 240, y: 120 },
        { id: 'overlay-geometry:committed-angle-overlay-witness-a:end', x: 260, y: 120 },
        { id: 'overlay:rectangle-start-anchor', x: 100, y: 140 },
        { id: 'overlay:rectangle-completion-cue', x: 200, y: 60 },
        { id: 'overlay:active-snap', x: 140, y: 100 },
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
    markup.includes('pointer-events-none absolute'),
    'Viewport feedback should keep transient overlay labels non-interactive so canvas clicks pass through.',
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
    markup.includes('data-sketch-viewport-geometry="angleArc"')
      && markup.includes('data-sketch-viewport-arc-side="major"')
      && markup.includes('L 200 80')
      && !markup.includes('A 40 40'),
    'Viewport feedback should render major angle arcs as centered sampled paths from projected line references.',
  )
  assert(
    markup.includes('data-sketch-viewport-drag-handle="distance-preview-drag"')
      && markup.includes('data-sketch-viewport-drag-handle="parallel-angle-preview-drag"'),
    'Viewport feedback should expose declared dimension preview geometry as draggable handles.',
  )
  assert(
    !markup.includes('Rectangle 1 width'),
    'Committed dimension overlays should leave visible text to the draggable annotation chip.',
  )
  assert(
    markup.includes('data-sketch-viewport-angle-witness="parallel-angle-preview-witness-a"')
      && markup.includes('data-sketch-viewport-angle-witness="parallel-angle-preview-witness-b"')
      && markup.includes('stroke-dasharray="4 4"'),
    'Viewport feedback should render dashed angular witness lines when the overlay declares them.',
  )
  assert(
    markup.includes('data-sketch-viewport-angle-witness="committed-angle-overlay-witness-a"'),
    'Viewport feedback should render angular witness lines for committed angle arcs without preview drag handles.',
  )
  assert(
    !markup.includes('First corner') && !markup.includes('Place corner'),
    'Viewport feedback should suppress non-dimensional anchor and completion tooltips.',
  )
  assert(
    markup.includes('data-sketch-viewport-geometry="snapIndicator"')
      && markup.includes('data-sketch-snap-kind="midpoint"')
      && markup.includes('Midpoint'),
    'Viewport feedback should render transient snap indicators and labels.',
  )
})
