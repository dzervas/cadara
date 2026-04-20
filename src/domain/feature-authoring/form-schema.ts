import type { ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { AdvancedParticipantDescriptor, AdvancedParticipantRole } from '@/contracts/modeling/schema'
import type { FeatureValueKindDescriptor } from '@/contracts/modeling/authored-values'
import type { PrimitiveRef, SelectionFilter } from '@/domain/editor/schema'

export type FeatureEditorPatch = Record<string, unknown>

export interface FeatureEditorPatchBinding {
  patchKey: string
  valuePath?: readonly (string | number)[]
}

export interface FeatureEditorAuthoredValueBinding {
  expressionCapable: true
  valueKind: FeatureValueKindDescriptor
  source?: 'literal' | 'expression'
  expressionText?: string | null
}

export interface FeatureEditorFieldError {
  message: string
}

export interface FeatureEditorFormSchema {
  sections: readonly FeatureEditorFormSection[]
}

export interface FeatureEditorFormSection {
  id: string
  title: string
  fields: readonly FeatureEditorFormField[]
}

export type FeatureEditorFormField =
  | FeatureNumericField
  | FeatureEnumField
  | FeatureOptionGroupField
  | FeatureDiscriminatedOptionGroupField
  | FeatureReferencePickerField
  | FeatureReferenceCollectionField
  | FeatureSummaryField
  | FeatureDiagnosticsField
  | FeatureCustomField

export interface FeatureFormFieldBase {
  id: string
  label: string
  helper?: string
  error?: FeatureEditorFieldError | null
  hidden?: boolean
  disabled?: boolean
  advancedParticipant?: FeatureAdvancedParticipantBinding
}

export interface FeatureAdvancedParticipantBinding {
  role: AdvancedParticipantRole
  required: boolean
  cardinality: AdvancedParticipantDescriptor['cardinality']
  selectedCount: number
  diagnostics?: readonly ModelingDiagnostic[]
}

export interface FeatureNumericField extends FeatureFormFieldBase {
  kind: 'numeric'
  value: number | string
  input: 'number' | 'angleDegrees'
  step?: number
  directionToggle?: FeatureNumericDirectionToggle
  authoredValue?: FeatureEditorAuthoredValueBinding
  patch: FeatureEditorPatchBinding
}

export interface FeatureNumericDirectionToggle {
  patch: FeatureEditorPatchBinding
  value: string
  forwardValue: string
  reverseValue: string
  forwardLabel: string
  reverseLabel: string
}

export interface FeatureEnumField extends FeatureFormFieldBase {
  kind: 'enum'
  value: string
  options: readonly FeatureEnumFieldOption[]
  authoredValue?: FeatureEditorAuthoredValueBinding
  patch: FeatureEditorPatchBinding
}

export interface FeatureEnumFieldOption {
  value: string
  label: string
}

export interface FeatureOptionGroupField extends FeatureFormFieldBase {
  kind: 'optionGroup'
  fields: readonly FeatureEditorFormField[]
}

export interface FeatureDiscriminatedOptionGroupField extends FeatureFormFieldBase {
  kind: 'discriminatedOptionGroup'
  discriminant: FeatureEnumField
  variants: readonly FeatureDiscriminatedOptionVariant[]
  showInactiveFields?: boolean
}

export interface FeatureDiscriminatedOptionVariant {
  value: string
  label: string
  fields: readonly FeatureEditorFormField[]
}

export interface FeatureReferencePickerField extends FeatureFormFieldBase {
  kind: 'referencePicker'
  value: PrimitiveRef | null
  emptyLabel: string
  picker: FeatureReferencePickerBehavior
  patch: FeatureEditorPatchBinding
}

export interface FeatureReferenceCollectionField extends FeatureFormFieldBase {
  kind: 'referenceCollection'
  value: readonly PrimitiveRef[]
  emptyLabel: string
  picker: FeatureReferencePickerBehavior
  patch: FeatureEditorPatchBinding
  ordering?: {
    moveUpPatchKey: string
    moveDownPatchKey: string
  }
}

export interface FeatureReferencePickerBehavior {
  mode: 'replace' | 'appendUnique'
  allowsMultiple: boolean
  selectionFilter: SelectionFilter
  itemLabel?: string
}

export interface FeatureSummaryField extends FeatureFormFieldBase {
  kind: 'summary'
  value: string
}

export interface FeatureDiagnosticsField extends FeatureFormFieldBase {
  kind: 'diagnostics'
  diagnostics: readonly ModelingDiagnostic[]
}

export interface FeatureCustomField extends FeatureFormFieldBase {
  kind: 'custom'
  rendererId: string
  payload: unknown
}
