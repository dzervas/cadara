import { test, expect } from "vitest";

import { ResultAsync, createAppError } from "@/contracts/errors";
import type {
  PerformanceSpanAttributes,
  PerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import { createInstrumentedOccWorkerClient } from "@/domain/modeling/occ/instrumented-worker-client";
import type { OccWorkerSnapshotClient } from "@/domain/modeling/occ/worker-client";
import { createInstrumentedDocumentRepository } from "@/domain/modeling/instrumented-document-repository";
import type {
  DocumentRepository,
  LocalFileSyncDocumentRepository,
} from "@/domain/modeling/document-repository";
import type { DocumentSyncWriteStatus } from "@/domain/modeling/document-sync-worker-protocol";
import { createInstrumentedModelingService } from "@/domain/modeling/modeling-service/instrumented-service";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import { createInstrumentedSketchSolverAdapter } from "@/application/solver/instrumented-sketch-solver-adapter";
import type { SketchSolverAdapter } from "@/contracts/solver/adapter";

test("src/domain/modeling/performance-telemetry-wrappers.spec.ts preserves OCC worker results and rejections", async () => {
  const telemetry = createRecordingTelemetry();
  const failure = new Error("worker failed");
  let releasedDocumentId: string | null = null;
  const client = createInstrumentedOccWorkerClient(
    {
      async getDocumentSnapshot() {
        return {
          snapshot: {
            document: {
              features: [1],
              sketches: [1],
              bodies: [1],
              render: { records: [1, 2] },
              diagnostics: [],
            },
          },
        };
      },
      async createFeature() {
        throw failure;
      },
      async releaseDocument(documentId: string) {
        releasedDocumentId = documentId;
      },
    } as unknown as OccWorkerSnapshotClient,
    telemetry,
  );

  const snapshotResult = await client?.getDocumentSnapshot({} as never);
  expect(
    snapshotResult?.snapshot.document.bodies.length,
    "The OCC wrapper should preserve successful payloads.",
  ).toBe(1);
  expect(
    telemetry.finished.some(
      (span) =>
        span.attributes["cadara.operation"] === "getDocumentSnapshot" &&
        span.attributes["cadara.render_record_count"] === 2,
    ),
    "The OCC wrapper should record cheap snapshot counts.",
  ).toBeTruthy();

  try {
    await client?.createFeature({} as never);
  } catch (error) {
    expect(
      error,
      "The OCC wrapper should preserve the exact rejection error.",
    ).toBe(failure);
  }
  expect(
    telemetry.finished.some(
      (span) =>
        span.attributes["cadara.operation"] === "createFeature" &&
        span.attributes["cadara.result"] === "failure",
    ),
    "The OCC wrapper should classify rejected operations as failures.",
  ).toBeTruthy();

  await client?.releaseDocument("doc_released");
  expect(releasedDocumentId).toBe("doc_released");
});

test("src/domain/modeling/performance-telemetry-wrappers.spec.ts records repository source and heads without changing results", async () => {
  const telemetry = createRecordingTelemetry();
  const metadata = {
    documentId: "doc_1",
    heads: ["h1", "h2"],
    source: "local",
    storageKey: "browser:doc_1",
  } as const;
  const repository = createInstrumentedDocumentRepository(
    {
      async load() {
        return {
          ok: true,
          document: {} as never,
          diagnostics: [],
          status: { kind: "restored", documentId: "doc_1" },
          metadata,
        };
      },
      getMetadata() {
        return metadata;
      },
    } as unknown as DocumentRepository,
    telemetry,
  );

  const result = await repository.load({
    documentId: "doc_1",
    seedDocument: {} as never,
  });
  expect(
    result.ok,
    "The repository wrapper should preserve load results.",
  ).toBeTruthy();
  expect(
    telemetry.finished.some(
      (span) =>
        span.attributes["cadara.operation"] === "load" &&
        span.attributes["cadara.repository_head_count"] === 2 &&
        span.attributes["cadara.repository_source"] === "local",
    ),
    "Repository telemetry should use cheap metadata from the repository seam.",
  ).toBeTruthy();
});

// cadara-8p7o: a failed background save is a failed repository span, for the
// repository write and for the bound local file the sync worker writes.
test("src/domain/modeling/performance-telemetry-wrappers.spec.ts records failed repository writes as failed spans", async () => {
  const telemetry = createRecordingTelemetry();
  const status = {
    kind: "failed",
    documentId: "doc_1",
    diagnostic: { reasonCode: "repository-write-failed", message: "quota exceeded" },
  } as const;
  let rejectWrite = false;
  const repository = createInstrumentedDocumentRepository(
    {
      async mutate() {
        if (rejectWrite) throw new Error("storage closed");
        return { ok: false, status };
      },
      getMetadata: () => null,
    } as unknown as DocumentRepository,
    telemetry,
  );
  const input = { documentId: "doc_1" as const, document: {} as never, expected: {} as never };

  expect(await repository.mutate(input)).toEqual({ ok: false, status });
  rejectWrite = true;
  await expect(repository.mutate(input)).rejects.toThrow("storage closed");
  expect(
    telemetry.finished.map(({ descriptor, attributes }) => ({
      op: (descriptor as { op: string }).op,
      operation: attributes["cadara.operation"],
      result: attributes["cadara.result"],
      error: attributes["cadara.error_message"],
    })),
  ).toEqual([
    { op: "cad.document.repository", operation: "mutate", result: "failure", error: undefined },
    { op: "cad.document.repository", operation: "mutate", result: "failure", error: "storage closed" },
  ]);
});

test("src/domain/modeling/performance-telemetry-wrappers.spec.ts records one span per local file write", () => {
  const telemetry = createRecordingTelemetry();
  const workerListeners = new Set<(status: DocumentSyncWriteStatus) => void>();
  const repository = createInstrumentedDocumentRepository(
    {
      bindLocalFile: async () => ({ ok: true }),
      subscribeToLocalFileSyncStatus(listener: (status: DocumentSyncWriteStatus) => void) {
        workerListeners.add(listener);
        return () => workerListeners.delete(listener);
      },
    } as unknown as DocumentRepository,
    telemetry,
  ) as unknown as LocalFileSyncDocumentRepository;
  const metadata = { documentId: "doc_1", fileName: "part.cadara" } as never;
  const emit = (status: DocumentSyncWriteStatus) => {
    for (const listener of workerListeners) listener(status);
  };
  const received: string[][] = [[], []];
  const unsubscribe = received.map((statuses) =>
    repository.subscribeToLocalFileSyncStatus((status) => statuses.push(status.kind)),
  );

  emit({ kind: "syncing", documentId: "doc_1", sequence: 1, metadata });
  emit({ kind: "failed", documentId: "doc_1", sequence: 2, metadata, message: "disk full" });
  emit({ kind: "syncing", documentId: "doc_1", sequence: 3, metadata });
  emit({ kind: "synced", documentId: "doc_1", sequence: 4, metadata });
  expect(received, "every listener still receives every status").toEqual([
    ["syncing", "failed", "syncing", "synced"],
    ["syncing", "failed", "syncing", "synced"],
  ]);
  expect(
    telemetry.finished.map(({ descriptor, attributes }) => [
      (descriptor as { op: string }).op,
      attributes["cadara.operation"],
      attributes["cadara.result"],
    ]),
    "one span per write although two listeners subscribe",
  ).toEqual([
    ["cad.document.repository", "localFileWrite", "failure"],
    ["cad.document.repository", "localFileWrite", "success"],
  ]);
  emit({ kind: "syncing", documentId: "doc_1", sequence: 5, metadata });
  for (const stop of unsubscribe) stop();
  expect(workerListeners.size, "the shared subscription ends with the last listener").toBe(0);
  expect(
    telemetry.finished.map(({ attributes }) => attributes["cadara.result"]),
    "a write still running at the last unsubscribe ends as cancelled",
  ).toEqual(["failure", "success", "cancelled"]);
  const stop = repository.subscribeToLocalFileSyncStatus(() => undefined);
  emit({ kind: "synced", documentId: "doc_1", sequence: 6, metadata });
  stop();
  expect(telemetry.finished, "no stale span ends after a re-subscribe").toHaveLength(3);
});

test("src/domain/modeling/performance-telemetry-wrappers.spec.ts preserves modeling AppResultAsync behavior", async () => {
  const telemetry = createRecordingTelemetry();
  const appError = createAppError({
    code: "modeling/diagnostic",
    message: "Rejected.",
  });
  const service = createInstrumentedModelingService(
    {
      currentDocumentId: "doc_1",
      sketchSolver: null,
      createFeature() {
        return ResultAsync.fromPromise(
          Promise.reject(appError),
          () => appError,
        );
      },
    } as unknown as ModelingService,
    telemetry,
  );

  const result = await service.createFeature({} as never);
  expect(
    result.isErr(),
    "The modeling wrapper should preserve AppResultAsync failures.",
  ).toBeTruthy();
  expect(
    telemetry.finished.some(
      (span) =>
        span.attributes["cadara.operation"] === "createFeature" &&
        span.attributes["cadara.result"] === "rejected",
    ),
    "The modeling wrapper should classify contract-level rejections.",
  ).toBeTruthy();
});

test("src/domain/modeling/performance-telemetry-wrappers.spec.ts aggregates sketch interactive drag telemetry", async () => {
  const telemetry = createRecordingTelemetry();
  const adapter = createInstrumentedSketchSolverAdapter(
    {
      async startInteractiveSolveSession() {
        return {
          sessionId: "interactive_sketch_solve_1",
          status: { solveState: "solved", constraintState: "satisfied" },
          warmStarted: true,
          diagnostics: [],
        };
      },
      async updateInteractiveSolveSession() {
        return {
          sessionId: "interactive_sketch_solve_1",
          result: {
            kind: "blocked",
            reason: "unsatisfied",
            diagnostics: [],
            solvedSnapshot: null,
          },
        };
      },
      async finalizeInteractiveSolveSession() {
        return {
          sessionId: "interactive_sketch_solve_1",
          status: { solveState: "solved", constraintState: "satisfied" },
          diagnostics: [],
        };
      },
    } as unknown as SketchSolverAdapter,
    telemetry,
  );

  await adapter.startInteractiveSolveSession(makeSketchRequest() as never);
  await adapter.updateInteractiveSolveSession({
    ...makeSketchRequest(),
    sessionId: "interactive_sketch_solve_1",
  } as never);
  await adapter.finalizeInteractiveSolveSession({
    ...makeSketchRequest(),
    sessionId: "interactive_sketch_solve_1",
  } as never);

  expect(
    telemetry.finished.some(
      (span) =>
        span.attributes["cadara.operation"] === "interactiveDragGesture" &&
        span.attributes["cadara.drag_update_count"] === 1 &&
        span.attributes["cadara.drag_blocked_update_count"] === 1,
    ),
    "Sketch drag telemetry should emit one aggregate span for the gesture.",
  ).toBeTruthy();
});

function makeSketchRequest() {
  return {
    sketchId: "sketch_1",
    definition: {
      points: [],
      entities: [],
      constraints: [],
      dimensions: [],
    },
    projectedReferences: [],
  };
}

function createRecordingTelemetry(): PerformanceTelemetry & {
  finished: Array<{
    descriptor: unknown;
    attributes: PerformanceSpanAttributes;
  }>;
} {
  const finished: Array<{
    descriptor: unknown;
    attributes: PerformanceSpanAttributes;
  }> = [];
  return {
    finished,
    startSpan(descriptor) {
      let attributes: PerformanceSpanAttributes = { ...descriptor.attributes };
      return {
        setAttribute(name, value) {
          attributes = { ...attributes, [name]: value };
        },
        setAttributes(nextAttributes) {
          attributes = { ...attributes, ...nextAttributes };
        },
        end(nextAttributes) {
          attributes = { ...attributes, ...nextAttributes };
          finished.push({ descriptor, attributes });
        },
      };
    },
  };
}
