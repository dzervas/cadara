import { test } from 'bun:test'
import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  validateAdvancedSolidFeatureDefinition,
  type AdvancedSolidFeatureAuthoringDescriptor,
} from '@/contracts/modeling/advanced-solid'

test('src/contracts/modeling/advanced-solid.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const sweepDescriptor = {
    featureKind: 'sweep',
    participants: [
      {
        role: 'profile',
        label: 'Profile',
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ['region', 'face'],
      },
      {
        role: 'path',
        label: 'Path',
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ['edge', 'sketchEntity'],
      },
      {
        role: 'targetBody',
        label: 'Target body',
        required: false,
        cardinality: { min: 0, max: null },
        acceptedKinds: ['body'],
      },
      {
        role: 'guideCurve',
        label: 'Guide curve',
        required: false,
        cardinality: { min: 0, max: null },
        acceptedKinds: ['edge', 'sketchEntity'],
      },
    ],
    operationIntent: {
      supportedIntents: ['create', 'add', 'subtract'],
      requiredParticipantsByIntent: {
        add: ['targetBody'],
        subtract: ['targetBody'],
      },
    },
  } satisfies AdvancedSolidFeatureAuthoringDescriptor

  const loftDescriptor = {
    featureKind: 'loft',
    participants: [
      {
        role: 'profile',
        label: 'Profile',
        required: true,
        cardinality: { min: 2, max: null },
        acceptedKinds: ['region', 'face'],
      },
      {
        role: 'guideCurve',
        label: 'Guide curve',
        required: false,
        cardinality: { min: 0, max: null },
        acceptedKinds: ['edge', 'sketchEntity'],
      },
      {
        role: 'targetBody',
        label: 'Target body',
        required: false,
        cardinality: { min: 0, max: null },
        acceptedKinds: ['body'],
      },
    ],
    operationIntent: {
      supportedIntents: ['create', 'add', 'subtract', 'intersect'],
      requiredParticipantsByIntent: {
        add: ['targetBody'],
        subtract: ['targetBody'],
        intersect: ['targetBody'],
      },
    },
  } satisfies AdvancedSolidFeatureAuthoringDescriptor

  const chamferDescriptor = {
    featureKind: 'chamfer',
    participants: [
      {
        role: 'edge',
        label: 'Edge targets',
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ['edge'],
      },
    ],
    options: [
      {
        key: 'distance',
        label: 'Distance',
        required: true,
        valueKind: 'positiveNumber',
      },
    ],
  } satisfies AdvancedSolidFeatureAuthoringDescriptor

  const thickenDescriptor = {
    featureKind: 'thicken',
    participants: [
      {
        role: 'face',
        label: 'Face targets',
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ['face'],
      },
      {
        role: 'targetBody',
        label: 'Boolean target body',
        required: false,
        cardinality: { min: 0, max: null },
        acceptedKinds: ['body'],
      },
    ],
    operationIntent: {
      supportedIntents: ['create', 'add', 'subtract', 'intersect'],
      requiredParticipantsByIntent: {
        add: ['targetBody'],
        subtract: ['targetBody'],
        intersect: ['targetBody'],
      },
    },
    options: [
      {
        key: 'thickness',
        label: 'Thickness',
        required: true,
        valueKind: 'positiveNumber',
      },
    ],
  } satisfies AdvancedSolidFeatureAuthoringDescriptor

  const splitDescriptor = {
    featureKind: 'split',
    participants: [
      {
        role: 'targetBody',
        label: 'Target body',
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ['body'],
      },
      {
        role: 'toolBody',
        label: 'Split tool body',
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ['body'],
      },
      {
        role: 'plane',
        label: 'Split plane',
        required: false,
        cardinality: { min: 0, max: 1 },
        acceptedKinds: ['construction', 'face'],
      },
    ],
  } satisfies AdvancedSolidFeatureAuthoringDescriptor

  const deleteSolidDescriptor = {
    featureKind: 'deleteSolid',
    participants: [
      {
        role: 'body',
        label: 'Body targets',
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ['body'],
      },
    ],
  } satisfies AdvancedSolidFeatureAuthoringDescriptor

  const mirrorDescriptor = {
    featureKind: 'mirror',
    participants: [
      {
        role: 'body',
        label: 'Body targets',
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ['body'],
      },
      {
        role: 'plane',
        label: 'Mirror plane',
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ['construction', 'face'],
      },
    ],
    options: [
      {
        key: 'copy',
        label: 'Copy bodies',
        required: true,
        valueKind: 'boolean',
      },
    ],
  } satisfies AdvancedSolidFeatureAuthoringDescriptor

  const transformDescriptor = {
    featureKind: 'transform',
    participants: [
      {
        role: 'body',
        label: 'Body targets',
        required: true,
        cardinality: { min: 1, max: null },
        acceptedKinds: ['body'],
      },
      {
        role: 'transformReference',
        label: 'Transform reference',
        required: true,
        cardinality: { min: 1, max: 1 },
        acceptedKinds: ['construction', 'face'],
      },
    ],
    options: [
      {
        key: 'distance',
        label: 'Distance',
        required: true,
        valueKind: 'positiveNumber',
      },
    ],
  } satisfies AdvancedSolidFeatureAuthoringDescriptor

  function testAdvancedParticipantValidationAcceptsRoleSpecificPayloads() {
    const diagnostics = validateAdvancedSolidFeatureDefinition({
      kind: 'sweep',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          { role: 'profile', targets: [{ kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' }] },
          { role: 'path', targets: [{ kind: 'edge', bodyId: 'body_a', edgeId: 'edge_path' }] },
        ],
      },
    }, sweepDescriptor)

    assert(diagnostics.length === 0, 'Contract-valid advanced participant payloads should validate.')
  }

  function testAdvancedParticipantValidationRejectsMissingAndWrongKinds() {
    const diagnostics = validateAdvancedSolidFeatureDefinition({
      kind: 'sweep',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          { role: 'profile', targets: [] },
          { role: 'path', targets: [{ kind: 'body', bodyId: 'body_wrong' }] },
        ],
      },
    }, sweepDescriptor)

    assert(
      diagnostics.some((diagnostic) => diagnostic.code === 'advanced-feature-missing-participant' && diagnostic.role === 'profile'),
      'Missing required participant diagnostics should include the participant role.',
    )
    assert(
      diagnostics.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-target-kind' && diagnostic.role === 'path'),
      'Invalid target-kind diagnostics should include the participant role.',
    )
  }

  function testAdvancedOperationIntentValidationRejectsUnsupportedModes() {
    const unsupportedIntentDiagnostics = validateAdvancedSolidFeatureDefinition({
      kind: 'sweep',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'intersect',
        participants: [
          { role: 'profile', targets: [{ kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' }] },
          { role: 'path', targets: [{ kind: 'edge', bodyId: 'body_a', edgeId: 'edge_path' }] },
        ],
      },
    }, sweepDescriptor)

    const missingTargetDiagnostics = validateAdvancedSolidFeatureDefinition({
      kind: 'sweep',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'add',
        participants: [
          { role: 'profile', targets: [{ kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' }] },
          { role: 'path', targets: [{ kind: 'edge', bodyId: 'body_a', edgeId: 'edge_path' }] },
        ],
      },
    }, sweepDescriptor)

    assert(
      unsupportedIntentDiagnostics.some((diagnostic) => diagnostic.code === 'advanced-feature-unsupported-operation'),
      'Unsupported operation intent should produce a stable diagnostic code.',
    )
    assert(
      missingTargetDiagnostics.some((diagnostic) => diagnostic.code === 'advanced-feature-missing-participant' && diagnostic.role === 'targetBody'),
      'Operation-specific required participants should be validated by role.',
    )
  }

  function testSweepPathCardinalityAndBooleanTargetValidation() {
    const invalidPathCardinality = validateAdvancedSolidFeatureDefinition({
      kind: 'sweep',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          { role: 'profile', targets: [{ kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' }] },
          {
            role: 'path',
            targets: [
              { kind: 'edge', bodyId: 'body_a', edgeId: 'edge_path_a' },
              { kind: 'sketchEntity', sketchId: 'sketch_a', entityId: 'sketch_entity_path_b' },
            ],
          },
        ],
      },
    }, sweepDescriptor)

    const validBoolean = validateAdvancedSolidFeatureDefinition({
      kind: 'sweep',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'subtract',
        participants: [
          { role: 'profile', targets: [{ kind: 'face', bodyId: 'body_profile', faceId: 'face_profile' }] },
          { role: 'path', targets: [{ kind: 'edge', bodyId: 'body_path', edgeId: 'edge_path' }] },
          { role: 'targetBody', targets: [{ kind: 'body', bodyId: 'body_target' }] },
        ],
      },
    }, sweepDescriptor)

    assert(
      invalidPathCardinality.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-cardinality' && diagnostic.role === 'path'),
      'Sweep path cardinality validation should reject multiple path targets.',
    )
    assert(validBoolean.length === 0, 'Boolean sweep validation should accept an explicit targetBody participant.')
  }

  function testLoftValidationPreservesOrderedProfilesAndGuideCurves() {
    const valid = validateAdvancedSolidFeatureDefinition({
      kind: 'loft',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          {
            role: 'profile',
            targets: [
              { kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' },
              { kind: 'face', bodyId: 'body_b', faceId: 'face_b' },
            ],
          },
          { role: 'guideCurve', targets: [{ kind: 'edge', bodyId: 'body_guide', edgeId: 'edge_guide' }] },
        ],
      },
    }, loftDescriptor)

    assert(valid.length === 0, 'Loft validation should accept two or more ordered profiles and optional guide curves.')
  }

  function testLoftValidationRejectsMissingProfilesAndInvalidBooleanTargets() {
    const missingProfiles = validateAdvancedSolidFeatureDefinition({
      kind: 'loft',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          { role: 'profile', targets: [{ kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' }] },
        ],
      },
    }, loftDescriptor)

    const invalidBoolean = validateAdvancedSolidFeatureDefinition({
      kind: 'loft',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'add',
        participants: [
          {
            role: 'profile',
            targets: [
              { kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' },
              { kind: 'region', sketchId: 'sketch_b', regionId: 'region_b' },
            ],
          },
          { role: 'targetBody', targets: [{ kind: 'face', bodyId: 'body_wrong', faceId: 'face_wrong' }] },
        ],
      },
    }, loftDescriptor)

    assert(
      missingProfiles.some((diagnostic) => diagnostic.code === 'advanced-feature-missing-participant' && diagnostic.role === 'profile')
        && missingProfiles.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-cardinality' && diagnostic.role === 'profile'),
      'Loft validation should require at least two profile targets.',
    )
    assert(
      invalidBoolean.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-target-kind' && diagnostic.role === 'targetBody'),
      'Loft boolean validation should require explicit body targets.',
    )
  }

  function testSplitValidationAcceptsExplicitTargetAndToolBodies() {
    const diagnostics = validateAdvancedSolidFeatureDefinition({
      kind: 'split',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'targetBody', targets: [{ kind: 'body', bodyId: 'body_target' }] },
          { role: 'toolBody', targets: [{ kind: 'body', bodyId: 'body_tool' }] },
        ],
      },
    }, splitDescriptor)

    assert(diagnostics.length === 0, 'Split validation should accept one explicit target body and one tool body.')
  }

  function testSplitValidationRejectsMissingBodiesAndUnsupportedToolFamilies() {
    const missingTool = validateAdvancedSolidFeatureDefinition({
      kind: 'split',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'targetBody', targets: [{ kind: 'body', bodyId: 'body_target' }] },
        ],
      },
    }, splitDescriptor)
    const invalidPlaneKind = validateAdvancedSolidFeatureDefinition({
      kind: 'split',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'targetBody', targets: [{ kind: 'body', bodyId: 'body_target' }] },
          { role: 'plane', targets: [{ kind: 'edge', bodyId: 'body_tool', edgeId: 'edge_wrong' }] },
        ],
      },
    }, splitDescriptor)
    const invalidTargetCardinality = validateAdvancedSolidFeatureDefinition({
      kind: 'split',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          {
            role: 'targetBody',
            targets: [
              { kind: 'body', bodyId: 'body_target_a' },
              { kind: 'body', bodyId: 'body_target_b' },
            ],
          },
          { role: 'toolBody', targets: [{ kind: 'body', bodyId: 'body_tool' }] },
        ],
      },
    }, splitDescriptor)

    assert(
      missingTool.some((diagnostic) => diagnostic.code === 'advanced-feature-missing-participant' && diagnostic.role === 'toolBody'),
      'Split validation should require one explicit split tool participant.',
    )
    assert(
      invalidPlaneKind.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-target-kind' && diagnostic.role === 'plane'),
      'Split validation should reject unsupported split-tool target kinds.',
    )
    assert(
      invalidTargetCardinality.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-cardinality' && diagnostic.role === 'targetBody'),
      'Split validation should enforce the first-slice target-body cardinality.',
    )
  }

  function testDeleteSolidValidationAcceptsAndRejectsExplicitBodyTargets() {
    const valid = validateAdvancedSolidFeatureDefinition({
      kind: 'deleteSolid',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          {
            role: 'body',
            targets: [
              { kind: 'body', bodyId: 'body_a' },
              { kind: 'body', bodyId: 'body_b' },
            ],
          },
        ],
      },
    }, deleteSolidDescriptor)
    const invalid = validateAdvancedSolidFeatureDefinition({
      kind: 'deleteSolid',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'body', targets: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_a' }] },
        ],
      },
    }, deleteSolidDescriptor)

    assert(valid.length === 0, 'Delete-solid validation should accept one or more explicit body targets.')
    assert(
      invalid.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-target-kind' && diagnostic.role === 'body'),
      'Delete-solid validation should reject non-body participants.',
    )
  }

  function testMirrorValidationAcceptsExplicitBodiesPlaneAndCopyPolicy() {
    const valid = validateAdvancedSolidFeatureDefinition({
      kind: 'mirror',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'body', targets: [{ kind: 'body', bodyId: 'body_a' }] },
          { role: 'plane', targets: [{ kind: 'construction', constructionId: 'construction_plane-xy' }] },
        ],
        options: { copy: true },
      },
    }, mirrorDescriptor)

    const invalid = validateAdvancedSolidFeatureDefinition({
      kind: 'mirror',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'body', targets: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }] },
          { role: 'plane', targets: [{ kind: 'edge', bodyId: 'body_a', edgeId: 'edge_wrong' }] },
        ],
        options: { copy: 'yes' },
      },
    }, mirrorDescriptor)

    assert(valid.length === 0, 'Mirror validation should accept explicit body targets, a planar reference, and a boolean copy policy.')
    assert(invalid.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-target-kind' && diagnostic.role === 'body'), 'Mirror validation should reject non-body target participants.')
    assert(invalid.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-target-kind' && diagnostic.role === 'plane'), 'Mirror validation should reject non-planar mirror references.')
    assert(invalid.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-option'), 'Mirror validation should reject non-boolean copy policies.')
  }

  function testTransformValidationAcceptsBodyOnlyScopeAndTypedDistance() {
    const valid = validateAdvancedSolidFeatureDefinition({
      kind: 'transform',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          {
            role: 'body',
            targets: [
              { kind: 'body', bodyId: 'body_a' },
              { kind: 'body', bodyId: 'body_b' },
            ],
          },
          { role: 'transformReference', targets: [{ kind: 'face', bodyId: 'body_ref', faceId: 'face_ref' }] },
        ],
        options: { distance: 2 },
      },
    }, transformDescriptor)

    const invalid = validateAdvancedSolidFeatureDefinition({
      kind: 'transform',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'body', targets: [{ kind: 'construction', constructionId: 'construction_plane-xy' }] },
          { role: 'transformReference', targets: [{ kind: 'body', bodyId: 'body_wrong' }] },
        ],
        options: { distance: 0 },
      },
    }, transformDescriptor)

    assert(valid.length === 0, 'Transform validation should accept body-only targets, an explicit transform reference, and a positive distance.')
    assert(invalid.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-target-kind' && diagnostic.role === 'body'), 'Transform validation should reject non-body transform targets.')
    assert(invalid.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-target-kind' && diagnostic.role === 'transformReference'), 'Transform validation should reject non-planar transform references.')
    assert(invalid.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-option'), 'Transform validation should reject non-positive transform distances.')
  }

  testAdvancedParticipantValidationAcceptsRoleSpecificPayloads()
  testAdvancedParticipantValidationRejectsMissingAndWrongKinds()
  testAdvancedOperationIntentValidationRejectsUnsupportedModes()
  testSweepPathCardinalityAndBooleanTargetValidation()
  testLoftValidationPreservesOrderedProfilesAndGuideCurves()
  testLoftValidationRejectsMissingProfilesAndInvalidBooleanTargets()
  testSplitValidationAcceptsExplicitTargetAndToolBodies()
  testSplitValidationRejectsMissingBodiesAndUnsupportedToolFamilies()
  testDeleteSolidValidationAcceptsAndRejectsExplicitBodyTargets()
  testMirrorValidationAcceptsExplicitBodiesPlaneAndCopyPolicy()
  testTransformValidationAcceptsBodyOnlyScopeAndTypedDistance()

  function testChamferEdgeParticipantsAndDistanceValidation() {
    const valid = validateAdvancedSolidFeatureDefinition({
      kind: 'chamfer',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'edge', targets: [{ kind: 'edge', bodyId: 'body_a', edgeId: 'edge_outer' }] },
        ],
        options: { distance: 0.5 },
      },
    }, chamferDescriptor)
    const wrongKind = validateAdvancedSolidFeatureDefinition({
      kind: 'chamfer',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'edge', targets: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }] },
        ],
        options: { distance: 0.5 },
      },
    }, chamferDescriptor)
    const invalidDistance = validateAdvancedSolidFeatureDefinition({
      kind: 'chamfer',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'edge', targets: [{ kind: 'edge', bodyId: 'body_a', edgeId: 'edge_outer' }] },
        ],
        options: { distance: 0 },
      },
    }, chamferDescriptor)

    assert(valid.length === 0, 'Chamfer validation should accept edge participants and a positive constant distance.')
    assert(
      wrongKind.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-target-kind' && diagnostic.role === 'edge'),
      'Chamfer validation should reject non-edge participants.',
    )
    assert(
      invalidDistance.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-option'),
      'Chamfer validation should reject non-positive distances.',
    )
  }

  function testThickenFaceParticipantsAndThicknessValidation() {
    const valid = validateAdvancedSolidFeatureDefinition({
      kind: 'thicken',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          { role: 'face', targets: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_outer' }] },
        ],
        options: { thickness: 0.5, side: 'oneSide' },
      },
    }, thickenDescriptor)
    const wrongKind = validateAdvancedSolidFeatureDefinition({
      kind: 'thicken',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          { role: 'face', targets: [{ kind: 'edge', bodyId: 'body_a', edgeId: 'edge_outer' }] },
        ],
        options: { thickness: 0.5, side: 'oneSide' },
      },
    }, thickenDescriptor)
    const invalidThickness = validateAdvancedSolidFeatureDefinition({
      kind: 'thicken',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          { role: 'face', targets: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_outer' }] },
        ],
        options: { thickness: 0, side: 'oneSide' },
      },
    }, thickenDescriptor)
    const missingTargetBody = validateAdvancedSolidFeatureDefinition({
      kind: 'thicken',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'subtract',
        participants: [
          { role: 'face', targets: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_outer' }] },
        ],
        options: { thickness: 0.5, side: 'symmetric' },
      },
    }, thickenDescriptor)

    assert(valid.length === 0, 'Thicken validation should accept face participants and positive thickness.')
    assert(
      wrongKind.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-target-kind' && diagnostic.role === 'face'),
      'Thicken validation should reject non-face participants.',
    )
    assert(
      invalidThickness.some((diagnostic) => diagnostic.code === 'advanced-feature-invalid-option'),
      'Thicken validation should reject non-positive thickness values.',
    )
    assert(
      missingTargetBody.some((diagnostic) => diagnostic.code === 'advanced-feature-missing-participant' && diagnostic.role === 'targetBody'),
      'Thicken boolean validation should require explicit target bodies.',
    )
  }

  testAdvancedParticipantValidationAcceptsRoleSpecificPayloads()
  testAdvancedParticipantValidationRejectsMissingAndWrongKinds()
  testAdvancedOperationIntentValidationRejectsUnsupportedModes()
  testSweepPathCardinalityAndBooleanTargetValidation()
  testLoftValidationPreservesOrderedProfilesAndGuideCurves()
  testLoftValidationRejectsMissingProfilesAndInvalidBooleanTargets()
  testSplitValidationAcceptsExplicitTargetAndToolBodies()
  testSplitValidationRejectsMissingBodiesAndUnsupportedToolFamilies()
  testDeleteSolidValidationAcceptsAndRejectsExplicitBodyTargets()
  testChamferEdgeParticipantsAndDistanceValidation()
  testThickenFaceParticipantsAndThicknessValidation()
})
