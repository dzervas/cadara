import type { HistoryProbeTopologySignature } from "@/contracts/import/capabilities";
import type {
  CadaraBrepCurve3Record,
  CadaraBrepGeometryAssetBody,
  CadaraBrepSurfaceRecord,
  GeometryAssetPoint3,
} from "@/contracts/modeling/geometry-assets";
import type { BodyId, EdgeId, FaceId, VertexId } from "@/contracts/shared/ids";
import type { OccNativeExactBrepPayload, OccNativeTopologyDiagnostic } from "@/domain/modeling/occ/native-topology-payload";

export type KernelTopologySignatureCapabilityDiagnostic =
  OccNativeTopologyDiagnostic & {
    code: "kernel-topology-signatures-missing-exact-brep-records";
    severity: "error";
  };

export type KernelTopologySignatureDerivationResult =
  | {
      status: "available";
      signatures: HistoryProbeTopologySignature[];
      diagnostics: readonly OccNativeTopologyDiagnostic[];
    }
  | {
      status: "unavailable";
      signatures: [];
      diagnostics: readonly KernelTopologySignatureCapabilityDiagnostic[];
    };

const supportedSurfaceTypes = new Set([
  "plane",
  "cylinder",
  "cone",
  "sphere",
]);
const supportedCurveTypes = new Set(["line", "circle"]);

export function deriveKernelTopologySignaturesFromExactBrepPayload(
  payload: OccNativeExactBrepPayload,
): KernelTopologySignatureDerivationResult {
  const body = payload.brep.bodies[0];

  if (!hasRequiredExactBrepRecords(payload, body)) {
    return {
      status: "unavailable",
      signatures: [],
      diagnostics: [createMissingExactBrepRecordsDiagnostic(payload)],
    };
  }

  return {
    status: "available",
    signatures: deriveBodySignatures(body),
    diagnostics: payload.diagnostics,
  };
}

function hasRequiredExactBrepRecords(
  payload: OccNativeExactBrepPayload,
  body: CadaraBrepGeometryAssetBody | undefined,
) {
  if (!body) {
    return false;
  }

  const topology = body.topology;
  return (
    topology.faces.length > 0 &&
    topology.edges.length > 0 &&
    topology.vertices.length > 0 &&
    payload.tables.surfaces.rowCount >= topology.faces.length &&
    payload.tables.curves.rowCount >= topology.edges.length
  );
}

function createMissingExactBrepRecordsDiagnostic(
  payload: OccNativeExactBrepPayload,
): KernelTopologySignatureCapabilityDiagnostic {
  return {
    code: "kernel-topology-signatures-missing-exact-brep-records",
    severity: "error",
    message:
      "Kernel topology signatures require native exact-B-rep surface and curve records, but this payload does not contain the required records.",
    target: payload.target,
    detail: {
      surfaceRows: payload.tables.surfaces.rowCount,
      curveRows: payload.tables.curves.rowCount,
      bodyCount: payload.brep.bodies.length,
      exactBrepDiagnostics: payload.diagnostics.map((diagnostic) => diagnostic.code),
    },
  };
}

function deriveBodySignatures(
  body: CadaraBrepGeometryAssetBody,
): HistoryProbeTopologySignature[] {
  const bodyId = body.bodyKey as BodyId;
  const topology = body.topology;
  const signatures: HistoryProbeTopologySignature[] = [];
  const bodyPoints = topology.faces.flatMap((face) => face.meshVertices);
  const bodyBox = boundingBox(bodyPoints);
  signatures.push({
    entityClass: "body",
    geometryType: "solid",
    boundingBox: bodyBox,
    centroid: bodyBox ? centerOfBoundingBox(bodyBox) : undefined,
    reference: { kind: "body", bodyId },
  });

  for (const face of topology.faces) {
    const bbox = boundingBox(face.meshVertices);
    signatures.push({
      entityClass: "face",
      geometryType: geometryTypeForSurface(face.surface),
      definingData: definingDataForSurface(face.surface),
      boundingBox: bbox,
      centroid: bbox ? centerOfBoundingBox(bbox) : undefined,
      reference: { kind: "face", bodyId, faceId: face.faceKey as FaceId },
    });
  }

  for (const edge of topology.edges) {
    const vertices = edge.vertices
      .map((vertexIndex) => topology.vertices[vertexIndex]?.point)
      .filter((point): point is GeometryAssetPoint3 => point != null);
    const bbox = boundingBoxForCurve(edge.curve, vertices);
    signatures.push({
      entityClass: "edge",
      geometryType: geometryTypeForCurve(edge.curve),
      definingData: definingDataForCurve(edge.curve),
      boundingBox: bbox,
      centroid: bbox ? centerOfBoundingBox(bbox) : undefined,
      reference: { kind: "edge", bodyId, edgeId: edge.edgeKey as EdgeId },
    });
  }

  for (const vertex of topology.vertices) {
    const bbox = boundingBox([vertex.point]);
    signatures.push({
      entityClass: "vertex",
      geometryType: "point",
      definingData: { point: vertex.point },
      boundingBox: bbox,
      centroid: [...vertex.point],
      reference: {
        kind: "vertex",
        bodyId,
        vertexId: vertex.vertexKey as VertexId,
      },
    });
  }

  return signatures;
}

function geometryTypeForSurface(surface: CadaraBrepSurfaceRecord) {
  return supportedSurfaceTypes.has(surface.kind) ? surface.kind : "generic-surface";
}

function geometryTypeForCurve(curve: CadaraBrepCurve3Record) {
  return supportedCurveTypes.has(curve.kind) ? curve.kind : "generic-curve";
}

function definingDataForSurface(surface: CadaraBrepSurfaceRecord) {
  switch (surface.kind) {
    case "plane":
      return {
        origin: surface.frame.origin,
        normal: surface.frame.zDirection,
        xDirection: surface.frame.xDirection,
      };
    case "cylinder":
      return {
        axisOrigin: surface.frame.origin,
        axisDirection: surface.frame.zDirection,
        xDirection: surface.frame.xDirection,
        radius: surface.radius,
      };
    case "cone":
      return {
        axisOrigin: surface.frame.origin,
        axisDirection: surface.frame.zDirection,
        xDirection: surface.frame.xDirection,
        radius: surface.radius,
        semiAngleRadians: surface.semiAngleRadians,
      };
    case "sphere":
      return {
        center: surface.frame.origin,
        axisDirection: surface.frame.zDirection,
        xDirection: surface.frame.xDirection,
        radius: surface.radius,
      };
    default:
      return undefined;
  }
}

function definingDataForCurve(curve: CadaraBrepCurve3Record) {
  switch (curve.kind) {
    case "line":
      return {
        origin: curve.origin,
        direction: curve.direction,
        parameterRange: curve.parameterRange,
      };
    case "circle":
      return {
        center: curve.center,
        axisDirection: curve.axisDirection,
        xDirection: curve.xDirection,
        radius: curve.radius,
        parameterRange: curve.parameterRange,
      };
    default:
      return undefined;
  }
}

function boundingBoxForCurve(
  curve: CadaraBrepCurve3Record,
  vertices: readonly GeometryAssetPoint3[],
) {
  if (curve.kind === "circle") {
    const [x, y, z] = curve.center;
    const radius = curve.radius;
    return {
      low: [x - radius, y - radius, z - radius] as [number, number, number],
      high: [x + radius, y + radius, z + radius] as [number, number, number],
    };
  }

  return boundingBox(vertices);
}

function boundingBox(points: readonly GeometryAssetPoint3[]) {
  if (points.length === 0) {
    return undefined;
  }

  const low: [number, number, number] = [Infinity, Infinity, Infinity];
  const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const point of points) {
    for (const axis of [0, 1, 2] as const) {
      low[axis] = Math.min(low[axis], point[axis]);
      high[axis] = Math.max(high[axis], point[axis]);
    }
  }

  return { low, high };
}

function centerOfBoundingBox(box: {
  low: [number, number, number];
  high: [number, number, number];
}): [number, number, number] {
  return [
    (box.low[0] + box.high[0]) / 2,
    (box.low[1] + box.high[1]) / 2,
    (box.low[2] + box.high[2]) / 2,
  ];
}
