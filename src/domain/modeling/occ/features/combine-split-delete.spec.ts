import { test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import type { AdvancedSolidFeatureDefinition } from '@/contracts/modeling/advanced-solid'
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from '@/contracts/modeling/advanced-solid'
import type { BodyId, FeatureId } from '@/contracts/shared/ids'
import { createOccAuthoringState } from '@/domain/modeling/occ/authoring-state'
import { executeCombineFeature, executeSplitFeature } from '@/domain/modeling/occ/features/combine-split-delete'
import type { OpenCascadeNativeTopologyKernelHost } from '@/domain/modeling/occ/native-topology-payload'
import { toGpPnt } from '@/domain/modeling/occ/planes'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  OCC_REFERENCE_INVALIDATION_REASONS,
  trackNewSolidBody,
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
  origin: readonly [number, number, number],
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(
    toGpPnt(oc, origin),
    4,
    4,
    4,
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

test('executeSplitFeature uses native split transaction for ambiguous/deleted topology history', async () => {
  const oc = await loadCustomOpenCascadeForTest()
  const target = makeTrackedBox(
    oc,
    'body_native_split_target' as BodyId,
    'feature_native_split_target' as FeatureId,
    [0, 0, 0],
  )
  const tool = makeTrackedBox(
    oc,
    'body_native_split_tool' as BodyId,
    'feature_native_split_tool' as FeatureId,
    [2, 0, 0],
  )
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost
  const nativeBuilder = nativeHost.CadaraExecuteNativeFeatureTransaction?.BuildSplitCommittedShapeTransactionWithHistory
  let nativeCallCount = 0
  expectTrue(typeof nativeBuilder === 'function', 'Expected custom OCC runtime to expose native split transactions.')
  nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildSplitCommittedShapeTransactionWithHistory = (...args) => {
    nativeCallCount += 1
    return nativeBuilder(...args)
  }
  const context = createOccAuthoringState(oc, { bodies: [target, tool] })

  const result = executeSplitFeature(
    context,
    'feature_native_split' as FeatureId,
    {
      kind: 'split',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'targetBody', targets: [{ kind: 'body', bodyId: target.bodyId }] },
          { role: 'toolBody', targets: [{ kind: 'body', bodyId: tool.bodyId }] },
        ],
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: 'split' },
  )

  expectTrue(nativeCallCount === 1, 'Split feature execution should use the native split transaction when available.')
  expectTrue(!result.bodies.some((body) => body.bodyId === target.bodyId), 'Split should remove the original target body.')
  expectTrue(result.bodies.some((body) => body.bodyId === tool.bodyId), 'Split should keep the tool body live.')
  expectTrue(result.producedTargets.length > 0, 'Native split should produce replacement split result bodies.')
  expectTrue(
    [...result.historyInvalidations.values()].some((invalidation) =>
      invalidation.reason === OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous,
    ),
    'Native split should report ambiguous topology instead of choosing traversal-order successors.',
  )
  expectTrue(
    ![...result.historyInvalidations.values()].some((invalidation) =>
      invalidation.reason === OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory
      || invalidation.reason === OCC_REFERENCE_INVALIDATION_REASONS.topologyModified,
    ),
    'Native split should not fall back to unsupported or JS-side modified-history invalidations.',
  )
})

test('executeCombineFeature uses native boolean transaction for single-tool subtraction history', async () => {
  const oc = await loadCustomOpenCascadeForTest()
  const target = makeTrackedBox(
    oc,
    'body_native_combine_target' as BodyId,
    'feature_native_combine_target' as FeatureId,
    [0, 0, 0],
  )
  const tool = makeTrackedBox(
    oc,
    'body_native_combine_tool' as BodyId,
    'feature_native_combine_tool' as FeatureId,
    [2, 0, 0],
  )
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost
  const nativeBuilder = nativeHost.CadaraExecuteNativeFeatureTransaction?.BuildBooleanCommittedShapeTransactionWithHistory
  let nativeCallCount = 0
  expectTrue(typeof nativeBuilder === 'function', 'Expected custom OCC runtime to expose native boolean transactions.')
  nativeHost.CadaraExecuteNativeFeatureTransaction!.BuildBooleanCommittedShapeTransactionWithHistory = (...args) => {
    nativeCallCount += 1
    return nativeBuilder(...args)
  }
  const context = createOccAuthoringState(oc, { bodies: [target, tool] })

  const result = executeCombineFeature(
    context,
    'feature_native_combine' as FeatureId,
    {
      kind: 'combine',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'subtract',
        participants: [
          { role: 'targetBody', targets: [{ kind: 'body', bodyId: target.bodyId }] },
          { role: 'toolBody', targets: [{ kind: 'body', bodyId: tool.bodyId }] },
        ],
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: 'combine' },
  )
  const replacement = result.bodies.find((body) => body.bodyId === target.bodyId)

  expectTrue(nativeCallCount === 1, 'Combine subtraction should use the native boolean transaction when available.')
  expectTrue(replacement != null, 'Combine subtraction should keep a replacement target body.')
  expectTrue(!result.bodies.some((body) => body.bodyId === tool.bodyId), 'Combine subtraction should consume the tool body.')
  expectTrue(
    ![...result.historyInvalidations.values()].some((invalidation) =>
      invalidation.reason === OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory
      || invalidation.reason === OCC_REFERENCE_INVALIDATION_REASONS.topologyModified,
    ),
    'Native combine should not fall back to unsupported or JS-side modified-history invalidations.',
  )
})
