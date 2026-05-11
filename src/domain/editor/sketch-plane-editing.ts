import type {
  ModelingDiagnostic,
  SketchSnapshotRecord,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import type { SketchId } from "@/contracts/shared/ids";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import type {
  FeatureEditorFormField,
  FeatureEditorFormSchema,
  FeatureEditorPatch,
} from "@/core/feature-authoring/form-schema";
import {
  getPrimitiveRefLabel,
  planeSelectionFilter,
  primitiveRefEquals,
  type PrimitiveRef,
} from "@/core/editor/schema";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";

export type SketchPlaneSupportTarget = Extract<
  PrimitiveRef,
  { kind: "construction" | "face" }
>;
export const SKETCH_PLANE_SUPPORT_FIELD_ID = "sketch-plane-support" as const;

export interface SketchPlaneEditSessionState {
  sketchId: SketchId;
  sketchLabel: string;
  currentPlaneTarget: SketchPlaneSupportTarget;
  definition: SketchSnapshotRecord["sketch"]["definition"];
  draft: {
    selectedPlaneTarget: SketchPlaneSupportTarget | null;
    selectedPlane: SketchPlaneDefinition | null;
  };
  diagnostics: readonly ModelingDiagnostic[];
  status: "idle" | "submitting";
}

function isSketchPlaneSupportTarget(
  value: unknown,
): value is SketchPlaneSupportTarget {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    (value.kind === "construction" || value.kind === "face")
  );
}

function isSketchPlaneDefinition(
  value: unknown,
): value is SketchPlaneDefinition {
  return (
    !!value &&
    typeof value === "object" &&
    "support" in value &&
    "frame" in value &&
    "key" in value
  );
}

function resolveSketchPlaneTargetPlane(
  snapshot: WorkspaceSnapshot,
  target: SketchPlaneSupportTarget,
): SketchPlaneDefinition | null {
  const session = openSketchSessionFromSelection([target], snapshot);
  if (!session) {
    return null;
  }

  return session.plane;
}

export function hydrateSketchPlaneEditSession(
  snapshot: WorkspaceSnapshot,
  sketchId: SketchId,
): SketchPlaneEditSessionState | null {
  const sketch = snapshot.document.sketches.find(
    (entry) => entry.sketchId === sketchId,
  );
  if (!sketch) {
    return null;
  }

  if (!isSketchPlaneSupportTarget(sketch.plane.support)) {
    return null;
  }
  const currentPlaneTarget = sketch.plane.support;

  return {
    sketchId: sketch.sketchId,
    sketchLabel: sketch.label,
    currentPlaneTarget,
    definition: sketch.sketch.definition,
    draft: {
      selectedPlaneTarget: currentPlaneTarget,
      selectedPlane: sketch.plane,
    },
    diagnostics: [],
    status: "idle",
  };
}

export function canReassignCommittedSketchPlane(
  snapshot: WorkspaceSnapshot | null,
  sketchId: SketchId,
): boolean {
  return snapshot
    ? hydrateSketchPlaneEditSession(snapshot, sketchId) !== null
    : false;
}

export function patchSketchPlaneEditSession(
  session: SketchPlaneEditSessionState,
  patch: FeatureEditorPatch,
): SketchPlaneEditSessionState {
  if (!("selectedPlaneTarget" in patch)) {
    return session;
  }

  const selectedPlaneTarget = patch.selectedPlaneTarget;
  const selectedPlane = patch.selectedPlane;
  if (selectedPlaneTarget === null) {
    return {
      ...session,
      draft: {
        ...session.draft,
        selectedPlaneTarget: null,
        selectedPlane: null,
      },
    };
  }

  if (
    !isSketchPlaneSupportTarget(selectedPlaneTarget) ||
    !isSketchPlaneDefinition(selectedPlane)
  ) {
    return session;
  }

  return {
    ...session,
    draft: {
      ...session.draft,
      selectedPlaneTarget,
      selectedPlane,
    },
  };
}

export function applySelectionToSketchPlaneEditSession(
  session: SketchPlaneEditSessionState,
  target: PrimitiveRef,
  snapshot: WorkspaceSnapshot | null,
): SketchPlaneEditSessionState {
  if (!snapshot || !isSketchPlaneSupportTarget(target)) {
    return session;
  }

  const selectedPlane = resolveSketchPlaneTargetPlane(snapshot, target);
  if (!selectedPlane) {
    return session;
  }

  return {
    ...session,
    draft: {
      ...session.draft,
      selectedPlaneTarget: target,
      selectedPlane,
    },
  };
}

export function getSketchPlaneEditFormSchema(
  session: SketchPlaneEditSessionState,
): FeatureEditorFormSchema {
  return {
    sections: [
      {
        id: "support",
        title: "Support",
        fields: [
          {
            kind: "referencePicker",
            id: SKETCH_PLANE_SUPPORT_FIELD_ID,
            label: "Support plane",
            helper:
              "Retarget the committed sketch to another construction plane or planar face.",
            value: session.draft.selectedPlaneTarget,
            emptyLabel: "Select a construction plane or planar face.",
            picker: {
              mode: "replace",
              allowsMultiple: false,
              selectionFilter: planeSelectionFilter,
              itemLabel: "Planar reference",
            },
            patch: { patchKey: "selectedPlaneTarget" },
          },
        ],
      },
      {
        id: "diagnostics",
        title: "Diagnostics",
        fields: [
          {
            kind: "diagnostics",
            id: "sketch-plane-diagnostics",
            label: "Diagnostics",
            diagnostics: session.diagnostics,
          },
        ],
      },
    ],
  };
}

export function getSketchPlaneEditSelectionTarget(
  session: SketchPlaneEditSessionState,
) {
  return { kind: "sketch", sketchId: session.sketchId } as const;
}

export function getSketchPlaneEditFormField(
  session: SketchPlaneEditSessionState,
  fieldId: string,
): FeatureEditorFormField | null {
  for (const section of getSketchPlaneEditFormSchema(session).sections) {
    const field = section.fields.find((entry) => entry.id === fieldId);
    if (field) {
      return field;
    }
  }

  return null;
}

export function getSketchPlaneEditPreviewLabel(
  session: SketchPlaneEditSessionState,
) {
  const selectedPlaneTarget = session.draft.selectedPlaneTarget;
  return selectedPlaneTarget
    ? `Editing ${session.sketchLabel} on ${getPrimitiveRefLabel(selectedPlaneTarget)}`
    : `Editing ${session.sketchLabel}`;
}

export function hasSketchPlaneEditChanges(
  session: SketchPlaneEditSessionState,
) {
  return (
    !!session.draft.selectedPlaneTarget &&
    !primitiveRefEquals(
      session.currentPlaneTarget,
      session.draft.selectedPlaneTarget,
    )
  );
}

export function buildSketchPlaneCommitRequest(
  session: SketchPlaneEditSessionState,
) {
  if (!session.draft.selectedPlaneTarget || !session.draft.selectedPlane) {
    return null;
  }

  return {
    sketchId: session.sketchId,
    sketchLabel: session.sketchLabel,
    plane: session.draft.selectedPlane,
    definition: session.definition,
  };
}
