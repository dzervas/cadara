import { test } from 'bun:test'

import {
  createFeatureEditorExpressionControlFormValue,
  createFeatureEditorFormValues,
  createFeatureEditorPatchFromExpression,
  createFeatureEditorPatchFromFormValue,
  featureEditorFormValuesEqual,
  getFeatureEditorExpressionSourceState,
  normalizeFeatureEditorFormValues,
} from '@/domain/feature-authoring/form-adapter'
import { getFeatureEditorFormSchema } from '@/domain/editor/feature-editing'
import { createFeatureEditSession, patchFeatureEditSession } from '@/domain/editor/feature-editing'
import { createExpressionAuthoredValue, isExpressionAuthoredValue } from '@/contracts/modeling/authored-values'

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
  const shellThicknessSource = getFeatureEditorExpressionSourceState(
    shellThicknessField,
    shellFormValues['shell-thickness'],
  )
  assert(
    shellThicknessSource?.source === 'literal' && shellThicknessSource.value.length > 0,
    'Adapter form values should keep numeric literal source state in RHF values.',
  )

  const numericPatch = createFeatureEditorPatchFromFormValue(shellThicknessField, '1.25')
  assert(
    numericPatch?.thickness === 1.25,
    'Adapter numeric values should translate valid RHF strings back into the existing feature patch shape.',
  )
  const expressionPatch = createFeatureEditorPatchFromExpression(shellThicknessField, 'wall + 1')
  assert(
    isExpressionAuthoredValue(expressionPatch?.thickness) &&
      expressionPatch.thickness.valueText === 'wall + 1',
    'Adapter numeric values should preserve non-literal text as authored expression patches.',
  )
  const numericLookingExpressionPatch = createFeatureEditorPatchFromFormValue(
    shellThicknessField,
    createFeatureEditorExpressionControlFormValue('10', '10'),
  )
  assert(
    isExpressionAuthoredValue(numericLookingExpressionPatch?.thickness) &&
      numericLookingExpressionPatch.thickness.valueText === '10',
    'Adapter source state should preserve numeric-looking expression text as an authored expression.',
  )

  const shellOperationField = shellSchema.sections
    .flatMap((section) => section.fields)
    .find((field) => field.id === 'shell-operation')
  assert(shellOperationField?.kind === 'enum', 'Shell form should expose an enum operation field for RHF adaptation.')

  const enumLiteralPatch = createFeatureEditorPatchFromFormValue(shellOperationField, 'join')
  assert(enumLiteralPatch?.operation === 'join', 'Adapter enum literal values should patch as literal enum strings.')

  const enumExpressionPatch = createFeatureEditorPatchFromFormValue(
    shellOperationField,
    createFeatureEditorExpressionControlFormValue('join', '"join"'),
  )
  assert(
    isExpressionAuthoredValue(enumExpressionPatch?.operation) &&
      enumExpressionPatch.operation.valueText === '"join"',
    'Adapter source state should preserve enum expression text even when it resolves to an existing option.',
  )

  const expressionShellSchema = getFeatureEditorFormSchema(
    patchFeatureEditSession(shellSession, {
      thickness: createExpressionAuthoredValue('10'),
      operation: createExpressionAuthoredValue('"join"'),
    }),
  )
  const expressionThicknessField = expressionShellSchema.sections
    .flatMap((section) => section.fields)
    .find((field) => field.id === 'shell-thickness')
  assert(expressionThicknessField?.kind === 'numeric', 'Expression shell form should expose thickness.')
  const expressionShellValues = createFeatureEditorFormValues(expressionShellSchema)
  const expressionThicknessSource = getFeatureEditorExpressionSourceState(
    expressionThicknessField,
    expressionShellValues['shell-thickness'],
  )
  assert(
    expressionThicknessSource?.source === 'expression' &&
      expressionThicknessSource.expressionText === '10',
    'Adapter form values should distinguish expression-authored numeric values from literal values.',
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

  const shellFacesField = populatedShellSchema.sections
    .flatMap((section) => section.fields)
    .find((field) => field.id === 'shell-faces')
  assert(
    shellFacesField?.kind === 'referenceCollection' && !('authoredValue' in shellFacesField),
    'Reference collection fields should not expose expression source metadata.',
  )
})
