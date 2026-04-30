import type { MaybeAuthoredValue } from '@/contracts/modeling/authored-values'
import type { AdvancedParticipantDescriptor } from '@/contracts/modeling/schema'
import type {
  FeatureEditorFormField,
  FeatureReferenceCollectionField,
} from '@/core/feature-authoring/form-schema'
import type { PrimitiveRef, SelectionFilter } from '@/core/editor/schema'
import { createSelectionFilterForRequirement } from '@/core/editor/schema'
import { expressionCapableAuthoredValue } from '@/core/feature-authoring/features/authored-value-helpers'

export function createBooleanOperationFields(input: {
  prefix: string
  operation: string
  operationValue: MaybeAuthoredValue<unknown>
  booleanTargetBodies: readonly Extract<PrimitiveRef, { kind: 'body' }>[]
  selectionFilter: SelectionFilter
  selectionRequirementId: string
  selectionRequirementLabel: string
}): readonly FeatureEditorFormField[] {
  return [
    {
      kind: 'enum',
      id: `${input.prefix}-operation`,
      label: 'Operation',
      value: input.operation,
      options: [
        { value: 'newBody', label: 'New body' },
        { value: 'join', label: 'Join' },
        { value: 'cut', label: 'Cut' },
        { value: 'intersect', label: 'Intersect' },
      ],
      authoredValue: expressionCapableAuthoredValue(input.operationValue, {
        kind: 'enumString',
        options: ['newBody', 'join', 'cut', 'intersect'],
      }),
      patch: { patchKey: 'operation' },
    },
    {
      kind: 'referenceCollection',
      id: `${input.prefix}-target-bodies`,
      label: 'Boolean target bodies',
      value: input.booleanTargetBodies,
      emptyLabel: 'None selected',
      helper: 'Join, cut, and intersect require at least one explicit target body.',
      hidden: input.operation === 'newBody',
      error: input.operation === 'newBody' || input.booleanTargetBodies.length > 0
        ? null
        : { message: 'Select at least one target body.' },
      advancedParticipant: {
        role: 'targetBody',
        required: input.operation !== 'newBody',
        cardinality: { min: input.operation === 'newBody' ? 0 : 1, max: null },
        selectedCount: input.booleanTargetBodies.length,
      },
      picker: {
        mode: 'appendUnique',
        allowsMultiple: true,
        selectionFilter: createSelectionFilterForRequirement(
          input.selectionFilter,
          input.selectionRequirementId,
          input.selectionRequirementLabel,
        ),
        itemLabel: 'Target body',
      },
      patch: { patchKey: 'booleanTargetBodyIds' },
    },
  ]
}

export function createAdvancedOperationIntentFields(input: {
  prefix: string
  operationIntent: string
  operationValue: MaybeAuthoredValue<unknown>
  targetBodyTargets: readonly Extract<PrimitiveRef, { kind: 'body' }>[]
  selectionFilter: SelectionFilter
  selectionRequirementId: string
  selectionRequirementLabel: string
}): readonly FeatureEditorFormField[] {
  return [
    {
      kind: 'enum',
      id: `${input.prefix}-operation-intent`,
      label: 'Operation',
      value: input.operationIntent,
      options: [
        { value: 'create', label: 'Create' },
        { value: 'add', label: 'Add' },
        { value: 'subtract', label: 'Subtract' },
        { value: 'intersect', label: 'Intersect' },
      ],
      authoredValue: expressionCapableAuthoredValue(input.operationValue, {
        kind: 'enumString',
        options: ['create', 'add', 'subtract', 'intersect'],
      }),
      patch: { patchKey: 'operationIntent' },
    },
    {
      kind: 'referenceCollection',
      id: `${input.prefix}-target-bodies`,
      label: 'Boolean target bodies',
      value: input.targetBodyTargets,
      emptyLabel: 'None selected',
      helper: 'Add, subtract, and intersect require at least one explicit target body.',
      hidden: input.operationIntent === 'create',
      error: input.operationIntent === 'create' || input.targetBodyTargets.length > 0
        ? null
        : { message: 'Select at least one target body.' },
      advancedParticipant: {
        role: 'targetBody',
        required: input.operationIntent !== 'create',
        cardinality: { min: input.operationIntent === 'create' ? 0 : 1, max: null },
        selectedCount: input.targetBodyTargets.length,
      },
      picker: {
        mode: 'appendUnique',
        allowsMultiple: true,
        selectionFilter: createSelectionFilterForRequirement(
          input.selectionFilter,
          input.selectionRequirementId,
          input.selectionRequirementLabel,
        ),
        itemLabel: 'Target body',
      },
      patch: { patchKey: 'targetBodyTargets' },
    },
  ]
}

export function createReferenceCollectionField(input: {
  id: string
  label: string
  value: readonly PrimitiveRef[]
  helper: string
  error?: FeatureReferenceCollectionField['error']
  participant: AdvancedParticipantDescriptor
  selectionFilter: SelectionFilter
  selectionRequirementId: string
  selectionRequirementLabel: string
  itemLabel: string
  patchKey: string
  ordering?: FeatureReferenceCollectionField['ordering']
}): FeatureReferenceCollectionField {
  return {
    kind: 'referenceCollection',
    id: input.id,
    label: input.label,
    value: input.value,
    emptyLabel: 'None selected',
    helper: input.helper,
    error: input.error,
    advancedParticipant: {
      role: input.participant.role,
      required: input.participant.required,
      cardinality: input.participant.cardinality,
      selectedCount: input.value.length,
    },
    picker: {
      mode: 'appendUnique',
      allowsMultiple: true,
      selectionFilter: createSelectionFilterForRequirement(
        input.selectionFilter,
        input.selectionRequirementId,
        input.selectionRequirementLabel,
      ),
      itemLabel: input.itemLabel,
    },
    patch: { patchKey: input.patchKey },
    ...(input.ordering ? { ordering: input.ordering } : {}),
  }
}
