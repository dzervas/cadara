import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";

import type { MeshExportAccuracy } from "@/contracts/export/capabilities";
import type { CadaraBrepGeometryAssetBody } from "@/contracts/modeling/geometry-assets";
import type { BodyId, RevisionId } from "@/contracts/shared/ids";
import {
  createOccNativeMeshExportPayloadFromShimPayload,
  createOccNativeExactBrepPayloadFromShimPayload,
  createOccNativeReferenceInvalidationsFromHistoryPayload,
  createOccNativeTopologyPayloadFromShimPayloads,
  parseNativeFeatureTransactionHistoryJson,
  parseNativeShimPayloadJson,
  type OpenCascadeNativeTopologyKernelHost,
} from "@/domain/modeling/occ/native-topology-payload";

type NativeBoxBuilderForTest = {
  Shape(): unknown;
  delete?: () => void;
};

type NativeOpenCascadeForTest = OpenCascadeNativeTopologyKernelHost & {
  BRepPrimAPI_MakeBox_2: new (
    dx: number,
    dy: number,
    dz: number,
  ) => NativeBoxBuilderForTest;
  BRepPrimAPI_MakeCylinder_1: new (
    radius: number,
    height: number,
  ) => NativeBoxBuilderForTest;
  TopoDS_Shape: new () => { delete?: () => void };
};

type NativeOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<NativeOpenCascadeForTest>;

type Point3 = readonly [number, number, number];

function getCoedgeVertexPair(
  body: CadaraBrepGeometryAssetBody,
  coedgeIndex: number,
): readonly [number, number] | null {
  const coedge = body.topology.coedges[coedgeIndex];
  if (!coedge) {
    return null;
  }
  const edge = body.topology.edges[coedge.edgeIndex];
  if (!edge) {
    return null;
  }

  const [first, last] = edge.vertices;
  return coedge.reversed ? [last, first] : [first, last];
}

function assertEveryLoopIsClosedAndConnected(
  body: CadaraBrepGeometryAssetBody | undefined,
  label: string,
) {
  expect(body != null, `${label} should include a B-rep body.`).toBeTruthy();
  if (!body) {
    return;
  }

  for (const [loopIndex, loop] of body.topology.loops.entries()) {
    expect(
      loop.coedgeIndices.length > 0,
      `${label} loop ${loopIndex} should contain at least one coedge.`,
    ).toBeTruthy();
    const pairs = loop.coedgeIndices.map((coedgeIndex) =>
      getCoedgeVertexPair(body, coedgeIndex),
    );
    expect(
      pairs.every((pair) => pair != null),
      `${label} loop ${loopIndex} should reference existing coedges and edges.`,
    ).toBeTruthy();

    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
      const current = pairs[pairIndex];
      const next = pairs[(pairIndex + 1) % pairs.length];
      expect(
        current != null && next != null && current[1] === next[0],
        `${label} loop ${loopIndex} should be closed and connected at coedge ${pairIndex}.`,
      ).toBeTruthy();
    }
  }
}

test("src/domain/modeling/occ/native-topology-payload.spec.ts", async () => {
  function expectInvalidNativeShimPayload(payload: unknown, message: string) {
    let rejected = false;
    try {
      parseNativeShimPayloadJson(JSON.stringify(payload));
    } catch {
      rejected = true;
    }

    expect(rejected, message).toBeTruthy();
  }

  function testNativeShimPayloadRejectsMalformedPrimitiveInvariants() {
    const validPayload = {
      schemaVersion: "occ-native-topology-payload/v1alpha1",
      source: "occt7-shim",
      bodyId: "body_native_invariant_probe",
      topologyToken: "t_native_invariant_probe",
      counts: { faces: 1, edges: 1, vertices: 1 },
      topology: [
        {
          id: "face_native_invariant_probe",
          kernelUid: "occt7-shim:face:1",
          kind: "face",
          bodyId: "body_native_invariant_probe",
          index: 0,
        },
      ],
      edgeVertices: [
        {
          edgeId: "edge_native_invariant_probe",
          start: [0, 0, 0],
          end: [1, 0, 0],
        },
      ],
      vertexPoints: [
        {
          vertexId: "vertex_native_invariant_probe",
          point: [0, 0, 0],
        },
      ],
      faceEdges: [
        {
          faceId: "face_native_invariant_probe",
          edgeIds: ["edge_native_invariant_probe"],
        },
      ],
      mesh: {
        nodeCount: 3,
        triangleCount: 1,
        linearDeflection: 0.1,
        angularDeflection: 0.5,
        positions: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        triangleIndices: [[0, 1, 2]],
        triangleFaceBindings: ["face_native_invariant_probe"],
      },
      diagnostics: [
        {
          code: "native-invariant-probe",
          severity: "warning",
          message: "Native invariant probe diagnostic.",
          target: null,
          detail: null,
        },
      ],
    };

    expectInvalidNativeShimPayload(
      { ...validPayload, counts: { faces: -1, edges: 1, vertices: 1 } },
      "Native shim parsing should reject negative topology counts.",
    );
    expectInvalidNativeShimPayload(
      { ...validPayload, counts: { faces: 1.5, edges: 1, vertices: 1 } },
      "Native shim parsing should reject fractional topology counts.",
    );
    expectInvalidNativeShimPayload(
      {
        ...validPayload,
        topology: [{ ...validPayload.topology[0], index: -1 }],
      },
      "Native shim parsing should reject negative topology indices.",
    );
    expectInvalidNativeShimPayload(
      {
        ...validPayload,
        topology: [{ ...validPayload.topology[0], id: "" }],
      },
      "Native shim parsing should reject empty topology ids.",
    );
    expectInvalidNativeShimPayload(
      {
        ...validPayload,
        mesh: { ...validPayload.mesh, triangleIndices: [[0, -1, 2]] },
      },
      "Native shim parsing should reject negative mesh triangle indices.",
    );
    expectInvalidNativeShimPayload(
      {
        ...validPayload,
        diagnostics: [{ ...validPayload.diagnostics[0], message: "" }],
      },
      "Native shim parsing should reject empty native diagnostic messages.",
    );
  }

  async function loadNativeOpenCascadeForTest() {
    const module = (await import("../../../../public/cadara-occ.js")) as {
      default: NativeOpenCascadeMainJSForTest;
    };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );

    return new module.default({ wasmBinary });
  }

  async function testNativeShimReturnsFlatTopologyAndMeshPayloads() {
    const oc = await loadNativeOpenCascadeForTest();
    const boxBuilder = new oc.BRepPrimAPI_MakeBox_2(1, 2, 3);
    const shape = boxBuilder.Shape();
    const bodyId = "body_native_payload_probe" as BodyId;
    const revisionId = "rev_native_payload_probe" as RevisionId;
    const topologyJson = oc.CadaraBuildNativeTopologyPayload?.BuildJson?.(
      shape,
      bodyId,
      "t_native",
      0.1,
      0.5,
    );
    const meshJson = oc.CadaraBuildNativeMeshExportPayload?.BuildJson?.(
      shape,
      0.1,
      0.5,
    );
    const exactBrepJson = oc.CadaraBuildNativeExactBrepPayload?.BuildJson?.(
      shape,
      bodyId,
      "t_native",
    );

    expect(
      typeof topologyJson,
      "Custom OCC build should expose native topology payload JSON.",
    ).toBe("string");
    expect(
      typeof meshJson,
      "Custom OCC build should expose native mesh payload JSON.",
    ).toBe("string");
    expect(
      typeof exactBrepJson,
      "Custom OCC build should expose native exact B-rep payload JSON.",
    ).toBe("string");

    const nativeTopology = parseNativeShimPayloadJson(topologyJson);
    const nativeMesh = parseNativeShimPayloadJson(meshJson);
    const nativeExactBrep = parseNativeShimPayloadJson(exactBrepJson);
    const topologyPayload = createOccNativeTopologyPayloadFromShimPayloads({
      revisionId,
      lodTierId: "fine",
      bodies: [
        {
          bodyId,
          nativePayload: nativeTopology,
        },
      ],
    });
    const meshAccuracy: MeshExportAccuracy = {
      chordTolerance: 0.1,
      angleToleranceRadians: 0.5,
    };
    const meshPayload = createOccNativeMeshExportPayloadFromShimPayload({
      revisionId,
      target: { kind: "body", bodyId },
      options: meshAccuracy,
      nativePayload: nativeMesh,
    });
    const exactBrepPayload = createOccNativeExactBrepPayloadFromShimPayload({
      revisionId,
      target: { kind: "body", bodyId },
      bodyId,
      bodyLabel: "Native payload probe",
      nativePayload: nativeExactBrep,
    });

    expect(
      nativeTopology.topology.length,
      "Box topology should be returned as one flat native record table.",
    ).toBe(26);
    expect(
      nativeTopology.edgeVertices.length,
      "Box edge endpoints should be returned in one flat native adjacency table.",
    ).toBe(12);
    expect(
      nativeTopology.vertexPoints?.length,
      "Box vertex points should be returned in one flat native point table.",
    ).toBe(8);
    expect(
      nativeTopology.faceEdges?.length,
      "Box face-edge adjacency should be returned in one flat native adjacency table.",
    ).toBe(6);
    expect(
      nativeTopology.mesh?.positions?.length,
      "Native topology payload should include flat render mesh positions.",
    ).toBe(24);
    expect(
      nativeTopology.mesh?.triangleIndices?.length,
      "Native topology payload should include flat render mesh triangle indices.",
    ).toBe(12);
    expect(
      nativeTopology.mesh?.triangleFaceBindings?.length,
      "Native topology payload should bind every render triangle to a face.",
    ).toBe(12);
    expect(
      topologyPayload.bodies[0]?.identity.length,
      "Payload identity should include the body plus native subshape records.",
    ).toBe(27);
    expect(
      topologyPayload.buffers.length >= 3,
      "Converted native topology payload should expose transferable mesh buffers.",
    ).toBeTruthy();
    expect(
      topologyPayload.bodies[0]?.renderMesh?.positions.byteLength,
      "Converted native topology payload should describe position data through a buffer-backed table.",
    ).toBe(24 * 3 * Float32Array.BYTES_PER_ELEMENT);
    expect(
      topologyPayload.bodies[0]?.renderMesh?.triangleIndices.byteLength,
      "Converted native topology payload should describe triangle indices through a buffer-backed table.",
    ).toBe(12 * 3 * Uint32Array.BYTES_PER_ELEMENT);
    expect(
      topologyPayload.bodies[0]?.renderMeshSummary?.positions?.length,
      "Converted native topology payload should retain render mesh positions from the shim payload.",
    ).toBe(24);
    expect(
      nativeExactBrep.cadaraBrep != null,
      "Native exact B-rep shim should return Cadara B-rep records directly.",
    ).toBeTruthy();
    expect(
      exactBrepPayload.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "occ-native-exact-brep-unsupported-topology",
      ),
      "Native exact B-rep payload should not diagnose oriented coedges as missing when the shim emits exact records.",
    ).toBeFalsy();
    expect(
      exactBrepPayload.brep.bodies[0]?.topology.faces.length,
      "Native exact B-rep payload should expose the box face topology from the shim.",
    ).toBe(6);
    expect(
      exactBrepPayload.brep.bodies[0]?.topology.vertices.length,
      "Native exact B-rep payload should expose box vertex points from the shim.",
    ).toBe(8);
    expect(
      exactBrepPayload.buffers.length,
      "Converted native exact B-rep payload should expose a transferable serialized exact payload buffer.",
    ).toBe(1);
    expect(
      exactBrepPayload.brep.bodies[0]?.topology.edges.length,
      "Native exact B-rep payload should expose box edge curves from the shim.",
    ).toBe(12);
    expect(
      exactBrepPayload.brep.bodies[0]?.topology.coedges.length,
      "Native exact B-rep payload should preserve oriented coedge order for each box face loop.",
    ).toBe(24);
    expect(
      exactBrepPayload.brep.bodies[0]?.topology.loops.length,
      "Native exact B-rep payload should expose one oriented loop per box face.",
    ).toBe(6);
    assertEveryLoopIsClosedAndConnected(
      exactBrepPayload.brep.bodies[0],
      "Native exact box B-rep payload",
    );
    expect(
      exactBrepPayload.tables.topology.faces.rowCount === 6 &&
        exactBrepPayload.tables.topology.coedges.rowCount === 24 &&
        exactBrepPayload.tables.curves.rowCount === 12 &&
        exactBrepPayload.tables.surfaces.rowCount === 6 &&
        exactBrepPayload.tables.trims.rowCount === 24,
      "Native exact B-rep payload table metadata should count topology, curves, surfaces, and trims.",
    ).toBeTruthy();
    expect(
      exactBrepPayload.brep.bodies[0]?.topology.edges.every(
        (edge) => edge.curve.kind === "line",
      ),
      "Native exact B-rep payload should preserve box edges as analytic lines.",
    ).toBeTruthy();
    expect(
      exactBrepPayload.brep.bodies[0]?.topology.faces.every(
        (face) => face.surface.kind === "plane",
      ),
      "Native exact B-rep payload should preserve box faces as analytic planes.",
    ).toBeTruthy();
    expect(
      exactBrepPayload.brep.bodies[0]?.topology.coedges.every(
        (coedge) => coedge.curve2d.kind === "line",
      ),
      "Native exact B-rep payload should preserve box 2D trim curves as analytic lines.",
    ).toBeTruthy();
    expect(
      topologyPayload.bodies[0]?.renderMeshSummary?.triangleCount,
      "Native topology payload should carry the shim mesh summary without JS face triangulation.",
    ).toBe(12);
    expect(
      meshPayload.meshSummary?.triangleCount,
      "Native mesh export payload should carry the shim mesh summary without JS face triangulation.",
    ).toBe(12);
    expect(
      meshPayload.buffers.length >= 3,
      "Converted native mesh export payload should expose transferable mesh buffers.",
    ).toBeTruthy();
    expect(
      meshPayload.mesh.triangleIndices.byteLength,
      "Converted native mesh export payload should describe export triangle indices through a buffer-backed table.",
    ).toBe(12 * 3 * Uint32Array.BYTES_PER_ELEMENT);
    expect(
      meshPayload.meshSummary?.triangleIndices?.length,
      "Converted native mesh export payload should retain flat triangle indices from the shim payload.",
    ).toBe(12);
    (shape as { delete?: () => void }).delete?.();
    boxBuilder.delete?.();
  }

  async function testNativeShimReturnsStructuredDiagnosticsForInvalidCommittedShapes() {
    const oc = await loadNativeOpenCascadeForTest();
    const shape = new oc.TopoDS_Shape();
    const bodyId = "body_invalid_native_payload_probe" as BodyId;
    const nativeTopology = parseNativeShimPayloadJson(
      oc.CadaraBuildNativeTopologyPayload.BuildJson(
        shape,
        bodyId,
        "t_invalid",
        0.1,
        0.5,
      ),
    );
    const topologyPayload = createOccNativeTopologyPayloadFromShimPayloads({
      revisionId: "rev_invalid_native_payload_probe" as RevisionId,
      lodTierId: "fine",
      bodies: [
        {
          bodyId,
          nativePayload: nativeTopology,
        },
      ],
    });

    expect(
      topologyPayload.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "occ-native-topology-invalid-shape" &&
          diagnostic.target?.kind === "body" &&
          diagnostic.target.bodyId === bodyId,
      ),
      "Native topology payload should surface invalid committed shapes as structured diagnostics.",
    ).toBeTruthy();

    shape.delete?.();
  }

  async function testNativeExactBrepExtractsCurvedTopologyInsteadOfFlatteningIt() {
    const oc = await loadNativeOpenCascadeForTest();
    const cylinderBuilder = new oc.BRepPrimAPI_MakeCylinder_1(1, 2);
    const shape = cylinderBuilder.Shape();
    const bodyId = "body_native_exact_curved_probe" as BodyId;
    const revisionId = "rev_native_exact_curved_probe" as RevisionId;
    const nativeExactBrep = parseNativeShimPayloadJson(
      oc.CadaraBuildNativeExactBrepPayload.BuildJson(
        shape,
        bodyId,
        "t_native_curved",
      ),
    );
    const exactBrepPayload = createOccNativeExactBrepPayloadFromShimPayload({
      revisionId,
      target: { kind: "body", bodyId },
      bodyId,
      bodyLabel: "Native exact curved probe",
      nativePayload: nativeExactBrep,
    });

    expect(
      exactBrepPayload.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "occ-native-exact-brep-unsupported-topology",
      ),
      "Native exact B-rep payload should return exact curved records instead of the old unsupported-topology diagnostic.",
    ).toBeFalsy();
    expect(
      exactBrepPayload.brep.bodies[0]?.topology.faces.some(
        (face) => face.surface.kind === "cylinder",
      ),
      "Native exact B-rep payload should preserve the cylinder side face as an analytic cylinder.",
    ).toBeTruthy();
    expect(
      exactBrepPayload.brep.bodies[0]?.topology.edges.some(
        (edge) => edge.curve.kind === "circle",
      ),
      "Native exact B-rep payload should preserve circular cylinder trim edges as analytic circles.",
    ).toBeTruthy();
    assertEveryLoopIsClosedAndConnected(
      exactBrepPayload.brep.bodies[0],
      "Native exact cylinder B-rep payload",
    );
    expect(
      exactBrepPayload.brep.bodies[0]?.topology.coedges.every(
        (coedge) =>
          coedge.curve2d.kind !== "polyline" &&
          coedge.curve2d.kind !== "unsupported",
      ),
      "Native exact B-rep payload should emit analytic 2D p-curves for cylinder coedges instead of sampled or unsupported trims.",
    ).toBeTruthy();
    expect(
      exactBrepPayload.brep.bodies[0]?.topology.coedges.some(
        (coedge) => coedge.curve2d.kind === "circle",
      ),
      "Native exact B-rep payload should preserve circular planar cylinder trims as 2D circles.",
    ).toBeTruthy();
    (shape as { delete?: () => void }).delete?.();
    cylinderBuilder.delete?.();
  }

  function testConvertedPayloadPreservesKernelOwnedIdentity() {
    const bodyId = "body_kernel_identity_probe" as BodyId;
    const payload = createOccNativeTopologyPayloadFromShimPayloads({
      revisionId: "rev_kernel_identity_probe" as RevisionId,
      lodTierId: "fine",
      bodies: [
        {
          bodyId,
          nativePayload: parseNativeShimPayloadJson(
            JSON.stringify({
              schemaVersion: "occ-native-topology-payload/v1alpha1",
              source: "occt7-shim",
              topology: [
                {
                  id: `face_${bodyId}_k12345`,
                  kernelUid: "occt7-shim:face:12345",
                  kind: "face",
                  bodyId,
                  index: 1,
                },
              ],
              edgeVertices: [],
              diagnostics: [],
            }),
          ),
        },
      ],
    });
    const faceIdentity = payload.bodies[0]?.identity.find(
      (identity) => identity.publicRef?.kind === "face",
    );

    expect(
      faceIdentity?.kernelUid,
      "Converted native topology payload should preserve kernel-owned identity separately from the public durable id.",
    ).toBe("occt7-shim:face:12345");
    expect(
      faceIdentity?.publicRef?.kind === "face" &&
        !faceIdentity.publicRef.faceId.includes("_t0001_"),
      "Converted native topology payload should allow fresh public ids that are not topology-token traversal ids.",
    ).toBeTruthy();
  }

  async function testNativeFeatureTransactionPreparesCommittedShapePayload() {
    const oc = await loadNativeOpenCascadeForTest();
    const boxBuilder = new oc.BRepPrimAPI_MakeBox_2(1, 2, 3);
    const shape = boxBuilder.Shape();
    const bodyId = "body_native_transaction_probe" as BodyId;
    const nativeTopology = parseNativeShimPayloadJson(
      oc.CadaraExecuteNativeFeatureTransaction.BuildCommittedShapePayload(
        shape,
        bodyId,
        "t_transaction",
        0.1,
        0.5,
      ),
    );
    const topologyPayload = createOccNativeTopologyPayloadFromShimPayloads({
      revisionId: "rev_native_transaction_probe" as RevisionId,
      lodTierId: "fine",
      bodies: [
        {
          bodyId,
          nativePayload: nativeTopology,
        },
      ],
    });

    expect(
      topologyPayload.diagnostics.length,
      "Native committed-shape transaction should accept a valid prepared solid without diagnostics.",
    ).toBe(0);
    expect(
      nativeTopology.topology.length,
      "Native committed-shape transaction should emit the prepared solid topology table.",
    ).toBe(26);
    expect(
      topologyPayload.bodies[0]?.renderMeshSummary?.triangleCount,
      "Native committed-shape transaction should mesh the prepared committed solid in the same payload.",
    ).toBe(12);
    (shape as { delete?: () => void }).delete?.();
    boxBuilder.delete?.();
  }

  async function testNativeBooleanTransactionBuildsCommittedPayload() {
    const oc = await loadNativeOpenCascadeForTest();
    const leftBuilder = new oc.BRepPrimAPI_MakeBox_2(2, 2, 2);
    const rightBuilder = new oc.BRepPrimAPI_MakeBox_2(2, 2, 2);
    const bodyId = "body_native_boolean_transaction_probe" as BodyId;
    const nativeTopology = parseNativeShimPayloadJson(
      oc.CadaraExecuteNativeFeatureTransaction.BuildBooleanCommittedShapePayload?.(
        leftBuilder.Shape(),
        rightBuilder.Shape(),
        "join",
        bodyId,
        "t_boolean_transaction",
        0.1,
        0.5,
      ) ?? "",
    );
    const topologyPayload = createOccNativeTopologyPayloadFromShimPayloads({
      revisionId: "rev_native_boolean_transaction_probe" as RevisionId,
      lodTierId: "fine",
      bodies: [
        {
          bodyId,
          nativePayload: nativeTopology,
        },
      ],
    });

    expect(
      topologyPayload.diagnostics.length,
      "Native boolean transaction should accept a valid join and emit no diagnostics.",
    ).toBe(0);
    expect(
      nativeTopology.topology.length,
      "Native boolean transaction should emit the committed boolean result topology table.",
    ).toBe(26);
    expect(
      topologyPayload.bodies[0]?.renderMeshSummary?.triangleCount,
      "Native boolean transaction should mesh the committed boolean result in the same payload.",
    ).toBe(12);

    leftBuilder.delete?.();
    rightBuilder.delete?.();
  }

  async function testNativeBooleanTransactionReturnsCommittedShapeResult() {
    const oc = await loadNativeOpenCascadeForTest();
    const leftBuilder = new oc.BRepPrimAPI_MakeBox_2(2, 2, 2);
    const rightBuilder = new oc.BRepPrimAPI_MakeBox_2(2, 2, 2);
    const bodyId = "body_native_boolean_transaction_result_probe" as BodyId;
    const result =
      oc.CadaraExecuteNativeFeatureTransaction.BuildBooleanCommittedShapeTransaction?.(
        leftBuilder.Shape(),
        rightBuilder.Shape(),
        "join",
        bodyId,
        "t_boolean_transaction_result",
        0.1,
        0.5,
      );

    expect(
      result != null,
      "Custom OCC build should expose native boolean transaction result objects.",
    ).toBeTruthy();
    const committedShape = result.Shape() as { IsNull: () => boolean };
    const nativeTopology = parseNativeShimPayloadJson(result.PayloadJson());
    const nativeHistory = parseNativeFeatureTransactionHistoryJson(
      result.HistoryJson(),
    );

    expect(
      result.IsDone(),
      "Native boolean transaction result should report success for a valid join.",
    ).toBeTruthy();
    expect(
      committedShape.IsNull(),
      "Native boolean transaction result should expose the committed shape.",
    ).toBeFalsy();
    expect(
      nativeTopology.diagnostics.length,
      "Native boolean transaction result payload should accept a valid join without diagnostics.",
    ).toBe(0);
    expect(
      nativeTopology.mesh?.triangleIndices?.length,
      "Native boolean transaction result payload should mesh the committed shape.",
    ).toBe(12);
    expect(
      nativeHistory.status,
      "Pre-8 native boolean transaction history should report available native successor records when the boolean builder provides history.",
    ).toBe("available");
    expect(
      nativeHistory.records.length,
      "Native boolean transaction history should include records for prior faces, edges, and vertices.",
    ).toBe(26);
    expect(
      nativeHistory.records.some(
        (record) =>
          record.reason === "unique-successor" &&
          record.successors.length === 1,
      ),
      "Native boolean transaction history should identify unique successors for stable topology.",
    ).toBeTruthy();
    expect(
      createOccNativeReferenceInvalidationsFromHistoryPayload(nativeHistory)
        .length,
      "Unique native boolean successors should not produce invalidation payload records.",
    ).toBe(0);

    leftBuilder.delete?.();
    rightBuilder.delete?.();
  }

  async function testNativeMeshPayloadPreservesFaceOrientation() {
    const oc = await loadNativeOpenCascadeForTest();
    const boxBuilder = new oc.BRepPrimAPI_MakeBox_2(1, 2, 3);
    const shape = boxBuilder.Shape();
    const bodyId = "body_native_mesh_orientation_probe" as BodyId;
    const nativeTopology = parseNativeShimPayloadJson(
      oc.CadaraBuildNativeTopologyPayload.BuildJson(
        shape,
        bodyId,
        "t_native_orientation",
        0.1,
        0.5,
      ),
    );
    const positions = nativeTopology.mesh?.positions;
    const triangleIndices = nativeTopology.mesh?.triangleIndices;

    expect(
      positions != null,
      "Native mesh orientation test requires native mesh positions.",
    ).toBeTruthy();
    expect(
      triangleIndices != null,
      "Native mesh orientation test requires native mesh triangle indices.",
    ).toBeTruthy();

    const center: Point3 = [0.5, 1, 1.5];
    let outwardTriangleCount = 0;

    for (const triangle of triangleIndices ?? []) {
      const first = positions?.[triangle[0]];
      const second = positions?.[triangle[1]];
      const third = positions?.[triangle[2]];

      expect(
        first != null && second != null && third != null,
        "Native mesh triangle should reference existing vertices.",
      ).toBeTruthy();

      const normal = cross(subtract(second, first), subtract(third, first));
      const triangleCenter = scale(add(add(first, second), third), 1 / 3);
      const outward = subtract(triangleCenter, center);

      expect(
        dot(normal, outward) > 0,
        "Native mesh payload should preserve outward triangle winding for reversed OCC faces.",
      ).toBeTruthy();
      outwardTriangleCount += 1;
    }

    expect(
      outwardTriangleCount,
      "Native mesh orientation test should check every box triangle.",
    ).toBe(12);
    (shape as { delete?: () => void }).delete?.();
    boxBuilder.delete?.();
  }

  testNativeShimPayloadRejectsMalformedPrimitiveInvariants();
  await testNativeShimReturnsFlatTopologyAndMeshPayloads();
  await testNativeShimReturnsStructuredDiagnosticsForInvalidCommittedShapes();
  await testNativeExactBrepExtractsCurvedTopologyInsteadOfFlatteningIt();
  testConvertedPayloadPreservesKernelOwnedIdentity();
  await testNativeFeatureTransactionPreparesCommittedShapePayload();
  await testNativeBooleanTransactionBuildsCommittedPayload();
  await testNativeBooleanTransactionReturnsCommittedShapeResult();
  await testNativeMeshPayloadPreservesFaceOrientation();
});

function subtract(left: Point3, right: Point3): Point3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function add(left: Point3, right: Point3): Point3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function scale(point: Point3, factor: number): Point3 {
  return [point[0] * factor, point[1] * factor, point[2] * factor];
}

function cross(left: Point3, right: Point3): Point3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: Point3, right: Point3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}
