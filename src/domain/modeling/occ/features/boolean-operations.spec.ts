import { test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { expectTrue } from '@/testing/expect.spec'
import type { BodyId, FeatureId } from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'
import { createOccAuthoringState } from '@/domain/modeling/occ/authoring-state'
import {
  applyBooleanPolicy,
  resolveReplacementBodies,
} from '@/domain/modeling/occ/features/boolean-operations'
import { toGpPnt } from '@/domain/modeling/occ/planes'
import { getDefaultOpenCascadeInstance, type OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  getOccDurableRefKey,
  OCC_REFERENCE_INVALIDATION_REASONS,
  trackNewSolidBody,
  type OccTrackedBody,
} from '@/domain/modeling/occ/topology'

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
  dimensions: readonly [number, number, number],
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(
    toGpPnt(oc, [0, 0, 0]),
    dimensions[0],
    dimensions[1],
    dimensions[2],
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

function makeBoxShape(
  oc: OpenCascadeInstance,
  dimensions: readonly [number, number, number],
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(
    toGpPnt(oc, [0, 0, 0]),
    dimensions[0],
    dimensions[1],
    dimensions[2],
  )
  box.Build(new oc.Message_ProgressRange_1())
  expectTrue(box.IsDone(), 'Expected replacement box to build.')

  return box.Shape()
}

function topologyTargets(body: OccTrackedBody): DurableRef[] {
  return [
    ...body.topology.faceIds.map((faceId) => ({ kind: 'face' as const, bodyId: body.bodyId, faceId })),
    ...body.topology.edgeIds.map((edgeId) => ({ kind: 'edge' as const, bodyId: body.bodyId, edgeId })),
    ...body.topology.vertexIds.map((vertexId) => ({ kind: 'vertex' as const, bodyId: body.bodyId, vertexId })),
  ]
}

test('resolveReplacementBodies invalidates topology explicitly when replacement history is unavailable', async () => {
  const oc = await getDefaultOpenCascadeInstance()
  const body = makeTrackedBox(
    oc,
    'body_unsupported_history_seed' as BodyId,
    'feature_unsupported_history_seed' as FeatureId,
    [1, 1, 1],
  )
  const context = createOccAuthoringState(oc, { bodies: [body] })
  const replacementShape = makeBoxShape(oc, [2, 1, 1])

  const result = resolveReplacementBodies(
    context,
    body.bodyId,
    replacementShape,
    'feature_unsupported_history_replace' as FeatureId,
    { allowEmpty: false },
  )

  const expectedTargets = topologyTargets(body)
  expectTrue(result.replacements.length === 1, 'Expected one replacement body.')
  expectTrue(
    result.historyInvalidations.size === expectedTargets.length,
    'Expected every previous face, edge, and vertex to receive an unsupported-history invalidation.',
  )

  for (const target of expectedTargets) {
    const invalidation = result.historyInvalidations.get(getOccDurableRefKey(target))
    expectTrue(
      invalidation?.reason === OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory,
      `Expected ${getOccDurableRefKey(target)} to be invalidated as unsupported history.`,
    )
    expectTrue(
      invalidation.sourceTarget?.kind === 'body' && invalidation.sourceTarget.bodyId === body.bodyId,
      `Expected ${getOccDurableRefKey(target)} to identify its owning body as the invalidation source.`,
    )
  }
})

test('applyBooleanPolicy preserves unique native boolean history successors', async () => {
  const oc = await loadCustomOpenCascadeForTest()
  const body = makeTrackedBox(
    oc,
    'body_native_boolean_history_seed' as BodyId,
    'feature_native_boolean_history_seed' as FeatureId,
    [2, 2, 2],
  )
  const context = createOccAuthoringState(oc, { bodies: [body] })
  const featureShape = makeBoxShape(oc, [2, 2, 2])

  const result = applyBooleanPolicy(
    context,
    'feature_native_boolean_history_join' as FeatureId,
    'join',
    { kind: 'targetBody', bodyId: body.bodyId },
    featureShape,
  )
  const replacement = result.bodies.find((candidate) => candidate.bodyId === body.bodyId)

  expectTrue(replacement != null, 'Native boolean policy should replace the target body.')
  expectTrue(
    result.historyInvalidations.size === 0,
    'Native boolean history should not invalidate references that have unique successors.',
  )
  expectTrue(
    body.topology.faceIds.every((faceId) => replacement?.topology.faceIds.includes(faceId)),
    'Native boolean history should preserve previous face ids with unique successors.',
  )
  expectTrue(
    body.topology.edgeIds.every((edgeId) => replacement?.topology.edgeIds.includes(edgeId)),
    'Native boolean history should preserve previous edge ids with unique successors.',
  )
  expectTrue(
    body.topology.vertexIds.every((vertexId) => replacement?.topology.vertexIds.includes(vertexId)),
    'Native boolean history should preserve previous vertex ids with unique successors.',
  )
})
