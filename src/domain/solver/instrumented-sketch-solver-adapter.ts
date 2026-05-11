import type {
  PerformanceSpanAttributes,
  PerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import {
  measurePerformanceSpan,
  noopPerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import type {
  DeriveSketchRegionsRequest,
  DisposeInteractiveSketchSolveSessionRequest,
  FinalizeInteractiveSketchSolveSessionRequest,
  ProjectSketchExternalReferencesRequest,
  ResolveSketchReferenceRequest,
  SolveSketchRequest,
  StartInteractiveSketchSolveSessionRequest,
  UpdateInteractiveSketchSolveSessionRequest,
  ValidateSketchRequest,
} from "@/contracts/solver/schema";

export function createInstrumentedSketchSolverAdapter(
  adapter: SketchSolverAdapter,
  telemetry: PerformanceTelemetry = noopPerformanceTelemetry,
): SketchSolverAdapter {
  return new InstrumentedSketchSolverAdapter(adapter, telemetry);
}

class InstrumentedSketchSolverAdapter implements SketchSolverAdapter {
  private readonly inner: SketchSolverAdapter;
  private readonly telemetry: PerformanceTelemetry;
  private readonly interactiveGestures = new Map<
    string,
    {
      startedAt: number;
      updateCount: number;
      acceptedCount: number;
      blockedCount: number;
      maxUpdateDurationMs: number;
    }
  >();

  constructor(inner: SketchSolverAdapter, telemetry: PerformanceTelemetry) {
    this.inner = inner;
    this.telemetry = telemetry;
  }

  projectExternalReferences(request: ProjectSketchExternalReferencesRequest) {
    return this.measure(
      "projectExternalReferences",
      request,
      () => this.inner.projectExternalReferences(request),
      (result) => ({
        "cadara.projected_reference_count": result.projectedReferences.length,
        "cadara.diagnostic_count": result.diagnostics.length,
      }),
    );
  }

  validateSketch(request: ValidateSketchRequest) {
    return this.measure(
      "validateSketch",
      request,
      () => this.inner.validateSketch(request),
      (result) => ({
        ...definitionAttributes(request),
        "cadara.result": result.isValid ? "success" : "rejected",
        "cadara.diagnostic_count": result.diagnostics.length,
      }),
    );
  }

  solveSketch(request: SolveSketchRequest) {
    return this.measure(
      "solveSketch",
      request,
      () => this.inner.solveSketch(request),
      (result) => ({
        ...definitionAttributes(request),
        "cadara.projected_reference_count": request.projectedReferences.length,
        "cadara.solve_state": result.status.solveState,
        "cadara.constraint_state": result.status.constraintState,
        "cadara.diagnostic_count":
          result.diagnostics.length +
          (result.regionResult?.diagnostics.length ?? 0),
      }),
    );
  }

  async startInteractiveSolveSession(
    request: StartInteractiveSketchSolveSessionRequest,
  ) {
    const result = await this.measure(
      "startInteractiveSolveSession",
      request,
      () => this.inner.startInteractiveSolveSession(request),
      (response) => ({
        ...definitionAttributes(request),
        "cadara.projected_reference_count": request.projectedReferences.length,
        "cadara.solve_state": response.status.solveState,
        "cadara.constraint_state": response.status.constraintState,
        "cadara.warm_started": response.warmStarted,
        "cadara.diagnostic_count": response.diagnostics.length,
      }),
    );
    this.interactiveGestures.set(result.sessionId, {
      startedAt: getPerformanceNow(),
      updateCount: 0,
      acceptedCount: 0,
      blockedCount: 0,
      maxUpdateDurationMs: 0,
    });
    return result;
  }

  async updateInteractiveSolveSession(
    request: UpdateInteractiveSketchSolveSessionRequest,
  ) {
    const startedAt = getPerformanceNow();
    const result = await this.measure(
      "updateInteractiveSolveSession",
      request,
      () => this.inner.updateInteractiveSolveSession(request),
      (response) => ({
        "cadara.result":
          response.result.kind === "blocked" ? "blocked" : "success",
        "cadara.solve_state": response.result.kind,
        "cadara.diagnostic_count": response.result.diagnostics.length,
      }),
    );
    const gesture = this.interactiveGestures.get(result.sessionId);
    if (gesture) {
      gesture.updateCount += 1;
      if (result.result.kind === "accepted") {
        gesture.acceptedCount += 1;
      } else {
        gesture.blockedCount += 1;
      }
      gesture.maxUpdateDurationMs = Math.max(
        gesture.maxUpdateDurationMs,
        getPerformanceNow() - startedAt,
      );
    }
    return result;
  }

  async finalizeInteractiveSolveSession(
    request: FinalizeInteractiveSketchSolveSessionRequest,
  ) {
    const result = await this.measure(
      "finalizeInteractiveSolveSession",
      request,
      () => this.inner.finalizeInteractiveSolveSession(request),
      (response) => ({
        "cadara.solve_state": response.status?.solveState ?? "cancelled",
        "cadara.constraint_state":
          response.status?.constraintState ?? "cancelled",
        "cadara.diagnostic_count": response.diagnostics.length,
      }),
    );
    this.recordGesture(request.sessionId, "success");
    return result;
  }

  async disposeInteractiveSolveSession(
    request: DisposeInteractiveSketchSolveSessionRequest,
  ) {
    const result = await this.measure(
      "disposeInteractiveSolveSession",
      request,
      () => this.inner.disposeInteractiveSolveSession(request),
      (response) => ({
        "cadara.disposed": response.disposed,
        "cadara.diagnostic_count": response.diagnostics.length,
      }),
    );
    this.recordGesture(request.sessionId, "cancelled");
    return result;
  }

  deriveSketchRegions(request: DeriveSketchRegionsRequest) {
    return this.measure(
      "deriveSketchRegions",
      request,
      () => this.inner.deriveSketchRegions(request),
      (result) => ({
        ...definitionAttributes(request),
        "cadara.projected_reference_count": request.projectedReferences.length,
        "cadara.diagnostic_count": result.diagnostics.length,
      }),
    );
  }

  resolveSketchReference(request: ResolveSketchReferenceRequest) {
    return this.measure(
      "resolveSketchReference",
      request,
      () => this.inner.resolveSketchReference(request),
      (result) => ({
        "cadara.result": result.resolution.isValid ? "success" : "rejected",
        "cadara.diagnostic_count": result.diagnostics.length,
      }),
    );
  }

  private measure<T>(
    operation: string,
    request: { sketchId: string },
    action: () => Promise<T>,
    resultAttributes?: (result: T) => PerformanceSpanAttributes,
  ) {
    return measurePerformanceSpan({
      telemetry: this.telemetry,
      descriptor: {
        name: `Sketch solver ${operation}`,
        op: "cad.sketch.solver",
        attributes: {
          "cadara.seam": "sketch.solver",
          "cadara.operation": operation,
        },
      },
      action,
      resultAttributes,
    }).catch((error) => {
      if ("sessionId" in request && typeof request.sessionId === "string") {
        this.recordGesture(request.sessionId, "failure");
      }
      throw error;
    });
  }

  private recordGesture(
    sessionId: string,
    result: "success" | "cancelled" | "failure",
  ) {
    const gesture = this.interactiveGestures.get(sessionId);
    if (!gesture) {
      return;
    }

    this.interactiveGestures.delete(sessionId);
    const durationMs = getPerformanceNow() - gesture.startedAt;
    this.telemetry
      .startSpan({
        name: "Sketch solver interactive drag gesture",
        op: "cad.sketch.drag",
        attributes: {
          "cadara.seam": "sketch.drag",
          "cadara.operation": "interactiveDragGesture",
        },
      })
      .end({
        "cadara.duration_ms": roundDuration(durationMs),
        "cadara.result": result,
        "cadara.drag_update_count": gesture.updateCount,
        "cadara.drag_accepted_update_count": gesture.acceptedCount,
        "cadara.drag_blocked_update_count": gesture.blockedCount,
        "cadara.drag_max_update_ms": roundDuration(gesture.maxUpdateDurationMs),
      });
  }
}

function definitionAttributes(request: {
  definition?: {
    points?: readonly unknown[];
    entities?: readonly unknown[];
    constraints?: readonly unknown[];
    dimensions?: readonly unknown[];
  };
}): PerformanceSpanAttributes {
  return {
    "cadara.point_count": request.definition?.points?.length ?? 0,
    "cadara.entity_count": request.definition?.entities?.length ?? 0,
    "cadara.constraint_count": request.definition?.constraints?.length ?? 0,
    "cadara.dimension_count": request.definition?.dimensions?.length ?? 0,
  };
}

function getPerformanceNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function roundDuration(durationMs: number) {
  return Number(durationMs.toFixed(2));
}
