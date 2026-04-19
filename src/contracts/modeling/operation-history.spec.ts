import { test } from 'bun:test'
import {
  createAddDocumentVariableHistoryEntry,
  createCommitSketchHistoryEntry,
  createCreateFeatureHistoryEntry,
  createEmptyOperationHistory,
  createReorderFeatureHistoryEntry,
  createUpdateDocumentVariableHistoryEntry,
  validateOperationHistoryPayload,
  type ModelingOperationHistoryPayload,
} from '@/contracts/modeling/operation-history'
import type { AddDocumentVariableRequest, CommitSketchRequest, CreateFeatureRequest, FeatureDefinition, ReorderFeatureRequest, UpdateDocumentVariableRequest } from '@/contracts/modeling/schema'
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import { SKETCH_SCHEMA_VERSION } from '@/contracts/sketch/schema'
import {
  chamferAdvancedFeatureExample,
  combineAdvancedFeatureExample,
  deleteSolidAdvancedFeatureExample,
  loftAdvancedFeatureExample,
  mirrorAdvancedFeatureExample,
  splitAdvancedFeatureExample,
  sweepAdvancedFeatureExample,
  thickenAdvancedFeatureExample,
  transformAdvancedFeatureExample,
} from '@/contracts/modeling/advanced-solid'
import { createExpressionAuthoredValue, getAuthoredLiteralValue, isExpressionAuthoredValue } from '@/contracts/modeling/authored-values'

test('src/contracts/modeling/operation-history.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const sketchDefinition = {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: [],
    points: [],
    entityIds: [],
    entities: [],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  }

  const commitSketchRequest: CommitSketchRequest = {
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_0001',
    solverCorrelation: {
      requestId: 'request_commit',
      projectionRequestId: 'request_commit:project',
      validationRequestId: 'request_commit:validate',
      solveRequestId: 'request_commit:solve',
      regionRequestId: 'request_commit:regions',
    },
    sketchId: 'sketch_profile',
    sketchLabel: 'Profile',
    plane: {
      key: 'xy',
      support: { kind: 'construction', constructionId: 'construction_plane-xy' },
      frame: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
        linearUnit: 'documentLength',
        handedness: 'rightHanded',
      },
    },
    planeTarget: { kind: 'construction', constructionId: 'construction_plane-xy' },
    planeKey: 'xy',
    definition: sketchDefinition,
  }

  const createFeatureRequest: CreateFeatureRequest = {
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_0002',
    definition: {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [{ kind: 'region', sketchId: 'sketch_profile', regionId: 'region_profile' }],
        startExtent: { kind: 'profilePlane' },
        endExtent: { kind: 'blind', direction: 'positive', distance: 10 },
        operation: 'newBody',
        booleanScope: { kind: 'standalone' },
      },
    },
  }

  const createExtrudeDefinition = createFeatureRequest.definition as Extract<FeatureDefinition, { kind: 'extrude' }>

  const reorderFeatureRequest: ReorderFeatureRequest = {
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_0003',
    featureId: 'feature_extrude-2',
    beforeFeatureId: 'feature_extrude-1',
  }

  function createDraftSketchDefinition(sketchId: `sketch_${string}`) {
    return {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_1_rect-bottom-left',
        'sketch_point_1_rect-bottom-right',
        'sketch_point_1_rect-top-right',
        'sketch_point_1_rect-top-left',
      ] as const,
      points: [
        {
          pointId: 'sketch_point_1_rect-bottom-left',
          label: 'Rectangle 1 bottom left',
          target: { kind: 'sketchPoint' as const, sketchId, pointId: 'sketch_point_1_rect-bottom-left' },
          position: [-15.5, -5] as const,
          isConstruction: false,
        },
        {
          pointId: 'sketch_point_1_rect-bottom-right',
          label: 'Rectangle 1 bottom right',
          target: { kind: 'sketchPoint' as const, sketchId, pointId: 'sketch_point_1_rect-bottom-right' },
          position: [-5, -5] as const,
          isConstruction: false,
        },
        {
          pointId: 'sketch_point_1_rect-top-right',
          label: 'Rectangle 1 top right',
          target: { kind: 'sketchPoint' as const, sketchId, pointId: 'sketch_point_1_rect-top-right' },
          position: [-5, 4.5] as const,
          isConstruction: false,
        },
        {
          pointId: 'sketch_point_1_rect-top-left',
          label: 'Rectangle 1 top left',
          target: { kind: 'sketchPoint' as const, sketchId, pointId: 'sketch_point_1_rect-top-left' },
          position: [-15.5, 4.5] as const,
          isConstruction: false,
        },
      ],
      entityIds: [
        'sketch_entity_1_rect-bottom',
        'sketch_entity_1_rect-right',
        'sketch_entity_1_rect-top',
        'sketch_entity_1_rect-left',
      ] as const,
      entities: [
        {
          kind: 'lineSegment' as const,
          entityId: 'sketch_entity_1_rect-bottom',
          label: 'Rectangle 1 bottom',
          target: { kind: 'sketchEntity' as const, sketchId, entityId: 'sketch_entity_1_rect-bottom' },
          isConstruction: false,
          startPointId: 'sketch_point_1_rect-bottom-left',
          endPointId: 'sketch_point_1_rect-bottom-right',
        },
        {
          kind: 'lineSegment' as const,
          entityId: 'sketch_entity_1_rect-right',
          label: 'Rectangle 1 right',
          target: { kind: 'sketchEntity' as const, sketchId, entityId: 'sketch_entity_1_rect-right' },
          isConstruction: false,
          startPointId: 'sketch_point_1_rect-bottom-right',
          endPointId: 'sketch_point_1_rect-top-right',
        },
        {
          kind: 'lineSegment' as const,
          entityId: 'sketch_entity_1_rect-top',
          label: 'Rectangle 1 top',
          target: { kind: 'sketchEntity' as const, sketchId, entityId: 'sketch_entity_1_rect-top' },
          isConstruction: false,
          startPointId: 'sketch_point_1_rect-top-right',
          endPointId: 'sketch_point_1_rect-top-left',
        },
        {
          kind: 'lineSegment' as const,
          entityId: 'sketch_entity_1_rect-left',
          label: 'Rectangle 1 left',
          target: { kind: 'sketchEntity' as const, sketchId, entityId: 'sketch_entity_1_rect-left' },
          isConstruction: false,
          startPointId: 'sketch_point_1_rect-top-left',
          endPointId: 'sketch_point_1_rect-bottom-left',
        },
      ],
      constraintIds: [
        'constraint_1_bottom-horizontal',
        'constraint_1_top-horizontal',
        'constraint_1_right-vertical',
        'constraint_1_left-vertical',
      ] as const,
      constraints: [
        {
          constraintId: 'constraint_1_bottom-horizontal',
          kind: 'horizontal' as const,
          label: 'Rectangle 1 bottom horizontal',
          entityId: 'sketch_entity_1_rect-bottom',
        },
        {
          constraintId: 'constraint_1_top-horizontal',
          kind: 'horizontal' as const,
          label: 'Rectangle 1 top horizontal',
          entityId: 'sketch_entity_1_rect-top',
        },
        {
          constraintId: 'constraint_1_right-vertical',
          kind: 'vertical' as const,
          label: 'Rectangle 1 right vertical',
          entityId: 'sketch_entity_1_rect-right',
        },
        {
          constraintId: 'constraint_1_left-vertical',
          kind: 'vertical' as const,
          label: 'Rectangle 1 left vertical',
          entityId: 'sketch_entity_1_rect-left',
        },
      ],
      dimensionIds: ['dimension_1_width', 'dimension_1_height'] as const,
      dimensions: [
        {
          dimensionId: 'dimension_1_width',
          kind: 'distance' as const,
          label: 'Rectangle 1 width',
          axis: 'horizontal' as const,
          pointIds: ['sketch_point_1_rect-bottom-left', 'sketch_point_1_rect-bottom-right'] as const,
          value: 10.5,
        },
        {
          dimensionId: 'dimension_1_height',
          kind: 'distance' as const,
          label: 'Rectangle 1 height',
          axis: 'vertical' as const,
          pointIds: ['sketch_point_1_rect-bottom-right', 'sketch_point_1_rect-top-right'] as const,
          value: 9.5,
        },
      ],
    } satisfies CommitSketchRequest['definition']
  }

  function testValidatesRepresentativeHistory() {
    const payload: ModelingOperationHistoryPayload = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createCommitSketchHistoryEntry(commitSketchRequest, commitSketchRequest.sketchId!),
        createCreateFeatureHistoryEntry(createFeatureRequest),
        createReorderFeatureHistoryEntry(reorderFeatureRequest),
      ],
    }

    const result = validateOperationHistoryPayload(payload)

    assert(result.ok, 'Representative sketch and feature operation history should validate.')
    assert(result.payload.entries[0]?.kind === 'commitSketch', 'Commit sketch entry kind must be preserved.')
    assert(
      !('solverCorrelation' in result.payload.entries[0]!.payload),
      'Persisted sketch entries must omit solver request correlation metadata.',
    )
    assert(
      !('baseRevisionId' in result.payload.entries[1]!.payload),
      'Persisted feature entries must omit replay-derived base revision metadata.',
    )
  }

  function testNormalizesCommittedCommitSketchTargets() {
    const committedSketchId = 'sketch_committed'
    const entry = createCommitSketchHistoryEntry({
      ...commitSketchRequest,
      sketchId: null,
      definition: createDraftSketchDefinition('sketch_draft'),
    }, committedSketchId)

    assert(entry.kind === 'commitSketch', 'Commit sketch history entry should preserve its kind.')
    assert(entry.payload.sketchId === committedSketchId, 'Persisted commitSketch entries must store the committed sketch id.')
    assert(
      entry.payload.definition.points.every((point) => point.target.sketchId === committedSketchId),
      'Persisted commitSketch point targets must be normalized to the committed sketch id.',
    )
    assert(
      entry.payload.definition.entities.every((entity) => entity.target.sketchId === committedSketchId),
      'Persisted commitSketch entity targets must be normalized to the committed sketch id.',
    )
  }

  function testAcceptsLegacyDraftCommitSketchTargets() {
    const result = validateOperationHistoryPayload({
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        {
          kind: 'commitSketch',
          payload: {
            sketchId: null,
            sketchLabel: 'Legacy Draft Sketch',
            plane: commitSketchRequest.plane,
            planeTarget: commitSketchRequest.planeTarget,
            planeKey: commitSketchRequest.planeKey,
            definition: createDraftSketchDefinition('sketch_draft'),
          },
        },
      ],
    })

    assert(result.ok, 'Legacy commitSketch histories with draft sketch ids should remain loadable.')
  }

  function testRejectsUnsupportedVersion() {
    const result = validateOperationHistoryPayload({
      ...createEmptyOperationHistory('doc_workspace'),
      schemaVersion: 'modeling-operation-history/v0',
    })

    assert(!result.ok, 'Unsupported history schema versions must fail validation.')
    assert(
      !result.ok && result.reasonCode === 'unsupported-schema-version',
      'Unsupported history schema versions must report a stable reason code.',
    )
  }

  function testRejectsTransportMetadataLeak() {
    const result = validateOperationHistoryPayload({
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        {
          kind: 'createFeature',
          payload: {
            baseRevisionId: 'rev_0001',
            definition: createFeatureRequest.definition,
          },
        },
      ],
    })

    assert(!result.ok, 'Operation entries with transport metadata must fail validation.')
    assert(
      !result.ok && result.reasonCode === 'transport-field-leak',
      'Transport metadata leaks must report a stable reason code.',
    )
  }

  function testRejectsInconsistentCommitSketchTargets() {
    const result = validateOperationHistoryPayload({
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        {
          kind: 'commitSketch',
          payload: {
            sketchId: null,
            sketchLabel: 'Broken Sketch',
            plane: commitSketchRequest.plane,
            planeTarget: commitSketchRequest.planeTarget,
            planeKey: commitSketchRequest.planeKey,
            definition: {
              ...createDraftSketchDefinition('sketch_draft'),
              entities: [
                ...createDraftSketchDefinition('sketch_draft').entities.slice(0, 3),
                {
                  ...createDraftSketchDefinition('sketch_draft').entities[3]!,
                  target: {
                    kind: 'sketchEntity' as const,
                    sketchId: 'sketch_other',
                    entityId: 'sketch_entity_1_rect-left',
                  },
                },
              ],
            },
          },
        },
      ],
    })

    assert(!result.ok, 'Inconsistent commitSketch target sketch ids must fail validation.')
    assert(
      !result.ok && result.reasonCode === 'inconsistent-commit-sketch-targets',
      'Inconsistent commitSketch target sketch ids must report a stable reason code.',
    )
  }

  function testValidatesProfileCollectionFeaturePayloads() {
    const multiProfilePayload: ModelingOperationHistoryPayload = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createCreateFeatureHistoryEntry({
          ...createFeatureRequest,
          definition: {
            ...createExtrudeDefinition,
            parameters: {
              ...createExtrudeDefinition.parameters,
              profiles: [
                createExtrudeDefinition.parameters.profiles[0],
                { kind: 'region', sketchId: 'sketch_profile', regionId: 'region_inner' },
              ],
            },
          },
        }),
      ],
    }

    const result = validateOperationHistoryPayload(multiProfilePayload)

    assert(result.ok, 'One-profile and multi-profile extrude history payloads should validate.')
  }

  function testPreservesFeatureExpressionAuthoredValues() {
    const entry = createCreateFeatureHistoryEntry({
      ...createFeatureRequest,
      definition: {
        ...createExtrudeDefinition,
        parameters: {
          ...createExtrudeDefinition.parameters,
          endExtent: {
            ...createExtrudeDefinition.parameters.endExtent,
            distance: createExpressionAuthoredValue('depth + 3'),
          },
        },
      },
    })

    const result = validateOperationHistoryPayload({
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [entry],
    })

    assert(result.ok, 'Feature expression-authored history payloads should validate.')
    assert(result.payload.entries[0]?.kind === 'createFeature', 'Feature expression history entry kind should be preserved.')
    const definition = result.payload.entries[0].payload.definition
    assert(definition.kind === 'extrude', 'Feature expression history entry should preserve the extrude definition.')
    const distance = definition.parameters.endExtent.distance
    assert(isExpressionAuthoredValue(distance), 'Feature expression history should preserve authored expression text.')
    assert(distance.valueText === 'depth + 3', 'Feature expression history should not persist resolved runtime values.')
  }

  function testRejectsLegacyAndInvalidProfileCollections() {
    const legacyPayload = validateOperationHistoryPayload({
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [{
        kind: 'createFeature',
        payload: {
          definition: {
            ...createExtrudeDefinition,
            parameters: {
              ...createExtrudeDefinition.parameters,
              profiles: undefined,
              profile: createExtrudeDefinition.parameters.profiles[0],
            },
          },
        },
      }],
    })
    const emptyPayload = validateOperationHistoryPayload({
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [{
        kind: 'createFeature',
        payload: {
          definition: {
            ...createExtrudeDefinition,
            parameters: {
              ...createExtrudeDefinition.parameters,
              profiles: [],
            },
          },
        },
      }],
    })
    const duplicatePayload = validateOperationHistoryPayload({
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [{
        kind: 'updateFeature',
        payload: {
          featureId: 'feature_extrude-1',
          definition: {
            ...createExtrudeDefinition,
            parameters: {
              ...createExtrudeDefinition.parameters,
              profiles: [
                createExtrudeDefinition.parameters.profiles[0],
                createExtrudeDefinition.parameters.profiles[0],
              ],
            },
          },
        },
      }],
    })

    assert(!legacyPayload.ok && legacyPayload.reasonCode === 'legacy-profile-parameter', 'Legacy singular profile history payloads should be rejected.')
    assert(!emptyPayload.ok && emptyPayload.reasonCode === 'invalid-profile-collection', 'Empty profile collection history payloads should be rejected.')
    assert(!duplicatePayload.ok && duplicatePayload.reasonCode === 'duplicate-profile-reference', 'Duplicate profile collection history payloads should be rejected.')
  }

  function testPreservesAdvancedParticipantsAndOperationIntent() {
    const sweepSubtractDefinition = {
      ...sweepAdvancedFeatureExample,
      parameters: {
        ...sweepAdvancedFeatureExample.parameters,
        operationIntent: 'subtract' as const,
        participants: [
          ...sweepAdvancedFeatureExample.parameters.participants,
          { role: 'targetBody' as const, targets: [{ kind: 'body' as const, bodyId: 'body_target' as const }] },
        ],
      },
    }
    const payload: ModelingOperationHistoryPayload = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createCreateFeatureHistoryEntry({
          ...createFeatureRequest,
          definition: sweepSubtractDefinition,
        }),
        {
          kind: 'updateFeature',
          payload: {
            featureId: 'feature_sweep-1',
            definition: sweepSubtractDefinition,
          },
        },
      ],
    }

    const result = validateOperationHistoryPayload(payload)

    assert(result.ok, 'Advanced solid feature history payloads should validate.')
    assert(
        result.ok &&
        result.payload.entries[0]?.kind === 'createFeature' &&
        result.payload.entries[0].payload.definition.kind === 'sweep' &&
        getAuthoredLiteralValue(result.payload.entries[0].payload.definition.parameters.operationIntent) === 'subtract' &&
        result.payload.entries[1]?.kind === 'updateFeature' &&
        result.payload.entries[1].payload.definition.kind === 'sweep' &&
        result.payload.entries[1].payload.definition.parameters.participants.some((participant) => participant.role === 'targetBody'),
      'Sweep operation history must preserve participant roles and operation intent across create and update entries.',
    )
  }

  function testPreservesChamferParticipantsAndDistanceOptions() {
    const payload: ModelingOperationHistoryPayload = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createCreateFeatureHistoryEntry({
          ...createFeatureRequest,
          definition: chamferAdvancedFeatureExample,
        }),
        {
          kind: 'updateFeature',
          payload: {
            featureId: 'feature_chamfer-1',
            definition: {
              ...chamferAdvancedFeatureExample,
              parameters: {
                ...chamferAdvancedFeatureExample.parameters,
                options: { distance: 2 },
              },
            },
          },
        },
      ],
    }

    const result = validateOperationHistoryPayload(payload)

    assert(result.ok, 'Chamfer advanced solid feature history payloads should validate.')
    assert(
      result.ok &&
        result.payload.entries[0]?.kind === 'createFeature' &&
        result.payload.entries[0].payload.definition.kind === 'chamfer' &&
        result.payload.entries[0].payload.definition.parameters.participants.some((participant) => participant.role === 'edge') &&
        result.payload.entries[1]?.kind === 'updateFeature' &&
        result.payload.entries[1].payload.definition.kind === 'chamfer' &&
        getAuthoredLiteralValue(result.payload.entries[1].payload.definition.parameters.options?.distance) === 2,
      'Chamfer operation history must preserve edge participant roles and distance options across create and update entries.',
    )
  }

  function testPreservesSplitParticipantsAcrossCreateAndUpdateEntries() {
    const payload: ModelingOperationHistoryPayload = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createCreateFeatureHistoryEntry({
          ...createFeatureRequest,
          definition: splitAdvancedFeatureExample,
        }),
        {
          kind: 'updateFeature',
          payload: {
            featureId: 'feature_split-1',
            definition: {
              ...splitAdvancedFeatureExample,
              parameters: {
                participants: [
                  { role: 'targetBody', targets: [{ kind: 'body', bodyId: 'body_target_next' }] },
                  { role: 'toolBody', targets: [{ kind: 'body', bodyId: 'body_tool_next' }] },
                ],
              },
            },
          },
        },
      ],
    }

    const result = validateOperationHistoryPayload(payload)

    assert(result.ok, 'Split advanced solid feature history payloads should validate.')
    assert(
      result.ok
        && result.payload.entries[0]?.kind === 'createFeature'
        && result.payload.entries[0].payload.definition.kind === 'split'
        && result.payload.entries[0].payload.definition.parameters.participants.some((participant) => participant.role === 'toolBody')
        && result.payload.entries[1]?.kind === 'updateFeature'
        && result.payload.entries[1].payload.definition.kind === 'split'
        && result.payload.entries[1].payload.definition.parameters.participants.some((participant) => participant.role === 'targetBody'),
      'Split operation history must preserve explicit targetBody and toolBody participants across create and update entries.',
    )
  }

  function testPreservesDeleteSolidParticipantsAcrossCreateAndUpdateEntries() {
    const payload: ModelingOperationHistoryPayload = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createCreateFeatureHistoryEntry({
          ...createFeatureRequest,
          definition: deleteSolidAdvancedFeatureExample,
        }),
        {
          kind: 'updateFeature',
          payload: {
            featureId: 'feature_delete-solid-1',
            definition: {
              ...deleteSolidAdvancedFeatureExample,
              parameters: {
                participants: [
                  {
                    role: 'body',
                    targets: [
                      { kind: 'body', bodyId: 'body_delete_a' },
                      { kind: 'body', bodyId: 'body_delete_b' },
                    ],
                  },
                ],
              },
            },
          },
        },
      ],
    }

    const result = validateOperationHistoryPayload(payload)

    assert(result.ok, 'Delete-solid advanced solid feature history payloads should validate.')
    assert(
      result.ok
        && result.payload.entries[0]?.kind === 'createFeature'
        && result.payload.entries[0].payload.definition.kind === 'deleteSolid'
        && result.payload.entries[1]?.kind === 'updateFeature'
        && result.payload.entries[1].payload.definition.kind === 'deleteSolid'
        && result.payload.entries[1].payload.definition.parameters.participants[0]?.targets.length === 2,
      'Delete-solid operation history must preserve explicit body participants across create and update entries.',
    )
  }

  function testPreservesLoftParticipantOrderAndGuideCurves() {
    const payload: ModelingOperationHistoryPayload = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createCreateFeatureHistoryEntry({
          ...createFeatureRequest,
          definition: loftAdvancedFeatureExample,
        }),
        {
          kind: 'updateFeature',
          payload: {
            featureId: 'feature_loft-1',
            definition: {
              ...loftAdvancedFeatureExample,
              parameters: {
                ...loftAdvancedFeatureExample.parameters,
                participants: [
                  {
                    role: 'profile',
                    targets: [
                      { kind: 'face', bodyId: 'body_loft_b', faceId: 'face_loft_b' },
                      { kind: 'region', sketchId: 'sketch_loft_a', regionId: 'region_loft_a' },
                    ],
                  },
                  { role: 'guideCurve', targets: [{ kind: 'edge', bodyId: 'body_guide', edgeId: 'edge_guide' }] },
                ],
              },
            },
          },
        },
      ],
    }

    const result = validateOperationHistoryPayload(payload)

    assert(result.ok, 'Loft advanced solid feature history payloads should validate.')
    assert(
      result.ok &&
        result.payload.entries[1]?.kind === 'updateFeature' &&
        result.payload.entries[1].payload.definition.kind === 'loft' &&
        result.payload.entries[1].payload.definition.parameters.participants[0]?.role === 'profile' &&
        result.payload.entries[1].payload.definition.parameters.participants[0]?.targets[0]?.kind === 'face' &&
        result.payload.entries[1].payload.definition.parameters.participants.some((participant) => participant.role === 'guideCurve'),
      'Loft operation history must preserve ordered profile participants and guide curves across updates.',
    )
  }

  function testRejectsInvalidAdvancedParticipants() {
    const result = validateOperationHistoryPayload({
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [{
        kind: 'createFeature',
        payload: {
          definition: {
            ...sweepAdvancedFeatureExample,
            parameters: {
              ...sweepAdvancedFeatureExample.parameters,
              participants: [{ role: 'targetBody', targets: 'body_target' }],
            },
          },
        },
      }],
    })

    assert(!result.ok && result.reasonCode === 'invalid-advanced-participant', 'Invalid advanced participants should report a stable reason code.')
  }

  function testPreservesCombineParticipantsAndOperationIntentAcrossCreateAndUpdateEntries() {
    const payload: ModelingOperationHistoryPayload = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createCreateFeatureHistoryEntry({
          ...createFeatureRequest,
          definition: combineAdvancedFeatureExample,
        }),
        {
          kind: 'updateFeature',
          payload: {
            featureId: 'feature_combine-1',
            definition: {
              ...combineAdvancedFeatureExample,
              parameters: {
                ...combineAdvancedFeatureExample.parameters,
                operationIntent: 'intersect',
                participants: [
                  { role: 'targetBody', targets: [{ kind: 'body', bodyId: 'body_target_next' }] },
                  { role: 'toolBody', targets: [{ kind: 'body', bodyId: 'body_tool_next' }] },
                ],
              },
            },
          },
        },
      ],
    }

    const result = validateOperationHistoryPayload(payload)

    assert(result.ok, 'Combine advanced solid feature history payloads should validate.')
    assert(
      result.ok
        && result.payload.entries[0]?.kind === 'createFeature'
        && result.payload.entries[0].payload.definition.kind === 'combine'
        && result.payload.entries[0].payload.definition.parameters.participants.some((participant) => participant.role === 'targetBody')
        && getAuthoredLiteralValue(result.payload.entries[0].payload.definition.parameters.operationIntent) === 'subtract'
        && result.payload.entries[1]?.kind === 'updateFeature'
        && result.payload.entries[1].payload.definition.kind === 'combine'
        && getAuthoredLiteralValue(result.payload.entries[1].payload.definition.parameters.operationIntent) === 'intersect'
        && result.payload.entries[1].payload.definition.parameters.participants.some((participant) => participant.role === 'toolBody'),
      'Combine operation history must preserve participant roles and operation intent across create and update entries.',
    )
  }

  function testPreservesThickenParticipantsAndOptions() {
    const payload: ModelingOperationHistoryPayload = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createCreateFeatureHistoryEntry({
          ...createFeatureRequest,
          definition: thickenAdvancedFeatureExample,
        }),
        {
          kind: 'updateFeature',
          payload: {
            featureId: 'feature_thicken-1',
            definition: {
              ...thickenAdvancedFeatureExample,
              parameters: {
                ...thickenAdvancedFeatureExample.parameters,
                options: { thickness: 2, side: 'symmetric' },
              },
            },
          },
        },
      ],
    }

    const result = validateOperationHistoryPayload(payload)

    assert(result.ok, 'Thicken advanced solid feature history payloads should validate.')
    assert(
      result.ok &&
        result.payload.entries[0]?.kind === 'createFeature' &&
        result.payload.entries[0].payload.definition.kind === 'thicken' &&
        result.payload.entries[0].payload.definition.parameters.participants.some((participant) => participant.role === 'face') &&
        result.payload.entries[1]?.kind === 'updateFeature' &&
        result.payload.entries[1].payload.definition.kind === 'thicken' &&
        getAuthoredLiteralValue(result.payload.entries[1].payload.definition.parameters.options?.thickness) === 2 &&
        getAuthoredLiteralValue(result.payload.entries[1].payload.definition.parameters.options?.side) === 'symmetric',
      'Thicken operation history must preserve face participants and option payloads across updates.',
    )
  }

  function testPreservesMirrorParticipantsAndCopyOptionAcrossCreateAndUpdateEntries() {
    const payload: ModelingOperationHistoryPayload = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createCreateFeatureHistoryEntry({
          ...createFeatureRequest,
          definition: mirrorAdvancedFeatureExample,
        }),
        {
          kind: 'updateFeature',
          payload: {
            featureId: 'feature_mirror-1',
            definition: {
              ...mirrorAdvancedFeatureExample,
              parameters: {
                ...mirrorAdvancedFeatureExample.parameters,
                options: { copy: false },
              },
            },
          },
        },
      ],
    }

    const result = validateOperationHistoryPayload(payload)

    assert(result.ok, 'Mirror advanced solid feature history payloads should validate.')
    assert(
      result.ok
        && result.payload.entries[0]?.kind === 'createFeature'
        && result.payload.entries[0].payload.definition.kind === 'mirror'
        && result.payload.entries[0].payload.definition.parameters.participants.some((participant) => participant.role === 'plane')
        && result.payload.entries[1]?.kind === 'updateFeature'
        && result.payload.entries[1].payload.definition.kind === 'mirror'
        && getAuthoredLiteralValue(result.payload.entries[1].payload.definition.parameters.options?.copy) === false,
      'Mirror operation history must preserve explicit plane participants and copy policy options across updates.',
    )
  }

  function testPreservesTransformParticipantsAndDistanceOptionAcrossCreateAndUpdateEntries() {
    const payload: ModelingOperationHistoryPayload = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createCreateFeatureHistoryEntry({
          ...createFeatureRequest,
          definition: transformAdvancedFeatureExample,
        }),
        {
          kind: 'updateFeature',
          payload: {
            featureId: 'feature_transform-1',
            definition: {
              ...transformAdvancedFeatureExample,
              parameters: {
                ...transformAdvancedFeatureExample.parameters,
                options: { distance: 7.5 },
              },
            },
          },
        },
      ],
    }

    const result = validateOperationHistoryPayload(payload)

    assert(result.ok, 'Transform advanced solid feature history payloads should validate.')
    assert(
      result.ok
        && result.payload.entries[0]?.kind === 'createFeature'
        && result.payload.entries[0].payload.definition.kind === 'transform'
        && result.payload.entries[0].payload.definition.parameters.participants.some((participant) => participant.role === 'transformReference')
        && result.payload.entries[1]?.kind === 'updateFeature'
        && result.payload.entries[1].payload.definition.kind === 'transform'
        && getAuthoredLiteralValue(result.payload.entries[1].payload.definition.parameters.options?.distance) === 7.5,
      'Transform operation history must preserve explicit transform references and distance options across updates.',
    )
  }

  function testValidatesDocumentVariableHistoryWithoutRuntimeState() {
    const addVariableRequest: AddDocumentVariableRequest = {
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_0004',
      name: 'width',
      valueText: '10 + 2',
    }
    const updateVariableRequest: UpdateDocumentVariableRequest = {
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_0005',
      variableId: 'variable_width',
      name: 'width',
      valueText: 'width + 6',
    }
    const payload: ModelingOperationHistoryPayload = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createAddDocumentVariableHistoryEntry(addVariableRequest, 'variable_width'),
        createUpdateDocumentVariableHistoryEntry(updateVariableRequest),
      ],
    }

    const result = validateOperationHistoryPayload(payload)

    assert(result.ok, 'Document variable add/update history entries should validate.')
    assert(
      result.ok
        && result.payload.entries[0]?.kind === 'addDocumentVariable'
        && result.payload.entries[0].payload.variableId === 'variable_width'
        && result.payload.entries[1]?.kind === 'updateDocumentVariable'
        && result.payload.entries[1].payload.valueText === 'width + 6'
        && !('calculatedValue' in result.payload.entries[1].payload),
      'Document variable history should preserve stable id, name, and raw value text.',
    )

    const invalidRuntimeStatePayload = validateOperationHistoryPayload({
      ...payload,
      entries: [
        {
          kind: 'addDocumentVariable',
          payload: {
            variableId: 'variable_bad',
            name: 'bad',
            valueText: 'not evaluated',
            calculatedValue: 42,
          },
        },
      ],
    })

    assert(!invalidRuntimeStatePayload.ok, 'Document variable history should reject persisted runtime calculation state.')
  }

  testValidatesRepresentativeHistory()
  testNormalizesCommittedCommitSketchTargets()
  testAcceptsLegacyDraftCommitSketchTargets()
  testRejectsUnsupportedVersion()
  testRejectsTransportMetadataLeak()
  testRejectsInconsistentCommitSketchTargets()
  testValidatesProfileCollectionFeaturePayloads()
  testPreservesFeatureExpressionAuthoredValues()
  testRejectsLegacyAndInvalidProfileCollections()
  testPreservesAdvancedParticipantsAndOperationIntent()
  testPreservesChamferParticipantsAndDistanceOptions()
  testPreservesSplitParticipantsAcrossCreateAndUpdateEntries()
  testPreservesCombineParticipantsAndOperationIntentAcrossCreateAndUpdateEntries()
  testPreservesDeleteSolidParticipantsAcrossCreateAndUpdateEntries()
  testPreservesLoftParticipantOrderAndGuideCurves()
  testRejectsInvalidAdvancedParticipants()
  testPreservesThickenParticipantsAndOptions()
  testPreservesMirrorParticipantsAndCopyOptionAcrossCreateAndUpdateEntries()
  testPreservesTransformParticipantsAndDistanceOptionAcrossCreateAndUpdateEntries()
  testValidatesDocumentVariableHistoryWithoutRuntimeState()
})
