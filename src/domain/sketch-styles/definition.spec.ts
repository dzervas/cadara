import { test } from 'bun:test'

import {
  SKETCH_STYLE_PATCH_INTENT,
  buildSketchStyleControls,
  buildSketchStylePresentation,
  parseSketchStylePatch,
} from '@/domain/sketch-styles/definition'

test('src/domain/sketch-styles/definition.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const controls = buildSketchStyleControls(undefined)
  assert(controls.some((control) => control.id === 'sketch-style-fill-mode'), 'Style controls should expose fill mode.')
  assert(controls.some((control) => control.id === 'sketch-style-gradient-start'), 'Style controls should expose gradient start color.')
  assert(controls.some((control) => control.id === 'sketch-style-stroke-join'), 'Style controls should expose stroke join.')
  assert(controls.some((control) => control.id === 'sketch-style-stroke-miter-limit'), 'Style controls should expose stroke miter limit.')
  assert(controls.some((control) => control.id === 'sketch-style-stroke-dash-size'), 'Style controls should expose stroke dash size.')
  assert(controls.some((control) => control.id === 'sketch-style-stroke-gap-size'), 'Style controls should expose stroke gap size.')
  const defaultStrokeEnabled = controls.find((control) => control.id === 'sketch-style-stroke-enabled')
  const defaultStrokeColor = controls.find((control) => control.id === 'sketch-style-stroke-color')
  assert(defaultStrokeEnabled?.kind === 'toggle' && defaultStrokeEnabled.value === false, 'Stroke styling should be disabled by default.')
  assert(defaultStrokeColor?.disabled === true, 'Stroke controls should be disabled until stroke styling is enabled.')

  const accepted = parseSketchStylePatch({
    intent: SKETCH_STYLE_PATCH_INTENT,
    field: 'strokeWidth',
    value: 3,
  })
  assert(accepted?.field === 'strokeWidth' && accepted.value === 3, 'Style patch parser should accept local style fields.')

  const acceptedDash = parseSketchStylePatch({
    intent: SKETCH_STYLE_PATCH_INTENT,
    field: 'strokeDashSize',
    value: 0.75,
  })
  assert(
    acceptedDash?.field === 'strokeDashSize' && acceptedDash.value === 0.75,
    'Style patch parser should accept dash fields.',
  )

  const acceptedMiter = parseSketchStylePatch({
    intent: SKETCH_STYLE_PATCH_INTENT,
    field: 'strokeMiterLimit',
    value: 8,
  })
  assert(
    acceptedMiter?.field === 'strokeMiterLimit' && acceptedMiter.value === 8,
    'Style patch parser should accept miter fields.',
  )

  const strokeDashPresentation = buildSketchStylePresentation({
    toolId: 'strokeDash',
    target: { kind: 'sketchEntity', sketchId: 'sketch_draft', entityId: 'sketch_entity_1' },
  }, undefined)
  assert(
    strokeDashPresentation.controlGroups?.[0]?.controls.some((control) => control.id === 'sketch-style-stroke-enabled') &&
      strokeDashPresentation.controlGroups[0]?.controls.some((control) => control.id === 'sketch-style-stroke-dash-size') &&
      strokeDashPresentation.controlGroups[0]?.controls.some((control) => control.id === 'sketch-style-stroke-gap-size'),
    'Focused stroke dash presentation should expose stroke enablement and dash controls.',
  )

  const guidancePresentation = buildSketchStylePresentation({ toolId: 'fill', target: null }, undefined)
  assert(
    guidancePresentation.selectionGuide?.requiredCount === 1 && guidancePresentation.controls?.length === 0,
    'Style presentation should show target guidance when no local sketch target is selected.',
  )

  const rejected = parseSketchStylePatch({
    intent: SKETCH_STYLE_PATCH_INTENT,
    field: 'externalGeometryRef',
    value: 'paint://other-sketch',
  })
  assert(rejected === null, 'Style patch parser should ignore external style sources.')
})
