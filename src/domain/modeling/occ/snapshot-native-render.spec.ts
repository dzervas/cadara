import { test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import { expectTrue } from '@/testing/expect.spec'
import type { BodyId, FaceId, FeatureId } from '@/contracts/shared/ids'
import { buildOccWorkspaceSnapshot } from '@/domain/modeling/occ/snapshot'
import { createOccAuthoringState } from '@/domain/modeling/occ/authoring-state'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import { toGpPnt } from '@/domain/modeling/occ/planes'
import { trackNewSolidBody } from '@/domain/modeling/occ/topology'
import {
  createOccNativeTopologyPayloadFromShimPayloads,
  parseNativeShimPayloadJson,
  type OpenCascadeNativeTopologyKernelHost,
} from '@/domain/modeling/occ/native-topology-payload'

type CustomOpenCascadeForTest = OpenCascadeInstance & OpenCascadeNativeTopologyKernelHost

type CustomOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<CustomOpenCascadeForTest>

test('src/domain/modeling/occ/snapshot-native-render.spec.ts', async () => {
  async function loadCustomOpenCascadeForTest() {
    const module = await import('../../../../public/cadara-occ.js') as {
      default: CustomOpenCascadeMainJSForTest
    }
    const wasmBinary = new Uint8Array(
      await readFile(new URL('../../../../public/cadara-occ.wasm', import.meta.url)),
    )

    return new module.default({ wasmBinary })
  }

  async function testBodyRenderExportConsumesNativeMeshPayload() {
    const oc = await loadCustomOpenCascadeForTest()
    const builder = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, [0, 0, 0]), 1, 2, 3)
    builder.Build(new oc.Message_ProgressRange_1())
    expectTrue(builder.IsDone(), 'Expected OCC box builder to produce a native render test body.')

    const body = trackNewSolidBody(oc, {
      bodyId: 'body_native_render_mesh' as BodyId,
      label: 'Native render mesh body',
      ownerFeatureId: 'feature_native_render_mesh' as FeatureId,
      shape: builder.Shape(),
    })
    const nativeJson = oc.CadaraBuildNativeTopologyPayload?.BuildJson?.(
      body.shape,
      body.bodyId,
      body.topologyToken,
      0.1,
      0.5,
    )

    expectTrue(typeof nativeJson === 'string', 'Custom OCC build should expose native topology payload JSON.')

    const state = createOccAuthoringState(oc, { bodies: [body] })
    const nativeTopologyPayload = createOccNativeTopologyPayloadFromShimPayloads({
      revisionId: state.revisionId,
      lodTierId: 'fine',
      bodies: [{
        bodyId: body.bodyId,
        nativePayload: parseNativeShimPayloadJson(nativeJson),
      }],
    })
    const originalTriangulation = oc.BRep_Tool.Triangulation
    let triangulationCallCount = 0

    oc.BRep_Tool.Triangulation = (() => {
      triangulationCallCount += 1
      throw new Error('Body render export must use the native mesh payload, not JS face triangulation.')
    }) as typeof originalTriangulation

    try {
      const snapshot = buildOccWorkspaceSnapshot(state, [], { nativeTopologyPayload })
      const faceMeshRecords = snapshot.document.render.records.filter((record) =>
        record.ownerBodyId === body.bodyId
        && record.binding.topology === 'face'
        && record.geometry.kind === 'mesh'
      )
      const triangleCount = faceMeshRecords.reduce(
        (total, record) => total + (record.geometry.kind === 'mesh' ? record.geometry.triangleIndices.length : 0),
        0,
      )

      expectTrue(
        triangulationCallCount === 0,
        'Native body render export must not call the JS BRep_Tool.Triangulation binding.',
      )
      expectTrue(faceMeshRecords.length === 6, 'Native body render export should produce one mesh record per box face.')
      expectTrue(triangleCount === 12, 'Native body render export should preserve all twelve box render triangles.')
    } finally {
      oc.BRep_Tool.Triangulation = originalTriangulation
      builder.delete?.()
    }
  }

  async function testNativeRenderMapsMeshBindingsThroughPreservedDurableFaceIds() {
    const oc = await loadCustomOpenCascadeForTest()
    const builder = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, [0, 0, 0]), 1, 2, 3)
    builder.Build(new oc.Message_ProgressRange_1())
    expectTrue(builder.IsDone(), 'Expected OCC box builder to produce a native render alias test body.')

    const body = trackNewSolidBody(oc, {
      bodyId: 'body_native_render_alias' as BodyId,
      label: 'Native render alias body',
      ownerFeatureId: 'feature_native_render_alias' as FeatureId,
      shape: builder.Shape(),
    })
    const nativeTopologyToken = 't0002'
    const nativeJson = oc.CadaraBuildNativeTopologyPayload?.BuildJson?.(
      body.shape,
      body.bodyId,
      nativeTopologyToken,
      0.1,
      0.5,
    )

    expectTrue(typeof nativeJson === 'string', 'Custom OCC build should expose native topology payload JSON.')

    const durableFaceIdsByNativeId = new Map<FaceId, FaceId>(
      body.topology.faceIds.map((faceId, index) => [
        `face_${body.bodyId}_${nativeTopologyToken}_${index + 1}` as FaceId,
        faceId,
      ]),
    )
    const aliasedBody = {
      ...body,
      nativeTopologyIdAliases: {
        faceIdsByNativeId: durableFaceIdsByNativeId,
      },
    }
    const state = createOccAuthoringState(oc, { bodies: [aliasedBody] })
    const nativeTopologyPayload = createOccNativeTopologyPayloadFromShimPayloads({
      revisionId: state.revisionId,
      lodTierId: 'fine',
      bodies: [{
        bodyId: body.bodyId,
        nativePayload: parseNativeShimPayloadJson(nativeJson),
      }],
    })
    const snapshot = buildOccWorkspaceSnapshot(state, [], { nativeTopologyPayload })
    const faceMeshRecords = snapshot.document.render.records.filter((record) =>
      record.ownerBodyId === body.bodyId
      && record.binding.topology === 'face'
      && record.geometry.kind === 'mesh'
    )
    const triangleCount = faceMeshRecords.reduce(
      (total, record) => total + (record.geometry.kind === 'mesh' ? record.geometry.triangleIndices.length : 0),
      0,
    )

    expectTrue(
      faceMeshRecords.length === 6,
      'Native render export should keep preserved durable face ids visible when mesh bindings use fresh native ids.',
    )
    expectTrue(
      triangleCount === 12,
      'Native render export should not drop triangles whose native face binding aliases to a preserved durable face id.',
    )

    builder.delete?.()
  }

  await testBodyRenderExportConsumesNativeMeshPayload()
  await testNativeRenderMapsMeshBindingsThroughPreservedDurableFaceIds()
})
