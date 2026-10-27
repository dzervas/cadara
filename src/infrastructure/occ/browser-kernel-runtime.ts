import { createLoadingStatus } from "@/contracts/modeling/loading-status";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import type { GeometryAssetResolver } from "@/contracts/modeling/adapter";
import type { PerformanceTelemetry } from "@/contracts/performance/telemetry";
import {
  noopPerformanceTelemetry,
  recordPerformanceMark,
} from "@/contracts/performance/telemetry";
import { createInstrumentedOccWorkerClient } from "@/infrastructure/occ/instrumented-worker-client";
import {
  createOccPreloadController,
  type OccPreloadController,
} from "@/infrastructure/occ/preload";
import { createBrowserOccWorkerClient } from "@/domain/modeling/occ/worker-runtime";
import {
  getBrowserGeometryAssetComposition,
} from "@/infrastructure/modeling/browser-geometry-asset-store";
import { OCC_KERNEL_DOCUMENT_ID } from "@/core/modeling/opencascade-kernel-seed";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";
import type { DocumentId } from "@/contracts/shared/ids";

const browserGeometryAssetResolver =
  getBrowserGeometryAssetComposition().resolver;
// Only a slow wasm download is measured (decoded bytes, cadara-5hlf); compile
// and instantiate stay indeterminate.
export const browserOccLoadingStatus = createLoadingStatus("preparing-engine");
let lastWorkerFailure: Error | null = null;
const workerFailureListeners = new Set<(error: Error) => void>();

/** Retain startup failures until the workbench notification surface mounts. */
export function subscribeBrowserOccWorkerFailure(listener: (error: Error) => void) {
  workerFailureListeners.add(listener);
  if (lastWorkerFailure) listener(lastWorkerFailure);
  return () => { workerFailureListeners.delete(listener); };
}

const browserOccWorkerClient =
  typeof window === "undefined"
    ? null
    : createBrowserOccWorkerClient({
        assetResolver: browserGeometryAssetResolver,
        onEngineDownloadProgress: ({ completedBytes, totalBytes }) =>
          browserOccLoadingStatus.setProgress(
            completedBytes < totalBytes
              ? { stage: "downloading-engine", completed: completedBytes, total: totalBytes, label: null }
              : null,
          ),
        onFatalError: (error) => {
          lastWorkerFailure = error;
          browserOccLoadingStatus.set("failed");
          for (const listener of workerFailureListeners) listener(error);
        },
      });
let browserOccKernelAdapter: OpenCascadeKernelAdapter | null = null;
let browserOccWarmupController: OccPreloadController | null = null;
let browserOccWarmupPromise: Promise<void> | null = null;


function updateBrowserOccPerf(
  patch: Partial<NonNullable<Window["__cadOccPerf"]>>,
) {
  if (typeof window === "undefined") {
    return;
  }

  window.__cadOccPerf = {
    warmupStatus: "idle",
    ...window.__cadOccPerf,
    ...patch,
  };
}

export function getBrowserOccWorkerClient() {
  return browserOccWorkerClient;
}

/** Explicit tab close, not facade replacement, releases the worker's native owner. */
export async function releaseBrowserOccDocument(documentId: DocumentId): Promise<void> {
  await browserOccWorkerClient?.releaseDocument(documentId);
}

export function createBrowserOccKernelAdapter(
  documentId: DocumentId = OCC_KERNEL_DOCUMENT_ID,
  performanceTelemetry: PerformanceTelemetry = noopPerformanceTelemetry,
  assetResolver: GeometryAssetResolver = browserGeometryAssetResolver,
) {
  return new OpenCascadeKernelAdapter({
    // Used only without a worker client; the adapter's queries are its own.
    createSolverAdapter: (revisionId, neutralCurveQueries) =>
      new SketchConstraintSolverAdapter({
        documentId,
        revisionId,
        neutralCurveQueries,
      }),
    initialSnapshotRequiresRuntime: typeof window !== "undefined",
    workerSnapshotClient: createInstrumentedOccWorkerClient(
      browserOccWorkerClient,
      performanceTelemetry,
    ),
    assetResolver,
    documentId,
  });
}

export function getBrowserOccKernelAdapter(
  performanceTelemetry: PerformanceTelemetry = noopPerformanceTelemetry,
) {
  if (!browserOccKernelAdapter) {
    browserOccKernelAdapter = createBrowserOccKernelAdapter(
      OCC_KERNEL_DOCUMENT_ID,
      performanceTelemetry,
    );
  }

  return browserOccKernelAdapter;
}

export function getBrowserOccWarmupController(
  performanceTelemetry: PerformanceTelemetry = noopPerformanceTelemetry,
) {
  if (!browserOccWarmupController) {
    browserOccWarmupController = createOccPreloadController({
      preload: () =>
        getBrowserOccKernelAdapter(performanceTelemetry).preloadRuntime(),
    });
  }

  return browserOccWarmupController;
}

export function startBrowserOccWarmup(
  performanceTelemetry: PerformanceTelemetry = noopPerformanceTelemetry,
) {
  if (typeof window === "undefined") {
    return null;
  }

  if (!browserOccWarmupPromise) {
    updateBrowserOccPerf({
      warmupStartedAt: performance.now(),
      warmupSettledAt: null,
      warmupStatus: "pending",
    });
    browserOccWarmupPromise = getBrowserOccWarmupController(
      performanceTelemetry,
    )
      .preload()
      .then(() => {
        browserOccLoadingStatus.set("ready");
        updateBrowserOccPerf({
          warmupSettledAt: performance.now(),
          warmupStatus: "fulfilled",
        });
        recordPerformanceMark(performanceTelemetry, {
          name: "Startup OCC warmup settled",
          op: "cad.startup",
          attributes: {
            "cadara.seam": "startup",
            "cadara.operation": "occWarmupSettled",
            "cadara.startup_phase": "occ_warmup_settled",
          },
        });
      })
      .catch((error: unknown) => {
        browserOccLoadingStatus.set("failed");
        updateBrowserOccPerf({
          warmupSettledAt: performance.now(),
          warmupStatus: "rejected",
          warmupError:
            error instanceof Error
              ? error.message
              : "OpenCascade warmup failed.",
        });
        recordPerformanceMark(performanceTelemetry, {
          name: "Startup OCC warmup settled",
          op: "cad.startup",
          attributes: {
            "cadara.seam": "startup",
            "cadara.operation": "occWarmupSettled",
            "cadara.startup_phase": "occ_warmup_settled",
            "cadara.result": "failure",
          },
        });
        throw error;
      });
    void browserOccWarmupPromise.catch(() => undefined);
  }

  return browserOccWarmupPromise;
}
