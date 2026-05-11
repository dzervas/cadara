import type { FeatureAuthoringDefinition } from "@/core/feature-authoring/definition";
import {
  createSelectionFilterForRequirement,
  planeSelectionFilter,
} from "@/core/editor/schema";
import { PLANE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import {
  asPlaneReferenceTarget,
  createMissingInputDiagnostic,
} from "@/core/feature-authoring/features/shared";

export const planeAuthoringDefinition = {
  metadata: {
    kind: "plane",
    name: "Plane",
    tooltip: "Create a construction plane.",
    icon: "plane",
    toolId: "plane",
    groupId: "features",
    modes: ["part"],
  },
  featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
  selectionFilter: planeSelectionFilter,
  createDraft(input) {
    return {
      referenceTarget: asPlaneReferenceTarget(input.selectedTarget),
    };
  },
  hydrateDraft(feature) {
    return {
      referenceTarget: feature.parameters.reference.target,
    };
  },
  applyPatch(draft, patch) {
    return {
      referenceTarget:
        patch.referenceTarget === undefined
          ? draft.referenceTarget
          : asPlaneReferenceTarget(
              patch.referenceTarget as Parameters<
                typeof asPlaneReferenceTarget
              >[0],
            ),
    };
  },
  applySelection(draft, target) {
    return target.kind === "construction" || target.kind === "face"
      ? this.applyPatch(draft, { referenceTarget: target })
      : draft;
  },
  getPrimarySelectionTarget(draft) {
    return draft.referenceTarget;
  },
  getPreviewLabel(draft, prefix) {
    return draft.referenceTarget
      ? `${prefix} plane from ${draft.referenceTarget.kind}`
      : "Select a construction plane or planar face";
  },
  getMissingInputsDiagnostics(input) {
    return [
      createMissingInputDiagnostic({
        feature: "plane",
        phase: input.phase,
        suffix: "reference",
        message: "Plane preview requires one coplanar reference.",
      }),
    ];
  },
  buildDefinition(draft) {
    return draft.referenceTarget
      ? {
          kind: "plane",
          featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
          parameters: {
            mode: "coplanar",
            reference: {
              target: draft.referenceTarget,
            },
          },
        }
      : null;
  },
  getFormSchema(session) {
    return {
      sections: [
        {
          id: "references",
          title: "References",
          fields: [
            {
              kind: "referencePicker",
              id: "plane-reference",
              label: "Plane reference",
              value: session.draft.referenceTarget,
              emptyLabel: "None selected",
              helper:
                "Accepted targets: one construction plane or one planar face.",
              error: session.draft.referenceTarget
                ? null
                : { message: "Select a plane reference." },
              picker: {
                mode: "replace",
                allowsMultiple: false,
                selectionFilter: createSelectionFilterForRequirement(
                  planeSelectionFilter,
                  "plane-planar-reference",
                  "Plane reference",
                ),
              },
              patch: { patchKey: "referenceTarget" },
            },
          ],
        },
        {
          id: "diagnostics",
          title: "Diagnostics",
          fields: [
            {
              kind: "diagnostics",
              id: "plane-diagnostics",
              label: "Diagnostics",
              diagnostics: session.diagnostics,
            },
          ],
        },
      ],
    };
  },
} satisfies FeatureAuthoringDefinition<"plane">;
