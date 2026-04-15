import { test } from 'bun:test'
import { MockKernelAdapter } from './mock-kernel-adapter'
import { createModelingService, modelingRuntimeValidators } from './modeling-service'
import { bindRenderableObject, resolvePickTarget } from '@/domain/workspace/render-picking'
import * as THREE from 'three'
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from '@/contracts/modeling/advanced-solid'
import {
  deleteSolidAdvancedFeatureExample,
  mirrorAdvancedFeatureExample,
  splitAdvancedFeatureExample,
  transformAdvancedFeatureExample,
} from '@/contracts/modeling/advanced-solid'

test('src/domain/modeling/mock-kernel-adapter.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function testExtrudePreviewDependsOnDefinition() {
    const adapter = new MockKernelAdapter()
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const existingExtrude = snapshot.snapshot.features.find(
      (feature) => feature.featureId === 'feature_extrude-1' && feature.definition.kind === 'extrude',
    )

    if (!existingExtrude || existingExtrude.definition.kind !== 'extrude') {
      throw new Error('Mock snapshot must expose the seeded extrude feature definition.')
    }

    const valid = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_0001',
      previewId: 'preview_extrude_valid',
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: existingExtrude.definition.parameters.profiles,
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 12 },
          operation: 'newBody',
          booleanScope: { kind: 'standalone' },
        },
      },
    })

    assert(valid.render.records.length > 0, 'Valid extrude previews should return preview renderables.')
    assert(valid.diagnostics.length === 0, 'Valid extrude previews should not emit diagnostics.')
    assert(
      valid.render.records.every((renderable) => {
        if (renderable.binding.topology === null) {
          return (
            renderable.binding.target.kind === 'construction'
            || renderable.binding.target.kind === 'sketchEntity'
            || renderable.binding.target.kind === 'sketchPoint'
          )
        }

        return renderable.binding.target.kind === renderable.binding.topology
      }),
      'Preview renderables must bind selection through durable refs rather than geometry shortcuts.',
    )
    assert(
      valid.render.records.some(
        (renderable) =>
          renderable.binding.semanticClass === 'planarFace' && renderable.geometry.kind === 'mesh',
      ),
      'Preview renderables must expose face semantics independently from the mesh geometry payload.',
    )

    const invalid = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_0001',
      previewId: 'preview_extrude_invalid',
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: existingExtrude.definition.parameters.profiles,
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 0 },
          operation: 'newBody',
          booleanScope: { kind: 'standalone' },
        },
      },
    })

    assert(invalid.render.records.length === 0, 'Invalid extrude previews must not return authoritative preview geometry.')
    assert(
      invalid.diagnostics.some((diagnostic) => diagnostic.code === 'mock-invalid-extrude'),
      'Invalid extrude previews must emit structured diagnostics.',
    )
  }

  async function testProfileCollectionContractBoundaryRejectsInvalidPayloads() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
    })
    const snapshot = await service.getCurrentDocumentSnapshot()
    const existingExtrude = snapshot.features.find(
      (feature) => feature.featureId === 'feature_extrude-1' && feature.definition.kind === 'extrude',
    )

    if (!existingExtrude || existingExtrude.definition.kind !== 'extrude') {
      throw new Error('Mock snapshot must expose the seeded extrude feature definition.')
    }

    const profile = existingExtrude.definition.parameters.profiles[0]
    const invalidCases = [
      {
        parameters: {
          ...existingExtrude.definition.parameters,
          profiles: undefined,
          profile,
        },
        message: 'Legacy singular profile payloads should be rejected before preview.',
      },
      {
        parameters: {
          ...existingExtrude.definition.parameters,
          profiles: [],
        },
        message: 'Empty profile arrays should be rejected before preview.',
      },
      {
        parameters: {
          ...existingExtrude.definition.parameters,
          profiles: [{ kind: 'sketch', sketchId: 'sketch_primary' }],
        },
        message: 'Whole-sketch profile seeds should be rejected before preview.',
      },
      {
        parameters: {
          ...existingExtrude.definition.parameters,
          profiles: [profile, profile],
        },
        message: 'Duplicate profile references should be rejected before preview.',
      },
    ] as const

    for (const testCase of invalidCases) {
      let rejected = false
      try {
        await service.evaluatePreview({
          baseRevisionId: snapshot.revisionId,
          previewId: 'preview_invalid_profiles',
          definition: {
            kind: 'extrude',
            featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
            parameters: testCase.parameters,
          } as never,
        })
      } catch {
        rejected = true
      }
      assert(rejected, testCase.message)
    }
  }

  async function testUnsupportedFeatureDefinitionsAreRejectedByMock() {
    const adapter = new MockKernelAdapter()

    const plane = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_0001',
      definition: {
        kind: 'plane',
        featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
        parameters: {
          mode: 'coplanar',
          reference: {
            target: { kind: 'construction', constructionId: 'construction_plane-xy' },
          },
        },
      },
    })

    assert(
      plane.diagnostics.some((diagnostic) => diagnostic.code === 'mock-unsupported-plane'),
      'Unsupported plane features must report explicit mock diagnostics.',
    )
    assert(plane.changedTargets.length === 0, 'Unsupported plane features must not report changed targets.')
    assert(
      plane.rebuildResult.kind === 'skipped' && plane.rebuildResult.reasonCode === 'validationRejected',
      'Rejected feature requests must report an explicit skipped rebuild result.',
    )
  }

  async function testMutationResponsesReportRebuildResults() {
    const adapter = new MockKernelAdapter()
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const initialRevisionId = snapshot.snapshot.revisionId
    const extrude = snapshot.snapshot.features.find(
      (feature) => feature.featureId === 'feature_extrude-1' && feature.definition.kind === 'extrude',
    )

    if (!extrude || extrude.definition.kind !== 'extrude') {
      throw new Error('Mock snapshot must expose the seeded extrude feature definition.')
    }

    const accepted = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_0001',
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          ...extrude.definition.parameters,
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 8 },
        },
      },
    })

    assert(accepted.rebuildResult.kind === 'rebuilt', 'Accepted feature creates must report a rebuilt result.')
    assert(
      accepted.rebuildResult.revisionId === accepted.revisionId && accepted.revisionId !== initialRevisionId,
      'Accepted feature creates must report the new rebuild revision ID.',
    )

    const conflict = await adapter.deleteFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_stale',
      featureId: 'feature_extrude-1',
    })

    assert(
      conflict.rebuildResult.kind === 'skipped' && conflict.rebuildResult.reasonCode === 'revisionConflict',
      'Revision conflicts must report a skipped rebuild result.',
    )
  }

  async function testAcceptedCreateMutatesCommittedSnapshot() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const beforeRevisionId = before.snapshot.revisionId
    const seedExtrude = before.snapshot.features.find(
      (feature) => feature.featureId === 'feature_extrude-1' && feature.definition.kind === 'extrude',
    )

    if (!seedExtrude || seedExtrude.definition.kind !== 'extrude') {
      throw new Error('Seed extrude feature must exist for create-mutation coverage.')
    }

    const created = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          ...seedExtrude.definition.parameters,
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 16 },
        },
      },
    })

    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    assert(created.revisionState.kind === 'accepted', 'Accepted creates must report accepted revision state.')
    assert(created.revisionId === after.snapshot.revisionId, 'Accepted creates must advance the committed snapshot revision.')
    assert(after.snapshot.revisionId !== beforeRevisionId, 'Accepted creates must change the committed revision basis.')
    assert(
      after.snapshot.features.some((feature) => feature.featureId === created.featureId),
      'Accepted creates must appear in subsequent committed snapshots.',
    )
  }

  async function testRollbackCursorPreservesAndInsertsFeatureAfterCursor() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    const rollback = await adapter.setFeatureCursor({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      cursor: { kind: 'feature', featureId: 'feature_extrude-1' },
    })

    assert(rollback.revisionState.kind === 'accepted', 'Rollback cursor changes must be accepted for valid features.')
    assert(rollback.cursor.kind === 'feature' && rollback.cursor.featureId === 'feature_extrude-1', 'Rollback must target the requested feature.')
    const seedExtrude = before.snapshot.features.find(
      (feature) => feature.featureId === 'feature_extrude-1' && feature.definition.kind === 'extrude',
    )

    if (!seedExtrude || seedExtrude.definition.kind !== 'extrude') {
      throw new Error('Seed extrude feature must exist for rollback insertion coverage.')
    }

    const created = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: rollback.revisionId,
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          ...seedExtrude.definition.parameters,
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 18 },
        },
      },
    })

    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const featureOrder = after.snapshot.features.map((feature) => feature.featureId)

    assert(created.revisionState.kind === 'accepted', 'Feature creation after rollback must be accepted.')
    assert(
      featureOrder.join('>') === `feature_extrude-1>${created.featureId}>feature_fillet-1`,
      'Feature creation after rollback must insert immediately after the cursor and preserve later features.',
    )
    assert(
      after.snapshot.cursor.kind === 'feature' && after.snapshot.cursor.featureId === created.featureId,
      'Feature creation after rollback must advance the cursor to the new feature.',
    )
  }

  async function testAcceptedSketchCommitMutatesCommittedSnapshot() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const beforeRevisionId = before.snapshot.revisionId
    const sourceSketch = before.snapshot.sketches[0]

    if (!sourceSketch) {
      throw new Error('Seed sketch must exist for sketch commit coverage.')
    }

    const committed = await adapter.commitSketch({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      solverCorrelation: {
        requestId: 'request_commit_1',
        projectionRequestId: 'request_commit_1:project',
        validationRequestId: 'request_commit_1:validate',
        solveRequestId: 'request_commit_1:solve',
        regionRequestId: 'request_commit_1:regions',
      },
      sketchId: 'sketch_phase8',
      sketchLabel: 'Phase 8 Sketch',
      plane: sourceSketch.plane,
      planeTarget: sourceSketch.planeTarget,
      planeKey: sourceSketch.planeKey,
      definition: sourceSketch.sketch.definition,
    })

    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    assert(committed.revisionState.kind === 'accepted', 'Accepted sketch commits must report accepted revision state.')
    assert(after.snapshot.revisionId === committed.revisionId, 'Committed sketch revisions must match the observed snapshot revision.')
    assert(after.snapshot.revisionId !== beforeRevisionId, 'Accepted sketch commits must change the committed revision basis.')
    assert(
      after.snapshot.sketches.some((sketch) => sketch.sketchId === committed.sketchId),
      'Accepted sketch commits must appear in subsequent committed snapshots.',
    )

    const reopenedSketch = after.snapshot.sketches.find((sketch) => sketch.sketchId === committed.sketchId)
    assert(reopenedSketch, 'Committed sketch snapshots must remain available for reopen flows.')
    assert(
      reopenedSketch.planeTarget.kind === sourceSketch.planeTarget.kind
      && reopenedSketch.plane.key === sourceSketch.plane.key,
      'Committed sketch snapshots must preserve their stored plane identity for later reopen.',
    )
    assert(
      reopenedSketch.plane.frame.normal.every(
        (component, index) => component === sourceSketch.plane.frame.normal[index],
      ),
      'Committed sketch snapshots must preserve the authored plane orientation.',
    )
  }

  async function testMissingMutationTargetsAreRejected() {
    const adapter = new MockKernelAdapter()
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    const missingUpdate = await adapter.updateFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: snapshot.snapshot.revisionId,
      featureId: 'feature_missing',
      definition: {
        kind: 'plane',
        featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
        parameters: {
          mode: 'coplanar',
          reference: {
            target: { kind: 'construction', constructionId: 'construction_plane-xy' },
          },
        },
      },
    })

    const missingDelete = await adapter.deleteFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: snapshot.snapshot.revisionId,
      featureId: 'feature_missing',
    })

    const missingReorder = await adapter.reorderFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: snapshot.snapshot.revisionId,
      featureId: 'feature_extrude-1',
      beforeFeatureId: 'feature_missing',
    })

    assert(missingUpdate.revisionState.kind === 'rejected', 'Updates targeting missing features must be rejected.')
    assert(missingDelete.revisionState.kind === 'rejected', 'Deletes targeting missing features must be rejected.')
    assert(missingReorder.revisionState.kind === 'rejected', 'Reorders targeting missing anchors must be rejected.')
  }

  async function testPreviewStalenessReportsObservedRevision() {
    const adapter = new MockKernelAdapter()

    const stalePreview = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_stale',
      previewId: 'preview_stale_1',
      definition: {
        kind: 'plane',
        featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
        parameters: {
          mode: 'coplanar',
          reference: {
            target: { kind: 'construction', constructionId: 'construction_plane-xy' },
          },
        },
      },
    })

    assert(stalePreview.freshness.kind === 'stale', 'Stale previews must report stale freshness explicitly.')
    assert(
      stalePreview.freshness.currentRevisionId === stalePreview.revisionId,
      'Stale preview freshness must report the same observed current revision as the response revision.',
    )
  }

  async function testResolveReferenceReportsMissingTargetsExplicitly() {
    const adapter = new MockKernelAdapter()

    const resolution = await adapter.resolveReference({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      target: { kind: 'face', bodyId: 'body_part-1', faceId: 'face_missing' },
    })

    assert(
      resolution.resolution.invalidation?.reason === 'mock-missing-reference',
      'Missing durable references must carry explicit invalidation payloads.',
    )
    assert(
      resolution.diagnostics.some((diagnostic) => diagnostic.code === 'mock-invalid-reference'),
      'Missing durable references must emit machine-readable diagnostics.',
    )
  }

  async function testMockKernelRejectsUnsupportedContractEnvelope() {
    const adapter = new MockKernelAdapter()
    let contractRejected = false

    try {
      await adapter.getDocumentSnapshot({
        contractVersion: 'modeling-contract/v0' as never,
        documentId: 'doc_workspace',
      })
    } catch (error) {
      contractRejected = error instanceof Error && error.message.includes('Unsupported contract version')
    }

    assert(contractRejected, 'Mock kernel must reject unsupported contract versions.')

    let documentRejected = false

    try {
      await adapter.getDocumentSnapshot({
        contractVersion: 'modeling-contract/v1alpha1',
        documentId: 'doc_other' as never,
      })
    } catch (error) {
      documentRejected = error instanceof Error && error.message.includes('Unsupported document')
    }

    assert(documentRejected, 'Mock kernel must reject unsupported document IDs.')
  }

  async function testAdvancedPreviewReturnsStructuredUnsupportedDiagnosticsWithoutMutation() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    const preview = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      previewId: 'preview_split_unsupported',
      definition: splitAdvancedFeatureExample,
    })
    const create = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      definition: splitAdvancedFeatureExample,
    })
    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    assert(preview.render.records.length === 0, 'Unsupported advanced previews must not return preview geometry.')
    assert(
      preview.diagnostics.some((diagnostic) => diagnostic.detail?.kind === 'advancedFeatureValidation'),
      'Unsupported advanced previews must return structured advanced-feature diagnostics.',
    )
    assert(create.revisionState.kind === 'rejected', 'Unsupported advanced create requests should be rejected.')
    assert(after.snapshot.revisionId === before.snapshot.revisionId, 'Rejected advanced create requests must not mutate the committed document revision.')
    assert(after.snapshot.features.length === before.snapshot.features.length, 'Rejected advanced create requests must not add committed features.')
  }

  async function testSweepPreviewAndCommitUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const sweepDefinition = {
      kind: 'sweep',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          { role: 'profile', targets: [{ kind: 'region', sketchId: 'sketch_primary', regionId: 'region_primary-outer' }] },
          { role: 'path', targets: [{ kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-0' }] },
        ],
      },
    } as const

    const preview = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      previewId: 'preview_sweep_valid',
      definition: sweepDefinition,
    })
    const created = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      definition: sweepDefinition,
    })
    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const committedSweep = after.snapshot.features.find((feature) => feature.featureId === created.featureId)

    assert(preview.render.records.length > 0, 'Supported mock sweep previews should return transient renderables.')
    assert(preview.diagnostics.length === 0, 'Supported mock sweep previews should not emit diagnostics.')
    assert(created.revisionState.kind === 'accepted', 'Supported mock sweep create requests should be accepted.')
    assert(committedSweep?.definition.kind === 'sweep', 'Committed mock sweep should be present in the next snapshot.')
    assert(
      committedSweep.definition.parameters.participants.some((participant) => participant.role === 'path'),
      'Committed mock sweep should preserve the path participant role.',
    )
  }

  async function testSweepUnsupportedCasesReturnStructuredDiagnosticsWithoutMutation() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const guideCurveDefinition = {
      kind: 'sweep',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          { role: 'profile', targets: [{ kind: 'region', sketchId: 'sketch_primary', regionId: 'region_primary-outer' }] },
          { role: 'path', targets: [{ kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-0' }] },
          { role: 'guideCurve', targets: [{ kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-1' }] },
        ],
      },
    } as const
    const booleanDefinition = {
      ...guideCurveDefinition,
      parameters: {
        operationIntent: 'subtract' as const,
        participants: [
          { role: 'profile' as const, targets: [{ kind: 'region' as const, sketchId: 'sketch_primary' as const, regionId: 'region_primary-outer' as const }] },
          { role: 'path' as const, targets: [{ kind: 'edge' as const, bodyId: 'body_part-1' as const, edgeId: 'edge_outer-0' as const }] },
          { role: 'targetBody' as const, targets: [{ kind: 'body' as const, bodyId: 'body_part-1' as const }] },
        ],
      },
    } as const

    const guidePreview = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      previewId: 'preview_sweep_guide_unsupported',
      definition: guideCurveDefinition,
    })
    const booleanCreate = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      definition: booleanDefinition,
    })
    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    assert(guidePreview.render.records.length === 0, 'Unsupported sweep previews must not return transient renderables.')
    assert(
      guidePreview.diagnostics.some((diagnostic) => diagnostic.detail?.kind === 'advancedFeatureValidation'),
      'Unsupported sweep previews must return structured advanced-feature diagnostics.',
    )
    assert(booleanCreate.revisionState.kind === 'rejected', 'Unsupported sweep boolean create requests should be rejected.')
    assert(after.snapshot.revisionId === before.snapshot.revisionId, 'Rejected sweep create requests must not mutate committed document state.')
  }

  async function testLoftPreviewAndCommitUseOrderedAdvancedParticipants() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const loftDefinition = {
      kind: 'loft',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          {
            role: 'profile',
            targets: [
              { kind: 'region', sketchId: 'sketch_primary', regionId: 'region_primary-outer' },
              { kind: 'face', bodyId: 'body_part-1', faceId: 'face_top' },
            ],
          },
        ],
      },
    } as const

    const preview = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      previewId: 'preview_loft_valid',
      definition: loftDefinition,
    })
    const created = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      definition: loftDefinition,
    })
    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const committedLoft = after.snapshot.features.find((feature) => feature.featureId === created.featureId)

    assert(preview.render.records.length > 0, 'Supported mock loft previews should return transient renderables.')
    assert(preview.diagnostics.length === 0, 'Supported mock loft previews should not emit diagnostics.')
    assert(created.revisionState.kind === 'accepted', 'Supported mock loft create requests should be accepted.')
    assert(committedLoft?.definition.kind === 'loft', 'Committed mock loft should be present in the next snapshot.')
    assert(
      committedLoft.definition.parameters.participants.find((participant) => participant.role === 'profile')?.targets[1]?.kind === 'face',
      'Committed mock loft should preserve ordered profile participants.',
    )
  }

  async function testLoftUnsupportedCasesReturnStructuredDiagnosticsWithoutMutation() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const guideCurveDefinition = {
      kind: 'loft',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          {
            role: 'profile',
            targets: [
              { kind: 'region', sketchId: 'sketch_primary', regionId: 'region_primary-outer' },
              { kind: 'face', bodyId: 'body_part-1', faceId: 'face_top' },
            ],
          },
          { role: 'guideCurve', targets: [{ kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-1' }] },
        ],
      },
    } as const
    const booleanDefinition = {
      kind: 'loft',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'subtract' as const,
        participants: [
          {
            role: 'profile' as const,
            targets: [
              { kind: 'region' as const, sketchId: 'sketch_primary' as const, regionId: 'region_primary-outer' as const },
              { kind: 'face' as const, bodyId: 'body_part-1' as const, faceId: 'face_top' as const },
            ],
          },
          { role: 'targetBody' as const, targets: [{ kind: 'body' as const, bodyId: 'body_part-1' as const }] },
        ],
      },
    } as const

    const guidePreview = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      previewId: 'preview_loft_guide_unsupported',
      definition: guideCurveDefinition,
    })
    const booleanCreate = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      definition: booleanDefinition,
    })
    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    assert(guidePreview.render.records.length === 0, 'Unsupported loft previews must not return transient renderables.')
    assert(
      guidePreview.diagnostics.some((diagnostic) => diagnostic.detail?.kind === 'advancedFeatureValidation'),
      'Unsupported loft previews must return structured advanced-feature diagnostics.',
    )
    assert(booleanCreate.revisionState.kind === 'rejected', 'Unsupported loft boolean create requests should be rejected.')
    assert(after.snapshot.revisionId === before.snapshot.revisionId, 'Rejected loft create requests must not mutate committed document state.')
  }

  async function testChamferPreviewCommitAndUnsupportedCasesUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const chamferDefinition = {
      kind: 'chamfer',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'edge', targets: [{ kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-1' }] },
        ],
        options: { distance: 0.5 },
      },
    } as const
    const invalidDistanceDefinition = {
      ...chamferDefinition,
      parameters: {
        ...chamferDefinition.parameters,
        options: { distance: 0 },
      },
    } as const

    const preview = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      previewId: 'preview_chamfer_valid',
      definition: chamferDefinition,
    })
    const created = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      definition: chamferDefinition,
    })
    const invalid = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      definition: invalidDistanceDefinition,
    })
    const afterInvalid = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const committedChamfer = afterInvalid.snapshot.features.find((feature) => feature.featureId === created.featureId)

    assert(preview.render.records.length > 0, 'Supported mock chamfer previews should return transient renderables.')
    assert(preview.diagnostics.length === 0, 'Supported mock chamfer previews should not emit diagnostics.')
    assert(created.revisionState.kind === 'accepted', 'Supported mock chamfer create requests should be accepted.')
    assert(committedChamfer?.definition.kind === 'chamfer', 'Committed mock chamfer should be present in the next snapshot.')
    assert(
      committedChamfer.definition.parameters.participants.some((participant) => participant.role === 'edge'),
      'Committed mock chamfer should preserve the edge participant role.',
    )
    assert(committedChamfer.definition.parameters.options?.distance === 0.5, 'Committed mock chamfer should preserve the distance option.')
    assert(invalid.revisionState.kind === 'rejected', 'Invalid chamfer distance should reject explicitly.')
    assert(afterInvalid.snapshot.revisionId === created.revisionId, 'Rejected chamfer create requests must not mutate committed document state.')
  }

  async function testThickenPreviewCommitAndUnsupportedCasesUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const thickenDefinition = {
      kind: 'thicken',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          { role: 'face', targets: [{ kind: 'face', bodyId: 'body_part-1', faceId: 'face_top' }] },
        ],
        options: { thickness: 0.5, side: 'oneSide' },
      },
    } as const
    const invalidThicknessDefinition = {
      ...thickenDefinition,
      parameters: {
        ...thickenDefinition.parameters,
        options: { thickness: 0, side: 'oneSide' },
      },
    } as const
    const booleanDefinition = {
      kind: 'thicken',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'subtract' as const,
        participants: [
          { role: 'face' as const, targets: [{ kind: 'face' as const, bodyId: 'body_part-1' as const, faceId: 'face_top' as const }] },
          { role: 'targetBody' as const, targets: [{ kind: 'body' as const, bodyId: 'body_part-1' as const }] },
        ],
        options: { thickness: 0.5, side: 'symmetric' as const },
      },
    } as const

    const preview = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      previewId: 'preview_thicken_valid',
      definition: thickenDefinition,
    })
    const created = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      definition: thickenDefinition,
    })
    const invalid = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      definition: invalidThicknessDefinition,
    })
    const booleanCreate = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      definition: booleanDefinition,
    })
    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const committedThicken = after.snapshot.features.find((feature) => feature.featureId === created.featureId)

    assert(preview.render.records.length > 0, 'Supported mock thicken previews should return transient renderables.')
    assert(preview.diagnostics.length === 0, 'Supported mock thicken previews should not emit diagnostics.')
    assert(created.revisionState.kind === 'accepted', 'Supported mock thicken create requests should be accepted.')
    assert(committedThicken?.definition.kind === 'thicken', 'Committed mock thicken should be present in the next snapshot.')
    assert(
      committedThicken.definition.parameters.participants.some((participant) => participant.role === 'face'),
      'Committed mock thicken should preserve the face participant role.',
    )
    assert(committedThicken.definition.parameters.options?.thickness === 0.5, 'Committed mock thicken should preserve the thickness option.')
    assert(invalid.revisionState.kind === 'rejected', 'Invalid thicken thickness should reject explicitly.')
    assert(booleanCreate.revisionState.kind === 'rejected', 'Unsupported thicken boolean create requests should reject explicitly.')
    assert(after.snapshot.revisionId === created.revisionId, 'Rejected thicken create requests must not mutate committed document state.')
  }

  async function testSplitPreviewCommitAndUnsupportedCasesUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const splitDefinition = {
      kind: 'split',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'targetBody', targets: [{ kind: 'body', bodyId: 'body_part-1' }] },
          { role: 'toolBody', targets: [{ kind: 'body', bodyId: 'body_part-1' }] },
        ],
      },
    } as const
    const unsupportedPlaneDefinition = {
      kind: 'split',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'targetBody', targets: [{ kind: 'body', bodyId: 'body_part-1' }] },
          { role: 'plane', targets: [{ kind: 'construction', constructionId: 'construction_plane-xy' }] },
        ],
      },
    } as const

    const preview = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      previewId: 'preview_split_valid',
      definition: splitDefinition,
    })
    const created = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      definition: splitDefinition,
    })
    const unsupported = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      definition: unsupportedPlaneDefinition,
    })
    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const committedSplit = after.snapshot.features.find((feature) => feature.featureId === created.featureId)

    assert(preview.render.records.length > 0, 'Supported mock split previews should return transient renderables.')
    assert(preview.diagnostics.length === 0, 'Supported mock split previews should not emit diagnostics.')
    assert(created.revisionState.kind === 'accepted', 'Supported mock split create requests should be accepted.')
    assert(committedSplit?.definition.kind === 'split', 'Committed mock split should be present in the next snapshot.')
    assert(
      committedSplit.definition.parameters.participants.some((participant) => participant.role === 'toolBody'),
      'Committed mock split should preserve the explicit toolBody participant role.',
    )
    assert(unsupported.revisionState.kind === 'rejected', 'Unsupported plane-based split create requests should reject explicitly.')
    assert(after.snapshot.revisionId === created.revisionId, 'Rejected split create requests must not mutate committed document state.')
  }

  async function testDeleteSolidPreviewCommitAndValidationUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const deleteDefinition = {
      kind: 'deleteSolid',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          {
            role: 'body',
            targets: [
              { kind: 'body', bodyId: 'body_part-1' },
            ],
          },
        ],
      },
    } as const
    const invalidDefinition = {
      ...deleteSolidAdvancedFeatureExample,
      parameters: {
        participants: [{ role: 'body' as const, targets: [{ kind: 'face' as const, bodyId: 'body_part-1' as const, faceId: 'face_top' as const }] }],
      },
    }

    const preview = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      previewId: 'preview_delete_solid_valid',
      definition: deleteDefinition,
    })
    const created = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      definition: deleteDefinition,
    })
    const invalid = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      definition: invalidDefinition,
    })
    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const committedDelete = after.snapshot.features.find((feature) => feature.featureId === created.featureId)

    assert(preview.render.records.length > 0, 'Supported mock delete-solid previews should return transient renderables.')
    assert(preview.diagnostics.length === 0, 'Supported mock delete-solid previews should not emit diagnostics.')
    assert(created.revisionState.kind === 'accepted', 'Supported mock delete-solid create requests should be accepted.')
    assert(committedDelete?.definition.kind === 'deleteSolid', 'Committed mock delete-solid should be present in the next snapshot.')
    assert(committedDelete.definition.parameters.participants[0]?.targets.length === 1, 'Committed mock delete-solid should preserve the selected body participants.')
    assert(invalid.revisionState.kind === 'rejected', 'Invalid delete-solid body targets should reject explicitly.')
    assert(after.snapshot.revisionId === created.revisionId, 'Rejected delete-solid create requests must not mutate committed document state.')
  }

  async function testMirrorPreviewCommitAndUnsupportedCasesUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    const mirrorDefinition = {
      ...mirrorAdvancedFeatureExample,
      parameters: {
        participants: [
          { role: 'body', targets: [{ kind: 'body', bodyId: 'body_part-1' }] },
          { role: 'plane', targets: [{ kind: 'construction', constructionId: 'construction_plane-xy' }] },
        ],
        options: { copy: true },
      },
    } as const
    const unsupportedDefinition = {
      ...mirrorDefinition,
      parameters: {
        ...mirrorDefinition.parameters,
        options: { copy: false },
      },
    } as const

    const preview = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      previewId: 'preview_mirror_valid',
      definition: mirrorDefinition,
    })
    const created = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      definition: mirrorDefinition,
    })
    const unsupported = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      definition: unsupportedDefinition,
    })
    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const committedMirror = after.snapshot.features.find((feature) => feature.featureId === created.featureId)

    assert(preview.render.records.length > 0, 'Supported mock mirror previews should return transient renderables.')
    assert(preview.diagnostics.length === 0, 'Supported mock mirror previews should not emit diagnostics.')
    assert(created.revisionState.kind === 'accepted', 'Supported mock mirror create requests should be accepted.')
    assert(committedMirror?.definition.kind === 'mirror', 'Committed mock mirror should be present in the next snapshot.')
    assert(committedMirror.definition.parameters.participants.some((participant) => participant.role === 'plane'), 'Committed mock mirror should preserve the explicit plane participant.')
    assert(committedMirror.definition.parameters.options?.copy === true, 'Committed mock mirror should preserve the copy option.')
    assert(unsupported.revisionState.kind === 'rejected', 'Unsupported mirror replace requests should reject explicitly.')
    assert(after.snapshot.revisionId === created.revisionId, 'Rejected mirror create requests must not mutate committed document state.')
  }

  async function testTransformPreviewCommitAndValidationUseAdvancedParticipants() {
    const adapter = new MockKernelAdapter()
    const before = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    const transformDefinition = {
      ...transformAdvancedFeatureExample,
      parameters: {
        participants: [
          { role: 'body', targets: [{ kind: 'body', bodyId: 'body_part-1' }] },
          { role: 'transformReference', targets: [{ kind: 'construction', constructionId: 'construction_plane-xy' }] },
        ],
        options: { distance: 2 },
      },
    } as const
    const invalidDefinition = {
      ...transformDefinition,
      parameters: {
        ...transformDefinition.parameters,
        options: { distance: 0 },
      },
    } as const

    const preview = await adapter.evaluatePreview({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      previewId: 'preview_transform_valid',
      definition: transformDefinition,
    })
    const created = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: before.snapshot.revisionId,
      definition: transformDefinition,
    })
    const invalid = await adapter.createFeature({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: created.revisionId,
      definition: invalidDefinition,
    })
    const after = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })
    const committedTransform = after.snapshot.features.find((feature) => feature.featureId === created.featureId)

    assert(preview.render.records.length > 0, 'Supported mock transform previews should return transient renderables.')
    assert(preview.diagnostics.length === 0, 'Supported mock transform previews should not emit diagnostics.')
    assert(created.revisionState.kind === 'accepted', 'Supported mock transform create requests should be accepted.')
    assert(committedTransform?.definition.kind === 'transform', 'Committed mock transform should be present in the next snapshot.')
    assert(committedTransform.definition.parameters.participants.some((participant) => participant.role === 'transformReference'), 'Committed mock transform should preserve the explicit transform reference.')
    assert(committedTransform.definition.parameters.options?.distance === 2, 'Committed mock transform should preserve the typed distance option.')
    assert(invalid.revisionState.kind === 'rejected', 'Invalid transform distance requests should reject explicitly.')
    assert(after.snapshot.revisionId === created.revisionId, 'Rejected transform create requests must not mutate committed document state.')
  }

  async function testSnapshotRenderablesExposeSemanticBindings() {
    const adapter = new MockKernelAdapter()
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    const planarFace = snapshot.snapshot.render.records.find(
      (renderable) => renderable.binding.semanticClass === 'planarFace',
    )

    assert(planarFace !== undefined, 'Seed snapshot must contain a planar face binding.')
    assert(planarFace.geometry.kind === 'mesh', 'Planar face exports must use mesh geometry.')
    assert(
      planarFace.binding.target.kind === 'face',
      'Planar face bindings must round-trip through a durable face ref.',
    )

    const topFaceEntity = snapshot.snapshot.entities.find(
      (entity) => entity.target.kind === 'face' && entity.target.faceId === 'face_top',
    )

    assert(
      topFaceEntity?.selectionSemantics.includes('planarFace') === true,
      'Planar-face selection semantics must live on durable snapshot entities.',
    )
  }

  async function testConstructionPlanesExposeFilledRenderSurfaces() {
    const adapter = new MockKernelAdapter()
    const snapshot = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    const constructionMeshTargets = snapshot.snapshot.render.records
      .filter((record) => record.binding.semanticClass === 'construction' && record.geometry.kind === 'mesh')
      .map((record) => record.binding.target)

    assert(constructionMeshTargets.length >= 3, 'Construction planes should expose filled mesh records for viewport picking.')
    assert(
      constructionMeshTargets.some((target) => target.kind === 'construction' && target.constructionId === 'construction_plane-xy'),
      'The XY construction plane should expose a filled mesh render record.',
    )
    assert(
      constructionMeshTargets.some((target) => target.kind === 'construction' && target.constructionId === 'construction_plane-yz'),
      'The YZ construction plane should expose a filled mesh render record.',
    )
    assert(
      constructionMeshTargets.some((target) => target.kind === 'construction' && target.constructionId === 'construction_plane-xz'),
      'The XZ construction plane should expose a filled mesh render record.',
    )

    const yzPlane = snapshot.snapshot.constructions.find(
      (construction) => construction.constructionId === 'construction_plane-yz',
    )?.plane

    assert(yzPlane?.frame.normal[0] === 1, 'Construction snapshots should expose explicit plane definitions for sketch entry.')
    assert(
      yzPlane?.key === 'yz',
      'Construction snapshot plane definitions should preserve their primary-plane key when available.',
    )
  }

  function testResolvePickTargetUsesKernelPriority() {
    const edgeRenderable = {
      id: 'renderable_edge_priority',
      label: 'Priority edge',
      ownerBodyId: 'body_test',
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_edge_priority',
        pickPriority: 10,
        target: { kind: 'edge', bodyId: 'body_test', edgeId: 'edge_test' },
        topology: 'edge',
        semanticClass: 'featureEdge',
      },
      geometry: {
        kind: 'polyline',
        points: [[0, 0, 0], [1, 0, 0]],
        isClosed: false,
      },
    } as const

    const faceRenderable = {
      id: 'renderable_face_priority',
      label: 'Priority face',
      ownerBodyId: 'body_test',
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_face_priority',
        pickPriority: 20,
        target: { kind: 'face', bodyId: 'body_test', faceId: 'face_test' },
        topology: 'face',
        semanticClass: 'planarFace',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        vertexNormals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
        triangleIndices: [[0, 1, 2]],
      },
    } as const

    const faceObject = new THREE.Object3D()
    bindRenderableObject(
      faceObject,
      faceRenderable.binding.pickId,
      faceRenderable.binding.target,
      faceRenderable.binding.semanticClass,
      'document',
      faceRenderable,
    )
    const edgeObject = new THREE.Object3D()
    bindRenderableObject(
      edgeObject,
      edgeRenderable.binding.pickId,
      edgeRenderable.binding.target,
      edgeRenderable.binding.semanticClass,
      'document',
      edgeRenderable,
    )

    const intersections = [
      {
        distance: 1,
        object: faceObject,
      },
      {
        distance: 2,
        object: edgeObject,
      },
    ] as THREE.Intersection<THREE.Object3D>[]

    const result = resolvePickTarget(intersections)

    assert(result?.pickId === 'pick_face_priority', 'Pick resolution must prefer nearer geometry before pickPriority.')
  }

  function testRenderValidatorRejectsInvalidGeometry() {
    const validFace = {
      id: 'renderable_test_face',
      label: 'Test face',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_test_face',
        pickPriority: 20,
        target: { kind: 'face', bodyId: 'body_test', faceId: 'face_test' },
        topology: 'face',
        semanticClass: 'planarFace',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: [],
        vertexNormals: null,
        triangleIndices: [],
      },
    } as const

    let meshRejected = false

    try {
      modelingRuntimeValidators.renderables([validFace])
    } catch {
      meshRejected = true
    }

    assert(meshRejected, 'Render validator must reject empty mesh exports.')

    const invalidPolyline = {
      id: 'renderable_test_curve',
      label: 'Test curve',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_test_curve',
        pickPriority: 10,
        target: { kind: 'edge', bodyId: 'body_test', edgeId: 'edge_test' },
        topology: 'edge',
        semanticClass: 'featureEdge',
      },
      geometry: {
        kind: 'polyline',
        points: [[0, 0, 0]],
        isClosed: false,
      },
    } as const

    let polylineRejected = false

    try {
      modelingRuntimeValidators.renderables([invalidPolyline])
    } catch {
      polylineRejected = true
    }

    assert(polylineRejected, 'Render validator must reject degenerate open polylines.')

    const invalidMarker = {
      id: 'renderable_test_point',
      label: 'Test point',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_test_point',
        pickPriority: 0,
        target: { kind: 'vertex', bodyId: 'body_test', vertexId: 'vertex_test' },
        topology: 'vertex',
        semanticClass: 'featureVertex',
      },
      geometry: {
        kind: 'marker',
        position: [0, 0, 0],
        displayRadius: 0,
      },
    } as const

    let markerRejected = false

    try {
      modelingRuntimeValidators.renderables([invalidMarker])
    } catch {
      markerRejected = true
    }

    assert(markerRejected, 'Render validator must reject non-positive marker radius.')
  }

  function testFeatureSnapshotValidatorPreservesMirrorAndTransformDefinitions() {
    const features = modelingRuntimeValidators.features([
      {
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_1',
        ownerFeatureId: 'feature_mirror-1',
        ownerSketchId: null,
        ownerBodyId: null,
        featureId: 'feature_mirror-1',
        label: 'Mirror 1',
        definition: {
          kind: 'mirror',
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            participants: [
              { role: 'body', targets: [{ kind: 'body', bodyId: 'body_a' }] },
              { role: 'plane', targets: [{ kind: 'construction', constructionId: 'construction_plane-xy' }] },
            ],
            options: { copy: true },
          },
        },
        producedTargets: [{ kind: 'body', bodyId: 'body_mirror-1' }],
      },
      {
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_1',
        ownerFeatureId: 'feature_transform-1',
        ownerSketchId: null,
        ownerBodyId: null,
        featureId: 'feature_transform-1',
        label: 'Transform 1',
        definition: {
          kind: 'transform',
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            participants: [
              { role: 'body', targets: [{ kind: 'body', bodyId: 'body_a' }] },
              { role: 'transformReference', targets: [{ kind: 'construction', constructionId: 'construction_plane-xy' }] },
            ],
            options: { distance: 2 },
          },
        },
        producedTargets: [{ kind: 'body', bodyId: 'body_a' }],
      },
    ])

    assert(features[0]?.definition.kind === 'mirror', 'Feature snapshot normalization should preserve mirror definitions.')
    assert(features[0]?.definition.parameters.options?.copy === true, 'Feature snapshot normalization should preserve mirror copy options.')
    assert(features[1]?.definition.kind === 'transform', 'Feature snapshot normalization should preserve transform definitions.')
    assert(features[1]?.definition.parameters.options?.distance === 2, 'Feature snapshot normalization should preserve transform distance options.')
  }

  await testExtrudePreviewDependsOnDefinition()
  await testProfileCollectionContractBoundaryRejectsInvalidPayloads()
  await testUnsupportedFeatureDefinitionsAreRejectedByMock()
  await testMutationResponsesReportRebuildResults()
  await testAcceptedCreateMutatesCommittedSnapshot()
  await testRollbackCursorPreservesAndInsertsFeatureAfterCursor()
  await testAcceptedSketchCommitMutatesCommittedSnapshot()
  await testMissingMutationTargetsAreRejected()
  await testPreviewStalenessReportsObservedRevision()
  await testResolveReferenceReportsMissingTargetsExplicitly()
  await testMockKernelRejectsUnsupportedContractEnvelope()
  await testAdvancedPreviewReturnsStructuredUnsupportedDiagnosticsWithoutMutation()
  await testSweepPreviewAndCommitUseAdvancedParticipants()
  await testSweepUnsupportedCasesReturnStructuredDiagnosticsWithoutMutation()
    await testLoftPreviewAndCommitUseOrderedAdvancedParticipants()
    await testLoftUnsupportedCasesReturnStructuredDiagnosticsWithoutMutation()
    await testChamferPreviewCommitAndUnsupportedCasesUseAdvancedParticipants()
    await testThickenPreviewCommitAndUnsupportedCasesUseAdvancedParticipants()
    await testSplitPreviewCommitAndUnsupportedCasesUseAdvancedParticipants()
    await testDeleteSolidPreviewCommitAndValidationUseAdvancedParticipants()
    await testMirrorPreviewCommitAndUnsupportedCasesUseAdvancedParticipants()
    await testTransformPreviewCommitAndValidationUseAdvancedParticipants()
    await testSnapshotRenderablesExposeSemanticBindings()
  await testConstructionPlanesExposeFilledRenderSurfaces()
  testResolvePickTargetUsesKernelPriority()
  testRenderValidatorRejectsInvalidGeometry()
  testFeatureSnapshotValidatorPreservesMirrorAndTransformDefinitions()
})
