import { test } from 'bun:test'

import type { AuthoredFeatureRecord } from '@/contracts/modeling/authored-document'
import type { FeatureDefinition, ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { BodyId, FeatureId, RegionId, SketchId } from '@/contracts/shared/ids'
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import {
  createDependencyBlockedDiagnostic,
  createFeatureFieldDiagnostic,
} from '@/domain/modeling/feature-diagnostic-mapping'

test('src/domain/modeling/feature-diagnostic-mapping.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const missingRegion = {
    kind: 'region' as const,
    sketchId: 'sketch_deleted' as SketchId,
    regionId: 'region_deleted' as RegionId,
  }
  const definition: FeatureDefinition = {
    kind: 'extrude',
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      profiles: [missingRegion],
      startExtent: { kind: 'profilePlane' },
      extent: {
        mode: 'oneSide',
        end: { kind: 'blind', direction: 'positive', distance: 4 },
      },
      operation: 'join',
      booleanScope: { kind: 'targetBody', bodyId: 'body_target_deleted' as BodyId },
    },
  }
  const feature: AuthoredFeatureRecord = {
    featureId: 'feature_extrude-broken' as FeatureId,
    label: 'Merge bodies',
    definition,
  }
  const diagnostic = createFeatureFieldDiagnostic({
    code: 'occ-missing-reference',
    feature,
    target: missingRegion,
    detail: {
      kind: 'invalidReference',
      reference: {
        reason: 'occ-missing-reference',
        target: missingRegion,
        ownerFeatureId: null,
        ownerSketchId: 'sketch_deleted' as SketchId,
        sourceTarget: { kind: 'sketch', sketchId: 'sketch_deleted' as SketchId },
      },
    },
  }) satisfies ModelingDiagnostic

  assert(diagnostic.featureId === feature.featureId, 'Feature diagnostics should carry the owning feature id.')
  assert(diagnostic.fieldId === 'profiles', 'Missing profile references should map to the authored profile field.')
  assert(
    diagnostic.message === 'Merge bodies profile selection is incorrect.',
    'User-facing diagnostics should name the repairable authored field.',
  )
  assert(
    diagnostic.repairGuidance === 'Edit Merge bodies and choose a valid profile selection.',
    'Feature diagnostics should include direct repair guidance.',
  )
  assert(
    !diagnostic.message.includes('region_deleted') && !diagnostic.repairGuidance?.includes('region_deleted'),
    'User-facing diagnostic copy should not expose raw durable ids as the primary message.',
  )
  assert(
    diagnostic.detail?.kind === 'invalidReference'
      && diagnostic.detail.reference.target.kind === 'region'
      && diagnostic.detail.reference.target.regionId === 'region_deleted',
    'Raw durable ids should remain available in structured debug context.',
  )

  const blocked = createDependencyBlockedDiagnostic({
    featureId: 'feature_join-blocked' as FeatureId,
    featureLabel: 'Join boss',
    blockingFeatureId: feature.featureId,
    blockingFeatureLabel: feature.label,
  })

  assert(blocked.featureId === 'feature_join-blocked', 'Dependency-blocked diagnostics should identify the blocked feature.')
  assert(
    blocked.repairGuidance === 'Repair Merge bodies, then rebuild Join boss.',
    'Dependency-blocked repair guidance should use feature labels instead of raw ids.',
  )
  assert(
    !blocked.message.includes(feature.featureId) && !blocked.repairGuidance?.includes(feature.featureId),
    'Dependency-blocked user-facing copy should keep raw feature ids out of the primary message.',
  )
  assert(
    blocked.detail?.kind === 'rebuildFailure'
      && blocked.detail.affectedFeatureIds.includes(feature.featureId),
    'Dependency-blocked diagnostics should keep raw blocking feature ids in structured debug context.',
  )
})
