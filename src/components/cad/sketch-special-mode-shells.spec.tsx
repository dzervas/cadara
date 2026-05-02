import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  SketchSpecialModePanel,
} from '@/components/cad/sketch-special-mode-panel'
import {
  SketchSpecialModeViewportFeedback,
} from '@/components/cad/sketch-special-mode-viewport-feedback'

test('src/components/cad/sketch-special-mode-shells.spec.tsx', async () => {  const panelMarkup = renderToStaticMarkup(
    <MantineProvider>
      <SketchSpecialModePanel
        schema={{
          title: 'Fixture mode',
          subtitle: 'Generic mode shell',
          prompts: [{ id: 'prompt', text: 'Adjust the committed operation.' }],
          sections: [{
            id: 'geometry',
            title: 'Geometry',
            description: 'Generic section copy.',
            fields: [
              {
                id: 'distance',
                kind: 'numeric',
                label: 'Distance',
                value: 12,
                action: {
                  kind: 'patch',
                  patch: { field: 'distance' },
                },
              },
              {
                id: 'status',
                kind: 'readout',
                label: 'State',
                value: 'Ready',
              },
            ],
            diagnostics: [{
              id: 'warning',
              message: 'Review the selected target.',
              severity: 'warning',
            }],
            buttons: [{
              id: 'focus',
              label: 'Focus',
              action: {
                kind: 'invoke',
                actionId: 'focus',
              },
            }],
          }],
          footerButtons: [{
            id: 'cancel',
            label: 'Cancel',
            action: {
              kind: 'command',
              command: 'cancel',
            },
          }],
        }}
        onAction={() => undefined}
      />
    </MantineProvider>,
  )

  expectTrue(panelMarkup.includes('Fixture mode'), 'The generic special-mode panel should render the mode title.')
  expectTrue(panelMarkup.includes('Geometry'), 'The generic special-mode panel should render section titles.')
  expectTrue(panelMarkup.includes('Review the selected target.'), 'The generic special-mode panel should render diagnostics.')
  expectTrue(panelMarkup.includes('Cancel'), 'The generic special-mode panel should render footer actions.')

  const feedbackMarkup = renderToStaticMarkup(
    <SketchSpecialModeViewportFeedback
      presentation={{
        prompts: [{ id: 'prompt', text: 'Pick a handle.' }],
        diagnostics: [{ id: 'diag', message: 'Constraint is unresolved.', severity: 'warning' }],
        overlays: [
          {
            id: 'badge',
            kind: 'badge',
            label: 'Anchor',
            anchor: { kind: 'sketchPoint', point: [1, 2] },
          },
          {
            id: 'segment',
            kind: 'segment',
            start: [0, 0],
            end: [4, 5],
          },
          {
            id: 'handle',
            kind: 'handle',
            label: 'Corner',
            anchor: { kind: 'sketchPoint', point: [3, 4] },
            handle: {
              kind: 'sketchSpecialHandle',
              operationId: 'sketch_operation_fixture',
              handleId: 'sketch_special_handle_fixture',
            },
            draggable: true,
          },
        ],
      }}
      projections={[
        { id: 'sketch-special-overlay:badge', x: 40, y: 60 },
        { id: 'sketch-special-segment:segment:start', x: 10, y: 10 },
        { id: 'sketch-special-segment:segment:end', x: 80, y: 90 },
        { id: 'sketch-special-overlay:handle', x: 50, y: 30 },
      ]}
    />,
  )

  expectTrue(feedbackMarkup.includes('Pick a handle.'), 'The generic special-mode feedback shell should render prompts.')
  expectTrue(feedbackMarkup.includes('Constraint is unresolved.'), 'The generic special-mode feedback shell should render diagnostics.')
  expectTrue(feedbackMarkup.includes('Anchor'), 'The generic special-mode feedback shell should render badge labels.')
  expectTrue(feedbackMarkup.includes('Corner'), 'The generic special-mode feedback shell should render handle labels.')

  const panelSource = await Bun.file(new URL('./sketch-special-mode-panel.tsx', import.meta.url)).text()
  const viewportSource = await Bun.file(new URL('./sketch-special-mode-viewport-feedback.tsx', import.meta.url)).text()

  expectTrue(!panelSource.includes('referenceImage'), 'The generic panel shell should not import or branch on reference-image business logic.')
  expectTrue(!viewportSource.includes('referenceImage'), 'The generic viewport shell should not import or branch on reference-image business logic.')
  expectTrue(!panelSource.includes('modeId ==='), 'The generic panel shell should render from schema data, not mode-id branches.')
  expectTrue(!viewportSource.includes('modeId ==='), 'The generic viewport shell should render from schema data, not mode-id branches.')
  expectTrue(viewportSource.includes('right-4 top-4'), 'Viewport status prompts should avoid the panel shell slot.')
})
