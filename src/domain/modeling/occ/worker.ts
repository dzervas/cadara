import type {
  GeometryAssetResolver,
  ResolvedGeometryAssetBytes,
} from "@/contracts/modeling/adapter";
import type {
  BakedGeometryAssetReference,
  GeometryAssetBlobInput,
} from "@/contracts/modeling/geometry-assets";
import type { DocumentId, GeometryAssetId, RequestId } from "@/contracts/shared/ids";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { packWorkspaceSnapshotRenderMeshes } from "@/domain/modeling/occ/mesh-transport";
import {
  loadDefaultOpenCascadeFactory,
  probeOpenCascadeNativeTopologyKernelCapabilities,
  type OpenCascadeInstance,
} from "@/domain/modeling/occ/runtime";
import { getVersionedOpenCascadeRuntimeAssetUrls } from "@/domain/modeling/occ/assets";
import {
  getOccNativeTopologyTransferList,
  type OccNativeTopologyWorkerResultWithBuffers,
} from "@/domain/modeling/occ/native-topology-payload";
import {
  normalizeOccWorkerFailure,
  validateOccWorkerRequestEnvelope,
  type OccWorkerAssetConfig,
  type OccWorkerOperation,
  type OccWorkerRequest,
  type OccWorkerResponse,
} from "@/domain/modeling/occ/worker-protocol";
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
} from "@/domain/modeling/opencascade-kernel-seed";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

let openCascadePromise: Promise<OpenCascadeInstance> | null = null;
let lastAssets: OccWorkerAssetConfig | undefined;
const adapters = new Map<string, OpenCascadeKernelAdapter>();
let requestQueue: Promise<void> = Promise.resolve();
let assetRequestSequence = 0;
const pendingAssetRequests = new Map<
  RequestId,
  {
    assetId: GeometryAssetId;
    resolve: (value: ResolvedGeometryAssetBytes | null) => void;
    reject: (error: Error) => void;
  }
>();
const resolvedAssetCache = new Map<GeometryAssetId, ResolvedGeometryAssetBytes>();

interface OccWorkerGlobalScope {
  postMessage(message: OccWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<OccWorkerRequest>) => void,
  ): void;
}

interface PackedSnapshotOperationResult {
  contractVersion: "modeling-contract/v1alpha1";
  snapshot: ReturnType<typeof packWorkspaceSnapshotRenderMeshes>["snapshot"];
  transferList: Transferable[];
}

const workerScope = self as unknown as OccWorkerGlobalScope;

function postOccWorkerMessage(
  message: OccWorkerResponse,
  transfer?: Transferable[],
) {
  workerScope.postMessage(message, transfer ?? []);
}

function getWorkerOpenCascadeInstance(assets?: OccWorkerAssetConfig) {
  lastAssets = assets ?? lastAssets ?? {
    mainWasm: getVersionedOpenCascadeRuntimeAssetUrls().mainWasm,
  };

  if (!openCascadePromise) {
    openCascadePromise = loadDefaultOpenCascadeFactory({ isNodeRuntime: false })
      .then((initializeOpenCascade) => initializeOpenCascade(lastAssets))
      .catch((error: unknown) => {
        openCascadePromise = null;
        throw error;
      });
  }

  return openCascadePromise;
}

async function probeWorkerNativeTopologyKernelCapabilities(
  assets?: OccWorkerAssetConfig,
) {
  const oc = await getWorkerOpenCascadeInstance(assets);
  return probeOpenCascadeNativeTopologyKernelCapabilities(oc);
}

function getWorkerAdapter(documentId: DocumentId) {
  const existing = adapters.get(documentId);
  if (existing) {
    return existing;
  }

  const adapter = new OpenCascadeKernelAdapter({
    documentId,
    solverAdapter: new SketchConstraintSolverAdapter({
      documentId,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
    }),
    solverAdapterFactory: (revisionId) =>
      new SketchConstraintSolverAdapter({
        documentId,
        revisionId,
      }),
    getOpenCascadeInstance: () => getWorkerOpenCascadeInstance(),
    initialSnapshotRequiresRuntime: true,
    assetResolver: createWorkerAssetResolver(undefined),
  });
  adapters.set(documentId, adapter);

  return adapter;
}

function requestMainThreadGeometryAsset(
  reference: BakedGeometryAssetReference,
): Promise<ResolvedGeometryAssetBytes | null> {
  const cached = resolvedAssetCache.get(reference.assetId);
  if (cached) {
    return Promise.resolve({ bytes: cached.bytes.slice(), format: cached.format });
  }
  assetRequestSequence += 1;
  const requestId =
    `request_occ_resolve_geometry_asset_${assetRequestSequence}` as RequestId;

  return new Promise((resolve, reject) => {
    pendingAssetRequests.set(requestId, {
      assetId: reference.assetId,
      resolve,
      reject,
    });
    postOccWorkerMessage({
      kind: "resolveGeometryAsset",
      requestId,
      reference,
    });
  });
}

function handleGeometryAssetResult(
  request: Extract<OccWorkerRequest, { kind: "resolveGeometryAssetResult" }>,
) {
  const pending = pendingAssetRequests.get(request.requestId);
  if (!pending) {
    return;
  }

  pendingAssetRequests.delete(request.requestId);
  if (pending.assetId !== request.assetId) {
    pending.reject(new Error("OCC worker geometry asset response id mismatch."));
    return;
  }

  if (request.asset) {
    resolvedAssetCache.set(request.assetId, {
      bytes: request.asset.bytes.slice(),
      format: request.asset.format,
    });
  }
  pending.resolve(request.asset);
}

async function getWorkerExportCapabilities(
  operation: Extract<
    OccWorkerOperation,
    {
      kind:
        | "tessellateExportMesh"
        | "writeStepExport"
        | "resolveSketchVectorExportModel";
    }
  >,
) {
  const capabilitiesOrDiagnostic = await getWorkerAdapter(
    operation.documentId,
  ).getExportCapabilities(operation.baseRevisionId);

  if ("code" in capabilitiesOrDiagnostic) {
    return capabilitiesOrDiagnostic;
  }

  return capabilitiesOrDiagnostic;
}

async function handleWorkerOperation(operation: OccWorkerOperation) {
  switch (operation.kind) {
    case "warmup":
      await getWorkerOpenCascadeInstance(operation.assets);
      await getWorkerAdapter(OCC_KERNEL_DOCUMENT_ID).preloadRuntime();
      return undefined;
    case "probeNativeTopologyKernelCapabilities":
      return probeWorkerNativeTopologyKernelCapabilities(operation.assets);
    case "buildNativeTopologySnapshot":
      return getWorkerAdapter(
        operation.request.documentId,
      ).buildNativeTopologySnapshot(operation.request, operation.lodTierId);
    case "executeNativeFeatureHistoryRebuild":
      return getWorkerAdapter(
        operation.document.documentId,
      ).executeNativeFeatureHistoryRebuild(
        operation.document,
        operation.diagnostics ?? [],
        operation.assets ?? [],
        operation.lodTierId,
      );
    case "buildNativeBooleanFeatureTransactionPayload":
      return getWorkerAdapter(
        operation.documentId,
      ).buildNativeBooleanFeatureTransactionPayload(
        operation.documentId,
        operation.baseRevisionId,
        operation.leftBodyId,
        operation.rightBodyId,
        operation.operation,
        operation.lodTierId,
      );
    case "buildNativeMeshExportPayload":
      return getWorkerAdapter(
        operation.documentId,
      ).buildNativeMeshExportPayload(
        operation.documentId,
        operation.baseRevisionId,
        operation.target,
        operation.options,
      );
    case "buildNativeExactBrepPayload":
      return getWorkerAdapter(operation.documentId).buildNativeExactBrepPayload(
        operation.documentId,
        operation.baseRevisionId,
        operation.target,
      );
    case "restoreAuthoredModelDocument":
      await getWorkerAdapter(
        operation.document.documentId,
      ).restoreAuthoredModelDocument?.(
        operation.document,
        operation.diagnostics ?? [],
        createWorkerAssetResolver(operation.assets),
      );
      return undefined;
    case "validateAuthoredModelDocument":
      await getWorkerAdapter(
        operation.document.documentId,
      ).validateAuthoredModelDocument?.(
        operation.document,
        operation.diagnostics ?? [],
        createWorkerAssetResolver(operation.assets),
      );
      return undefined;
    case "exportAuthoredModelDocument":
      return getWorkerAdapter(
        operation.documentId,
      ).exportAuthoredModelDocument?.(operation.documentId);
    case "getDocumentSnapshot": {
      const workerAdapter = getWorkerAdapter(operation.request.documentId);
      workerAdapter.setSnapshotLodTier(operation.lodTierId ?? "startup");
      const response = await workerAdapter.getDocumentSnapshot(
        operation.request,
      );
      const packed = packWorkspaceSnapshotRenderMeshes(response.snapshot);
      return {
        contractVersion: response.contractVersion,
        snapshot: packed.snapshot,
        transferList: packed.transferList,
      } satisfies PackedSnapshotOperationResult;
    }
    case "projectSketchExternalReferences":
      return getWorkerAdapter(
        operation.request.documentId,
      ).projectSketchExternalReferences(operation.request);
    case "commitSketch":
      return getWorkerAdapter(operation.request.documentId).commitSketch(
        operation.request,
      );
    case "createFeature":
      return getWorkerAdapter(operation.request.documentId).createFeature(
        operation.request,
      );
    case "updateFeature":
      return getWorkerAdapter(operation.request.documentId).updateFeature(
        operation.request,
      );
    case "setFeatureSuppression":
      return getWorkerAdapter(
        operation.request.documentId,
      ).setFeatureSuppression(operation.request);
    case "deleteFeature":
      return getWorkerAdapter(operation.request.documentId).deleteFeature(
        operation.request,
      );
    case "deleteTarget":
      return getWorkerAdapter(operation.request.documentId).deleteTarget(
        operation.request,
      );
    case "renameBody":
      return getWorkerAdapter(operation.request.documentId).renameBody(
        operation.request,
      );
    case "reorderFeature":
      return getWorkerAdapter(operation.request.documentId).reorderFeature(
        operation.request,
      );
    case "reorderDocumentHistory":
      return getWorkerAdapter(
        operation.request.documentId,
      ).reorderDocumentHistory(operation.request);
    case "setFeatureCursor":
      return getWorkerAdapter(operation.request.documentId).setFeatureCursor(
        operation.request,
      );
    case "addDocumentVariable":
      return getWorkerAdapter(operation.request.documentId).addDocumentVariable(
        operation.request,
      );
    case "updateDocumentVariable":
      return getWorkerAdapter(
        operation.request.documentId,
      ).updateDocumentVariable(operation.request);
    case "evaluatePreview":
      return getWorkerAdapter(operation.request.documentId).evaluatePreview(
        operation.request,
      );
    case "resolveReference":
      return getWorkerAdapter(operation.request.documentId).resolveReference(
        operation.request,
      );
    case "tessellateExportMesh": {
      const capabilitiesOrDiagnostic =
        await getWorkerExportCapabilities(operation);

      if ("code" in capabilitiesOrDiagnostic) {
        return capabilitiesOrDiagnostic;
      }

      return capabilitiesOrDiagnostic.mesh.tessellate(
        operation.target,
        operation.options,
      );
    }
    case "writeStepExport": {
      const capabilitiesOrDiagnostic =
        await getWorkerExportCapabilities(operation);

      if ("code" in capabilitiesOrDiagnostic) {
        return { diagnostic: capabilitiesOrDiagnostic };
      }

      return capabilitiesOrDiagnostic.brep.writeStep(
        operation.target,
        operation.options,
      );
    }
    case "resolveSketchVectorExportModel": {
      const capabilitiesOrDiagnostic =
        await getWorkerExportCapabilities(operation);

      if ("code" in capabilitiesOrDiagnostic) {
        return { diagnostic: capabilitiesOrDiagnostic };
      }

      return capabilitiesOrDiagnostic.sketchVector.resolveSketchVectorModel(
        operation.target,
      );
    }
  }
}

async function handleOccWorkerRequest(request: OccWorkerRequest) {
  switch (request.kind) {
    case "invoke": {
      const result = await handleWorkerOperation(request.operation);
      if (
        request.operation.kind === "getDocumentSnapshot" &&
        result &&
        typeof result === "object" &&
        "snapshot" in result &&
        "transferList" in result
      ) {
        const snapshotResult = result as PackedSnapshotOperationResult;
        postOccWorkerMessage(
          {
            kind: "invoked",
            requestId: request.requestId,
            operation: request.operation.kind,
            payload: {
              contractVersion: snapshotResult.contractVersion,
              snapshot: snapshotResult.snapshot,
            },
          },
          snapshotResult.transferList,
        );
        return;
      }

      if (
        (request.operation.kind === "buildNativeTopologySnapshot" ||
          request.operation.kind === "executeNativeFeatureHistoryRebuild" ||
          request.operation.kind ===
            "buildNativeBooleanFeatureTransactionPayload" ||
          request.operation.kind === "buildNativeMeshExportPayload" ||
          request.operation.kind === "buildNativeExactBrepPayload") &&
        result &&
        typeof result === "object" &&
        "kind" in result
      ) {
        postOccWorkerMessage(
          {
            kind: "invoked",
            requestId: request.requestId,
            operation: request.operation.kind,
            payload: result,
          },
          getOccNativeTopologyTransferList(
            result as OccNativeTopologyWorkerResultWithBuffers,
          ),
        );
        return;
      }

      postOccWorkerMessage({
        kind: "invoked",
        requestId: request.requestId,
        operation: request.operation.kind,
        payload: result,
      });
      return;
    }
    case "cancel":
      postOccWorkerMessage(
        normalizeOccWorkerFailure(
          request.cancelsRequestId,
          new Error("OCC worker request was cancelled."),
          "occ-worker-request-cancelled",
        ),
      );
      return;
  }
}

function createWorkerAssetResolver(
  assets: readonly GeometryAssetBlobInput[] | undefined,
): GeometryAssetResolver {
  const blobsByHash = new Map(
    (assets ?? []).map((asset) => [asset.asset.hash, asset.bytes.slice()] as const),
  );
  const blobsById = new Map(
    (assets ?? []).map((asset) => [asset.asset.assetId, asset] as const),
  );

  return {
    async resolveGeometryAsset(reference) {
      const local = blobsById.get(reference.assetId);
      if (local) {
        return { bytes: local.bytes.slice(), format: local.asset.format };
      }
      return requestMainThreadGeometryAsset(reference);
    },
    async getGeometryAssetBytes(hash) {
      return blobsByHash.get(hash)?.slice() ?? null;
    },
  };
}

function enqueueOccWorkerRequest(request: OccWorkerRequest) {
  requestQueue = requestQueue
    .then(() => handleOccWorkerRequest(request))
    .catch((error: unknown) => {
      postOccWorkerMessage(
        normalizeOccWorkerFailure(
          request.requestId,
          error,
          request.kind === "invoke" && request.operation.kind === "warmup"
            ? "occ-worker-initialization-failed"
            : "occ-worker-request-failed",
        ),
      );
    });
}

workerScope.addEventListener(
  "message",
  (event: MessageEvent<OccWorkerRequest>) => {
    if (event.data?.kind === "resolveGeometryAssetResult") {
      handleGeometryAssetResult(event.data);
      return;
    }
    const parsed = validateOccWorkerRequestEnvelope(event.data);
    const requestId =
      typeof event.data?.requestId === "string"
        ? event.data.requestId
        : ("request_occ_worker_unknown" as const);

    if (!parsed.success) {
      postOccWorkerMessage(
        normalizeOccWorkerFailure(
          requestId,
          parsed.errors[0]
            ? (parsed.errors[0].description ??
              `${parsed.errors[0].path} must match ${parsed.errors[0].expected}`)
            : undefined,
          "occ-worker-request-failed",
        ),
      );
      return;
    }

    enqueueOccWorkerRequest(parsed.data);
  },
);
