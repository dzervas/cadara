import type { HistoryProbeTopologySignature } from "@/contracts/import/capabilities";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { BodyId } from "@/contracts/shared/ids";
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

/** Derive live native topology, with body-only mesh evidence limited to body identity. */
export async function deriveLiveBodySignatures(input: {
  snapshot: WorkspaceSnapshot;
  service: LiveBodySignatureService;
}): Promise<LiveBodySignatureResult> {
  const signatures: HistoryProbeTopologySignature[] = [];
  const diagnostics: LiveBodySignatureDiagnostic[] = [];

  for (const body of input.snapshot.document.bodies) {
    if (body.topologyPresentation === "bodyOnlyMesh") {
      const signature = deriveBodyMeshSignature(
        input.snapshot,
        body.bodyId as BodyId,
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
      continue;
    }

    const result = await input.service.buildNativeExactBrepPayload({
      baseRevisionId: input.snapshot.document.revisionId,
      target: { kind: "body", bodyId: body.bodyId as BodyId },
    });
    if (result.kind !== "nativeTopologyPayload") {
      const signature = deriveBodyMeshSignature(
        input.snapshot,
        body.bodyId as BodyId,
      );
      if (signature) {
        signatures.push(signature);
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
        body.bodyId as BodyId,
      );
      if (signature) {
        signatures.push(signature);
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

    signatures.push(...derived.signatures);
    diagnostics.push(
      ...derived.diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
      })),
    );
  }

  return { status: "available", signatures, diagnostics };
}
