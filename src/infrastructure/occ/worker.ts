import type {
  GeometryAssetResolver,
  ResolvedGeometryAssetBytes,
} from "@/contracts/modeling/adapter";
import type {
  BakedGeometryAssetReference,
  GeometryAssetBlobInput,
} from "@/contracts/modeling/geometry-assets";
import type { DocumentId, GeometryAssetId, RequestId } from "@/contracts/shared/ids";
import { OpenCascadeKernelAdapter } from "@/infrastructure/occ/opencascade-kernel-adapter";
import { packWorkspaceSnapshotRenderMeshes } from "@/infrastructure/occ/mesh-transport";
import { loadDefaultOpenCascadeFactory } from "@/infrastructure/occ/runtime";
import { createEngineDownloadInstantiateWasm } from "@/infrastructure/occ/engine-download";
import { OCC_WASM_BYTE_LENGTH } from "@/infrastructure/occ/asset-version";
import {
  probeOpenCascadeNativeTopologyKernelCapabilities,
  type OpenCascadeInstance,
} from "@/infrastructure/occ/kernel-capabilities";
import { getVersionedOpenCascadeRuntimeAssetUrls } from "@/infrastructure/occ/assets";
import {
  getOccNativeTopologyTransferList,
  type OccNativeTopologyWorkerResultWithBuffers,
} from "@/infrastructure/occ/native-topology-payload";
import {
  isOccRuntimeAbort,
  normalizeOccWorkerFailure,
  validateOccWorkerRequestEnvelope,
  type OccSnapshotLodRefinementOutcome,
  type OccWorkerAssetConfig,
  type OccWorkerOperation,
  type OccWorkerRequest,
  type OccWorkerResponse,
} from "@/infrastructure/occ/worker-protocol";
import {
  OCC_KERNEL_DOCUMENT_ID,
} from "@/core/modeling/opencascade-kernel-seed";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";
import { createOpenCascadeNeutralCurveQueryCapability } from "@/infrastructure/occ/neutral-curve-query";
import {
  createIndexedDbModelCheckpointStore,
  fingerprintBrowserModelCheckpointRuntime,
} from "@/infrastructure/persistence/indexeddb-model-checkpoint-store";
import type { ModelCheckpointEvent } from "@/infrastructure/persistence/model-checkpoint-store";

let openCascadePromise: Promise<OpenCascadeInstance> | null = null;
let lastAssets: OccWorkerAssetConfig | undefined;
const adapters = new Map<string, OpenCascadeKernelAdapter>();
/**
 * The running background LOD refinement per document; a newer one, or the
 * document's release, supersedes it.
 */
const snapshotLodRefinements = new Map<DocumentId, RequestId>();
let runtimeAborted = false;
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
    const download = createEngineDownloadInstantiateWasm({
      url: lastAssets.mainWasm ?? getVersionedOpenCascadeRuntimeAssetUrls().mainWasm,
      totalBytes: OCC_WASM_BYTE_LENGTH,
      onProgress: (progress) =>
        postOccWorkerMessage({ kind: "engineDownloadProgress", ...progress }),
    });
    openCascadePromise = loadDefaultOpenCascadeFactory({ isNodeRuntime: false })
      // The explicit return type keeps TypeScript 7 from structurally comparing
      // the ~25k-member OpenCascadeInstance against the inferred
      // `T | PromiseLike<T>` callback result, which alone cost over a minute
      // of type checking.
      .then((initializeOpenCascade): Promise<OpenCascadeInstance> => Promise.race([
        initializeOpenCascade({
          ...lastAssets,
          module: {
            onAbort: (reason: unknown) => reportRuntimeAbort(reason),
            instantiateWasm: download.instantiateWasm,
          },
        }),
        download.failure,
      ]))
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

function reportModelCheckpointEvent(event: ModelCheckpointEvent) {
  // The cache only ever falls back to the cold open; a failing cache is a
  // warning for whoever debugs a slow reload, never a modelling failure.
  if (event.kind === "degraded") console.warn("[model-checkpoint]", event);
  else console.debug("[model-checkpoint]", event);
}

/**
 * cadara-dx2k.6: evaluated checkpoints of stored-document opens, shared by
 * every document of this worker. A dev server's worker is no content-named
 * bundle (its modules change under the same URL), so it never caches.
 */
const modelCheckpoints = createIndexedDbModelCheckpointStore({
  fingerprint: () =>
    import.meta.env.DEV
      ? Promise.resolve(null)
      : fingerprintBrowserModelCheckpointRuntime({
          workerScriptPath: self.location.pathname,
          userAgent: navigator.userAgent,
        }),
  report: reportModelCheckpointEvent,
});

/**
 * A cold open's checkpoint is encoded and stored once the open's snapshot was
 * answered, as its own entry at the tail of the serial queue (after the
 * requests already delivered), so neither the open nor its first render waits
 * for it.
 */
function publishPendingModelCheckpointAfterSnapshot(documentId: DocumentId) {
  setTimeout(() => {
    requestQueue = requestQueue
      .then(() => {
        const adapter = adapters.get(documentId);
        return runtimeAborted || !adapter
          ? undefined
          : adapter.publishPendingModelCheckpoint();
      })
      .catch((error: unknown) => {
        if (isOccRuntimeAbort(error)) {
          reportRuntimeAbort(error);
          return;
        }
        // The open already succeeded; only its cache entry is lost.
        modelCheckpoints.report({
          kind: "degraded",
          key: null,
          reason: `publication-failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      });
  }, 0);
}

/** The worker's own OCC query capability, answering main-thread query requests. */
const workerNeutralCurveQueries = createOpenCascadeNeutralCurveQueryCapability(
  () => getWorkerOpenCascadeInstance(),
);

function getWorkerAdapter(documentId: DocumentId) {
  const existing = adapters.get(documentId);
  if (existing) {
    return existing;
  }

  const adapter = new OpenCascadeKernelAdapter({
    documentId,
    createSolverAdapter: (revisionId, neutralCurveQueries) =>
      new SketchConstraintSolverAdapter({
        documentId,
        revisionId,
        neutralCurveQueries,
      }),
    getOpenCascadeInstance: () => getWorkerOpenCascadeInstance(),
    initialSnapshotRequiresRuntime: true,
    assetResolver: createWorkerAssetResolver(undefined),
    modelCheckpoints,
    modelCheckpointPublication: "deferred",
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

async function handleWorkerOperation(
  requestId: RequestId,
  operation: OccWorkerOperation,
) {
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
    case "restoreAuthoredModelDocument": {
      const { reportProgress, ...restoreOptions } = operation.options ?? {};
      await getWorkerAdapter(
        operation.document.documentId,
      ).restoreAuthoredModelDocument?.(
        operation.document,
        operation.diagnostics ?? [],
        createWorkerAssetResolver(operation.assets),
        {
          ...restoreOptions,
          // postMessage only queues: the rebuild loop stays synchronous while
          // the main thread receives each update as it is posted. Restores
          // nobody watches (peer sync, undo) post nothing.
          onProgress: reportProgress
            ? (progress) =>
                postOccWorkerMessage({
                  kind: "restoreProgress",
                  requestId,
                  progress,
                })
            : undefined,
        },
      );
      return undefined;
    }
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
    case "releaseDocument":
      snapshotLodRefinements.delete(operation.documentId);
      adapters.get(operation.documentId)?.dispose();
      adapters.delete(operation.documentId);
      return undefined;
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
    case "refineSnapshotLod":
      throw new Error(
        "Snapshot LOD refinement runs between the serial requests, not as one of them.",
      );
    case "projectSketchExternalReferences":
      return getWorkerAdapter(
        operation.request.documentId,
      ).projectSketchExternalReferences(operation.request);
    case "queryNeutralCurves":
      return workerNeutralCurveQueries.queryNeutralCurves(operation.request);
    case "queryNeutralCurveSelfIntersections":
      return workerNeutralCurveQueries.queryNeutralCurveSelfIntersections(
        operation.request,
      );
    case "queryNeutralCurveJoin":
      return workerNeutralCurveQueries.queryNeutralCurveJoin(operation.request);
    case "deriveSketchRegions":
      // Live derivation must never queue ahead of feature preview/commit here.
      throw new Error(
        "Sketch region derivation runs in the dedicated sketch-derivation worker, not the OCC kernel worker.",
      );
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
    case "renameFeature":
      return getWorkerAdapter(operation.request.documentId).renameFeature(
        operation.request,
      );
    case "renameSketch":
      return getWorkerAdapter(operation.request.documentId).renameSketch(
        operation.request,
      );
    case "renameDocument":
      return getWorkerAdapter(operation.request.documentId).renameDocument(
        operation.request,
      );
    case "setBodyAppearance":
      return getWorkerAdapter(operation.request.documentId).setBodyAppearance(
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
    case "removeDocumentVariable":
      return getWorkerAdapter(
        operation.request.documentId,
      ).removeDocumentVariable(operation.request);
    case "evaluatePreview":
      return getWorkerAdapter(operation.request.documentId).evaluatePreview(
        operation.request,
      );
    case "resolveReference":
      return getWorkerAdapter(operation.request.documentId).resolveReference(
        operation.request,
      );
    case "measureTopology":
      return getWorkerAdapter(operation.request.documentId).measureTopology(
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
      const result = await handleWorkerOperation(
        request.requestId,
        request.operation,
      );
      if (runtimeAborted) return;
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
        publishPendingModelCheckpointAfterSnapshot(
          request.operation.request.documentId,
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

function reportRuntimeAbort(reason: unknown) {
  if (runtimeAborted) return;
  runtimeAborted = true;
  postOccWorkerMessage({
    kind: "fatal",
    error: { message: normalizeOccWorkerFailure("request_occ_abort", reason).error.message },
  });
}

function reportOccWorkerRequestFailure(
  request: OccWorkerRequest,
  error: unknown,
) {
  if (runtimeAborted) return;
  if (isOccRuntimeAbort(error)) {
    reportRuntimeAbort(error);
    return;
  }
  postOccWorkerMessage(
    normalizeOccWorkerFailure(
      request.requestId,
      error,
      request.kind === "invoke" && request.operation.kind === "warmup"
        ? "occ-worker-initialization-failed"
        : "occ-worker-request-failed",
    ),
  );
}

function enqueueOccWorkerRequest(request: OccWorkerRequest) {
  requestQueue = requestQueue
    .then(() => runtimeAborted ? undefined : handleOccWorkerRequest(request))
    .catch((error: unknown) => reportOccWorkerRequestFailure(request, error));
}

/**
 * cadara-se2: each refinement step is its own entry at the tail of the serial
 * queue, after a macrotask, so requests that arrived during a step (an
 * authored mutation, an export) run before the next step rather than behind
 * the whole remesh. The adapter's step rescans the current revision.
 */
async function refineSnapshotLodBetweenRequests(
  requestId: RequestId,
  operation: Extract<OccWorkerOperation, { kind: "refineSnapshotLod" }>,
): Promise<OccSnapshotLodRefinementOutcome> {
  const { documentId } = operation.request;
  const isCurrent = () => snapshotLodRefinements.get(documentId) === requestId;
  snapshotLodRefinements.set(documentId, requestId);
  try {
    for (;;) {
      if (!isCurrent()) return "superseded";
      const step = requestQueue.then(() => {
        const adapter = adapters.get(documentId);
        return runtimeAborted || !isCurrent() || !adapter
          ? null
          : adapter.refineSnapshotLodStep(operation.lodTierId);
      });
      requestQueue = step.then(
        () => undefined,
        () => undefined,
      );
      const completed = await step;
      if (completed === null) return "superseded";
      if (completed) return "completed";
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    if (isCurrent()) snapshotLodRefinements.delete(documentId);
  }
}

function startSnapshotLodRefinement(
  request: Extract<OccWorkerRequest, { kind: "invoke" }>,
  operation: Extract<OccWorkerOperation, { kind: "refineSnapshotLod" }>,
) {
  void refineSnapshotLodBetweenRequests(request.requestId, operation).then(
    (outcome) => {
      if (runtimeAborted) return;
      postOccWorkerMessage({
        kind: "invoked",
        requestId: request.requestId,
        operation: operation.kind,
        payload: outcome,
      });
    },
    (error: unknown) => reportOccWorkerRequestFailure(request, error),
  );
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

    if (
      parsed.data.kind === "invoke" &&
      parsed.data.operation.kind === "refineSnapshotLod"
    ) {
      startSnapshotLodRefinement(parsed.data, parsed.data.operation);
      return;
    }
    enqueueOccWorkerRequest(parsed.data);
  },
);
