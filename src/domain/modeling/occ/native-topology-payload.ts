import typia, { type tags } from "typia";

import type { MeshExportAccuracy } from "@/contracts/export/capabilities";
import type {
  CadaraBrepGeometryAssetData,
  CadaraBrepTopologyRecord,
} from "@/contracts/modeling/geometry-assets";
import type {
  BodyId,
  CoedgeId,
  EdgeId,
  FaceId,
  FeatureId,
  LoopId,
  RevisionId,
  VertexId,
} from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { OccTessellationTierId } from "@/domain/modeling/occ/tessellation";

export const OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION =
  "occ-native-topology-payload/v1alpha1";

export const OCC_NATIVE_TOPOLOGY_KERNEL_ENTRYPOINTS = [
  "CadaraNativeTopologyProbe",
  "CadaraBuildNativeTopologyPayload",
  "CadaraExecuteNativeFeatureTransaction",
  "CadaraBuildNativeExactBrepPayload",
  "CadaraBuildNativeMeshExportPayload",
] as const;

export type OccNativeTopologyKernelEntrypoint =
  (typeof OCC_NATIVE_TOPOLOGY_KERNEL_ENTRYPOINTS)[number];

type OccNativeNonEmptyString = string & tags.Pattern<"^.*\\S.*$">;
type OccNativeNonNegativeInteger = number & tags.Type<"uint64">;
type OccNativePositiveNumber = number & tags.ExclusiveMinimum<0>;
type OccNativeTriangleIndex = readonly [
  OccNativeNonNegativeInteger,
  OccNativeNonNegativeInteger,
  OccNativeNonNegativeInteger,
];

export interface OpenCascadeNativeTopologyKernelHost {
  CadaraNativeTopologyProbe?: {
    SchemaVersion?: () => string;
    HasPre8Shim?: () => boolean;
    SummarizeShape?: (shape: unknown) => string;
  };
  CadaraBuildNativeTopologyPayload?: {
    BuildJson?: (
      shape: unknown,
      bodyId: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => string;
  };
  CadaraExecuteNativeFeatureTransaction?: {
    BuildCommittedShapePayload?: (
      shape: unknown,
      bodyId: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => string;
    BuildBooleanCommittedShapePayload?: (
      left: unknown,
      right: unknown,
      operation: "join" | "cut" | "intersect",
      bodyId: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => string;
    BuildBooleanCommittedShapeTransaction?: (
      left: unknown,
      right: unknown,
      operation: "join" | "cut" | "intersect",
      bodyId: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult;
    BuildBooleanCommittedShapeTransactionWithHistory?: (
      left: unknown,
      right: unknown,
      operation: "join" | "cut" | "intersect",
      bodyId: string,
      previousTopologyToken: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult;
    BuildSplitCommittedShapeTransactionWithHistory?: (
      target: unknown,
      tool: unknown,
      bodyId: string,
      previousTopologyToken: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult;
    BuildSheetSplitCommittedShapeTransactionWithToolHistory?: (
      target: unknown,
      tool: unknown,
      targetBodyId: string,
      toolBodyId: string,
      previousTopologyToken: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult;
    BuildFilletCommittedShapeTransactionWithHistory?: (
      shape: unknown,
      edgeIdsCsv: string,
      radius: number,
      bodyId: string,
      previousTopologyToken: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult;
    BuildChamferCommittedShapeTransactionWithHistory?: (
      shape: unknown,
      edgeIdsCsv: string,
      distance: number,
      bodyId: string,
      previousTopologyToken: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult;
    BuildShellCommittedShapeTransactionWithHistory?: (
      shape: unknown,
      faceIdsCsv: string,
      signedThickness: number,
      bodyId: string,
      previousTopologyToken: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult;
    BuildTransformCommittedShapeTransactionWithHistory?: (
      shape: unknown,
      transform: unknown,
      copy: boolean,
      bodyId: string,
      previousTopologyToken: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult;
  };
  CadaraBuildNativeExactBrepPayload?: {
    BuildJson?: (
      shape: unknown,
      bodyId: string,
      topologyToken: string,
    ) => string;
  };
  CadaraBuildNativeMeshExportPayload?: {
    BuildJson?: (
      shape: unknown,
      linearDeflection: number,
      angularDeflection: number,
    ) => string;
  };
}

export interface OpenCascadeNativeFeatureTransactionResult {
  Shape: () => unknown;
  PayloadJson: () => string;
  HistoryJson: () => string;
  /** Present only on the additive sheet-split tool-history transaction ABI. */
  SplitToolHistoryJson?: () => string;
  /** Present only on the additive Boolean operand-history transaction ABI. */
  BooleanOperandHistoryJson?: () => string;
  IsDone: () => boolean;
  delete: () => void;
}

export type OccNativeTopologyKind =
  | "body"
  | "solid"
  | "shell"
  | "face"
  | "loop"
  | "coedge"
  | "edge"
  | "vertex";

export type OccNativeTopologyId =
  | BodyId
  | `occ_solid_${string}`
  | `occ_shell_${string}`
  | FaceId
  | LoopId
  | CoedgeId
  | EdgeId
  | VertexId;

export type OccNativeIdentitySource = "occt7-shim" | "brepgraph";

export type OccNativeBufferScalar =
  | "uint8"
  | "uint16"
  | "uint32"
  | "int32"
  | "float32"
  | "float64";

export interface OccNativeBufferRef {
  bufferId: `occ_buffer_${string}`;
  scalar: OccNativeBufferScalar;
  byteOffset: number;
  byteLength: number;
  itemStride: number;
}

export interface OccNativeTransferableBuffer {
  bufferId: OccNativeBufferRef["bufferId"];
  buffer: ArrayBuffer;
}

export interface OccNativeTableLayout {
  rowCount: number;
  columns: Record<string, OccNativeBufferRef>;
}

export interface OccNativeTopologyTableLayout {
  bodies: OccNativeTableLayout;
  solids: OccNativeTableLayout;
  shells: OccNativeTableLayout;
  faces: OccNativeTableLayout;
  loops: OccNativeTableLayout;
  coedges: OccNativeTableLayout;
  edges: OccNativeTableLayout;
  vertices: OccNativeTableLayout;
}

export interface OccNativeIdentityTableLayout {
  topologyToKernelIdentity: OccNativeTableLayout;
  kernelHistorySuccessors: OccNativeTableLayout;
  publicReferenceBindings: OccNativeTableLayout;
}

export interface OccNativeAdjacencyTableLayout {
  faceLoops: OccNativeTableLayout;
  loopCoedges: OccNativeTableLayout;
  edgeVertices: OccNativeTableLayout;
  coedgeOpposites: OccNativeTableLayout;
  faceEdges: OccNativeTableLayout;
  vertexEdges: OccNativeTableLayout;
}

export interface OccNativeMeshTableLayout {
  positions: OccNativeBufferRef;
  normals: OccNativeBufferRef;
  triangleIndices: OccNativeBufferRef;
  triangleFaceBindings: OccNativeBufferRef;
}

export interface OccNativeExactBrepTableLayout {
  topology: OccNativeTopologyTableLayout;
  curves: OccNativeTableLayout;
  surfaces: OccNativeTableLayout;
  trims: OccNativeTableLayout;
  fallbackTriangles: OccNativeMeshTableLayout | null;
}

export interface OccNativeDiagnosticTableLayout {
  diagnostics: OccNativeTableLayout;
  targetBindings: OccNativeTableLayout | null;
}

export interface OccNativeTopologyRecord {
  id: OccNativeTopologyId;
  kind: OccNativeTopologyKind;
  bodyId: BodyId;
  parentId: OccNativeTopologyId | null;
  kernelUid: string;
}

export interface OccNativeKernelIdentityRecord {
  topologyId: OccNativeTopologyId;
  source: OccNativeIdentitySource;
  kernelUid: string;
  publicRef: DurableRef | null;
}

export type OccNativeReferenceInvalidationReason =
  | "deleted"
  | "ambiguous"
  | "unsupported-history"
  | "invalid-result"
  | "unsafe-repair";

export interface OccNativeReferenceInvalidation {
  target: DurableRef;
  reason: OccNativeReferenceInvalidationReason;
  successors: readonly DurableRef[];
  featureId: FeatureId | null;
  message: string;
}

export interface OccNativeTopologyDiagnostic {
  code: OccNativeNonEmptyString;
  severity: "info" | "warning" | "error";
  message: OccNativeNonEmptyString;
  target: DurableRef | null;
  detail: Record<string, unknown> | null;
}

export const OCC_NATIVE_FEATURE_TRANSACTION_HISTORY_SCHEMA_VERSION =
  "occ-native-history-payload/v1alpha1";

export interface OccNativeFeatureTransactionHistoryPayload {
  schemaVersion: typeof OCC_NATIVE_FEATURE_TRANSACTION_HISTORY_SCHEMA_VERSION;
  source: OccNativeIdentitySource;
  status: "available" | "unsupported";
  operation?: OccNativeNonEmptyString;
  bodyId?: BodyId;
  previousTopologyToken?: OccNativeNonEmptyString;
  topologyToken?: OccNativeNonEmptyString;
  records: readonly OccNativeFeatureTransactionHistoryRecord[];
  diagnostics: readonly OccNativeTopologyDiagnostic[];
}

export type OccNativeFeatureTransactionHistoryReason =
  | "unique-successor"
  | "ambiguous"
  | "deleted"
  | "generated"
  | "missing";

export const OCC_NATIVE_SHEET_SPLIT_TOOL_HISTORY_SCHEMA_VERSION =
  "occ-native-sheet-split-tool-history-payload/v1alpha1";

export interface OccNativeSheetSplitToolHistoryOutput {
  outputSlotKey: OccNativeNonEmptyString;
  sourceTargetFaceNativeIds: readonly OccNativeNonEmptyString[];
  finalFaceNativeIds: readonly OccNativeNonEmptyString[];
}

export interface OccNativeSheetSplitToolFaceRelation {
  sourceToolFace: {
    bodyId: BodyId;
    nativeFaceId: OccNativeNonEmptyString;
  };
  cardinality: "zero" | "one" | "many";
  finalFaces: readonly {
    nativeFaceId: OccNativeNonEmptyString;
    outputSlotKeys: readonly OccNativeNonEmptyString[];
  }[];
}

/**
 * Exact output-slot and tool-face provenance emitted only by
 * `BuildSheetSplitCommittedShapeTransactionWithToolHistory`.
 *
 * This deliberately does not infer solid membership from geometry: every
 * final-face id declares every native output slot that contains it. A physical
 * split-interface face may therefore belong to more than one output slot.
 */
export interface OccNativeSheetSplitToolHistoryPayload {
  schemaVersion: typeof OCC_NATIVE_SHEET_SPLIT_TOOL_HISTORY_SCHEMA_VERSION;
  source: "occt7-shim";
  status: "available" | "unsupported";
  targetBodyId: BodyId;
  toolBodyId: BodyId;
  previousTopologyToken: OccNativeNonEmptyString;
  topologyToken: OccNativeNonEmptyString;
  outputs: readonly OccNativeSheetSplitToolHistoryOutput[];
  toolFaceRelations: readonly OccNativeSheetSplitToolFaceRelation[];
  diagnostics: readonly OccNativeTopologyDiagnostic[];
}

export const OCC_NATIVE_BOOLEAN_OPERAND_HISTORY_SCHEMA_VERSION =
  "occ-native-boolean-operand-history-payload/v1alpha1";

export interface OccNativeBooleanOperandHistoryFinalFace {
  nativeFaceId: OccNativeNonEmptyString;
  leftSourceFaceNativeIds: readonly OccNativeNonEmptyString[];
  rightSourceFaceNativeIds: readonly OccNativeNonEmptyString[];
}

/** Exact Boolean operand incidence; native ids are transaction-local only. */
export interface OccNativeBooleanOperandHistoryPayload {
  schemaVersion: typeof OCC_NATIVE_BOOLEAN_OPERAND_HISTORY_SCHEMA_VERSION;
  source: "occt7-shim";
  status: "available" | "unsupported";
  operation: "join" | "cut" | "intersect";
  bodyId: BodyId;
  previousTopologyToken: OccNativeNonEmptyString;
  topologyToken: OccNativeNonEmptyString;
  finalFaces: readonly OccNativeBooleanOperandHistoryFinalFace[];
  diagnostics: readonly OccNativeTopologyDiagnostic[];
}

export interface OccNativeFeatureTransactionHistoryRecord {
  target: DurableRef;
  reason: OccNativeFeatureTransactionHistoryReason;
  successors: readonly DurableRef[];
}

export interface OccNativeTopologyBodyPayload {
  bodyId: BodyId;
  topology: readonly OccNativeTopologyRecord[];
  identity: readonly OccNativeKernelIdentityRecord[];
  adjacency: OccNativeAdjacencyTableLayout;
  renderMesh: OccNativeMeshTableLayout | null;
  renderMeshSummary?: OccNativeShimMeshSummary | null;
  exactBrep: OccNativeExactBrepTableLayout | null;
  invalidations: readonly OccNativeReferenceInvalidation[];
}

export interface OccNativeTopologyPayload {
  schemaVersion: typeof OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION;
  source: OccNativeIdentitySource;
  revisionId: RevisionId;
  lodTierId: OccTessellationTierId | null;
  bodies: readonly OccNativeTopologyBodyPayload[];
  tables: {
    topology: OccNativeTopologyTableLayout;
    identity: OccNativeIdentityTableLayout;
    diagnostics: OccNativeDiagnosticTableLayout;
  };
  buffers: readonly OccNativeTransferableBuffer[];
  diagnostics: readonly OccNativeTopologyDiagnostic[];
}

export interface OccNativeExactBrepPayload {
  schemaVersion: typeof OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION;
  revisionId: RevisionId;
  target: DurableRef;
  brep: CadaraBrepGeometryAssetData;
  tables: OccNativeExactBrepTableLayout;
  buffers: readonly OccNativeTransferableBuffer[];
  diagnostics: readonly OccNativeTopologyDiagnostic[];
}

export interface OccNativeMeshExportPayload {
  schemaVersion: typeof OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION;
  revisionId: RevisionId;
  target: DurableRef;
  options: MeshExportAccuracy;
  mesh: OccNativeMeshTableLayout;
  meshSummary?: OccNativeShimMeshSummary | null;
  buffers: readonly OccNativeTransferableBuffer[];
  diagnostics: readonly OccNativeTopologyDiagnostic[];
}

export interface OccNativeTopologyCapabilityProbeResult {
  kind: "available" | "missing";
  requiredEntrypoints: readonly OccNativeTopologyKernelEntrypoint[];
  missingEntrypoints: readonly OccNativeTopologyKernelEntrypoint[];
  diagnostics: readonly OccNativeTopologyDiagnostic[];
}

export interface OccNativeShimMeshSummary {
  nodeCount: OccNativeNonNegativeInteger;
  triangleCount: OccNativeNonNegativeInteger;
  linearDeflection: OccNativePositiveNumber;
  angularDeflection: OccNativePositiveNumber;
  positions?: readonly (readonly [number, number, number])[];
  triangleIndices?: readonly OccNativeTriangleIndex[];
  triangleFaceBindings?: readonly OccNativeNonEmptyString[];
}

export interface OccNativeShimVertexPointRecord {
  vertexId: OccNativeNonEmptyString;
  point: readonly [number, number, number];
}

export interface OccNativeShimFaceEdgeRecord {
  faceId: OccNativeNonEmptyString;
  edgeIds: readonly OccNativeNonEmptyString[] & tags.MinItems<1>;
}

export interface OccNativeShimTopologyRecord {
  id: OccNativeNonEmptyString;
  kernelUid?: OccNativeNonEmptyString;
  kind: "face" | "edge" | "vertex";
  bodyId: OccNativeNonEmptyString;
  index: OccNativeNonNegativeInteger;
}

export interface OccNativeShimEdgeVertexRecord {
  edgeId: OccNativeNonEmptyString;
  start: readonly [number, number, number];
  end: readonly [number, number, number];
}

export interface OccNativeShimPayload {
  schemaVersion: typeof OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION;
  source: "occt7-shim";
  bodyId?: OccNativeNonEmptyString;
  topologyToken?: OccNativeNonEmptyString;
  counts?: {
    faces: OccNativeNonNegativeInteger;
    edges: OccNativeNonNegativeInteger;
    vertices: OccNativeNonNegativeInteger;
  };
  topology: OccNativeShimTopologyRecord[];
  edgeVertices: OccNativeShimEdgeVertexRecord[];
  vertexPoints: OccNativeShimVertexPointRecord[];
  faceEdges: OccNativeShimFaceEdgeRecord[];
  cadaraBrep?: CadaraBrepGeometryAssetData;
  mesh?: OccNativeShimMeshSummary;
  diagnostics: OccNativeTopologyDiagnostic[];
}

type OccNativeShimPayloadRaw = Omit<
  OccNativeShimPayload,
  "topology" | "edgeVertices" | "vertexPoints" | "faceEdges" | "diagnostics"
> &
  Partial<
    Pick<
      OccNativeShimPayload,
      "topology" | "edgeVertices" | "vertexPoints" | "faceEdges" | "diagnostics"
    >
  >;

type OccNativeFeatureTransactionHistoryPayloadRaw = Omit<
  OccNativeFeatureTransactionHistoryPayload,
  "records" | "diagnostics"
> &
  Partial<
    Pick<OccNativeFeatureTransactionHistoryPayload, "records" | "diagnostics">
  >;

const nativeShimPayloadValidator =
  typia.createValidateEquals<OccNativeShimPayloadRaw>();
const nativeFeatureTransactionHistoryPayloadValidator =
  typia.createValidateEquals<OccNativeFeatureTransactionHistoryPayloadRaw>();
const nativeSheetSplitToolHistoryPayloadValidator =
  typia.createValidateEquals<OccNativeSheetSplitToolHistoryPayload>();
const nativeBooleanOperandHistoryPayloadValidator =
  typia.createValidateEquals<OccNativeBooleanOperandHistoryPayload>();

const emptyBuffer = new ArrayBuffer(0);

function emptyBufferRef(
  suffix: string,
  scalar: OccNativeBufferScalar,
): OccNativeBufferRef {
  return {
    bufferId: `occ_buffer_empty_${suffix}` as OccNativeBufferRef["bufferId"],
    scalar,
    byteOffset: 0,
    byteLength: 0,
    itemStride: 0,
  };
}

function emptyTableLayout(rowCount = 0): OccNativeTableLayout {
  return {
    rowCount,
    columns: {},
  };
}

function createTopologyTableLayout(
  counts: {
    bodies?: number;
    solids?: number;
    shells?: number;
    faces?: number;
    loops?: number;
    coedges?: number;
    edges?: number;
    vertices?: number;
  } = {},
): OccNativeTopologyTableLayout {
  return {
    bodies: emptyTableLayout(counts.bodies ?? 0),
    solids: emptyTableLayout(counts.solids ?? 0),
    shells: emptyTableLayout(counts.shells ?? 0),
    faces: emptyTableLayout(counts.faces ?? 0),
    loops: emptyTableLayout(counts.loops ?? 0),
    coedges: emptyTableLayout(counts.coedges ?? 0),
    edges: emptyTableLayout(counts.edges ?? 0),
    vertices: emptyTableLayout(counts.vertices ?? 0),
  };
}

function createIdentityTableLayout(rowCount = 0): OccNativeIdentityTableLayout {
  return {
    topologyToKernelIdentity: emptyTableLayout(rowCount),
    kernelHistorySuccessors: emptyTableLayout(),
    publicReferenceBindings: emptyTableLayout(rowCount),
  };
}

function createAdjacencyTableLayout(
  edgeVertexCount = 0,
): OccNativeAdjacencyTableLayout {
  return {
    faceLoops: emptyTableLayout(),
    loopCoedges: emptyTableLayout(),
    edgeVertices: emptyTableLayout(edgeVertexCount),
    coedgeOpposites: emptyTableLayout(),
    faceEdges: emptyTableLayout(),
    vertexEdges: emptyTableLayout(),
  };
}

function createMeshTableLayout(): OccNativeMeshTableLayout {
  return {
    positions: emptyBufferRef("positions", "float32"),
    normals: emptyBufferRef("normals", "float32"),
    triangleIndices: emptyBufferRef("triangle_indices", "uint32"),
    triangleFaceBindings: emptyBufferRef("triangle_face_bindings", "uint32"),
  };
}

function transferArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy.buffer;
}

function createBufferRef(
  suffix: string,
  scalar: OccNativeBufferScalar,
  view: ArrayBufferView,
  itemStride: number,
): { ref: OccNativeBufferRef; transferable: OccNativeTransferableBuffer } {
  const bufferId = `occ_buffer_${suffix}` as OccNativeBufferRef["bufferId"];
  const buffer = transferArrayBuffer(view);

  return {
    ref: {
      bufferId,
      scalar,
      byteOffset: 0,
      byteLength: buffer.byteLength,
      itemStride,
    },
    transferable: {
      bufferId,
      buffer,
    },
  };
}

function packMeshSummaryBuffers(
  mesh: OccNativeShimMeshSummary | null | undefined,
  suffix: string,
  faceIds: readonly string[] = [],
): {
  layout: OccNativeMeshTableLayout;
  buffers: OccNativeTransferableBuffer[];
} {
  if (!mesh) {
    return {
      layout: createMeshTableLayout(),
      buffers: [],
    };
  }

  const buffers: OccNativeTransferableBuffer[] = [];
  const positions = new Float32Array((mesh.positions?.length ?? 0) * 3);
  mesh.positions?.forEach((point, index) => {
    positions[index * 3] = point[0];
    positions[index * 3 + 1] = point[1];
    positions[index * 3 + 2] = point[2];
  });

  const triangleIndices = new Uint32Array(
    (mesh.triangleIndices?.length ?? 0) * 3,
  );
  mesh.triangleIndices?.forEach((triangle, index) => {
    triangleIndices[index * 3] = triangle[0];
    triangleIndices[index * 3 + 1] = triangle[1];
    triangleIndices[index * 3 + 2] = triangle[2];
  });

  const faceIndexById = new Map(
    faceIds.map((faceId, index) => [faceId, index]),
  );
  const fallbackFaceIndexById = new Map<string, number>();
  const triangleFaceBindings = new Uint32Array(
    mesh.triangleFaceBindings?.length ?? 0,
  );
  mesh.triangleFaceBindings?.forEach((faceId, index) => {
    const explicitIndex = faceIndexById.get(faceId);
    if (explicitIndex !== undefined) {
      triangleFaceBindings[index] = explicitIndex;
      return;
    }

    const fallbackIndex =
      fallbackFaceIndexById.get(faceId) ?? fallbackFaceIndexById.size;
    fallbackFaceIndexById.set(faceId, fallbackIndex);
    triangleFaceBindings[index] = fallbackIndex;
  });

  const packedPositions = createBufferRef(
    `${suffix}_positions`,
    "float32",
    positions,
    3,
  );
  const packedTriangleIndices = createBufferRef(
    `${suffix}_triangle_indices`,
    "uint32",
    triangleIndices,
    3,
  );
  const packedTriangleFaceBindings = createBufferRef(
    `${suffix}_triangle_face_bindings`,
    "uint32",
    triangleFaceBindings,
    1,
  );
  buffers.push(
    packedPositions.transferable,
    packedTriangleIndices.transferable,
    packedTriangleFaceBindings.transferable,
  );

  return {
    layout: {
      positions: packedPositions.ref,
      normals: emptyBufferRef(`${suffix}_normals`, "float32"),
      triangleIndices: packedTriangleIndices.ref,
      triangleFaceBindings: packedTriangleFaceBindings.ref,
    },
    buffers,
  };
}

function createJsonTransferableBuffer(
  suffix: string,
  value: unknown,
): OccNativeTransferableBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  return {
    bufferId: `occ_buffer_${suffix}` as OccNativeBufferRef["bufferId"],
    buffer: transferArrayBuffer(encoded),
  };
}

function createExactBrepTableLayout(
  topology: OccNativeTopologyTableLayout,
): OccNativeExactBrepTableLayout {
  return {
    topology,
    curves: emptyTableLayout(),
    surfaces: emptyTableLayout(),
    trims: emptyTableLayout(),
    fallbackTriangles: null,
  };
}

function createExactBrepTableLayoutFromCadaraBrep(
  brep: CadaraBrepGeometryAssetData,
): OccNativeExactBrepTableLayout {
  const counts = brep.bodies.reduce(
    (nextCounts, body) => {
      nextCounts.solids += body.topology.solids.length;
      nextCounts.shells += body.topology.shells.length;
      nextCounts.faces += body.topology.faces.length;
      nextCounts.loops += body.topology.loops.length;
      nextCounts.coedges += body.topology.coedges.length;
      nextCounts.edges += body.topology.edges.length;
      nextCounts.vertices += body.topology.vertices.length;
      return nextCounts;
    },
    {
      bodies: brep.bodies.length,
      solids: 0,
      shells: 0,
      faces: 0,
      loops: 0,
      coedges: 0,
      edges: 0,
      vertices: 0,
    },
  );

  return {
    topology: createTopologyTableLayout(counts),
    curves: emptyTableLayout(counts.edges),
    surfaces: emptyTableLayout(counts.faces),
    trims: emptyTableLayout(counts.coedges),
    fallbackTriangles: null,
  };
}

function createEmptyCadaraBrepTopology(): CadaraBrepTopologyRecord {
  return {
    vertices: [],
    edges: [],
    coedges: [],
    loops: [],
    faces: [],
    shells: [],
    solids: [],
  };
}

function createNativeExactBrepUnsupportedDiagnostic(
  nativePayload: OccNativeShimPayload,
  target: DurableRef,
): OccNativeTopologyDiagnostic | null {
  const hasNativeTopology = nativePayload.topology.length > 0;

  if (!hasNativeTopology) {
    return null;
  }

  return createNativeTopologyDiagnostic(
    "occ-native-exact-brep-unsupported-topology",
    "Native exact B-rep payload lacks oriented wires, coedges, and real OCC curve/surface records required to emit valid Cadara B-rep topology.",
    {
      reason: "missing-oriented-coedges",
      nativeFaces:
        nativePayload.counts?.faces ??
        nativePayload.topology.filter((entry) => entry.kind === "face").length,
      nativeEdges:
        nativePayload.counts?.edges ??
        nativePayload.topology.filter((entry) => entry.kind === "edge").length,
      nativeVertices:
        nativePayload.counts?.vertices ??
        nativePayload.topology.filter((entry) => entry.kind === "vertex")
          .length,
      nativeFaceEdgeRecords: nativePayload.faceEdges.length,
      nativeMeshTriangles: nativePayload.mesh?.triangleCount ?? 0,
    },
    target,
  );
}

function createDiagnosticTableLayout(
  rowCount = 0,
): OccNativeDiagnosticTableLayout {
  return {
    diagnostics: emptyTableLayout(rowCount),
    targetBindings: null,
  };
}

export function createNativeTopologyDiagnostic(
  code: string,
  message: string,
  detail: Record<string, unknown> | null = null,
  target: DurableRef | null = null,
): OccNativeTopologyDiagnostic {
  return {
    code: code as OccNativeNonEmptyString,
    severity: "error",
    message: message as OccNativeNonEmptyString,
    target,
    detail,
  };
}

function nativeTopologyRecordToPublicRef(
  record: OccNativeTopologyRecord,
): DurableRef | null {
  switch (record.kind) {
    case "face":
      return {
        kind: "face",
        bodyId: record.bodyId,
        faceId: record.id as FaceId,
      };
    case "edge":
      return {
        kind: "edge",
        bodyId: record.bodyId,
        edgeId: record.id as EdgeId,
      };
    case "vertex":
      return {
        kind: "vertex",
        bodyId: record.bodyId,
        vertexId: record.id as VertexId,
      };
    case "body":
      return {
        kind: "body",
        bodyId: record.bodyId,
      };
    default:
      return null;
  }
}

function createIdentityRecords(
  topology: readonly OccNativeTopologyRecord[],
): OccNativeKernelIdentityRecord[] {
  return topology.map((record) => ({
    topologyId: record.id,
    source: "occt7-shim",
    kernelUid: record.kernelUid,
    publicRef: nativeTopologyRecordToPublicRef(record),
  }));
}

function countTopologyKinds(topology: readonly OccNativeTopologyRecord[]) {
  const counts = {
    bodies: 0,
    solids: 0,
    shells: 0,
    faces: 0,
    loops: 0,
    coedges: 0,
    edges: 0,
    vertices: 0,
  };

  for (const record of topology) {
    switch (record.kind) {
      case "body":
        counts.bodies += 1;
        break;
      case "solid":
        counts.solids += 1;
        break;
      case "shell":
        counts.shells += 1;
        break;
      case "face":
        counts.faces += 1;
        break;
      case "loop":
        counts.loops += 1;
        break;
      case "coedge":
        counts.coedges += 1;
        break;
      case "edge":
        counts.edges += 1;
        break;
      case "vertex":
        counts.vertices += 1;
        break;
    }
  }

  return counts;
}

function invariantFailure(path: string, message: string): Error {
  return new Error(`${path}: ${message}`);
}

function assertFiniteNumber(value: number, path: string) {
  if (!Number.isFinite(value)) {
    throw invariantFailure(path, "must be a finite number.");
  }
}

function assertPoint3(point: readonly [number, number, number], path: string) {
  assertFiniteNumber(point[0], `${path}.0`);
  assertFiniteNumber(point[1], `${path}.1`);
  assertFiniteNumber(point[2], `${path}.2`);
}

function assertNativeShimMeshSummaryInvariants(
  mesh: OccNativeShimMeshSummary | undefined,
  path: string,
) {
  if (!mesh) {
    return;
  }

  mesh.positions?.forEach((point, index) => {
    assertPoint3(point, `${path}.positions.${index}`);
  });
  mesh.triangleIndices?.forEach((triangle, index) => {
    if (mesh.positions && mesh.positions.length > 0) {
      const maxIndex = mesh.positions.length - 1;
      if (
        triangle[0] > maxIndex ||
        triangle[1] > maxIndex ||
        triangle[2] > maxIndex
      ) {
        throw invariantFailure(
          `${path}.triangleIndices.${index}`,
          "must reference existing mesh positions.",
        );
      }
    }
  });
  if (
    mesh.triangleIndices &&
    mesh.triangleFaceBindings &&
    mesh.triangleFaceBindings.length !== mesh.triangleIndices.length
  ) {
    throw invariantFailure(
      `${path}.triangleFaceBindings`,
      "must align 1:1 with triangle indices.",
    );
  }
}

function assertNativeShimPayloadInvariants(payload: OccNativeShimPayload) {
  payload.edgeVertices.forEach((record, index) => {
    assertPoint3(record.start, `edgeVertices.${index}.start`);
    assertPoint3(record.end, `edgeVertices.${index}.end`);
  });
  payload.vertexPoints.forEach((record, index) => {
    assertPoint3(record.point, `vertexPoints.${index}.point`);
  });
  assertNativeShimMeshSummaryInvariants(payload.mesh, "mesh");
}

function createBodyTopologyRecords(
  bodyId: BodyId,
  nativePayload: OccNativeShimPayload,
): OccNativeTopologyRecord[] {
  return [
    {
      id: bodyId,
      kind: "body",
      bodyId,
      parentId: null,
      kernelUid: `occt7-shim:body:${bodyId}`,
    },
    ...nativePayload.topology.map(
      (record) =>
        ({
          id: record.id as OccNativeTopologyId,
          kind: record.kind,
          bodyId: record.bodyId as BodyId,
          parentId: bodyId,
          kernelUid: record.kernelUid ?? record.id,
        }) satisfies OccNativeTopologyRecord,
    ),
  ];
}

export function parseNativeShimPayloadJson(json: string): OccNativeShimPayload {
  const parsed = JSON.parse(json) as unknown;
  const result = nativeShimPayloadValidator(parsed);
  if (!result.success) {
    throw new Error(
      result.errors[0]?.description ??
        result.errors[0]?.expected ??
        "Native shim payload is invalid.",
    );
  }

  const payload = {
    ...result.data,
    topology: result.data.topology ?? [],
    edgeVertices: result.data.edgeVertices ?? [],
    vertexPoints: result.data.vertexPoints ?? [],
    faceEdges: result.data.faceEdges ?? [],
    diagnostics: result.data.diagnostics ?? [],
  };
  assertNativeShimPayloadInvariants(payload);
  return payload;
}

function assertUniqueNativeIds(
  values: readonly string[],
  path: string,
) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw invariantFailure(path, `contains duplicate native id ${value}.`);
    }
    seen.add(value);
  }
}

function assertNativeSheetSplitToolHistoryInvariants(
  payload: OccNativeSheetSplitToolHistoryPayload,
) {
  const outputsBySlot = new Map<string, OccNativeSheetSplitToolHistoryOutput>();
  const outputSlotsByFinalFaceId = new Map<string, Set<string>>();

  for (const output of payload.outputs) {
    if (outputsBySlot.has(output.outputSlotKey)) {
      throw invariantFailure(
        "outputs",
        `contains duplicate output slot ${output.outputSlotKey}.`,
      );
    }
    if (
      output.sourceTargetFaceNativeIds.length === 0 ||
      output.finalFaceNativeIds.length === 0
    ) {
      throw invariantFailure(
        `outputs.${output.outputSlotKey}`,
        "must declare non-empty exact target and final face memberships.",
      );
    }
    assertUniqueNativeIds(
      output.sourceTargetFaceNativeIds,
      `outputs.${output.outputSlotKey}.sourceTargetFaceNativeIds`,
    );
    assertUniqueNativeIds(
      output.finalFaceNativeIds,
      `outputs.${output.outputSlotKey}.finalFaceNativeIds`,
    );
    outputsBySlot.set(output.outputSlotKey, output);

    for (const finalFaceId of output.finalFaceNativeIds) {
      const outputSlots = outputSlotsByFinalFaceId.get(finalFaceId) ?? new Set();
      outputSlots.add(output.outputSlotKey);
      outputSlotsByFinalFaceId.set(finalFaceId, outputSlots);
    }
  }

  if (payload.status === "available" && outputsBySlot.size === 0) {
    throw invariantFailure("outputs", "must not be empty when history is available.");
  }

  const seenToolFaces = new Set<string>();
  const claimedFinalFaces = new Set<string>();
  for (const [relationIndex, relation] of payload.toolFaceRelations.entries()) {
    const path = `toolFaceRelations.${relationIndex}`;
    if (relation.sourceToolFace.bodyId !== payload.toolBodyId) {
      throw invariantFailure(
        `${path}.sourceToolFace.bodyId`,
        `must equal toolBodyId ${payload.toolBodyId}.`,
      );
    }
    if (seenToolFaces.has(relation.sourceToolFace.nativeFaceId)) {
      throw invariantFailure(
        "toolFaceRelations",
        `contains duplicate tool face ${relation.sourceToolFace.nativeFaceId}.`,
      );
    }
    seenToolFaces.add(relation.sourceToolFace.nativeFaceId);

    const expectedCount =
      relation.cardinality === "zero"
        ? 0
        : relation.cardinality === "one"
          ? 1
          : 2;
    if (
      (relation.cardinality === "many" && relation.finalFaces.length < expectedCount) ||
      (relation.cardinality !== "many" &&
        relation.finalFaces.length !== expectedCount)
    ) {
      throw invariantFailure(
        `${path}.cardinality`,
        `is inconsistent with ${relation.finalFaces.length} final faces.`,
      );
    }

    for (const [faceIndex, finalFace] of relation.finalFaces.entries()) {
      const facePath = `${path}.finalFaces.${faceIndex}`;
      assertUniqueNativeIds(finalFace.outputSlotKeys, `${facePath}.outputSlotKeys`);
      const declaredOutputSlots = outputSlotsByFinalFaceId.get(
        finalFace.nativeFaceId,
      );
      if (!declaredOutputSlots) {
        throw invariantFailure(
          `${facePath}.nativeFaceId`,
          "is not declared by any exact output slot.",
        );
      }
      if (
        finalFace.outputSlotKeys.length !== declaredOutputSlots.size ||
        !finalFace.outputSlotKeys.every((slot) => declaredOutputSlots.has(slot))
      ) {
        throw invariantFailure(
          `${facePath}.outputSlotKeys`,
          "must contain exactly the declared output-slot membership for its final face.",
        );
      }
      if (claimedFinalFaces.has(finalFace.nativeFaceId)) {
        throw invariantFailure(
          "toolFaceRelations",
          `contains colliding tool-face claims for final face ${finalFace.nativeFaceId}.`,
        );
      }
      claimedFinalFaces.add(finalFace.nativeFaceId);
    }
  }
}

function assertNativeBooleanOperandHistoryInvariants(
  payload: OccNativeBooleanOperandHistoryPayload,
) {
  const finalFaceIds = new Set<string>();
  for (const [index, finalFace] of payload.finalFaces.entries()) {
    const path = `finalFaces.${index}`;
    if (finalFaceIds.has(finalFace.nativeFaceId)) {
      throw invariantFailure(
        "finalFaces",
        `contains duplicate final face ${finalFace.nativeFaceId}.`,
      );
    }
    finalFaceIds.add(finalFace.nativeFaceId);
    assertUniqueNativeIds(
      finalFace.leftSourceFaceNativeIds,
      `${path}.leftSourceFaceNativeIds`,
    );
    assertUniqueNativeIds(
      finalFace.rightSourceFaceNativeIds,
      `${path}.rightSourceFaceNativeIds`,
    );
  }
  if (payload.status === "available" && payload.finalFaces.length === 0) {
    throw invariantFailure(
      "finalFaces",
      "must not be empty when Boolean operand history is available.",
    );
  }
  if (payload.status === "unsupported" && payload.finalFaces.length !== 0) {
    throw invariantFailure(
      "finalFaces",
      "must be empty when Boolean operand history is unsupported.",
    );
  }
}

/** Parse the optional additive Boolean operand-history ABI strictly. */
export function parseNativeBooleanOperandHistoryJson(
  json: string,
): OccNativeBooleanOperandHistoryPayload {
  const parsed = JSON.parse(json) as unknown;
  const result = nativeBooleanOperandHistoryPayloadValidator(parsed);
  if (!result.success) {
    throw new Error(
      result.errors[0]?.description ??
        result.errors[0]?.expected ??
        "Native Boolean operand history payload is invalid.",
    );
  }
  assertNativeBooleanOperandHistoryInvariants(result.data);
  return result.data;
}

export function parseNativeFeatureTransactionHistoryJson(
  json: string,
): OccNativeFeatureTransactionHistoryPayload {
  const parsed = JSON.parse(json) as unknown;
  const result = nativeFeatureTransactionHistoryPayloadValidator(parsed);
  if (!result.success) {
    throw new Error(
      result.errors[0]?.description ??
        result.errors[0]?.expected ??
        "Native feature transaction history payload is invalid.",
    );
  }

  const payload = {
    ...result.data,
    records: result.data.records ?? [],
    diagnostics: result.data.diagnostics ?? [],
  };
  return payload;
}

export function parseNativeSheetSplitToolHistoryJson(
  json: string,
): OccNativeSheetSplitToolHistoryPayload {
  const parsed = JSON.parse(json) as unknown;
  const result = nativeSheetSplitToolHistoryPayloadValidator(parsed);
  if (!result.success) {
    throw new Error(
      result.errors[0]?.description ??
        result.errors[0]?.expected ??
        "Native sheet-split tool history payload is invalid.",
    );
  }

  assertNativeSheetSplitToolHistoryInvariants(result.data);
  return result.data;
}

export function createOccNativeReferenceInvalidationsFromHistoryPayload(
  history: OccNativeFeatureTransactionHistoryPayload,
): OccNativeReferenceInvalidation[] {
  if (history.status !== "available") {
    return history.diagnostics.map((diagnostic) => ({
      target: diagnostic.target ?? {
        kind: "body",
        bodyId: (history.bodyId ?? "body_unresolved") as BodyId,
      },
      reason: "unsupported-history",
      successors: [],
      featureId: null,
      message: diagnostic.message,
    }));
  }

  const invalidations: OccNativeReferenceInvalidation[] = [];

  for (const record of history.records) {
    switch (record.reason) {
      case "unique-successor":
        break;
      case "generated":
        // A generated record names topology the operation CREATED, attributed
        // to the prior entity it came from. It is producer identity, not a
        // statement that the prior entity lost its reference.
        break;
      case "ambiguous":
        invalidations.push({
          target: record.target,
          reason: "ambiguous",
          successors: record.successors,
          featureId: null,
          message: "Native topology history reported ambiguous successors.",
        });
        break;
      case "deleted":
        invalidations.push({
          target: record.target,
          reason: "deleted",
          successors: [],
          featureId: null,
          message: "Native topology history reported deleted topology.",
        });
        break;
      case "missing":
        invalidations.push({
          target: record.target,
          reason: "unsupported-history",
          successors: [],
          featureId: null,
          message:
            "Native topology history could not resolve a reliable successor.",
        });
        break;
    }
  }

  return invalidations;
}

export function createOccNativeTopologyPayloadFromShimPayloads(input: {
  revisionId: RevisionId;
  lodTierId: OccTessellationTierId | null;
  bodies: readonly {
    bodyId: BodyId;
    nativePayload: OccNativeShimPayload;
    invalidations?: readonly OccNativeReferenceInvalidation[];
  }[];
  diagnostics?: readonly OccNativeTopologyDiagnostic[];
}): OccNativeTopologyPayload {
  const bodyPayloads = input.bodies.map(
    ({ bodyId, nativePayload, invalidations = [] }) => {
      const topology = createBodyTopologyRecords(bodyId, nativePayload);
      const identity = createIdentityRecords(topology);
      const topologyCounts = countTopologyKinds(topology);
      const faceIds = topology
        .filter((record) => record.kind === "face")
        .map((record) => record.id);
      const renderMesh = packMeshSummaryBuffers(
        nativePayload.mesh,
        `${bodyId}_render_mesh`,
        faceIds,
      );

      return {
        bodyId,
        topology,
        identity,
        adjacency: createAdjacencyTableLayout(
          nativePayload.edgeVertices.length,
        ),
        renderMesh: nativePayload.mesh ? renderMesh.layout : null,
        renderMeshSummary: nativePayload.mesh ?? null,
        exactBrep: null,
        invalidations,
        topologyCounts,
        buffers: renderMesh.buffers,
      };
    },
  );
  const allTopology = bodyPayloads.flatMap((body) => body.topology);
  const allDiagnostics = [
    ...(input.diagnostics ?? []),
    ...input.bodies.flatMap(({ nativePayload }) => nativePayload.diagnostics),
  ];

  return {
    schemaVersion: OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION,
    source: "occt7-shim",
    revisionId: input.revisionId,
    lodTierId: input.lodTierId,
    bodies: bodyPayloads.map(
      ({ topologyCounts: _topologyCounts, buffers: _buffers, ...body }) => body,
    ),
    tables: {
      topology: createTopologyTableLayout(countTopologyKinds(allTopology)),
      identity: createIdentityTableLayout(allTopology.length),
      diagnostics: createDiagnosticTableLayout(allDiagnostics.length),
    },
    buffers: bodyPayloads.flatMap((body) => body.buffers),
    diagnostics: allDiagnostics,
  };
}

export function createOccNativeExactBrepPayloadFromShimPayload(input: {
  revisionId: RevisionId;
  target: DurableRef;
  bodyId: BodyId;
  bodyLabel: string;
  nativePayload: OccNativeShimPayload;
  diagnostics?: readonly OccNativeTopologyDiagnostic[];
}): OccNativeExactBrepPayload {
  const nativeBrep = input.nativePayload.cadaraBrep;
  const brep = nativeBrep
    ? ({
        ...nativeBrep,
        bodies: nativeBrep.bodies.map((body, index) =>
          index === 0
            ? {
                ...body,
                bodyKey: input.bodyId,
                label: input.bodyLabel,
              }
            : body,
        ),
      } satisfies CadaraBrepGeometryAssetData)
    : null;
  const unsupportedDiagnostic = createNativeExactBrepUnsupportedDiagnostic(
    input.nativePayload,
    input.target,
  );
  const diagnostics = [
    ...input.nativePayload.diagnostics,
    ...(!brep && unsupportedDiagnostic ? [unsupportedDiagnostic] : []),
    ...(!brep && !unsupportedDiagnostic
      ? [
          createNativeTopologyDiagnostic(
            "occ-native-exact-brep-empty",
            "Native exact B-rep payload did not include extractable topology records.",
            {
              nativeTopologyRecords: input.nativePayload.topology.length,
              nativeMeshTriangles: input.nativePayload.mesh?.triangleCount ?? 0,
            },
            input.target,
          ),
        ]
      : []),
    ...(input.diagnostics ?? []),
  ];

  return {
    schemaVersion: OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION,
    revisionId: input.revisionId,
    target: input.target,
    brep: brep ?? {
      kind: "cadaraBrep",
      schemaVersion: "cadara-brep/v1alpha1",
      source: {
        importedFormat: "step",
        sourceStored: false,
      },
      bodies: [
        {
          bodyKey: input.bodyId,
          label: input.bodyLabel,
          topology: createEmptyCadaraBrepTopology(),
        },
      ],
    },
    tables: brep
      ? createExactBrepTableLayoutFromCadaraBrep(brep)
      : createExactBrepTableLayout(createTopologyTableLayout()),
    buffers: brep
      ? [createJsonTransferableBuffer(`${input.bodyId}_exact_brep_json`, brep)]
      : [],
    diagnostics,
  };
}

export function createOccNativeMeshExportPayloadFromShimPayload(input: {
  revisionId: RevisionId;
  target: DurableRef;
  options: MeshExportAccuracy;
  nativePayload: OccNativeShimPayload;
  diagnostics?: readonly OccNativeTopologyDiagnostic[];
}): OccNativeMeshExportPayload {
  const mesh = packMeshSummaryBuffers(
    input.nativePayload.mesh,
    input.target.kind === "body"
      ? `${input.target.bodyId}_mesh_export`
      : "unresolved_mesh_export",
    input.nativePayload.topology
      .filter((record) => record.kind === "face")
      .map((record) => record.id),
  );

  return {
    schemaVersion: OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION,
    revisionId: input.revisionId,
    target: input.target,
    options: input.options,
    mesh: mesh.layout,
    meshSummary: input.nativePayload.mesh ?? null,
    buffers: mesh.buffers,
    diagnostics: [
      ...input.nativePayload.diagnostics,
      ...(input.diagnostics ?? []),
    ],
  };
}

export function createEmptyNativeTransferableBuffer(): OccNativeTransferableBuffer {
  return {
    bufferId: "occ_buffer_empty" as OccNativeBufferRef["bufferId"],
    buffer: emptyBuffer,
  };
}

export function getOccNativeTopologyTransferList(
  result: OccNativeTopologyWorkerResultWithBuffers,
): Transferable[] {
  if (result.kind !== "nativeTopologyPayload") {
    return [];
  }

  return result.payload.buffers.map(({ buffer }) => buffer);
}

export type OccNativeTopologyWorkerResultWithBuffers =
  | {
      kind: "nativeTopologyPayload";
      payload: {
        buffers: readonly OccNativeTransferableBuffer[];
      };
    }
  | {
      kind: "nativeTopologyUnavailable";
    };

export function getMissingNativeTopologyKernelEntrypoints(
  host:
    | Partial<Record<OccNativeTopologyKernelEntrypoint, unknown>>
    | OpenCascadeNativeTopologyKernelHost,
  requiredEntrypoints: readonly OccNativeTopologyKernelEntrypoint[] = OCC_NATIVE_TOPOLOGY_KERNEL_ENTRYPOINTS,
) {
  return requiredEntrypoints.filter(
    (entrypoint) => typeof host[entrypoint] !== "function",
  );
}

export function createMissingNativeTopologyKernelDiagnostic(
  missingEntrypoints: readonly OccNativeTopologyKernelEntrypoint[],
): OccNativeTopologyDiagnostic {
  return {
    code: "occ-native-topology-entrypoint-missing" as OccNativeNonEmptyString,
    severity: "error",
    message:
      `Loaded OpenCascade build is missing native topology kernel entrypoints: ${missingEntrypoints.join(", ")}.` as OccNativeNonEmptyString,
    target: null,
    detail: {
      missingEntrypoints: [...missingEntrypoints],
    },
  };
}

export function probeNativeTopologyKernelCapabilities(
  host:
    | Partial<Record<OccNativeTopologyKernelEntrypoint, unknown>>
    | OpenCascadeNativeTopologyKernelHost,
): OccNativeTopologyCapabilityProbeResult {
  const missingEntrypoints = getMissingNativeTopologyKernelEntrypoints(host);

  return {
    kind: missingEntrypoints.length === 0 ? "available" : "missing",
    requiredEntrypoints: OCC_NATIVE_TOPOLOGY_KERNEL_ENTRYPOINTS,
    missingEntrypoints,
    diagnostics:
      missingEntrypoints.length === 0
        ? []
        : [createMissingNativeTopologyKernelDiagnostic(missingEntrypoints)],
  };
}

export function createNativeTopologyUnavailableResult() {
  return probeNativeTopologyKernelCapabilities({});
}
