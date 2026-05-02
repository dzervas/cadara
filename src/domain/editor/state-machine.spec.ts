import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import {
  getEditorHistoryAvailability,
  getEditorViewState,
  getEditorSelectionKey,
  type EditorEffectRuntime,
  initialEditorState,
  runEditorEffect,
  type SketchEditorState,
  transitionEditorState,
  type EditorEvent,
  createModelingServiceEditorEffectRuntime,
} from './state-machine'
import { createEditorEventLoop } from '@/application/editor/editor-event-loop'
import {
  replayEditorEvents,
  replayEditorEventsWithRuntime,
} from '@/domain/editor/state-machine-test-builder'
import {
  getDefaultSelectionFilterForMode,
  planeSelectionFilter,
  primitiveRefEquals,
  type PrimitiveRef,
  type SelectionTargetCatalog,
} from '@/core/editor/schema'
import type { ToolId } from '@/core/tools/tool-registry'
import type { ImportProvider } from '@/contracts/import/provider'
import type { WorkspaceSnapshot, ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { SnapshotEntityRecord, SketchSnapshotRecord } from '@/contracts/modeling/schema'
import type {
  ConstructionId,
  CommandSessionId,
  DocumentId,
  FeatureId,
  PickId,
  RegionId,
  RenderableId,
  RevisionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
  SnapshotEntityId,
} from '@/contracts/shared/ids'
import {
  CONTRACT_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import {
  acceptSketchDraw,
  appendReferenceImageOperations,
  beginSketchTool,
  createNewSketchSession,
  createSketchSessionFromSnapshot,
  getSketchAnnotationDescriptors,
  getSketchSessionPreviewLabel,
  getSketchToolPresentation,
  mapSketchPointToWorld,
  patchSketchConstraintValue,
  selectSketchConstraintTarget,
  startSketchDraw,
} from '@/domain/editor/sketch-session'
import { buildSelectionTargetCatalog } from '@/domain/modeling/document-snapshot-view'
import { getPreviousDocumentHistoryCursor } from '@/domain/modeling/document-history'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import { createMemoryDocumentRepository } from '@/domain/modeling/memory-document-repository'
import { createModelingService } from '@/domain/modeling/modeling-service'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import type { SketchDefinition } from '@/contracts/sketch/schema'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { createAppError, ResultAsync, type AppError } from '@/contracts/errors'
import { createReferenceImageOperation } from '@/domain/reference-image/operations'
import { createScopedImportProviderRegistryForTest, createScopedSketchSpecialModeRegistryForTest } from '@/domain/extensions/test-registry-composition'

test('src/contracts/editor/state-machine.spec.ts', async () => {  function createSelectionCatalog(): SelectionTargetCatalog {
    return {
      selectableTargetKeys: [
        'sketch:sketch_a',
        'construction:construction_plane-xy',
        'construction:construction_plane-yz',
        'construction:construction_plane-xz',
        'face:body_a:face_top',
        'body:body_a',
        'edge:body_a:edge_a',
        'edge:body_a:edge_axis',
      ],
      existingSketchKeys: ['sketch:sketch_a'],
      constructionPlaneKeys: [
        'construction:construction_plane-xy',
        'construction:construction_plane-yz',
        'construction:construction_plane-xz',
      ],
      planarFaceKeys: ['face:body_a:face_top'],
    }
  }

  function createRegionSelectionCatalog(): SelectionTargetCatalog {
    return {
      selectableTargetKeys: [
        'sketch:sketch_a',
        'region:sketch_a:region_profile_a',
        'construction:construction_plane-xy',
        'construction:construction_plane-yz',
        'construction:construction_plane-xz',
        'face:body_a:face_top',
        'body:body_a',
        'edge:body_a:edge_a',
        'edge:body_a:edge_axis',
      ],
      existingSketchKeys: ['sketch:sketch_a', 'region:sketch_a:region_profile_a'],
      constructionPlaneKeys: [
        'construction:construction_plane-xy',
        'construction:construction_plane-yz',
        'construction:construction_plane-xz',
      ],
      planarFaceKeys: ['face:body_a:face_top'],
    }
  }

  function createSectionSelectionSnapshot(): WorkspaceSnapshot {
    const base = createSnapshot()
    const plane = createStandardPlaneDefinition('xy')

    return {
      ...base,
      sketches: [
        {
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: 'rev_1',
          ownerFeatureId: null,
          ownerSketchId: 'sketch_a',
          ownerBodyId: null,
          sketchId: 'sketch_a',
          label: 'Sketch A',
          plane,
          planeTarget: plane.support,
          planeKey: plane.key,
          sketch: {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: 'sketch_a',
            ownerBodyId: null,
            sketchId: 'sketch_a',
            label: 'Sketch A',
            planeSupport: plane.support,
            definition: {
              schemaVersion: 'sketch-definition/v1alpha1',
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
            },
            solvedSnapshot: {
              schemaVersion: 'solved-sketch/v1alpha1',
              status: {
                solveState: 'solved',
                constraintState: 'underConstrained',
              },
              solvedEntities: [],
              solvedPoints: [],
              constraintStatuses: [],
              dimensionStatuses: [],
              diagnostics: [],
            },
            regions: [],
          },
        },
      ],
      document: {
        ...base.document,
        sketches: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: 'sketch_a',
            ownerBodyId: null,
            sketchId: 'sketch_a',
            label: 'Sketch A',
            plane,
            planeTarget: plane.support,
            planeKey: plane.key,
            sketch: {
              ownerDocumentId: 'doc_workspace',
              ownerRevisionId: 'rev_1',
              ownerFeatureId: null,
              ownerSketchId: 'sketch_a',
              ownerBodyId: null,
              sketchId: 'sketch_a',
              label: 'Sketch A',
              planeSupport: plane.support,
              definition: {
                schemaVersion: 'sketch-definition/v1alpha1',
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
              },
              solvedSnapshot: {
                schemaVersion: 'solved-sketch/v1alpha1',
                status: {
                  solveState: 'solved',
                  constraintState: 'underConstrained',
                },
                solvedEntities: [],
                solvedPoints: [],
                constraintStatuses: [],
                dimensionStatuses: [],
                diagnostics: [],
              },
              regions: [],
            },
          },
        ],
        entities: [
          ...base.document.entities,
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: 'body_a',
            id: 'snapshot_entity_face_top' as SnapshotEntityId,
            label: 'Top face',
            target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['face', 'planarFace', 'planarReference'],
          },
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: 'sketch_a',
            ownerBodyId: null,
            id: 'snapshot_entity_region_a' as SnapshotEntityId,
            label: 'Sketch region',
            target: { kind: 'region', sketchId: 'sketch_a', regionId: 'region_profile_a' as RegionId },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['regionProfile'],
          },
        ],
        render: {
          schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
          records: [
            {
              id: 'renderable_face_top' as RenderableId,
              label: 'Top face',
              ownerBodyId: 'body_a',
              ownerFeatureId: null,
              binding: {
                pickId: 'pick_face_top' as PickId,
                pickPriority: 8,
                target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
                topology: 'face',
                semanticClass: 'planarFace',
              },
              geometry: {
                kind: 'mesh',
                vertexPositions: [
                  [0, 0, 0],
                  [4, 0, 0],
                  [0, 4, 0],
                ],
                vertexNormals: [
                  [0, 0, 1],
                  [0, 0, 1],
                  [0, 0, 1],
                ],
                triangleIndices: [[0, 1, 2]],
              },
            },
          ],
        },
      },
      presentation: {
        ...base.presentation,
        entities: [
          ...base.presentation.entities,
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: 'body_a',
            id: 'snapshot_entity_face_top' as SnapshotEntityId,
            label: 'Top face',
            target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['face', 'planarFace', 'planarReference'],
          },
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: 'sketch_a',
            ownerBodyId: null,
            id: 'snapshot_entity_region_a' as SnapshotEntityId,
            label: 'Sketch region',
            target: { kind: 'region', sketchId: 'sketch_a', regionId: 'region_profile_a' as RegionId },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['regionProfile'],
          },
        ],
      },
    }
  }

  function createSnapshot(): WorkspaceSnapshot {
    return {
      contractVersion: 'modeling-contract/v1alpha1',
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      documentId: 'doc_workspace',
      revisionId: 'rev_1',
      settings: {
        linearUnit: 'millimeter',
        modelingTolerance: 0.001,
        angularToleranceRadians: 0.0001,
      },
      capabilities: {
        supportedFeatureKinds: ['extrude'],
        previewableFeatureKinds: ['extrude'],
        supportedProfileKinds: ['region', 'face'],
        supportsFaceBackedSketchPlanes: true,
        supportsDurableTopologyNaming: false,
      },
      featureTree: [],
      objects: [],
      documentHistory: [],
      references: [],
      render: {
        schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
        records: [],
      },
      sketches: [],
      features: [],
      cursor: { kind: 'empty' },
      bodies: [],
      constructions: [
        {
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: 'rev_1',
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: null,
          constructionId: 'construction_plane-xy' as ConstructionId,
          label: 'Top Plane',
          constructionType: 'plane',
          plane: createStandardPlaneDefinition('xy'),
          target: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
        },
      ],
      variables: [],
      entities: [
        {
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: 'rev_1',
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: null,
          id: 'snapshot_entity_plane_xy' as SnapshotEntityId,
          label: 'Top Plane',
          target: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
          relatedTargets: [],
          contributingFeatureIds: [],
          consumedByFeatureIds: [],
          selectionSemantics: ['constructionPlane', 'planarReference'],
        },
      ],
      diagnostics: [],
      document: {
        contractVersion: CONTRACT_VERSION,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
        settings: {
          linearUnit: 'millimeter',
          modelingTolerance: 0.001,
          angularToleranceRadians: 0.0001,
        },
        capabilities: {
          supportedFeatureKinds: ['extrude'],
          previewableFeatureKinds: ['extrude'],
          supportedProfileKinds: ['region', 'face'],
          supportsFaceBackedSketchPlanes: true,
          supportsDurableTopologyNaming: false,
        },
        featureTree: [],
        objects: [],
        features: [],
        cursor: { kind: 'empty' },
        sketches: [],
        bodies: [],
        constructions: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            constructionId: 'construction_plane-xy' as ConstructionId,
            label: 'Top Plane',
            constructionType: 'plane',
            plane: createStandardPlaneDefinition('xy'),
            target: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
          },
        ],
        variables: [],
        entities: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            id: 'snapshot_entity_plane_xy' as SnapshotEntityId,
            label: 'Top Plane',
            target: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['constructionPlane', 'planarReference'],
          },
        ],
        references: [],
        diagnostics: [],
        render: {
          schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
          records: [],
        },
      },
      presentation: {
        featureTree: [],
        objects: [],
        documentHistory: [],
        entities: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            id: 'snapshot_entity_plane_xy' as SnapshotEntityId,
            label: 'Top Plane',
            target: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['constructionPlane', 'planarReference'],
          },
        ],
      },
    }
  }

  async function createImageImportSession() {
    const provider: ImportProvider<{
      sourceName: string
    }, {
      plane: SketchPlaneDefinition | null
      planeTarget: PrimitiveRef | null
      planeKey: 'xy' | 'yz' | 'xz' | null
    }> = {
      id: 'test-image-import',
      label: 'Test Image Import',
      acceptedFileTypes: [{ extension: 'png', mediaType: 'image/png' }],
      accepts() {
        return true
      },
      async review(input) {
        return {
          providerReview: {
            sourceName: input.source.name,
          },
          proposedActionKinds: ['commitSketch'],
          diagnostics: [],
        }
      },
      createDefaultSelections() {
        return {
          plane: null,
          planeTarget: null,
          planeKey: null,
        }
      },
      getReviewFormSchema() {
        return {
          sections: [{
            id: 'image-references',
            title: 'References',
            fields: [{
              id: 'image-plane',
              kind: 'referencePicker',
              label: 'Sketch plane',
              helper: 'Select one construction plane or planar face for the image reference sketch.',
              value: null,
              emptyLabel: 'Pick a construction plane or planar face',
              picker: {
                mode: 'replace',
                allowsMultiple: false,
                selectionFilter: planeSelectionFilter,
                itemLabel: 'Plane reference',
              },
              patch: { patchKey: 'planeSelection' },
              error: { message: 'Select one sketch plane.' },
            }],
          }],
        }
      },
      applySelectionPatch(_review, selections, patch) {
        if (!Object.prototype.hasOwnProperty.call(patch, 'planeSelection')) {
          return selections
        }

        const selection = patch.planeSelection as {
          target?: PrimitiveRef | null
          plane?: SketchPlaneDefinition | null
        } | null

        if (!selection?.target || !selection.plane) {
          if (selection?.target?.kind === 'construction') {
            return {
              plane: createStandardPlaneDefinition('xy'),
              planeTarget: selection.target,
              planeKey: 'xy',
            }
          }

          return {
            plane: null,
            planeTarget: null,
            planeKey: null,
          }
        }

        return {
          plane: selection.plane,
          planeTarget: selection.target,
          planeKey: selection.target.kind === 'construction' ? 'xy' : null,
        }
      },
      async prepare() {
        return { diagnostics: [] }
      },
    }
    const dependencies = {
      importProviders: createScopedImportProviderRegistryForTest([provider]),
      sketchSpecialModes: createScopedSketchSpecialModeRegistryForTest(),
    }
    const source = {
      name: 'reference.png',
      origin: {
        kind: 'localFile' as const,
        fileName: 'reference.png',
        pathHint: '/tmp/reference.png',
      },
      mediaType: 'image/png',
      bytes: Uint8Array.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x04, 0x00, 0x00, 0x00, 0xB5, 0x1C, 0x0C,
        0x02, 0x00, 0x00, 0x00, 0x0B, 0x49, 0x44, 0x41,
        0x54, 0x78, 0xDA, 0x63, 0xFC, 0xFF, 0x1F, 0x00,
        0x03, 0x03, 0x02, 0x00, 0xEF, 0xA7, 0x99, 0x64,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
        0xAE, 0x42, 0x60, 0x82,
      ]),
      fingerprint: `sha256:${'1'.repeat(64)}` as const,
    }
    const review = await provider.review({
      source,
      capabilities: {
        context: {
          contractVersion: CONTRACT_VERSION,
          documentId: 'doc_workspace',
          baseRevisionId: 'rev_1',
        },
        modeling: {
          async bakeGeometry() {
            throw new Error('Not used in image import session tests.')
          },
          async reconstructMeshToBrep() {
            throw new Error('Not used in image import session tests.')
          },
        },
        sketch: {
          async convertVectorToSketch() {
            throw new Error('Not used in image import session tests.')
          },
        },
        assets: {
          async registerGeometryAsset() {
            throw new Error('Not used in image import session tests.')
          },
          async storeEmbeddedBinary() {
            return 'asset_embedded_image_reference'
          },
        },
      },
    })
    const selections = provider.createDefaultSelections(review)

    return {
      session: {
        providerId: provider.id,
        resolvedSource: source,
        review,
        selections,
        formSchema: provider.getReviewFormSchema(review, selections),
        diagnostics: [],
      },
      dependencies,
    }
  }

  async function createMockWorkspaceSnapshot() {
    const adapter = new MockKernelAdapter()
    const response = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    return response.snapshot
  }

  function createOffsetFixtureSketchSession() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [2, 0])
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [2, 0])
    session = acceptSketchDraw(session, [2, 2])
    return session
  }

  function cloneSnapshotWithCursor(
    snapshot: WorkspaceSnapshot,
    cursor: WorkspaceSnapshot['document']['cursor'],
    revisionId: RevisionId,
  ): WorkspaceSnapshot {
    return {
      ...snapshot,
      revisionId,
      cursor: structuredClone(cursor),
      document: {
        ...snapshot.document,
        revisionId,
        cursor: structuredClone(cursor),
      },
    }
  }

  function createRenderRecord(id: string, featureId: FeatureId): WorkspaceSnapshot['document']['render']['records'][number] {
    return {
      id: id as RenderableId,
      label: id,
      ownerBodyId: null,
      ownerFeatureId: featureId,
      binding: {
        pickId: `pick_${id}` as PickId,
        pickPriority: 10,
        target: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
        topology: null,
        semanticClass: 'construction',
      },
      geometry: {
        kind: 'marker',
        position: [0, 0, 0],
        displayRadius: 1,
      },
    }
  }

  function createCursorAwareRuntime(initialSnapshot: WorkspaceSnapshot) {
    let snapshot = structuredClone(initialSnapshot)
    let nextRevisionSequence = 1
    let snapshotReadCount = 0
    const cursorMoves: {
      baseRevisionId: RevisionId
      cursor: WorkspaceSnapshot['document']['cursor']
      transient?: boolean
    }[] = []
    const previewCalls: {
      baseRevisionId: RevisionId
      cursor: WorkspaceSnapshot['document']['cursor']
    }[] = []
    const featureCommitCalls: RevisionId[] = []
    const sketchCommitCalls: RevisionId[] = []

    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => {
        snapshotReadCount += 1
        return snapshot
      },
      commitSketch: async (input) => {
        sketchCommitCalls.push(input.baseRevisionId)
        const revisionId = `rev_sketch_commit_${nextRevisionSequence++}` as RevisionId
        snapshot = cloneSnapshotWithCursor(snapshot, snapshot.document.cursor, revisionId)

        return {
          revisionId,
          accepted: true,
          diagnostics: [],
        }
      },
      projectSketchReferences: async () => ({
        projectedReferences: [],
        diagnostics: [],
      }),
      evaluatePreview: async (input) => {
        previewCalls.push({
          baseRevisionId: input.baseRevisionId,
          cursor: structuredClone(snapshot.document.cursor),
        })

        return {
          revisionId: input.baseRevisionId,
          stale: false,
          diagnostics: [],
          renderables: [],
        }
      },
      commitFeature: async (input) => {
        featureCommitCalls.push(input.baseRevisionId)
        const revisionId = `rev_feature_commit_${nextRevisionSequence++}` as RevisionId
        snapshot = cloneSnapshotWithCursor(snapshot, snapshot.document.cursor, revisionId)

        return {
          revisionId,
          featureId: input.featureSession.featureId ?? ('feature_created' as const),
          accepted: true,
          diagnostics: [],
        }
      },
      setDocumentCursor: async (input) => {
        cursorMoves.push({
          baseRevisionId: input.baseRevisionId,
          cursor: structuredClone(input.cursor),
          transient: input.transient,
        })
        const revisionId = `rev_cursor_${nextRevisionSequence++}` as RevisionId
        snapshot = cloneSnapshotWithCursor(snapshot, input.cursor, revisionId)

        return {
          revisionId,
          accepted: true,
          diagnostics: [],
        }
      },
    }

    return {
      runtime,
      cursorMoves,
      previewCalls,
      featureCommitCalls,
      sketchCommitCalls,
      getSnapshotReadCount: () => snapshotReadCount,
      getSnapshot: () => snapshot,
    }
  }

  async function createSketchExtrudeSketchRevolveSnapshot() {
    const snapshot = structuredClone(await createMockWorkspaceSnapshot())
    const history = snapshot.presentation.documentHistory
    const sketchItem = history.find((item) => item.kind === 'sketch')
    const extrudeItem = history.find((item) => item.kind === 'feature' && item.featureId === 'feature_extrude-1')

    if (!sketchItem || sketchItem.kind !== 'sketch' || !extrudeItem || extrudeItem.kind !== 'feature') {
      throw new Error('Mock snapshot must expose sketch and extrude history for rollback tests.')
    }

    const sketch2 = {
      ...structuredClone(snapshot.document.sketches[0]!),
      sketchId: 'sketch_second' as SketchId,
      ownerSketchId: 'sketch_second' as SketchId,
      label: 'Sketch 2',
      sketch: {
        ...structuredClone(snapshot.document.sketches[0]!.sketch),
        sketchId: 'sketch_second' as SketchId,
        ownerSketchId: 'sketch_second' as SketchId,
        label: 'Sketch 2',
      },
    }
    const revolve = {
      ...structuredClone(snapshot.document.features.find((feature) => feature.featureId === 'feature_extrude-1')!),
      featureId: 'feature_revolve-1',
      ownerFeatureId: 'feature_revolve-1',
      label: 'Revolve 1',
    }
    const sketch2Item = {
      ...structuredClone(sketchItem),
      id: 'document_history_item_sketch_sketch_second',
      label: 'Sketch 2',
      target: { kind: 'sketch' as const, sketchId: sketch2.sketchId },
      sketchId: sketch2.sketchId,
    }
    const revolveItem = {
      ...structuredClone(extrudeItem),
      id: 'document_history_item_feature_feature_revolve-1',
      label: 'Revolve 1',
      target: { kind: 'feature' as const, featureId: revolve.featureId },
      featureId: revolve.featureId,
    }
    const documentHistory = [
      structuredClone(sketchItem),
      structuredClone(extrudeItem),
      sketch2Item,
      revolveItem,
    ]
    const cursor = { kind: 'feature' as const, featureId: revolve.featureId }

    return {
      ...snapshot,
      cursor,
      documentHistory,
      sketches: [...snapshot.document.sketches, sketch2],
      features: [
        ...snapshot.document.features.filter((feature) => feature.featureId === 'feature_extrude-1'),
        revolve,
      ],
      document: {
        ...snapshot.document,
        cursor,
        sketches: [...snapshot.document.sketches, sketch2],
        features: [
          ...snapshot.document.features.filter((feature) => feature.featureId === 'feature_extrude-1'),
          revolve,
        ],
      },
      presentation: {
        ...snapshot.presentation,
        documentHistory,
      },
    } satisfies WorkspaceSnapshot
  }

  function runEventTrace(events: readonly EditorEvent[]) {
    return replayEditorEvents(events)
  }

  async function flushAsyncWork() {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
  }

  function testSketchActivationEmitsCorrelatedOpenEffect() {
    const result = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )

    expectTrue(result.state.kind === 'selectionCommand', 'Sketch activation should arm a selection command.')
    expectTrue(result.state.command.commandSessionId === 'command_sketch-1', 'Sketch command session ID should be deterministic.')
    expectTrue(result.effects.length === 0, 'Sketch without a selection should not emit an effect yet.')

    const openResult = transitionEditorState(
      {
        ...result.state,
      },
      {
        type: 'viewport.selectionRequested',
        target: { kind: 'construction', constructionId: 'construction_plane-xy' },
      },
    )

    expectTrue(openResult.effects.length === 1, 'Selecting a valid sketch plane should emit one open-session effect.')
    expectTrue(openResult.effects[0]?.type === 'sketch.openSession', 'The emitted effect should be sketch.openSession.')
    expectTrue(
      openResult.effects[0]?.commandSessionId === 'command_sketch-1',
      'The open-session effect must preserve the originating command session ID.',
    )
  }

  function testSketchActivationAcceptsAllPrimaryConstructionPlanes() {
    const baseState = {
      ...initialEditorState,
      document: {
        documentId: 'doc_workspace' as DocumentId,
        revisionId: 'rev_1' as RevisionId,
      },
      snapshot: createSnapshot(),
      selectionCatalog: createSelectionCatalog(),
    }

    for (const constructionId of [
      'construction_plane-xy',
      'construction_plane-yz',
      'construction_plane-xz',
    ] as const) {
      const activated = transitionEditorState(baseState, {
        type: 'tool.activated',
        toolId: 'sketch',
      })
      const openResult = transitionEditorState(activated.state, {
        type: 'viewport.selectionRequested',
        target: { kind: 'construction', constructionId },
      })

      expectTrue(
        openResult.effects[0]?.type === 'sketch.openSession',
        `Primary construction plane ${constructionId} should emit sketch.openSession.`,
      )
    }
  }

  function testSketchActivationReusesCompatiblePreselectionAndClearsInvalidSelection() {
    const snapshot = createSectionSelectionSnapshot()
    const selectionCatalog = buildSelectionTargetCatalog(snapshot)

    const reused = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: snapshot.document.documentId,
          revisionId: snapshot.document.revisionId,
        },
        snapshot,
        selectionCatalog,
        selection: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }],
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )

    expectTrue(reused.state.kind === 'selectionCommand', 'Sketch activation should still route through the sketch selection command.')
    expectTrue(reused.state.selection.length === 1, 'Sketch activation should preserve one compatible preselected sketch target.')
    expectTrue(reused.effects[0]?.type === 'sketch.openSession', 'Sketch activation should immediately open from a compatible preselected target.')

    const cleared = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: snapshot.document.documentId,
          revisionId: snapshot.document.revisionId,
        },
        snapshot,
        selectionCatalog,
        selection: [
          { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
          { kind: 'construction', constructionId: 'construction_plane-xy' },
        ],
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )

    expectTrue(cleared.state.kind === 'selectionCommand', 'Sketch activation should remain in selection mode after clearing incompatible preselection.')
    expectTrue(cleared.state.selection.length === 0, 'Sketch activation should clear incompatible multi-target preselection.')
    expectTrue(cleared.effects.length === 0, 'Sketch activation should wait for a new pick after clearing incompatible preselection.')
  }

  function testSketchActivationAcceptsPlanarFaces() {
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )
    const openResult = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
    })

    expectTrue(openResult.effects.length === 1, 'Selecting a planar face should emit one open-session effect.')
    expectTrue(openResult.effects[0]?.type === 'sketch.openSession', 'Planar-face sketch selection should open a sketch session.')
  }

  function testSectionViewActivationCollectsPlanarSeeds() {
    const snapshot = createSectionSelectionSnapshot()
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
      {
        type: 'tool.activated',
        toolId: 'sectionView',
      },
    )

    expectTrue(activated.state.kind === 'selectionCommand', 'Section View activation should arm a selection command.')
    expectTrue(activated.state.command.toolId === 'sectionView', 'Section View activation should preserve the tool id.')
    expectTrue(activated.effects.length === 0, 'Section View activation should stay local until a seed is selected.')

    for (const target of [
      { kind: 'construction', constructionId: 'construction_plane-xy' },
      { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
      { kind: 'region', sketchId: 'sketch_a', regionId: 'region_profile_a' as RegionId },
    ] as const) {
      const selected = transitionEditorState(activated.state, {
        type: 'viewport.selectionRequested',
        target,
        cameraPosition: [0, 0, 20],
      })

      expectTrue(selected.state.kind === 'inspectingSection', `Section View should accept ${target.kind} seeds.`)
      expectTrue(selected.state.section.seed.kind === target.kind, `Section View should store the ${target.kind} seed.`)
      expectTrue(selected.state.section.offset === 0, 'Accepted section seeds should start from the seed plane.')
      expectTrue(selected.state.section.retainedSide === 'negative', 'Positive-Z camera should retain the opposite half-space by default.')
    }
  }

  function testSectionViewRejectsUnsupportedOrCameraLessSeeds() {
    const snapshot = createSectionSelectionSnapshot()
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
      {
        type: 'tool.activated',
        toolId: 'sectionView',
      },
    )

    const invalidTarget = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'body', bodyId: 'body_a' },
      cameraPosition: [0, 0, 20],
    })

    expectTrue(
      invalidTarget.state.kind === 'selectionCommand',
      'Unsupported section seeds should keep the editor in seed-collection mode.',
    )

    const missingCamera = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
    })

    expectTrue(
      missingCamera.state.kind === 'selectionCommand',
      'Section View should require viewport camera context before accepting a seed.',
    )
    expectTrue(
      missingCamera.state.preview?.label.includes('viewport-picked'),
      'Camera-less section seed attempts should explain that viewport selection context is required.',
    )
  }

  function testSectionViewFlipAndClearPreservePlanePosition() {
    const snapshot = createSectionSelectionSnapshot()
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
      {
        type: 'tool.activated',
        toolId: 'sectionView',
      },
    )
    const selected = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
      cameraPosition: [0, 0, 20],
    })

    expectTrue(selected.state.kind === 'inspectingSection', 'Accepted section seeds should enter active section inspection.')
    const moved = transitionEditorState(selected.state, {
      type: 'section.offsetUpdated',
      commandSessionId: selected.state.command.commandSessionId,
      offset: 7.5,
    })
    const flipped = transitionEditorState(moved.state, {
      type: 'section.flipRequested',
      commandSessionId: moved.state.kind === 'inspectingSection'
        ? moved.state.command.commandSessionId
        : ('command_unreachable' as CommandSessionId),
    })

    expectTrue(flipped.state.kind === 'inspectingSection', 'Flipping should keep the section active.')
    expectTrue(flipped.state.section.offset === 7.5, 'Flipping should preserve the current plane position.')
    expectTrue(flipped.state.section.retainedSide === 'positive', 'Flipping should invert the retained half-space.')

    const cleared = transitionEditorState(flipped.state, {
      type: 'section.cleared',
      commandSessionId: flipped.state.command.commandSessionId,
    })

    expectTrue(cleared.state.kind === 'idle', 'Clearing an active section should exit the command session.')
  }

  async function testMeasureActivationPairsSelectionsAndCleansUp() {
    const snapshot = await createMockWorkspaceSnapshot()
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
      {
        type: 'tool.activated',
        toolId: 'measure',
      },
    )

    expectTrue(activated.state.kind === 'selectionCommand', 'Measure activation should start a transient selection command.')
    expectTrue(activated.state.mode === 'part', 'Measure activation should force the workbench into part mode.')
    expectTrue(activated.state.selectionFilter.label === 'Measurement targets', 'Measure activation should install the measurement selection filter.')

    const firstSelection = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-0' },
    })
    expectTrue(firstSelection.state.selection.length === 1, 'Measure should accept a first measurable target.')

    const pairedSelection = transitionEditorState(firstSelection.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'face', bodyId: 'body_part-1', faceId: 'face_top' },
    })
    expectTrue(pairedSelection.state.selection.length === 2, 'Measure should pair supported two-target selections.')

    const replacedSelection = transitionEditorState(pairedSelection.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'body', bodyId: 'body_part-1' },
    })
    expectTrue(
      replacedSelection.state.selection.length === 1
        && replacedSelection.state.selection[0]?.kind === 'body',
      'Selecting a fresh single-target body should replace an existing pairwise measurement.',
    )

    const clearedSelection = transitionEditorState(replacedSelection.state, { type: 'selection.cleared' })
    expectTrue(
      clearedSelection.state.kind === 'selectionCommand' && clearedSelection.state.selection.length === 0,
      'Selection clearing should remove active measurement targets without exiting the command.',
    )

    const cancelled = transitionEditorState(clearedSelection.state, {
      type: 'command.cancelled',
      commandSessionId: clearedSelection.state.command.commandSessionId,
    })
    expectTrue(cancelled.state.kind === 'idle', 'Measure cancellation should return the editor to idle.')
  }

  function testSketchSessionPreservesStoredPlaneDefinition() {
    const yzPlane: SketchPlaneDefinition = {
      support: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
      frame: {
        origin: [0, 0, 0],
        xAxis: [0, 1, 0],
        yAxis: [0, 0, 1],
        normal: [1, 0, 0],
        linearUnit: 'documentLength',
        handedness: 'rightHanded',
      },
      key: 'yz',
    }

    const session = createSketchSessionFromSnapshot({
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_1',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_yz',
      ownerBodyId: null,
      sketchId: 'sketch_yz',
      label: 'Sketch YZ',
      plane: yzPlane,
      planeTarget: yzPlane.support,
      planeKey: 'yz',
      sketch: {
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_1',
        ownerFeatureId: null,
        ownerSketchId: 'sketch_yz',
        ownerBodyId: null,
        sketchId: 'sketch_yz',
        label: 'Sketch YZ',
        planeSupport: yzPlane.support,
        definition: {
          schemaVersion: 'sketch-definition/v1alpha1',
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
        },
        solvedSnapshot: {
          schemaVersion: 'solved-sketch/v1alpha1',
          status: {
            solveState: 'solved',
            constraintState: 'underConstrained',
          },
          solvedEntities: [],
          solvedPoints: [],
          constraintStatuses: [],
          dimensionStatuses: [],
          diagnostics: [],
        },
        regions: [],
      },
    })

    const worldPoint = mapSketchPointToWorld(session.plane, [2, 3])

    expectTrue(session.plane.frame.normal[0] === 1, 'Sketch sessions should retain the stored plane definition.')
    expectTrue(worldPoint[0] === 0 && worldPoint[1] === 2 && worldPoint[2] === 3, 'Sketch display mapping must use the stored plane definition.')
  }

  function createReopenableYzSketchSnapshot(): WorkspaceSnapshot {
    const yzSketchId = 'sketch_yz' as SketchId
    const yzPlane: SketchPlaneDefinition = {
      support: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
      frame: {
        origin: [0, 0, 0],
        xAxis: [0, 1, 0],
        yAxis: [0, 0, 1],
        normal: [1, 0, 0],
        linearUnit: 'documentLength',
        handedness: 'rightHanded',
      },
      key: 'yz',
    }

    const yzSketch: SketchSnapshotRecord = {
      ownerDocumentId: 'doc_workspace' as DocumentId,
      ownerRevisionId: 'rev_1' as RevisionId,
      ownerFeatureId: null,
      ownerSketchId: yzSketchId,
      ownerBodyId: null,
      sketchId: yzSketchId,
      label: 'Sketch YZ',
      plane: yzPlane,
      planeTarget: yzPlane.support,
      planeKey: 'yz' as const,
      sketch: {
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_1',
        ownerFeatureId: null,
        ownerSketchId: yzSketchId,
        ownerBodyId: null,
        sketchId: yzSketchId,
        label: 'Sketch YZ',
        planeSupport: yzPlane.support,
        definition: {
            schemaVersion: 'sketch-definition/v1alpha1',
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
        },
        solvedSnapshot: {
          schemaVersion: 'solved-sketch/v1alpha1',
          status: {
            solveState: 'solved',
            constraintState: 'underConstrained',
          },
          solvedEntities: [],
          solvedPoints: [],
          constraintStatuses: [],
          dimensionStatuses: [],
          diagnostics: [],
        },
        regions: [],
      },
    }

    const yzSketchEntity: SnapshotEntityRecord = {
      ownerDocumentId: 'doc_workspace' as DocumentId,
      ownerRevisionId: 'rev_1' as RevisionId,
      ownerFeatureId: null,
      ownerSketchId: yzSketchId,
      ownerBodyId: null,
      id: 'snapshot_entity_sketch_yz' as SnapshotEntityId,
      label: 'Sketch YZ',
      target: { kind: 'sketch' as const, sketchId: yzSketchId },
      relatedTargets: [],
      contributingFeatureIds: [],
      consumedByFeatureIds: [],
      selectionSemantics: ['existingSketch'] as const,
    }
    const yzHistoryItem = {
      id: 'document_history_item_sketch_sketch_yz',
      label: 'Sketch YZ',
      description: 'Authored sketch',
      kind: 'sketch' as const,
      target: { kind: 'sketch' as const, sketchId: yzSketchId },
      sketchId: yzSketchId,
      featureId: null,
    }

    const baseSnapshot = createSnapshot()

    return {
      ...baseSnapshot,
      cursor: { kind: 'sketch', sketchId: yzSketchId },
      documentHistory: [yzHistoryItem],
      sketches: [
        ...baseSnapshot.document.sketches,
        yzSketch,
      ],
      document: {
        ...baseSnapshot.document,
        cursor: { kind: 'sketch', sketchId: yzSketchId },
        sketches: [
          ...baseSnapshot.document.sketches,
          yzSketch,
        ],
        entities: [
          ...baseSnapshot.document.entities,
          yzSketchEntity,
        ],
      },
      entities: [
        ...baseSnapshot.presentation.entities,
        yzSketchEntity,
      ],
      presentation: {
        ...baseSnapshot.presentation,
        documentHistory: [yzHistoryItem],
        entities: [
          ...baseSnapshot.presentation.entities,
          yzSketchEntity,
        ],
      },
    }
  }

  function testFeaturePreviewIgnoresStaleResponseIds() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'region', sketchId: 'sketch_a', regionId: 'region_profile_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'extrude',
      },
    )

    expectTrue(activation.state.kind === 'editingFeature', 'Extrude activation should enter feature editing.')
    expectTrue(activation.effects.length === 1, 'Extrude activation should emit a preview effect.')
    expectTrue(activation.effects[0]?.type === 'feature.evaluatePreview', 'The emitted effect should be feature.evaluatePreview.')

    const staleIgnored = transitionEditorState(activation.state, {
      type: 'effect.featurePreviewCompleted',
      requestId: 'request_feature-preview-stale',
      documentId: 'doc_workspace',
      commandSessionId: 'command_extrude-1',
      baseRevisionId: 'rev_1',
      revisionId: 'rev_1',
      stale: false,
      diagnostics: [],
      renderables: [],
    })

    expectTrue(
      staleIgnored.state === activation.state,
      'A preview response with the wrong request ID must be ignored.',
    )
  }

  function testRevolveActivationStartsFeaturePreviewFlow() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'region', sketchId: 'sketch_a', regionId: 'region_profile_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'revolve',
      },
    )

    expectTrue(activation.state.kind === 'editingFeature', 'Revolve activation should enter feature editing.')
    expectTrue(activation.state.session.featureType === 'revolve', 'Revolve activation should create a revolve session.')
    expectTrue(activation.effects.length === 0, 'Revolve activation without an axis should stay local until the draft is complete.')

    const completed = transitionEditorState(activation.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'edge', bodyId: 'body_a', edgeId: 'edge_axis' },
    })

    expectTrue(completed.state.kind === 'editingFeature', 'Revolve selection updates should remain in feature editing.')
    expectTrue(completed.effects.length === 1, 'Selecting the missing revolve axis should emit one preview effect.')
    expectTrue(completed.effects[0]?.type === 'feature.evaluatePreview', 'Completed revolve drafts should request a preview effect.')
  }

  function testRevolveActivationSupportsFaceThenEdgeSelection() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: {
          ...createRegionSelectionCatalog(),
          selectableTargetKeys: [
            ...createRegionSelectionCatalog().selectableTargetKeys,
            'face:body_a:face_side',
            'body:body_b',
          ],
        },
        selection: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }],
      },
      {
        type: 'tool.activated',
        toolId: 'revolve',
      },
    )

    expectTrue(activation.state.kind === 'editingFeature', 'Face-selected revolve activation should enter feature editing.')
    expectTrue(activation.state.session.featureType === 'revolve', 'Face-selected revolve activation should create a revolve session.')
    expectTrue(
      activation.state.session.draft.profileTargets[0]?.kind === 'face',
      'Face-selected revolve activation should keep the selected face as the revolve profile.',
    )
    expectTrue(activation.effects.length === 0, 'Face-selected revolve activation should wait for an axis before previewing.')

    const completed = transitionEditorState(activation.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'edge', bodyId: 'body_a', edgeId: 'edge_axis' },
    })

    expectTrue(completed.state.kind === 'editingFeature', 'Revolve face-then-edge flow should remain in feature editing.')
    expectTrue(completed.state.session.featureType === 'revolve', 'Revolve face-then-edge flow should preserve the revolve session kind.')
    expectTrue(
      completed.state.session.draft.axisTarget?.kind === 'edge',
      'Revolve face-then-edge flow should preserve the selected edge as the axis target.',
    )
    expectTrue(completed.effects.length === 1, 'Selecting the axis after a face profile should emit one preview effect.')
    expectTrue(completed.effects[0]?.type === 'feature.evaluatePreview', 'Completed face-then-edge revolve drafts should request a preview effect.')
  }

  function testShellActivationSeedsBodyFromSelectedFace() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }],
      },
      {
        type: 'tool.activated',
        toolId: 'shell',
      },
    )

    expectTrue(activation.state.kind === 'editingFeature', 'Shell activation should enter feature editing.')
    expectTrue(activation.state.session.featureType === 'shell', 'Shell activation should create a shell session.')
    expectTrue(activation.state.session.draft.bodyTarget?.bodyId === 'body_a', 'Shell activation should infer the source body from a selected face.')
    expectTrue(activation.effects.length === 1, 'Shell activation with a face target should emit one preview effect.')
    expectTrue(activation.effects[0]?.type === 'feature.evaluatePreview', 'Shell activation should request a preview effect.')
  }

  function testThickenActivationSeedsFaceTargetsFromSelection() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }],
      },
      {
        type: 'tool.activated',
        toolId: 'thicken',
      },
    )

    expectTrue(activation.state.kind === 'editingFeature', 'Thicken activation should enter feature editing.')
    expectTrue(activation.state.session.featureType === 'thicken', 'Thicken activation should create a thicken session.')
    expectTrue(
      activation.state.session.draft.faceTargets[0]?.faceId === 'face_top',
      'Thicken activation should seed the selected face into the draft.',
    )
    expectTrue(activation.effects.length === 1, 'Thicken activation with a face target should emit one preview effect.')
    expectTrue(activation.effects[0]?.type === 'feature.evaluatePreview', 'Thicken activation should request a preview effect.')
  }

  function testSplitAndDeleteSolidActivationStartFeatureSessions() {
    const combineCatalog = createRegionSelectionCatalog()
    const combineActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: {
          ...combineCatalog,
          selectableTargetKeys: [...combineCatalog.selectableTargetKeys, 'body:body_b'],
        },
        selection: [{ kind: 'body', bodyId: 'body_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'combine',
      },
    )

    expectTrue(combineActivation.state.kind === 'editingFeature', 'Combine activation should enter feature editing.')
    expectTrue(combineActivation.state.session.featureType === 'combine', 'Combine activation should create a combine session.')
    expectTrue(
      combineActivation.state.session.draft.targetBodyTargets[0]?.bodyId === 'body_a',
      'Combine activation should seed the selected body as a target body.',
    )
    expectTrue(combineActivation.effects.length === 0, 'Combine activation should wait for explicit tool bodies before previewing.')

    const combineToolSelection = transitionEditorState(combineActivation.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'body', bodyId: 'body_b' },
    })

    expectTrue(
      combineToolSelection.state.kind === 'editingFeature' &&
        combineToolSelection.state.session.featureType === 'combine' &&
        combineToolSelection.state.session.draft.toolBodyTargets[0]?.bodyId === 'body_b',
      'Combine body selection should fill explicit tool bodies after the target role is populated.',
    )
    expectTrue(combineToolSelection.effects[0]?.type === 'feature.evaluatePreview', 'Complete Combine drafts should request a preview effect.')

    const splitActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'body', bodyId: 'body_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'split',
      },
    )

    expectTrue(splitActivation.state.kind === 'editingFeature', 'Split activation should enter feature editing.')
    expectTrue(splitActivation.state.session.featureType === 'split', 'Split activation should create a split session.')
    expectTrue(
      splitActivation.state.session.draft.targetBodyTarget?.bodyId === 'body_a',
      'Split activation should seed the selected body as the target body.',
    )
    expectTrue(splitActivation.effects.length === 0, 'Split activation should wait for the tool body before previewing.')

    const deleteSolidActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'body', bodyId: 'body_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'deleteSolid',
      },
    )

    expectTrue(deleteSolidActivation.state.kind === 'editingFeature', 'Delete-solid activation should enter feature editing.')
    expectTrue(deleteSolidActivation.state.session.featureType === 'deleteSolid', 'Delete-solid activation should create a delete-solid session.')
    expectTrue(
      deleteSolidActivation.state.session.draft.bodyTargets[0]?.bodyId === 'body_a',
      'Delete-solid activation should seed the selected body into the delete list.',
    )
    expectTrue(deleteSolidActivation.effects.length === 1, 'Delete-solid activation with a selected body should emit one preview effect.')
    expectTrue(deleteSolidActivation.effects[0]?.type === 'feature.evaluatePreview', 'Delete-solid activation should request a preview effect.')
  }

  function testFeatureActivationReusesCompatibleSelectionAndClearsInvalidSelection() {
    const baseState = {
      ...initialEditorState,
      document: {
        documentId: 'doc_workspace' as const,
        revisionId: 'rev_1' as const,
      },
      snapshot: createSnapshot(),
      selectionCatalog: {
        ...createRegionSelectionCatalog(),
        selectableTargetKeys: [...createRegionSelectionCatalog().selectableTargetKeys, 'body:body_b'],
      },
    }

    const reused = transitionEditorState(
      {
        ...baseState,
        selection: [
          { kind: 'body', bodyId: 'body_a' },
          { kind: 'body', bodyId: 'body_b' },
        ],
      },
      {
        type: 'tool.activated',
        toolId: 'combine',
      },
    )

    expectTrue(reused.state.kind === 'editingFeature', 'Compatible feature preselection should enter feature editing.')
    expectTrue(reused.state.selection.length === 2, 'Compatible feature activation should preserve the adopted selection.')
    expectTrue(
      reused.state.session.draft.targetBodyTargets[0]?.bodyId === 'body_a'
        && reused.state.session.draft.toolBodyTargets[0]?.bodyId === 'body_b',
      'Feature activation should seed the first adopted target and replay later adopted targets in order.',
    )

    const cleared = transitionEditorState(
      {
        ...baseState,
        selection: [{ kind: 'body', bodyId: 'body_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'extrude',
      },
    )

    expectTrue(cleared.state.kind === 'editingFeature', 'Incompatible feature preselection should still enter the feature create flow.')
    expectTrue(cleared.state.selection.length === 0, 'Incompatible feature preselection should be cleared during activation.')
    expectTrue(cleared.state.session.draft.profileTargets.length === 0, 'Cleared feature activation should not partially seed the draft.')
  }

  function testMirrorAndTransformActivationStartFeatureSessions() {
    const mirrorActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'body', bodyId: 'body_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'mirror',
      },
    )

    expectTrue(mirrorActivation.state.kind === 'editingFeature', 'Mirror activation should enter feature editing.')
    expectTrue(mirrorActivation.state.session.featureType === 'mirror', 'Mirror activation should create a mirror session.')
    expectTrue(mirrorActivation.state.session.draft.bodyTargets[0]?.bodyId === 'body_a', 'Mirror activation should seed the selected body as a mirror target.')
    expectTrue(mirrorActivation.effects.length === 0, 'Mirror activation should wait for an explicit plane before previewing.')

    const transformActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'body', bodyId: 'body_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'transform',
      },
    )

    expectTrue(transformActivation.state.kind === 'editingFeature', 'Transform activation should enter feature editing.')
    expectTrue(transformActivation.state.session.featureType === 'transform', 'Transform activation should create a transform session.')
    expectTrue(transformActivation.state.session.draft.bodyTargets[0]?.bodyId === 'body_a', 'Transform activation should seed the selected body as a transform target.')
    expectTrue(transformActivation.effects.length === 0, 'Transform activation should wait for an explicit transform reference before previewing.')
  }

  function testActiveReferencePickerRoutesSingleAndMultiSelections() {
    const catalog = createRegionSelectionCatalog()
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: {
          ...catalog,
          selectableTargetKeys: [
            ...catalog.selectableTargetKeys,
            'face:body_a:face_side',
            'body:body_b',
          ],
        },
        selection: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }],
      },
      {
        type: 'tool.activated',
        toolId: 'shell',
      },
    )

    expectTrue(activation.state.kind === 'editingFeature', 'Shell activation should enter feature editing.')

    const facesActive = transitionEditorState(activation.state, {
      type: 'form.referencePickerActivated',
      fieldId: 'shell-faces',
    })

    expectTrue(facesActive.state.kind === 'editingFeature', 'Reference picker activation should stay in feature editing.')
    expectTrue(
      facesActive.state.activeReferencePickerFieldId === 'shell-faces',
      'Reference picker activation should track the active form field id.',
    )
    expectTrue(
      facesActive.state.selectionFilter?.label === 'Shell faces',
      'Reference picker activation should switch to the field selection filter.',
    )

    const faceAppended = transitionEditorState(facesActive.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'face', bodyId: 'body_a', faceId: 'face_side' },
    })

    expectTrue(faceAppended.state.kind === 'editingFeature', 'Multi-reference selection should stay in feature editing.')
    expectTrue(
      faceAppended.state.session.featureType === 'shell' && faceAppended.state.session.draft.faceTargets.length === 2,
      'Active multi-reference picker selection should append unique selected instances.',
    )

    const bodyActive = transitionEditorState(faceAppended.state, {
      type: 'form.referencePickerActivated',
      fieldId: 'shell-body',
    })

    expectTrue(bodyActive.state.kind === 'editingFeature', 'Switching active picker fields should stay in feature editing.')
    expectTrue(
      bodyActive.state.activeReferencePickerFieldId === 'shell-body',
      'Switching active picker fields should update the active field id.',
    )
    expectTrue(
      bodyActive.state.selectionFilter?.label === 'Shell body',
      'Switching active picker fields should update the current selection filter.',
    )

    const bodySelected = transitionEditorState(bodyActive.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'body', bodyId: 'body_b' },
    })

    expectTrue(bodySelected.state.kind === 'editingFeature', 'Single-reference selection should stay in feature editing.')
    expectTrue(
      bodySelected.state.session.featureType === 'shell' && bodySelected.state.session.draft.bodyTarget?.bodyId === 'body_b',
      'Active single-reference picker selection should replace the bound reference.',
    )
  }

  function testReferencePickerCancellationAndSessionCleanup() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }],
      },
      {
        type: 'tool.activated',
        toolId: 'shell',
      },
    )

    expectTrue(activation.state.kind === 'editingFeature', 'Shell activation should enter feature editing.')

    const active = transitionEditorState(activation.state, {
      type: 'form.referencePickerActivated',
      fieldId: 'shell-faces',
    })

    expectTrue(active.state.kind === 'editingFeature', 'Reference picker activation should stay in feature editing.')

    const escaped = transitionEditorState(active.state, {
      type: 'form.referencePickerCancelled',
    })

    expectTrue(escaped.state.kind === 'editingFeature', 'Escape cancellation should not cancel the whole feature session.')
    expectTrue(escaped.state.activeReferencePickerFieldId === null, 'Escape cancellation should clear the active picker field.')
    expectTrue(escaped.state.selection.length === 0, 'Escape cancellation should clear picker-specific pending selection.')
    expectTrue(
      escaped.state.selectionFilter?.label === 'Shell references',
      'Escape cancellation should restore the feature-level selection filter.',
    )

    const cancelled = transitionEditorState(active.state, {
      type: 'command.cancelled',
      commandSessionId: active.state.command.commandSessionId,
    })

    expectTrue(cancelled.state.kind === 'idle', 'Feature session cancellation should leave feature editing.')

    const switched = transitionEditorState(active.state, {
      type: 'tool.activated',
      toolId: 'fillet',
    })

    expectTrue(switched.state.kind === 'editingFeature', 'Switching to another feature tool should enter the new feature session.')
    expectTrue(
      switched.state.activeReferencePickerFieldId === null,
      'Switching to another feature session should clear active picker state.',
    )
  }

  async function testImportSessionAutoArmsSinglePlanePicker() {
    const importSession = await createImageImportSession()
    const result = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'import.fileSelected',
        session: importSession.session,
      },
      importSession.dependencies,
    )

    expectTrue(result.state.kind === 'importing', 'Import file selection should enter the importing state.')
    expectTrue(
      result.state.activeReferencePickerFieldId === 'image-plane',
      'A single import plane picker should arm automatically when the import session opens.',
    )
    expectTrue(
      result.state.selectionFilter?.label === 'Plane references',
      'Auto-armed import plane pickers should switch the editor into plane-selection mode immediately.',
    )
    expectTrue(
      result.state.command.phase === 'collecting',
      'Auto-armed import plane pickers should keep the import command in selection-collection mode.',
    )
  }

  async function testImportPlaneSelectionCompletesSinglePlanePicker() {
    const importSession = await createImageImportSession()
    const opened = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'import.fileSelected',
        session: importSession.session,
      },
      importSession.dependencies,
    )

    expectTrue(opened.state.kind === 'importing', 'Import file selection should enter the importing state.')

    const selected = transitionEditorState(
      opened.state,
      {
        type: 'viewport.selectionRequested',
        target: { kind: 'construction', constructionId: 'construction_plane-xy' },
      },
      importSession.dependencies,
    )

    expectTrue(selected.state.kind === 'importing', 'Plane selection should keep the editor inside the import session.')
    expectTrue(
      selected.state.session.selections.planeTarget?.kind === 'construction'
        && selected.state.session.selections.planeTarget.constructionId === 'construction_plane-xy',
      'Import plane selection should patch the selected construction plane into import selections.',
    )
    expectTrue(
      selected.state.activeReferencePickerFieldId === null,
      'Single import plane picks should complete the active picker after a valid selection.',
    )
    expectTrue(
      selected.state.selectionFilter?.label === getDefaultSelectionFilterForMode('part')?.label,
      'Completing the import plane pick should restore the default part-mode selection filter.',
    )
    expectTrue(
      selected.state.command.phase === 'editing',
      'Completing the import plane pick should return the import command to editing mode.',
    )
  }

  function testSelectionClearEventClearsSelectionAndPreservesActiveState() {
    const selectedTarget = { kind: 'body', bodyId: 'body_a' } as PrimitiveRef
    const hoverTarget = { kind: 'edge', bodyId: 'body_a', edgeId: 'edge_a' } as PrimitiveRef
    const selectedState = {
      ...initialEditorState,
      document: {
        documentId: 'doc_workspace' as const,
        revisionId: 'rev_1' as const,
      },
      snapshot: createSnapshot(),
      selection: [selectedTarget],
      hoverTarget,
      selectionCatalog: createSelectionCatalog(),
    }

    const idleCleared = transitionEditorState(selectedState, { type: 'selection.cleared' })

    expectTrue(idleCleared.state.kind === 'idle', 'Selection clearing should keep idle state idle.')
    expectTrue(idleCleared.state.selection.length === 0, 'Selection clearing should remove idle selection.')
    expectTrue(idleCleared.state.hoverTarget === null, 'Selection clearing should remove idle hover.')

    const commandStarted = transitionEditorState(selectedState, {
      type: 'tool.activated',
      toolId: 'sketch',
    })

    expectTrue(commandStarted.state.kind === 'selectionCommand', 'Sketch activation should create a selection command.')

    const commandCleared = transitionEditorState(commandStarted.state, { type: 'selection.cleared' })

    expectTrue(commandCleared.state.kind === 'selectionCommand', 'Selection clearing should preserve active command state.')
    expectTrue(
      commandCleared.state.command.commandSessionId === commandStarted.state.command.commandSessionId,
      'Selection clearing should preserve the active command session.',
    )
    expectTrue(commandCleared.state.selection.length === 0, 'Selection clearing should remove active-command selection.')
    expectTrue(commandCleared.state.hoverTarget === null, 'Selection clearing should remove active-command hover.')

    const sketchSession = createNewSketchSession(createStandardPlaneDefinition('xy'))
    const sketchState: SketchEditorState = {
      ...selectedState,
      kind: 'editingSketch',
      mode: 'sketch',
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(sketchSession),
        target: sketchSession.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-1',
        toolId: 'sketch',
        phase: 'editing',
      },
      session: sketchSession,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    }

    const sketchCleared = transitionEditorState(sketchState, { type: 'selection.cleared' })

    expectTrue(sketchCleared.state.kind === 'editingSketch', 'Selection clearing should preserve sketch editing state.')
    expectTrue(
      sketchCleared.state.command.commandSessionId === sketchState.command.commandSessionId,
      'Selection clearing should preserve the sketch command session.',
    )
    expectTrue(sketchCleared.state.selection.length === 0, 'Selection clearing should remove sketch selection.')
    expectTrue(sketchCleared.state.hoverTarget === null, 'Selection clearing should remove sketch hover.')
  }

  function testReplayIsDeterministic() {
    const snapshot = createSnapshot()
    const payload = {
      requestId: 'request_snapshot-1' as const,
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
      snapshot,
      selectionCatalog: createSelectionCatalog(),
    }

    const events: EditorEvent[] = [
      { type: 'session.started' },
      { type: 'effect.snapshotLoaded', payload },
      { type: 'tool.activated', toolId: 'sketch' },
      {
        type: 'viewport.selectionRequested',
        target: { kind: 'construction', constructionId: 'construction_plane-xy' },
      },
    ]

    const first = runEventTrace(events)
    const second = runEventTrace(events)

    expectTrue(
      JSON.stringify(first.state) === JSON.stringify(second.state),
      'Replaying the same event trace should reach the same machine state.',
    )
    expectTrue(
      JSON.stringify(first.effects) === JSON.stringify(second.effects),
      'Replaying the same event trace should emit the same effect sequence.',
    )
  }

  function testDirectSnapshotLoadUpdatesDocumentWithoutFetch() {
    const initialSnapshot = createSnapshot()
    const loadedState = {
      ...initialEditorState,
      document: {
        documentId: initialSnapshot.document.documentId,
        revisionId: initialSnapshot.document.revisionId,
      },
      snapshot: initialSnapshot,
      selectionCatalog: buildSelectionTargetCatalog(initialSnapshot),
    }
    const nextSnapshot = structuredClone(initialSnapshot)
    nextSnapshot.document.revisionId = 'rev_2'
    nextSnapshot.document.revisionId = 'rev_2'

    const loaded = transitionEditorState(loadedState, {
      type: 'document.snapshotLoaded',
      snapshot: nextSnapshot,
    })

    expectTrue(loaded.effects.length === 0, 'Direct snapshot loads should not request another snapshot fetch.')
    expectTrue(loaded.state.snapshot?.document.revisionId === 'rev_2', 'Direct snapshot loads should update visible snapshot state immediately.')
    expectTrue(loaded.state.document.revisionId === 'rev_2', 'Direct snapshot loads should update the editor document revision.')
  }

  function testSelectionKeyUsesDurableRefs() {
    const key = getEditorSelectionKey({ kind: 'feature', featureId: 'feature_alpha' })
    expectTrue(key === 'feature:feature_alpha', 'Selection key derivation should remain deterministic.')
  }

  async function testRuntimeLoopProcessesSketchOpen() {
    const runtimeSnapshot: WorkspaceSnapshot = createSnapshot()
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: 'rev_1' as const,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: 'rev_1' as const,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: 'request_snapshot-1',
            documentId: 'doc_workspace',
            revisionId: 'rev_1',
            snapshot: runtimeSnapshot,
            selectionCatalog: createSelectionCatalog(),
          },
        },
        { type: 'tool.activated', toolId: 'sketch' },
        {
          type: 'viewport.selectionRequested',
          target: { kind: 'construction', constructionId: 'construction_plane-xy' },
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'editingSketch', 'Runtime loop should enter sketch editing after opening a sketch session.')
    expectTrue(
      result.state.session.planeTarget.kind === 'construction',
      'Opened sketch session should preserve the selected construction plane.',
    )
    expectTrue(
      result.state.command.commandSessionId === 'command_sketch-1',
      'Runtime loop should preserve the originating command session ID.',
    )
  }

  async function testRuntimeLoopOpensSketchFromPlanarFace() {
    const runtimeSnapshot = await createMockWorkspaceSnapshot()
    const planarFace = runtimeSnapshot.document.render.records.find((record) =>
      record.binding.target.kind === 'face'
      && record.binding.semanticClass === 'planarFace',
    )?.binding.target
    expectTrue(planarFace?.kind === 'face', 'Mock runtime snapshot should expose a planar face render target.')

    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: runtimeSnapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: runtimeSnapshot.document.revisionId,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: 'request_snapshot-1',
            documentId: runtimeSnapshot.document.documentId,
            revisionId: runtimeSnapshot.document.revisionId,
            snapshot: runtimeSnapshot,
            selectionCatalog: buildSelectionTargetCatalog(runtimeSnapshot),
          },
        },
        { type: 'tool.activated', toolId: 'sketch' },
        {
          type: 'viewport.selectionRequested',
          target: planarFace,
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'editingSketch', 'Runtime loop should enter sketch editing after selecting a planar face.')
    expectTrue(result.state.session.planeTarget.kind === 'face', 'Face-backed sketch session should preserve the selected face support.')
    expectTrue(result.state.session.plane.support.kind === 'face', 'Face-backed sketch session should derive a face-supported plane.')
    expectTrue(result.state.session.plane.frame.origin[2] === 12, 'Face-backed sketch plane should derive its origin from the selected face mesh.')
  }

  async function testRuntimeLoopOpensSketchFromNonXYConstruction() {
    const runtimeSnapshot: WorkspaceSnapshot = {
      ...createSnapshot(),
      constructions: [
        {
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: 'rev_1',
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: null,
          constructionId: 'construction_plane-yz' as ConstructionId,
          label: 'Right Plane',
          constructionType: 'plane',
          plane: createStandardPlaneDefinition('yz'),
          target: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
        },
      ],
      document: {
        ...createSnapshot().document,
        constructions: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            constructionId: 'construction_plane-yz' as ConstructionId,
            label: 'Right Plane',
            constructionType: 'plane',
            plane: createStandardPlaneDefinition('yz'),
            target: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
          },
        ],
        entities: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            id: 'snapshot_entity_plane_yz' as SnapshotEntityId,
            label: 'Right Plane',
            target: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['constructionPlane', 'planarReference'],
          },
        ],
      },
      entities: [
        {
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: 'rev_1',
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: null,
          id: 'snapshot_entity_plane_yz' as SnapshotEntityId,
          label: 'Right Plane',
          target: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
          relatedTargets: [],
          contributingFeatureIds: [],
          consumedByFeatureIds: [],
          selectionSemantics: ['constructionPlane', 'planarReference'],
        },
      ],
      presentation: {
        ...createSnapshot().presentation,
        entities: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            id: 'snapshot_entity_plane_yz' as SnapshotEntityId,
            label: 'Right Plane',
            target: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['constructionPlane', 'planarReference'],
          },
        ],
      },
    }
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: 'rev_1' as const,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: 'rev_1' as const,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: 'request_snapshot-1',
            documentId: 'doc_workspace',
            revisionId: 'rev_1',
            snapshot: runtimeSnapshot,
            selectionCatalog: createSelectionCatalog(),
          },
        },
        { type: 'tool.activated', toolId: 'sketch' },
        {
          type: 'viewport.selectionRequested',
          target: { kind: 'construction', constructionId: 'construction_plane-yz' },
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'editingSketch', 'YZ construction plane should also open a sketch session.')
    expectTrue(result.state.session.plane.key === 'yz', 'Sketch session should preserve the selected YZ plane definition.')
  }

  async function testRuntimeLoopReopensStoredSketchPlane() {
    const runtimeSnapshot = createReopenableYzSketchSnapshot()
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: 'rev_1' as const,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: 'rev_1' as const,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: 'request_snapshot-1',
            documentId: 'doc_workspace',
            revisionId: 'rev_1',
            snapshot: runtimeSnapshot,
            selectionCatalog: {
              ...createSelectionCatalog(),
              selectableTargetKeys: [...createSelectionCatalog().selectableTargetKeys, 'sketch:sketch_yz'],
              existingSketchKeys: ['sketch:sketch_a', 'sketch:sketch_yz'],
            },
          },
        },
        { type: 'tool.activated', toolId: 'sketch' },
        {
          type: 'viewport.selectionRequested',
          target: { kind: 'sketch', sketchId: 'sketch_yz' },
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'editingSketch', 'Existing sketches should reopen into the sketch editor.')
    expectTrue(result.state.session.sketchId === 'sketch_yz', 'Reopened sketch sessions should preserve the sketch identity.')
    expectTrue(result.state.session.plane.key === 'yz', 'Reopened sketch sessions should preserve the stored sketch plane.')
  }

  async function testRuntimeLoopReopensCommittedFeatureFromExplicitIntent() {
    const runtimeSnapshot = await createMockWorkspaceSnapshot()
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: runtimeSnapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: runtimeSnapshot.document.revisionId,
        featureId: 'feature_extrude-1' as const,
        accepted: true,
        diagnostics: [],
      }),
      setDocumentCursor: async () => ({
        revisionId: runtimeSnapshot.document.revisionId,
        accepted: true,
        diagnostics: [],
      }),
    }

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: 'request_snapshot-1',
            documentId: runtimeSnapshot.document.documentId,
            revisionId: runtimeSnapshot.document.revisionId,
            snapshot: runtimeSnapshot,
            selectionCatalog: buildSelectionTargetCatalog(runtimeSnapshot),
          },
        },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'feature', featureId: 'feature_extrude-1' },
          toolId: 'extrude',
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'editingFeature', 'Committed feature reopen should enter feature editing.')
    expectTrue(result.state.session.mode === 'edit', 'Committed feature reopen should hydrate an edit session.')
    expectTrue(result.state.session.featureId === 'feature_extrude-1', 'Committed feature reopen should preserve the feature identity.')
  }

  async function testRuntimeLoopReopensSketchFromExplicitIntent() {
    const runtimeSnapshot = createReopenableYzSketchSnapshot()
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: 'rev_1' as const,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: 'rev_1' as const,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
      setDocumentCursor: async () => ({
        revisionId: 'rev_1' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: 'request_snapshot-1',
            documentId: 'doc_workspace',
            revisionId: 'rev_1',
            snapshot: runtimeSnapshot,
            selectionCatalog: {
              ...createSelectionCatalog(),
              selectableTargetKeys: [...createSelectionCatalog().selectableTargetKeys, 'sketch:sketch_yz'],
              existingSketchKeys: ['sketch:sketch_a', 'sketch:sketch_yz'],
            },
          },
        },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'sketch', sketchId: 'sketch_yz' },
          toolId: 'sketch',
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'editingSketch', 'Committed sketch reopen should enter sketch editing.')
    expectTrue(result.state.session.sketchId === 'sketch_yz', 'Committed sketch reopen should preserve the sketch identity.')
    expectTrue(result.state.session.plane.key === 'yz', 'Committed sketch reopen should preserve the stored sketch plane.')
  }

  async function testFeatureEditEntryRollsBackBeforeHydrationFromTail() {
    const snapshot = await createSketchExtrudeSketchRevolveSnapshot()
    const { runtime, cursorMoves, previewCalls } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'feature', featureId: 'feature_extrude-1' },
          toolId: 'extrude',
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'editingFeature', 'Feature reopen should enter editing after rollback.')
    expectTrue(cursorMoves.length === 1, 'Feature reopen should move the document cursor before hydration.')
    expectTrue(cursorMoves[0]?.cursor.kind === 'sketch', 'Editing extrude should roll back to the preceding sketch.')
    expectTrue(cursorMoves[0]?.transient === true, 'Edit-entry rollback should be transient.')
    expectTrue(
      result.state.snapshot?.document.cursor.kind === 'sketch',
      'Feature edit snapshot should be refreshed at the rollback cursor.',
    )
    expectTrue(previewCalls.length === 1, 'Feature edit preview should run after rollback snapshot refresh.')
    expectTrue(
      previewCalls[0]?.cursor.kind === 'sketch',
      'Feature edit preview should evaluate against the rolled-back document basis.',
    )
  }

  async function testSketchEditEntryRollsBackBeforeOpenFromTail() {
    const snapshot = await createSketchExtrudeSketchRevolveSnapshot()
    const { runtime, cursorMoves, getSnapshotReadCount } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'sketch', sketchId: 'sketch_second' },
          toolId: 'sketch',
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'editingSketch', 'Committed sketch reopen should enter sketch editing.')
    expectTrue(cursorMoves.length === 1, 'Sketch reopen should move the document cursor before opening.')
    expectTrue(
      cursorMoves[0]?.cursor.kind === 'feature' && cursorMoves[0].cursor.featureId === 'feature_extrude-1',
      'Editing sketch2 should roll back to the preceding extrude.',
    )
    expectTrue(
      result.state.snapshot?.document.cursor.kind === 'feature'
        && result.state.snapshot.document.cursor.featureId === 'feature_extrude-1',
      'Sketch edit snapshot should remain at the document rollback cursor.',
    )
    expectTrue(
      result.state.session.historyCursor.kind !== 'empty',
      'Reopened sketch editing should preserve sketch-local history while the document is rolled back.',
    )
    expectTrue(
      getSnapshotReadCount() === 2,
      'Sketch reopen should reuse the rollback snapshot directly instead of forcing an extra document refresh cycle.',
    )
  }

  async function testTailSketchReopenSkipsRollbackAndOpensImmediately() {
    const snapshot = createReopenableYzSketchSnapshot()
    const { runtime, cursorMoves, getSnapshotReadCount } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'sketch', sketchId: 'sketch_yz' },
          toolId: 'sketch',
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'editingSketch', 'Tail sketch reopen should enter sketch editing immediately.')
    expectTrue(result.state.session.sketchId === 'sketch_yz', 'Tail sketch reopen should preserve the committed sketch id.')
    expectTrue(cursorMoves.length === 0, 'Tail sketch reopen should not roll the document cursor when the sketch is already current.')
    expectTrue(getSnapshotReadCount() === 1, 'Tail sketch reopen should reuse the loaded snapshot instead of re-fetching it.')
  }

  async function testFeatureEditCancelRestoresTailCursor() {
    const snapshot = await createSketchExtrudeSketchRevolveSnapshot()
    const { runtime, cursorMoves } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'feature', featureId: 'feature_extrude-1' },
          toolId: 'extrude',
        },
        {
          type: 'command.cancelled',
          commandSessionId: 'command_extrude-1',
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'idle', 'Feature edit cancel should return to idle.')
    expectTrue(cursorMoves.length === 2, 'Feature edit cancel should restore the captured entry cursor.')
    expectTrue(
      cursorMoves[1]?.cursor.kind === 'feature' && cursorMoves[1].cursor.featureId === 'feature_revolve-1',
      'Feature edit cancel should restore the captured tail cursor.',
    )
  }

  async function testFeatureEditCommitRestoresNonTailCursor() {
    const tailSnapshot = await createSketchExtrudeSketchRevolveSnapshot()
    const entryCursor = { kind: 'sketch' as const, sketchId: 'sketch_second' as SketchId }
    const snapshot = cloneSnapshotWithCursor(tailSnapshot, entryCursor, tailSnapshot.document.revisionId)
    const { runtime, cursorMoves, featureCommitCalls } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'feature', featureId: 'feature_extrude-1' },
          toolId: 'extrude',
        },
        {
          type: 'command.commitRequested',
          commandSessionId: 'command_extrude-1',
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'idle', 'Feature edit commit should return to idle after restore.')
    expectTrue(featureCommitCalls.length === 1, 'Feature edit commit should submit the hydrated edit session.')
    expectTrue(cursorMoves.length === 2, 'Feature edit commit should restore the captured entry cursor.')
    expectTrue(
      cursorMoves[1]?.cursor.kind === 'sketch' && cursorMoves[1].cursor.sketchId === 'sketch_second',
      'Feature edit commit should restore the captured non-tail cursor instead of the history tail.',
    )
  }

  async function testSketchAbortRestoresTailCursor() {
    const snapshot = await createSketchExtrudeSketchRevolveSnapshot()
    const { runtime, cursorMoves } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'sketch', sketchId: 'sketch_second' },
          toolId: 'sketch',
        },
        {
          type: 'command.cancelled',
          commandSessionId: 'command_sketch-1',
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'idle', 'Sketch abort should return to idle.')
    expectTrue(cursorMoves.length === 2, 'Sketch abort should restore the captured entry cursor.')
    expectTrue(
      cursorMoves[1]?.cursor.kind === 'feature' && cursorMoves[1].cursor.featureId === 'feature_revolve-1',
      'Sketch abort should restore the captured tail cursor.',
    )
  }

  async function testFinishSketchAtCurrentSketchCursorSkipsRestore() {
    const tailSnapshot = await createSketchExtrudeSketchRevolveSnapshot()
    const entryCursor = { kind: 'sketch' as const, sketchId: 'sketch_second' as SketchId }
    const snapshot = cloneSnapshotWithCursor(tailSnapshot, entryCursor, tailSnapshot.document.revisionId)
    const { runtime, cursorMoves } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'sketch', sketchId: 'sketch_second' },
          toolId: 'sketch',
        },
        {
          type: 'tool.activated',
          toolId: 'finishSketch',
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'idle', 'Finish sketch should return to idle after commit.')
    expectTrue(cursorMoves.length === 0, 'Finish sketch should not restore the document cursor when the reopened sketch is already current.')
    const sketchCommitIndex = result.effects.findIndex((effect) => effect.type === 'sketch.commit')
    const refreshIndex = result.effects.findIndex(
      (effect, index) => index > sketchCommitIndex && effect.type === 'document.fetchSnapshot',
    )
    expectTrue(
      sketchCommitIndex >= 0 && refreshIndex > sketchCommitIndex,
      'Finish sketch should refresh the committed snapshot after commit.',
    )
  }

  async function testRepositoryBackedFeatureEditCommitRefreshesBeforeRestore() {
    const documentRepository = createMemoryDocumentRepository()
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const runtime = createModelingServiceEditorEffectRuntime(service)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'feature', featureId: 'feature_extrude-1' },
          toolId: 'extrude',
        },
        {
          type: 'command.commitRequested',
          commandSessionId: 'command_extrude-1',
        },
      ],
      runtime,
    )

    expectTrue(result.state.kind === 'idle', 'Repository-backed feature edit commit should exit after cursor restore.')
    expectTrue(
      result.state.snapshot?.document.cursor.kind === 'feature'
        && result.state.snapshot.document.cursor.featureId === 'feature_fillet-1',
      'Repository-backed feature edit commit should restore the tail cursor captured at edit entry.',
    )
    expectTrue(
      result.state.preview?.label !== 'The authored document changed after the current snapshot was loaded. Refresh before retrying this mutation.',
      'Edit-exit cursor restore should not run against stale repository provenance.',
    )
  }

  async function testDocumentCursorRequestUsesSnapshotBasisAndRefreshesOnConflict() {
    const snapshot = structuredClone(await createMockWorkspaceSnapshot())
    snapshot.provenance = {
      repositoryHeads: ['head_a'],
      repositorySource: 'peer',
    }
    const previousCursor = getPreviousDocumentHistoryCursor(snapshot)
    expectTrue(previousCursor, 'Repository cursor fixture should expose a previous cursor.')

    const boot = transitionEditorState(initialEditorState, { type: 'session.started' })
    const fetchEffect = boot.effects[0]
    expectTrue(fetchEffect?.type === 'document.fetchSnapshot', 'Session start should fetch a snapshot.')
    const loaded = transitionEditorState(boot.state, {
      type: 'effect.snapshotLoaded',
      payload: {
        requestId: fetchEffect.requestId,
        documentId: snapshot.document.documentId,
        revisionId: snapshot.document.revisionId,
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
    })
    const requested = transitionEditorState(loaded.state, {
      type: 'document.historyCursorRequested',
      cursor: previousCursor,
    })
    const cursorEffect = requested.effects[0]

    expectTrue(cursorEffect?.type === 'document.moveHistoryCursor', 'Timeline cursor requests should emit the document cursor effect.')
    expectTrue(
      cursorEffect.mutationBasis.baseRevisionId === snapshot.document.revisionId
        && cursorEffect.mutationBasis.baseRepositoryHeads?.[0] === 'head_a',
      'Document cursor effects should carry the loaded snapshot repository basis.',
    )
    expectTrue(
      !getEditorHistoryAvailability(requested.state).canUndo && !getEditorHistoryAvailability(requested.state).canRedo,
      'Document history actions should be unavailable while the cursor mutation is pending.',
    )

    const conflicted = transitionEditorState(requested.state, {
      type: 'effect.documentCursorMoved',
      requestId: cursorEffect.requestId,
      documentId: snapshot.document.documentId,
      baseRevisionId: snapshot.document.revisionId,
      revisionId: 'rev_9999',
      accepted: false,
      actualRevisionId: 'rev_9999',
      diagnostics: [{
        code: 'repository-head-conflict',
        severity: 'error',
        message: 'The authored document changed after the current snapshot was loaded.',
        target: null,
        detail: null,
      }],
    })

    expectTrue(conflicted.effects[0]?.type === 'document.fetchSnapshot', 'Repository cursor conflicts should request a refresh.')
    expectTrue(conflicted.state.pendingHistoryCursorRequestId === null, 'Repository cursor conflicts should clear the pending cursor request.')
    expectTrue(conflicted.state.pendingSnapshotRequestId === conflicted.effects[0]?.requestId, 'Conflict refresh should be tracked as pending.')
  }

  function testSnapshotRefreshCanPreserveRenderRecordsForFeatureDiagnostics() {
    const previous = createSnapshot()
    const featureId = 'feature_broken' as FeatureId
    const previousRender = createRenderRecord('render_previous', featureId)
    previous.document.render.records = [previousRender]
    previous.render = previous.document.render

    const loaded = transitionEditorState(initialEditorState, {
      type: 'document.snapshotLoaded',
      snapshot: previous,
    })
    const refresh = transitionEditorState(loaded.state, { type: 'document.refreshRequested' })
    const effect = refresh.effects[0]
    expectTrue(effect?.type === 'document.fetchSnapshot', 'Refresh should request a document snapshot.')

    const next = structuredClone(previous)
    next.revisionId = 'rev_2'
    next.document.revisionId = 'rev_2'
    next.document.render = {
      ...next.document.render,
      records: [createRenderRecord('render_failed_rebuild', featureId)],
    }
    next.render = next.document.render
    next.document.diagnostics = [{
      code: 'occ-missing-reference',
      severity: 'error',
      message: 'Extrude profile selection is incorrect.',
      featureId,
      fieldId: 'profiles',
      fieldPath: ['parameters', 'profiles'],
      repairGuidance: 'Edit Extrude and choose a valid profile selection.',
      target: { kind: 'region', sketchId: 'sketch_missing' as SketchId, regionId: 'region_missing' as RegionId },
      detail: null,
    }]
    next.diagnostics = next.document.diagnostics

    const failedRefresh = transitionEditorState(refresh.state, {
      type: 'effect.snapshotLoaded',
      payload: {
        requestId: effect.requestId,
        documentId: next.documentId,
        revisionId: next.revisionId,
        snapshot: next,
        selectionCatalog: buildSelectionTargetCatalog(next),
        preserveRenderRecordsOnFeatureDiagnostics: true,
      },
    })

    expectTrue(
      failedRefresh.state.snapshot?.document.render.records[0]?.id === previousRender.id,
      'Feature-scoped failed refreshes should preserve previous viewport render records.',
    )
    expectTrue(
      failedRefresh.state.snapshot?.document.diagnostics[0]?.featureId === featureId,
      'Feature-scoped failed refreshes should still expose the new repair diagnostic.',
    )
    expectTrue(
      failedRefresh.state.snapshot?.revisionId === 'rev_2',
      'Render preservation should not roll back the authored snapshot revision.',
    )

    const fixed = structuredClone(next)
    fixed.revisionId = 'rev_3'
    fixed.document.revisionId = 'rev_3'
    fixed.document.diagnostics = []
    fixed.diagnostics = []
    fixed.document.render = {
      ...fixed.document.render,
      records: [createRenderRecord('render_fixed', featureId)],
    }
    fixed.render = fixed.document.render
    const secondRefresh = transitionEditorState(failedRefresh.state, { type: 'document.refreshRequested' })
    const secondEffect = secondRefresh.effects[0]
    expectTrue(secondEffect?.type === 'document.fetchSnapshot', 'Second refresh should request a document snapshot.')
    const fixedRefresh = transitionEditorState(secondRefresh.state, {
      type: 'effect.snapshotLoaded',
      payload: {
        requestId: secondEffect.requestId,
        documentId: fixed.documentId,
        revisionId: fixed.revisionId,
        snapshot: fixed,
        selectionCatalog: buildSelectionTargetCatalog(fixed),
        preserveRenderRecordsOnFeatureDiagnostics: true,
      },
    })

    expectTrue(
      fixedRefresh.state.snapshot?.document.render.records[0]?.id === 'render_fixed',
      'Successful corrected refreshes should swap in the new render records.',
    )
    expectTrue(
      fixedRefresh.state.snapshot?.document.diagnostics.length === 0,
      'Corrected refreshes should clear feature diagnostics.',
    )
  }

  function testDocumentReplacementResetsIntoPartIdleState() {
    const loaded = transitionEditorState(initialEditorState, {
      type: 'document.snapshotLoaded',
      snapshot: createSnapshot(),
    })
    const sketchCommand = transitionEditorState(loaded.state, {
      type: 'tool.activated',
      toolId: 'sketch',
    })
    const replacement = createSnapshot()
    replacement.revisionId = 'rev_replaced'
    replacement.document.revisionId = 'rev_replaced'

    const replaced = transitionEditorState(sketchCommand.state, {
      type: 'document.replaced',
      snapshot: replacement,
    })

    expectTrue(replaced.state.kind === 'idle', 'Whole-document replacement should reset the editor into idle mode.')
    expectTrue(replaced.state.mode === 'part', 'Whole-document replacement should return the editor to part mode.')
    expectTrue(replaced.state.selection.length === 0, 'Whole-document replacement should clear the prior selection.')
    expectTrue(replaced.state.snapshot?.revisionId === 'rev_replaced', 'Whole-document replacement should load the replacement snapshot.')
  }

  async function testEditorEventLoopBootstrapsAndLoadsSnapshot() {
    const snapshot = createSnapshot()
    let snapshotCallCount = 0
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => {
        snapshotCallCount += 1
        return snapshot
      },
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: snapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: snapshot.document.revisionId,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const actor = createEditorEventLoop(runtime)

    actor.start()
    await flushAsyncWork()

    const machineState = actor.getState()

    expectTrue(snapshotCallCount === 1, 'The editor event loop should bootstrap the initial snapshot load itself.')
    expectTrue(machineState.document.documentId === snapshot.document.documentId, 'Bootstrap should hydrate the document id.')
    expectTrue(machineState.document.revisionId === snapshot.document.revisionId, 'Bootstrap should hydrate the revision id.')
    expectTrue(machineState.snapshot?.revisionId === snapshot.document.revisionId, 'Bootstrap should store the loaded snapshot.')
    actor.stop()
  }

  async function testEditorEventLoopCancelsObsoleteSketchOpenEffects() {
    const snapshot = createSnapshot()
    let snapshotCallCount = 0
    let resolveOpenSnapshot: ((value: WorkspaceSnapshot) => void) | null = null

    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: () => {
        snapshotCallCount += 1

        if (snapshotCallCount === 1) {
          return Promise.resolve(snapshot)
        }

        return new Promise<WorkspaceSnapshot>((resolve) => {
          resolveOpenSnapshot = resolve
        })
      },
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: snapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: snapshot.document.revisionId,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const actor = createEditorEventLoop(runtime)

    actor.start()
    await flushAsyncWork()
    actor.dispatch({ type: 'tool.activated', toolId: 'sketch' })
    actor.dispatch({
      type: 'viewport.selectionRequested',
      target: { kind: 'construction', constructionId: 'construction_plane-xy' },
    })
    await flushAsyncWork()

    const selectionState = actor.getState()
    expectTrue(selectionState.kind === 'selectionCommand', 'Sketch activation should reach the selection workflow before opening.')

    actor.dispatch({
      type: 'command.cancelled',
      commandSessionId: selectionState.command.commandSessionId,
    })

    const pendingOpenSnapshotResolver = resolveOpenSnapshot as ((value: WorkspaceSnapshot) => void) | null

    if (pendingOpenSnapshotResolver) {
      pendingOpenSnapshotResolver(snapshot)
    }
    await flushAsyncWork()

    const cancelledState = actor.getState()

    expectTrue(cancelledState.kind === 'idle', 'Cancelling sketch selection should return the runtime to idle.')
    actor.stop()
  }

  function testSketchToolClearStaysInSketchEditing() {
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )

    const openRequested = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'construction', constructionId: 'construction_plane-xy' },
    })

    const openEffect = openRequested.effects[0]

    expectTrue(openEffect?.type === 'sketch.openSession', 'Sketch fixture should emit an open-session effect.')

    const opened = transitionEditorState(openRequested.state, {
      type: 'effect.sketchSessionOpened',
      requestId: openEffect.requestId,
      documentId: 'doc_workspace',
      revisionId: 'rev_1',
      commandSessionId: openEffect.commandSessionId,
      session: createNewSketchSession(createStandardPlaneDefinition('xy')),
    })

    expectTrue(opened.state.kind === 'editingSketch', 'Sketch open fixture should enter sketch editing.')

    const withTool = transitionEditorState(opened.state, {
      type: 'tool.activated',
      toolId: 'line',
    })

    expectTrue(withTool.state.kind === 'editingSketch', 'Sketch tool activation should stay in sketch editing.')
    expectTrue(withTool.state.session.activeTool === 'line', 'Sketch tool activation should mark the active tool.')

    const cleared = transitionEditorState(withTool.state, {
      type: 'sketch.activeToolCleared',
    })

    expectTrue(cleared.state.kind === 'editingSketch', 'Clearing an active sketch tool should keep the sketch session open.')
    expectTrue(cleared.state.session.activeTool === null, 'Clearing an active sketch tool should remove the active tool.')
    expectTrue(cleared.state.command.toolId === 'sketch', 'Clearing an active sketch tool should restore sketch-session command identity.')
  }

  function testRemainingSketchToolsActivateWithoutDroppingSketchSession() {
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )

    const openRequested = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'construction', constructionId: 'construction_plane-xy' },
    })
    const openEffect = openRequested.effects[0]

    expectTrue(openEffect?.type === 'sketch.openSession', 'Sketch fixture should emit an open-session effect.')

    const opened = transitionEditorState(openRequested.state, {
      type: 'effect.sketchSessionOpened',
      requestId: openEffect.requestId,
      documentId: 'doc_workspace',
      revisionId: 'rev_1',
      commandSessionId: openEffect.commandSessionId,
      session: createNewSketchSession(createStandardPlaneDefinition('xy')),
    })
    const withTool = transitionEditorState(opened.state, {
      type: 'tool.activated',
      toolId: 'line',
    })

    expectTrue(withTool.state.kind === 'editingSketch', 'Sketch tool fixture should enter sketch editing.')

    const activeSketchToolIds = [
      ['spline', 'spline'],
      ['dimension', 'dimensionDistance'],
      ['trim', 'trim'],
      ['offset', 'offset'],
    ] as const satisfies readonly (readonly [ToolId, string])[]

    for (const [toolId, expectedActiveTool] of activeSketchToolIds) {
      const result = transitionEditorState(withTool.state, {
        type: 'tool.activated',
        toolId,
      })
      const viewState = getEditorViewState(result.state)

      expectTrue(result.effects.length === 0, `${toolId} should not emit effects while editing a sketch.`)
      expectTrue(result.state.kind === 'editingSketch', `${toolId} should keep the editor in sketch editing.`)
      expectTrue(result.state.mode === 'sketch', `${toolId} should keep sketch toolbar mode.`)
      expectTrue(viewState.sketchSession !== null, `${toolId} should keep the sketch session visible to the UI.`)
      expectTrue(viewState.mode === 'sketch', `${toolId} should keep sketch view mode.`)
      expectTrue(result.state.command.toolId === toolId, `${toolId} should replace the active sketch command.`)
      expectTrue(result.state.session.activeTool === expectedActiveTool, `${toolId} should activate its sketch workflow.`)
    }
  }

  function testSketchEditToolActivationReusesCompatibleSelectionAndClearsInvalidSelection() {
    const session = createOffsetFixtureSketchSession()
    const selectedTargets = session.definition.entities.map((entity) => entity.target)
    const baseState: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: selectedTargets,
      hoverTarget: selectedTargets[selectedTargets.length - 1] ?? null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: createSelectionCatalog(),
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      nextCommandSequence: initialEditorState.nextCommandSequence,
      nextRequestSequence: initialEditorState.nextRequestSequence,
      pendingSnapshotRequestId: null,
      pendingHistoryCursorRequestId: null,
      editSessionCursorContext: null,
      command: {
        commandSessionId: 'command_sketch-1',
        toolId: 'sketch',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    }

    const reused = transitionEditorState(baseState, {
      type: 'tool.activated',
      toolId: 'offset',
    })

    expectTrue(reused.state.kind === 'editingSketch', 'Sketch edit-tool activation should remain in sketch editing.')
    expectTrue(reused.state.selection.length === selectedTargets.length, 'Compatible sketch edit-tool activation should preserve current selection.')
    expectTrue(
      reused.state.session.activeEditTool?.selectedTargets.length === selectedTargets.length,
      'Compatible sketch edit-tool activation should seed the active edit tool from the adopted selection.',
    )
    expectTrue(
      reused.state.session.toolStagedEntities.some((entity) => entity.status === 'preview'),
      'Compatible sketch edit-tool activation should derive preview geometry from the adopted selection.',
    )

    const cleared = transitionEditorState(
      {
        ...baseState,
        selection: [session.definition.points[0]!.target],
        hoverTarget: session.definition.points[0]!.target,
      },
      {
        type: 'tool.activated',
        toolId: 'offset',
      },
    )

    expectTrue(cleared.state.kind === 'editingSketch', 'Invalid sketch edit-tool activation should stay in sketch editing.')
    expectTrue(cleared.state.selection.length === 0, 'Invalid sketch edit-tool activation should clear incompatible selection.')
    expectTrue(
      cleared.state.session.activeEditTool?.selectedTargets.length === 0,
      'Invalid sketch edit-tool activation should start with an empty edit-tool target set.',
    )
  }

  function testPassiveSketchStyleToolsDoNotDropSketchSession() {
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )

    const openRequested = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'construction', constructionId: 'construction_plane-xy' },
    })
    const openEffect = openRequested.effects[0]

    expectTrue(openEffect?.type === 'sketch.openSession', 'Sketch fixture should emit an open-session effect.')

    const opened = transitionEditorState(openRequested.state, {
      type: 'effect.sketchSessionOpened',
      requestId: openEffect.requestId,
      documentId: 'doc_workspace',
      revisionId: 'rev_1',
      commandSessionId: openEffect.commandSessionId,
      session: createNewSketchSession(createStandardPlaneDefinition('xy')),
    })
    const withTool = transitionEditorState(opened.state, {
      type: 'tool.activated',
      toolId: 'line',
    })

    expectTrue(withTool.state.kind === 'editingSketch', 'Sketch tool fixture should enter sketch editing.')

    const passiveSketchToolIds = [
      'fill',
      'stroke',
    ] as const satisfies readonly ToolId[]

    for (const toolId of passiveSketchToolIds) {
      const result = transitionEditorState(withTool.state, {
        type: 'tool.activated',
        toolId,
      })
      const viewState = getEditorViewState(result.state)

      expectTrue(result.effects.length === 0, `${toolId} should not emit effects while editing a sketch.`)
      expectTrue(result.state.kind === 'editingSketch', `${toolId} should keep the editor in sketch editing.`)
      expectTrue(result.state.mode === 'sketch', `${toolId} should keep sketch toolbar mode.`)
      expectTrue(viewState.sketchSession !== null, `${toolId} should keep the sketch session visible to the UI.`)
      expectTrue(viewState.mode === 'sketch', `${toolId} should keep sketch view mode.`)
      expectTrue(result.state.command.toolId === 'line', `${toolId} should not replace the active sketch command.`)
      expectTrue(result.state.session.activeTool === 'line', `${toolId} should not clear the active sketch tool.`)
      expectTrue(result.state.session.activeStyleFocus?.toolId === toolId, `${toolId} should open style focus state.`)
      expectTrue(result.state.session.activeStyleFocus.target === null, `${toolId} should show target guidance without a selection.`)
      expectTrue(
        getSketchToolPresentation(result.state.session)?.selectionGuide?.requiredCount === 1,
        `${toolId} should expose style target guidance.`,
      )
    }

    let styledSession = createNewSketchSession(createStandardPlaneDefinition('xy'))
    styledSession = beginSketchTool(styledSession, 'line')
    styledSession = startSketchDraw(styledSession, [0, 0])
    styledSession = acceptSketchDraw(styledSession, [8, 0])

    const target = styledSession.definition.entities[0]?.target
    expectTrue(target, 'Style focus fixture should create a selectable local sketch entity.')

    const styledBaseState: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [target],
      hoverTarget: target,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(styledSession),
        target: styledSession.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-style-1',
        toolId: 'line',
        phase: 'editing',
      },
      session: styledSession,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    }

    for (const toolId of passiveSketchToolIds) {
      const result = transitionEditorState(styledBaseState, {
        type: 'tool.activated',
        toolId,
      })

      expectTrue(result.state.kind === 'editingSketch', `${toolId} with a target should keep sketch editing.`)
      expectTrue(result.state.session.activeStyleFocus?.toolId === toolId, `${toolId} should become the active style focus.`)
      if (toolId === 'stroke') {
        expectTrue(result.state.session.activeStyleFocus.target?.kind === 'sketchEntity', `${toolId} should bind the selected style target.`)
        expectTrue(
          (getSketchToolPresentation(result.state.session)?.controlGroups?.[0]?.controls.length ?? 0) > 0,
          `${toolId} should expose focused style controls for the selected target.`,
        )
      } else {
        expectTrue(result.state.session.activeStyleFocus.target === null, `${toolId} should reject a non-region style target.`)
        expectTrue(
          getSketchToolPresentation(result.state.session)?.selectionGuide?.acceptedKinds.includes('region'),
          `${toolId} should request an enclosed region target.`,
        )
      }
    }
  }

  function createConstraintAuthoringEditorState(toolId: 'dimensionDistance' | 'dimensionHorizontal' = 'dimensionDistance'): {
    state: SketchEditorState
    pointTarget: PrimitiveRef
    secondPointTarget: PrimitiveRef
    lineTarget: PrimitiveRef
  } {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [10, 0])
    session = beginSketchTool(session, toolId)

    const pointTarget = session.definition.points[0]?.target
    const secondPointTarget = session.definition.points[1]?.target
    const lineTarget = session.definition.entities[0]?.target

    expectTrue(pointTarget, 'Constraint routing fixture should create a selectable sketch point.')
    expectTrue(secondPointTarget, 'Constraint routing fixture should create a second selectable sketch point.')
    expectTrue(lineTarget, 'Constraint routing fixture should create a selectable sketch entity.')

    return {
      pointTarget,
      secondPointTarget,
      lineTarget,
      state: {
        ...initialEditorState,
        kind: 'editingSketch',
        mode: 'sketch',
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selection: [],
        hoverTarget: null,
        selectionFilter: getDefaultSelectionFilterForMode('sketch'),
        selectionCatalog: null,
        preview: {
          kind: 'sketch',
          label: getSketchSessionPreviewLabel(session),
          target: session.planeTarget,
        },
        command: {
          commandSessionId: `command_${toolId}-1` as CommandSessionId,
          toolId,
          phase: 'editing',
        },
        session,
        pendingCommitRequestId: null,
      },
    }
  }

  function testConstraintAuthoringReceivesViewportHoverAndSelection() {
    const { state, pointTarget } = createConstraintAuthoringEditorState()

    const hovered = transitionEditorState(state, {
      type: 'viewport.hovered',
      target: pointTarget,
    })

    expectTrue(hovered.state.kind === 'editingSketch', 'Hover fixture should remain in sketch editing.')
    expectTrue(
      hovered.state.session.constraintAuthoring?.hoverTarget?.target &&
        primitiveRefEquals(hovered.state.session.constraintAuthoring.hoverTarget.target, pointTarget),
      'Active constraint authoring should record valid viewport hover targets.',
    )

    const selected = transitionEditorState(hovered.state, {
      type: 'viewport.selectionRequested',
      target: pointTarget,
    })

    expectTrue(selected.state.kind === 'editingSketch', 'Selection fixture should remain in sketch editing.')
    expectTrue(
      selected.state.session.constraintAuthoring?.selectedTargets.length === 1 &&
        primitiveRefEquals(selected.state.session.constraintAuthoring.selectedTargets[0]!.target, pointTarget),
      'Active constraint authoring should record valid viewport click targets.',
    )
  }

  function testDimensionSelectionClickPinsReadyValuePreview() {
    const { state, pointTarget, secondPointTarget, lineTarget } = createConstraintAuthoringEditorState()

    const selectedFirst = transitionEditorState(state, {
      type: 'viewport.selectionRequested',
      target: pointTarget,
    })
    expectTrue(selectedFirst.state.kind === 'editingSketch', 'First dimension target selection should keep sketch editing.')

    const selectedSecond = transitionEditorState(selectedFirst.state, {
      type: 'viewport.selectionRequested',
      target: secondPointTarget,
    })
    expectTrue(selectedSecond.state.kind === 'editingSketch', 'Second dimension target selection should keep sketch editing.')

    const moved = transitionEditorState(selectedSecond.state, {
      type: 'sketch.pointerMoved',
      point: mapSketchPointToWorld(selectedSecond.state.session.plane, [5, 3]),
    })
    expectTrue(moved.state.kind === 'editingSketch', 'Pointer movement over ready dimension preview should keep sketch editing.')

    const clickedGeometry = transitionEditorState(moved.state, {
      type: 'viewport.selectionRequested',
      target: lineTarget,
    })

    expectTrue(clickedGeometry.state.kind === 'editingSketch', 'Dimension placement click fixture should keep sketch editing.')
    expectTrue(
      clickedGeometry.state.session.constraintAuthoring?.isPreviewPinned === true
        && clickedGeometry.state.session.constraintAuthoring.selectedTargets.length === 2,
      'Clicking geometry while a value-backed dimension is ready should pin placement instead of replacing operands.',
    )
    expectTrue(
      getSketchToolPresentation(clickedGeometry.state.session)?.floatingInput?.label === 'Distance',
      'Pinning placement from a target click should open the floating value-entry input.',
    )
  }

  function testDimensionReleaseOverSecondLineDefersToAngleSelection() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [10, 0])
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [5, -5])
    session = acceptSketchDraw(session, [5, 5])
    session = beginSketchTool(session, 'dimensionDistance')

    const [firstLineTarget, secondLineTarget] = session.definition.entities.map((entity) => entity.target)
    expectTrue(firstLineTarget && secondLineTarget, 'Angle dimension release fixture should create two selectable lines.')

    const state: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_dimension-angle-release-1' as CommandSessionId,
        toolId: 'dimensionDistance',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    }

    const selectedFirst = transitionEditorState(state, {
      type: 'viewport.selectionRequested',
      target: firstLineTarget,
    })
    expectTrue(selectedFirst.state.kind === 'editingSketch', 'First line selection should keep sketch editing.')

    const releaseOverSecond = transitionEditorState(selectedFirst.state, {
      type: 'sketch.pointerReleased',
      point: mapSketchPointToWorld(selectedFirst.state.session.plane, [5, 0]),
      target: secondLineTarget,
    })
    expectTrue(releaseOverSecond.state.kind === 'editingSketch', 'Release over second line should keep sketch editing.')
    expectTrue(
      releaseOverSecond.state.session.constraintAuthoring?.isPreviewPinned === false
        && releaseOverSecond.state.session.constraintAuthoring.selectedTargets.length === 1,
      'Pointer release over a selectable second line should not pin the first line length preview before click selection.',
    )

    const selectedSecond = transitionEditorState(releaseOverSecond.state, {
      type: 'viewport.selectionRequested',
      target: secondLineTarget,
    })
    expectTrue(selectedSecond.state.kind === 'editingSketch', 'Second line selection should keep sketch editing.')

    let anglePreview = getSketchToolPresentation(selectedSecond.state.session)?.overlays?.find((overlay) => overlay.kind === 'angleArc')
    expectTrue(
      selectedSecond.state.session.constraintAuthoring?.selectedTargets.length === 2
        && anglePreview?.kind === 'angleArc',
      'Selecting the second non-parallel line should preserve the two-line angle preview.',
    )

    const moved = transitionEditorState(selectedSecond.state, {
      type: 'sketch.pointerMoved',
      point: mapSketchPointToWorld(selectedSecond.state.session.plane, [8, 3]),
    })
    expectTrue(moved.state.kind === 'editingSketch', 'Pointer movement after angle selection should keep sketch editing.')
    anglePreview = getSketchToolPresentation(moved.state.session)?.overlays?.find((overlay) => overlay.kind === 'angleArc')
    const lengthPreview = getSketchToolPresentation(moved.state.session)?.overlays?.find(
      (overlay) => overlay.kind === 'dimensionLine' && overlay.referenceKind === 'lineLength',
    )
    expectTrue(
      anglePreview?.kind === 'angleArc' && !lengthPreview,
      'Pointer movement after two selected lines should not fall back to the first line length dimension.',
    )

    const placed = transitionEditorState(moved.state, {
      type: 'sketch.pointerReleased',
      point: mapSketchPointToWorld(moved.state.session.plane, [4, -1]),
      target: null,
    })
    expectTrue(placed.state.kind === 'editingSketch', 'Angle placement click should keep sketch editing.')
    expectTrue(
      placed.state.session.constraintAuthoring?.isPreviewPinned === true
        && getSketchToolPresentation(placed.state.session)?.floatingInput?.label === 'Angle',
      'Clicking the primary viewport after angle preview should pin placement and keep the value entry open.',
    )
  }

  function testConstraintAuthoringIgnoresInvalidViewportSelection() {
    const { state, lineTarget } = createConstraintAuthoringEditorState('dimensionHorizontal')

    const selected = transitionEditorState(state, {
      type: 'viewport.selectionRequested',
      target: lineTarget,
    })

    expectTrue(selected.state.kind === 'editingSketch', 'Invalid constraint selection fixture should remain in sketch editing.')
    expectTrue(
      selected.state.session.constraintAuthoring?.selectedTargets.length === 0,
      'Dimension point authoring should ignore viewport clicks on rejected sketch entity targets.',
    )
  }

  function createConnectedSelectionEditorState(): {
    state: SketchEditorState
    localTarget: PrimitiveRef
    projectedTarget: PrimitiveRef
  } {
    const sketchId = 'sketch_draft' as SketchId
    const pointA = 'sketch_point_a' as SketchPointId
    const pointB = 'sketch_point_b' as SketchPointId
    const pointC = 'sketch_point_c' as SketchPointId
    const entityAB = 'sketch_entity_ab' as SketchEntityId
    const entityBC = 'sketch_entity_bc' as SketchEntityId
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [pointA, pointB, pointC],
      points: [
        {
          pointId: pointA,
          label: 'A',
          target: { kind: 'sketchPoint', sketchId, pointId: pointA },
          position: [0, 0],
          isConstruction: false,
        },
        {
          pointId: pointB,
          label: 'B',
          target: { kind: 'sketchPoint', sketchId, pointId: pointB },
          position: [1, 0],
          isConstruction: false,
        },
        {
          pointId: pointC,
          label: 'C',
          target: { kind: 'sketchPoint', sketchId, pointId: pointC },
          position: [2, 0],
          isConstruction: false,
        },
      ],
      entityIds: [entityAB, entityBC],
      entities: [
        {
          kind: 'lineSegment',
          entityId: entityAB,
          label: 'AB',
          target: { kind: 'sketchEntity', sketchId, entityId: entityAB },
          isConstruction: false,
          startPointId: pointA,
          endPointId: pointB,
        },
        {
          kind: 'lineSegment',
          entityId: entityBC,
          label: 'BC',
          target: { kind: 'sketchEntity', sketchId, entityId: entityBC },
          isConstruction: false,
          startPointId: pointB,
          endPointId: pointC,
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }
    const session = {
      ...createNewSketchSession(createStandardPlaneDefinition('xy')),
      sketchId,
      definition,
      fullDefinition: definition,
    }
    const localTarget = definition.entities[0]!.target
    const projectedTarget: PrimitiveRef = {
      kind: 'projectedReferenceGeometry',
      referenceId: 'ref_projected',
      geometryId: 'projected_geometry_line',
      geometryKind: 'lineSegment',
    }

    return {
      localTarget,
      projectedTarget,
      state: {
        ...initialEditorState,
        kind: 'editingSketch',
        mode: 'sketch',
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selection: [],
        hoverTarget: null,
        selectionFilter: getDefaultSelectionFilterForMode('sketch'),
        selectionCatalog: null,
        preview: {
          kind: 'sketch',
          label: getSketchSessionPreviewLabel(session),
          target: session.planeTarget,
        },
        command: {
          commandSessionId: 'command_sketch-connected-selection-1',
          toolId: 'sketch',
          phase: 'editing',
        },
        session,
        pendingCommitRequestId: null,
        pendingProjectionRequestId: null,
        pendingImportRequestId: null,
      },
    }
  }

  function testConnectedSketchSelectionEventUpdatesNormalSelectionState() {
    const { state, localTarget } = createConnectedSelectionEditorState()
    const selected = transitionEditorState(state, {
      type: 'sketch.connectedSelectionRequested',
      target: localTarget,
    })

    expectTrue(selected.state.kind === 'editingSketch', 'Connected selection should stay in sketch editing.')
    expectTrue(
      selected.state.selection.length === 2
        && selected.state.selection.every((target) => target.kind === 'sketchEntity'),
      'Connected selection should update the normal editor selection with the connected sketch entities.',
    )
  }

  function testConnectedSketchSelectionEventWorksAfterRectangleToolAcceptsShape() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'rectangle')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [4, 3])
    const localTarget = session.definition.entities[0]?.target
    expectTrue(localTarget, 'Rectangle fixture should create a selectable sketch entity.')

    const selected = transitionEditorState({
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-connected-rectangle-1',
        toolId: 'rectangle',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    }, {
      type: 'sketch.connectedSelectionRequested',
      target: localTarget,
    })

    expectTrue(selected.state.kind === 'editingSketch', 'Connected rectangle selection should stay in sketch editing.')
    expectTrue(
      selected.state.selection.length === 4
        && selected.state.selection.every((target) => target.kind === 'sketchEntity'),
      'Double-clicking one accepted rectangle edge while Rectangle remains active should select all four rectangle edges.',
    )
  }

  function testConnectedSketchSelectionEventRejectsUnsupportedTargets() {
    const { state, projectedTarget } = createConnectedSelectionEditorState()
    const selected = transitionEditorState(state, {
      type: 'sketch.connectedSelectionRequested',
      target: projectedTarget,
    })

    expectTrue(selected.state.kind === 'editingSketch', 'Unsupported connected selection should stay in sketch editing.')
    expectTrue(selected.state.selection.length === 0, 'Projected reference geometry should not expand through the connected selection event.')
  }

  function testCommittedAnnotationSelectionAndDeletionRoutesThroughSketchMutation() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [10, 1])
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 5])
    session = acceptSketchDraw(session, [10, 6])

    const [firstLineId, secondLineId] = session.definition.entityIds
    expectTrue(firstLineId && secondLineId, 'Annotation deletion fixture should create two sketch lines.')

    session = beginSketchTool(session, 'constraintParallel')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: firstLineId,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: secondLineId,
    })

    const annotation = getSketchAnnotationDescriptors(session)[0]
    expectTrue(annotation, 'Annotation deletion fixture should create a committed annotation descriptor.')

    const selected = transitionEditorState({
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-annotation-1',
        toolId: 'sketch',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
    }, {
      type: 'viewport.selectionRequested',
      target: annotation.target,
    })

    expectTrue(selected.state.kind === 'editingSketch', 'Selecting an annotation should stay in sketch editing.')
    expectTrue(
      selected.state.session.selectedAnnotation
        && primitiveRefEquals(selected.state.session.selectedAnnotation, annotation.target),
      'Viewport annotation selection should select the durable annotation target.',
    )
    expectTrue(
      selected.state.session.definition.constraintIds.length === 1,
      'Selecting an annotation should not select or delete affected geometry.',
    )

    const deleted = transitionEditorState(selected.state, { type: 'sketch.annotationDeleteRequested' })

    expectTrue(deleted.state.kind === 'editingSketch', 'Deleting an annotation should stay in sketch editing.')
    expectTrue(
      deleted.state.session.definition.constraintIds.length === 0,
      'Annotation deletion should remove the durable constraint record from sketch state.',
    )
    expectTrue(
      deleted.state.session.commitRequest?.definition.constraintIds.length === 0,
      'Annotation deletion should update the durable sketch commit request.',
    )
  }

  function testSketchHistoryDeleteStaysDistinctFromLiveSelectionDelete() {
    const baseSession = appendReferenceImageOperations(createNewSketchSession(createStandardPlaneDefinition('xy')), [
      createReferenceImageOperation({
        sequence: 1,
        sketchId: 'sketch_draft',
        payload: {
          mediaType: 'image/png',
          fileName: 'reference.png',
          pixelWidth: 400,
          pixelHeight: 200,
          base64Data: 'cG5n',
        },
      }),
    ])
    const operationId = baseSession.fullDefinition.authoringOperations?.[0]?.operationId
    expectTrue(operationId, 'History-delete fixture should create a committed reference-image operation.')

    const baseState: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [{
        kind: 'sketchOperation',
        sketchId: 'sketch_draft',
        operationId,
      }],
      hoverTarget: {
        kind: 'sketchOperation',
        sketchId: 'sketch_draft',
        operationId,
      },
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(baseSession),
        target: baseSession.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-history-delete-1',
        toolId: 'sketch',
        phase: 'editing',
      },
      session: baseSession,
      pendingCommitRequestId: null,
    }

    const deletedFromHistory = transitionEditorState(baseState, {
      type: 'sketch.historyOperationDeleteRequested',
      operationId,
    })
    expectTrue(deletedFromHistory.state.kind === 'editingSketch', 'History-row deletion should keep the sketch editor active.')
    expectTrue(
      deletedFromHistory.state.session.fullDefinition.authoringOperations?.length === 0,
      'History-row deletion should remove the targeted authored operation instead of appending a delete row.',
    )
    expectTrue(deletedFromHistory.state.selection.length === 0, 'History-row deletion should clear live selection state after the rewrite.')

    const liveDelete = transitionEditorState(baseState, { type: 'sketch.annotationDeleteRequested' })
    expectTrue(liveDelete.state.kind === 'editingSketch', 'Live selection deletion should keep the sketch editor active.')
    expectTrue(
      liveDelete.state.session.fullDefinition.authoringOperations?.length === 2,
      'Live selection deletion of a reference image should append a durable delete operation.',
    )
    expectTrue(
      liveDelete.state.session.fullDefinition.authoringOperations?.at(-1)?.kind === 'delete',
      'Live selection deletion should preserve the existing append-delete semantics for viewport-selected reference images.',
    )
  }

  function testCommittedDimensionAnnotationEditRequestOpensAndCommitsValueForm() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [10, 0])
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 5])
    session = acceptSketchDraw(session, [10, 5])

    const [firstPointId, , , diagonalPointId] = session.definition.pointIds
    expectTrue(firstPointId && diagonalPointId, 'Annotation edit fixture should create selectable sketch points.')

    session = beginSketchTool(session, 'dimensionDistance')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: firstPointId,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: diagonalPointId,
    })
    session = patchSketchConstraintValue(session, { value: 24 })
    session = patchSketchConstraintValue(session, { intent: 'commitConstraintValue' })

    const annotation = getSketchAnnotationDescriptors(session).find((entry) => entry.target.kind === 'dimension')
    expectTrue(annotation?.target.kind === 'dimension', 'Annotation edit fixture should create a committed dimension annotation.')

    const baseState: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-annotation-edit-1',
        toolId: 'sketch',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
    }

    const opened = transitionEditorState(baseState, {
      type: 'sketch.annotationEditRequested',
      target: annotation.target,
    })

    expectTrue(opened.state.kind === 'editingSketch', 'Annotation edit request should stay in sketch editing.')
    expectTrue(
      opened.state.session.activeAnnotationEdit?.target.kind === 'dimension',
      'Annotation edit request should open a committed dimension edit session.',
    )
    expectTrue(
      opened.state.session.toolPresentation?.floatingInput?.value === 24,
      'Committed dimension edit form should open with the durable dimension value.',
    )

    const changed = transitionEditorState(opened.state, {
      type: 'sketch.toolPatched',
      patch: { value: 33 },
    })
    const committed = transitionEditorState(changed.state, {
      type: 'sketch.toolPatched',
      patch: { intent: 'commitAnnotationValue' },
    })

    expectTrue(committed.state.kind === 'editingSketch', 'Committed dimension edit should stay in sketch editing.')
    expectTrue(
      committed.state.session.definition.dimensions[0]?.kind === 'distance'
        && committed.state.session.definition.dimensions[0].value === 33,
      'Committed dimension edit should update the existing durable dimension record.',
    )
  }

  function testSketchStylePatchRoutesThroughSelectionAndUpdatesCommitRequest() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [8, 0])

    const target = session.definition.entities[0]?.target
    expectTrue(target, 'Style patch routing fixture should create a selectable local sketch entity.')

    const baseState: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [target],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-style-patch-1',
        toolId: 'line',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
    }

    const patched = transitionEditorState(baseState, {
      type: 'sketch.toolPatched',
      patch: { intent: 'patchSketchStyle', field: 'strokeColor', value: '#ff00ff' },
    })

    expectTrue(patched.state.kind === 'editingSketch', 'Sketch style patch event should remain in sketch editing.')
    expectTrue(
      patched.state.session.definition.entities[0]?.style?.strokeColor === '#ff00ff',
      'Sketch style patch should update the selected local entity style via sketch.toolPatched routing.',
    )
    expectTrue(
      patched.state.session.commitRequest?.definition.entities[0]?.style?.strokeColor === '#ff00ff',
      'Sketch style patch should rebuild the durable commit request payload.',
    )
  }

  function testRejectedSketchCommitShowsValidationMessage() {
    const session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    const diagnostic: ModelingDiagnostic = {
      code: 'mock-invalid-sketch',
      severity: 'error',
      message: 'Sketch solve ended with residual 12.',
      target: null,
      detail: null,
    }
    const state: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-commit-1',
        toolId: 'finishSketch',
        phase: 'awaitingEffect',
      },
      session,
      pendingCommitRequestId: 'request_sketch-commit-1',
    }

    const rejected = transitionEditorState(state, {
      type: 'effect.sketchCommitted',
      requestId: 'request_sketch-commit-1',
      documentId: 'doc_workspace',
      commandSessionId: 'command_sketch-commit-1',
      baseRevisionId: 'rev_1',
      revisionId: 'rev_1',
      accepted: false,
      diagnostics: [diagnostic],
    })

    expectTrue(rejected.state.kind === 'editingSketch', 'Rejected sketch commit should keep the sketch open.')
    expectTrue(
      rejected.state.session.validationMessage === diagnostic.message,
      'Rejected sketch commit diagnostics should surface in the visible sketch validation message.',
    )
  }

  function testSketchCommitConflictRefreshesBeforeRetry() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [8, 0])
    expectTrue(session.commitRequest, 'Sketch conflict fixture should have a commit payload.')

    const staleSnapshot = createSnapshot()
    staleSnapshot.document.revisionId = 'rev_0001'
    staleSnapshot.document.revisionId = 'rev_0001'
    const diagnostic: ModelingDiagnostic = {
      code: 'occ-revision-conflict',
      severity: 'error',
      message: 'Request revision rev_0001 does not match current revision rev_0002.',
      target: null,
      detail: {
        kind: 'revisionConflict',
        expectedRevisionId: 'rev_0001',
        actualRevisionId: 'rev_0002',
      },
    }
    const state: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_0001',
      },
      snapshot: staleSnapshot,
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-commit-1',
        toolId: 'finishSketch',
        phase: 'awaitingEffect',
      },
      session,
      pendingCommitRequestId: 'request_sketch-commit-1',
    }

    const conflicted = transitionEditorState(state, {
      type: 'effect.sketchCommitted',
      requestId: 'request_sketch-commit-1',
      documentId: 'doc_workspace',
      commandSessionId: 'command_sketch-commit-1',
      baseRevisionId: 'rev_0001',
      revisionId: 'rev_0002',
      accepted: false,
      actualRevisionId: 'rev_0002',
      diagnostics: [diagnostic],
    })

    const refreshEffect = conflicted.effects[0]
    expectTrue(refreshEffect?.type === 'document.fetchSnapshot', 'Sketch commit conflicts should request a snapshot refresh.')
    expectTrue(conflicted.state.kind === 'editingSketch', 'Sketch commit conflicts should keep the sketch open.')
    expectTrue(conflicted.state.document.revisionId === 'rev_0002', 'Sketch commit conflicts should advance the editor revision.')
    expectTrue(conflicted.state.pendingSnapshotRequestId === refreshEffect.requestId, 'Conflict refresh should be tracked as pending.')

    const refreshedSnapshot = createSnapshot()
    refreshedSnapshot.document.revisionId = 'rev_0002'
    refreshedSnapshot.document.revisionId = 'rev_0002'
    const refreshed = transitionEditorState(conflicted.state, {
      type: 'effect.snapshotLoaded',
      payload: {
        requestId: refreshEffect.requestId,
        documentId: refreshedSnapshot.document.documentId,
        revisionId: refreshedSnapshot.document.revisionId,
        snapshot: refreshedSnapshot,
        selectionCatalog: buildSelectionTargetCatalog(refreshedSnapshot),
      },
    })
    const retry = transitionEditorState(refreshed.state, {
      type: 'tool.activated',
      toolId: 'finishSketch',
    })
    const retryEffect = retry.effects[0]

    expectTrue(retryEffect?.type === 'sketch.commit', 'Retrying Finish Sketch should emit another sketch commit.')
    expectTrue(retryEffect.baseRevisionId === 'rev_0002', 'Sketch commit retries should use the refreshed revision.')
  }

  async function testModelingServiceRuntimePreservesResultRejections() {
    const appError = createAppError({
      code: 'modeling/diagnostic',
      message: 'The authored document changed after the current snapshot was loaded.',
      context: [
        { key: 'diagnosticCode', value: 'repository-head-conflict' },
        { key: 'reasonCode', value: 'repositoryChanged' },
        { key: 'diagnosticCount', value: 2 },
        { key: 'diagnosticCodes', value: 'feature-warning,repository-head-conflict' },
        { key: 'actualRevisionId', value: 'rev_2' },
      ],
    })
    const runtime = createModelingServiceEditorEffectRuntime({
      async getCurrentDocumentSnapshot() {
        return createSnapshot()
      },
      async projectSketchExternalReferences() {
        return { projectedReferences: [], diagnostics: [] }
      },
      sketchSolver: null,
      commitSketch() {
        throw new Error('Sketch commit is not used by this test.')
      },
      evaluatePreview() {
        throw new Error('Feature preview is not used by this test.')
      },
      createFeature() {
        throw new Error('Feature create is not used by this test.')
      },
      updateFeature() {
        throw new Error('Feature update is not used by this test.')
      },
      setFeatureCursor() {
        return ResultAsync.fromPromise(Promise.reject(appError), (error) => error as AppError)
      },
    })

    expectTrue(runtime.setDocumentCursor, 'Modeling service runtime should expose document cursor mutation.')
    const rejected = await runtime.setDocumentCursor({
      baseRevisionId: 'rev_1',
      cursor: { kind: 'feature', featureId: 'feature_a' },
    })

    expectTrue(!rejected.accepted, 'Modeling service Result Errs should become typed rejected mutation results.')
    expectTrue(rejected.revisionId === 'rev_2', 'Rejected mutation results should retain actual revision ids.')
    expectTrue(
      rejected.diagnostics[0]?.code === 'repository-head-conflict',
      'Rejected mutation diagnostics should retain the modeling diagnostic code.',
    )
    expectTrue(
      rejected.errorContext?.some((entry) => entry.key === 'diagnosticCodes' && entry.value === 'feature-warning,repository-head-conflict'),
      'Rejected mutation results should retain structured modeling error context.',
    )
  }

  testSketchActivationEmitsCorrelatedOpenEffect()
  testSketchActivationAcceptsAllPrimaryConstructionPlanes()
  testSketchActivationReusesCompatiblePreselectionAndClearsInvalidSelection()
  testSketchActivationAcceptsPlanarFaces()
  testSectionViewActivationCollectsPlanarSeeds()
  testSectionViewRejectsUnsupportedOrCameraLessSeeds()
  testSectionViewFlipAndClearPreservePlanePosition()
  await testMeasureActivationPairsSelectionsAndCleansUp()
  testSketchSessionPreservesStoredPlaneDefinition()
  testFeaturePreviewIgnoresStaleResponseIds()
  testRevolveActivationStartsFeaturePreviewFlow()
  testRevolveActivationSupportsFaceThenEdgeSelection()
  testShellActivationSeedsBodyFromSelectedFace()
  testThickenActivationSeedsFaceTargetsFromSelection()
  testSplitAndDeleteSolidActivationStartFeatureSessions()
  testFeatureActivationReusesCompatibleSelectionAndClearsInvalidSelection()
  testMirrorAndTransformActivationStartFeatureSessions()
  testActiveReferencePickerRoutesSingleAndMultiSelections()
  testReferencePickerCancellationAndSessionCleanup()
  await testImportSessionAutoArmsSinglePlanePicker()
  await testImportPlaneSelectionCompletesSinglePlanePicker()
  async function testSketchImageImportUsesEditorRuntime() {
    const snapshot = (await new MockKernelAdapter().getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })).snapshot
    const session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    const sketchState: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: snapshot.document.documentId,
        revisionId: snapshot.document.revisionId,
      },
      snapshot,
      selection: [session.planeTarget],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: buildSelectionTargetCatalog(snapshot),
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-import-1',
        toolId: 'sketch',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
      pendingImportRequestId: null,
    }

    const reopenedSession = {
      ...session,
      sketchId: 'sketch_imported' as SketchId,
      sketchLabel: 'Imported Sketch',
    }
    const runtime: EditorEffectRuntime = {
      async getCurrentDocumentSnapshot() {
        return snapshot
      },
      async commitSketch() {
        return null
      },
      async projectSketchReferences() {
        return { projectedReferences: [], diagnostics: [] }
      },
      async importSketchReferenceImages() {
        return {
          status: 'committed' as const,
          revisionId: snapshot.document.revisionId,
          snapshot,
          selectionCatalog: buildSelectionTargetCatalog(snapshot),
          session: reopenedSession,
          importedCount: 1,
        }
      },
      async evaluatePreview() {
        throw new Error('Feature preview is not used by this test.')
      },
      async commitFeature() {
        throw new Error('Feature commit is not used by this test.')
      },
    }

    const importing = transitionEditorState(sketchState, {
      type: 'tool.activated',
      toolId: 'importImage',
    })

    expectTrue(
      importing.effects.length === 0
        && importing.state.preview?.label === 'Select reference images',
      'Import Image should wait for direct user-gesture file selection before emitting the sketch import effect.',
    )
    expectTrue(importing.state.kind === 'editingSketch', 'Import Image should preserve sketch editing state while awaiting file selection.')

    const selected = transitionEditorState(importing.state, {
      type: 'sketch.referenceImagePayloadsPicked',
      payloads: [{
        mediaType: 'image/png',
        fileName: 'reference.png',
        pixelWidth: 640,
        pixelHeight: 480,
        base64Data: 'cG5n',
      }],
    })

    expectTrue(
      selected.effects[0]?.type === 'sketch.importReferenceImages',
      'Selected reference-image payloads should emit a sketch-owned import effect.',
    )

    const completedEvent = await runEditorEffect(selected.effects[0]!, runtime)
    const completed = transitionEditorState(selected.state, completedEvent)

    expectTrue(completed.state.kind === 'editingSketch', 'Successful import should keep the reopened sketch session active.')
    expectTrue(completed.state.selection[0]?.kind === 'sketch', 'Successful import should select the reopened sketch target.')
    expectTrue(
      completed.state.selection[0]?.kind === 'sketch' && completed.state.selection[0].sketchId === 'sketch_imported',
      'Successful import should reopen the imported sketch through the editor runtime rather than the workbench shell.',
    )
    expectTrue(completed.state.pendingImportRequestId === null, 'Import completion should clear the pending import request.')
  }

  function testSketchImageImportCanStartFromSketchSelectionCommand() {
    const commandState = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace' as const,
          revisionId: 'rev_1' as const,
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )

    expectTrue(commandState.state.kind === 'selectionCommand', 'Sketch activation should arm the sketch selection command.')

    const selected = transitionEditorState(commandState.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'construction', constructionId: 'construction_plane-xy' },
    })

    expectTrue(selected.state.kind === 'selectionCommand', 'Selecting the sketch plane should keep the sketch command active until the draft opens.')

    const importing = transitionEditorState(selected.state, {
      type: 'tool.activated',
      toolId: 'importImage',
    })

    expectTrue(
      importing.state.kind === 'selectionCommand'
        && importing.state.preview?.label === 'Select reference images',
      'Import Image should arm file selection from the sketch-entry command state.',
    )

    const payloadSelected = transitionEditorState(importing.state, {
      type: 'sketch.referenceImagePayloadsPicked',
      payloads: [{
        mediaType: 'image/png',
        fileName: 'reference.png',
        pixelWidth: 640,
        pixelHeight: 480,
        base64Data: 'cG5n',
      }],
    })

    expectTrue(payloadSelected.state.kind === 'editingSketch', 'Picking reference-image payloads should open a draft sketch session.')
    expectTrue(
      payloadSelected.effects[0]?.type === 'sketch.importReferenceImages',
      'Picking reference-image payloads from sketch entry should emit the sketch import effect.',
    )
  }

  function testSketchImagePayloadSelectionAcceptsImportImageOwnedSelectionCommand() {
    const importingState = {
      ...initialEditorState,
      kind: 'selectionCommand' as const,
      mode: 'part' as const,
      document: {
        documentId: 'doc_workspace' as const,
        revisionId: 'rev_1' as const,
      },
      snapshot: createSnapshot(),
      selection: [{ kind: 'construction', constructionId: 'construction_plane-xy' } as PrimitiveRef],
      selectionCatalog: createSelectionCatalog(),
      preview: {
        kind: 'sketch' as const,
        label: 'Select reference images',
        target: { kind: 'construction', constructionId: 'construction_plane-xy' } as PrimitiveRef,
      },
      command: {
        commandSessionId: 'command_import-image-1',
        toolId: 'importImage' as const,
        phase: 'collecting' as const,
      },
      pendingRequestId: null,
    }

    const payloadSelected = transitionEditorState(importingState, {
      type: 'sketch.referenceImagePayloadsPicked',
      payloads: [{
        mediaType: 'image/png',
        fileName: 'reference.png',
        pixelWidth: 640,
        pixelHeight: 480,
        base64Data: 'cG5n',
      }],
    })

    expectTrue(
      payloadSelected.state.kind === 'editingSketch',
      'Import-image-owned sketch selection commands should open a draft sketch session when payloads are picked.',
    )
    expectTrue(
      payloadSelected.effects[0]?.type === 'sketch.importReferenceImages',
      'Import-image-owned sketch selection commands should emit the sketch import effect.',
    )
  }

  testSelectionClearEventClearsSelectionAndPreservesActiveState()
  testSketchToolClearStaysInSketchEditing()
  testRemainingSketchToolsActivateWithoutDroppingSketchSession()
  testSketchEditToolActivationReusesCompatibleSelectionAndClearsInvalidSelection()
  testPassiveSketchStyleToolsDoNotDropSketchSession()
  testConstraintAuthoringReceivesViewportHoverAndSelection()
  testDimensionSelectionClickPinsReadyValuePreview()
  testDimensionReleaseOverSecondLineDefersToAngleSelection()
  testConstraintAuthoringIgnoresInvalidViewportSelection()
  testConnectedSketchSelectionEventUpdatesNormalSelectionState()
  testConnectedSketchSelectionEventWorksAfterRectangleToolAcceptsShape()
  testConnectedSketchSelectionEventRejectsUnsupportedTargets()
  testCommittedAnnotationSelectionAndDeletionRoutesThroughSketchMutation()
  testSketchHistoryDeleteStaysDistinctFromLiveSelectionDelete()
  testCommittedDimensionAnnotationEditRequestOpensAndCommitsValueForm()
  testSketchStylePatchRoutesThroughSelectionAndUpdatesCommitRequest()
  testRejectedSketchCommitShowsValidationMessage()
  testSketchCommitConflictRefreshesBeforeRetry()
  await testModelingServiceRuntimePreservesResultRejections()
  testReplayIsDeterministic()
  testDirectSnapshotLoadUpdatesDocumentWithoutFetch()
  testSelectionKeyUsesDurableRefs()
  await testRuntimeLoopProcessesSketchOpen()
  await testRuntimeLoopOpensSketchFromPlanarFace()
  await testRuntimeLoopOpensSketchFromNonXYConstruction()
  await testRuntimeLoopReopensStoredSketchPlane()
  await testRuntimeLoopReopensCommittedFeatureFromExplicitIntent()
  await testRuntimeLoopReopensSketchFromExplicitIntent()
  await testSketchImageImportUsesEditorRuntime()
  testSketchImageImportCanStartFromSketchSelectionCommand()
  testSketchImagePayloadSelectionAcceptsImportImageOwnedSelectionCommand()
  await testFeatureEditEntryRollsBackBeforeHydrationFromTail()
  await testSketchEditEntryRollsBackBeforeOpenFromTail()
  await testTailSketchReopenSkipsRollbackAndOpensImmediately()
  await testFeatureEditCancelRestoresTailCursor()
  await testFeatureEditCommitRestoresNonTailCursor()
  await testSketchAbortRestoresTailCursor()
  await testFinishSketchAtCurrentSketchCursorSkipsRestore()
  await testRepositoryBackedFeatureEditCommitRefreshesBeforeRestore()
  await testDocumentCursorRequestUsesSnapshotBasisAndRefreshesOnConflict()
  testSnapshotRefreshCanPreserveRenderRecordsForFeatureDiagnostics()
  testDocumentReplacementResetsIntoPartIdleState()
  await testEditorEventLoopBootstrapsAndLoadsSnapshot()
  await testEditorEventLoopCancelsObsoleteSketchOpenEffects()
})
