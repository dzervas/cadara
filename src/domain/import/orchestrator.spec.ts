import { test } from 'bun:test'

import { ResultAsync, createAppError } from '@/contracts/errors'
import { applyImportPreparedActions } from '@/domain/import/orchestrator'
import type { ModelingService } from '@/domain/modeling/modeling-service'

test('src/domain/import/orchestrator.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const result = await applyImportPreparedActions({
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

  assert(result.revisionId === 'rev_4', 'Import action application should advance to the final mutation revision.')
  assert(
    result.createdEntityIds.variableIds[0] === 'var_scale'
      && result.createdEntityIds.featureIds[0] === 'feature_image_support'
      && result.createdEntityIds.sketchIds[0] === 'sketch_imported_image',
    'Import action application should preserve created ids for variables, features, and sketches.',
  )
})
