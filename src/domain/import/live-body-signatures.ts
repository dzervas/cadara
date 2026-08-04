import type {
  HistoryProbeExactTopologyEvidence,
  HistoryProbeFaceIncidence,
  HistoryProbeTopologySignature,
} from "@/contracts/import/capabilities";
import type { AuthoredFeatureTopologyLineage } from "@/contracts/modeling/authored-document";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { BodyId, FaceId } from "@/contracts/shared/ids";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import { deriveKernelTopologySignaturesFromExactBrepPayload } from "@/domain/modeling/occ/topology-signatures";

export interface LiveBodySignatureDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
}

export type LiveBodySignatureResult =
  | {
      status: "available";
      signatures: HistoryProbeTopologySignature[];
      /** Same exact evidence indexed while each body payload is derived. */
      signaturesByBody?: ReadonlyMap<BodyId, readonly HistoryProbeTopologySignature[]>;
      exactTopologyEvidence: HistoryProbeExactTopologyEvidence;
      diagnostics: LiveBodySignatureDiagnostic[];
    }
  | {
      status: "unavailable";
      diagnostics: LiveBodySignatureDiagnostic[];
    };

type LiveBodySignatureService = Pick<
  ModelingService,
  "buildNativeExactBrepPayload"
>;

function deriveBodyMeshSignature(
  snapshot: WorkspaceSnapshot,
  bodyId: BodyId,
): HistoryProbeTopologySignature | null {
  const points = snapshot.document.render.records.flatMap((record) =>
    record.ownerBodyId === bodyId && record.geometry.kind === "mesh"
      ? record.geometry.vertexPositions
      : [],
  );
  if (points.length === 0) return null;

  const low: [number, number, number] = [Infinity, Infinity, Infinity];
  const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (const axis of [0, 1, 2] as const) {
      low[axis] = Math.min(low[axis], point[axis]);
      high[axis] = Math.max(high[axis], point[axis]);
    }
  }

  return {
    entityClass: "body",
    geometryType: "solid",
    boundingBox: { low, high },
    centroid: [
      (low[0] + high[0]) / 2,
      (low[1] + high[1]) / 2,
      (low[2] + high[2]) / 2,
    ],
    reference: { kind: "body", bodyId },
  };
}

function deriveFaceIncidence(
  payload: import("@/domain/modeling/occ/native-topology-payload").OccNativeExactBrepPayload,
): HistoryProbeFaceIncidence[] {
  const body = payload.brep.bodies[0];
  if (!body) return [];
  const topology = body.topology;
  const faceEdges = topology.faces.map((face) =>
    new Set(
      face.loopIndices.flatMap((loopIndex) =>
        (topology.loops[loopIndex]?.coedgeIndices ?? []).flatMap((coedgeIndex) => {
          const edgeIndex = topology.coedges[coedgeIndex]?.edgeIndex;
          return edgeIndex === undefined ? [] : [edgeIndex];
        }),
      ),
    ),
  );
  const facesByEdge = new Map<number, number[]>();
  for (const [faceIndex, edges] of faceEdges.entries()) {
    for (const edgeIndex of edges) {
      const faces = facesByEdge.get(edgeIndex) ?? [];
      faces.push(faceIndex);
      facesByEdge.set(edgeIndex, faces);
    }
  }
  return topology.faces.map((face, faceIndex) => {
    const adjacent = new Set<number>();
    for (const edgeIndex of faceEdges[faceIndex] ?? []) {
      for (const candidate of facesByEdge.get(edgeIndex) ?? []) {
        if (candidate !== faceIndex) adjacent.add(candidate);
      }
    }
    return {
      bodyId: body.bodyKey as BodyId,
      faceId: face.faceKey as FaceId,
      adjacentFaceIds: [...adjacent]
        .map((index) => topology.faces[index]?.faceKey as FaceId | undefined)
        .filter((faceId): faceId is FaceId => faceId !== undefined)
        .sort(),
      planar: face.surface.kind === "plane",
    };
  });
}

/** Derive live native topology, with body-only mesh evidence limited to body identity. */
export async function deriveLiveBodySignatures(input: {
  snapshot: WorkspaceSnapshot;
  service: LiveBodySignatureService;
}): Promise<LiveBodySignatureResult> {
  const signatures: HistoryProbeTopologySignature[] = [];
  const diagnostics: LiveBodySignatureDiagnostic[] = [];
  const signaturesByBody = new Map<BodyId, readonly HistoryProbeTopologySignature[]>();
  const lineageByFeatureId = new Map<string, AuthoredFeatureTopologyLineage>();
  const faceIncidence: HistoryProbeFaceIncidence[] = [];

  for (const body of input.snapshot.document.bodies) {
    const bodyId = body.bodyId as BodyId;
    if (body.topologyPresentation === "bodyOnlyMesh") {
      const signature = deriveBodyMeshSignature(
        input.snapshot,
        bodyId,
      );
      if (!signature) {
        return {
          status: "unavailable",
          diagnostics: [{
            severity: "error",
            code: "import-body-only-mesh-signature-unavailable",
            message: `Body-only mesh ${body.bodyId} has no render mesh for signature derivation.`,
          }],
        };
      }
      signatures.push(signature);
      signaturesByBody.set(bodyId, [signature]);
      continue;
    }

    const result = await input.service.buildNativeExactBrepPayload({
      baseRevisionId: input.snapshot.document.revisionId,
      target: { kind: "body", bodyId },
    });
    if (result.kind !== "nativeTopologyPayload") {
      const signature = deriveBodyMeshSignature(
        input.snapshot,
        bodyId,
      );
      if (signature) {
        signatures.push(signature);
        signaturesByBody.set(bodyId, [signature]);
        continue;
      }
      return {
        status: "unavailable",
        diagnostics: result.diagnostics.map((diagnostic) => ({
          severity: diagnostic.severity,
          code: diagnostic.code,
          message: diagnostic.message,
        })),
      };
    }

    const derived = deriveKernelTopologySignaturesFromExactBrepPayload(
      result.payload,
    );
    if (derived.status === "unavailable") {
      const signature = deriveBodyMeshSignature(
        input.snapshot,
        bodyId,
      );
      if (signature) {
        signatures.push(signature);
        signaturesByBody.set(bodyId, [signature]);
        continue;
      }
      return {
        status: "unavailable",
        diagnostics: derived.diagnostics.map((diagnostic) => ({
          severity: diagnostic.severity,
          code: diagnostic.code,
          message: diagnostic.message,
        })),
      };
    }

    for (const lineage of result.payload.topologyLineage ?? []) {
      const existing = lineageByFeatureId.get(lineage.featureId);
      lineageByFeatureId.set(
        lineage.featureId,
        existing
          ? { ...existing, outputs: [...existing.outputs, ...lineage.outputs] }
          : lineage,
      );
    }
    faceIncidence.push(...deriveFaceIncidence(result.payload));
    signatures.push(...derived.signatures);
    signaturesByBody.set(bodyId, derived.signatures);
    diagnostics.push(
      ...derived.diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
      })),
    );
  }

  return {
    status: "available",
    signatures,
    signaturesByBody,
    exactTopologyEvidence: {
      topologyLineage: [...lineageByFeatureId.values()],
      faceIncidence,
      actionOutputs: [],
    },
    diagnostics,
  };
}
