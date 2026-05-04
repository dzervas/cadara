import { test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import type { MeshExportAccuracy } from '@/contracts/export/capabilities'
import type { BodyId, RevisionId } from '@/contracts/shared/ids'
import { expectTrue } from '@/testing/expect.spec'
import {
  createOccNativeMeshExportPayloadFromShimPayload,
  createOccNativeExactBrepPayloadFromShimPayload,
  createOccNativeReferenceInvalidationsFromHistoryPayload,
  createOccNativeTopologyPayloadFromShimPayloads,
  parseNativeFeatureTransactionHistoryJson,
  parseNativeShimPayloadJson,
  type OpenCascadeNativeTopologyKernelHost,
} from '@/domain/modeling/occ/native-topology-payload'

type NativeBoxBuilderForTest = {
  Shape(): unknown
  delete?: () => void
}

type NativeOpenCascadeForTest = OpenCascadeNativeTopologyKernelHost & {
  BRepPrimAPI_MakeBox_2: new (
    dx: number,
    dy: number,
    dz: number,
  ) => NativeBoxBuilderForTest
  TopoDS_Shape: new () => { delete?: () => void }
}

type NativeOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<NativeOpenCascadeForTest>

test('src/domain/modeling/occ/native-topology-payload.spec.ts', async () => {
  async function loadNativeOpenCascadeForTest() {
    const module = await import('../../../../public/cadara-occ.js') as {
      default: NativeOpenCascadeMainJSForTest
    }
    const wasmBinary = new Uint8Array(
      await readFile(new URL('../../../../public/cadara-occ.wasm', import.meta.url)),
    )

    return new module.default({ wasmBinary })
  }

  async function testNativeShimReturnsFlatTopologyAndMeshPayloads() {
    const oc = await loadNativeOpenCascadeForTest()
    const boxBuilder = new oc.BRepPrimAPI_MakeBox_2(1, 2, 3)
    const shape = boxBuilder.Shape()
    const bodyId = 'body_native_payload_probe' as BodyId
    const revisionId = 'rev_native_payload_probe' as RevisionId
    const topologyJson = oc.CadaraBuildNativeTopologyPayload?.BuildJson?.(
      shape,
      bodyId,
      't_native',
      0.1,
      0.5,
    )
    const meshJson = oc.CadaraBuildNativeMeshExportPayload?.BuildJson?.(
      shape,
      0.1,
      0.5,
    )
    const exactBrepJson = oc.CadaraBuildNativeExactBrepPayload?.BuildJson?.(
      shape,
      bodyId,
      't_native',
    )

    expectTrue(typeof topologyJson === 'string', 'Custom OCC build should expose native topology payload JSON.')
    expectTrue(typeof meshJson === 'string', 'Custom OCC build should expose native mesh payload JSON.')
    expectTrue(typeof exactBrepJson === 'string', 'Custom OCC build should expose native exact B-rep payload JSON.')

    const nativeTopology = parseNativeShimPayloadJson(topologyJson)
    const nativeMesh = parseNativeShimPayloadJson(meshJson)
    const nativeExactBrep = parseNativeShimPayloadJson(exactBrepJson)
    const topologyPayload = createOccNativeTopologyPayloadFromShimPayloads({
      revisionId,
      lodTierId: 'fine',
      bodies: [{
        bodyId,
        nativePayload: nativeTopology,
      }],
    })
    const meshAccuracy: MeshExportAccuracy = {
      chordTolerance: 0.1,
      angleToleranceRadians: 0.5,
    }
    const meshPayload = createOccNativeMeshExportPayloadFromShimPayload({
      revisionId,
      target: { kind: 'body', bodyId },
      options: meshAccuracy,
      nativePayload: nativeMesh,
    })
    const exactBrepPayload = createOccNativeExactBrepPayloadFromShimPayload({
      revisionId,
      target: { kind: 'body', bodyId },
      bodyId,
      bodyLabel: 'Native payload probe',
      nativePayload: nativeExactBrep,
    })

    expectTrue(nativeTopology.topology.length === 26, 'Box topology should be returned as one flat native record table.')
    expectTrue(nativeTopology.edgeVertices.length === 12, 'Box edge endpoints should be returned in one flat native adjacency table.')
    expectTrue(nativeTopology.vertexPoints?.length === 8, 'Box vertex points should be returned in one flat native point table.')
    expectTrue(nativeTopology.faceEdges?.length === 6, 'Box face-edge adjacency should be returned in one flat native adjacency table.')
    expectTrue(nativeTopology.mesh?.positions?.length === 24, 'Native topology payload should include flat render mesh positions.')
    expectTrue(nativeTopology.mesh?.triangleIndices?.length === 12, 'Native topology payload should include flat render mesh triangle indices.')
    expectTrue(nativeTopology.mesh?.triangleFaceBindings?.length === 12, 'Native topology payload should bind every render triangle to a face.')
    expectTrue(topologyPayload.bodies[0]?.identity.length === 27, 'Payload identity should include the body plus native subshape records.')
    expectTrue(
      topologyPayload.bodies[0]?.renderMeshSummary?.positions?.length === 24,
      'Converted native topology payload should retain render mesh positions from the shim payload.',
    )
    expectTrue(
      exactBrepPayload.tables.topology.faces.rowCount === 6,
      'Native exact B-rep payload should be built from the same flat native topology records.',
    )
    expectTrue(
      topologyPayload.bodies[0]?.renderMeshSummary?.triangleCount === 12,
      'Native topology payload should carry the shim mesh summary without JS face triangulation.',
    )
    expectTrue(
      meshPayload.meshSummary?.triangleCount === 12,
      'Native mesh export payload should carry the shim mesh summary without JS face triangulation.',
    )
    expectTrue(
      meshPayload.meshSummary?.triangleIndices?.length === 12,
      'Converted native mesh export payload should retain flat triangle indices from the shim payload.',
    )

    ;(shape as { delete?: () => void }).delete?.()
    boxBuilder.delete?.()
  }

  async function testNativeShimReturnsStructuredDiagnosticsForInvalidCommittedShapes() {
    const oc = await loadNativeOpenCascadeForTest()
    const shape = new oc.TopoDS_Shape()
    const bodyId = 'body_invalid_native_payload_probe' as BodyId
    const nativeTopology = parseNativeShimPayloadJson(
      oc.CadaraBuildNativeTopologyPayload.BuildJson(
        shape,
        bodyId,
        't_invalid',
        0.1,
        0.5,
      ),
    )
    const topologyPayload = createOccNativeTopologyPayloadFromShimPayloads({
      revisionId: 'rev_invalid_native_payload_probe' as RevisionId,
      lodTierId: 'fine',
      bodies: [{
        bodyId,
        nativePayload: nativeTopology,
      }],
    })

    expectTrue(
      topologyPayload.diagnostics.some((diagnostic) =>
        diagnostic.code === 'occ-native-topology-invalid-shape'
        && diagnostic.target?.kind === 'body'
        && diagnostic.target.bodyId === bodyId
      ),
      'Native topology payload should surface invalid committed shapes as structured diagnostics.',
    )

    shape.delete?.()
  }

  async function testNativeFeatureTransactionPreparesCommittedShapePayload() {
    const oc = await loadNativeOpenCascadeForTest()
    const boxBuilder = new oc.BRepPrimAPI_MakeBox_2(1, 2, 3)
    const shape = boxBuilder.Shape()
    const bodyId = 'body_native_transaction_probe' as BodyId
    const nativeTopology = parseNativeShimPayloadJson(
      oc.CadaraExecuteNativeFeatureTransaction.BuildCommittedShapePayload(
        shape,
        bodyId,
        't_transaction',
        0.1,
        0.5,
      ),
    )
    const topologyPayload = createOccNativeTopologyPayloadFromShimPayloads({
      revisionId: 'rev_native_transaction_probe' as RevisionId,
      lodTierId: 'fine',
      bodies: [{
        bodyId,
        nativePayload: nativeTopology,
      }],
    })

    expectTrue(
      topologyPayload.diagnostics.length === 0,
      'Native committed-shape transaction should accept a valid prepared solid without diagnostics.',
    )
    expectTrue(
      nativeTopology.topology.length === 26,
      'Native committed-shape transaction should emit the prepared solid topology table.',
    )
    expectTrue(
      topologyPayload.bodies[0]?.renderMeshSummary?.triangleCount === 12,
      'Native committed-shape transaction should mesh the prepared committed solid in the same payload.',
    )

    ;(shape as { delete?: () => void }).delete?.()
    boxBuilder.delete?.()
  }

  async function testNativeBooleanTransactionBuildsCommittedPayload() {
    const oc = await loadNativeOpenCascadeForTest()
    const leftBuilder = new oc.BRepPrimAPI_MakeBox_2(2, 2, 2)
    const rightBuilder = new oc.BRepPrimAPI_MakeBox_2(2, 2, 2)
    const bodyId = 'body_native_boolean_transaction_probe' as BodyId
    const nativeTopology = parseNativeShimPayloadJson(
      oc.CadaraExecuteNativeFeatureTransaction.BuildBooleanCommittedShapePayload?.(
        leftBuilder.Shape(),
        rightBuilder.Shape(),
        'join',
        bodyId,
        't_boolean_transaction',
        0.1,
        0.5,
      ) ?? '',
    )
    const topologyPayload = createOccNativeTopologyPayloadFromShimPayloads({
      revisionId: 'rev_native_boolean_transaction_probe' as RevisionId,
      lodTierId: 'fine',
      bodies: [{
        bodyId,
        nativePayload: nativeTopology,
      }],
    })

    expectTrue(
      topologyPayload.diagnostics.length === 0,
      'Native boolean transaction should accept a valid join and emit no diagnostics.',
    )
    expectTrue(
      nativeTopology.topology.length === 26,
      'Native boolean transaction should emit the committed boolean result topology table.',
    )
    expectTrue(
      topologyPayload.bodies[0]?.renderMeshSummary?.triangleCount === 12,
      'Native boolean transaction should mesh the committed boolean result in the same payload.',
    )

    leftBuilder.delete?.()
    rightBuilder.delete?.()
  }

  async function testNativeBooleanTransactionReturnsCommittedShapeResult() {
    const oc = await loadNativeOpenCascadeForTest()
    const leftBuilder = new oc.BRepPrimAPI_MakeBox_2(2, 2, 2)
    const rightBuilder = new oc.BRepPrimAPI_MakeBox_2(2, 2, 2)
    const bodyId = 'body_native_boolean_transaction_result_probe' as BodyId
    const result = oc.CadaraExecuteNativeFeatureTransaction.BuildBooleanCommittedShapeTransaction?.(
      leftBuilder.Shape(),
      rightBuilder.Shape(),
      'join',
      bodyId,
      't_boolean_transaction_result',
      0.1,
      0.5,
    )

    expectTrue(result != null, 'Custom OCC build should expose native boolean transaction result objects.')
    const committedShape = result.Shape() as { IsNull: () => boolean }
    const nativeTopology = parseNativeShimPayloadJson(result.PayloadJson())
    const nativeHistory = parseNativeFeatureTransactionHistoryJson(result.HistoryJson())

    expectTrue(result.IsDone(), 'Native boolean transaction result should report success for a valid join.')
    expectTrue(!committedShape.IsNull(), 'Native boolean transaction result should expose the committed shape.')
    expectTrue(
      nativeTopology.diagnostics.length === 0,
      'Native boolean transaction result payload should accept a valid join without diagnostics.',
    )
    expectTrue(
      nativeTopology.mesh?.triangleIndices?.length === 12,
      'Native boolean transaction result payload should mesh the committed shape.',
    )
    expectTrue(
      nativeHistory.status === 'available',
      'Pre-8 native boolean transaction history should report available native successor records when the boolean builder provides history.',
    )
    expectTrue(
      nativeHistory.records.length === 26,
      'Native boolean transaction history should include records for prior faces, edges, and vertices.',
    )
    expectTrue(
      nativeHistory.records.some((record) =>
        record.reason === 'unique-successor' && record.successors.length === 1
      ),
      'Native boolean transaction history should identify unique successors for stable topology.',
    )
    expectTrue(
      createOccNativeReferenceInvalidationsFromHistoryPayload(nativeHistory).length === 0,
      'Unique native boolean successors should not produce invalidation payload records.',
    )

    leftBuilder.delete?.()
    rightBuilder.delete?.()
  }

  await testNativeShimReturnsFlatTopologyAndMeshPayloads()
  await testNativeShimReturnsStructuredDiagnosticsForInvalidCommittedShapes()
  await testNativeFeatureTransactionPreparesCommittedShapePayload()
  await testNativeBooleanTransactionBuildsCommittedPayload()
  await testNativeBooleanTransactionReturnsCommittedShapeResult()
})
