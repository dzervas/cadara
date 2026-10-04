/**
 * Dedicated live sketch-region derivation worker. It speaks the OCC worker
 * protocol (same envelope validation and failure normalization) but answers
 * only `deriveSketchRegions` and (T10g-1, the `editQuery` lane)
 * `querySketchEditIntersections`, so a long derivation never queues ahead of the
 * OCC kernel worker's feature preview/commit, and the main thread can
 * `terminate()` it when a newer derivation supersedes it.
 *
 * Kernel-free by default: the query capability is the production one (so
 * results equal the main-thread path bit for bit), which answers most pairs,
 * every self-intersection and every declared join without OCC. OCC is loaded
 * here, lazily and once, only when a pair query reaches it; per
 * `neutral-curve-query.ts` those are full-turn circle pairs, positive
 * structural cubic overlaps, and numeric (form-less) line/cubic pairs. The main
 * thread never loads OCC for derivation.
 */
import type { DocumentId } from "@/contracts/shared/ids";
import { getVersionedOpenCascadeRuntimeAssetUrls } from "@/domain/modeling/occ/assets";
import { createOpenCascadeNeutralCurveQueryCapability } from "@/domain/modeling/occ/neutral-curve-query";
import {
  loadDefaultOpenCascadeFactory,
  type OpenCascadeInstance,
} from "@/domain/modeling/occ/runtime";
import {
  normalizeOccWorkerFailure,
  validateOccWorkerRequestEnvelope,
  type OccWorkerRequest,
  type OccWorkerResponse,
} from "@/domain/modeling/occ/worker-protocol";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

interface SketchDerivationWorkerScope {
  postMessage(message: OccWorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<OccWorkerRequest>) => void,
  ): void;
}

const workerScope = self as unknown as SketchDerivationWorkerScope;

let openCascadePromise: Promise<OpenCascadeInstance> | null = null;

function loadWorkerOpenCascade() {
  openCascadePromise ??= loadDefaultOpenCascadeFactory({ isNodeRuntime: false })
    .then((initializeOpenCascade) =>
      initializeOpenCascade({
        mainWasm: getVersionedOpenCascadeRuntimeAssetUrls().mainWasm,
      }),
    )
    .catch((error: unknown) => {
      openCascadePromise = null;
      throw error;
    });
  return openCascadePromise;
}

const neutralCurveQueries = createOpenCascadeNeutralCurveQueryCapability(
  loadWorkerOpenCascade,
);

/**
 * One solver per document, kept across calls like the main-thread composition
 * (`revisionId: null`). Every call recomputes the arrangement from its request;
 * the only kept state is the deriver's query memo, keyed by the exact (bitwise)
 * query request, so it never serves a result for other geometry, tolerance or
 * revision. It lives as long as this worker (terminated on supersession).
 */
const solvers = new Map<DocumentId, SketchConstraintSolverAdapter>();

function getSolver(documentId: DocumentId) {
  let solver = solvers.get(documentId);
  if (!solver) {
    solver = new SketchConstraintSolverAdapter({
      documentId,
      revisionId: null,
      neutralCurveQueries,
    });
    solvers.set(documentId, solver);
  }
  return solver;
}

async function handleRequest(request: OccWorkerRequest) {
  if (request.kind !== "invoke") {
    throw new Error(
      `The sketch-derivation worker does not accept ${request.kind} messages.`,
    );
  }
  const { operation } = request;
  if (
    operation.kind !== "deriveSketchRegions" &&
    operation.kind !== "querySketchEditIntersections"
  ) {
    throw new Error(
      `The sketch-derivation worker only answers deriveSketchRegions and querySketchEditIntersections, not ${operation.kind}.`,
    );
  }
  const solver = getSolver(operation.request.documentId);
  const payload =
    operation.kind === "deriveSketchRegions"
      ? await solver.deriveSketchRegions(operation.request)
      : await solver.querySketchEditIntersections(operation.request);
  workerScope.postMessage({
    kind: "invoked",
    requestId: request.requestId,
    operation: operation.kind,
    payload,
  });
}

let requestQueue: Promise<void> = Promise.resolve();

workerScope.addEventListener(
  "message",
  (event: MessageEvent<OccWorkerRequest>) => {
    const requestId =
      typeof event.data?.requestId === "string"
        ? event.data.requestId
        : ("request_occ_worker_unknown" as const);
    const parsed = validateOccWorkerRequestEnvelope(event.data);
    if (!parsed.success) {
      const [first] = parsed.errors;
      workerScope.postMessage(
        normalizeOccWorkerFailure(
          requestId,
          first
            ? (first.description ??
                `${first.path} must match ${first.expected}`)
            : undefined,
        ),
      );
      return;
    }
    requestQueue = requestQueue
      .then(() => handleRequest(parsed.data))
      .catch((error: unknown) => {
        workerScope.postMessage(normalizeOccWorkerFailure(requestId, error));
      });
  },
);
