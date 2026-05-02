import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { defaultSelectionFilter } from '@/core/editor/schema'
import type {
  FeatureEditorFormField,
  FeatureEditorFormSchema,
  FeatureReferenceCollectionField,
  FeatureReferencePickerField,
} from '@/core/feature-authoring/form-schema'
import { getFeatureEditorFormSchema } from '@/domain/editor/feature-editing'
import { createFeatureEditSession } from '@/domain/editor/feature-editing'
import { createSeedDocumentSnapshot } from '@/domain/modeling/modeling-test-fixtures'
import type { FeatureEditorState, ImportEditorState, ImportSessionState } from './types'
import {
  createImportViewportSelectionPatch,
  findFormFieldById,
  findNestedFormFieldById,
  getActiveImportReferencePickerField,
  getActiveReferencePickerField,
  getDefaultImportSelectionField,
} from './form-traversal'

function makeReferencePickerField(
  id: string,
  patchKey = `${id}Patch`,
): FeatureReferencePickerField {
  return {
    id,
    kind: 'referencePicker',
    label: id,
    value: null,
    emptyLabel: 'Select target',
    picker: {
      mode: 'replace',
      allowsMultiple: false,
      selectionFilter: defaultSelectionFilter,
    },
    patch: {
      patchKey,
    },
  }
}

function makeReferenceCollectionField(
  id: string,
  patchKey = `${id}Patch`,
): FeatureReferenceCollectionField {
  return {
    id,
    kind: 'referenceCollection',
    label: id,
    value: [],
    emptyLabel: 'Select targets',
    picker: {
      mode: 'appendUnique',
      allowsMultiple: true,
      selectionFilter: defaultSelectionFilter,
    },
    patch: {
      patchKey,
    },
  }
}

function makeImportSession(schema: FeatureEditorFormSchema): ImportSessionState {
  return {
    providerId: 'provider.fixture',
    resolvedSource: {
      kind: 'local',
      path: '/tmp/fixture.step',
      label: 'fixture.step',
    },
    review: {
      schemaVersion: 1,
      summary: [],
      items: [],
      warnings: [],
    },
    selections: {},
    formSchema: schema,
    diagnostics: [],
  } as unknown as ImportSessionState
}

function findFirstTopLevelFieldOfKind(
  schema: FeatureEditorFormSchema,
  kinds: readonly FeatureEditorFormField['kind'][],
) {
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (kinds.includes(field.kind)) {
        return field
      }
    }
  }

  return null
}

test('form-traversal.ts finds nested form fields in option groups and discriminated variants', () => {
  const nestedTarget = makeReferencePickerField('nested-target')
  const discriminant = {
    id: 'variant-switch',
    kind: 'enum',
    label: 'Variant',
    value: 'one',
    options: [{ value: 'one', label: 'One' }],
    patch: { patchKey: 'variantPatch' },
  } as const
  const schema: FeatureEditorFormSchema = {
    sections: [{
      id: 'root',
      title: 'Root',
      fields: [{
        id: 'group',
        kind: 'optionGroup',
        label: 'Group',
        fields: [nestedTarget],
      }, {
        id: 'variant-group',
        kind: 'discriminatedOptionGroup',
        label: 'Variant group',
        discriminant,
        variants: [{
          value: 'one',
          label: 'One',
          fields: [makeReferenceCollectionField('variant-target')],
        }],
      }],
    }],
  }

  const nestedInOptionGroup = findFormFieldById(schema, 'nested-target')
  const nestedInVariant = findFormFieldById(schema, 'variant-target')
  const nestedDiscriminant = findNestedFormFieldById(schema.sections[0]!.fields[1]!, 'variant-switch')

  expectTrue(
    nestedInOptionGroup?.id === 'nested-target'
      && nestedInVariant?.id === 'variant-target'
      && nestedDiscriminant?.id === 'variant-switch',
    'Form traversal should recurse through option groups, discriminated variants, and discriminant fields when resolving field ids.',
  )
})

test('form-traversal.ts resolves the active feature reference picker only for top-level reference fields', () => {
  const session = createFeatureEditSession({ featureType: 'extrude' })
  const schema = getFeatureEditorFormSchema(session)
  const referenceField = findFirstTopLevelFieldOfKind(schema, ['referencePicker', 'referenceCollection'])
  const nonReferenceField = findFirstTopLevelFieldOfKind(schema, ['numeric', 'enum', 'summary', 'custom', 'diagnostics'])

  expectTrue(referenceField, 'Extrude form schema should expose a top-level reference field for picker coverage.')
  expectTrue(nonReferenceField, 'Extrude form schema should expose a non-reference top-level field for negative picker coverage.')

  const active = getActiveReferencePickerField({
    activeReferencePickerFieldId: referenceField.id,
    session,
  } as FeatureEditorState)
  const inactive = getActiveReferencePickerField({
    activeReferencePickerFieldId: nonReferenceField.id,
    session,
  } as FeatureEditorState)

  expectTrue(
    active?.id === referenceField.id && inactive === null,
    'Feature picker resolution should return only active top-level reference fields and ignore other field kinds.',
  )
})

test('form-traversal.ts chooses a default import selection field only when exactly one visible reference field remains', () => {
  const schemaWithHiddenCompanion: FeatureEditorFormSchema = {
    sections: [{
      id: 'import',
      title: 'Import',
      fields: [
        makeReferencePickerField('visible-target'),
        { ...makeReferenceCollectionField('hidden-target'), hidden: true },
      ],
    }],
  }
  const schemaWithTwoVisible: FeatureEditorFormSchema = {
    sections: [{
      id: 'import',
      title: 'Import',
      fields: [
        makeReferencePickerField('first-target'),
        makeReferenceCollectionField('second-target'),
      ],
    }],
  }

  const defaultField = getDefaultImportSelectionField(makeImportSession(schemaWithHiddenCompanion))
  const ambiguousField = getDefaultImportSelectionField(makeImportSession(schemaWithTwoVisible))

  expectTrue(
    defaultField?.id === 'visible-target' && ambiguousField === null,
    'Import default selection should auto-activate the single visible reference field and stay idle when multiple visible targets exist.',
  )
})

test('form-traversal.ts resolves active import picker fields and patches viewport selections with reopened sketch planes', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const sketchId = snapshot.document.sketches[0]!.sketchId
  const sketchTarget = { kind: 'sketch', sketchId } as const
  const pickerField = makeReferencePickerField('sketch-target', 'selectionPatch')
  const collectionField = makeReferenceCollectionField('sketch-targets', 'collectionPatch')
  const state = {
    snapshot,
    session: makeImportSession({
      sections: [{
        id: 'import',
        title: 'Import',
        fields: [pickerField, collectionField],
      }],
    }),
    activeReferencePickerFieldId: pickerField.id,
  } as ImportEditorState

  const activeField = getActiveImportReferencePickerField(state)
  const pickerPatch = createImportViewportSelectionPatch(state, activeField, sketchTarget)
  const collectionPatch = createImportViewportSelectionPatch(
    state,
    collectionField,
    { kind: 'face', bodyId: 'body_fixture', faceId: 'face_fixture' },
  )

  expectTrue(
    activeField?.id === pickerField.id,
    'Import picker resolution should return the active reference field from the import-session schema.',
  )
  expectTrue(
    pickerPatch !== null
      && 'selectionPatch' in pickerPatch
      && typeof pickerPatch.selectionPatch === 'object'
      && pickerPatch.selectionPatch !== null
      && 'plane' in pickerPatch.selectionPatch
      && pickerPatch.selectionPatch.target.kind === 'sketch'
      && pickerPatch.selectionPatch.plane !== null,
    'Viewport selection patches should reopen the selected sketch from the snapshot and attach its plane for reference-picker imports.',
  )
  expectTrue(
    collectionPatch !== null
      && Array.isArray(collectionPatch.collectionPatch)
      && collectionPatch.collectionPatch[0]?.kind === 'face',
    'Reference-collection patches should append the selected target without sketch-plane reopening metadata.',
  )
})
