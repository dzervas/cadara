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
})
