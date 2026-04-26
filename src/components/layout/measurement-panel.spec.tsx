import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import { MeasurementPanel } from '@/components/layout/measurement-panel'

test('src/components/layout/measurement-panel.spec.tsx', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const populatedMarkup = renderToStaticMarkup(
    <MantineProvider>
      <MeasurementPanel
        measurement={{
          title: 'Arc 1',
          subtitle: 'Single target',
          rows: [
            { id: 'radius', label: 'Radius', value: '5 mm' },
            { id: 'arc-length', label: 'Arc Length', value: '7.85 mm' },
          ],
          note: null,
          witnesses: [],
        }}
      />
    </MantineProvider>,
  )
  assert(populatedMarkup.includes('Measure'), 'Measurement panel should render its section title.')
  assert(populatedMarkup.includes('Arc 1'), 'Measurement panel should render the current selection title.')
  assert(populatedMarkup.includes('Arc Length'), 'Measurement panel should render populated measurement rows.')
  assert(!populatedMarkup.includes('Diameter'), 'Measurement panel should not invent hidden measurement labels.')

  const notedMarkup = renderToStaticMarkup(
    <MantineProvider>
      <MeasurementPanel
        measurement={{
          title: 'Vertex A',
          subtitle: 'Single target',
          rows: [],
          note: 'Select another measurable target to inspect distance.',
          witnesses: [],
        }}
      />
    </MantineProvider>,
  )
  assert(notedMarkup.includes('Select another measurable target'), 'Measurement panel should render note-only point selections.')

  const emptyMarkup = renderToStaticMarkup(
    <MantineProvider>
      <MeasurementPanel
        measurement={{
          title: 'Unused',
          subtitle: 'Single target',
          rows: [],
          note: null,
          witnesses: [],
        }}
      />
    </MantineProvider>,
  )
  assert(
    !emptyMarkup.includes('Unused') && !emptyMarkup.includes('Measure'),
    'Measurement panel should stay hidden when no rows or note are available.',
  )
})
