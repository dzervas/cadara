import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { ResultAsync, createAppError } from '@/contracts/errors'
import type { ImportProvider } from '@/contracts/import/provider'
import type { FeatureEditorFormSchema } from '@/core/feature-authoring/form-schema'
import {
  applyImportPreparedActions,
  createImportSession,
  prepareImportActions,
  resolveLocalFileImportSource,
} from '@/domain/import/orchestrator'
import type { ModelingService } from '@/domain/modeling/modeling-service'

test('src/domain/import/orchestrator.spec.ts', async () => {  const result = await applyImportPreparedActions({
    modelingService: {
      addDocumentVariable() {
        return ResultAsync.fromPromise(Promise.resolve({
          revisionId: 'rev_2',
          variableId: 'var_scale',
          revisionState: 'advanced',
          rebuildResult: 'reused',
          changedTargets: [],
          diagnostics: [],
        }), (error) => createAppError({ code: 'test/add-variable', message: String(error) }))
      },
      createFeature(input) {
        return ResultAsync.fromPromise(Promise.resolve({
          revisionId: input.baseRevisionId === 'rev_2' ? 'rev_3' : 'rev_feature_unexpected',
          featureId: 'feature_image_support',
          revisionState: 'advanced',
          rebuildResult: 'reused',
          changedTargets: [],
          diagnostics: [],
        }), (error) => createAppError({ code: 'test/create-feature', message: String(error) }))
      },
      commitSketch(input) {
        return ResultAsync.fromPromise(Promise.resolve({
          revisionId: input.baseRevisionId === 'rev_3' ? 'rev_4' : 'rev_sketch_unexpected',
          sketchId: 'sketch_imported_image',
          revisionState: 'advanced',
          rebuildResult: 'reused',
          changedTargets: [],
          diagnostics: [],
        }), (error) => createAppError({ code: 'test/commit-sketch', message: String(error) }))
      },
    } as unknown as ModelingService,
    baseRevisionId: 'rev_1',
    actions: {
      addDocumentVariables: [{
        name: 'scale',
        valueText: '10 mm',
      }],
      createFeatures: [{
        featureType: 'plane',
        featureLabel: 'Image support',
        participantTargets: [],
        parameterValues: {},
      }],
      commitSketches: [{
        baseRevisionId: 'rev_ignored',
        solverCorrelation: null,
        sketchId: null,
        sketchLabel: 'Imported image',
        plane: {
          support: { kind: 'construction', constructionId: 'construction_plane-xy' },
          frame: {
            origin: [0, 0, 0],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
            normal: [0, 0, 1],
            linearUnit: 'documentLength',
            handedness: 'rightHanded',
          },
          key: 'xy',
        },
        planeTarget: { kind: 'construction', constructionId: 'construction_plane-xy' },
        planeKey: 'xy',
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
          styleIds: [],
          styles: [],
          svgRenderingEnabled: true,
          derivedRelationships: [],
          authoringOperations: [],
        },
      }],
      diagnostics: [],
    },
  })

  expectTrue(result.revisionId === 'rev_4', 'Import action application should advance to the final mutation revision.')
  expectTrue(
    result.createdEntityIds.variableIds[0] === 'var_scale'
      && result.createdEntityIds.featureIds[0] === 'feature_image_support'
      && result.createdEntityIds.sketchIds[0] === 'sketch_imported_image',
    'Import action application should preserve created ids for variables, features, and sketches.',
  )

  const file = new File([new Uint8Array([0xde, 0xad, 0xbe, 0xef])], 'fixture.step', { type: 'model/step' })
  const source = await resolveLocalFileImportSource(file)
  expectTrue(
    source.name === 'fixture.step'
      && source.origin.kind === 'localFile'
      && source.origin.fileName === 'fixture.step'
      && source.mediaType === 'model/step'
      && source.bytes.length === 4
      && source.fingerprint.startsWith('sha256:'),
    'Local-file import source resolution should preserve file metadata, bytes, and a deterministic fingerprint.',
  )

  const review = {
    providerReview: { units: 'mm' as const },
    proposedActionKinds: ['createFeature' as const],
    diagnostics: [],
  }
  const providerCalls: string[] = []
  const provider: ImportProvider<{ units: 'mm' }, { body: string }, FeatureEditorFormSchema> = {
    id: 'step',
    label: 'STEP',
    acceptedFileTypes: [{ extension: '.step', mediaType: 'model/step' }],
    accepts: () => true,
    async review() {
      providerCalls.push('review')
      return review
    },
    createDefaultSelections(returnedReview) {
      providerCalls.push('defaults')
      expectTrue(returnedReview === review, 'Import session creation should forward the provider review into default-selection creation.')
      return { body: 'Body 1' }
    },
    getReviewFormSchema(returnedReview, selections) {
      providerCalls.push('schema')
      expectTrue(returnedReview === review && selections.body === 'Body 1', 'Import session creation should build form schema from the provider review and default selections.')
      return { sections: [] } as FeatureEditorFormSchema
    },
    applySelectionPatch(_review, selections) {
      return selections
    },
    async prepare(input) {
      providerCalls.push('prepare')
      expectTrue(
        input.source === source
          && input.review === review
          && input.selections.body === 'Body 1'
          && input.capabilities.context.documentId === 'doc_workspace',
        'Prepared import actions should receive the resolved source, persisted review, selections, and import capabilities.',
      )
      return {
        createFeatures: [{
          featureType: 'plane',
          featureLabel: 'Imported plane',
          participantTargets: [],
          parameterValues: {},
        }],
        diagnostics: [{ severity: 'warning', message: 'Imported with defaults.' }],
      }
    },
  }

  const session = await createImportSession({
    provider,
    source,
    capabilities: {
      context: {
        contractVersion: 'cadara/v1alpha1',
        documentId: 'doc_workspace',
        baseRevisionId: 'rev_1',
      },
      modeling: {
        async bakeGeometry() {
          throw new Error('not used')
        },
        async reconstructMeshToBrep() {
          throw new Error('not used')
        },
      },
      sketch: {
        async convertVectorToSketch() {
          throw new Error('not used')
        },
      },
      assets: {
        async registerGeometryAsset() {
          throw new Error('not used')
        },
        async storeEmbeddedBinary() {
          throw new Error('not used')
        },
      },
    },
  })
  expectTrue(
    session.providerId === 'step'
      && session.resolvedSource === source
      && session.review === review
      && (session.selections as { body: string }).body === 'Body 1'
      && providerCalls.slice(0, 3).join(',') === 'review,defaults,schema',
    'Import session creation should run provider review, default selection, and form-schema wiring in order.',
  )

  const prepared = await prepareImportActions({
    provider,
    source,
    review,
    selections: { body: 'Body 1' },
    capabilities: {
      context: {
        contractVersion: 'cadara/v1alpha1',
        documentId: 'doc_workspace',
        baseRevisionId: 'rev_1',
      },
      modeling: {
        async bakeGeometry() {
          throw new Error('not used')
        },
        async reconstructMeshToBrep() {
          throw new Error('not used')
        },
      },
      sketch: {
        async convertVectorToSketch() {
          throw new Error('not used')
        },
      },
      assets: {
        async registerGeometryAsset() {
          throw new Error('not used')
        },
        async storeEmbeddedBinary() {
          throw new Error('not used')
        },
      },
    },
  })
  expectTrue(
    providerCalls.includes('prepare')
      && prepared.createFeatures?.[0]?.featureLabel === 'Imported plane'
      && prepared.diagnostics?.[0]?.message === 'Imported with defaults.',
    'Prepared import actions should come directly from the provider and preserve provider diagnostics.',
  )
})
