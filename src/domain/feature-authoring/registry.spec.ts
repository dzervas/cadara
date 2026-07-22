import { test, expect } from "vitest";
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
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";

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

    expect(
      JSON.stringify(registeredKinds),
      "The feature authoring registry should contain every current authored feature kind.",
    ).toBe(
      JSON.stringify([
        "chamfer",
        "circularPattern",
        "combine",
        "deleteSolid",
        "extrude",
        "fillet",
        "hole",
        "linearPattern",
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

    expect(
      initialSession.featureType,
      "Revolve activation should create a revolve authoring session.",
    ).toBe("revolve");
    expect(
      buildFeatureDefinition(initialSession),
      "Revolve drafts without an axis should not build a modeling definition.",
    ).toBe(null);

    const completedSession = applySelectionToFeatureEditSession(
      initialSession,
      {
        kind: "edge",
        bodyId: "body_a",
        edgeId: "edge_axis",
      },
    );
    const definition = buildFeatureDefinition(completedSession);

    expect(
      definition?.kind,
      "Completed revolve drafts should build a revolve modeling definition.",
    ).toBe("revolve");
    expect(
      definition.parameters.axis.kind,
      "The selected edge should become the revolve axis.",
    ).toBe("edge");
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

    expect(
      operationField?.kind,
      "Extrude schema should expose operation as a generic enum field.",
    ).toBe("enum");
    expect(
      hiddenTargetField?.kind,
      "Extrude schema should expose boolean target bodies as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      hiddenTargetField.hidden,
      "Extrude should hide boolean target bodies for newBody operation.",
    ).toBeTruthy();

    const joinSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorFieldPatch(operationField, "join"),
    );
    const visibleTargetField = getFormField(
      joinSession,
      "extrude-target-bodies",
    );

    expect(
      visibleTargetField?.kind,
      "Extrude target bodies field should remain a reference collection.",
    ).toBe("referenceCollection");
    expect(
      visibleTargetField.hidden,
      "Extrude should show boolean target bodies for join operation.",
    ).not.toBeTruthy();
    expect(
      visibleTargetField.error?.message,
      "Extrude should mark missing boolean target bodies as invalid.",
    ).toBe("Select at least one target body.");
    expect(
      buildFeatureDefinition(joinSession),
      "Extrude boolean drafts without target bodies should not build a definition.",
    ).toBe(null);

    const oneTargetSession = patchFeatureEditSession(
      joinSession,
      createFeatureEditorReferenceSelectionPatch(
        visibleTargetField,
        targetBodyA,
      ),
    );
    const oneTargetDefinition = buildFeatureDefinition(oneTargetSession);

    expect(
      oneTargetDefinition?.kind === "extrude" &&
        getAuthoredLiteralValue(oneTargetDefinition.parameters.operation) ===
          "join" &&
        oneTargetDefinition.parameters.booleanScope.kind === "targetBody" &&
        oneTargetDefinition.parameters.booleanScope.bodyId ===
          targetBodyA.bodyId,
      "Extrude boolean target selection should build a targetBody boolean scope.",
    ).toBeTruthy();

    const twoTargetField = getFormField(
      oneTargetSession,
      "extrude-target-bodies",
    );
    expect(
      twoTargetField?.kind,
      "Extrude target bodies field should hydrate selected target bodies.",
    ).toBe("referenceCollection");

    const twoTargetSession = patchFeatureEditSession(
      oneTargetSession,
      createFeatureEditorReferenceSelectionPatch(twoTargetField, targetBodyB),
    );
    const twoTargetDefinition = buildFeatureDefinition(twoTargetSession);

    expect(
      twoTargetDefinition?.kind === "extrude" &&
        twoTargetDefinition.parameters.booleanScope.kind === "targetBodies" &&
        twoTargetDefinition.parameters.booleanScope.bodyIds.length === 2,
      "Extrude should preserve multiple selected boolean target bodies.",
    ).toBeTruthy();

    const resetOperationField = getFormField(
      twoTargetSession,
      "extrude-operation",
    );
    expect(
      resetOperationField?.kind,
      "Extrude operation field should remain available after target body selection.",
    ).toBe("enum");

    const resetSession = patchFeatureEditSession(
      twoTargetSession,
      createFeatureEditorFieldPatch(resetOperationField, "newBody"),
    );
    const resetDefinition = buildFeatureDefinition(resetSession);

    expect(
      resetDefinition?.kind === "extrude" &&
        resetDefinition.parameters.booleanScope.kind === "standalone",
      "Extrude should reset boolean scope to standalone when switching back to newBody.",
    ).toBeTruthy();
    expect(
      getFormField(resetSession, "extrude-target-bodies")?.hidden,
      "Extrude should hide target bodies after switching back to newBody.",
    ).toBeTruthy();
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

    expect(
      operationField?.kind,
      "Revolve schema should expose operation as a generic enum field.",
    ).toBe("enum");
    expect(
      hiddenTargetField?.kind,
      "Revolve schema should expose boolean target bodies as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      hiddenTargetField.hidden,
      "Revolve should hide boolean target bodies for newBody operation.",
    ).toBeTruthy();

    const cutSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorFieldPatch(operationField, "cut"),
    );
    const visibleTargetField = getFormField(
      cutSession,
      "revolve-target-bodies",
    );

    expect(
      visibleTargetField?.kind,
      "Revolve target bodies field should remain a reference collection.",
    ).toBe("referenceCollection");
    expect(
      visibleTargetField.hidden,
      "Revolve should show boolean target bodies for cut operation.",
    ).not.toBeTruthy();
    expect(
      buildFeatureDefinition(cutSession),
      "Revolve boolean drafts without target bodies should not build a definition.",
    ).toBe(null);

    const targetSession = patchFeatureEditSession(
      cutSession,
      createFeatureEditorReferenceSelectionPatch(
        visibleTargetField,
        targetBody,
      ),
    );
    const definition = buildFeatureDefinition(targetSession);

    expect(
      definition?.kind === "revolve" &&
        getAuthoredLiteralValue(definition.parameters.operation) === "cut" &&
        definition.parameters.booleanScope.kind === "targetBody" &&
        definition.parameters.booleanScope.bodyId === targetBody.bodyId,
      "Revolve boolean target selection should build a targetBody boolean scope.",
    ).toBeTruthy();
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

    expect(
      initialSession.featureType,
      "Sweep activation should create a sweep authoring session.",
    ).toBe("sweep");
    expect(
      buildFeatureDefinition(initialSession),
      "Sweep drafts without a path should not build a modeling definition.",
    ).toBe(null);

    const completedSession = applySelectionToFeatureEditSession(
      initialSession,
      path,
    );
    const definition = buildFeatureDefinition(completedSession);

    expect(
      definition?.kind,
      "Completed sweep drafts should build a sweep modeling definition.",
    ).toBe("sweep");
    expect(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "profile" && participant.targets[0] === profile,
      ),
      "Sweep definitions should preserve the selected profile participant role.",
    ).toBeTruthy();
    expect(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "path" && participant.targets[0] === path,
      ),
      "Sweep definitions should preserve the selected path participant role.",
    ).toBeTruthy();
    expect(
      getAuthoredLiteralValue(definition.parameters.options?.profileControl) ===
        "none" &&
        definition.parameters.options.twist &&
        typeof definition.parameters.options.twist === "object" &&
        "type" in definition.parameters.options.twist &&
        definition.parameters.options.twist.type === "none" &&
        getAuthoredLiteralValue(definition.parameters.options.endScale) === 1,
      "Sweep definitions should include default advanced control options.",
    ).toBeTruthy();

    const schema = getFeatureEditorFormSchema(completedSession);
    const operationField = schema.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "sweep-operation-intent");
    expect(
      operationField?.kind,
      "Sweep form schema should expose operation intent as a generic enum field.",
    ).toBe("enum");
    const profileControlField = getFormField(
      completedSession,
      "sweep-profile-control",
    );
    expect(
      profileControlField?.kind,
      "Sweep form schema should expose profile control as an enum field.",
    ).toBe("enum");
    const twistTypeField = getFormField(completedSession, "sweep-twist-type");
    expect(
      twistTypeField?.kind,
      "Sweep form schema should expose twist type as a discriminant enum.",
    ).toBe("enum");
    const twistTurnsField = getFormField(completedSession, "sweep-twist-turns");
    expect(
      twistTurnsField?.kind,
      "Sweep form schema should expose turns twist as a numeric field.",
    ).toBe("numeric");
    const endScaleField = getFormField(completedSession, "sweep-end-scale");
    expect(
      endScaleField?.kind,
      "Sweep form schema should expose end scale as a numeric field.",
    ).toBe("numeric");
    const hiddenTargetBodiesField = schema.sections
      .flatMap((section) => section.fields)
      .find((field) => field.id === "sweep-target-bodies");
    expect(
      hiddenTargetBodiesField?.kind,
      "Sweep form schema should expose target bodies as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      hiddenTargetBodiesField.hidden,
      "Sweep should hide target bodies for create operation.",
    ).toBeTruthy();

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
    expect(
      keepOrientationDefinition?.kind === "sweep" &&
        getAuthoredLiteralValue(
          keepOrientationDefinition.parameters.options?.profileControl,
        ) === "keepProfileOrientation",
      "Sweep authoring should preserve keep profile orientation control.",
    ).toBeTruthy();

    const lockFacesSession = patchFeatureEditSession(
      completedSession,
      createFeatureEditorFieldPatch(profileControlField, "lockProfileFaces"),
    );
    expect(
      buildFeatureDefinition(lockFacesSession),
      "Lock profile faces should require at least one face target.",
    ).toBe(null);
    const lockFacesField = getFormField(
      lockFacesSession,
      "sweep-lock-profile-faces",
    );
    expect(
      lockFacesField?.kind === "referenceCollection" &&
        lockFacesField.hidden !== true,
      "Lock face picker should be visible for lockProfileFaces.",
    ).toBeTruthy();
    const lockFacesCompletedSession = patchFeatureEditSession(
      lockFacesSession,
      createFeatureEditorReferenceSelectionPatch(lockFacesField, lockFace),
    );
    const lockFacesDefinition = buildFeatureDefinition(
      lockFacesCompletedSession,
    );
    expect(
      lockFacesDefinition?.kind === "sweep" &&
        getAuthoredLiteralValue(
          lockFacesDefinition.parameters.options?.profileControl,
        ) === "lockProfileFaces" &&
        lockFacesDefinition.parameters.participants.some(
          (participant) => participant.role === "lockProfileFace",
        ),
      "Sweep authoring should build lock profile face participants.",
    ).toBeTruthy();

    const lockDirectionSession = patchFeatureEditSession(
      completedSession,
      createFeatureEditorFieldPatch(
        profileControlField,
        "lockProfileDirection",
      ),
    );
    expect(
      buildFeatureDefinition(lockDirectionSession),
      "Lock profile direction should require one direction target.",
    ).toBe(null);
    const lockDirectionField = getFormField(
      lockDirectionSession,
      "sweep-lock-profile-direction",
    );
    expect(
      lockDirectionField?.kind === "referencePicker" &&
        lockDirectionField.hidden !== true,
      "Lock direction picker should be visible for lockProfileDirection.",
    ).toBeTruthy();
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
    expect(
      lockDirectionDefinition?.kind === "sweep" &&
        getAuthoredLiteralValue(
          lockDirectionDefinition.parameters.options?.profileControl,
        ) === "lockProfileDirection" &&
        lockDirectionDefinition.parameters.participants.some(
          (participant) => participant.role === "lockProfileDirection",
        ),
      "Sweep authoring should build lock profile direction participants.",
    ).toBeTruthy();

    const twistTurnsSession = patchFeatureEditSession(
      patchFeatureEditSession(
        completedSession,
        createFeatureEditorFieldPatch(twistTypeField, "turns"),
      ),
      createFeatureEditorFieldPatch(twistTurnsField, 2),
    );
    const twistTurnsDefinition = buildFeatureDefinition(twistTurnsSession);
    expect(
      twistTurnsDefinition?.kind === "sweep" &&
        twistTurnsDefinition.parameters.options?.twist &&
        typeof twistTurnsDefinition.parameters.options.twist === "object" &&
        "type" in twistTurnsDefinition.parameters.options.twist &&
        twistTurnsDefinition.parameters.options.twist.type === "turns" &&
        "turns" in twistTurnsDefinition.parameters.options.twist &&
        !("angle" in twistTurnsDefinition.parameters.options.twist),
      "Sweep buildDefinition should persist only the active twist variant.",
    ).toBeTruthy();

    const subtractSession = patchFeatureEditSession(
      completedSession,
      createFeatureEditorFieldPatch(operationField, "subtract"),
    );
    expect(
      buildFeatureDefinition(subtractSession),
      "Boolean sweep drafts should require explicit target bodies.",
    ).toBe(null);

    const targetBodiesField = getFeatureEditorFormSchema(subtractSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "sweep-target-bodies");
    expect(
      targetBodiesField?.kind,
      "Sweep form schema should expose target bodies as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      targetBodiesField.hidden,
      "Sweep should show target bodies for subtract operation.",
    ).not.toBeTruthy();

    const booleanSession = patchFeatureEditSession(
      subtractSession,
      createFeatureEditorReferenceSelectionPatch(targetBodiesField, targetBody),
    );
    const booleanDefinition = buildFeatureDefinition(booleanSession);

    expect(
      booleanSession.featureType === "sweep" &&
        booleanDefinition?.kind === "sweep" &&
        getAuthoredLiteralValue(
          booleanDefinition.parameters.operationIntent,
        ) === "subtract" &&
        booleanDefinition.parameters.participants.some(
          (participant) => participant.role === "targetBody",
        ),
      "Sweep boolean authoring should build operation intent and explicit targetBody participants.",
    ).toBeTruthy();
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

    expect(
      hydrated?.featureType,
      "Sweep snapshots should hydrate into sweep edit sessions.",
    ).toBe("sweep");

    const profileControlField = getFormField(hydrated, "sweep-profile-control");
    expect(
      profileControlField?.kind === "enum" &&
        profileControlField.value === "lockProfileDirection",
      "Sweep hydration should unwrap authored profile control values for editing.",
    ).toBeTruthy();

    const lockDirectionField = getFormField(
      hydrated,
      "sweep-lock-profile-direction",
    );
    expect(
      lockDirectionField?.kind === "referencePicker" &&
        lockDirectionField.hidden !== true &&
        lockDirectionField.value?.kind === "construction",
      "Sweep hydration should preserve lock profile direction participants for editing.",
    ).toBeTruthy();

    const twistTypeField = getFormField(hydrated, "sweep-twist-type");
    expect(
      twistTypeField?.kind === "enum" && twistTypeField.value === "angle",
      "Sweep hydration should preserve authored twist variants for editing.",
    ).toBeTruthy();

    const twistAngleField = getFormField(hydrated, "sweep-twist-angle");
    expect(
      twistAngleField?.kind === "numeric" &&
        Math.abs(Number(twistAngleField.value) - 60) < 0.000001,
      "Sweep hydration should display authored angle twist values in degrees.",
    ).toBeTruthy();

    const definition = buildFeatureDefinition(hydrated);
    expect(
      definition?.kind === "sweep" &&
        getAuthoredLiteralValue(
          definition.parameters.options?.profileControl,
        ) === "lockProfileDirection" &&
        definition.parameters.options.twist &&
        typeof definition.parameters.options.twist === "object" &&
        "type" in definition.parameters.options.twist &&
        definition.parameters.options.twist.type === "angle" &&
        "angle" in definition.parameters.options.twist &&
        Math.abs(
          Number(
            getAuthoredLiteralValue(definition.parameters.options.twist.angle),
          ) -
            Math.PI / 3,
        ) < 0.000001 &&
        getAuthoredLiteralValue(definition.parameters.options.endScale) === 1.5,
      "Hydrated sweep authored advanced options should rebuild as durable definition values.",
    ).toBeTruthy();
  }

  function testHoleDraftSelectionConditionalFieldsAndDefinitionBuilder() {
    const location = {
      kind: "sketchPoint" as const,
      sketchId: "sketch_a" as const,
      pointId: "point_a" as const,
    };
    const body = { kind: "body" as const, bodyId: "body_a" as const };
    const initialSession = createFeatureEditSession({
      featureType: "hole",
      selectedTarget: location,
    });

    expect(
      initialSession.featureType,
      "Hole activation should create a hole authoring session.",
    ).toBe("hole");
    expect(
      getFormField(initialSession, "hole-depth")?.kind,
      "Blind hole form should expose depth by default.",
    ).toBe("numeric");

    const bodyField = getFormField(initialSession, "hole-bodies");
    const withBody = patchFeatureEditSession(
      initialSession,
      createFeatureEditorReferenceSelectionPatch(bodyField, body),
    );
    const counterboreSession = patchFeatureEditSession(
      withBody,
      createFeatureEditorFieldPatch(
        getFormField(withBody, "hole-style"),
        "counterbore",
      ),
    );
    expect(
      getFormField(counterboreSession, "hole-counterbore-diameter")?.kind,
      "Counterbore style should expose counterbore diameter.",
    ).toBe("numeric");

    const throughAllSession = patchFeatureEditSession(
      counterboreSession,
      createFeatureEditorFieldPatch(
        getFormField(counterboreSession, "hole-termination"),
        "throughAll",
      ),
    );
    expect(
      getFormField(throughAllSession, "hole-depth"),
      "Through-all holes should not require a blind depth field.",
    ).toBeUndefined();

    const definition = buildFeatureDefinition(throughAllSession);
    expect(
      definition?.kind,
      "Completed hole drafts should build a hole advanced-solid definition.",
    ).toBe("hole");
    expect(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "location" && participant.targets.length === 1,
      ),
      "Hole definitions should preserve sketch-point location participants.",
    ).toBeTruthy();
    expect(
      definition.parameters.participants.some(
        (participant) => participant.role === "body" && participant.targets.length === 1,
      ),
      "Hole definitions should preserve explicit body scope participants.",
    ).toBeTruthy();
    expect(
      definition.parameters.operationIntent,
      "Hole definitions should not author arbitrary operation intent.",
    ).toBeUndefined();
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

    expect(
      initialSession.featureType,
      "Chamfer activation should create a chamfer authoring session.",
    ).toBe("chamfer");

    const edgesField = getFeatureEditorFormSchema(initialSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "chamfer-edges");
    expect(
      edgesField?.kind,
      "Chamfer form schema should expose selected edges as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      edgesField.advancedParticipant?.role,
      "Chamfer edge field should expose the edge participant role.",
    ).toBe("edge");

    const multiEdgeSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorReferenceSelectionPatch(edgesField, edgeB),
    );
    const distanceField = getFeatureEditorFormSchema(multiEdgeSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "chamfer-distance");
    expect(
      distanceField?.kind,
      "Chamfer form schema should expose distance as a numeric field.",
    ).toBe("numeric");

    const completedSession = patchFeatureEditSession(
      multiEdgeSession,
      createFeatureEditorFieldPatch(distanceField, 0.75),
    );
    const definition = buildFeatureDefinition(completedSession);

    expect(
      definition?.kind,
      "Completed chamfer drafts should build a chamfer advanced-solid definition.",
    ).toBe("chamfer");
    expect(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "edge" && participant.targets.length === 2,
      ),
      "Chamfer definitions should preserve explicit edge participants.",
    ).toBeTruthy();
    expect(
      getAuthoredLiteralValue(definition.parameters.options?.distance),
      "Chamfer definitions should preserve the constant distance option.",
    ).toBe(0.75);

    const invalidDistanceSession = patchFeatureEditSession(
      completedSession,
      createFeatureEditorFieldPatch(distanceField, 0),
    );
    expect(
      buildFeatureDefinition(invalidDistanceSession),
      "Chamfer drafts with non-positive distance should not build a definition.",
    ).toBe(null);
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

    expect(
      initialSession.featureType,
      "Loft activation should create a loft authoring session.",
    ).toBe("loft");
    expect(
      buildFeatureDefinition(initialSession),
      "Loft drafts with fewer than two profiles should not build a modeling definition.",
    ).toBe(null);

    const twoProfileSession = patchFeatureEditSession(initialSession, {
      profileTargets: [profileA, profileB, profileC],
    });
    const profilesField = getFeatureEditorFormSchema(twoProfileSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "loft-profiles");

    expect(
      profilesField?.kind,
      "Loft form schema should expose ordered profiles as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      profilesField.ordering?.moveUpPatchKey,
      "Loft profiles should expose explicit reordering controls.",
    ).toBe("moveProfileTargetEarlier");

    const reorderedSession = patchFeatureEditSession(twoProfileSession, {
      moveProfileTargetEarlier: profileC,
    });
    const guideField = getFeatureEditorFormSchema(reorderedSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "loft-guide-curves");
    expect(
      guideField?.kind,
      "Loft form schema should expose guide curves as a reference collection.",
    ).toBe("referenceCollection");
    const pathField = getFormField(reorderedSession, "loft-path");
    expect(
      pathField?.kind,
      "Loft form schema should expose path as a single reference picker.",
    ).toBe("referencePicker");
    const pathSession = patchFeatureEditSession(
      reorderedSession,
      createFeatureEditorReferenceSelectionPatch(pathField, path),
    );
    const pathDefinition = buildFeatureDefinition(pathSession);
    expect(
      pathDefinition?.kind === "loft" &&
        pathDefinition.parameters.participants.some(
          (participant) =>
            participant.role === "path" && participant.targets[0] === path,
        ) &&
        (pathDefinition.parameters.options?.path as
          | { sectionCount?: unknown }
          | undefined) &&
        getAuthoredLiteralValue(
          (
            pathDefinition.parameters.options?.path as
              | { sectionCount?: unknown }
              | undefined
          )?.sectionCount,
        ) === 5,
      "Loft definitions should preserve path separately from guide curves and default path section count to 5.",
    ).toBeTruthy();
    const sectionCountField = getFormField(pathSession, "loft-section-count");
    expect(
      sectionCountField?.kind,
      "Loft path options should expose section count as a numeric field.",
    ).toBe("numeric");
    const explicitSectionSession = patchFeatureEditSession(
      pathSession,
      createFeatureEditorFieldPatch(sectionCountField, 7),
    );
    const explicitSectionDefinition = buildFeatureDefinition(
      explicitSectionSession,
    );
    expect(
      explicitSectionDefinition?.kind === "loft" &&
        (explicitSectionDefinition.parameters.options?.path as
          | { sectionCount?: unknown }
          | undefined) &&
        getAuthoredLiteralValue(
          (
            explicitSectionDefinition.parameters.options?.path as
              | { sectionCount?: unknown }
              | undefined
          )?.sectionCount,
        ) === 7,
      "Loft definitions should preserve explicit path section count.",
    ).toBeTruthy();

    const guideSession = patchFeatureEditSession(
      reorderedSession,
      createFeatureEditorReferenceSelectionPatch(guideField, guideCurve),
    );
    const definition = buildFeatureDefinition(guideSession);

    expect(
      definition?.kind,
      "Completed loft drafts should build a loft modeling definition.",
    ).toBe("loft");
    expect(
      definition.parameters.participants.find(
        (participant) => participant.role === "profile",
      )?.targets[1],
      "Loft definitions should preserve the explicit reordered profile sequence.",
    ).toBe(profileC);
    expect(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "guideCurve" &&
          participant.targets[0] === guideCurve,
      ),
      "Loft definitions should preserve optional guide-curve participants.",
    ).toBeTruthy();
    const guideContinuityField = getFormField(
      guideSession,
      "loft-guide-continuity",
    );
    expect(
      guideContinuityField?.kind,
      "Loft guide options should expose guide continuity as an enum field.",
    ).toBe("enum");
    const guideContinuitySession = patchFeatureEditSession(
      guideSession,
      createFeatureEditorFieldPatch(guideContinuityField, "normalToGuide"),
    );
    const guideContinuityDefinition = buildFeatureDefinition(
      guideContinuitySession,
    );
    expect(
      guideContinuityDefinition?.kind === "loft" &&
        getAuthoredLiteralValue(
          guideContinuityDefinition.parameters.options?.guideContinuity,
        ) === "normalToGuide",
      "Loft definitions should preserve guide continuity controls.",
    ).toBeTruthy();
    const startConditionField = getFormField(
      guideSession,
      "loft-start-condition",
    );
    expect(
      startConditionField?.kind,
      "Loft profile options should expose start condition as an enum field.",
    ).toBe("enum");
    const startMagnitudeField = getFormField(
      patchFeatureEditSession(
        guideSession,
        createFeatureEditorFieldPatch(startConditionField, "normal"),
      ),
      "loft-start-condition-magnitude",
    );
    expect(
      startMagnitudeField?.kind === "numeric" &&
        startMagnitudeField.hidden !== true,
      "Loft normal start condition should expose magnitude.",
    ).toBeTruthy();

    const createOperationField = getFormField(
      guideSession,
      "loft-operation-intent",
    );
    const hiddenTargetBodiesField = getFormField(
      guideSession,
      "loft-target-bodies",
    );
    expect(
      createOperationField?.kind,
      "Loft schema should expose operation intent as a generic enum field.",
    ).toBe("enum");
    expect(
      hiddenTargetBodiesField?.kind,
      "Loft form schema should expose target bodies as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      hiddenTargetBodiesField.hidden,
      "Loft should hide target bodies for create operation.",
    ).toBeTruthy();

    const addSession = patchFeatureEditSession(
      guideSession,
      createFeatureEditorFieldPatch(createOperationField, "add"),
    );
    const visibleTargetBodiesField = getFormField(
      addSession,
      "loft-target-bodies",
    );
    expect(
      visibleTargetBodiesField?.kind,
      "Loft target bodies field should remain a reference collection.",
    ).toBe("referenceCollection");
    expect(
      visibleTargetBodiesField.hidden,
      "Loft should show target bodies for add operation.",
    ).not.toBeTruthy();
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

    expect(
      hydrated?.featureType,
      "Loft snapshots should hydrate into loft edit sessions.",
    ).toBe("loft");
    expect(
      hydrated?.draft.profileTargets[0]?.kind === "face" &&
        hydrated.draft.profileTargets[1]?.kind === "region",
      "Loft hydration should preserve ordered profile targets for edit sessions.",
    ).toBeTruthy();
    expect(
      hydrated?.draft.guideCurveTargets[0]?.kind,
      "Loft hydration should preserve guide-curve participants for edit sessions.",
    ).toBe("edge");
    expect(
      hydrated?.draft.pathTarget?.kind === "edge" &&
        getAuthoredLiteralValue(hydrated.draft.options.path?.sectionCount) ===
          8 &&
        getAuthoredLiteralValue(hydrated.draft.options.guideContinuity) ===
          "normalToGuide",
      "Loft hydration should preserve path and guide continuity options for edit sessions.",
    ).toBeTruthy();
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

    expect(
      initialSession.featureType,
      "Thicken activation should create a thicken authoring session.",
    ).toBe("thicken");

    const facesField = getFeatureEditorFormSchema(initialSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "thicken-faces");
    expect(
      facesField?.kind,
      "Thicken form schema should expose selected faces as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      facesField.advancedParticipant?.role,
      "Thicken face field should expose the face participant role.",
    ).toBe("face");

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

    expect(
      thicknessField?.kind,
      "Thicken form schema should expose thickness as a numeric field.",
    ).toBe("numeric");
    expect(
      operationField?.kind,
      "Thicken form schema should expose operation intent as a generic enum field.",
    ).toBe("enum");
    const hiddenTargetBodiesField = getFormField(
      multiFaceSession,
      "thicken-target-bodies",
    );
    expect(
      hiddenTargetBodiesField?.kind,
      "Thicken form schema should expose target bodies as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      hiddenTargetBodiesField.hidden,
      "Thicken should hide target bodies for create operation.",
    ).toBeTruthy();

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
    expect(
      buildFeatureDefinition(subtractSession),
      "Boolean thicken drafts should require explicit target bodies.",
    ).toBe(null);

    const targetBodiesField = getFeatureEditorFormSchema(subtractSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "thicken-target-bodies");
    expect(
      targetBodiesField?.kind,
      "Thicken form schema should expose target bodies as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      targetBodiesField.hidden,
      "Thicken should show target bodies for subtract operation.",
    ).not.toBeTruthy();

    const completeSession = patchFeatureEditSession(
      subtractSession,
      createFeatureEditorReferenceSelectionPatch(targetBodiesField, targetBody),
    );
    const definition = buildFeatureDefinition(completeSession);

    expect(
      definition?.kind,
      "Completed thicken drafts should build a thicken advanced-solid definition.",
    ).toBe("thicken");
    expect(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "face" && participant.targets.length === 2,
      ),
      "Thicken definitions should preserve explicit face participants.",
    ).toBeTruthy();
    expect(
      getAuthoredLiteralValue(definition.parameters.options?.thickness),
      "Thicken definitions should preserve the thickness option.",
    ).toBe(1.25);
    expect(
      getAuthoredLiteralValue(definition.parameters.options?.side),
      "Thicken definitions should preserve the side option.",
    ).toBe("symmetric");
    expect(
      definition.parameters.participants.some(
        (participant) => participant.role === "targetBody",
      ),
      "Thicken boolean authoring should build explicit targetBody participants.",
    ).toBeTruthy();
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

    expect(
      hydrated?.featureType,
      "Thicken snapshots should hydrate into thicken edit sessions.",
    ).toBe("thicken");
    expect(
      hydrated?.draft.faceTargets.length,
      "Thicken hydration should preserve face participants for edit sessions.",
    ).toBe(2);
    expect(
      getAuthoredLiteralValue(hydrated?.draft.options.thickness),
      "Thicken hydration should preserve thickness.",
    ).toBe(2);
    expect(
      getAuthoredLiteralValue(hydrated?.draft.options.side),
      "Thicken hydration should preserve side.",
    ).toBe("symmetric");
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

    expect(
      initialSession.featureType,
      "Split activation should create a split authoring session.",
    ).toBe("split");
    expect(
      buildFeatureDefinition(initialSession),
      "Split drafts without a tool body should not build a modeling definition.",
    ).toBe(null);

    const targetField = getFeatureEditorFormSchema(initialSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "split-target-body");
    const toolField = getFeatureEditorFormSchema(initialSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "split-tool-body");

    expect(
      targetField?.kind,
      "Split form schema should expose the target body as a reference picker.",
    ).toBe("referencePicker");
    expect(
      toolField?.kind,
      "Split form schema should expose the tool body as a reference picker.",
    ).toBe("referencePicker");
    expect(
      targetField.advancedParticipant?.role,
      "Split target field should expose the targetBody participant role.",
    ).toBe("targetBody");
    expect(
      toolField.advancedParticipant?.role,
      "Split tool field should expose the toolBody participant role.",
    ).toBe("toolBody");

    const completedSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorReferenceSelectionPatch(toolField, toolBody),
    );
    const definition = buildFeatureDefinition(completedSession);

    expect(
      definition?.kind,
      "Completed split drafts should build a split advanced-solid definition.",
    ).toBe("split");
    expect(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "targetBody" &&
          participant.targets[0] === targetBody,
      ),
      "Split definitions should preserve the explicit target body participant.",
    ).toBeTruthy();
    expect(
      definition.parameters.participants.some(
        (participant) =>
          participant.role === "toolBody" &&
          participant.targets[0] === toolBody,
      ),
      "Split definitions should preserve the explicit tool body participant.",
    ).toBeTruthy();
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

    expect(
      initialSession.featureType,
      "Combine activation should create a combine authoring session.",
    ).toBe("combine");
    expect(
      buildFeatureDefinition(initialSession),
      "Combine drafts without tool bodies should not build a modeling definition.",
    ).toBe(null);

    const targetField = getFormField(initialSession, "combine-target-bodies");
    const toolField = getFormField(initialSession, "combine-tool-bodies");
    const operationField = getFormField(
      initialSession,
      "combine-operation-intent",
    );

    expect(
      targetField?.kind,
      "Combine should expose target bodies as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      toolField?.kind,
      "Combine should expose tool bodies as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      operationField?.kind,
      "Combine should expose operation intent as a generic enum field.",
    ).toBe("enum");

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

    expect(
      definition?.kind,
      "Completed Combine drafts should build a combine advanced-solid definition.",
    ).toBe("combine");
    expect(
      getAuthoredLiteralValue(definition.parameters.operationIntent),
      "Combine definitions should preserve the explicit operation intent.",
    ).toBe("intersect");
    expect(
      definition.parameters.participants.find(
        (participant) => participant.role === "targetBody",
      )?.targets[0],
      "Combine definitions should preserve explicit targetBody participants.",
    ).toBe(targetBody);
    expect(
      definition.parameters.participants.find(
        (participant) => participant.role === "toolBody",
      )?.targets.length,
      "Combine definitions should preserve explicit toolBody collections.",
    ).toBe(2);

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

    expect(
      hydrated?.featureType,
      "Combine snapshots should hydrate into combine edit sessions.",
    ).toBe("combine");
    expect(
      hydrated.draft.targetBodyTargets.length,
      "Combine hydration should preserve target bodies.",
    ).toBe(1);
    expect(
      hydrated.draft.toolBodyTargets.length,
      "Combine hydration should preserve tool bodies.",
    ).toBe(2);
    expect(
      getAuthoredLiteralValue(hydrated.draft.operationIntent),
      "Combine hydration should preserve operation intent.",
    ).toBe("intersect");
  }

  function testDeleteSolidDraftSelectionAndHydration() {
    const bodyA = { kind: "body" as const, bodyId: "body_a" as const };
    const bodyB = { kind: "body" as const, bodyId: "body_b" as const };
    const initialSession = createFeatureEditSession({
      featureType: "deleteSolid",
      selectedTarget: bodyA,
    });

    expect(
      initialSession.featureType,
      "Delete-solid activation should create a delete-solid authoring session.",
    ).toBe("deleteSolid");

    const bodiesField = getFeatureEditorFormSchema(initialSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "delete-solid-bodies");
    expect(
      bodiesField?.kind,
      "Delete-solid form schema should expose the body targets as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      bodiesField.advancedParticipant?.role,
      "Delete-solid body field should expose the body participant role.",
    ).toBe("body");

    const completeSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorReferenceSelectionPatch(bodiesField, bodyB),
    );
    const definition = buildFeatureDefinition(completeSession);

    expect(
      definition?.kind,
      "Completed delete-solid drafts should build a delete-solid advanced-solid definition.",
    ).toBe("deleteSolid");
    expect(
      definition.parameters.participants[0]?.targets.length,
      "Delete-solid definitions should preserve the selected body collection.",
    ).toBe(2);

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

    expect(
      hydrated?.featureType,
      "Delete-solid snapshots should hydrate into delete-solid edit sessions.",
    ).toBe("deleteSolid");
    expect(
      hydrated?.draft.bodyTargets.length,
      "Delete-solid hydration should preserve explicit body targets.",
    ).toBe(2);
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

    expect(
      initialSession.featureType,
      "Mirror activation should create a mirror authoring session.",
    ).toBe("mirror");

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

    expect(
      bodiesField?.kind,
      "Mirror should expose body targets as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      planeField?.kind,
      "Mirror should expose the mirror plane as a reference picker.",
    ).toBe("referencePicker");
    expect(
      modeField?.kind,
      "Mirror should expose the copy policy as a generic enum field.",
    ).toBe("enum");

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

    expect(
      definition?.kind,
      "Completed mirror drafts should build a mirror advanced-solid definition.",
    ).toBe("mirror");
    expect(
      definition.parameters.participants.find(
        (participant) => participant.role === "body",
      )?.targets.length,
      "Mirror definitions should preserve explicit body targets.",
    ).toBe(2);
    expect(
      definition.parameters.participants.find(
        (participant) => participant.role === "plane",
      )?.targets[0],
      "Mirror definitions should preserve the explicit mirror plane.",
    ).toBe(plane);
    expect(
      getAuthoredLiteralValue(definition.parameters.options?.copy),
      "Mirror definitions should preserve the copy policy option.",
    ).toBeTruthy();

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

    expect(
      hydrated?.featureType,
      "Mirror snapshots should hydrate into mirror edit sessions.",
    ).toBe("mirror");
    expect(
      hydrated?.draft.bodyTargets.length,
      "Mirror hydration should preserve explicit body targets.",
    ).toBe(2);
    expect(
      hydrated?.draft.planeTarget?.kind,
      "Mirror hydration should preserve the explicit plane reference.",
    ).toBe("construction");
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

    expect(
      initialSession.featureType,
      "Transform activation should create a transform authoring session.",
    ).toBe("transform");
    expect(
      buildFeatureDefinition(initialSession),
      "Transform drafts without an explicit reference should not build a modeling definition.",
    ).toBe(null);

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

    expect(
      bodiesField?.kind,
      "Transform should expose body targets as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      referenceField?.kind,
      "Transform should expose the transform reference as a reference picker.",
    ).toBe("referencePicker");
    expect(
      distanceField?.kind,
      "Transform should expose the translation distance as a numeric field.",
    ).toBe("numeric");

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

    expect(
      definition?.kind,
      "Completed transform drafts should build a transform advanced-solid definition.",
    ).toBe("transform");
    expect(
      definition.parameters.participants.find(
        (participant) => participant.role === "body",
      )?.targets.length,
      "Transform definitions should preserve explicit body targets.",
    ).toBe(2);
    expect(
      definition.parameters.participants.find(
        (participant) => participant.role === "transformReference",
      )?.targets[0],
      "Transform definitions should preserve the explicit transform reference.",
    ).toBe(plane);
    expect(
      getAuthoredLiteralValue(definition.parameters.options?.distance),
      "Transform definitions should preserve the typed distance option.",
    ).toBe(2.5);
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

    expect(
      extrudeProfileField?.kind,
      "Extrude schema should expose profiles as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      extrudeProfileField.picker.allowsMultiple,
      "Extrude profile picker should allow multiple profile references.",
    ).toBeTruthy();

    const extrudeMulti = patchFeatureEditSession(
      extrudeSession,
      createFeatureEditorReferenceSelectionPatch(extrudeProfileField, profileB),
    );
    const extrudeDefinition = buildFeatureDefinition(extrudeMulti);

    expect(
      extrudeMulti.featureType === "extrude" &&
        extrudeDefinition?.kind === "extrude" &&
        extrudeDefinition.parameters.profiles.length === 2,
      "Extrude authoring should build multi-profile contract payloads from collection fields.",
    ).toBeTruthy();

    const revolveSession = createFeatureEditSession({
      featureType: "revolve",
      selectedTarget: profileA,
    });
    const revolveProfileField = getFeatureEditorFormSchema(revolveSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "revolve-profile");

    expect(
      revolveProfileField?.kind,
      "Revolve schema should expose profiles as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      revolveProfileField.picker.allowsMultiple,
      "Revolve profile picker should allow multiple profile references.",
    ).toBeTruthy();

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

    expect(
      revolveComplete.featureType === "revolve" &&
        revolveDefinition?.kind === "revolve" &&
        revolveDefinition.parameters.profiles.length === 2,
      "Revolve authoring should build multi-profile contract payloads while keeping the axis separate.",
    ).toBeTruthy();
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

    expect(
      session.featureType,
      "Shell activation should create a shell authoring session.",
    ).toBe("shell");
    expect(
      session.draft.bodyTarget?.bodyId,
      "Shell should infer the source body from the selected removable face.",
    ).toBe("body_a");
    expect(
      session.draft.faceTargets.length,
      "Shell should seed removable faces from the selected face.",
    ).toBe(1);
    expect(
      session.draft.operation,
      "Shell should default to intersect instead of creating a new body.",
    ).toBe("intersect");
    expect(
      session.draft.booleanScope.kind === "targetBody" &&
        session.draft.booleanScope.bodyId === "body_a",
      "Shell should default the boolean target to the selected source body.",
    ).toBeTruthy();

    const selectionAfterActivationSession = applySelectionToFeatureEditSession(
      createFeatureEditSession({ featureType: "shell", selectedTarget: null }),
      selectedFace,
    );

    expect(
      selectionAfterActivationSession.featureType === "shell" &&
        selectionAfterActivationSession.draft.booleanScope.kind ===
          "targetBody" &&
        selectionAfterActivationSession.draft.booleanScope.bodyId === "body_a",
      "Shell face selection should seed the default intersect target after command activation.",
    ).toBeTruthy();

    const schema = getFeatureEditorFormSchema(session);
    const fieldIds = schema.sections.flatMap((section) =>
      section.fields.map((field) => field.id),
    );

    expect(
      fieldIds.includes("shell-thickness"),
      "Shell form schema should describe its thickness numeric field.",
    ).toBeTruthy();
    expect(
      fieldIds.includes("shell-operation"),
      "Shell form schema should describe its operation choice field.",
    ).toBeTruthy();
    expect(
      fieldIds.includes("shell-faces"),
      "Shell form schema should describe its removable-face collection.",
    ).toBeTruthy();
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

    expect(
      operationField?.kind,
      "Shell schema should expose operation as a generic enum field.",
    ).toBe("enum");
    expect(
      operationField.value,
      "Shell operation should default to intersect.",
    ).toBe("intersect");
    expect(
      visibleTargetField?.kind,
      "Shell schema should expose boolean target bodies as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      visibleTargetField.hidden,
      "Shell should show boolean target bodies for its default intersect operation.",
    ).not.toBeTruthy();
    expect(
      initialDefinition?.kind === "shell" &&
        getAuthoredLiteralValue(initialDefinition.parameters.operation) ===
          "intersect" &&
        initialDefinition.parameters.booleanScope.kind === "targetBody" &&
        initialDefinition.parameters.booleanScope.bodyId === "body_source",
      "Shell should build an intersect definition against the selected source body by default.",
    ).toBeTruthy();

    const emptyTargetSession = patchFeatureEditSession(
      initialSession,
      createFeatureEditorClearReferencePatch(visibleTargetField),
    );
    expect(
      buildFeatureDefinition(emptyTargetSession),
      "Shell boolean drafts without target bodies should not build a definition.",
    ).toBe(null);

    const emptyTargetField = getFormField(
      emptyTargetSession,
      "shell-target-bodies",
    );
    expect(
      emptyTargetField?.kind,
      "Shell target bodies field should remain a reference collection.",
    ).toBe("referenceCollection");

    const targetSession = patchFeatureEditSession(
      emptyTargetSession,
      createFeatureEditorReferenceSelectionPatch(emptyTargetField, targetBody),
    );
    const definition = buildFeatureDefinition(targetSession);

    expect(
      definition?.kind === "shell" &&
        getAuthoredLiteralValue(definition.parameters.operation) ===
          "intersect" &&
        definition.parameters.booleanScope.kind === "targetBody" &&
        definition.parameters.booleanScope.bodyId === targetBody.bodyId,
      "Shell boolean target selection should build a targetBody boolean scope.",
    ).toBeTruthy();
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
    expect(
      extrudeDepthField?.kind === "numeric" &&
        extrudeDepthField.directionToggle,
      "Extrude depth should expose a direction flip toggle.",
    ).toBeTruthy();
    const flippedExtrude = patchFeatureEditSession(extrudeSession, {
      [extrudeDepthField.directionToggle.patch.patchKey]:
        extrudeDepthField.directionToggle.reverseValue,
    });
    const extrudeDefinition = buildFeatureDefinition(flippedExtrude);
    expect(
      extrudeDefinition?.kind === "extrude" &&
        extrudeDefinition.parameters.extent?.mode === "oneSide" &&
        extrudeDefinition.parameters.extent.end.kind === "blind" &&
        extrudeDefinition.parameters.extent.end.direction === "negative",
      "Extrude direction flip should reverse the blind extent normal.",
    ).toBeTruthy();

    const revolveSession = applySelectionToFeatureEditSession(
      createFeatureEditSession({
        featureType: "revolve",
        selectedTarget: profile,
      }),
      axis,
    );
    const revolveAngleField = getFormField(revolveSession, "revolve-angle");
    expect(
      revolveAngleField?.kind === "numeric" &&
        revolveAngleField.directionToggle,
      "Revolve angle should expose a sweep direction flip toggle.",
    ).toBeTruthy();
    const flippedRevolve = patchFeatureEditSession(revolveSession, {
      [revolveAngleField.directionToggle.patch.patchKey]:
        revolveAngleField.directionToggle.reverseValue,
    });
    const revolveDefinition = buildFeatureDefinition(flippedRevolve);
    expect(
      revolveDefinition?.kind === "revolve" &&
        revolveDefinition.parameters.extent.kind !== "angle" &&
        revolveDefinition.parameters.extent.mode === "oneSide" &&
        revolveDefinition.parameters.extent.end.kind === "blind" &&
        revolveDefinition.parameters.extent.end.direction === "clockwise",
      "Revolve direction flip should reverse the angular sweep direction.",
    ).toBeTruthy();

    const shellSession = createFeatureEditSession({
      featureType: "shell",
      selectedTarget: face,
    });
    const shellThicknessField = getFormField(shellSession, "shell-thickness");
    expect(
      shellThicknessField?.kind === "numeric" &&
        shellThicknessField.directionToggle,
      "Shell thickness should expose a wall direction flip toggle.",
    ).toBeTruthy();
    const flippedShell = patchFeatureEditSession(shellSession, {
      [shellThicknessField.directionToggle.patch.patchKey]:
        shellThicknessField.directionToggle.reverseValue,
    });
    const shellDefinition = buildFeatureDefinition(flippedShell);
    expect(
      shellDefinition?.kind === "shell" &&
        shellDefinition.parameters.direction === "outside",
      "Shell direction flip should preserve an outside wall direction.",
    ).toBeTruthy();

    const thickenSession = createFeatureEditSession({
      featureType: "thicken",
      selectedTarget: face,
    });
    const thickenThicknessField = getFormField(
      thickenSession,
      "thicken-thickness",
    );
    expect(
      thickenThicknessField?.kind === "numeric" &&
        thickenThicknessField.directionToggle,
      "Thicken thickness should expose a normal direction flip toggle.",
    ).toBeTruthy();
    const flippedThicken = patchFeatureEditSession(thickenSession, {
      [thickenThicknessField.directionToggle.patch.patchKey]:
        thickenThicknessField.directionToggle.reverseValue,
    });
    const thickenDefinition = buildFeatureDefinition(flippedThicken);
    expect(
      thickenDefinition?.kind === "thicken" &&
        getAuthoredLiteralValue(
          thickenDefinition.parameters.options?.direction,
        ) === "negative",
      "Thicken direction flip should persist the negative normal direction.",
    ).toBeTruthy();

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
    expect(
      transformDistanceField?.kind === "numeric" &&
        transformDistanceField.directionToggle,
      "Transform distance should expose a normal direction flip toggle.",
    ).toBeTruthy();
    const flippedTransform = patchFeatureEditSession(transformSession, {
      [transformDistanceField.directionToggle.patch.patchKey]:
        transformDistanceField.directionToggle.reverseValue,
    });
    const transformDefinition = buildFeatureDefinition(flippedTransform);
    expect(
      transformDefinition?.kind === "transform" &&
        getAuthoredLiteralValue(
          transformDefinition.parameters.options?.direction,
        ) === "negative",
      "Transform direction flip should persist the negative normal direction.",
    ).toBeTruthy();

    const filletSession = createFeatureEditSession({
      featureType: "fillet",
      selectedTarget: { kind: "edge", bodyId: "body_a", edgeId: "edge_a" },
    });
    const filletRadiusField = getFormField(filletSession, "fillet-radius");
    expect(
      filletRadiusField?.kind === "numeric" &&
        !filletRadiusField.directionToggle,
      "Fillet radius should not expose an ambiguous direction toggle.",
    ).toBeTruthy();

    const chamferSession = createFeatureEditSession({
      featureType: "chamfer",
      selectedTarget: { kind: "edge", bodyId: "body_a", edgeId: "edge_a" },
    });
    const chamferDistanceField = getFormField(
      chamferSession,
      "chamfer-distance",
    );
    expect(
      chamferDistanceField?.kind === "numeric" &&
        !chamferDistanceField.directionToggle,
      "Chamfer distance should not expose an ambiguous direction toggle.",
    ).toBeTruthy();
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
    expect(
      symmetricExtrude?.kind === "extrude" &&
        symmetricExtrude.parameters.extent?.mode === "symmetric" &&
        symmetricExtrude.parameters.extent.end.kind === "blind" &&
        getAuthoredLiteralValue(
          symmetricExtrude.parameters.extent.end.distance,
        ) === 8,
      "Symmetric extrude drafts should build one mirrored blind authored end.",
    ).toBeTruthy();

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
    expect(
      twoSideExtrude?.kind === "extrude" &&
        twoSideExtrude.parameters.extent?.mode === "twoSide" &&
        twoSideExtrude.parameters.extent.firstEnd.kind === "blind" &&
        twoSideExtrude.parameters.extent.secondEnd.kind === "blind" &&
        getAuthoredLiteralValue(
          twoSideExtrude.parameters.extent.secondEnd.distance,
        ) === 3,
      "Two-side extrude drafts should preserve independent first and second ends.",
    ).toBeTruthy();
    const hydratedTwoSideExtrude = twoSideExtrude
      ? hydrateFeatureEditSession({
          featureId: "feature_two_side_extrude",
          definition: twoSideExtrude,
        })
      : null;
    expect(
      hydratedTwoSideExtrude?.featureType === "extrude" &&
        hydratedTwoSideExtrude.draft.extentMode === "twoSide" &&
        hydratedTwoSideExtrude.draft.secondEnd.kind === "blind" &&
        getAuthoredLiteralValue(
          hydratedTwoSideExtrude.draft.secondEnd.distance,
        ) === 3,
      "Advanced extrude snapshot hydration should preserve two-side end controls.",
    ).toBeTruthy();

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
    expect(
      upToNextExtrude?.kind === "extrude" &&
        upToNextExtrude.parameters.extent?.mode === "oneSide" &&
        upToNextExtrude.parameters.extent.end.kind === "upToNext" &&
        !("target" in upToNextExtrude.parameters.extent.end),
      "Up-to-next extrude drafts should remain targetless while preserving offsets.",
    ).toBeTruthy();

    const throughAllExtrude = buildFeatureDefinition(
      patchFeatureEditSession(
        createFeatureEditSession({
          featureType: "extrude",
          selectedTarget: profile,
        }),
        { endCondition: "throughAll" },
      ),
    );
    expect(
      throughAllExtrude?.kind === "extrude" &&
        throughAllExtrude.parameters.extent?.mode === "oneSide" &&
        throughAllExtrude.parameters.extent.end.kind === "throughAll",
      "Through-all extrude drafts should build without a depth.",
    ).toBeTruthy();

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
    expect(
      fullRevolve?.kind === "revolve" &&
        fullRevolve.parameters.extent.kind !== "angle" &&
        fullRevolve.parameters.extent.mode === "oneSide" &&
        fullRevolve.parameters.extent.end.kind === "full",
      "Full revolve drafts should build without an angle value.",
    ).toBeTruthy();

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
    expect(
      extrudeTargetField?.kind === "referencePicker" &&
        extrudeTargetField.picker.selectionFilter.allowedKinds.length === 1 &&
        extrudeTargetField.picker.selectionFilter.allowedKinds[0] === "face",
      "Up-to-face extrude target picker should only accept face targets.",
    ).toBeTruthy();
    expect(
      buildFeatureDefinition(missingTargetExtrude),
      "Targeted up-to extrudes should not build without a required target.",
    ).toBe(null);

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
    expect(
      revolveTargetField?.kind === "referencePicker" &&
        revolveTargetField.picker.selectionFilter.allowedKinds.length === 1 &&
        revolveTargetField.picker.selectionFilter.allowedKinds[0] === "vertex",
      "Up-to-vertex revolve target picker should only accept vertex targets.",
    ).toBeTruthy();
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

    expect(
      extrude?.advancedParticipants?.some(
        (participant) => participant.role === "profile",
      ),
      "Extrude should declare profile participants for profile/path substrate coverage.",
    ).toBeTruthy();
    expect(
      fillet?.advancedParticipants?.some(
        (participant) => participant.role === "edge",
      ),
      "Fillet should declare edge participants for topology modifier substrate coverage.",
    ).toBeTruthy();
    expect(
      shell?.advancedParticipants?.some(
        (participant) => participant.role === "body",
      ),
      "Shell should declare body participants for body-operation substrate coverage.",
    ).toBeTruthy();
    expect(
      sweep?.advancedParticipants?.some(
        (participant) => participant.role === "path",
      ),
      "Sweep should declare path participants for profile/path substrate coverage.",
    ).toBeTruthy();
    expect(
      loft?.advancedParticipants?.some(
        (participant) => participant.role === "profile",
      ),
      "Loft should declare ordered profile participants for profile-family coverage.",
    ).toBeTruthy();
    expect(
      chamfer?.advancedParticipants?.some(
        (participant) => participant.role === "edge",
      ),
      "Chamfer should declare edge participants for topology modifier substrate coverage.",
    ).toBeTruthy();
    expect(
      thicken?.advancedParticipants?.some(
        (participant) => participant.role === "face",
      ),
      "Thicken should declare face participants for face-driven advanced solid coverage.",
    ).toBeTruthy();
    expect(
      combine?.advancedParticipants?.some(
        (participant) => participant.role === "targetBody",
      ),
      "Combine should declare explicit targetBody participants for body boolean coverage.",
    ).toBeTruthy();
    expect(
      combine?.advancedParticipants?.some(
        (participant) => participant.role === "toolBody",
      ),
      "Combine should declare explicit toolBody participants for body boolean coverage.",
    ).toBeTruthy();
    expect(
      split?.advancedParticipants?.some(
        (participant) => participant.role === "toolBody",
      ),
      "Split should declare explicit toolBody participants for body split coverage.",
    ).toBeTruthy();
    expect(
      deleteSolid?.advancedParticipants?.some(
        (participant) => participant.role === "body",
      ),
      "Delete-solid should declare explicit body participants for body removal coverage.",
    ).toBeTruthy();
    expect(
      mirror?.advancedParticipants?.some(
        (participant) => participant.role === "plane",
      ),
      "Mirror should declare an explicit mirror plane participant.",
    ).toBeTruthy();
    expect(
      transform?.advancedParticipants?.some(
        (participant) => participant.role === "transformReference",
      ),
      "Transform should declare an explicit transform reference participant.",
    ).toBeTruthy();

    const shellSession = createFeatureEditSession({
      featureType: "shell",
      selectedTarget: { kind: "face", bodyId: "body_a", faceId: "face_top" },
    });
    const shellFacesField = getFeatureEditorFormSchema(shellSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "shell-faces");

    expect(
      shellFacesField?.kind,
      "Shell form should expose removable faces as a reference collection.",
    ).toBe("referenceCollection");
    expect(
      shellFacesField.advancedParticipant?.role,
      "Shell form should expose the face participant role on the generic field.",
    ).toBe("face");

    const patch = createFeatureEditorReferenceSelectionPatch(shellFacesField, {
      kind: "face",
      bodyId: "body_a",
      faceId: "face_side",
    });
    expect(
      patch.participantRole,
      "Generic reference selection patches should preserve the participant role.",
    ).toBe("face");
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
      expect(
        source.includes("/occ/") && !source.includes("opencascade"),
        `${file} should not import kernel-specific modules.`,
      ).toBeFalsy();
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

    expect(
      revolveAngleField?.kind,
      "Revolve schema should expose the angle as a generic numeric field.",
    ).toBe("numeric");

    const patchedRevolve = patchFeatureEditSession(
      revolveSession,
      createFeatureEditorFieldPatch(revolveAngleField, 180),
    );

    expect(
      patchedRevolve.featureType === "revolve" &&
        patchedRevolve.draft.firstEnd.kind === "blind" &&
        Math.abs(patchedRevolve.draft.firstEnd.angle - Math.PI) < 0.000001,
      "Generic numeric form events should convert revolve angle degrees to draft radians.",
    ).toBeTruthy();

    const shellSession = createFeatureEditSession({
      featureType: "shell",
      selectedTarget: { kind: "face", bodyId: "body_a", faceId: "face_top" },
    });
    const shellOperationField = getFeatureEditorFormSchema(shellSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "shell-operation");

    expect(
      shellOperationField?.kind,
      "Shell schema should expose operation as a generic enum field.",
    ).toBe("enum");

    const patchedShell = patchFeatureEditSession(
      shellSession,
      createFeatureEditorFieldPatch(shellOperationField, "cut"),
    );

    expect(
      patchedShell.featureType === "shell" &&
        patchedShell.draft.operation === "cut",
      "Generic enum form events should patch shell operation without feature-specific inspector logic.",
    ).toBeTruthy();
  }

  function testGenericReferenceFormEventsPatchSingleAndMultiReferences() {
    const revolveSession = createFeatureEditSession({
      featureType: "revolve",
      selectedTarget: null,
    });
    const revolveAxisField = getFeatureEditorFormSchema(revolveSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "revolve-axis");

    expect(
      revolveAxisField?.kind,
      "Revolve schema should expose an axis reference picker.",
    ).toBe("referencePicker");

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

    expect(
      selectedRevolve.featureType === "revolve" &&
        selectedRevolve.draft.axisTarget?.kind === "edge" &&
        selectedRevolve.draft.axisTarget.edgeId === "edge_axis",
      "Generic single-reference selection events should patch the selected field.",
    ).toBeTruthy();
    expect(
      clearedRevolve.featureType === "revolve" &&
        clearedRevolve.draft.axisTarget === null,
      "Generic single-reference clear events should set the bound reference to null.",
    ).toBeTruthy();

    const shellSession = createFeatureEditSession({
      featureType: "shell",
      selectedTarget: { kind: "face", bodyId: "body_a", faceId: "face_top" },
    });
    const shellFacesField = getFeatureEditorFormSchema(shellSession)
      .sections.flatMap((section) => section.fields)
      .find((field) => field.id === "shell-faces");

    expect(
      shellFacesField?.kind,
      "Shell schema should expose removable faces as a reference collection.",
    ).toBe("referenceCollection");

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

    expect(
      appendedShell.featureType === "shell" &&
        appendedShell.draft.faceTargets.length === 2,
      "Generic multi-reference selection events should append unique selected instances.",
    ).toBeTruthy();
    expect(
      duplicateShell.featureType === "shell" &&
        duplicateShell.draft.faceTargets.length === 2,
      "Generic multi-reference selection events should ignore duplicate selected instances.",
    ).toBeTruthy();
    expect(
      removedShell.featureType === "shell" &&
        removedShell.draft.faceTargets.length === 1 &&
        removedShell.draft.faceTargets[0]?.faceId === "face_top",
      "Generic multi-reference remove events should remove only the requested selected instance.",
    ).toBeTruthy();
    expect(
      clearedShell.featureType === "shell" &&
        clearedShell.draft.faceTargets.length === 0,
      "Generic multi-reference clear events should remove all selected instances.",
    ).toBeTruthy();
  }

  testRegistryContainsCurrentFeatureSet();
  testRevolveDraftSelectionAndDefinitionBuilder();
  testExtrudeBooleanTargetSelectorVisibilityAndScope();
  testRevolveBooleanTargetSelectorVisibilityAndScope();
  testSweepDraftSelectionAndDefinitionBuilder();
  testSweepHydrationPreservesAuthoredAdvancedOptionsForEditing();
  testChamferDraftSelectionDistanceAndDefinitionBuilder();
  testHoleDraftSelectionConditionalFieldsAndDefinitionBuilder();
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
  expect(
    extrudeProfileField?.kind,
    "Extrude profiles should be collection-backed.",
  ).toBe("referenceCollection");
  expect(
    extrudeProfileField.picker.allowsMultiple,
    "Extrude profile picker should accept multiple profiles.",
  ).toBeTruthy();

  const extrudeMultiProfile = patchFeatureEditSession(
    extrudeSession,
    createFeatureEditorReferenceSelectionPatch(extrudeProfileField, profileB),
  );
  const extrudeDefinition = buildFeatureDefinition(extrudeMultiProfile);
  expect(
    extrudeDefinition?.kind,
    "Multi-profile extrude drafts should build an extrude definition.",
  ).toBe("extrude");
  expect(
    extrudeDefinition.parameters.profiles[0],
    "Extrude definitions should preserve the first selected profile.",
  ).toBe(profileA);
  expect(
    extrudeDefinition.parameters.profiles[1],
    "Extrude definitions should preserve the appended selected profile.",
  ).toBe(profileB);

  const revolveSession = createFeatureEditSession({
    featureType: "revolve",
    selectedTarget: profileA,
  });
  const revolveProfileField = getFeatureEditorFormSchema(revolveSession)
    .sections.flatMap((section) => section.fields)
    .find((field) => field.id === "revolve-profile");
  expect(
    revolveProfileField?.kind,
    "Revolve profiles should be collection-backed.",
  ).toBe("referenceCollection");
  expect(
    revolveProfileField.picker.allowsMultiple,
    "Revolve profile picker should accept multiple profiles.",
  ).toBeTruthy();

  const revolveMultiProfile = applySelectionToFeatureEditSession(
    patchFeatureEditSession(
      revolveSession,
      createFeatureEditorReferenceSelectionPatch(revolveProfileField, profileB),
    ),
    axis,
  );
  const revolveDefinition = buildFeatureDefinition(revolveMultiProfile);
  expect(
    revolveDefinition?.kind,
    "Multi-profile revolve drafts should build a revolve definition.",
  ).toBe("revolve");
  expect(
    revolveDefinition.parameters.profiles[0],
    "Revolve definitions should preserve the first selected profile.",
  ).toBe(profileA);
  expect(
    revolveDefinition.parameters.profiles[1],
    "Revolve definitions should preserve the appended selected profile.",
  ).toBe(profileB);
  expect(
    revolveDefinition.parameters.axis,
    "Revolve definitions should keep the axis separate from profiles.",
  ).toBe(axis);

  const sweepSession = createFeatureEditSession({
    featureType: "sweep",
    selectedTarget: profileA,
  });
  const sweepProfileField = getFeatureEditorFormSchema(sweepSession)
    .sections.flatMap((section) => section.fields)
    .find((field) => field.id === "sweep-profile");
  expect(
    sweepProfileField?.kind,
    "Sweep profiles should be collection-backed.",
  ).toBe("referenceCollection");
  expect(
    sweepProfileField.picker.allowsMultiple,
    "Sweep profile picker should accept multiple profile participants.",
  ).toBeTruthy();

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
  expect(
    sweepProfiles?.[0],
    "Sweep profile participants should preserve the first selected profile.",
  ).toBe(profileA);
  expect(
    sweepProfiles?.[1],
    "Sweep profile participants should preserve the appended selected profile.",
  ).toBe(profileB);
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

  expect(
    combineSession.draft.targetBodyTargets[0]?.bodyId,
    "Feature session creation should seed the first adopted selection into the initial draft.",
  ).toBe(targetBody.bodyId);
  expect(
    combineSession.draft.toolBodyTargets[0]?.bodyId,
    "Feature session creation should replay later adopted selections through feature authoring applySelection.",
  ).toBe(toolBody.bodyId);

  const mirrorSession = createFeatureEditSession({
    featureType: "mirror",
    selectedTargets: [targetBody, planeTarget],
  });

  expect(
    mirrorSession.draft.bodyTargets[0]?.bodyId,
    "Mirror activation should preserve the first adopted body target.",
  ).toBe(targetBody.bodyId);
  expect(
    mirrorSession.draft.planeTarget?.constructionId,
    "Mirror activation should replay later adopted targets in order so the mirror plane is seeded.",
  ).toBe(planeTarget.constructionId);
});
