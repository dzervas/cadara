import type {
  BodyId,
  EdgeId,
  FaceId,
  FeatureId,
  RevisionId,
  SketchEntityId,
  SketchPointId,
  VertexId,
} from "@/contracts/shared/ids";
import type {
  BodySnapshotRecord,
  ConstructionSnapshotRecord,
  FeatureDefinition,
  ModelingDiagnostic,
  ResolvedReferenceRecord,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type { DocumentId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  parseNativeShimPayloadJson,
  type OccNativeShimPayload,
  type OpenCascadeNativeTopologyKernelHost,
} from "@/domain/modeling/occ/native-topology-payload";
import {
  deriveGeneratedTopologyContributors,
  reconcileReplacementTopology,
  seedOccTopologyNaming,
  type OccTopologyHistorySource,
  type OccTopologyNamingBodyState,
} from "@/domain/modeling/occ/topology-naming";

function solidShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_SOLID as unknown as number;
}

function faceShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_FACE as unknown as number;
}

function edgeShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_EDGE as unknown as number;
}

function vertexShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_VERTEX as unknown as number;
}

function anyShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_SHAPE as unknown as number;
}

export interface OccTrackedBody {
  bodyId: BodyId;
  label: string;
  ownerFeatureId: FeatureId | null;
  topologyToken: string;
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
  meshExportFallback?: Array<
    readonly [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ]
  >;
  nativeTopologyPayload?: OccNativeShimPayload;
  nativeTopologyIdAliases?: {
    faceIdsByNativeId: ReadonlyMap<FaceId, FaceId>;
    edgeIdsByNativeId?: ReadonlyMap<EdgeId, EdgeId>;
    vertexIdsByNativeId?: ReadonlyMap<VertexId, VertexId>;
  };
  topology: {
    faceIds: FaceId[];
    edgeIds: EdgeId[];
    vertexIds: VertexId[];
  };
  contributingFeatureIds: FeatureId[];
  facesById: Map<FaceId, InstanceType<OpenCascadeInstance["TopoDS_Face"]>>;
  faceContributingFeatureIdsById: Map<FaceId, FeatureId[]>;
  edgesById: Map<EdgeId, InstanceType<OpenCascadeInstance["TopoDS_Edge"]>>;
  edgeContributingFeatureIdsById: Map<EdgeId, FeatureId[]>;
  verticesById: Map<
    VertexId,
    InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>
  >;
  vertexContributingFeatureIdsById: Map<VertexId, FeatureId[]>;
  naming?: OccTopologyNamingBodyState;
}

export interface OccAuthoringFeatureRecordLike {
  featureId: FeatureId;
  definition: FeatureDefinition;
}

export interface OccReferenceState {
  bodySnapshots: BodySnapshotRecord[];
  liveReferencesByKey: Map<string, ResolvedReferenceRecord>;
  invalidatedReferencesByKey: Map<string, ResolvedReferenceRecord>;
}

export interface OccReferenceInvalidationRecord {
  target: DurableRef;
  reason: string;
  sourceTarget: DurableRef | null;
}

export const OCC_REFERENCE_INVALIDATION_REASONS = {
  missing: "occ-missing-reference",
  topologyDeleted: "occ-topology-deleted",
  topologyModified: "occ-topology-modified",
  topologyAmbiguous: "occ-topology-ambiguous",
  topologyUnsupportedHistory: "occ-topology-unsupported-history",
} as const satisfies Record<string, string>;

const OCC_INVALID_REFERENCE_DIAGNOSTIC_CODE = "occ-invalid-reference";
const INITIAL_TOPOLOGY_TOKEN_NUMBER = 1;
const NATIVE_TOPOLOGY_IDENTITY_LINEAR_DEFLECTION = 0.1;
const NATIVE_TOPOLOGY_IDENTITY_ANGULAR_DEFLECTION = 0.5;

function formatTopologyToken(value: number) {
  return `t${String(value).padStart(4, "0")}`;
}

function parseTopologyToken(token: string) {
  const match = /^t(\d+)$/.exec(token);

  if (!match) {
    throw new Error(`Unsupported OCC topology token ${token}.`);
  }

  return Number.parseInt(match[1]!, 10);
}

export function getOccDurableRefKey(target: DurableRef) {
  switch (target.kind) {
    case "body":
      return `body:${target.bodyId}`;
    case "face":
      return `face:${target.bodyId}:${target.faceId}`;
    case "edge":
      return `edge:${target.bodyId}:${target.edgeId}`;
    case "vertex":
      return `vertex:${target.bodyId}:${target.vertexId}`;
    case "loop":
      return `loop:${target.bodyId}:${target.loopId}`;
    case "sketch":
      return `sketch:${target.sketchId}`;
    case "sketchOperation":
      return `sketchOperation:${target.sketchId}:${target.operationId}`;
    case "sketchEntity":
      return `sketchEntity:${target.sketchId}:${target.entityId}`;
    case "sketchPoint":
      return `sketchPoint:${target.sketchId}:${target.pointId}`;
    case "constraint":
      return `constraint:${target.sketchId}:${target.constraintId}`;
    case "dimension":
      return `dimension:${target.sketchId}:${target.dimensionId}`;
    case "feature":
      return `feature:${target.featureId}`;
    case "construction":
      return `construction:${target.constructionId}`;
    case "region":
      return `region:${target.sketchId}:${target.regionId}`;
  }
}

function getDurableRefLabel(target: DurableRef) {
  switch (target.kind) {
    case "body":
      return target.bodyId;
    case "face":
      return `${target.bodyId}.${target.faceId}`;
    case "edge":
      return `${target.bodyId}.${target.edgeId}`;
    case "vertex":
      return `${target.bodyId}.${target.vertexId}`;
    case "loop":
      return `${target.bodyId}.${target.loopId}`;
    case "sketch":
      return target.sketchId;
    case "sketchOperation":
      return `${target.sketchId}.${target.operationId}`;
    case "sketchEntity":
      return `${target.sketchId}.${target.entityId}`;
    case "sketchPoint":
      return `${target.sketchId}.${target.pointId}`;
    case "constraint":
      return `${target.sketchId}.${target.constraintId}`;
    case "dimension":
      return `${target.sketchId}.${target.dimensionId}`;
    case "feature":
      return target.featureId;
    case "construction":
      return target.constructionId;
    case "region":
      return `${target.sketchId}.${target.regionId}`;
  }
}

function createInvalidationSourceTarget(
  resolution: Omit<ResolvedReferenceRecord, "invalidation">,
): DurableRef | null {
  switch (resolution.target.kind) {
    case "face":
    case "edge":
    case "vertex":
      return resolution.ownerBodyId
        ? { kind: "body", bodyId: resolution.ownerBodyId }
        : null;
    case "region":
    case "sketchEntity":
    case "sketchPoint":
      return resolution.ownerSketchId
        ? { kind: "sketch", sketchId: resolution.ownerSketchId }
        : null;
    default:
      return null;
  }
}

function createResolvedReferenceRecord(
  input: Omit<ResolvedReferenceRecord, "invalidation">,
): ResolvedReferenceRecord {
  return {
    ...input,
    invalidation: null,
  };
}

function createInvalidatedReferenceRecord(
  resolution: Omit<ResolvedReferenceRecord, "invalidation">,
  revisionId: RevisionId,
  invalidation: OccReferenceInvalidationRecord,
): ResolvedReferenceRecord {
  return {
    ...resolution,
    ownerRevisionId: revisionId,
    invalidation: {
      reason: invalidation.reason,
      target: resolution.target,
      ownerFeatureId: resolution.ownerFeatureId,
      ownerSketchId: resolution.ownerSketchId,
      sourceTarget:
        invalidation.sourceTarget ?? createInvalidationSourceTarget(resolution),
    },
  };
}

function createMissingReferenceDiagnostic(
  resolution: ResolvedReferenceRecord,
): ModelingDiagnostic {
  return {
    code: OCC_INVALID_REFERENCE_DIAGNOSTIC_CODE,
    severity: "error",
    message:
      "Requested durable reference does not resolve in the current OCC authoring state.",
    target: resolution.target,
    detail:
      resolution.invalidation === null
        ? null
        : {
            kind: "invalidReference",
            reference: resolution.invalidation,
          },
  };
}

export function extractSolidShapes(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const solids: InstanceType<OpenCascadeInstance["TopoDS_Solid"]>[] = [];

  if ((shape.ShapeType() as unknown as number) === solidShapeType(oc)) {
    solids.push(oc.TopoDS.Solid_1(shape));
    return solids;
  }

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    solidShapeType(oc) as never,
    anyShapeType(oc) as never,
  );

  while (explorer.More()) {
    solids.push(oc.TopoDS.Solid_1(explorer.Current()));
    explorer.Next();
  }

  return solids;
}

function enumerateFaces(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  topologyToken: string,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const faceIds: FaceId[] = [];
  const facesById = new Map<
    FaceId,
    InstanceType<OpenCascadeInstance["TopoDS_Face"]>
  >();
  const faceMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, faceShapeType(oc) as never, faceMap);

  for (let index = 1; index <= faceMap.Size(); index += 1) {
    const faceId = `face_${bodyId}_${topologyToken}_${index}` as FaceId;
    faceIds.push(faceId);
    facesById.set(faceId, oc.TopoDS.Face_1(faceMap.FindKey(index)));
  }

  faceMap.delete();
  return { faceIds, facesById };
}

function enumerateEdges(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  topologyToken: string,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const edgeIds: EdgeId[] = [];
  const edgesById = new Map<
    EdgeId,
    InstanceType<OpenCascadeInstance["TopoDS_Edge"]>
  >();
  const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, edgeShapeType(oc) as never, edgeMap);

  for (let index = 1; index <= edgeMap.Size(); index += 1) {
    const edgeId = `edge_${bodyId}_${topologyToken}_${index}` as EdgeId;
    edgeIds.push(edgeId);
    edgesById.set(edgeId, oc.TopoDS.Edge_1(edgeMap.FindKey(index)));
  }

  edgeMap.delete();
  return { edgeIds, edgesById };
}

function enumerateVertices(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  topologyToken: string,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const vertexIds: VertexId[] = [];
  const verticesById = new Map<
    VertexId,
    InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>
  >();
  const vertexMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, vertexShapeType(oc) as never, vertexMap);

  for (let index = 1; index <= vertexMap.Size(); index += 1) {
    const vertexId = `vertex_${bodyId}_${topologyToken}_${index}` as VertexId;
    vertexIds.push(vertexId);
    verticesById.set(vertexId, oc.TopoDS.Vertex_1(vertexMap.FindKey(index)));
  }

  vertexMap.delete();
  return { vertexIds, verticesById };
}

function indexFacesByNativePayload(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  nativePayload: OccNativeShimPayload,
) {
  const faceIds: FaceId[] = [];
  const facesById = new Map<
    FaceId,
    InstanceType<OpenCascadeInstance["TopoDS_Face"]>
  >();
  const faceMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, faceShapeType(oc) as never, faceMap);

  for (const record of nativePayload.topology) {
    if (record.kind !== "face" || record.bodyId !== bodyId) {
      continue;
    }

    if (record.index > faceMap.Size()) {
      faceMap.delete();
      throw new Error(
        `Native topology payload references missing face index ${record.index}.`,
      );
    }

    const faceId = record.id as FaceId;
    faceIds.push(faceId);
    facesById.set(faceId, oc.TopoDS.Face_1(faceMap.FindKey(record.index)));
  }

  if (faceIds.length !== faceMap.Size()) {
    const faceCount = faceMap.Size();
    faceMap.delete();
    throw new Error(
      `Native topology payload returned ${faceIds.length} faces for body ${bodyId}; expected ${faceCount}.`,
    );
  }

  faceMap.delete();
  return { faceIds, facesById };
}

function indexEdgesByNativePayload(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  nativePayload: OccNativeShimPayload,
) {
  const edgeIds: EdgeId[] = [];
  const edgesById = new Map<
    EdgeId,
    InstanceType<OpenCascadeInstance["TopoDS_Edge"]>
  >();
  const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, edgeShapeType(oc) as never, edgeMap);

  for (const record of nativePayload.topology) {
    if (record.kind !== "edge" || record.bodyId !== bodyId) {
      continue;
    }

    if (record.index > edgeMap.Size()) {
      edgeMap.delete();
      throw new Error(
        `Native topology payload references missing edge index ${record.index}.`,
      );
    }

    const edgeId = record.id as EdgeId;
    edgeIds.push(edgeId);
    edgesById.set(edgeId, oc.TopoDS.Edge_1(edgeMap.FindKey(record.index)));
  }

  if (edgeIds.length !== edgeMap.Size()) {
    const edgeCount = edgeMap.Size();
    edgeMap.delete();
    throw new Error(
      `Native topology payload returned ${edgeIds.length} edges for body ${bodyId}; expected ${edgeCount}.`,
    );
  }

  edgeMap.delete();
  return { edgeIds, edgesById };
}

function indexVerticesByNativePayload(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  nativePayload: OccNativeShimPayload,
) {
  const vertexIds: VertexId[] = [];
  const verticesById = new Map<
    VertexId,
    InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>
  >();
  const vertexMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, vertexShapeType(oc) as never, vertexMap);

  for (const record of nativePayload.topology) {
    if (record.kind !== "vertex" || record.bodyId !== bodyId) {
      continue;
    }

    if (record.index > vertexMap.Size()) {
      vertexMap.delete();
      throw new Error(
        `Native topology payload references missing vertex index ${record.index}.`,
      );
    }

    const vertexId = record.id as VertexId;
    vertexIds.push(vertexId);
    verticesById.set(
      vertexId,
      oc.TopoDS.Vertex_1(vertexMap.FindKey(record.index)),
    );
  }

  if (vertexIds.length !== vertexMap.Size()) {
    const vertexCount = vertexMap.Size();
    vertexMap.delete();
    throw new Error(
      `Native topology payload returned ${vertexIds.length} vertices for body ${bodyId}; expected ${vertexCount}.`,
    );
  }

  vertexMap.delete();
  return { vertexIds, verticesById };
}

function buildNativeTopologyPayloadForTrackedSolid(
  oc: OpenCascadeInstance,
  input: {
    bodyId: BodyId;
    topologyToken: string;
    solid: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
  },
) {
  const nativeHost = oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const buildJson = nativeHost.CadaraBuildNativeTopologyPayload?.BuildJson;

  if (!buildJson) {
    if (
      (
        oc as OpenCascadeInstance & {
          CadaraAllowLegacyTopologyEnumerationForTests?: boolean;
        }
      ).CadaraAllowLegacyTopologyEnumerationForTests === true
    ) {
      return null;
    }

    throw new Error(
      `Loaded OpenCascade build does not expose required native topology payload support for committed body ${input.bodyId}.`,
    );
  }

  const nativePayload = disambiguateNativeTopologyPayloadIdentity(
    input.bodyId,
    parseNativeShimPayloadJson(
      buildJson(
        input.solid,
        input.bodyId,
        input.topologyToken,
        NATIVE_TOPOLOGY_IDENTITY_LINEAR_DEFLECTION,
        NATIVE_TOPOLOGY_IDENTITY_ANGULAR_DEFLECTION,
      ),
    ),
  );
  assertReleasableNativeTopologyPayload(
    input.bodyId,
    nativePayload,
    "tracked solid body",
  );

  return nativePayload;
}

function createSeedContributorIds(ownerFeatureId: FeatureId | null) {
  return ownerFeatureId ? [ownerFeatureId] : [];
}

function createContributorMap<Id extends FaceId | EdgeId | VertexId>(
  ids: readonly Id[],
  ownerFeatureId: FeatureId | null,
) {
  const seed = createSeedContributorIds(ownerFeatureId);
  return new Map(ids.map((id) => [id, [...seed]]));
}

export function haveSameOccTopologyIds(
  left: OccTrackedBody["topology"],
  right: OccTrackedBody["topology"],
) {
  return (
    left.faceIds.length === right.faceIds.length &&
    left.edgeIds.length === right.edgeIds.length &&
    left.vertexIds.length === right.vertexIds.length &&
    left.faceIds.every((faceId, index) => faceId === right.faceIds[index]) &&
    left.edgeIds.every((edgeId, index) => edgeId === right.edgeIds[index]) &&
    left.vertexIds.every(
      (vertexId, index) => vertexId === right.vertexIds[index],
    )
  );
}

function assertReleasableNativeTopologyPayload(
  bodyId: BodyId,
  nativePayload: OccNativeShimPayload,
  operation: string,
) {
  const isPreviewBody = String(bodyId).startsWith("body_feature_preview_");
  const defersPre8Validation = String(bodyId).startsWith("body_feature_sweep-");
  const errorDiagnostic = nativePayload.diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );

  if (errorDiagnostic && !isPreviewBody && !defersPre8Validation) {
    throw new Error(
      `Native topology payload for ${operation} ${bodyId} is not releasable: ${errorDiagnostic.message}`,
    );
  }

  if (isPreviewBody) {
    return;
  }

  const topologyIdsByKind = new Set<string>();
  const kernelUidsByKind = new Set<string>();

  for (const record of nativePayload.topology) {
    if (record.bodyId !== bodyId) {
      continue;
    }

    const topologyIdKey = `${record.kind}:${record.id}`;
    const kernelUidKey = `${record.kind}:${record.kernelUid ?? record.id}`;

    if (topologyIdsByKind.has(topologyIdKey)) {
      throw new Error(
        `Native topology payload for ${operation} ${bodyId} produced duplicate ${record.kind} id ${record.id}.`,
      );
    }

    if (kernelUidsByKind.has(kernelUidKey)) {
      throw new Error(
        `Native topology payload for ${operation} ${bodyId} produced duplicate ${record.kind} kernel identity ${record.kernelUid ?? record.id}.`,
      );
    }

    topologyIdsByKind.add(topologyIdKey);
    kernelUidsByKind.add(kernelUidKey);
  }
}

function disambiguateNativeTopologyPayloadIdentity(
  bodyId: BodyId,
  nativePayload: OccNativeShimPayload,
): OccNativeShimPayload {
  const idCounts = new Map<string, number>();
  const kernelUidCounts = new Map<string, number>();

  for (const record of nativePayload.topology) {
    if (record.bodyId !== bodyId) {
      continue;
    }

    const idKey = `${record.kind}:${record.id}`;
    const kernelUidKey = `${record.kind}:${record.kernelUid ?? record.id}`;
    idCounts.set(idKey, (idCounts.get(idKey) ?? 0) + 1);
    kernelUidCounts.set(
      kernelUidKey,
      (kernelUidCounts.get(kernelUidKey) ?? 0) + 1,
    );
  }

  const firstReplacementByKindAndId = new Map<string, string>();
  let changed = false;
  const topology = nativePayload.topology.map((record) => {
    if (record.bodyId !== bodyId) {
      return record;
    }

    const idKey = `${record.kind}:${record.id}`;
    const kernelUid = record.kernelUid ?? record.id;
    const kernelUidKey = `${record.kind}:${kernelUid}`;
    const needsDisambiguation =
      (idCounts.get(idKey) ?? 0) > 1 ||
      (kernelUidCounts.get(kernelUidKey) ?? 0) > 1;

    if (!needsDisambiguation) {
      return record;
    }

    changed = true;
    const suffix = `_i${record.index}`;
    const nextId = `${record.id}${suffix}`;
    firstReplacementByKindAndId.set(
      idKey,
      firstReplacementByKindAndId.get(idKey) ?? nextId,
    );

    return {
      ...record,
      id: nextId,
      kernelUid: `${kernelUid}${suffix}`,
    };
  });

  if (!changed) {
    return nativePayload;
  }

  const rewriteId = (kind: "face" | "edge" | "vertex", id: string) =>
    firstReplacementByKindAndId.get(`${kind}:${id}`) ?? id;

  return {
    ...nativePayload,
    topology,
    edgeVertices: nativePayload.edgeVertices.map((record) => ({
      ...record,
      edgeId: rewriteId("edge", record.edgeId),
    })),
    faceEdges: nativePayload.faceEdges.map((record) => ({
      ...record,
      faceId: rewriteId("face", record.faceId),
      edgeIds: record.edgeIds.map(
        (edgeId) => rewriteId("edge", edgeId) as EdgeId,
      ),
    })),
    vertexPoints: nativePayload.vertexPoints?.map((record) => ({
      ...record,
      vertexId: rewriteId("vertex", record.vertexId),
    })),
    mesh: nativePayload.mesh
      ? {
          ...nativePayload.mesh,
          triangleFaceBindings: nativePayload.mesh.triangleFaceBindings?.map(
            (faceId) => rewriteId("face", faceId),
          ),
        }
      : nativePayload.mesh,
  };
}

export function rewriteNativeTopologyPayloadIds(
  bodyId: BodyId,
  nativePayload: OccNativeShimPayload,
  aliases: {
    faceIdsByNativeId?: ReadonlyMap<FaceId, FaceId>;
    edgeIdsByNativeId?: ReadonlyMap<EdgeId, EdgeId>;
    vertexIdsByNativeId?: ReadonlyMap<VertexId, VertexId>;
  },
): OccNativeShimPayload {
  const rewriteId = (kind: "face" | "edge" | "vertex", id: string) => {
    if (kind === "face") {
      return aliases.faceIdsByNativeId?.get(id as FaceId) ?? id;
    }
    if (kind === "edge") {
      return aliases.edgeIdsByNativeId?.get(id as EdgeId) ?? id;
    }
    return aliases.vertexIdsByNativeId?.get(id as VertexId) ?? id;
  };

  const topology = nativePayload.topology.map((record) => {
    if (record.bodyId !== bodyId) {
      return record;
    }

    return {
      ...record,
      id: rewriteId(record.kind, record.id),
    };
  });

  return {
    ...nativePayload,
    topology,
    edgeVertices: nativePayload.edgeVertices.map((record) => ({
      ...record,
      edgeId: rewriteId("edge", record.edgeId),
    })),
    faceEdges: nativePayload.faceEdges.map((record) => ({
      ...record,
      faceId: rewriteId("face", record.faceId),
      edgeIds: record.edgeIds.map(
        (edgeId) => rewriteId("edge", edgeId) as EdgeId,
      ),
    })),
    vertexPoints: nativePayload.vertexPoints?.map((record) => ({
      ...record,
      vertexId: rewriteId("vertex", record.vertexId),
    })),
    mesh: nativePayload.mesh
      ? {
          ...nativePayload.mesh,
          triangleFaceBindings: nativePayload.mesh.triangleFaceBindings?.map(
            (faceId) => rewriteId("face", faceId),
          ),
        }
      : nativePayload.mesh,
  };
}

function buildTrackedSolidBody(
  oc: OpenCascadeInstance,
  input: {
    bodyId: BodyId;
    label: string;
    ownerFeatureId: FeatureId | null;
    topologyToken: string;
    shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
    naming?: OccTopologyNamingBodyState;
    seedNaming?: boolean;
    meshExportFallback?: OccTrackedBody["meshExportFallback"];
  },
): OccTrackedBody {
  const solids = extractSolidShapes(oc, input.shape);

  if (solids.length !== 1) {
    throw new Error(
      `Body ${input.bodyId} must resolve to exactly one solid shape, received ${solids.length}.`,
    );
  }

  const [solid] = solids;
  const topologyToken = input.topologyToken;
  const nativePayload = buildNativeTopologyPayloadForTrackedSolid(oc, {
    bodyId: input.bodyId,
    topologyToken,
    solid,
  });
  const faces = nativePayload
    ? indexFacesByNativePayload(oc, input.bodyId, solid, nativePayload)
    : enumerateFaces(oc, input.bodyId, topologyToken, solid);
  const edges = nativePayload
    ? indexEdgesByNativePayload(oc, input.bodyId, solid, nativePayload)
    : enumerateEdges(oc, input.bodyId, topologyToken, solid);
  const vertices = nativePayload
    ? indexVerticesByNativePayload(oc, input.bodyId, solid, nativePayload)
    : enumerateVertices(oc, input.bodyId, topologyToken, solid);

  const body = {
    bodyId: input.bodyId,
    label: input.label,
    ownerFeatureId: input.ownerFeatureId,
    topologyToken,
    shape: solid,
    meshExportFallback: input.meshExportFallback,
    nativeTopologyPayload: nativePayload ?? undefined,
    topology: {
      faceIds: faces.faceIds,
      edgeIds: edges.edgeIds,
      vertexIds: vertices.vertexIds,
    },
    contributingFeatureIds: createSeedContributorIds(input.ownerFeatureId),
    facesById: faces.facesById,
    faceContributingFeatureIdsById: createContributorMap(
      faces.faceIds,
      input.ownerFeatureId,
    ),
    edgesById: edges.edgesById,
    edgeContributingFeatureIdsById: createContributorMap(
      edges.edgeIds,
      input.ownerFeatureId,
    ),
    verticesById: vertices.verticesById,
    vertexContributingFeatureIdsById: createContributorMap(
      vertices.vertexIds,
      input.ownerFeatureId,
    ),
    naming: input.naming,
  } satisfies OccTrackedBody;

  return {
    ...body,
    naming:
      input.naming ??
      (input.seedNaming === false
        ? undefined
        : seedOccTopologyNaming(oc, body)),
  };
}

export function createInitialTopologyToken() {
  return formatTopologyToken(INITIAL_TOPOLOGY_TOKEN_NUMBER);
}

export function advanceTopologyToken(token: string) {
  return formatTopologyToken(parseTopologyToken(token) + 1);
}

export function trackNewSolidBody(
  oc: OpenCascadeInstance,
  input: {
    bodyId: BodyId;
    label: string;
    ownerFeatureId: FeatureId | null;
    shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
    seedNaming?: boolean;
    meshExportFallback?: OccTrackedBody["meshExportFallback"];
  },
) {
  return buildTrackedSolidBody(oc, {
    ...input,
    topologyToken: createInitialTopologyToken(),
  });
}

export function trackDerivedSolidBody(
  oc: OpenCascadeInstance,
  input: {
    previous: OccTrackedBody;
    bodyId: BodyId;
    label: string;
    ownerFeatureId: FeatureId | null;
    shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
    historySources: readonly OccTopologyHistorySource[];
    meshExportFallback?: OccTrackedBody["meshExportFallback"];
  },
) {
  const generated = buildTrackedSolidBody(oc, {
    bodyId: input.bodyId,
    label: input.label,
    ownerFeatureId: input.ownerFeatureId,
    topologyToken: createInitialTopologyToken(),
    shape: input.shape,
    meshExportFallback: input.meshExportFallback,
  });
  const contributors = deriveGeneratedTopologyContributors(oc, {
    previous: input.previous,
    generated,
    historySources: input.historySources,
  });

  return {
    ...generated,
    contributingFeatureIds: contributors.contributingFeatureIds,
    faceContributingFeatureIdsById: contributors.faceContributingFeatureIdsById,
    edgeContributingFeatureIdsById: contributors.edgeContributingFeatureIdsById,
    vertexContributingFeatureIdsById:
      contributors.vertexContributingFeatureIdsById,
  } satisfies OccTrackedBody;
}

export function trackReplacementSolidBody(
  oc: OpenCascadeInstance,
  input: {
    previous: Pick<OccTrackedBody, "bodyId" | "label" | "topologyToken">;
    ownerFeatureId: FeatureId | null;
    shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
    meshExportFallback?: OccTrackedBody["meshExportFallback"];
  },
) {
  return buildTrackedSolidBody(oc, {
    bodyId: input.previous.bodyId,
    label: input.previous.label,
    ownerFeatureId: input.ownerFeatureId,
    topologyToken: advanceTopologyToken(input.previous.topologyToken),
    shape: input.shape,
  });
}

export function trackReplacementSolidBodyFromNativePayload(
  oc: OpenCascadeInstance,
  input: {
    previous: Pick<OccTrackedBody, "bodyId" | "label" | "topologyToken">;
    ownerFeatureId: FeatureId | null;
    shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
    nativePayload: OccNativeShimPayload;
    meshExportFallback?: OccTrackedBody["meshExportFallback"];
  },
): OccTrackedBody {
  const solids = extractSolidShapes(oc, input.shape);

  if (solids.length !== 1) {
    throw new Error(
      `Native replacement body ${input.previous.bodyId} must resolve to exactly one solid shape, received ${solids.length}.`,
    );
  }

  const [solid] = solids;
  const nativePayload = disambiguateNativeTopologyPayloadIdentity(
    input.previous.bodyId,
    input.nativePayload,
  );
  assertReleasableNativeTopologyPayload(
    input.previous.bodyId,
    nativePayload,
    "native replacement body",
  );
  const faces = indexFacesByNativePayload(
    oc,
    input.previous.bodyId,
    solid,
    nativePayload,
  );
  const edges = indexEdgesByNativePayload(
    oc,
    input.previous.bodyId,
    solid,
    nativePayload,
  );
  const vertices = indexVerticesByNativePayload(
    oc,
    input.previous.bodyId,
    solid,
    nativePayload,
  );

  return {
    bodyId: input.previous.bodyId,
    label: input.previous.label,
    ownerFeatureId: input.ownerFeatureId,
    topologyToken: advanceTopologyToken(input.previous.topologyToken),
    shape: solid,
    meshExportFallback: input.meshExportFallback,
    nativeTopologyPayload: nativePayload,
    topology: {
      faceIds: faces.faceIds,
      edgeIds: edges.edgeIds,
      vertexIds: vertices.vertexIds,
    },
    contributingFeatureIds: createSeedContributorIds(input.ownerFeatureId),
    facesById: faces.facesById,
    faceContributingFeatureIdsById: createContributorMap(
      faces.faceIds,
      input.ownerFeatureId,
    ),
    edgesById: edges.edgesById,
    edgeContributingFeatureIdsById: createContributorMap(
      edges.edgeIds,
      input.ownerFeatureId,
    ),
    verticesById: vertices.verticesById,
    vertexContributingFeatureIdsById: createContributorMap(
      vertices.vertexIds,
      input.ownerFeatureId,
    ),
    naming: undefined,
  } satisfies OccTrackedBody;
}

export function reconcileReplacementSolidBody(
  oc: OpenCascadeInstance,
  input: {
    previous: OccTrackedBody;
    ownerFeatureId: FeatureId | null;
    shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
    historySources: readonly OccTopologyHistorySource[];
    meshExportFallback?: OccTrackedBody["meshExportFallback"];
  },
) {
  const replacement = buildTrackedSolidBody(oc, {
    bodyId: input.previous.bodyId,
    label: input.previous.label,
    ownerFeatureId: input.ownerFeatureId,
    topologyToken: advanceTopologyToken(input.previous.topologyToken),
    shape: input.shape,
    seedNaming: false,
    meshExportFallback: input.meshExportFallback,
  });
  const reconciliation = reconcileReplacementTopology(oc, {
    previous: input.previous,
    replacement,
    historySources: input.historySources,
  });

  const reconciledBody = {
    ...replacement,
    topology: reconciliation.topology,
    contributingFeatureIds: reconciliation.contributingFeatureIds,
    facesById: reconciliation.facesById,
    faceContributingFeatureIdsById:
      reconciliation.faceContributingFeatureIdsById,
    edgesById: reconciliation.edgesById,
    edgeContributingFeatureIdsById:
      reconciliation.edgeContributingFeatureIdsById,
    verticesById: reconciliation.verticesById,
    vertexContributingFeatureIdsById:
      reconciliation.vertexContributingFeatureIdsById,
    naming: reconciliation.naming,
    nativeTopologyPayload: haveSameOccTopologyIds(
      reconciliation.topology,
      replacement.topology,
    )
      ? replacement.nativeTopologyPayload
      : undefined,
  } satisfies OccTrackedBody;

  return {
    body: reconciledBody,
    historyInvalidations: reconciliation.invalidations,
  };
}

export function createBodySnapshotRecord(
  input: {
    documentId: DocumentId;
    revisionId: RevisionId;
  },
  body: OccTrackedBody,
): BodySnapshotRecord {
  return {
    ownerDocumentId: input.documentId,
    ownerRevisionId: input.revisionId,
    ownerFeatureId: body.ownerFeatureId,
    ownerSketchId: null,
    ownerBodyId: body.bodyId,
    bodyId: body.bodyId,
    label: body.label,
    topology: {
      faceIds: [...body.topology.faceIds],
      edgeIds: [...body.topology.edgeIds],
      vertexIds: [...body.topology.vertexIds],
    },
  };
}

function buildLiveReferenceMap(input: {
  documentId: DocumentId;
  revisionId: RevisionId;
  bodies: readonly OccTrackedBody[];
  constructions: readonly ConstructionSnapshotRecord[];
  sketches: readonly SketchSnapshotRecord[];
  features: readonly OccAuthoringFeatureRecordLike[];
}) {
  const references = new Map<string, ResolvedReferenceRecord>();

  const addReference = (
    resolution: Omit<ResolvedReferenceRecord, "invalidation">,
  ) => {
    const record = createResolvedReferenceRecord(resolution);
    references.set(getOccDurableRefKey(record.target), record);
  };

  for (const body of input.bodies) {
    addReference({
      label: body.label,
      target: { kind: "body", bodyId: body.bodyId },
      ownerDocumentId: input.documentId,
      ownerRevisionId: input.revisionId,
      ownerFeatureId: body.ownerFeatureId,
      ownerSketchId: null,
      ownerBodyId: body.bodyId,
    });

    for (const faceId of body.topology.faceIds) {
      addReference({
        label: `${body.label} Face ${faceId}`,
        target: { kind: "face", bodyId: body.bodyId, faceId },
        ownerDocumentId: input.documentId,
        ownerRevisionId: input.revisionId,
        ownerFeatureId: body.ownerFeatureId,
        ownerSketchId: null,
        ownerBodyId: body.bodyId,
      });
    }

    for (const edgeId of body.topology.edgeIds) {
      addReference({
        label: `${body.label} Edge ${edgeId}`,
        target: { kind: "edge", bodyId: body.bodyId, edgeId },
        ownerDocumentId: input.documentId,
        ownerRevisionId: input.revisionId,
        ownerFeatureId: body.ownerFeatureId,
        ownerSketchId: null,
        ownerBodyId: body.bodyId,
      });
    }

    for (const vertexId of body.topology.vertexIds) {
      addReference({
        label: `${body.label} Vertex ${vertexId}`,
        target: { kind: "vertex", bodyId: body.bodyId, vertexId },
        ownerDocumentId: input.documentId,
        ownerRevisionId: input.revisionId,
        ownerFeatureId: body.ownerFeatureId,
        ownerSketchId: null,
        ownerBodyId: body.bodyId,
      });
    }
  }

  for (const construction of input.constructions) {
    if (construction.target.kind !== "construction") {
      continue;
    }

    addReference({
      label: construction.label,
      target: construction.target,
      ownerDocumentId: input.documentId,
      ownerRevisionId: input.revisionId,
      ownerFeatureId: construction.ownerFeatureId,
      ownerSketchId: construction.ownerSketchId,
      ownerBodyId: construction.ownerBodyId,
    });
  }

  for (const sketch of input.sketches) {
    addReference({
      label: sketch.label,
      target: { kind: "sketch", sketchId: sketch.sketchId },
      ownerDocumentId: input.documentId,
      ownerRevisionId: input.revisionId,
      ownerFeatureId: sketch.ownerFeatureId,
      ownerSketchId: sketch.sketchId,
      ownerBodyId: sketch.ownerBodyId,
    });

    for (const point of sketch.sketch.definition.points) {
      addReference({
        label: point.label,
        target: {
          kind: "sketchPoint",
          sketchId: sketch.sketchId,
          pointId: point.pointId as SketchPointId,
        },
        ownerDocumentId: input.documentId,
        ownerRevisionId: input.revisionId,
        ownerFeatureId: sketch.ownerFeatureId,
        ownerSketchId: sketch.sketchId,
        ownerBodyId: sketch.ownerBodyId,
      });
    }

    for (const entity of sketch.sketch.definition.entities) {
      addReference({
        label: entity.label,
        target: {
          kind: "sketchEntity",
          sketchId: sketch.sketchId,
          entityId: entity.entityId as SketchEntityId,
        },
        ownerDocumentId: input.documentId,
        ownerRevisionId: input.revisionId,
        ownerFeatureId: sketch.ownerFeatureId,
        ownerSketchId: sketch.sketchId,
        ownerBodyId: sketch.ownerBodyId,
      });
    }

    for (const region of sketch.sketch.regions) {
      addReference({
        label: region.label,
        target: {
          kind: "region",
          sketchId: sketch.sketchId,
          regionId: region.regionId,
        },
        ownerDocumentId: input.documentId,
        ownerRevisionId: input.revisionId,
        ownerFeatureId: region.ownerFeatureId,
        ownerSketchId: sketch.sketchId,
        ownerBodyId: region.ownerBodyId,
      });
    }
  }

  for (const feature of input.features) {
    addReference({
      label: feature.featureId,
      target: { kind: "feature", featureId: feature.featureId },
      ownerDocumentId: input.documentId,
      ownerRevisionId: input.revisionId,
      ownerFeatureId: feature.featureId,
      ownerSketchId: null,
      ownerBodyId: null,
    });
  }

  return references;
}

export function createOccReferenceState(input: {
  documentId: DocumentId;
  revisionId: RevisionId;
  bodies: readonly OccTrackedBody[];
  constructions: readonly ConstructionSnapshotRecord[];
  sketches: readonly SketchSnapshotRecord[];
  features: readonly OccAuthoringFeatureRecordLike[];
  previous?: OccReferenceState;
  historyInvalidations?: ReadonlyMap<string, OccReferenceInvalidationRecord>;
}): OccReferenceState {
  const liveReferencesByKey = buildLiveReferenceMap(input);
  const invalidatedReferencesByKey = new Map(
    input.previous?.invalidatedReferencesByKey ?? [],
  );

  for (const key of liveReferencesByKey.keys()) {
    invalidatedReferencesByKey.delete(key);
  }

  for (const [key, previousResolution] of input.previous?.liveReferencesByKey ??
    []) {
    if (liveReferencesByKey.has(key)) {
      continue;
    }

    const invalidation = input.historyInvalidations?.get(key) ?? {
      target: previousResolution.target,
      reason: OCC_REFERENCE_INVALIDATION_REASONS.missing,
      sourceTarget: createInvalidationSourceTarget(previousResolution),
    };

    invalidatedReferencesByKey.set(
      key,
      createInvalidatedReferenceRecord(
        previousResolution,
        input.revisionId,
        invalidation,
      ),
    );
  }

  return {
    bodySnapshots: input.bodies.map((body) =>
      createBodySnapshotRecord(
        {
          documentId: input.documentId,
          revisionId: input.revisionId,
        },
        body,
      ),
    ),
    liveReferencesByKey,
    invalidatedReferencesByKey,
  };
}

export function resolveOccReference(
  input: {
    documentId: DocumentId;
    revisionId: RevisionId;
    referenceState: OccReferenceState;
  },
  target: DurableRef,
) {
  const key = getOccDurableRefKey(target);
  const live = input.referenceState.liveReferencesByKey.get(key);

  if (live) {
    return {
      resolution: live,
      diagnostics: [] as ModelingDiagnostic[],
    };
  }

  const invalidated = input.referenceState.invalidatedReferencesByKey.get(key);

  if (invalidated) {
    return {
      resolution: invalidated,
      diagnostics: [createMissingReferenceDiagnostic(invalidated)],
    };
  }

  const resolution = createInvalidatedReferenceRecord(
    {
      label: getDurableRefLabel(target),
      target,
      ownerDocumentId: input.documentId,
      ownerRevisionId: input.revisionId,
      ownerFeatureId: null,
      ownerSketchId: null,
      ownerBodyId: null,
    },
    input.revisionId,
    {
      target,
      reason: OCC_REFERENCE_INVALIDATION_REASONS.missing,
      sourceTarget: null,
    },
  );

  return {
    resolution,
    diagnostics: [createMissingReferenceDiagnostic(resolution)],
  };
}
