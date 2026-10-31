import { describe, expect, test } from "vitest";
import { defaultEditorExtensionDependencies } from "@/composition/editor-extension-dependencies";
import { createRenderMeshGeometry } from "@/contracts/render/render-mesh-geometry";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type {
  BodyId,
  CommandSessionId,
  EdgeId,
  FaceId,
  PickId,
  RegionId,
  RenderableId,
  RequestId,
  RevisionId,
  SketchId,
} from "@/contracts/shared/ids";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  createFeatureEditSession,
  getFeatureEditorFormSchema,
} from "@/core/editor/feature-editing";
import type { FeatureEditSessionState } from "@/core/feature-authoring/definition";
import { createFeatureEditorRemoveReferenceItemPatch } from "@/core/feature-authoring/form-events";
import type { FeatureEditorFormField } from "@/core/feature-authoring/form-schema";
import {
  initialEditorState,
  transitionEditorState,
  type FeatureEditorState,
} from "./index";

// Seam: the editor transition for a feature form patch that removes a
// selected reference (the chip's Remove button). It decides which preview is
// requested and which preview the viewport keeps showing: the remaining
// references are previewed, no preview remains once none is left, and the
// removed reference is no longer highlighted as the viewport selection.

const edge = (edgeId: string): PrimitiveRef => ({
  kind: "edge",
  bodyId: "body_a" as BodyId,
  edgeId: edgeId as EdgeId,
});
const region = (regionId: string): PrimitiveRef => ({
  kind: "region",
  sketchId: "sketch_a" as SketchId,
  regionId: regionId as RegionId,
});

const tools = [
  { featureType: "fillet", first: edge("edge_a"), second: edge("edge_b") },
  { featureType: "chamfer", first: edge("edge_a"), second: edge("edge_b") },
  {
    featureType: "extrude",
    first: region("region_a"),
    second: region("region_b"),
  },
] as const;

describe.each(tools)(
  "removing a selected $featureType reference",
  ({ featureType, first, second }) => {
    test("previews the remaining reference, then clears the preview when none is left", () => {
      const twoReferences = editingState(
        createFeatureEditSession({
          featureType,
          selectedTargets: [first, second],
        }),
        [second],
      );

      const removedSecond = transitionEditorState(
        twoReferences,
        { type: "form.featurePatched", patch: removalPatch(twoReferences, second) },
        defaultEditorExtensionDependencies,
      );
      const oneReference = asFeatureEditor(removedSecond.state);

      expect(
        removedSecond.effects.flatMap((effect) =>
          effect.type === "feature.evaluatePreview"
            ? [referencesOf(effect.featureSession)]
            : [],
        ),
        "the preview is requested for the remaining reference only",
      ).toEqual([[first]]);
      expect(
        oneReference.selection,
        "the removed reference is no longer the highlighted viewport selection",
      ).toEqual([]);

      const removedFirst = transitionEditorState(
        { ...oneReference, previewRenderables: [previewRenderable()] },
        { type: "form.featurePatched", patch: removalPatch(oneReference, first) },
        defaultEditorExtensionDependencies,
      );
      const noReference = asFeatureEditor(removedFirst.state);

      expect(
        removedFirst.effects.filter(
          (effect) => effect.type === "feature.evaluatePreview",
        ),
        "nothing is left to preview",
      ).toEqual([]);
      expect(
        noReference.previewRenderables,
        "the preview of the removed references is no longer shown",
      ).toBeNull();
      expect(
        noReference.pendingPreviewRequestId,
        "a preview still in flight for the removed references is ignored",
      ).toBeNull();
    });
  },
);

test("a patch that keeps every reference keeps the viewport selection", () => {
  const state = editingState(
    createFeatureEditSession({
      featureType: "fillet",
      selectedTargets: [edge("edge_a"), edge("edge_b")],
    }),
    [edge("edge_b")],
  );

  const patched = transitionEditorState(
    state,
    { type: "form.featurePatched", patch: { radius: 2 } },
    defaultEditorExtensionDependencies,
  );

  expect(asFeatureEditor(patched.state).selection).toEqual([edge("edge_b")]);
});

function referenceField(session: FeatureEditSessionState) {
  const field = getFeatureEditorFormSchema(session)
    .sections.flatMap((section) => section.fields)
    .find(
      (
        entry,
      ): entry is Extract<
        FeatureEditorFormField,
        { kind: "referenceCollection" }
      > => entry.kind === "referenceCollection",
    );
  if (!field) {
    throw new Error(`${session.featureType} has no reference collection.`);
  }
  return field;
}

function referencesOf(session: FeatureEditSessionState) {
  return referenceField(session).value;
}

function removalPatch(state: FeatureEditorState, target: PrimitiveRef) {
  return createFeatureEditorRemoveReferenceItemPatch(
    referenceField(state.session),
    target,
  );
}

function asFeatureEditor(state: { kind: string }): FeatureEditorState {
  if (state.kind !== "editingFeature") {
    throw new Error(`Expected feature editing, received ${state.kind}.`);
  }
  return state as FeatureEditorState;
}

function editingState(
  session: FeatureEditSessionState,
  selection: PrimitiveRef[],
): FeatureEditorState {
  return {
    ...initialEditorState,
    kind: "editingFeature",
    command: {
      commandSessionId: "command_feature-1" as CommandSessionId,
      toolId: session.featureType,
      phase: "editing",
    },
    document: {
      documentId: "doc_workspace",
      revisionId: "rev_1" as RevisionId,
    },
    selection,
    preview: null,
    previewRenderables: [previewRenderable()],
    session: { ...session, status: "previewReady" },
    activeReferencePickerFieldId: null,
    pendingPreviewRequestId: null as RequestId | null,
    pendingCommitRequestId: null,
  };
}

function previewRenderable(): RenderableEntityRecord {
  return {
    id: "preview_face" as RenderableId,
    label: "preview face",
    ownerBodyId: null,
    ownerFeatureId: null,
    binding: {
      pickId: "pick_preview_face" as PickId,
      pickPriority: 0,
      target: {
        kind: "face",
        bodyId: "body_preview" as BodyId,
        faceId: "face_preview" as FaceId,
      },
      topology: "face",
      semanticClass: "bodyFace",
    },
    geometry: createRenderMeshGeometry({
      vertexPositions: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
      ],
      vertexNormals: null,
      triangleIndices: [[0, 1, 2]],
    }),
  };
}
