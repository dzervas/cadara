import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  buildSelectionTargetCatalog,
  getEntityRecordForTarget,
  getFeatureSnapshot,
  getSelectionDetail,
  getTargetContributingFeatureIds,
} from '@/domain/modeling/document-snapshot-view'
import { createSeedDocumentSnapshot } from '@/domain/modeling/modeling-test-fixtures'

test('document snapshot view resolves selection details, contributing features, and selection catalogs', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const sketchTarget = { kind: 'sketch', sketchId: snapshot.document.sketches[0]!.sketchId } as const
  const featureTarget = { kind: 'feature', featureId: snapshot.document.features[0]!.featureId } as const
  const bodyTarget = { kind: 'body', bodyId: snapshot.document.bodies[0]!.bodyId } as const
  const faceTarget = { kind: 'face', bodyId: snapshot.document.bodies[0]!.bodyId, faceId: 'face_top' as const } as const
  const missingTarget = { kind: 'feature', featureId: 'feature_missing' as typeof featureTarget.featureId } as const

  const featureEntity = getEntityRecordForTarget(snapshot, featureTarget)
  expectTrue(
    featureEntity?.label === 'Extrude 1',
    'Entity lookup should resolve snapshot presentation entities by durable target key.',
  )
  expectTrue(
    getEntityRecordForTarget(snapshot, missingTarget) === null,
    'Entity lookup should return null for missing snapshot targets.',
  )

  const featureSelection = getSelectionDetail(snapshot, featureTarget)
  expectTrue(
    featureSelection.label === 'Extrude 1'
      && featureSelection.kindLabel === 'feature'
      && featureSelection.ownerLabel === 'Extrude 1'
      && featureSelection.relatedLabels.includes('Part 1 body'),
    'Feature selection detail should resolve the feature label, owner label, and related entity labels.',
  )

  const sketchSelection = getSelectionDetail(snapshot, sketchTarget)
  expectTrue(
    sketchSelection.ownerLabel === 'Sketch 1',
    'Sketch-owned selections should surface the owning sketch label.',
  )

  const bodySelection = getSelectionDetail(snapshot, bodyTarget)
  expectTrue(
    bodySelection.ownerLabel === 'Extrude 1',
    'Body-owned selections should surface the owning feature label when available.',
  )

  const unresolvedSelection = getSelectionDetail(snapshot, missingTarget)
  expectTrue(
    unresolvedSelection.label === 'feature_missing'
      && unresolvedSelection.ownerLabel === 'Unresolved selection'
      && unresolvedSelection.relatedLabels.length === 0,
    'Missing selections should fall back to primitive labels without related targets.',
  )

  const contributing = getTargetContributingFeatureIds(snapshot, faceTarget)
  expectTrue(
    contributing.length === 1 && contributing[0] === 'feature_extrude-1',
    'Selection detail helpers should expose contributing feature ids from the presentation entity.',
  )
  expectTrue(
    getTargetContributingFeatureIds(snapshot, null).length === 0,
    'Null targets should produce an empty contributing-feature list.',
  )

  expectTrue(
    getFeatureSnapshot(snapshot, featureTarget.featureId)?.label === 'Extrude 1'
      && getFeatureSnapshot(snapshot, missingTarget.featureId) === null,
    'Feature lookup should resolve existing feature snapshots and return null for missing ids.',
  )

  const catalog = buildSelectionTargetCatalog(snapshot)
  expectTrue(
    catalog.selectableTargetKeys.includes('construction:construction_plane-xy')
      && catalog.existingSketchKeys.includes('sketch:sketch_primary')
      && catalog.constructionPlaneKeys.includes('construction:construction_plane-xy')
      && catalog.planarFaceKeys.includes('face:body_part-1:face_top'),
    'Selection catalog classification should split selectable targets into sketch, construction-plane, and planar-face buckets.',
  )

  const brokenSnapshot = {
    ...snapshot,
    presentation: {
      ...snapshot.presentation,
      entities: snapshot.presentation.entities.map((entity) =>
        entity.target.kind === 'feature' && entity.target.featureId === featureTarget.featureId
          ? {
              ...entity,
              relatedTargets: [{ kind: 'feature', featureId: 'feature_missing' as typeof featureTarget.featureId }],
            }
          : entity),
    },
  }

  let relatedTargetMessage: string | null = null
  try {
    getSelectionDetail(brokenSnapshot, featureTarget)
  } catch (error: unknown) {
    relatedTargetMessage = error instanceof Error ? error.message : String(error)
  }
  expectTrue(
    relatedTargetMessage === 'Related target feature:feature_missing is missing from snapshot.presentation.entities.',
    'Missing related targets should fail loudly instead of silently dropping broken presentation links.',
  )
})
