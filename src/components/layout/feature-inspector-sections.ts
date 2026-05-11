import type {
  FeatureEditorFormField,
  FeatureEditorFormSection,
} from "@/core/feature-authoring/form-schema";

export interface VisualFormSection {
  id: string;
  title: string;
  hint?: string;
  fields: readonly FeatureEditorFormField[];
}

function getSectionSelectedCount(fields: readonly FeatureEditorFormField[]) {
  return fields.reduce(
    (count, field) => count + (field.advancedParticipant?.selectedCount ?? 0),
    0,
  );
}

function isReferenceCollectionField(
  field: FeatureEditorFormField,
): field is Extract<FeatureEditorFormField, { kind: "referenceCollection" }> {
  return field.kind === "referenceCollection";
}

function isProfileReferenceCollectionField(
  field: FeatureEditorFormField,
): field is Extract<FeatureEditorFormField, { kind: "referenceCollection" }> {
  return (
    isReferenceCollectionField(field) &&
    field.advancedParticipant?.role === "profile"
  );
}

function getReferenceSectionTitle(section: FeatureEditorFormSection) {
  const participantRole = section.fields.find(
    (field) => field.advancedParticipant,
  )?.advancedParticipant?.role;

  if (participantRole === "profile") {
    return "Profile";
  }

  return section.title;
}

function isOutputField(field: FeatureEditorFormField) {
  return (
    field.label === "Operation" ||
    field.id.endsWith("-operation") ||
    field.id.endsWith("-operation-intent") ||
    field.id.endsWith("-target-bodies")
  );
}

function isEmptyDiagnosticsSection(section: FeatureEditorFormSection) {
  return section.fields.every(
    (field) => field.kind === "diagnostics" && field.diagnostics.length === 0,
  );
}

export function getVisualFormSections(
  sections: readonly FeatureEditorFormSection[],
): VisualFormSection[] {
  return sections.flatMap((section) => {
    if (isEmptyDiagnosticsSection(section)) {
      return [];
    }

    if (section.id === "references") {
      const selectedCount = getSectionSelectedCount(section.fields);
      const isProfileSection = section.fields.some(
        isProfileReferenceCollectionField,
      );
      return [
        {
          id: section.id,
          title: getReferenceSectionTitle(section),
          hint:
            !isProfileSection && selectedCount > 0
              ? `${selectedCount} selected`
              : undefined,
          fields: section.fields,
        },
      ];
    }

    if (section.id === "parameters") {
      const geometryFields = section.fields.filter(
        (field) => !isOutputField(field),
      );
      const outputFields = section.fields.filter(isOutputField);
      return [
        ...(geometryFields.length > 0
          ? [
              {
                id: `${section.id}-geometry`,
                title: "Geometry",
                fields: geometryFields,
              },
            ]
          : []),
        ...(outputFields.length > 0
          ? [
              {
                id: `${section.id}-output`,
                title: "Output",
                fields: outputFields,
              },
            ]
          : []),
      ];
    }

    return [{ id: section.id, title: section.title, fields: section.fields }];
  });
}
