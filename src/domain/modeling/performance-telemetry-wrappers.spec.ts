import { test, expect } from "vitest";

import { ResultAsync, createAppError } from "@/contracts/errors";
import type {
  PerformanceSpanAttributes,
  PerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import { createInstrumentedOccWorkerClient } from "@/domain/modeling/occ/instrumented-worker-client";
import type { OccWorkerSnapshotClient } from "@/domain/modeling/occ/worker-client";
import { createInstrumentedDocumentRepository } from "@/domain/modeling/instrumented-document-repository";
import type { DocumentRepository } from "@/domain/modeling/document-repository";
import { createInstrumentedModelingService } from "@/domain/modeling/modeling-service/instrumented-service";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import { createInstrumentedSketchSolverAdapter } from "@/domain/solver/instrumented-sketch-solver-adapter";
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
