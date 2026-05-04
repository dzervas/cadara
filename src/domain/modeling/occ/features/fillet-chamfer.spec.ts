import { test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import type { AdvancedSolidFeatureDefinition } from '@/contracts/modeling/advanced-solid'
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from '@/contracts/modeling/advanced-solid'
import type { BodyId, FeatureId } from '@/contracts/shared/ids'
import { createOccAuthoringState } from '@/domain/modeling/occ/authoring-state'
import { executeChamferFeature, executeFilletFeature } from '@/domain/modeling/occ/features/fillet-chamfer'
import { toGpPnt } from '@/domain/modeling/occ/planes'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  OCC_REFERENCE_INVALIDATION_REASONS,
  trackNewSolidBody,
  type OccReferenceInvalidationRecord,
} from '@/domain/modeling/occ/topology'
import { expectTrue } from '@/testing/expect.spec'

type CustomOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>

async function loadCustomOpenCascadeForTest() {
  const module = await import('../../../../../public/cadara-occ.js') as {
    default: CustomOpenCascadeMainJSForTest
  }
  const wasmBinary = new Uint8Array(
    await readFile(new URL('../../../../../public/cadara-occ.wasm', import.meta.url)),
  )

  return new module.default({ wasmBinary })
}

function makeTrackedBox(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  ownerFeatureId: FeatureId,
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(
    toGpPnt(oc, [0, 0, 0]),
    2,
    2,
    2,
  )
  box.Build(new oc.Message_ProgressRange_1())
  expectTrue(box.IsDone(), `Expected ${bodyId} box to build.`)

  return trackNewSolidBody(oc, {
    bodyId,
    label: bodyId,
    ownerFeatureId,
    shape: box.Shape(),
  })
}

function assertNativeHistoryDidNotFallBack(
  invalidations: ReadonlyMap<string, OccReferenceInvalidationRecord>,
  label: string,
) {
  for (const invalidation of invalidations.values()) {
    expectTrue(
      invalidation.reason !== OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory,
      `${label} should use native history instead of unsupported-history invalidations.`,
    )
    expectTrue(
      invalidation.reason !== OCC_REFERENCE_INVALIDATION_REASONS.topologyModified,
      `${label} should use native successor classifications instead of JS-side modified-history invalidations.`,
    )
  }
}

test('executeFilletFeature uses native transaction history for replacement topology', async () => {
  const oc = await loadCustomOpenCascadeForTest()
  const body = makeTrackedBox(
    oc,
    'body_native_fillet_history_seed' as BodyId,
    'feature_native_fillet_history_seed' as FeatureId,
  )
  const edgeId = body.topology.edgeIds[0]
  expectTrue(edgeId != null, 'Expected the tracked box to expose a fillet edge target.')
  const context = createOccAuthoringState(oc, { bodies: [body] })

  const result = executeFilletFeature(
    context,
    'feature_native_fillet_history' as FeatureId,
    {
      radius: 0.15,
      edgeTargets: [{ kind: 'edge', bodyId: body.bodyId, edgeId }],
    },
  )
  const replacement = result.bodies.find((candidate) => candidate.bodyId === body.bodyId)

  expectTrue(replacement != null, 'Native fillet should replace the target body.')
  expectTrue(replacement!.topology.faceIds.length > body.topology.faceIds.length, 'Native fillet should add fillet topology.')
  assertNativeHistoryDidNotFallBack(result.historyInvalidations, 'Native fillet')
})

test('executeChamferFeature uses native transaction history for replacement topology', async () => {
  const oc = await loadCustomOpenCascadeForTest()
  const body = makeTrackedBox(
    oc,
    'body_native_chamfer_history_seed' as BodyId,
    'feature_native_chamfer_history_seed' as FeatureId,
  )
  const edgeId = body.topology.edgeIds[0]
  expectTrue(edgeId != null, 'Expected the tracked box to expose a chamfer edge target.')
  const context = createOccAuthoringState(oc, { bodies: [body] })

  const result = executeChamferFeature(
    context,
    'feature_native_chamfer_history' as FeatureId,
    {
      kind: 'chamfer',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'edge', targets: [{ kind: 'edge', bodyId: body.bodyId, edgeId }] },
        ],
        options: { distance: 0.15 },
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: 'chamfer' },
  )
  const replacement = result.bodies.find((candidate) => candidate.bodyId === body.bodyId)

  expectTrue(replacement != null, 'Native chamfer should replace the target body.')
  expectTrue(replacement!.topology.faceIds.length > body.topology.faceIds.length, 'Native chamfer should add chamfer topology.')
  assertNativeHistoryDidNotFallBack(result.historyInvalidations, 'Native chamfer')
})
