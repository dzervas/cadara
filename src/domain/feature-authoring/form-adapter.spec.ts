import { test } from 'bun:test'

import {
  createFeatureEditorFormValues,
  createFeatureEditorPatchFromFormValue,
  featureEditorFormValuesEqual,
  normalizeFeatureEditorFormValues,
} from '@/domain/feature-authoring/form-adapter'
import { getFeatureEditorFormSchema } from '@/domain/editor/feature-editing'
import { createFeatureEditSession, patchFeatureEditSession } from '@/domain/editor/feature-editing'
import { isExpressionAuthoredValue } from '@/contracts/modeling/authored-values'

test('src/domain/feature-authoring/form-adapter.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const shellSession = createFeatureEditSession({
    featureType: 'shell',
    selectedTarget: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
  })
  const shellSchema = getFeatureEditorFormSchema(shellSession)
  const shellThicknessField = shellSchema.sections
    .flatMap((section) => section.fields)
    .find((field) => field.id === 'shell-thickness')

  assert(shellThicknessField?.kind === 'numeric', 'Shell form should expose a numeric thickness field for RHF adaptation.')

  const shellFormValues = createFeatureEditorFormValues(shellSchema)
  assert(
    typeof shellFormValues['shell-thickness'] === 'string' && shellFormValues['shell-thickness'].length > 0,
    'Adapter form values should keep numeric fields as strings so local typing stays in RHF state.',
  )

  const numericPatch = createFeatureEditorPatchFromFormValue(shellThicknessField, '1.25')
  assert(
    numericPatch?.thickness === 1.25,
    'Adapter numeric values should translate valid RHF strings back into the existing feature patch shape.',
  )
  const expressionPatch = createFeatureEditorPatchFromFormValue(shellThicknessField, 'wall + 1')
  assert(
    isExpressionAuthoredValue(expressionPatch?.thickness) &&
      expressionPatch.thickness.valueText === 'wall + 1',
    'Adapter numeric values should preserve non-literal text as authored expression patches.',
  )

  const revolveSession = createFeatureEditSession({
    featureType: 'revolve',
    selectedTarget: null,
  })
  const revolveAngleField = getFeatureEditorFormSchema(revolveSession).sections
    .flatMap((section) => section.fields)
    .find((field) => field.id === 'revolve-angle')

  assert(revolveAngleField?.kind === 'numeric', 'Revolve form should expose an angle numeric field for adapter coercion.')

  const patchedRevolve = patchFeatureEditSession(
    revolveSession,
    createFeatureEditorPatchFromFormValue(revolveAngleField, '180') ?? {},
  )
  assert(
    patchedRevolve.featureType === 'revolve' && Math.abs(patchedRevolve.draft.angle - Math.PI) < 0.000001,
    'Adapter angle values should preserve the degree-to-radian patch translation owned by the feature domain.',
  )

  const populatedShellSession = patchFeatureEditSession(shellSession, {
    faceTargets: [
      { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
      { kind: 'face', bodyId: 'body_a', faceId: 'face_side' },
    ],
  })
  const populatedShellSchema = getFeatureEditorFormSchema(populatedShellSession)
  const populatedShellValues = createFeatureEditorFormValues(populatedShellSchema)
  const normalizedShellValues = normalizeFeatureEditorFormValues(populatedShellSchema, {
    ...populatedShellValues,
    'shell-faces': [
      { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
      { kind: 'face', bodyId: 'body_a', faceId: 'face_side' },
    ],
  })

  assert(
    featureEditorFormValuesEqual(populatedShellSchema, populatedShellValues, normalizedShellValues),
    'Adapter form values should normalize reference selections by durable identity rather than object identity.',
  )
})
