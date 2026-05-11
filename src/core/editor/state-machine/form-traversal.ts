import { createFeatureEditorReferenceSelectionPatch } from "@/core/feature-authoring/form-events";
import type {
  FeatureEditorFormField,
  FeatureEditorFormSchema,
} from "@/core/feature-authoring/form-schema";
import { getFeatureEditorFormField } from "@/domain/editor/feature-editing";
import { getSketchPlaneEditFormField } from "@/domain/editor/sketch-plane-editing";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";
import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  FeatureEditorState,
  ImportEditorState,
  ImportSessionState,
  SketchPlaneEditorState,
} from "./types";

export function getActiveReferencePickerField(state: FeatureEditorState) {
  if (!state.activeReferencePickerFieldId) {
    return null;
  }

  const field = getFeatureEditorFormField(
    state.session,
    state.activeReferencePickerFieldId,
  );
  return field?.kind === "referencePicker" ||
    field?.kind === "referenceCollection"
    ? field
    : null;
}

export function getActiveSketchPlaneReferencePickerField(
  state: SketchPlaneEditorState,
) {
  if (!state.activeReferencePickerFieldId) {
    return null;
  }

  const field = getSketchPlaneEditFormField(
    state.session,
    state.activeReferencePickerFieldId,
  );
  return field?.kind === "referencePicker" ||
    field?.kind === "referenceCollection"
    ? field
    : null;
}

export function findFormFieldById(
  schema: FeatureEditorFormSchema,
  fieldId: string,
): FeatureEditorFormField | null {
  for (const section of schema.sections) {
    for (const field of section.fields) {
      const matched = findNestedFormFieldById(field, fieldId);
      if (matched) {
        return matched;
      }
    }
  }

  return null;
}

export function findNestedFormFieldById(
  field: FeatureEditorFormField,
  fieldId: string,
): FeatureEditorFormField | null {
  if (field.id === fieldId) {
    return field;
  }

  if (field.kind === "optionGroup") {
    for (const nestedField of field.fields) {
      const matched = findNestedFormFieldById(nestedField, fieldId);
      if (matched) {
        return matched;
      }
    }
  }

  if (field.kind === "discriminatedOptionGroup") {
    const discriminantMatch = findNestedFormFieldById(
      field.discriminant,
      fieldId,
    );
    if (discriminantMatch) {
      return discriminantMatch;
    }

    for (const variant of field.variants) {
      for (const nestedField of variant.fields) {
        const matched = findNestedFormFieldById(nestedField, fieldId);
        if (matched) {
          return matched;
        }
      }
    }
  }

  return null;
}

export function getImportSessionFormField(
  session: ImportSessionState,
  fieldId: string,
) {
  return findFormFieldById(session.formSchema, fieldId);
}

export function getImportSelectionFields(session: ImportSessionState) {
  const fields: Array<
    Extract<
      FeatureEditorFormField,
      { kind: "referencePicker" | "referenceCollection" }
    >
  > = [];

  for (const section of session.formSchema.sections) {
    for (const field of section.fields) {
      collectImportSelectionFields(field, fields);
    }
  }

  return fields;
}

export function collectImportSelectionFields(
  field: FeatureEditorFormField,
  fields: Array<
    Extract<
      FeatureEditorFormField,
      { kind: "referencePicker" | "referenceCollection" }
    >
  >,
) {
  if (
    field.kind === "referencePicker" ||
    field.kind === "referenceCollection"
  ) {
    fields.push(field);
    return;
  }

  if (field.kind === "optionGroup") {
    for (const nestedField of field.fields) {
      collectImportSelectionFields(nestedField, fields);
    }

    return;
  }

  if (field.kind === "discriminatedOptionGroup") {
    collectImportSelectionFields(field.discriminant, fields);

    for (const variant of field.variants) {
      for (const nestedField of variant.fields) {
        collectImportSelectionFields(nestedField, fields);
      }
    }
  }
}

export function getDefaultImportSelectionField(session: ImportSessionState) {
  const visibleFields = getImportSelectionFields(session).filter(
    (field) => !field.hidden,
  );
  return visibleFields.length === 1 ? visibleFields[0] : null;
}

export function getActiveImportReferencePickerField(state: ImportEditorState) {
  if (!state.activeReferencePickerFieldId) {
    return null;
  }

  const field = getImportSessionFormField(
    state.session,
    state.activeReferencePickerFieldId,
  );
  return field?.kind === "referencePicker" ||
    field?.kind === "referenceCollection"
    ? field
    : null;
}

export function createImportViewportSelectionPatch(
  state: ImportEditorState,
  field: ReturnType<typeof getActiveImportReferencePickerField>,
  target: PrimitiveRef,
) {
  if (!field) {
    return null;
  }

  const patch = createFeatureEditorReferenceSelectionPatch(field, target);

  if (field.kind !== "referencePicker") {
    return patch;
  }

  const sketchSession = state.snapshot
    ? openSketchSessionFromSelection([target], state.snapshot)
    : null;

  return {
    ...patch,
    [field.patch.patchKey]: {
      target,
      plane: sketchSession?.plane ?? null,
    },
  };
}
