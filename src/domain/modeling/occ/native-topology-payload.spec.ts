import { test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import type { MeshExportAccuracy } from '@/contracts/export/capabilities'
import type { CadaraBrepGeometryAssetBody } from '@/contracts/modeling/geometry-assets'
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
  BRepPrimAPI_MakeCylinder_1: new (
    radius: number,
    height: number,
  ) => NativeBoxBuilderForTest
  TopoDS_Shape: new () => { delete?: () => void }
}

type NativeOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<NativeOpenCascadeForTest>

type Point3 = readonly [number, number, number]

function getCoedgeVertexPair(
  body: CadaraBrepGeometryAssetBody,
  coedgeIndex: number,
): readonly [number, number] | null {
  const coedge = body.topology.coedges[coedgeIndex]
  if (!coedge) {
    return null
  }
  const edge = body.topology.edges[coedge.edgeIndex]
  if (!edge) {
    return null
  }

  const [first, last] = edge.vertices
  return coedge.reversed ? [last, first] : [first, last]
}

function assertEveryLoopIsClosedAndConnected(
  body: CadaraBrepGeometryAssetBody | undefined,
  label: string,
) {
  expectTrue(body != null, `${label} should include a B-rep body.`)
  if (!body) {
    return
  }

  for (const [loopIndex, loop] of body.topology.loops.entries()) {
    expectTrue(loop.coedgeIndices.length > 0, `${label} loop ${loopIndex} should contain at least one coedge.`)
    const pairs = loop.coedgeIndices.map((coedgeIndex) => getCoedgeVertexPair(body, coedgeIndex))
    expectTrue(
      pairs.every((pair) => pair != null),
      `${label} loop ${loopIndex} should reference existing coedges and edges.`,
    )

    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
      const current = pairs[pairIndex]
      const next = pairs[(pairIndex + 1) % pairs.length]
      expectTrue(
        current != null && next != null && current[1] === next[0],
        `${label} loop ${loopIndex} should be closed and connected at coedge ${pairIndex}.`,
      )
    }
  }
}

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
      topologyPayload.buffers.length >= 3,
      'Converted native topology payload should expose transferable mesh buffers.',
    )
    expectTrue(
      topologyPayload.bodies[0]?.renderMesh?.positions.byteLength === 24 * 3 * Float32Array.BYTES_PER_ELEMENT,
      'Converted native topology payload should describe position data through a buffer-backed table.',
    )
    expectTrue(
      topologyPayload.bodies[0]?.renderMesh?.triangleIndices.byteLength === 12 * 3 * Uint32Array.BYTES_PER_ELEMENT,
      'Converted native topology payload should describe triangle indices through a buffer-backed table.',
    )
    expectTrue(
      topologyPayload.bodies[0]?.renderMeshSummary?.positions?.length === 24,
      'Converted native topology payload should retain render mesh positions from the shim payload.',
    )
    expectTrue(nativeExactBrep.cadaraBrep != null, 'Native exact B-rep shim should return Cadara B-rep records directly.')
    expectTrue(
      !exactBrepPayload.diagnostics.some((diagnostic) =>
        diagnostic.code === 'occ-native-exact-brep-unsupported-topology'
      ),
      'Native exact B-rep payload should not diagnose oriented coedges as missing when the shim emits exact records.',
    )
    expectTrue(
      exactBrepPayload.brep.bodies[0]?.topology.faces.length === 6,
      'Native exact B-rep payload should expose the box face topology from the shim.',
    )
    expectTrue(
      exactBrepPayload.brep.bodies[0]?.topology.vertices.length === 8,
      'Native exact B-rep payload should expose box vertex points from the shim.',
    )
    expectTrue(
      exactBrepPayload.buffers.length === 1,
      'Converted native exact B-rep payload should expose a transferable serialized exact payload buffer.',
    )
    expectTrue(
      exactBrepPayload.brep.bodies[0]?.topology.edges.length === 12,
      'Native exact B-rep payload should expose box edge curves from the shim.',
    )
    expectTrue(
      exactBrepPayload.brep.bodies[0]?.topology.coedges.length === 24,
      'Native exact B-rep payload should preserve oriented coedge order for each box face loop.',
    )
    expectTrue(
      exactBrepPayload.brep.bodies[0]?.topology.loops.length === 6,
      'Native exact B-rep payload should expose one oriented loop per box face.',
    )
    assertEveryLoopIsClosedAndConnected(
      exactBrepPayload.brep.bodies[0],
      'Native exact box B-rep payload',
    )
    expectTrue(
      exactBrepPayload.tables.topology.faces.rowCount === 6
        && exactBrepPayload.tables.topology.coedges.rowCount === 24
        && exactBrepPayload.tables.curves.rowCount === 12
        && exactBrepPayload.tables.surfaces.rowCount === 6
        && exactBrepPayload.tables.trims.rowCount === 24,
      'Native exact B-rep payload table metadata should count topology, curves, surfaces, and trims.',
    )
    expectTrue(
      exactBrepPayload.brep.bodies[0]?.topology.edges.every((edge) => edge.curve.kind === 'line') === true,
      'Native exact B-rep payload should preserve box edges as analytic lines.',
    )
    expectTrue(
      exactBrepPayload.brep.bodies[0]?.topology.faces.every((face) => face.surface.kind === 'plane') === true,
      'Native exact B-rep payload should preserve box faces as analytic planes.',
    )
    expectTrue(
      exactBrepPayload.brep.bodies[0]?.topology.coedges.every((coedge) => coedge.curve2d.kind === 'line') === true,
      'Native exact B-rep payload should preserve box 2D trim curves as analytic lines.',
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
      meshPayload.buffers.length >= 3,
      'Converted native mesh export payload should expose transferable mesh buffers.',
    )
    expectTrue(
      meshPayload.mesh.triangleIndices.byteLength === 12 * 3 * Uint32Array.BYTES_PER_ELEMENT,
      'Converted native mesh export payload should describe export triangle indices through a buffer-backed table.',
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

  async function testNativeExactBrepExtractsCurvedTopologyInsteadOfFlatteningIt() {
    const oc = await loadNativeOpenCascadeForTest()
    const cylinderBuilder = new oc.BRepPrimAPI_MakeCylinder_1(1, 2)
    const shape = cylinderBuilder.Shape()
    const bodyId = 'body_native_exact_curved_probe' as BodyId
    const revisionId = 'rev_native_exact_curved_probe' as RevisionId
    const nativeExactBrep = parseNativeShimPayloadJson(
      oc.CadaraBuildNativeExactBrepPayload.BuildJson(
        shape,
        bodyId,
        't_native_curved',
      ),
    )
    const exactBrepPayload = createOccNativeExactBrepPayloadFromShimPayload({
      revisionId,
      target: { kind: 'body', bodyId },
      bodyId,
      bodyLabel: 'Native exact curved probe',
      nativePayload: nativeExactBrep,
    })

    expectTrue(
      !exactBrepPayload.diagnostics.some((diagnostic) =>
        diagnostic.code === 'occ-native-exact-brep-unsupported-topology'
      ),
      'Native exact B-rep payload should return exact curved records instead of the old unsupported-topology diagnostic.',
    )
    expectTrue(
      exactBrepPayload.brep.bodies[0]?.topology.faces.some((face) => face.surface.kind === 'cylinder'),
      'Native exact B-rep payload should preserve the cylinder side face as an analytic cylinder.',
    )
    expectTrue(
      exactBrepPayload.brep.bodies[0]?.topology.edges.some((edge) => edge.curve.kind === 'circle'),
      'Native exact B-rep payload should preserve circular cylinder trim edges as analytic circles.',
    )
    assertEveryLoopIsClosedAndConnected(
      exactBrepPayload.brep.bodies[0],
      'Native exact cylinder B-rep payload',
    )
    expectTrue(
      exactBrepPayload.brep.bodies[0]?.topology.coedges.every((coedge) =>
        coedge.curve2d.kind !== 'polyline' && coedge.curve2d.kind !== 'unsupported'
      ) === true,
      'Native exact B-rep payload should emit analytic 2D p-curves for cylinder coedges instead of sampled or unsupported trims.',
    )
    expectTrue(
      exactBrepPayload.brep.bodies[0]?.topology.coedges.some((coedge) => coedge.curve2d.kind === 'circle') === true,
      'Native exact B-rep payload should preserve circular planar cylinder trims as 2D circles.',
    )

    ;(shape as { delete?: () => void }).delete?.()
    cylinderBuilder.delete?.()
  }

  function testConvertedPayloadPreservesKernelOwnedIdentity() {
    const bodyId = 'body_kernel_identity_probe' as BodyId
    const payload = createOccNativeTopologyPayloadFromShimPayloads({
      revisionId: 'rev_kernel_identity_probe' as RevisionId,
      lodTierId: 'fine',
      bodies: [{
        bodyId,
        nativePayload: parseNativeShimPayloadJson(JSON.stringify({
          schemaVersion: 'occ-native-topology-payload/v1alpha1',
          source: 'occt7-shim',
          topology: [{
            id: `face_${bodyId}_k12345`,
            kernelUid: 'occt7-shim:face:12345',
            kind: 'face',
            bodyId,
            index: 1,
          }],
          edgeVertices: [],
          diagnostics: [],
        })),
      }],
    })
    const faceIdentity = payload.bodies[0]?.identity.find((identity) =>
      identity.publicRef?.kind === 'face'
    )

    expectTrue(
      faceIdentity?.kernelUid === 'occt7-shim:face:12345',
      'Converted native topology payload should preserve kernel-owned identity separately from the public durable id.',
    )
    expectTrue(
      faceIdentity?.publicRef?.kind === 'face'
        && !faceIdentity.publicRef.faceId.includes('_t0001_'),
      'Converted native topology payload should allow fresh public ids that are not topology-token traversal ids.',
    )
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

  async function testNativeMeshPayloadPreservesFaceOrientation() {
    const oc = await loadNativeOpenCascadeForTest()
    const boxBuilder = new oc.BRepPrimAPI_MakeBox_2(1, 2, 3)
    const shape = boxBuilder.Shape()
    const bodyId = 'body_native_mesh_orientation_probe' as BodyId
    const nativeTopology = parseNativeShimPayloadJson(
      oc.CadaraBuildNativeTopologyPayload.BuildJson(
        shape,
        bodyId,
        't_native_orientation',
        0.1,
        0.5,
      ),
    )
    const positions = nativeTopology.mesh?.positions
    const triangleIndices = nativeTopology.mesh?.triangleIndices

    expectTrue(positions != null, 'Native mesh orientation test requires native mesh positions.')
    expectTrue(triangleIndices != null, 'Native mesh orientation test requires native mesh triangle indices.')

    const center: Point3 = [0.5, 1, 1.5]
    let outwardTriangleCount = 0

    for (const triangle of triangleIndices ?? []) {
      const first = positions?.[triangle[0]]
      const second = positions?.[triangle[1]]
      const third = positions?.[triangle[2]]

      expectTrue(first != null && second != null && third != null, 'Native mesh triangle should reference existing vertices.')

      const normal = cross(subtract(second, first), subtract(third, first))
      const triangleCenter = scale(add(add(first, second), third), 1 / 3)
      const outward = subtract(triangleCenter, center)

      expectTrue(
        dot(normal, outward) > 0,
        'Native mesh payload should preserve outward triangle winding for reversed OCC faces.',
      )
      outwardTriangleCount += 1
    }

    expectTrue(outwardTriangleCount === 12, 'Native mesh orientation test should check every box triangle.')

    ;(shape as { delete?: () => void }).delete?.()
    boxBuilder.delete?.()
  }

  await testNativeShimReturnsFlatTopologyAndMeshPayloads()
  await testNativeShimReturnsStructuredDiagnosticsForInvalidCommittedShapes()
  await testNativeExactBrepExtractsCurvedTopologyInsteadOfFlatteningIt()
  testConvertedPayloadPreservesKernelOwnedIdentity()
  await testNativeFeatureTransactionPreparesCommittedShapePayload()
  await testNativeBooleanTransactionBuildsCommittedPayload()
  await testNativeBooleanTransactionReturnsCommittedShapeResult()
  await testNativeMeshPayloadPreservesFaceOrientation()
})

function subtract(left: Point3, right: Point3): Point3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function add(left: Point3, right: Point3): Point3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function scale(point: Point3, factor: number): Point3 {
  return [point[0] * factor, point[1] * factor, point[2] * factor]
}

function cross(left: Point3, right: Point3): Point3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function dot(left: Point3, right: Point3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}
