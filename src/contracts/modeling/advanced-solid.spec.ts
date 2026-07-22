import { test, expect } from "vitest";
import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  CHAMFER_WIDTH_OPTION_DESCRIPTORS,
  CIRCULAR_PATTERN_OPTION_DESCRIPTORS,
  LOFT_ADVANCED_OPTION_DESCRIPTORS,
  HOLE_OPTION_DESCRIPTORS,
  LINEAR_PATTERN_OPTION_DESCRIPTORS,
  SWEEP_ADVANCED_OPTION_DESCRIPTORS,
  validateAdvancedFeatureOptions,
  validateAdvancedSolidFeatureDefinition,
  type AdvancedSolidFeatureAuthoringDescriptor,
} from "@/contracts/modeling/advanced-solid";
import {
  createExpressionAuthoredValue,
  createLiteralAuthoredValue,
} from "@/contracts/modeling/authored-values";

test("src/contracts/modeling/advanced-solid.spec.ts", async () => {
  const sweepDescriptor = {
    featureKind: "sweep",
    participants: [
      {
        role: "profile",
        label: "Profile",
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ["region", "face"],
      },
      {
        role: "path",
        label: "Path",
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ["edge", "sketchEntity"],
      },
      {
        role: "targetBody",
        label: "Target body",
        required: false,
        cardinality: { min: 0, max: null },
        acceptedKinds: ["body"],
      },
      {
        role: "path",
        label: "Path",
        required: false,
        cardinality: { min: 0, max: 1 },
        acceptedKinds: ["edge", "sketchEntity"],
      },
      {
        role: "guideCurve",
        label: "Guide curve",
        required: false,
        cardinality: { min: 0, max: null },
        acceptedKinds: ["edge", "sketchEntity"],
      },
      {
        role: "lockProfileFace",
        label: "Lock profile face",
        required: false,
        cardinality: { min: 0, max: null },
        acceptedKinds: ["face"],
      },
      {
        role: "lockProfileDirection",
        label: "Lock profile direction",
        required: false,
        cardinality: { min: 0, max: 1 },
        acceptedKinds: ["edge", "construction"],
      },
    ],
    operationIntent: {
      supportedIntents: ["create", "add", "subtract"],
      requiredParticipantsByIntent: {
        add: ["targetBody"],
        subtract: ["targetBody"],
      },
    },
    options: SWEEP_ADVANCED_OPTION_DESCRIPTORS,
  } satisfies AdvancedSolidFeatureAuthoringDescriptor;

  const loftDescriptor = {
    featureKind: "loft",
    participants: [
      {
        role: "profile",
        label: "Profile",
        required: true,
        cardinality: { min: 2, max: null },
        acceptedKinds: ["region", "face"],
      },
      {
        role: "guideCurve",
        label: "Guide curve",
        required: false,
        cardinality: { min: 0, max: null },
        acceptedKinds: ["edge", "sketchEntity"],
      },
      {
        role: "targetBody",
        label: "Target body",
        required: false,
        cardinality: { min: 0, max: null },
        acceptedKinds: ["body"],
      },
    ],
    operationIntent: {
      supportedIntents: ["create", "add", "subtract", "intersect"],
      requiredParticipantsByIntent: {
        add: ["targetBody"],
        subtract: ["targetBody"],
        intersect: ["targetBody"],
      },
    },
    options: LOFT_ADVANCED_OPTION_DESCRIPTORS,
  } satisfies AdvancedSolidFeatureAuthoringDescriptor;

  const chamferDescriptor = {
    featureKind: "chamfer",
    participants: [
      {
        role: "edge",
        label: "Edge targets",
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ["edge"],
      },
    ],
    options: CHAMFER_WIDTH_OPTION_DESCRIPTORS,
  } satisfies AdvancedSolidFeatureAuthoringDescriptor;

  const holeDescriptor = {
    featureKind: "hole",
    participants: [
      {
        role: "location",
        label: "Hole locations",
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ["sketchPoint"],
      },
      {
        role: "body",
        label: "Body targets",
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ["body"],
      },
    ],
    options: HOLE_OPTION_DESCRIPTORS,
  } satisfies AdvancedSolidFeatureAuthoringDescriptor;

  const thickenDescriptor = {
    featureKind: "thicken",
    participants: [
      {
        role: "face",
        label: "Face targets",
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ["face"],
      },
      {
        role: "targetBody",
        label: "Boolean target body",
        required: false,
        cardinality: { min: 0, max: null },
        acceptedKinds: ["body"],
      },
    ],
    operationIntent: {
      supportedIntents: ["create", "add", "subtract", "intersect"],
      requiredParticipantsByIntent: {
        add: ["targetBody"],
        subtract: ["targetBody"],
        intersect: ["targetBody"],
      },
    },
    options: [
      {
        key: "thickness",
        label: "Thickness",
        required: true,
        valueKind: "positiveNumber",
      },
    ],
  } satisfies AdvancedSolidFeatureAuthoringDescriptor;

  const splitDescriptor = {
    featureKind: "split",
    participants: [
      {
        role: "targetBody",
        label: "Target body",
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ["body"],
      },
      {
        role: "toolBody",
        label: "Split tool body",
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ["body"],
      },
      {
        role: "plane",
        label: "Split plane",
        required: false,
        cardinality: { min: 0, max: 1 },
        acceptedKinds: ["construction", "face"],
      },
    ],
  } satisfies AdvancedSolidFeatureAuthoringDescriptor;

  const combineDescriptor = {
    featureKind: "combine",
    participants: [
      {
        role: "targetBody",
        label: "Target bodies",
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ["body"],
      },
      {
        role: "toolBody",
        label: "Tool bodies",
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ["body"],
      },
    ],
    operationIntent: {
      supportedIntents: ["add", "subtract", "intersect"],
      requiredParticipantsByIntent: {
        add: ["targetBody", "toolBody"],
        subtract: ["targetBody", "toolBody"],
        intersect: ["targetBody", "toolBody"],
      },
    },
  } satisfies AdvancedSolidFeatureAuthoringDescriptor;

  const deleteSolidDescriptor = {
    featureKind: "deleteSolid",
    participants: [
      {
        role: "body",
        label: "Body targets",
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ["body"],
      },
    ],
  } satisfies AdvancedSolidFeatureAuthoringDescriptor;

  const mirrorDescriptor = {
    featureKind: "mirror",
    participants: [
      {
        role: "body",
        label: "Body targets",
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ["body"],
      },
      {
        role: "plane",
        label: "Mirror plane",
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ["construction", "face"],
      },
    ],
    options: [
      {
        key: "copy",
        label: "Copy bodies",
        required: true,
        valueKind: "boolean",
      },
    ],
  } satisfies AdvancedSolidFeatureAuthoringDescriptor;

  const transformDescriptor = {
    featureKind: "transform",
    participants: [
      {
        role: "body",
        label: "Body targets",
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ["body"],
      },
      {
        role: "transformReference",
        label: "Transform reference",
        required: false,
        cardinality: { min: 0, max: 1 },
        acceptedKinds: ["construction", "face"],
      },
      {
        role: "axis",
        label: "Rotation axis",
        required: false,
        cardinality: { min: 0, max: 1 },
        acceptedKinds: ["construction", "face", "edge", "sketchEntity"],
      },
    ],
    options: [
      {
        key: "distance",
        label: "Distance",
        required: false,
        valueKind: "positiveNumber",
      },
    ],
  } satisfies AdvancedSolidFeatureAuthoringDescriptor;

  const linearPatternDescriptor = {
    featureKind: "linearPattern",
    participants: [
      {
        role: "body",
        label: "Seed bodies",
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ["body"],
      },
      {
        role: "direction",
        label: "Pattern direction",
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ["construction", "face", "edge", "sketchEntity"],
      },
    ],
    options: LINEAR_PATTERN_OPTION_DESCRIPTORS,
  } satisfies AdvancedSolidFeatureAuthoringDescriptor;

  const circularPatternDescriptor = {
    featureKind: "circularPattern",
    participants: [
      {
        role: "body",
        label: "Seed bodies",
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ["body"],
      },
      {
        role: "axis",
        label: "Pattern axis",
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ["construction", "face", "edge", "sketchEntity"],
      },
    ],
    options: CIRCULAR_PATTERN_OPTION_DESCRIPTORS,
  } satisfies AdvancedSolidFeatureAuthoringDescriptor;

  function testAdvancedParticipantValidationAcceptsRoleSpecificPayloads() {
    const diagnostics = validateAdvancedSolidFeatureDefinition(
      {
        kind: "sweep",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
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
                { kind: "edge", bodyId: "body_a", edgeId: "edge_path" },
              ],
            },
          ],
        },
      },
      sweepDescriptor,
    );

    expect(
      diagnostics.length,
      "Contract-valid advanced participant payloads should validate.",
    ).toBe(0);
  }

  function testAdvancedParticipantValidationRejectsMissingAndWrongKinds() {
    const diagnostics = validateAdvancedSolidFeatureDefinition(
      {
        kind: "sweep",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "create",
          participants: [
            { role: "profile", targets: [] },
            { role: "path", targets: [{ kind: "body", bodyId: "body_wrong" }] },
          ],
        },
      },
      sweepDescriptor,
    );

    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-missing-participant" &&
          diagnostic.role === "profile",
      ),
      "Missing required participant diagnostics should include the participant role.",
    ).toBeTruthy();
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "path",
      ),
      "Invalid target-kind diagnostics should include the participant role.",
    ).toBeTruthy();
  }

  function testAdvancedOperationIntentValidationRejectsUnsupportedModes() {
    const unsupportedIntentDiagnostics = validateAdvancedSolidFeatureDefinition(
      {
        kind: "sweep",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "intersect",
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
                { kind: "edge", bodyId: "body_a", edgeId: "edge_path" },
              ],
            },
          ],
        },
      },
      sweepDescriptor,
    );

    const missingTargetDiagnostics = validateAdvancedSolidFeatureDefinition(
      {
        kind: "sweep",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "add",
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
                { kind: "edge", bodyId: "body_a", edgeId: "edge_path" },
              ],
            },
          ],
        },
      },
      sweepDescriptor,
    );

    expect(
      unsupportedIntentDiagnostics.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-unsupported-operation",
      ),
      "Unsupported operation intent should produce a stable diagnostic code.",
    ).toBeTruthy();
    expect(
      missingTargetDiagnostics.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-missing-participant" &&
          diagnostic.role === "targetBody",
      ),
      "Operation-specific required participants should be validated by role.",
    ).toBeTruthy();
  }

  function testSweepPathCardinalityAndBooleanTargetValidation() {
    const invalidPathCardinality = validateAdvancedSolidFeatureDefinition(
      {
        kind: "sweep",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
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
                { kind: "edge", bodyId: "body_a", edgeId: "edge_path_a" },
                {
                  kind: "sketchEntity",
                  sketchId: "sketch_a",
                  entityId: "sketch_entity_path_b",
                },
              ],
            },
          ],
        },
      },
      sweepDescriptor,
    );

    const validBoolean = validateAdvancedSolidFeatureDefinition(
      {
        kind: "sweep",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "subtract",
          participants: [
            {
              role: "profile",
              targets: [
                {
                  kind: "face",
                  bodyId: "body_profile",
                  faceId: "face_profile",
                },
              ],
            },
            {
              role: "path",
              targets: [
                { kind: "edge", bodyId: "body_path", edgeId: "edge_path" },
              ],
            },
            {
              role: "targetBody",
              targets: [{ kind: "body", bodyId: "body_target" }],
            },
          ],
        },
      },
      sweepDescriptor,
    );

    expect(
      invalidPathCardinality.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-cardinality" &&
          diagnostic.role === "path",
      ),
      "Sweep path cardinality validation should reject multiple path targets.",
    ).toBeTruthy();
    expect(
      validBoolean.length,
      "Boolean sweep validation should accept an explicit targetBody participant.",
    ).toBe(0);
  }

  function testSweepAdvancedOptionsValidateActiveTwistAndScale() {
    const valid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "sweep",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
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
                { kind: "edge", bodyId: "body_a", edgeId: "edge_path" },
              ],
            },
          ],
          options: {
            profileControl: "keepProfileOrientation",
            twist: { type: "angle", angle: Math.PI / 2 },
            endScale: 1.25,
          },
        },
      },
      sweepDescriptor,
    );
    const invalidInactiveTwist = validateAdvancedSolidFeatureDefinition(
      {
        kind: "sweep",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
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
                { kind: "edge", bodyId: "body_a", edgeId: "edge_path" },
              ],
            },
          ],
          options: {
            profileControl: "none",
            twist: { type: "turns", turns: 1, angle: Math.PI / 2 },
            endScale: 1,
          },
        },
      },
      sweepDescriptor,
    );
    const invalidScale = validateAdvancedSolidFeatureDefinition(
      {
        kind: "sweep",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
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
                { kind: "edge", bodyId: "body_a", edgeId: "edge_path" },
              ],
            },
          ],
          options: {
            profileControl: "lockProfileDirection",
            twist: { type: "pitch", pitch: 2 },
            endScale: 0,
          },
        },
      },
      sweepDescriptor,
    );

    expect(
      valid.length,
      "Sweep validation should accept profile control, active twist, and positive end scale options.",
    ).toBe(0);
    expect(
      invalidInactiveTwist.some(
        (diagnostic) => diagnostic.code === "advanced-feature-invalid-option",
      ),
      "Sweep validation should reject inactive twist values in durable options.",
    ).toBeTruthy();
    expect(
      invalidScale.some(
        (diagnostic) => diagnostic.code === "advanced-feature-invalid-option",
      ),
      "Sweep validation should reject non-positive end scale.",
    ).toBeTruthy();
  }

  function testLoftValidationPreservesOrderedProfilesAndGuideCurves() {
    const valid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "loft",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "create",
          participants: [
            {
              role: "profile",
              targets: [
                { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
                { kind: "face", bodyId: "body_b", faceId: "face_b" },
              ],
            },
            {
              role: "guideCurve",
              targets: [
                { kind: "edge", bodyId: "body_guide", edgeId: "edge_guide" },
              ],
            },
          ],
        },
      },
      loftDescriptor,
    );

    expect(
      valid.length,
      "Loft validation should accept two or more ordered profiles and optional guide curves.",
    ).toBe(0);
  }

  function testLoftValidationPreservesPathGuidesProfileConditionsAndConnections() {
    const valid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "loft",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "create",
          participants: [
            {
              role: "profile",
              targets: [
                { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
                { kind: "face", bodyId: "body_b", faceId: "face_b" },
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
              targets: [
                { kind: "edge", bodyId: "body_guide", edgeId: "edge_guide" },
              ],
            },
          ],
          options: {
            path: { sectionCount: 5 },
            guideContinuity: "normalToGuide",
            profileConditions: {
              startCondition: "normal",
              startMagnitude: createExpressionAuthoredValue("start_scale"),
              endCondition: "tangent",
              endMagnitude: 1,
            },
            matchConnections: [
              {
                from: {
                  kind: "vertex",
                  bodyId: "body_a",
                  vertexId: "vertex_a",
                },
                to: { kind: "edge", bodyId: "body_b", edgeId: "edge_b" },
              },
            ],
          },
        },
      },
      loftDescriptor,
    );

    expect(
      valid.length,
      "Loft validation should accept path, guide continuity, profile conditions, and complete match connections.",
    ).toBe(0);
  }

  function testLoftValidationRejectsMissingProfilesAndInvalidBooleanTargets() {
    const missingProfiles = validateAdvancedSolidFeatureDefinition(
      {
        kind: "loft",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "create",
          participants: [
            {
              role: "profile",
              targets: [
                { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
              ],
            },
          ],
        },
      },
      loftDescriptor,
    );

    const invalidBoolean = validateAdvancedSolidFeatureDefinition(
      {
        kind: "loft",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "add",
          participants: [
            {
              role: "profile",
              targets: [
                { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
                { kind: "region", sketchId: "sketch_b", regionId: "region_b" },
              ],
            },
            {
              role: "targetBody",
              targets: [
                { kind: "face", bodyId: "body_wrong", faceId: "face_wrong" },
              ],
            },
          ],
        },
      },
      loftDescriptor,
    );

    expect(
      missingProfiles.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-missing-participant" &&
          diagnostic.role === "profile",
      ) &&
        missingProfiles.some(
          (diagnostic) =>
            diagnostic.code === "advanced-feature-invalid-cardinality" &&
            diagnostic.role === "profile",
        ),
      "Loft validation should require at least two profile targets.",
    ).toBeTruthy();
    expect(
      invalidBoolean.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "targetBody",
      ),
      "Loft boolean validation should require explicit body targets.",
    ).toBeTruthy();
  }

  function testLoftValidationRejectsInvalidSectionCountsGuideCurvesAndConnections() {
    const invalid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "loft",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "create",
          participants: [
            {
              role: "profile",
              targets: [
                { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
                { kind: "region", sketchId: "sketch_b", regionId: "region_b" },
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
              targets: [
                { kind: "face", bodyId: "body_wrong", faceId: "face_wrong" },
              ],
            },
          ],
          options: {
            path: { sectionCount: 0 },
            guideContinuity: "normalToGuide",
            matchConnections: [
              { from: { kind: "edge", bodyId: "body_a", edgeId: "edge_a" } },
            ],
          },
        },
      },
      loftDescriptor,
    );

    expect(
      invalid.some(
        (diagnostic) => diagnostic.code === "advanced-feature-invalid-option",
      ),
      "Loft validation should reject invalid path section counts and incomplete connections.",
    ).toBeTruthy();
    expect(
      invalid.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "guideCurve",
      ),
      "Loft validation should reject invalid guide-curve target kinds.",
    ).toBeTruthy();
  }

  function testSplitValidationAcceptsExplicitTargetAndToolBodies() {
    const diagnostics = validateAdvancedSolidFeatureDefinition(
      {
        kind: "split",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "targetBody",
              targets: [{ kind: "body", bodyId: "body_target" }],
            },
            {
              role: "toolBody",
              targets: [{ kind: "body", bodyId: "body_tool" }],
            },
          ],
        },
      },
      splitDescriptor,
    );

    expect(
      diagnostics.length,
      "Split validation should accept one explicit target body and one tool body.",
    ).toBe(0);
  }

  function testSplitValidationRejectsMissingBodiesAndUnsupportedToolFamilies() {
    const missingTool = validateAdvancedSolidFeatureDefinition(
      {
        kind: "split",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "targetBody",
              targets: [{ kind: "body", bodyId: "body_target" }],
            },
          ],
        },
      },
      splitDescriptor,
    );
    const invalidPlaneKind = validateAdvancedSolidFeatureDefinition(
      {
        kind: "split",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "targetBody",
              targets: [{ kind: "body", bodyId: "body_target" }],
            },
            {
              role: "plane",
              targets: [
                { kind: "edge", bodyId: "body_tool", edgeId: "edge_wrong" },
              ],
            },
          ],
        },
      },
      splitDescriptor,
    );
    const invalidTargetCardinality = validateAdvancedSolidFeatureDefinition(
      {
        kind: "split",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "targetBody",
              targets: [
                { kind: "body", bodyId: "body_target_a" },
                { kind: "body", bodyId: "body_target_b" },
              ],
            },
            {
              role: "toolBody",
              targets: [{ kind: "body", bodyId: "body_tool" }],
            },
          ],
        },
      },
      splitDescriptor,
    );

    expect(
      missingTool.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-missing-participant" &&
          diagnostic.role === "toolBody",
      ),
      "Split validation should require one explicit split tool participant.",
    ).toBeTruthy();
    expect(
      invalidPlaneKind.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "plane",
      ),
      "Split validation should reject unsupported split-tool target kinds.",
    ).toBeTruthy();
    expect(
      invalidTargetCardinality.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-cardinality" &&
          diagnostic.role === "targetBody",
      ),
      "Split validation should enforce the first-slice target-body cardinality.",
    ).toBeTruthy();
  }

  function testCombineValidationAcceptsExplicitTargetToolBodiesAndBooleanIntent() {
    const diagnostics = validateAdvancedSolidFeatureDefinition(
      {
        kind: "combine",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "subtract",
          participants: [
            {
              role: "targetBody",
              targets: [{ kind: "body", bodyId: "body_target" }],
            },
            {
              role: "toolBody",
              targets: [{ kind: "body", bodyId: "body_tool" }],
            },
          ],
        },
      },
      combineDescriptor,
    );

    expect(
      diagnostics.length,
      "Combine validation should accept explicit target bodies, tool bodies, and supported operation intent.",
    ).toBe(0);
  }

  function testCombineValidationRejectsMalformedParticipantsAndUnsupportedIntent() {
    const missingTool = validateAdvancedSolidFeatureDefinition(
      {
        kind: "combine",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "add",
          participants: [
            {
              role: "targetBody",
              targets: [{ kind: "body", bodyId: "body_target" }],
            },
          ],
        },
      },
      combineDescriptor,
    );
    const wrongTargetKind = validateAdvancedSolidFeatureDefinition(
      {
        kind: "combine",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "intersect",
          participants: [
            {
              role: "targetBody",
              targets: [
                { kind: "face", bodyId: "body_wrong", faceId: "face_wrong" },
              ],
            },
            {
              role: "toolBody",
              targets: [{ kind: "body", bodyId: "body_tool" }],
            },
          ],
        },
      },
      combineDescriptor,
    );
    const unsupportedIntent = validateAdvancedSolidFeatureDefinition(
      {
        kind: "combine",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "create",
          participants: [
            {
              role: "targetBody",
              targets: [{ kind: "body", bodyId: "body_target" }],
            },
            {
              role: "toolBody",
              targets: [{ kind: "body", bodyId: "body_tool" }],
            },
          ],
        },
      },
      combineDescriptor,
    );

    expect(
      missingTool.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-missing-participant" &&
          diagnostic.role === "toolBody",
      ),
      "Combine validation should require explicit tool bodies.",
    ).toBeTruthy();
    expect(
      wrongTargetKind.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "targetBody",
      ),
      "Combine validation should reject non-body target participants.",
    ).toBeTruthy();
    expect(
      unsupportedIntent.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-unsupported-operation",
      ),
      "Combine validation should reject unsupported operation intents.",
    ).toBeTruthy();
  }

  function testDeleteSolidValidationAcceptsAndRejectsExplicitBodyTargets() {
    const valid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "deleteSolid",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "body",
              targets: [
                { kind: "body", bodyId: "body_a" },
                { kind: "body", bodyId: "body_b" },
              ],
            },
          ],
        },
      },
      deleteSolidDescriptor,
    );
    const invalid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "deleteSolid",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "body",
              targets: [{ kind: "face", bodyId: "body_a", faceId: "face_a" }],
            },
          ],
        },
      },
      deleteSolidDescriptor,
    );

    expect(
      valid.length,
      "Delete-solid validation should accept one or more explicit body targets.",
    ).toBe(0);
    expect(
      invalid.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "body",
      ),
      "Delete-solid validation should reject non-body participants.",
    ).toBeTruthy();
  }

  function testMirrorValidationAcceptsExplicitBodiesPlaneAndCopyPolicy() {
    const valid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "mirror",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            { role: "body", targets: [{ kind: "body", bodyId: "body_a" }] },
            {
              role: "plane",
              targets: [
                {
                  kind: "construction",
                  constructionId: "construction_plane-xy",
                },
              ],
            },
          ],
          options: { copy: true },
        },
      },
      mirrorDescriptor,
    );

    const invalid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "mirror",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "body",
              targets: [{ kind: "face", bodyId: "body_a", faceId: "face_top" }],
            },
            {
              role: "plane",
              targets: [
                { kind: "edge", bodyId: "body_a", edgeId: "edge_wrong" },
              ],
            },
          ],
          options: { copy: "yes" },
        },
      },
      mirrorDescriptor,
    );

    expect(
      valid.length,
      "Mirror validation should accept explicit body targets, a planar reference, and a boolean copy policy.",
    ).toBe(0);
    expect(
      invalid.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "body",
      ),
      "Mirror validation should reject non-body target participants.",
    ).toBeTruthy();
    expect(
      invalid.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "plane",
      ),
      "Mirror validation should reject non-planar mirror references.",
    ).toBeTruthy();
    expect(
      invalid.some(
        (diagnostic) => diagnostic.code === "advanced-feature-invalid-option",
      ),
      "Mirror validation should reject non-boolean copy policies.",
    ).toBeTruthy();
  }

  function testTransformValidationAcceptsBodyOnlyScopeAndTypedDistance() {
    const valid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "transform",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "body",
              targets: [
                { kind: "body", bodyId: "body_a" },
                { kind: "body", bodyId: "body_b" },
              ],
            },
            {
              role: "transformReference",
              targets: [
                { kind: "face", bodyId: "body_ref", faceId: "face_ref" },
              ],
            },
          ],
          options: { distance: 2 },
        },
      },
      transformDescriptor,
    );

    const validSketchAxisRotation = validateAdvancedSolidFeatureDefinition(
      {
        kind: "transform",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "body",
              targets: [{ kind: "body", bodyId: "body_rotation" }],
            },
            {
              role: "axis",
              targets: [
                {
                  kind: "sketchEntity",
                  sketchId: "sketch_rotation_axis",
                  entityId: "entity_rotation_axis",
                },
              ],
            },
          ],
          options: { transformType: "rotation", angle: 90 },
        },
      },
      transformDescriptor,
    );

    const invalid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "transform",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "body",
              targets: [
                {
                  kind: "construction",
                  constructionId: "construction_plane-xy",
                },
              ],
            },
            {
              role: "transformReference",
              targets: [{ kind: "body", bodyId: "body_wrong" }],
            },
          ],
          options: { widthForm: "equalOffsets", distance: 0 }
        },
      },
      transformDescriptor,
    );

    expect(
      valid.length,
      "Transform validation should accept body-only targets, an explicit transform reference, and a positive distance.",
    ).toBe(0);
    expect(
      validSketchAxisRotation.length,
      "Transform validation should accept a sketch entity as a rotation axis.",
    ).toBe(0);
    expect(
      invalid.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "body",
      ),
      "Transform validation should reject non-body transform targets.",
    ).toBeTruthy();
    expect(
      invalid.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "transformReference",
      ),
      "Transform validation should reject non-planar transform references.",
    ).toBeTruthy();
    expect(
      invalid.some(
        (diagnostic) => diagnostic.code === "advanced-feature-invalid-option",
      ),
      "Transform validation should reject non-positive transform distances.",
    ).toBeTruthy();
  }

  function testBodyPatternParticipantsOptionsAndCopyOnlyIntentValidation() {
    const validLinear = validateAdvancedSolidFeatureDefinition(
      {
        kind: "linearPattern",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            { role: "body", targets: [{ kind: "body", bodyId: "body_seed" }] },
            {
              role: "direction",
              targets: [{ kind: "edge", bodyId: "body_seed", edgeId: "edge_x" }],
            },
          ],
          options: {
            instanceCount: createLiteralAuthoredValue(3),
            spacing: createLiteralAuthoredValue(2.5),
            centered: createLiteralAuthoredValue(false),
            oppositeDirection: createLiteralAuthoredValue(false),
          },
        },
      },
      linearPatternDescriptor,
    );

    const invalidLinear = validateAdvancedSolidFeatureDefinition(
      {
        kind: "linearPattern",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: createLiteralAuthoredValue("add"),
          participants: [
            { role: "body", targets: [] },
            { role: "direction", targets: [{ kind: "body", bodyId: "body_wrong" }] },
            { role: "targetBody", targets: [{ kind: "body", bodyId: "body_target" }] },
          ],
          options: {
            instanceCount: createLiteralAuthoredValue(1),
            spacing: createLiteralAuthoredValue(0),
            oppositeDirection: createLiteralAuthoredValue(false),
            centered: createLiteralAuthoredValue(true),
          },
        },
      },
      linearPatternDescriptor,
    );

    const validCircular = validateAdvancedSolidFeatureDefinition(
      {
        kind: "circularPattern",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            { role: "body", targets: [{ kind: "body", bodyId: "body_seed" }] },
            {
              role: "axis",
              targets: [
                { kind: "sketchEntity", sketchId: "sketch_axis", entityId: "axis_entity" },
              ],
            },
          ],
          options: {
            instanceCount: createLiteralAuthoredValue(4),
            angleDegrees: createLiteralAuthoredValue(360),
            equalSpace: createLiteralAuthoredValue(true),
            oppositeDirection: createLiteralAuthoredValue(false),
          },
        },
      },
      circularPatternDescriptor,
    );

    const invalidCircular = validateAdvancedSolidFeatureDefinition(
      {
        kind: "circularPattern",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: createLiteralAuthoredValue("subtract"),
          participants: [
            { role: "body", targets: [{ kind: "face", bodyId: "body_seed", faceId: "face_wrong" }] },
            { role: "axis", targets: [] },
          ],
          options: {
            instanceCount: createLiteralAuthoredValue(1),
            angleDegrees: createLiteralAuthoredValue(0),
            equalSpace: createLiteralAuthoredValue(false),
            oppositeDirection: createLiteralAuthoredValue(true),
          },
        },
      },
      circularPatternDescriptor,
    );

    expect(
      validLinear.length,
      "Linear pattern validation should accept authored wrapper options, centered=false, seed bodies, and one direction.",
    ).toBe(0);
    expect(
      invalidLinear.some(
        (diagnostic) => diagnostic.code === "advanced-feature-unsupported-operation",
      ),
      "Linear body patterns are copy-only and should reject authored operation intent.",
    ).toBeTruthy();
    expect(
      invalidLinear.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-missing-participant" &&
          diagnostic.role === "body",
      ),
      "Linear body patterns should require at least one explicit seed body.",
    ).toBeTruthy();
    expect(
      invalidLinear.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "direction",
      ),
      "Linear body patterns should reject unsupported direction target kinds.",
    ).toBeTruthy();
    expect(
      invalidLinear.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-option" &&
          diagnostic.message.includes("centered=true"),
      ),
      "Linear body patterns should reject centered=true until OCC execution semantics are defined.",
    ).toBeTruthy();
    expect(
      invalidLinear.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-cardinality" &&
          diagnostic.role === "targetBody",
      ),
      "Linear body patterns should not accept boolean target participants.",
    ).toBeTruthy();

    expect(
      validCircular.length,
      "Circular equalSpace=true uses angleDegrees as total span divided by count, so 360 avoids a duplicate seed endpoint.",
    ).toBe(0);
    expect(
      invalidCircular.some(
        (diagnostic) => diagnostic.code === "advanced-feature-unsupported-operation",
      ),
      "Circular body patterns are copy-only and should reject authored operation intent.",
    ).toBeTruthy();
    expect(
      invalidCircular.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "body",
      ),
      "Circular body patterns should require body seed targets.",
    ).toBeTruthy();
    expect(
      invalidCircular.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-missing-participant" &&
          diagnostic.role === "axis",
      ),
      "Circular body patterns should require exactly one axis reference.",
    ).toBeTruthy();
    expect(
      invalidCircular.some(
        (diagnostic) => diagnostic.code === "advanced-feature-invalid-option",
      ),
      "Circular body patterns should reject count <2 and zero angle.",
    ).toBeTruthy();
  }

  testAdvancedParticipantValidationAcceptsRoleSpecificPayloads();
  testAdvancedParticipantValidationRejectsMissingAndWrongKinds();
  testAdvancedOperationIntentValidationRejectsUnsupportedModes();
  testSweepPathCardinalityAndBooleanTargetValidation();
  testSweepAdvancedOptionsValidateActiveTwistAndScale();
  testLoftValidationPreservesOrderedProfilesAndGuideCurves();
  testLoftValidationRejectsMissingProfilesAndInvalidBooleanTargets();
  testSplitValidationAcceptsExplicitTargetAndToolBodies();
  testSplitValidationRejectsMissingBodiesAndUnsupportedToolFamilies();
  testCombineValidationAcceptsExplicitTargetToolBodiesAndBooleanIntent();
  testCombineValidationRejectsMalformedParticipantsAndUnsupportedIntent();
  testDeleteSolidValidationAcceptsAndRejectsExplicitBodyTargets();
  testMirrorValidationAcceptsExplicitBodiesPlaneAndCopyPolicy();
  testTransformValidationAcceptsBodyOnlyScopeAndTypedDistance();
  testBodyPatternParticipantsOptionsAndCopyOnlyIntentValidation();
  testChamferEdgeParticipantsAndDistanceValidation();
  testHoleParticipantsAndOptionsValidation();

  function testChamferEdgeParticipantsAndDistanceValidation() {
    const valid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "chamfer",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "edge",
              targets: [
                { kind: "edge", bodyId: "body_a", edgeId: "edge_outer" },
              ],
            },
          ],
          options: { widthForm: "equalOffsets", distance: 0.5 }
        },
      },
      chamferDescriptor,
    );
    const wrongKind = validateAdvancedSolidFeatureDefinition(
      {
        kind: "chamfer",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "edge",
              targets: [{ kind: "face", bodyId: "body_a", faceId: "face_top" }],
            },
          ],
          options: { widthForm: "equalOffsets", distance: 0.5 }
        },
      },
      chamferDescriptor,
    );
    const invalidDistance = validateAdvancedSolidFeatureDefinition(
      {
        kind: "chamfer",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "edge",
              targets: [
                { kind: "edge", bodyId: "body_a", edgeId: "edge_outer" },
              ],
            },
          ],
          options: { distance: 0 },
        },
      },
      chamferDescriptor,
    );
    const validTwoOffsets = validateAdvancedSolidFeatureDefinition(
      {
        kind: "chamfer",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "edge",
              targets: [
                { kind: "edge", bodyId: "body_a", edgeId: "edge_outer" },
              ],
            },
          ],
          options: { widthForm: "twoOffsets", distance1: 0.5, distance2: 1.25 },
        },
      },
      chamferDescriptor,
    );
    const validOffsetAngle = validateAdvancedSolidFeatureDefinition(
      {
        kind: "chamfer",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "edge",
              targets: [
                { kind: "edge", bodyId: "body_a", edgeId: "edge_outer" },
              ],
            },
          ],
          options: { widthForm: "offsetAngle", distance: 0.5, angle: 45 },
        },
      },
      chamferDescriptor,
    );
    const invalidInactiveDistance = validateAdvancedSolidFeatureDefinition(
      {
        kind: "chamfer",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "edge",
              targets: [
                { kind: "edge", bodyId: "body_a", edgeId: "edge_outer" },
              ],
            },
          ],
          options: {
            widthForm: "twoOffsets",
            distance: 0.5,
            distance1: 0.25,
            distance2: 1,
          },
        },
      },
      chamferDescriptor,
    );

    expect(
      valid.length,
      "Chamfer validation should accept edge participants and a positive constant distance.",
    ).toBe(0);
    expect(
      wrongKind.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "edge",
      ),
      "Chamfer validation should reject non-edge participants.",
    ).toBeTruthy();
    expect(
      invalidDistance.some(
        (diagnostic) => diagnostic.code === "advanced-feature-invalid-option",
      ),
      "Chamfer validation should reject non-positive distances.",
    ).toBeTruthy();
    expect(
      validTwoOffsets.length,
      "Chamfer validation should accept two positive offset distances.",
    ).toBe(0);
    expect(
      validOffsetAngle.length,
      "Chamfer validation should accept positive distance plus finite angle options.",
    ).toBe(0);
    expect(
      invalidInactiveDistance.some(
        (diagnostic) => diagnostic.code === "advanced-feature-invalid-option",
      ),
      "Chamfer validation should reject values from inactive width-form variants.",
    ).toBeTruthy();
  }

  function testHoleParticipantsAndOptionsValidation() {
    const valid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "hole",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "location",
              targets: [
                { kind: "sketchPoint", sketchId: "sketch_a", pointId: "point_a" },
              ],
            },
            { role: "body", targets: [{ kind: "body", bodyId: "body_a" }] },
          ],
          options: {
            style: "counterbore",
            mainDiameter: 4,
            counterboreDiameter: 8,
            counterboreDepth: 2,
            termination: "blind",
            depth: 10,
          },
        },
      },
      holeDescriptor,
    );
    const wrongLocationKind = validateAdvancedSolidFeatureDefinition(
      {
        kind: "hole",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "location",
              targets: [{ kind: "vertex", bodyId: "body_a", vertexId: "vertex_a" }],
            },
            { role: "body", targets: [{ kind: "body", bodyId: "body_a" }] },
          ],
          options: { style: "simple", mainDiameter: 4, termination: "throughAll" },
        },
      },
      holeDescriptor,
    );
    const invalidCounterbore = validateAdvancedSolidFeatureDefinition(
      {
        kind: "hole",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "location",
              targets: [
                { kind: "sketchPoint", sketchId: "sketch_a", pointId: "point_a" },
              ],
            },
            { role: "body", targets: [{ kind: "body", bodyId: "body_a" }] },
          ],
          options: {
            style: "counterbore",
            mainDiameter: 4,
            counterboreDiameter: 4,
            counterboreDepth: 1,
            termination: "blind",
            depth: 8,
          },
        },
      },
      holeDescriptor,
    );
    const invalidCountersink = validateAdvancedSolidFeatureDefinition(
      {
        kind: "hole",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          participants: [
            {
              role: "location",
              targets: [
                { kind: "sketchPoint", sketchId: "sketch_a", pointId: "point_a" },
              ],
            },
            { role: "body", targets: [{ kind: "body", bodyId: "body_a" }] },
          ],
          options: {
            style: "countersink",
            mainDiameter: 4,
            countersinkDiameter: 8,
            countersinkAngleDegrees: 180,
            termination: "throughAll",
          },
        },
      },
      holeDescriptor,
    );
    const unsupportedIntent = validateAdvancedSolidFeatureDefinition(
      {
        kind: "hole",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "subtract",
          participants: [
            {
              role: "location",
              targets: [
                { kind: "sketchPoint", sketchId: "sketch_a", pointId: "point_a" },
              ],
            },
            { role: "body", targets: [{ kind: "body", bodyId: "body_a" }] },
          ],
          options: { style: "simple", mainDiameter: 4, termination: "throughAll" },
        },
      },
      holeDescriptor,
    );

    expect(valid.length, "Hole validation should accept sketch-point locations, body scope, and counterbore dimensions.").toBe(0);
    expect(
      wrongLocationKind.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "location",
      ),
      "Hole locations should initially reject vertex targets so direction is inherited from the sketch plane.",
    ).toBeTruthy();
    expect(
      invalidCounterbore.some(
        (diagnostic) => diagnostic.code === "advanced-feature-invalid-option",
      ),
      "Hole validation should require counterbore diameter greater than main diameter.",
    ).toBeTruthy();
    expect(
      invalidCountersink.some(
        (diagnostic) => diagnostic.code === "advanced-feature-invalid-option",
      ),
      "Hole validation should require countersink angle in (0, 180).",
    ).toBeTruthy();
    expect(
      unsupportedIntent.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-unsupported-operation",
      ),
      "Hole validation should remain implicitly subtractive and reject authored operation intent.",
    ).toBeTruthy();
  }

  function testThickenFaceParticipantsAndThicknessValidation() {
    const valid = validateAdvancedSolidFeatureDefinition(
      {
        kind: "thicken",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "create",
          participants: [
            {
              role: "face",
              targets: [
                { kind: "face", bodyId: "body_a", faceId: "face_outer" },
              ],
            },
          ],
          options: { thickness: 0.5, side: "oneSide" },
        },
      },
      thickenDescriptor,
    );
    const wrongKind = validateAdvancedSolidFeatureDefinition(
      {
        kind: "thicken",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "create",
          participants: [
            {
              role: "face",
              targets: [
                { kind: "edge", bodyId: "body_a", edgeId: "edge_outer" },
              ],
            },
          ],
          options: { thickness: 0.5, side: "oneSide" },
        },
      },
      thickenDescriptor,
    );
    const invalidThickness = validateAdvancedSolidFeatureDefinition(
      {
        kind: "thicken",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "create",
          participants: [
            {
              role: "face",
              targets: [
                { kind: "face", bodyId: "body_a", faceId: "face_outer" },
              ],
            },
          ],
          options: { thickness: 0, side: "oneSide" },
        },
      },
      thickenDescriptor,
    );
    const missingTargetBody = validateAdvancedSolidFeatureDefinition(
      {
        kind: "thicken",
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: "subtract",
          participants: [
            {
              role: "face",
              targets: [
                { kind: "face", bodyId: "body_a", faceId: "face_outer" },
              ],
            },
          ],
          options: { thickness: 0.5, side: "symmetric" },
        },
      },
      thickenDescriptor,
    );

    expect(
      valid.length,
      "Thicken validation should accept face participants and positive thickness.",
    ).toBe(0);
    expect(
      wrongKind.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-invalid-target-kind" &&
          diagnostic.role === "face",
      ),
      "Thicken validation should reject non-face participants.",
    ).toBeTruthy();
    expect(
      invalidThickness.some(
        (diagnostic) => diagnostic.code === "advanced-feature-invalid-option",
      ),
      "Thicken validation should reject non-positive thickness values.",
    ).toBeTruthy();
    expect(
      missingTargetBody.some(
        (diagnostic) =>
          diagnostic.code === "advanced-feature-missing-participant" &&
          diagnostic.role === "targetBody",
      ),
      "Thicken boolean validation should require explicit target bodies.",
    ).toBeTruthy();
  }

  function testAdvancedOptionDescriptorsValidateAllScalarKindsAndGroups() {
    const diagnostics = validateAdvancedFeatureOptions(
      {
        enabled: true,
        mode: "smooth",
        draftAngle: Math.PI / 8,
        distance: 2,
        sectionCount: 4,
        continuity: {
          enabled: false,
          mode: "sharp",
        },
      },
      [
        {
          key: "enabled",
          label: "Enabled",
          required: true,
          valueKind: "boolean",
        },
        {
          key: "mode",
          label: "Mode",
          required: true,
          valueKind: "enum",
          enumValues: ["smooth", "sharp"],
        },
        {
          key: "draftAngle",
          label: "Draft angle",
          required: true,
          valueKind: "angle",
        },
        {
          key: "distance",
          label: "Distance",
          required: true,
          valueKind: "positiveNumber",
        },
        {
          key: "sectionCount",
          label: "Section count",
          required: true,
          valueKind: "positiveInteger",
        },
        {
          key: "continuity",
          label: "Continuity",
          required: true,
          valueKind: "group",
          options: [
            {
              key: "enabled",
              label: "Continuity enabled",
              required: true,
              valueKind: "boolean",
            },
            {
              key: "mode",
              label: "Continuity mode",
              required: true,
              valueKind: "enum",
              enumValues: ["sharp", "tangent"],
            },
          ],
        },
      ],
    );

    const invalid = validateAdvancedFeatureOptions({ sectionCount: 2.5 }, [
      {
        key: "sectionCount",
        label: "Section count",
        required: true,
        valueKind: "positiveInteger",
      },
    ]);

    expect(
      diagnostics.length,
      "Advanced option descriptors should validate boolean, enum, angle, numeric, integer, and group values.",
    ).toBe(0);
    expect(
      invalid.some(
        (diagnostic) => diagnostic.code === "advanced-feature-invalid-option",
      ),
      "Positive integer option validation should reject non-integer values.",
    ).toBeTruthy();
  }

  function testDiscriminatedOptionValidationRejectsInactiveVariantValues() {
    const descriptors = [
      {
        key: "twist",
        label: "Twist",
        required: true,
        valueKind: "discriminatedGroup",
        discriminantKey: "twistType",
        variants: [
          {
            value: "none",
            label: "None",
            options: [],
          },
          {
            value: "angle",
            label: "Angle",
            options: [
              {
                key: "twistAngle",
                label: "Twist angle",
                required: true,
                valueKind: "angle",
              },
            ],
          },
          {
            value: "pitch",
            label: "Pitch",
            options: [
              {
                key: "turns",
                label: "Turns",
                required: true,
                valueKind: "positiveNumber",
              },
              {
                key: "pitch",
                label: "Pitch",
                required: true,
                valueKind: "positiveNumber",
              },
            ],
          },
        ],
      },
    ] as const;

    const valid = validateAdvancedFeatureOptions(
      {
        twistType: "angle",
        twistAngle: createExpressionAuthoredValue("twist"),
      },
      descriptors,
    );
    const invalid = validateAdvancedFeatureOptions(
      {
        twistType: "angle",
        twistAngle: Math.PI,
        turns: 2,
        pitch: 10,
      },
      descriptors,
    );

    expect(
      valid.length,
      "Expression-authored active variant values should remain valid before expression resolution.",
    ).toBe(0);
    expect(
      invalid.some((diagnostic) =>
        diagnostic.message.includes("inactive turns"),
      ),
      "Discriminated option validation should reject stale inactive variant values.",
    ).toBeTruthy();
  }

  testAdvancedParticipantValidationAcceptsRoleSpecificPayloads();
  testAdvancedParticipantValidationRejectsMissingAndWrongKinds();
  testAdvancedOperationIntentValidationRejectsUnsupportedModes();
  testSweepPathCardinalityAndBooleanTargetValidation();
  testLoftValidationPreservesOrderedProfilesAndGuideCurves();
  testLoftValidationPreservesPathGuidesProfileConditionsAndConnections();
  testLoftValidationRejectsMissingProfilesAndInvalidBooleanTargets();
  testLoftValidationRejectsInvalidSectionCountsGuideCurvesAndConnections();
  testSplitValidationAcceptsExplicitTargetAndToolBodies();
  testSplitValidationRejectsMissingBodiesAndUnsupportedToolFamilies();
  testCombineValidationAcceptsExplicitTargetToolBodiesAndBooleanIntent();
  testCombineValidationRejectsMalformedParticipantsAndUnsupportedIntent();
  testDeleteSolidValidationAcceptsAndRejectsExplicitBodyTargets();
  testChamferEdgeParticipantsAndDistanceValidation();
  testThickenFaceParticipantsAndThicknessValidation();
  testBodyPatternParticipantsOptionsAndCopyOnlyIntentValidation();
  testAdvancedOptionDescriptorsValidateAllScalarKindsAndGroups();
  testDiscriminatedOptionValidationRejectsInactiveVariantValues();
});
