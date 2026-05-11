import { test } from "bun:test";
import { expectTrue } from "@/testing/expect.spec";
import { readFileSync } from "node:fs";

import {
  applySelectionToFeatureEditSession,
  buildFeatureDefinition,
  createFeatureEditSession,
  getFeatureEditorFormSchema,
  hydrateFeatureEditSession,
  patchFeatureEditSession,
} from "@/domain/editor/feature-editing";
import {
  createFeatureEditorClearReferencePatch,
  createFeatureEditorFieldPatch,
  createFeatureEditorReferenceSelectionPatch,
  createFeatureEditorRemoveReferenceItemPatch,
} from "@/core/feature-authoring/form-events";
import { getRegisteredFeatureAuthoringDefinitions } from "@/core/feature-authoring/registry";
import type { FeatureAuthoringDefinition } from "@/core/feature-authoring/definition";
import type { FeatureEditorFormField } from "@/core/feature-authoring/form-schema";

test("src/domain/feature-authoring/registry.spec.ts", async () => {
  function findFormField(
    fields: readonly FeatureEditorFormField[],
    fieldId: string,
  ): FeatureEditorFormField | undefined {
    for (const field of fields) {
      if (field.id === fieldId) {
        return field;
      }

      if (field.kind === "optionGroup") {
        const nested = findFormField(field.fields, fieldId);
        if (nested) {
          return nested;
        }
      }

      if (field.kind === "discriminatedOptionGroup") {
        if (field.discriminant.id === fieldId) {
          return field.discriminant;
        }

        const nested = findFormField(
          field.variants.flatMap((variant) => variant.fields),
          fieldId,
        );
        if (nested) {
          return nested;
        }
      }
    }
  }

  function getFormField(
    session: Parameters<typeof getFeatureEditorFormSchema>[0],
    fieldId: string,
  ) {
    return findFormField(
      getFeatureEditorFormSchema(session).sections.flatMap(
        (section) => section.fields,
      ),
      fieldId,
    );
  }

  function testRegistryContainsCurrentFeatureSet() {
    const registeredKinds = getRegisteredFeatureAuthoringDefinitions()
      .map((definition) => definition.metadata.kind)
      .sort();

    expectTrue(
      JSON.stringify(registeredKinds) ===
        JSON.stringify([
          "chamfer",
          "combine",
          "deleteSolid",
          "extrude",
          "fillet",
          "loft",
          "mirror",
          "plane",
          "revolve",
          "shell",
          "split",
          "sweep",
          "thicken",
          "transform",
        ]),
      "The feature authoring registry should contain every current authored feature kind.",
    );
  }

  function testRevolveDraftSelectionAndDefinitionBuilder() {
    const initialSession = createFeatureEditSession({
      featureType: "revolve",
      selectedTarget: {
        kind: "region",
        sketchId: "sketch_a",
        regionId: "region_a",
      },
    });

    expectTrue(
      initialSession.featureType === "revolve",
      "Revolve activation should create a revolve authoring session.",
    );
    expectTrue(
      buildFeatureDefinition(initialSession) === null,
      "Revolve drafts without an axis should not build a modeling definition.",
    );

    const completedSession = applySelectionToFeatureEditSession(
      initialSession,
      {
        kind: "edge",
        bodyId: "body_a",
        edgeId: "edge_axis",
      },
    );
    const definition = buildFeatureDefinition(completedSession);

    expectTrue(
      definition?.kind === "revolve",
      "Completed revolve drafts should build a revolve modeling definition.",
    );
    expectTrue(
      definition.parameters.axis.kind === "edge",
      "The selected edge should become the revolve axis.",
    );
  }

  function testExtrudeBooleanTargetSelectorVisibilityAndScope() {
    const profile = {
      kind: "region" as const,
      sketchId: "sketch_a" as const,
      regionId: "region_a" as const,
    };
    const targetBodyA = {
      kind: "body" as const,
      bodyId: "body_target_a" as const,
    };
    const targetBodyB = {
      kind: "body" as const,
      bodyId: "body_target_b" as const,
    };
    const initialSession = createFeatureEditSession({
      featureType: "extrude",
      selectedTarget: profile,
    });
    const operationField = getFormField(initialSession, "extrude-operation");
    const hiddenTargetField = getFormField(
      initialSession,
      "extrude-target-bodies",
    );

    expectTrue(
      operationField?.kind === "enum",
      "Extrude schema should expose operation as a generic enum field.",
    );
    expectTrue(
      hiddenTargetField?.kind === "referenceCollection",
      "Extrude schema should expose boolean target bodies as a reference collection.",
    );
    expectTrue(
      hiddenTargetField.hidden === true,
      "Extrude should hide boolean target bodies for newBody operation.",
    );

    const joinSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorFieldPatch(operationField, "join"),
    );
    const visibleTargetField = getFormField(
      joinSession,
      "extrude-target-bodies",
    );

    expectTrue(
      visibleTargetField?.kind === "referenceCollection",
      "Extrude target bodies field should remain a reference collection.",
    );
    expectTrue(
      visibleTargetField.hidden !== true,
      "Extrude should show boolean target bodies for join operation.",
    );
    expectTrue(
      visibleTargetField.error?.message === "Select at least one target body.",
      "Extrude should mark missing boolean target bodies as invalid.",
    );
    expectTrue(
      buildFeatureDefinition(joinSession) === null,
      "Extrude boolean drafts without target bodies should not build a definition.",
    );

    const oneTargetSession = patchFeatureEditSession(
      joinSession,
      createFeatureEditorReferenceSelectionPatch(
        visibleTargetField,
        targetBodyA,
      ),
    );
    const oneTargetDefinition = buildFeatureDefinition(oneTargetSession);

    expectTrue(
      oneTargetDefinition?.kind === "extrude" &&
        oneTargetDefinition.parameters.operation === "join" &&
        oneTargetDefinition.parameters.booleanScope.kind === "targetBody" &&
        oneTargetDefinition.parameters.booleanScope.bodyId ===
          targetBodyA.bodyId,
      "Extrude boolean target selection should build a targetBody boolean scope.",
    );

    const twoTargetField = getFormField(
      oneTargetSession,
      "extrude-target-bodies",
    );
    expectTrue(
      twoTargetField?.kind === "referenceCollection",
      "Extrude target bodies field should hydrate selected target bodies.",
    );

    const twoTargetSession = patchFeatureEditSession(
      oneTargetSession,
      createFeatureEditorReferenceSelectionPatch(twoTargetField, targetBodyB),
    );
    const twoTargetDefinition = buildFeatureDefinition(twoTargetSession);

    expectTrue(
      twoTargetDefinition?.kind === "extrude" &&
        twoTargetDefinition.parameters.booleanScope.kind === "targetBodies" &&
        twoTargetDefinition.parameters.booleanScope.bodyIds.length === 2,
      "Extrude should preserve multiple selected boolean target bodies.",
    );

    const resetOperationField = getFormField(
      twoTargetSession,
      "extrude-operation",
    );
    expectTrue(
      resetOperationField?.kind === "enum",
      "Extrude operation field should remain available after target body selection.",
    );

    const resetSession = patchFeatureEditSession(
      twoTargetSession,
      createFeatureEditorFieldPatch(resetOperationField, "newBody"),
    );
    const resetDefinition = buildFeatureDefinition(resetSession);

    expectTrue(
      resetDefinition?.kind === "extrude" &&
        resetDefinition.parameters.booleanScope.kind === "standalone",
      "Extrude should reset boolean scope to standalone when switching back to newBody.",
    );
    expectTrue(
      getFormField(resetSession, "extrude-target-bodies")?.hidden === true,
      "Extrude should hide target bodies after switching back to newBody.",
    );
  }

  function testRevolveBooleanTargetSelectorVisibilityAndScope() {
    const profile = {
      kind: "region" as const,
      sketchId: "sketch_a" as const,
      regionId: "region_a" as const,
    };
    const axis = {
      kind: "edge" as const,
      bodyId: "body_axis" as const,
      edgeId: "edge_axis" as const,
    };
    const targetBody = {
      kind: "body" as const,
      bodyId: "body_target" as const,
    };
    const initialSession = applySelectionToFeatureEditSession(
      createFeatureEditSession({
        featureType: "revolve",
        selectedTarget: profile,
      }),
      axis,
    );
    const operationField = getFormField(initialSession, "revolve-operation");
    const hiddenTargetField = getFormField(
      initialSession,
      "revolve-target-bodies",
    );

    expectTrue(
      operationField?.kind === "enum",
      "Revolve schema should expose operation as a generic enum field.",
    );
    expectTrue(
      hiddenTargetField?.kind === "referenceCollection",
      "Revolve schema should expose boolean target bodies as a reference collection.",
    );
    expectTrue(
      hiddenTargetField.hidden === true,
      "Revolve should hide boolean target bodies for newBody operation.",
    );

    const cutSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorFieldPatch(operationField, "cut"),
    );
    const visibleTargetField = getFormField(
      cutSession,
      "revolve-target-bodies",
    );

    expectTrue(
      visibleTargetField?.kind === "referenceCollection",
      "Revolve target bodies field should remain a reference collection.",
    );
    expectTrue(
      visibleTargetField.hidden !== true,
      "Revolve should show boolean target bodies for cut operation.",
    );
    expectTrue(
      buildFeatureDefinition(cutSession) === null,
      "Revolve boolean drafts without target bodies should not build a definition.",
    );

    const targetSession = patchFeatureEditSession(
      cutSession,
      createFeatureEditorReferenceSelectionPatch(
        visibleTargetField,
        targetBody,
      ),
    );
    const definition = buildFeatureDefinition(targetSession);

    expectTrue(
      definition?.kind === "revolve" &&
        definition.parameters.operation === "cut" &&
        definition.parameters.booleanScope.kind === "targetBody" &&
        definition.parameters.booleanScope.bodyId === targetBody.bodyId,
      "Revolve boolean target selection should build a targetBody boolean scope.",
    );
  }

  function testSweepDraftSelectionAndDefinitionBuilder() {
    const profile = {
      kind: "region" as const,
      sketchId: "sketch_a" as const,
      regionId: "region_a" as const,
    };
    const path = {
      kind: "edge" as const,
      bodyId: "body_a" as const,
      edgeId: "edge_path" as const,
    };
    const lockFace = {
      kind: "face" as const,
      bodyId: "body_a" as const,
      faceId: "face_lock" as const,
    };
    const lockDirection = {
      kind: "construction" as const,
      constructionId: "construction_plane-xy" as const,
    };
    const targetBody = { kind: "body" as const, bodyId: "body_a" as const };
    const initialSession = createFeatureEditSession({
      featureType: "sweep",
      selectedTarget: profile,
    });

    expectTrue(
      initialSession.featureType === "sweep",
      "Sweep activation should create a sweep authoring session.",
    );
    expectTrue(
      buildFeatureDefinition(initialSession) === null,
      "Sweep drafts without a path should not build a modeling definition.",
    );

    const completedSession = applySelectionToFeatureEditSession(
      initialSession,
      path,
    );
    const definition = buildFeatureDefinition(completedSession);

    expectTrue(
      definition?.kind === "sweep",
      "Completed sweep drafts should build a sweep modeling definition.",
    );
    expectTrue(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "profile" && participant.targets[0] === profile,
      ),
      "Sweep definitions should preserve the selected profile participant role.",
    );
    expectTrue(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "path" && participant.targets[0] === path,
      ),
      "Sweep definitions should preserve the selected path participant role.",
    );
    expectTrue(
      definition.parameters.options?.profileControl === "none" &&
        definition.parameters.options.twist &&
        typeof definition.parameters.options.twist === "object" &&
        "type" in definition.parameters.options.twist &&
        definition.parameters.options.twist.type === "none" &&
        definition.parameters.options.endScale === 1,
      "Sweep definitions should include default advanced control options.",
    );

    const schema = getFeatureEditorFormSchema(completedSession);
    const operationField = schema.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "sweep-operation-intent");
    expectTrue(
      operationField?.kind === "enum",
      "Sweep form schema should expose operation intent as a generic enum field.",
    );
    const profileControlField = getFormField(
      completedSession,
      "sweep-profile-control",
    );
    expectTrue(
      profileControlField?.kind === "enum",
      "Sweep form schema should expose profile control as an enum field.",
    );
    const twistTypeField = getFormField(completedSession, "sweep-twist-type");
    expectTrue(
      twistTypeField?.kind === "enum",
      "Sweep form schema should expose twist type as a discriminant enum.",
    );
    const twistTurnsField = getFormField(completedSession, "sweep-twist-turns");
    expectTrue(
      twistTurnsField?.kind === "numeric",
      "Sweep form schema should expose turns twist as a numeric field.",
    );
    const endScaleField = getFormField(completedSession, "sweep-end-scale");
    expectTrue(
      endScaleField?.kind === "numeric",
      "Sweep form schema should expose end scale as a numeric field.",
    );
    const hiddenTargetBodiesField = schema.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "sweep-target-bodies");
    expectTrue(
      hiddenTargetBodiesField?.kind === "referenceCollection",
      "Sweep form schema should expose target bodies as a reference collection.",
    );
    expectTrue(
      hiddenTargetBodiesField.hidden === true,
      "Sweep should hide target bodies for create operation.",
    );

    const keepOrientationSession = patchFeatureEditSession(
      completedSession,
      createFeatureEditorFieldPatch(
        profileControlField,
        "keepProfileOrientation",
      ),
    );
    const keepOrientationDefinition = buildFeatureDefinition(
      keepOrientationSession,
    );
    expectTrue(
      keepOrientationDefinition?.kind === "sweep" &&
        keepOrientationDefinition.parameters.options?.profileControl ===
          "keepProfileOrientation",
      "Sweep authoring should preserve keep profile orientation control.",
    );

    const lockFacesSession = patchFeatureEditSession(
      completedSession,
      createFeatureEditorFieldPatch(profileControlField, "lockProfileFaces"),
    );
    expectTrue(
      buildFeatureDefinition(lockFacesSession) === null,
      "Lock profile faces should require at least one face target.",
    );
    const lockFacesField = getFormField(
      lockFacesSession,
      "sweep-lock-profile-faces",
    );
    expectTrue(
      lockFacesField?.kind === "referenceCollection" &&
        lockFacesField.hidden !== true,
      "Lock face picker should be visible for lockProfileFaces.",
    );
    const lockFacesCompletedSession = patchFeatureEditSession(
      lockFacesSession,
      createFeatureEditorReferenceSelectionPatch(lockFacesField, lockFace),
    );
    const lockFacesDefinition = buildFeatureDefinition(
      lockFacesCompletedSession,
    );
    expectTrue(
      lockFacesDefinition?.kind === "sweep" &&
        lockFacesDefinition.parameters.options?.profileControl ===
          "lockProfileFaces" &&
        lockFacesDefinition.parameters.participants.some(
          (participant) => participant.role === "lockProfileFace",
        ),
      "Sweep authoring should build lock profile face participants.",
    );

    const lockDirectionSession = patchFeatureEditSession(
      completedSession,
      createFeatureEditorFieldPatch(
        profileControlField,
        "lockProfileDirection",
      ),
    );
    expectTrue(
      buildFeatureDefinition(lockDirectionSession) === null,
      "Lock profile direction should require one direction target.",
    );
    const lockDirectionField = getFormField(
      lockDirectionSession,
      "sweep-lock-profile-direction",
    );
    expectTrue(
      lockDirectionField?.kind === "referencePicker" &&
        lockDirectionField.hidden !== true,
      "Lock direction picker should be visible for lockProfileDirection.",
    );
    const lockDirectionCompletedSession = patchFeatureEditSession(
      lockDirectionSession,
      createFeatureEditorReferenceSelectionPatch(
        lockDirectionField,
        lockDirection,
      ),
    );
    const lockDirectionDefinition = buildFeatureDefinition(
      lockDirectionCompletedSession,
    );
    expectTrue(
      lockDirectionDefinition?.kind === "sweep" &&
        lockDirectionDefinition.parameters.options?.profileControl ===
          "lockProfileDirection" &&
        lockDirectionDefinition.parameters.participants.some(
          (participant) => participant.role === "lockProfileDirection",
        ),
      "Sweep authoring should build lock profile direction participants.",
    );

    const twistTurnsSession = patchFeatureEditSession(
      patchFeatureEditSession(
        completedSession,
        createFeatureEditorFieldPatch(twistTypeField, "turns"),
      ),
      createFeatureEditorFieldPatch(twistTurnsField, 2),
    );
    const twistTurnsDefinition = buildFeatureDefinition(twistTurnsSession);
    expectTrue(
      twistTurnsDefinition?.kind === "sweep" &&
        twistTurnsDefinition.parameters.options?.twist &&
        typeof twistTurnsDefinition.parameters.options.twist === "object" &&
        "type" in twistTurnsDefinition.parameters.options.twist &&
        twistTurnsDefinition.parameters.options.twist.type === "turns" &&
        "turns" in twistTurnsDefinition.parameters.options.twist &&
        !("angle" in twistTurnsDefinition.parameters.options.twist),
      "Sweep buildDefinition should persist only the active twist variant.",
    );

    const subtractSession = patchFeatureEditSession(
      completedSession,
      createFeatureEditorFieldPatch(operationField, "subtract"),
    );
    expectTrue(
      buildFeatureDefinition(subtractSession) === null,
      "Boolean sweep drafts should require explicit target bodies.",
    );

    const targetBodiesField = getFeatureEditorFormSchema(subtractSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "sweep-target-bodies");
    expectTrue(
      targetBodiesField?.kind === "referenceCollection",
      "Sweep form schema should expose target bodies as a reference collection.",
    );
    expectTrue(
      targetBodiesField.hidden !== true,
      "Sweep should show target bodies for subtract operation.",
    );

    const booleanSession = patchFeatureEditSession(
      subtractSession,
      createFeatureEditorReferenceSelectionPatch(targetBodiesField, targetBody),
    );
    const booleanDefinition = buildFeatureDefinition(booleanSession);

    expectTrue(
      booleanSession.featureType === "sweep" &&
        booleanDefinition?.kind === "sweep" &&
        booleanDefinition.parameters.operationIntent === "subtract" &&
        booleanDefinition.parameters.participants.some(
          (participant) => participant.role === "targetBody",
        ),
      "Sweep boolean authoring should build operation intent and explicit targetBody participants.",
    );
  }

  function testSweepHydrationPreservesAuthoredAdvancedOptionsForEditing() {
    const hydrated = hydrateFeatureEditSession({
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_1",
      ownerFeatureId: "feature_sweep-1",
      ownerSketchId: null,
      ownerBodyId: null,
      featureId: "feature_sweep-1",
      label: "feature_sweep-1",
      definition: {
        kind: "sweep",
        featureTypeVersion: "advanced-solid-feature/v0",
        parameters: {
          operationIntent: "create",
          participants: [
            {
              role: "profile",
              targets: [
                { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
              ],
            },
            {
              role: "path",
              targets: [
                { kind: "edge", bodyId: "body_path", edgeId: "edge_path" },
              ],
            },
            {
              role: "lockProfileDirection",
              targets: [
                {
                  kind: "construction",
                  constructionId: "construction_plane-xy",
                },
              ],
            },
          ],
          options: {
            profileControl: {
              source: "literal",
              value: "lockProfileDirection",
            },
            twist: {
              type: "angle",
              angle: { source: "literal", value: Math.PI / 3 },
            },
            endScale: { source: "literal", value: 1.5 },
          },
        },
      },
      producedTargets: [{ kind: "body", bodyId: "body_sweep-1" }],
    });

    expectTrue(
      hydrated?.featureType === "sweep",
      "Sweep snapshots should hydrate into sweep edit sessions.",
    );

    const profileControlField = getFormField(hydrated, "sweep-profile-control");
    expectTrue(
      profileControlField?.kind === "enum" &&
        profileControlField.value === "lockProfileDirection",
      "Sweep hydration should unwrap authored profile control values for editing.",
    );

    const lockDirectionField = getFormField(
      hydrated,
      "sweep-lock-profile-direction",
    );
    expectTrue(
      lockDirectionField?.kind === "referencePicker" &&
        lockDirectionField.hidden !== true &&
        lockDirectionField.value?.kind === "construction",
      "Sweep hydration should preserve lock profile direction participants for editing.",
    );

    const twistTypeField = getFormField(hydrated, "sweep-twist-type");
    expectTrue(
      twistTypeField?.kind === "enum" && twistTypeField.value === "angle",
      "Sweep hydration should preserve authored twist variants for editing.",
    );

    const twistAngleField = getFormField(hydrated, "sweep-twist-angle");
    expectTrue(
      twistAngleField?.kind === "numeric" &&
        Math.abs(Number(twistAngleField.value) - 60) < 0.000001,
      "Sweep hydration should display authored angle twist values in degrees.",
    );

    const definition = buildFeatureDefinition(hydrated);
    expectTrue(
      definition?.kind === "sweep" &&
        definition.parameters.options?.profileControl ===
          "lockProfileDirection" &&
        definition.parameters.options.twist &&
        typeof definition.parameters.options.twist === "object" &&
        "type" in definition.parameters.options.twist &&
        definition.parameters.options.twist.type === "angle" &&
        "angle" in definition.parameters.options.twist &&
        Math.abs(
          Number(definition.parameters.options.twist.angle) - Math.PI / 3,
        ) < 0.000001 &&
        definition.parameters.options.endScale === 1.5,
      "Hydrated sweep authored advanced options should rebuild as durable definition values.",
    );
  }

  function testChamferDraftSelectionDistanceAndDefinitionBuilder() {
    const edgeA = {
      kind: "edge" as const,
      bodyId: "body_a" as const,
      edgeId: "edge_a" as const,
    };
    const edgeB = {
      kind: "edge" as const,
      bodyId: "body_a" as const,
      edgeId: "edge_b" as const,
    };
    const initialSession = createFeatureEditSession({
      featureType: "chamfer",
      selectedTarget: edgeA,
    });

    expectTrue(
      initialSession.featureType === "chamfer",
      "Chamfer activation should create a chamfer authoring session.",
    );

    const edgesField = getFeatureEditorFormSchema(initialSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "chamfer-edges");
    expectTrue(
      edgesField?.kind === "referenceCollection",
      "Chamfer form schema should expose selected edges as a reference collection.",
    );
    expectTrue(
      edgesField.advancedParticipant?.role === "edge",
      "Chamfer edge field should expose the edge participant role.",
    );

    const multiEdgeSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorReferenceSelectionPatch(edgesField, edgeB),
    );
    const distanceField = getFeatureEditorFormSchema(multiEdgeSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "chamfer-distance");
    expectTrue(
      distanceField?.kind === "numeric",
      "Chamfer form schema should expose distance as a numeric field.",
    );

    const completedSession = patchFeatureEditSession(
      multiEdgeSession,
      createFeatureEditorFieldPatch(distanceField, 0.75),
    );
    const definition = buildFeatureDefinition(completedSession);

    expectTrue(
      definition?.kind === "chamfer",
      "Completed chamfer drafts should build a chamfer advanced-solid definition.",
    );
    expectTrue(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "edge" && participant.targets.length === 2,
      ),
      "Chamfer definitions should preserve explicit edge participants.",
    );
    expectTrue(
      definition.parameters.options?.distance === 0.75,
      "Chamfer definitions should preserve the constant distance option.",
    );

    const invalidDistanceSession = patchFeatureEditSession(
      completedSession,
      createFeatureEditorFieldPatch(distanceField, 0),
    );
    expectTrue(
      buildFeatureDefinition(invalidDistanceSession) === null,
      "Chamfer drafts with non-positive distance should not build a definition.",
    );
  }

  function testLoftDraftSelectionReorderingAndDefinitionBuilder() {
    const profileA = {
      kind: "region" as const,
      sketchId: "sketch_a" as const,
      regionId: "region_a" as const,
    };
    const profileB = {
      kind: "face" as const,
      bodyId: "body_b" as const,
      faceId: "face_b" as const,
    };
    const profileC = {
      kind: "region" as const,
      sketchId: "sketch_c" as const,
      regionId: "region_c" as const,
    };
    const path = {
      kind: "edge" as const,
      bodyId: "body_path" as const,
      edgeId: "edge_path" as const,
    };
    const guideCurve = {
      kind: "edge" as const,
      bodyId: "body_path" as const,
      edgeId: "edge_guide" as const,
    };
    const initialSession = createFeatureEditSession({
      featureType: "loft",
      selectedTarget: profileA,
    });

    expectTrue(
      initialSession.featureType === "loft",
      "Loft activation should create a loft authoring session.",
    );
    expectTrue(
      buildFeatureDefinition(initialSession) === null,
      "Loft drafts with fewer than two profiles should not build a modeling definition.",
    );

    const twoProfileSession = patchFeatureEditSession(initialSession, {
      profileTargets: [profileA, profileB, profileC],
    });
    const profilesField = getFeatureEditorFormSchema(twoProfileSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "loft-profiles");

    expectTrue(
      profilesField?.kind === "referenceCollection",
      "Loft form schema should expose ordered profiles as a reference collection.",
    );
    expectTrue(
      profilesField.ordering?.moveUpPatchKey === "moveProfileTargetEarlier",
      "Loft profiles should expose explicit reordering controls.",
    );

    const reorderedSession = patchFeatureEditSession(twoProfileSession, {
      moveProfileTargetEarlier: profileC,
    });
    const guideField = getFeatureEditorFormSchema(reorderedSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "loft-guide-curves");
    expectTrue(
      guideField?.kind === "referenceCollection",
      "Loft form schema should expose guide curves as a reference collection.",
    );
    const pathField = getFormField(reorderedSession, "loft-path");
    expectTrue(
      pathField?.kind === "referencePicker",
      "Loft form schema should expose path as a single reference picker.",
    );
    const pathSession = patchFeatureEditSession(
      reorderedSession,
      createFeatureEditorReferenceSelectionPatch(pathField, path),
    );
    const pathDefinition = buildFeatureDefinition(pathSession);
    expectTrue(
      pathDefinition?.kind === "loft" &&
        pathDefinition.parameters.participants.some(
          (participant) =>
            participant.role === "path" && participant.targets[0] === path,
        ) &&
        (
          pathDefinition.parameters.options?.path as
            | { sectionCount?: unknown }
            | undefined
        )?.sectionCount === 5,
      "Loft definitions should preserve path separately from guide curves and default path section count to 5.",
    );
    const sectionCountField = getFormField(pathSession, "loft-section-count");
    expectTrue(
      sectionCountField?.kind === "numeric",
      "Loft path options should expose section count as a numeric field.",
    );
    const explicitSectionSession = patchFeatureEditSession(
      pathSession,
      createFeatureEditorFieldPatch(sectionCountField, 7),
    );
    const explicitSectionDefinition = buildFeatureDefinition(
      explicitSectionSession,
    );
    expectTrue(
      explicitSectionDefinition?.kind === "loft" &&
        (
          explicitSectionDefinition.parameters.options?.path as
            | { sectionCount?: unknown }
            | undefined
        )?.sectionCount === 7,
      "Loft definitions should preserve explicit path section count.",
    );

    const guideSession = patchFeatureEditSession(
      reorderedSession,
      createFeatureEditorReferenceSelectionPatch(guideField, guideCurve),
    );
    const definition = buildFeatureDefinition(guideSession);

    expectTrue(
      definition?.kind === "loft",
      "Completed loft drafts should build a loft modeling definition.",
    );
    expectTrue(
      definition.parameters.participants.find(
        (participant) => participant.role === "profile",
      )?.targets[1] === profileC,
      "Loft definitions should preserve the explicit reordered profile sequence.",
    );
    expectTrue(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "guideCurve" &&
          participant.targets[0] === guideCurve,
      ),
      "Loft definitions should preserve optional guide-curve participants.",
    );
    const guideContinuityField = getFormField(
      guideSession,
      "loft-guide-continuity",
    );
    expectTrue(
      guideContinuityField?.kind === "enum",
      "Loft guide options should expose guide continuity as an enum field.",
    );
    const guideContinuitySession = patchFeatureEditSession(
      guideSession,
      createFeatureEditorFieldPatch(guideContinuityField, "normalToGuide"),
    );
    const guideContinuityDefinition = buildFeatureDefinition(
      guideContinuitySession,
    );
    expectTrue(
      guideContinuityDefinition?.kind === "loft" &&
        guideContinuityDefinition.parameters.options?.guideContinuity ===
          "normalToGuide",
      "Loft definitions should preserve guide continuity controls.",
    );
    const startConditionField = getFormField(
      guideSession,
      "loft-start-condition",
    );
    expectTrue(
      startConditionField?.kind === "enum",
      "Loft profile options should expose start condition as an enum field.",
    );
    const startMagnitudeField = getFormField(
      patchFeatureEditSession(
        guideSession,
        createFeatureEditorFieldPatch(startConditionField, "normal"),
      ),
      "loft-start-condition-magnitude",
    );
    expectTrue(
      startMagnitudeField?.kind === "numeric" &&
        startMagnitudeField.hidden !== true,
      "Loft normal start condition should expose magnitude.",
    );

    const createOperationField = getFormField(
      guideSession,
      "loft-operation-intent",
    );
    const hiddenTargetBodiesField = getFormField(
      guideSession,
      "loft-target-bodies",
    );
    expectTrue(
      createOperationField?.kind === "enum",
      "Loft schema should expose operation intent as a generic enum field.",
    );
    expectTrue(
      hiddenTargetBodiesField?.kind === "referenceCollection",
      "Loft form schema should expose target bodies as a reference collection.",
    );
    expectTrue(
      hiddenTargetBodiesField.hidden === true,
      "Loft should hide target bodies for create operation.",
    );

    const addSession = patchFeatureEditSession(
      guideSession,
      createFeatureEditorFieldPatch(createOperationField, "add"),
    );
    const visibleTargetBodiesField = getFormField(
      addSession,
      "loft-target-bodies",
    );
    expectTrue(
      visibleTargetBodiesField?.kind === "referenceCollection",
      "Loft target bodies field should remain a reference collection.",
    );
    expectTrue(
      visibleTargetBodiesField.hidden !== true,
      "Loft should show target bodies for add operation.",
    );
  }

  function testLoftHydrationPreservesOrderedProfilesForEditing() {
    const hydrated = hydrateFeatureEditSession({
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_1",
      ownerFeatureId: "feature_loft-1",
      ownerSketchId: null,
      ownerBodyId: null,
      featureId: "feature_loft-1",
      label: "feature_loft-1",
      definition: {
        kind: "loft",
        featureTypeVersion: "advanced-solid-feature/v0",
        parameters: {
          operationIntent: "create",
          participants: [
            {
              role: "profile",
              targets: [
                { kind: "face", bodyId: "body_b", faceId: "face_b" },
                { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
              ],
            },
            {
              role: "path",
              targets: [
                { kind: "edge", bodyId: "body_path", edgeId: "edge_path" },
              ],
            },
            {
              role: "guideCurve",
              targets: [{ kind: "edge", bodyId: "body_g", edgeId: "edge_g" }],
            },
          ],
          options: {
            path: { sectionCount: 8 },
            guideContinuity: "normalToGuide",
            profileConditions: {
              startCondition: "normal",
              startMagnitude: 1.25,
              endCondition: "none",
              endMagnitude: 1,
            },
          },
        },
      },
      producedTargets: [{ kind: "body", bodyId: "body_loft-1" }],
    });

    expectTrue(
      hydrated?.featureType === "loft",
      "Loft snapshots should hydrate into loft edit sessions.",
    );
    expectTrue(
      hydrated?.draft.profileTargets[0]?.kind === "face" &&
        hydrated.draft.profileTargets[1]?.kind === "region",
      "Loft hydration should preserve ordered profile targets for edit sessions.",
    );
    expectTrue(
      hydrated?.draft.guideCurveTargets[0]?.kind === "edge",
      "Loft hydration should preserve guide-curve participants for edit sessions.",
    );
    expectTrue(
      hydrated?.draft.pathTarget?.kind === "edge" &&
        hydrated.draft.options.path?.sectionCount === 8 &&
        hydrated.draft.options.guideContinuity === "normalToGuide",
      "Loft hydration should preserve path and guide continuity options for edit sessions.",
    );
  }

  function testThickenDraftSelectionOptionsAndDefinitionBuilder() {
    const faceA = {
      kind: "face" as const,
      bodyId: "body_a" as const,
      faceId: "face_a" as const,
    };
    const faceB = {
      kind: "face" as const,
      bodyId: "body_a" as const,
      faceId: "face_b" as const,
    };
    const targetBody = {
      kind: "body" as const,
      bodyId: "body_target" as const,
    };
    const initialSession = createFeatureEditSession({
      featureType: "thicken",
      selectedTarget: faceA,
    });

    expectTrue(
      initialSession.featureType === "thicken",
      "Thicken activation should create a thicken authoring session.",
    );

    const facesField = getFeatureEditorFormSchema(initialSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "thicken-faces");
    expectTrue(
      facesField?.kind === "referenceCollection",
      "Thicken form schema should expose selected faces as a reference collection.",
    );
    expectTrue(
      facesField.advancedParticipant?.role === "face",
      "Thicken face field should expose the face participant role.",
    );

    const multiFaceSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorReferenceSelectionPatch(facesField, faceB),
    );
    const thicknessField = getFeatureEditorFormSchema(multiFaceSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "thicken-thickness");
    const operationField = getFeatureEditorFormSchema(multiFaceSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "thicken-operation-intent");

    expectTrue(
      thicknessField?.kind === "numeric",
      "Thicken form schema should expose thickness as a numeric field.",
    );
    expectTrue(
      operationField?.kind === "enum",
      "Thicken form schema should expose operation intent as a generic enum field.",
    );
    const hiddenTargetBodiesField = getFormField(
      multiFaceSession,
      "thicken-target-bodies",
    );
    expectTrue(
      hiddenTargetBodiesField?.kind === "referenceCollection",
      "Thicken form schema should expose target bodies as a reference collection.",
    );
    expectTrue(
      hiddenTargetBodiesField.hidden === true,
      "Thicken should hide target bodies for create operation.",
    );

    const subtractSession = patchFeatureEditSession(
      patchFeatureEditSession(
        patchFeatureEditSession(
          multiFaceSession,
          createFeatureEditorFieldPatch(thicknessField, 1.25),
        ),
        createFeatureEditorFieldPatch(operationField, "subtract"),
      ),
      { side: "symmetric" },
    );
    expectTrue(
      buildFeatureDefinition(subtractSession) === null,
      "Boolean thicken drafts should require explicit target bodies.",
    );

    const targetBodiesField = getFeatureEditorFormSchema(subtractSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "thicken-target-bodies");
    expectTrue(
      targetBodiesField?.kind === "referenceCollection",
      "Thicken form schema should expose target bodies as a reference collection.",
    );
    expectTrue(
      targetBodiesField.hidden !== true,
      "Thicken should show target bodies for subtract operation.",
    );

    const completeSession = patchFeatureEditSession(
      subtractSession,
      createFeatureEditorReferenceSelectionPatch(targetBodiesField, targetBody),
    );
    const definition = buildFeatureDefinition(completeSession);

    expectTrue(
      definition?.kind === "thicken",
      "Completed thicken drafts should build a thicken advanced-solid definition.",
    );
    expectTrue(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "face" && participant.targets.length === 2,
      ),
      "Thicken definitions should preserve explicit face participants.",
    );
    expectTrue(
      definition.parameters.options?.thickness === 1.25,
      "Thicken definitions should preserve the thickness option.",
    );
    expectTrue(
      definition.parameters.options?.side === "symmetric",
      "Thicken definitions should preserve the side option.",
    );
    expectTrue(
      definition.parameters.participants.some(
        (participant) => participant.role === "targetBody",
      ),
      "Thicken boolean authoring should build explicit targetBody participants.",
    );
  }

  function testThickenHydrationPreservesFaceTargetsAndOptions() {
    const hydrated = hydrateFeatureEditSession({
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_1",
      ownerFeatureId: "feature_thicken-1",
      ownerSketchId: null,
      ownerBodyId: null,
      featureId: "feature_thicken-1",
      label: "feature_thicken-1",
      definition: {
        kind: "thicken",
        featureTypeVersion: "advanced-solid-feature/v0",
        parameters: {
          operationIntent: "create",
          participants: [
            {
              role: "face",
              targets: [
                { kind: "face", bodyId: "body_a", faceId: "face_a" },
                { kind: "face", bodyId: "body_a", faceId: "face_b" },
              ],
            },
          ],
          options: { thickness: 2, side: "symmetric" },
        },
      },
      producedTargets: [{ kind: "body", bodyId: "body_thicken-1" }],
    });

    expectTrue(
      hydrated?.featureType === "thicken",
      "Thicken snapshots should hydrate into thicken edit sessions.",
    );
    expectTrue(
      hydrated?.draft.faceTargets.length === 2,
      "Thicken hydration should preserve face participants for edit sessions.",
    );
    expectTrue(
      hydrated?.draft.options.thickness === 2,
      "Thicken hydration should preserve thickness.",
    );
    expectTrue(
      hydrated?.draft.options.side === "symmetric",
      "Thicken hydration should preserve side.",
    );
  }

  function testSplitDraftSelectionAndDefinitionBuilder() {
    const targetBody = {
      kind: "body" as const,
      bodyId: "body_target" as const,
    };
    const toolBody = { kind: "body" as const, bodyId: "body_tool" as const };
    const initialSession = createFeatureEditSession({
      featureType: "split",
      selectedTarget: targetBody,
    });

    expectTrue(
      initialSession.featureType === "split",
      "Split activation should create a split authoring session.",
    );
    expectTrue(
      buildFeatureDefinition(initialSession) === null,
      "Split drafts without a tool body should not build a modeling definition.",
    );

    const targetField = getFeatureEditorFormSchema(initialSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "split-target-body");
    const toolField = getFeatureEditorFormSchema(initialSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "split-tool-body");

    expectTrue(
      targetField?.kind === "referencePicker",
      "Split form schema should expose the target body as a reference picker.",
    );
    expectTrue(
      toolField?.kind === "referencePicker",
      "Split form schema should expose the tool body as a reference picker.",
    );
    expectTrue(
      targetField.advancedParticipant?.role === "targetBody",
      "Split target field should expose the targetBody participant role.",
    );
    expectTrue(
      toolField.advancedParticipant?.role === "toolBody",
      "Split tool field should expose the toolBody participant role.",
    );

    const completedSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorReferenceSelectionPatch(toolField, toolBody),
    );
    const definition = buildFeatureDefinition(completedSession);

    expectTrue(
      definition?.kind === "split",
      "Completed split drafts should build a split advanced-solid definition.",
    );
    expectTrue(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "targetBody" &&
          participant.targets[0] === targetBody,
      ),
      "Split definitions should preserve the explicit target body participant.",
    );
    expectTrue(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "toolBody" &&
          participant.targets[0] === toolBody,
      ),
      "Split definitions should preserve the explicit tool body participant.",
    );
  }

  function testCombineDraftSelectionOperationAndHydration() {
    const targetBody = {
      kind: "body" as const,
      bodyId: "body_target" as const,
    };
    const toolBody = { kind: "body" as const, bodyId: "body_tool" as const };
    const secondToolBody = {
      kind: "body" as const,
      bodyId: "body_tool_2" as const,
    };
    const initialSession = createFeatureEditSession({
      featureType: "combine",
      selectedTarget: targetBody,
    });

    expectTrue(
      initialSession.featureType === "combine",
      "Combine activation should create a combine authoring session.",
    );
    expectTrue(
      buildFeatureDefinition(initialSession) === null,
      "Combine drafts without tool bodies should not build a modeling definition.",
    );

    const targetField = getFormField(initialSession, "combine-target-bodies");
    const toolField = getFormField(initialSession, "combine-tool-bodies");
    const operationField = getFormField(
      initialSession,
      "combine-operation-intent",
    );

    expectTrue(
      targetField?.kind === "referenceCollection",
      "Combine should expose target bodies as a reference collection.",
    );
    expectTrue(
      toolField?.kind === "referenceCollection",
      "Combine should expose tool bodies as a reference collection.",
    );
    expectTrue(
      operationField?.kind === "enum",
      "Combine should expose operation intent as a generic enum field.",
    );

    const withTool = patchFeatureEditSession(
      initialSession,
      createFeatureEditorReferenceSelectionPatch(toolField, toolBody),
    );
    const intersectSession = patchFeatureEditSession(
      withTool,
      createFeatureEditorFieldPatch(
        getFormField(withTool, "combine-operation-intent"),
        "intersect",
      ),
    );
    const withSecondTool = patchFeatureEditSession(
      intersectSession,
      createFeatureEditorReferenceSelectionPatch(
        getFormField(intersectSession, "combine-tool-bodies"),
        secondToolBody,
      ),
    );
    const definition = buildFeatureDefinition(withSecondTool);

    expectTrue(
      definition?.kind === "combine",
      "Completed Combine drafts should build a combine advanced-solid definition.",
    );
    expectTrue(
      definition.parameters.operationIntent === "intersect",
      "Combine definitions should preserve the explicit operation intent.",
    );
    expectTrue(
      definition.parameters.participants.find(
        (participant) => participant.role === "targetBody",
      )?.targets[0] === targetBody,
      "Combine definitions should preserve explicit targetBody participants.",
    );
    expectTrue(
      definition.parameters.participants.find(
        (participant) => participant.role === "toolBody",
      )?.targets.length === 2,
      "Combine definitions should preserve explicit toolBody collections.",
    );

    const hydrated = hydrateFeatureEditSession({
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: "feature_combine-1",
      ownerSketchId: null,
      ownerBodyId: null,
      featureId: "feature_combine-1",
      label: "feature_combine-1",
      definition,
      producedTargets: [{ kind: "body", bodyId: "body_target" }],
    });

    expectTrue(
      hydrated?.featureType === "combine",
      "Combine snapshots should hydrate into combine edit sessions.",
    );
    expectTrue(
      hydrated.draft.targetBodyTargets.length === 1,
      "Combine hydration should preserve target bodies.",
    );
    expectTrue(
      hydrated.draft.toolBodyTargets.length === 2,
      "Combine hydration should preserve tool bodies.",
    );
    expectTrue(
      hydrated.draft.operationIntent === "intersect",
      "Combine hydration should preserve operation intent.",
    );
  }

  function testDeleteSolidDraftSelectionAndHydration() {
    const bodyA = { kind: "body" as const, bodyId: "body_a" as const };
    const bodyB = { kind: "body" as const, bodyId: "body_b" as const };
    const initialSession = createFeatureEditSession({
      featureType: "deleteSolid",
      selectedTarget: bodyA,
    });

    expectTrue(
      initialSession.featureType === "deleteSolid",
      "Delete-solid activation should create a delete-solid authoring session.",
    );

    const bodiesField = getFeatureEditorFormSchema(initialSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "delete-solid-bodies");
    expectTrue(
      bodiesField?.kind === "referenceCollection",
      "Delete-solid form schema should expose the body targets as a reference collection.",
    );
    expectTrue(
      bodiesField.advancedParticipant?.role === "body",
      "Delete-solid body field should expose the body participant role.",
    );

    const completeSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorReferenceSelectionPatch(bodiesField, bodyB),
    );
    const definition = buildFeatureDefinition(completeSession);

    expectTrue(
      definition?.kind === "deleteSolid",
      "Completed delete-solid drafts should build a delete-solid advanced-solid definition.",
    );
    expectTrue(
      definition.parameters.participants[0]?.targets.length === 2,
      "Delete-solid definitions should preserve the selected body collection.",
    );

    const hydrated = hydrateFeatureEditSession({
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_1",
      ownerFeatureId: "feature_delete-solid-1",
      ownerSketchId: null,
      ownerBodyId: null,
      featureId: "feature_delete-solid-1",
      label: "feature_delete-solid-1",
      definition: {
        kind: "deleteSolid",
        featureTypeVersion: "advanced-solid-feature/v0",
        parameters: {
          participants: [
            {
              role: "body",
              targets: [bodyA, bodyB],
            },
          ],
        },
      },
      producedTargets: [],
    });

    expectTrue(
      hydrated?.featureType === "deleteSolid",
      "Delete-solid snapshots should hydrate into delete-solid edit sessions.",
    );
    expectTrue(
      hydrated?.draft.bodyTargets.length === 2,
      "Delete-solid hydration should preserve explicit body targets.",
    );
  }

  function testMirrorDraftSelectionOptionHandlingAndHydration() {
    const bodyA = { kind: "body" as const, bodyId: "body_a" as const };
    const bodyB = { kind: "body" as const, bodyId: "body_b" as const };
    const plane = {
      kind: "construction" as const,
      constructionId: "construction_plane-xy" as const,
    };
    const initialSession = createFeatureEditSession({
      featureType: "mirror",
      selectedTarget: bodyA,
    });

    expectTrue(
      initialSession.featureType === "mirror",
      "Mirror activation should create a mirror authoring session.",
    );

    const schema = getFeatureEditorFormSchema(initialSession);
    const bodiesField = schema.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "mirror-bodies");
    const planeField = schema.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "mirror-plane");
    const modeField = schema.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "mirror-copy-mode");

    expectTrue(
      bodiesField?.kind === "referenceCollection",
      "Mirror should expose body targets as a reference collection.",
    );
    expectTrue(
      planeField?.kind === "referencePicker",
      "Mirror should expose the mirror plane as a reference picker.",
    );
    expectTrue(
      modeField?.kind === "enum",
      "Mirror should expose the copy policy as a generic enum field.",
    );

    const withSecondBody = patchFeatureEditSession(
      initialSession,
      createFeatureEditorReferenceSelectionPatch(bodiesField, bodyB),
    );
    const withPlane = patchFeatureEditSession(
      withSecondBody,
      createFeatureEditorReferenceSelectionPatch(
        getFeatureEditorFormSchema(withSecondBody)
          .sections.flatMap((section) => section.fields)
          .find((field) => field.id === "mirror-plane") as typeof planeField,
        plane,
      ),
    );
    const completed = patchFeatureEditSession(
      withPlane,
      createFeatureEditorFieldPatch(
        getFeatureEditorFormSchema(withPlane)
          .sections.flatMap((section) => section.fields)
          .find((field) => field.id === "mirror-copy-mode") as typeof modeField,
        "copy",
      ),
    );
    const definition = buildFeatureDefinition(completed);

    expectTrue(
      definition?.kind === "mirror",
      "Completed mirror drafts should build a mirror advanced-solid definition.",
    );
    expectTrue(
      definition.parameters.participants.find(
        (participant) => participant.role === "body",
      )?.targets.length === 2,
      "Mirror definitions should preserve explicit body targets.",
    );
    expectTrue(
      definition.parameters.participants.find(
        (participant) => participant.role === "plane",
      )?.targets[0] === plane,
      "Mirror definitions should preserve the explicit mirror plane.",
    );
    expectTrue(
      definition.parameters.options?.copy === true,
      "Mirror definitions should preserve the copy policy option.",
    );

    const hydrated = hydrateFeatureEditSession({
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_1",
      ownerFeatureId: "feature_mirror-1",
      ownerSketchId: null,
      ownerBodyId: null,
      featureId: "feature_mirror-1",
      label: "feature_mirror-1",
      definition: {
        kind: "mirror",
        featureTypeVersion: "advanced-solid-feature/v0",
        parameters: {
          participants: [
            { role: "body", targets: [bodyA, bodyB] },
            { role: "plane", targets: [plane] },
          ],
          options: { copy: true },
        },
      },
      producedTargets: [{ kind: "body", bodyId: "body_mirror-1" }],
    });

    expectTrue(
      hydrated?.featureType === "mirror",
      "Mirror snapshots should hydrate into mirror edit sessions.",
    );
    expectTrue(
      hydrated?.draft.bodyTargets.length === 2,
      "Mirror hydration should preserve explicit body targets.",
    );
    expectTrue(
      hydrated?.draft.planeTarget?.kind === "construction",
      "Mirror hydration should preserve the explicit plane reference.",
    );
  }

  function testTransformDraftSelectionAndDefinitionBuilder() {
    const bodyA = { kind: "body" as const, bodyId: "body_a" as const };
    const bodyB = { kind: "body" as const, bodyId: "body_b" as const };
    const plane = {
      kind: "face" as const,
      bodyId: "body_plane" as const,
      faceId: "face_plane" as const,
    };
    const initialSession = createFeatureEditSession({
      featureType: "transform",
      selectedTarget: bodyA,
    });

    expectTrue(
      initialSession.featureType === "transform",
      "Transform activation should create a transform authoring session.",
    );
    expectTrue(
      buildFeatureDefinition(initialSession) === null,
      "Transform drafts without an explicit reference should not build a modeling definition.",
    );

    const schema = getFeatureEditorFormSchema(initialSession);
    const bodiesField = schema.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "transform-bodies");
    const referenceField = schema.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "transform-reference");
    const distanceField = schema.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "transform-distance");

    expectTrue(
      bodiesField?.kind === "referenceCollection",
      "Transform should expose body targets as a reference collection.",
    );
    expectTrue(
      referenceField?.kind === "referencePicker",
      "Transform should expose the transform reference as a reference picker.",
    );
    expectTrue(
      distanceField?.kind === "numeric",
      "Transform should expose the translation distance as a numeric field.",
    );

    const withSecondBody = patchFeatureEditSession(
      initialSession,
      createFeatureEditorReferenceSelectionPatch(bodiesField, bodyB),
    );
    const withReference = patchFeatureEditSession(
      withSecondBody,
      createFeatureEditorReferenceSelectionPatch(
        getFeatureEditorFormSchema(withSecondBody)
          .sections.flatMap((section) => section.fields)
          .find(
            (field) => field.id === "transform-reference",
          ) as typeof referenceField,
        plane,
      ),
    );
    const completed = patchFeatureEditSession(
      withReference,
      createFeatureEditorFieldPatch(
        getFeatureEditorFormSchema(withReference)
          .sections.flatMap((section) => section.fields)
          .find(
            (field) => field.id === "transform-distance",
          ) as typeof distanceField,
        2.5,
      ),
    );
    const definition = buildFeatureDefinition(completed);

    expectTrue(
      definition?.kind === "transform",
      "Completed transform drafts should build a transform advanced-solid definition.",
    );
    expectTrue(
      definition.parameters.participants.find(
        (participant) => participant.role === "body",
      )?.targets.length === 2,
      "Transform definitions should preserve explicit body targets.",
    );
    expectTrue(
      definition.parameters.participants.find(
        (participant) => participant.role === "transformReference",
      )?.targets[0] === plane,
      "Transform definitions should preserve the explicit transform reference.",
    );
    expectTrue(
      definition.parameters.options?.distance === 2.5,
      "Transform definitions should preserve the typed distance option.",
    );
  }

  function testProfileBasedAuthoringUsesReferenceCollections() {
    const profileA = {
      kind: "region" as const,
      sketchId: "sketch_a" as const,
      regionId: "region_a" as const,
    };
    const profileB = {
      kind: "region" as const,
      sketchId: "sketch_a" as const,
      regionId: "region_b" as const,
    };
    const extrudeSession = createFeatureEditSession({
      featureType: "extrude",
      selectedTarget: profileA,
    });
    const extrudeProfileField = getFeatureEditorFormSchema(extrudeSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "extrude-profile");

    expectTrue(
      extrudeProfileField?.kind === "referenceCollection",
      "Extrude schema should expose profiles as a reference collection.",
    );
    expectTrue(
      extrudeProfileField.picker.allowsMultiple,
      "Extrude profile picker should allow multiple profile references.",
    );

    const extrudeMulti = patchFeatureEditSession(
      extrudeSession,
      createFeatureEditorReferenceSelectionPatch(extrudeProfileField, profileB),
    );
    const extrudeDefinition = buildFeatureDefinition(extrudeMulti);

    expectTrue(
      extrudeMulti.featureType === "extrude" &&
        extrudeDefinition?.kind === "extrude" &&
        extrudeDefinition.parameters.profiles.length === 2,
      "Extrude authoring should build multi-profile contract payloads from collection fields.",
    );

    const revolveSession = createFeatureEditSession({
      featureType: "revolve",
      selectedTarget: profileA,
    });
    const revolveProfileField = getFeatureEditorFormSchema(revolveSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "revolve-profile");

    expectTrue(
      revolveProfileField?.kind === "referenceCollection",
      "Revolve schema should expose profiles as a reference collection.",
    );
    expectTrue(
      revolveProfileField.picker.allowsMultiple,
      "Revolve profile picker should allow multiple profile references.",
    );

    const revolveMulti = patchFeatureEditSession(
      revolveSession,
      createFeatureEditorReferenceSelectionPatch(revolveProfileField, profileB),
    );
    const revolveComplete = applySelectionToFeatureEditSession(revolveMulti, {
      kind: "edge",
      bodyId: "body_a",
      edgeId: "edge_axis",
    });
    const revolveDefinition = buildFeatureDefinition(revolveComplete);

    expectTrue(
      revolveComplete.featureType === "revolve" &&
        revolveDefinition?.kind === "revolve" &&
        revolveDefinition.parameters.profiles.length === 2,
      "Revolve authoring should build multi-profile contract payloads while keeping the axis separate.",
    );
  }

  function testShellOwnsFaceSelectionDefaultsAndFormSchema() {
    const selectedFace = {
      kind: "face" as const,
      bodyId: "body_a" as const,
      faceId: "face_top" as const,
    };
    const session = createFeatureEditSession({
      featureType: "shell",
      selectedTarget: selectedFace,
    });

    expectTrue(
      session.featureType === "shell",
      "Shell activation should create a shell authoring session.",
    );
    expectTrue(
      session.draft.bodyTarget?.bodyId === "body_a",
      "Shell should infer the source body from the selected removable face.",
    );
    expectTrue(
      session.draft.faceTargets.length === 1,
      "Shell should seed removable faces from the selected face.",
    );
    expectTrue(
      session.draft.operation === "intersect",
      "Shell should default to intersect instead of creating a new body.",
    );
    expectTrue(
      session.draft.booleanScope.kind === "targetBody" &&
        session.draft.booleanScope.bodyId === "body_a",
      "Shell should default the boolean target to the selected source body.",
    );

    const selectionAfterActivationSession = applySelectionToFeatureEditSession(
      createFeatureEditSession({ featureType: "shell", selectedTarget: null }),
      selectedFace,
    );

    expectTrue(
      selectionAfterActivationSession.featureType === "shell" &&
        selectionAfterActivationSession.draft.booleanScope.kind ===
          "targetBody" &&
        selectionAfterActivationSession.draft.booleanScope.bodyId === "body_a",
      "Shell face selection should seed the default intersect target after command activation.",
    );

    const schema = getFeatureEditorFormSchema(session);
    const fieldIds = schema.sections.flatMap((section) =>
      section.fields.map((field) => field.id),
    );

    expectTrue(
      fieldIds.includes("shell-thickness"),
      "Shell form schema should describe its thickness numeric field.",
    );
    expectTrue(
      fieldIds.includes("shell-operation"),
      "Shell form schema should describe its operation choice field.",
    );
    expectTrue(
      fieldIds.includes("shell-faces"),
      "Shell form schema should describe its removable-face collection.",
    );
  }

  function testShellBooleanTargetSelectorVisibilityAndScope() {
    const targetBody = {
      kind: "body" as const,
      bodyId: "body_boolean_target" as const,
    };
    const initialSession = createFeatureEditSession({
      featureType: "shell",
      selectedTarget: {
        kind: "face",
        bodyId: "body_source",
        faceId: "face_top",
      },
    });
    const operationField = getFormField(initialSession, "shell-operation");
    const visibleTargetField = getFormField(
      initialSession,
      "shell-target-bodies",
    );
    const initialDefinition = buildFeatureDefinition(initialSession);

    expectTrue(
      operationField?.kind === "enum",
      "Shell schema should expose operation as a generic enum field.",
    );
    expectTrue(
      operationField.value === "intersect",
      "Shell operation should default to intersect.",
    );
    expectTrue(
      visibleTargetField?.kind === "referenceCollection",
      "Shell schema should expose boolean target bodies as a reference collection.",
    );
    expectTrue(
      visibleTargetField.hidden !== true,
      "Shell should show boolean target bodies for its default intersect operation.",
    );
    expectTrue(
      initialDefinition?.kind === "shell" &&
        initialDefinition.parameters.operation === "intersect" &&
        initialDefinition.parameters.booleanScope.kind === "targetBody" &&
        initialDefinition.parameters.booleanScope.bodyId === "body_source",
      "Shell should build an intersect definition against the selected source body by default.",
    );

    const emptyTargetSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorClearReferencePatch(visibleTargetField),
    );
    expectTrue(
      buildFeatureDefinition(emptyTargetSession) === null,
      "Shell boolean drafts without target bodies should not build a definition.",
    );

    const emptyTargetField = getFormField(
      emptyTargetSession,
      "shell-target-bodies",
    );
    expectTrue(
      emptyTargetField?.kind === "referenceCollection",
      "Shell target bodies field should remain a reference collection.",
    );

    const targetSession = patchFeatureEditSession(
      emptyTargetSession,
      createFeatureEditorReferenceSelectionPatch(emptyTargetField, targetBody),
    );
    const definition = buildFeatureDefinition(targetSession);

    expectTrue(
      definition?.kind === "shell" &&
        definition.parameters.operation === "intersect" &&
        definition.parameters.booleanScope.kind === "targetBody" &&
        definition.parameters.booleanScope.bodyId === targetBody.bodyId,
      "Shell boolean target selection should build a targetBody boolean scope.",
    );
  }

  function testDirectionFlipTogglesPatchFeatureDirections() {
    const profile = {
      kind: "region" as const,
      sketchId: "sketch_a" as const,
      regionId: "region_a" as const,
    };
    const axis = {
      kind: "edge" as const,
      bodyId: "body_axis" as const,
      edgeId: "edge_axis" as const,
    };
    const face = {
      kind: "face" as const,
      bodyId: "body_a" as const,
      faceId: "face_top" as const,
    };
    const body = { kind: "body" as const, bodyId: "body_a" as const };

    const extrudeSession = createFeatureEditSession({
      featureType: "extrude",
      selectedTarget: profile,
    });
    const extrudeDepthField = getFormField(extrudeSession, "extrude-depth");
    expectTrue(
      extrudeDepthField?.kind === "numeric" &&
        extrudeDepthField.directionToggle,
      "Extrude depth should expose a direction flip toggle.",
    );
    const flippedExtrude = patchFeatureEditSession(extrudeSession, {
      [extrudeDepthField.directionToggle.patch.patchKey]:
        extrudeDepthField.directionToggle.reverseValue,
    });
    const extrudeDefinition = buildFeatureDefinition(flippedExtrude);
    expectTrue(
      extrudeDefinition?.kind === "extrude" &&
        extrudeDefinition.parameters.extent?.mode === "oneSide" &&
        extrudeDefinition.parameters.extent.end.kind === "blind" &&
        extrudeDefinition.parameters.extent.end.direction === "negative",
      "Extrude direction flip should reverse the blind extent normal.",
    );

    const revolveSession = applySelectionToFeatureEditSession(
      createFeatureEditSession({
        featureType: "revolve",
        selectedTarget: profile,
      }),
      axis,
    );
    const revolveAngleField = getFormField(revolveSession, "revolve-angle");
    expectTrue(
      revolveAngleField?.kind === "numeric" &&
        revolveAngleField.directionToggle,
      "Revolve angle should expose a sweep direction flip toggle.",
    );
    const flippedRevolve = patchFeatureEditSession(revolveSession, {
      [revolveAngleField.directionToggle.patch.patchKey]:
        revolveAngleField.directionToggle.reverseValue,
    });
    const revolveDefinition = buildFeatureDefinition(flippedRevolve);
    expectTrue(
      revolveDefinition?.kind === "revolve" &&
        revolveDefinition.parameters.extent.kind !== "angle" &&
        revolveDefinition.parameters.extent.mode === "oneSide" &&
        revolveDefinition.parameters.extent.end.kind === "blind" &&
        revolveDefinition.parameters.extent.end.direction === "clockwise",
      "Revolve direction flip should reverse the angular sweep direction.",
    );

    const shellSession = createFeatureEditSession({
      featureType: "shell",
      selectedTarget: face,
    });
    const shellThicknessField = getFormField(shellSession, "shell-thickness");
    expectTrue(
      shellThicknessField?.kind === "numeric" &&
        shellThicknessField.directionToggle,
      "Shell thickness should expose a wall direction flip toggle.",
    );
    const flippedShell = patchFeatureEditSession(shellSession, {
      [shellThicknessField.directionToggle.patch.patchKey]:
        shellThicknessField.directionToggle.reverseValue,
    });
    const shellDefinition = buildFeatureDefinition(flippedShell);
    expectTrue(
      shellDefinition?.kind === "shell" &&
        shellDefinition.parameters.direction === "outside",
      "Shell direction flip should preserve an outside wall direction.",
    );

    const thickenSession = createFeatureEditSession({
      featureType: "thicken",
      selectedTarget: face,
    });
    const thickenThicknessField = getFormField(
      thickenSession,
      "thicken-thickness",
    );
    expectTrue(
      thickenThicknessField?.kind === "numeric" &&
        thickenThicknessField.directionToggle,
      "Thicken thickness should expose a normal direction flip toggle.",
    );
    const flippedThicken = patchFeatureEditSession(thickenSession, {
      [thickenThicknessField.directionToggle.patch.patchKey]:
        thickenThicknessField.directionToggle.reverseValue,
    });
    const thickenDefinition = buildFeatureDefinition(flippedThicken);
    expectTrue(
      thickenDefinition?.kind === "thicken" &&
        thickenDefinition.parameters.options?.direction === "negative",
      "Thicken direction flip should persist the negative normal direction.",
    );

    const transformSession = applySelectionToFeatureEditSession(
      createFeatureEditSession({
        featureType: "transform",
        selectedTarget: body,
      }),
      face,
    );
    const transformDistanceField = getFormField(
      transformSession,
      "transform-distance",
    );
    expectTrue(
      transformDistanceField?.kind === "numeric" &&
        transformDistanceField.directionToggle,
      "Transform distance should expose a normal direction flip toggle.",
    );
    const flippedTransform = patchFeatureEditSession(transformSession, {
      [transformDistanceField.directionToggle.patch.patchKey]:
        transformDistanceField.directionToggle.reverseValue,
    });
    const transformDefinition = buildFeatureDefinition(flippedTransform);
    expectTrue(
      transformDefinition?.kind === "transform" &&
        transformDefinition.parameters.options?.direction === "negative",
      "Transform direction flip should persist the negative normal direction.",
    );

    const filletSession = createFeatureEditSession({
      featureType: "fillet",
      selectedTarget: { kind: "edge", bodyId: "body_a", edgeId: "edge_a" },
    });
    const filletRadiusField = getFormField(filletSession, "fillet-radius");
    expectTrue(
      filletRadiusField?.kind === "numeric" &&
        !filletRadiusField.directionToggle,
      "Fillet radius should not expose an ambiguous direction toggle.",
    );

    const chamferSession = createFeatureEditSession({
      featureType: "chamfer",
      selectedTarget: { kind: "edge", bodyId: "body_a", edgeId: "edge_a" },
    });
    const chamferDistanceField = getFormField(
      chamferSession,
      "chamfer-distance",
    );
    expectTrue(
      chamferDistanceField?.kind === "numeric" &&
        !chamferDistanceField.directionToggle,
      "Chamfer distance should not expose an ambiguous direction toggle.",
    );
  }

  function testAdvancedExtrudeAndRevolveExtentAuthoring() {
    const profile = {
      kind: "region" as const,
      sketchId: "sketch_extent" as const,
      regionId: "region_extent" as const,
    };
    const axis = {
      kind: "edge" as const,
      bodyId: "body_axis" as const,
      edgeId: "edge_axis" as const,
    };

    const symmetricExtrude = buildFeatureDefinition(
      patchFeatureEditSession(
        createFeatureEditSession({
          featureType: "extrude",
          selectedTarget: profile,
        }),
        { extentMode: "symmetric", depth: 8, draftAngle: Math.PI / 18 },
      ),
    );
    expectTrue(
      symmetricExtrude?.kind === "extrude" &&
        symmetricExtrude.parameters.extent?.mode === "symmetric" &&
        symmetricExtrude.parameters.extent.end.kind === "blind" &&
        symmetricExtrude.parameters.extent.end.distance === 8,
      "Symmetric extrude drafts should build one mirrored blind authored end.",
    );

    const twoSideExtrude = buildFeatureDefinition(
      patchFeatureEditSession(
        createFeatureEditSession({
          featureType: "extrude",
          selectedTarget: profile,
        }),
        {
          extentMode: "twoSide",
          depth: 6,
          secondDepth: 3,
          secondDirection: "negative",
        },
      ),
    );
    expectTrue(
      twoSideExtrude?.kind === "extrude" &&
        twoSideExtrude.parameters.extent?.mode === "twoSide" &&
        twoSideExtrude.parameters.extent.firstEnd.kind === "blind" &&
        twoSideExtrude.parameters.extent.secondEnd.kind === "blind" &&
        twoSideExtrude.parameters.extent.secondEnd.distance === 3,
      "Two-side extrude drafts should preserve independent first and second ends.",
    );
    const hydratedTwoSideExtrude = twoSideExtrude
      ? hydrateFeatureEditSession({
          featureId: "feature_two_side_extrude",
          definition: twoSideExtrude,
        })
      : null;
    expectTrue(
      hydratedTwoSideExtrude?.featureType === "extrude" &&
        hydratedTwoSideExtrude.draft.extentMode === "twoSide" &&
        hydratedTwoSideExtrude.draft.secondEnd.kind === "blind" &&
        hydratedTwoSideExtrude.draft.secondEnd.distance === 3,
      "Advanced extrude snapshot hydration should preserve two-side end controls.",
    );

    const upToNextExtrude = buildFeatureDefinition(
      patchFeatureEditSession(
        createFeatureEditSession({
          featureType: "extrude",
          selectedTarget: profile,
        }),
        {
          endCondition: "upToNext",
          upToOffsetDistance: 0.25,
          upToOffsetDirection: "shorten",
        },
      ),
    );
    expectTrue(
      upToNextExtrude?.kind === "extrude" &&
        upToNextExtrude.parameters.extent?.mode === "oneSide" &&
        upToNextExtrude.parameters.extent.end.kind === "upToNext" &&
        !("target" in upToNextExtrude.parameters.extent.end),
      "Up-to-next extrude drafts should remain targetless while preserving offsets.",
    );

    const throughAllExtrude = buildFeatureDefinition(
      patchFeatureEditSession(
        createFeatureEditSession({
          featureType: "extrude",
          selectedTarget: profile,
        }),
        { endCondition: "throughAll" },
      ),
    );
    expectTrue(
      throughAllExtrude?.kind === "extrude" &&
        throughAllExtrude.parameters.extent?.mode === "oneSide" &&
        throughAllExtrude.parameters.extent.end.kind === "throughAll",
      "Through-all extrude drafts should build without a depth.",
    );

    const fullRevolve = buildFeatureDefinition(
      applySelectionToFeatureEditSession(
        patchFeatureEditSession(
          createFeatureEditSession({
            featureType: "revolve",
            selectedTarget: profile,
          }),
          { endCondition: "full" },
        ),
        axis,
      ),
    );
    expectTrue(
      fullRevolve?.kind === "revolve" &&
        fullRevolve.parameters.extent.kind !== "angle" &&
        fullRevolve.parameters.extent.mode === "oneSide" &&
        fullRevolve.parameters.extent.end.kind === "full",
      "Full revolve drafts should build without an angle value.",
    );

    const missingTargetExtrude = patchFeatureEditSession(
      createFeatureEditSession({
        featureType: "extrude",
        selectedTarget: profile,
      }),
      { endCondition: "upToFace" },
    );
    const extrudeTargetField = getFeatureEditorFormSchema(missingTargetExtrude)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "extrude-up-to-target");
    expectTrue(
      extrudeTargetField?.kind === "referencePicker" &&
        extrudeTargetField.picker.selectionFilter.allowedKinds.length === 1 &&
        extrudeTargetField.picker.selectionFilter.allowedKinds[0] === "face",
      "Up-to-face extrude target picker should only accept face targets.",
    );
    expectTrue(
      buildFeatureDefinition(missingTargetExtrude) === null,
      "Targeted up-to extrudes should not build without a required target.",
    );

    const upToVertexRevolve = patchFeatureEditSession(
      createFeatureEditSession({
        featureType: "revolve",
        selectedTarget: profile,
      }),
      { endCondition: "upToVertex" },
    );
    const revolveTargetField = getFeatureEditorFormSchema(upToVertexRevolve)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "revolve-up-to-target");
    expectTrue(
      revolveTargetField?.kind === "referencePicker" &&
        revolveTargetField.picker.selectionFilter.allowedKinds.length === 1 &&
        revolveTargetField.picker.selectionFilter.allowedKinds[0] === "vertex",
      "Up-to-vertex revolve target picker should only accept vertex targets.",
    );
  }

  function testAdvancedParticipantDescriptorsAreMachineReadable() {
    const definitions: readonly FeatureAuthoringDefinition[] =
      getRegisteredFeatureAuthoringDefinitions();
    const extrude = definitions.find(
      (definition) => definition.metadata.kind === "extrude",
    );
    const fillet = definitions.find(
      (definition) => definition.metadata.kind === "fillet",
    );
    const shell = definitions.find(
      (definition) => definition.metadata.kind === "shell",
    );
    const sweep = definitions.find(
      (definition) => definition.metadata.kind === "sweep",
    );
    const loft = definitions.find(
      (definition) => definition.metadata.kind === "loft",
    );
    const chamfer = definitions.find(
      (definition) => definition.metadata.kind === "chamfer",
    );
    const thicken = definitions.find(
      (definition) => definition.metadata.kind === "thicken",
    );
    const combine = definitions.find(
      (definition) => definition.metadata.kind === "combine",
    );
    const split = definitions.find(
      (definition) => definition.metadata.kind === "split",
    );
    const deleteSolid = definitions.find(
      (definition) => definition.metadata.kind === "deleteSolid",
    );
    const mirror = definitions.find(
      (definition) => definition.metadata.kind === "mirror",
    );
    const transform = definitions.find(
      (definition) => definition.metadata.kind === "transform",
    );

    expectTrue(
      extrude?.advancedParticipants?.some(
        (participant) => participant.role === "profile",
      ),
      "Extrude should declare profile participants for profile/path substrate coverage.",
    );
    expectTrue(
      fillet?.advancedParticipants?.some(
        (participant) => participant.role === "edge",
      ),
      "Fillet should declare edge participants for topology modifier substrate coverage.",
    );
    expectTrue(
      shell?.advancedParticipants?.some(
        (participant) => participant.role === "body",
      ),
      "Shell should declare body participants for body-operation substrate coverage.",
    );
    expectTrue(
      sweep?.advancedParticipants?.some(
        (participant) => participant.role === "path",
      ),
      "Sweep should declare path participants for profile/path substrate coverage.",
    );
    expectTrue(
      loft?.advancedParticipants?.some(
        (participant) => participant.role === "profile",
      ),
      "Loft should declare ordered profile participants for profile-family coverage.",
    );
    expectTrue(
      chamfer?.advancedParticipants?.some(
        (participant) => participant.role === "edge",
      ),
      "Chamfer should declare edge participants for topology modifier substrate coverage.",
    );
    expectTrue(
      thicken?.advancedParticipants?.some(
        (participant) => participant.role === "face",
      ),
      "Thicken should declare face participants for face-driven advanced solid coverage.",
    );
    expectTrue(
      combine?.advancedParticipants?.some(
        (participant) => participant.role === "targetBody",
      ),
      "Combine should declare explicit targetBody participants for body boolean coverage.",
    );
    expectTrue(
      combine?.advancedParticipants?.some(
        (participant) => participant.role === "toolBody",
      ),
      "Combine should declare explicit toolBody participants for body boolean coverage.",
    );
    expectTrue(
      split?.advancedParticipants?.some(
        (participant) => participant.role === "toolBody",
      ),
      "Split should declare explicit toolBody participants for body split coverage.",
    );
    expectTrue(
      deleteSolid?.advancedParticipants?.some(
        (participant) => participant.role === "body",
      ),
      "Delete-solid should declare explicit body participants for body removal coverage.",
    );
    expectTrue(
      mirror?.advancedParticipants?.some(
        (participant) => participant.role === "plane",
      ),
      "Mirror should declare an explicit mirror plane participant.",
    );
    expectTrue(
      transform?.advancedParticipants?.some(
        (participant) => participant.role === "transformReference",
      ),
      "Transform should declare an explicit transform reference participant.",
    );

    const shellSession = createFeatureEditSession({
      featureType: "shell",
      selectedTarget: { kind: "face", bodyId: "body_a", faceId: "face_top" },
    });
    const shellFacesField = getFeatureEditorFormSchema(shellSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "shell-faces");

    expectTrue(
      shellFacesField?.kind === "referenceCollection",
      "Shell form should expose removable faces as a reference collection.",
    );
    expectTrue(
      shellFacesField.advancedParticipant?.role === "face",
      "Shell form should expose the face participant role on the generic field.",
    );

    const patch = createFeatureEditorReferenceSelectionPatch(shellFacesField, {
      kind: "face",
      bodyId: "body_a",
      faceId: "face_side",
    });
    expectTrue(
      patch.participantRole === "face",
      "Generic reference selection patches should preserve the participant role.",
    );
  }

  function testAdvancedAuthoringAndInspectorDoNotImportKernelModules() {
    const files = [
      "src/core/feature-authoring/definition.ts",
      "src/core/feature-authoring/form-schema.ts",
      "src/core/feature-authoring/form-events.ts",
      "src/core/feature-authoring/features/sweep.ts",
      "src/core/feature-authoring/features/loft.ts",
      "src/core/feature-authoring/features/chamfer.ts",
      "src/core/feature-authoring/features/thicken.ts",
      "src/core/feature-authoring/features/combine.ts",
      "src/core/feature-authoring/features/split.ts",
      "src/core/feature-authoring/features/delete-solid.ts",
      "src/core/feature-authoring/features/mirror.ts",
      "src/core/feature-authoring/features/transform.ts",
      "src/components/layout/feature-inspector.tsx",
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expectTrue(
        !source.includes("/occ/") && !source.includes("opencascade"),
        `${file} should not import kernel-specific modules.`,
      );
    }
  }

  function testGenericFormEventsPatchRevolveAndShellDrafts() {
    const revolveSession = createFeatureEditSession({
      featureType: "revolve",
      selectedTarget: null,
    });
    const revolveAngleField = getFeatureEditorFormSchema(revolveSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "revolve-angle");

    expectTrue(
      revolveAngleField?.kind === "numeric",
      "Revolve schema should expose the angle as a generic numeric field.",
    );

    const patchedRevolve = patchFeatureEditSession(
      revolveSession,
      createFeatureEditorFieldPatch(revolveAngleField, 180),
    );

    expectTrue(
      patchedRevolve.featureType === "revolve" &&
        patchedRevolve.draft.firstEnd.kind === "blind" &&
        Math.abs(patchedRevolve.draft.firstEnd.angle - Math.PI) < 0.000001,
      "Generic numeric form events should convert revolve angle degrees to draft radians.",
    );

    const shellSession = createFeatureEditSession({
      featureType: "shell",
      selectedTarget: { kind: "face", bodyId: "body_a", faceId: "face_top" },
    });
    const shellOperationField = getFeatureEditorFormSchema(shellSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "shell-operation");

    expectTrue(
      shellOperationField?.kind === "enum",
      "Shell schema should expose operation as a generic enum field.",
    );

    const patchedShell = patchFeatureEditSession(
      shellSession,
      createFeatureEditorFieldPatch(shellOperationField, "cut"),
    );

    expectTrue(
      patchedShell.featureType === "shell" &&
        patchedShell.draft.operation === "cut",
      "Generic enum form events should patch shell operation without feature-specific inspector logic.",
    );
  }

  function testGenericReferenceFormEventsPatchSingleAndMultiReferences() {
    const revolveSession = createFeatureEditSession({
      featureType: "revolve",
      selectedTarget: null,
    });
    const revolveAxisField = getFeatureEditorFormSchema(revolveSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "revolve-axis");

    expectTrue(
      revolveAxisField?.kind === "referencePicker",
      "Revolve schema should expose an axis reference picker.",
    );

    const axisTarget = {
      kind: "edge" as const,
      bodyId: "body_a" as const,
      edgeId: "edge_axis" as const,
    };
    const selectedRevolve = patchFeatureEditSession(
      revolveSession,
      createFeatureEditorReferenceSelectionPatch(revolveAxisField, axisTarget),
    );
    const clearedRevolve = patchFeatureEditSession(
      selectedRevolve,
      createFeatureEditorClearReferencePatch(revolveAxisField),
    );

    expectTrue(
      selectedRevolve.featureType === "revolve" &&
        selectedRevolve.draft.axisTarget?.kind === "edge" &&
        selectedRevolve.draft.axisTarget.edgeId === "edge_axis",
      "Generic single-reference selection events should patch the selected field.",
    );
    expectTrue(
      clearedRevolve.featureType === "revolve" &&
        clearedRevolve.draft.axisTarget === null,
      "Generic single-reference clear events should set the bound reference to null.",
    );

    const shellSession = createFeatureEditSession({
      featureType: "shell",
      selectedTarget: { kind: "face", bodyId: "body_a", faceId: "face_top" },
    });
    const shellFacesField = getFeatureEditorFormSchema(shellSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "shell-faces");

    expectTrue(
      shellFacesField?.kind === "referenceCollection",
      "Shell schema should expose removable faces as a reference collection.",
    );

    const sideFace = {
      kind: "face" as const,
      bodyId: "body_a" as const,
      faceId: "face_side" as const,
    };
    const appendedShell = patchFeatureEditSession(
      shellSession,
      createFeatureEditorReferenceSelectionPatch(shellFacesField, sideFace),
    );
    const duplicateShell = patchFeatureEditSession(
      appendedShell,
      createFeatureEditorReferenceSelectionPatch(
        getFeatureEditorFormSchema(appendedShell)
          .sections.flatMap((section) => section.fields)
          .find(
            (field) => field.id === "shell-faces",
          ) as typeof shellFacesField,
        sideFace,
      ),
    );
    const removedShell = patchFeatureEditSession(
      duplicateShell,
      createFeatureEditorRemoveReferenceItemPatch(
        getFeatureEditorFormSchema(duplicateShell)
          .sections.flatMap((section) => section.fields)
          .find(
            (field) => field.id === "shell-faces",
          ) as typeof shellFacesField,
        sideFace,
      ),
    );
    const clearedShell = patchFeatureEditSession(
      removedShell,
      createFeatureEditorClearReferencePatch(
        getFeatureEditorFormSchema(removedShell)
          .sections.flatMap((section) => section.fields)
          .find(
            (field) => field.id === "shell-faces",
          ) as typeof shellFacesField,
      ),
    );

    expectTrue(
      appendedShell.featureType === "shell" &&
        appendedShell.draft.faceTargets.length === 2,
      "Generic multi-reference selection events should append unique selected instances.",
    );
    expectTrue(
      duplicateShell.featureType === "shell" &&
        duplicateShell.draft.faceTargets.length === 2,
      "Generic multi-reference selection events should ignore duplicate selected instances.",
    );
    expectTrue(
      removedShell.featureType === "shell" &&
        removedShell.draft.faceTargets.length === 1 &&
        removedShell.draft.faceTargets[0]?.faceId === "face_top",
      "Generic multi-reference remove events should remove only the requested selected instance.",
    );
    expectTrue(
      clearedShell.featureType === "shell" &&
        clearedShell.draft.faceTargets.length === 0,
      "Generic multi-reference clear events should remove all selected instances.",
    );
  }

  testRegistryContainsCurrentFeatureSet();
  testRevolveDraftSelectionAndDefinitionBuilder();
  testExtrudeBooleanTargetSelectorVisibilityAndScope();
  testRevolveBooleanTargetSelectorVisibilityAndScope();
  testSweepDraftSelectionAndDefinitionBuilder();
  testSweepHydrationPreservesAuthoredAdvancedOptionsForEditing();
  testChamferDraftSelectionDistanceAndDefinitionBuilder();
  testLoftDraftSelectionReorderingAndDefinitionBuilder();
  testLoftHydrationPreservesOrderedProfilesForEditing();
  testThickenDraftSelectionOptionsAndDefinitionBuilder();
  testThickenHydrationPreservesFaceTargetsAndOptions();
  testCombineDraftSelectionOperationAndHydration();
  testSplitDraftSelectionAndDefinitionBuilder();
  testDeleteSolidDraftSelectionAndHydration();
  testMirrorDraftSelectionOptionHandlingAndHydration();
  testTransformDraftSelectionAndDefinitionBuilder();
  testProfileBasedAuthoringUsesReferenceCollections();
  testShellOwnsFaceSelectionDefaultsAndFormSchema();
  testShellBooleanTargetSelectorVisibilityAndScope();
  testDirectionFlipTogglesPatchFeatureDirections();
  testAdvancedExtrudeAndRevolveExtentAuthoring();
  testAdvancedParticipantDescriptorsAreMachineReadable();
  testAdvancedAuthoringAndInspectorDoNotImportKernelModules();
  testGenericFormEventsPatchRevolveAndShellDrafts();
  testGenericReferenceFormEventsPatchSingleAndMultiReferences();
});

test("feature authoring preserves multiple selected profile references in order", () => {
  const profileA = {
    kind: "region" as const,
    sketchId: "sketch_a" as const,
    regionId: "region_a" as const,
  };
  const profileB = {
    kind: "face" as const,
    bodyId: "body_b" as const,
    faceId: "face_b" as const,
  };
  const path = {
    kind: "edge" as const,
    bodyId: "body_path" as const,
    edgeId: "edge_path" as const,
  };
  const axis = {
    kind: "edge" as const,
    bodyId: "body_axis" as const,
    edgeId: "edge_axis" as const,
  };

  const extrudeSession = createFeatureEditSession({
    featureType: "extrude",
    selectedTarget: profileA,
  });
  const extrudeProfileField = getFeatureEditorFormSchema(extrudeSession)
    .sections.flatMap((section) => section.fields)
    .find((field) => field.id === "extrude-profile");
  expectTrue(
    extrudeProfileField?.kind === "referenceCollection",
    "Extrude profiles should be collection-backed.",
  );
  expectTrue(
    extrudeProfileField.picker.allowsMultiple,
    "Extrude profile picker should accept multiple profiles.",
  );

  const extrudeMultiProfile = patchFeatureEditSession(
    extrudeSession,
    createFeatureEditorReferenceSelectionPatch(extrudeProfileField, profileB),
  );
  const extrudeDefinition = buildFeatureDefinition(extrudeMultiProfile);
  expectTrue(
    extrudeDefinition?.kind === "extrude",
    "Multi-profile extrude drafts should build an extrude definition.",
  );
  expectTrue(
    extrudeDefinition.parameters.profiles[0] === profileA,
    "Extrude definitions should preserve the first selected profile.",
  );
  expectTrue(
    extrudeDefinition.parameters.profiles[1] === profileB,
    "Extrude definitions should preserve the appended selected profile.",
  );

  const revolveSession = createFeatureEditSession({
    featureType: "revolve",
    selectedTarget: profileA,
  });
  const revolveProfileField = getFeatureEditorFormSchema(revolveSession)
    .sections.flatMap((section) => section.fields)
    .find((field) => field.id === "revolve-profile");
  expectTrue(
    revolveProfileField?.kind === "referenceCollection",
    "Revolve profiles should be collection-backed.",
  );
  expectTrue(
    revolveProfileField.picker.allowsMultiple,
    "Revolve profile picker should accept multiple profiles.",
  );

  const revolveMultiProfile = applySelectionToFeatureEditSession(
    patchFeatureEditSession(
      revolveSession,
      createFeatureEditorReferenceSelectionPatch(revolveProfileField, profileB),
    ),
    axis,
  );
  const revolveDefinition = buildFeatureDefinition(revolveMultiProfile);
  expectTrue(
    revolveDefinition?.kind === "revolve",
    "Multi-profile revolve drafts should build a revolve definition.",
  );
  expectTrue(
    revolveDefinition.parameters.profiles[0] === profileA,
    "Revolve definitions should preserve the first selected profile.",
  );
  expectTrue(
    revolveDefinition.parameters.profiles[1] === profileB,
    "Revolve definitions should preserve the appended selected profile.",
  );
  expectTrue(
    revolveDefinition.parameters.axis === axis,
    "Revolve definitions should keep the axis separate from profiles.",
  );

  const sweepSession = createFeatureEditSession({
    featureType: "sweep",
    selectedTarget: profileA,
  });
  const sweepProfileField = getFeatureEditorFormSchema(sweepSession)
    .sections.flatMap((section) => section.fields)
    .find((field) => field.id === "sweep-profile");
  expectTrue(
    sweepProfileField?.kind === "referenceCollection",
    "Sweep profiles should be collection-backed.",
  );
  expectTrue(
    sweepProfileField.picker.allowsMultiple,
    "Sweep profile picker should accept multiple profile participants.",
  );

  const sweepMultiProfile = applySelectionToFeatureEditSession(
    patchFeatureEditSession(
      sweepSession,
      createFeatureEditorReferenceSelectionPatch(sweepProfileField, profileB),
    ),
    path,
  );
  const sweepDefinition = buildFeatureDefinition(sweepMultiProfile);
  const sweepProfiles =
    sweepDefinition?.kind === "sweep"
      ? sweepDefinition.parameters.participants.find(
          (participant) => participant.role === "profile",
        )?.targets
      : null;
  expectTrue(
    sweepProfiles?.[0] === profileA,
    "Sweep profile participants should preserve the first selected profile.",
  );
  expectTrue(
    sweepProfiles?.[1] === profileB,
    "Sweep profile participants should preserve the appended selected profile.",
  );
});

test("feature session creation replays ordered activation-time selections", () => {
  const targetBody = { kind: "body" as const, bodyId: "body_target" as const };
  const toolBody = { kind: "body" as const, bodyId: "body_tool" as const };
  const planeTarget = {
    kind: "construction" as const,
    constructionId: "construction_plane-xy" as const,
  };

  const combineSession = createFeatureEditSession({
    featureType: "combine",
    selectedTargets: [targetBody, toolBody],
  });

  expectTrue(
    combineSession.draft.targetBodyTargets[0]?.bodyId === targetBody.bodyId,
    "Feature session creation should seed the first adopted selection into the initial draft.",
  );
  expectTrue(
    combineSession.draft.toolBodyTargets[0]?.bodyId === toolBody.bodyId,
    "Feature session creation should replay later adopted selections through feature authoring applySelection.",
  );

  const mirrorSession = createFeatureEditSession({
    featureType: "mirror",
    selectedTargets: [targetBody, planeTarget],
  });

  expectTrue(
    mirrorSession.draft.bodyTargets[0]?.bodyId === targetBody.bodyId,
    "Mirror activation should preserve the first adopted body target.",
  );
  expectTrue(
    mirrorSession.draft.planeTarget?.constructionId ===
      planeTarget.constructionId,
    "Mirror activation should replay later adopted targets in order so the mirror plane is seeded.",
  );
});
