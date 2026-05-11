import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import {
  SOLVER_SCHEMA_VERSION,
  type DeriveSketchRegionsRequest,
  type DeriveSketchRegionsResponse,
  type DisposeInteractiveSketchSolveSessionRequest,
  type DisposeInteractiveSketchSolveSessionResponse,
  type FinalizeInteractiveSketchSolveSessionRequest,
  type FinalizeInteractiveSketchSolveSessionResponse,
  type InteractiveSketchSolveSessionId,
  type ProjectedSketchReferenceRecord,
  type ProjectSketchExternalReferencesRequest,
  type ProjectSketchExternalReferencesResponse,
  type ResolveSketchReferenceRequest,
  type ResolveSketchReferenceResponse,
  type SketchSolverResponseBase,
  type SolveSketchRequest,
  type SolveSketchResponse,
  type StartInteractiveSketchSolveSessionRequest,
  type StartInteractiveSketchSolveSessionResponse,
  type UpdateInteractiveSketchSolveSessionRequest,
  type UpdateInteractiveSketchSolveSessionResponse,
  type ValidateSketchRequest,
  type ValidateSketchResponse,
} from "@/contracts/solver/schema";
import { sketchSolverEnvelopeSchema } from "@/contracts/solver/runtime-schema";
import {
  compileSketchSolveProgram,
  createCompiledSketchSolveSession,
  deriveSketchRegionsCore,
  solveSketchDefinitionCore,
  updateCompiledSketchSolveSession,
  validateSketchDefinitionCore,
  type SketchCompiledSolveSession,
  type ProjectedSketchGeometryRef,
  type SketchSolveDiagnostic,
} from "@/contracts/sketch";
import type { DocumentId, RevisionId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";

export interface SketchConstraintSolverAdapterOptions {
  documentId: DocumentId;
  revisionId: RevisionId | null;
}

interface StoredInteractiveSolveSession {
  session: SketchCompiledSolveSession;
  documentId: StartInteractiveSketchSolveSessionRequest["documentId"];
  revisionId: StartInteractiveSketchSolveSessionRequest["revisionId"];
  sketchId: StartInteractiveSketchSolveSessionRequest["sketchId"];
}

const DEFAULT_OPTIONS: SketchConstraintSolverAdapterOptions = {
  documentId: "doc_workspace",
  revisionId: "rev_0001",
};

function makeResponseBase(
  request:
    | ProjectSketchExternalReferencesRequest
    | ValidateSketchRequest
    | SolveSketchRequest
    | StartInteractiveSketchSolveSessionRequest
    | UpdateInteractiveSketchSolveSessionRequest
    | FinalizeInteractiveSketchSolveSessionRequest
    | DisposeInteractiveSketchSolveSessionRequest
    | DeriveSketchRegionsRequest
    | ResolveSketchReferenceRequest,
): SketchSolverResponseBase {
  return {
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: request.requestId,
    documentId: request.documentId,
    revisionId: request.revisionId,
    sketchId: request.sketchId,
  };
}

function makeProjectionDiagnostic(
  code: string,
  severity: SketchSolveDiagnostic["severity"],
  message: string,
): SketchSolveDiagnostic {
  return {
    code,
    severity,
    message,
    target: null,
  };
}

function projectReference(
  reference: ProjectSketchExternalReferencesRequest["references"][number],
): Omit<ProjectedSketchReferenceRecord, "referenceId"> {
  if (reference.reference.kind === "constructionPlane") {
    return {
      status: "projected",
      geometry: [],
      diagnostics: [],
    };
  }

  if (reference.reference.kind === "sketchReference") {
    return {
      status: "unsupportedSource",
      geometry: [],
      diagnostics: [
        {
          code: "unsupported-sketch-reference-source",
          severity: "warning",
          message: `Sketch reference ${reference.referenceId} does not expose projectable geometry in this solver.`,
          target: null,
        },
      ],
    };
  }

  return {
    status: "unsupportedSource",
    geometry: [],
    diagnostics: [
      makeProjectionDiagnostic(
        "unsupported-model-reference-source",
        "warning",
        `Model reference ${reference.referenceId} cannot be projected because this solver adapter has no resolved source geometry.`,
      ),
    ],
  };
}

function assertSupportedRequest(
  request:
    | ProjectSketchExternalReferencesRequest
    | ValidateSketchRequest
    | SolveSketchRequest
    | StartInteractiveSketchSolveSessionRequest
    | UpdateInteractiveSketchSolveSessionRequest
    | FinalizeInteractiveSketchSolveSessionRequest
    | DisposeInteractiveSketchSolveSessionRequest
    | DeriveSketchRegionsRequest
    | ResolveSketchReferenceRequest,
  options: SketchConstraintSolverAdapterOptions,
) {
  const parsed = sketchSolverEnvelopeSchema.safeParse(request);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid sketch solver request envelope.",
    );
  }

  if (
    request.documentId !== options.documentId ||
    (options.revisionId !== null && request.revisionId !== options.revisionId)
  ) {
    throw new Error(
      `Solver request targeted ${request.documentId}@${request.revisionId}, but the runtime is configured for ${options.documentId}@${options.revisionId}.`,
    );
  }
}

export class SketchConstraintSolverAdapter implements SketchSolverAdapter {
  private readonly options: SketchConstraintSolverAdapterOptions;
  private readonly interactiveSessions = new Map<
    InteractiveSketchSolveSessionId,
    StoredInteractiveSolveSession
  >();
  private nextInteractiveSessionSequence = 1;

  constructor(options: Partial<SketchConstraintSolverAdapterOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async projectExternalReferences(
    request: ProjectSketchExternalReferencesRequest,
  ): Promise<ProjectSketchExternalReferencesResponse> {
    assertSupportedRequest(request, this.options);
    return {
      ...makeResponseBase(request),
      projectedReferences: request.references.map((reference) => ({
        referenceId: reference.referenceId,
        ...projectReference(reference),
      })),
      diagnostics: [],
    };
  }

  async validateSketch(
    request: ValidateSketchRequest,
  ): Promise<ValidateSketchResponse> {
    assertSupportedRequest(request, this.options);
    const validation = validateSketchDefinitionCore({
      definition: request.definition,
      projectedReferences: request.projectedReferences,
      tolerances: request.tolerances,
    });
    return {
      ...makeResponseBase(request),
      isValid: validation.isValid,
      diagnostics: validation.diagnostics,
    };
  }

  async solveSketch(request: SolveSketchRequest): Promise<SolveSketchResponse> {
    assertSupportedRequest(request, this.options);
    const solved = solveSketchDefinitionCore({
      definition: request.definition,
      projectedReferences: request.projectedReferences,
      tolerances: request.tolerances,
      partialSolvePolicy: request.partialSolvePolicy,
    });
    const regionResult = request.includeRegions
      ? deriveSketchRegionsCore({
          documentId: request.documentId,
          revisionId: request.revisionId,
          sketchId: request.sketchId,
          solvedSnapshot: solved.solvedSnapshot,
          definition: request.definition,
          projectedReferences: request.projectedReferences,
        })
      : null;

    return {
      ...makeResponseBase(request),
      status: solved.status,
      solvedSnapshot: solved.solvedSnapshot,
      diagnostics: solved.diagnostics,
      ...(regionResult
        ? {
            regionResult: {
              regions: regionResult.regions,
              diagnostics: regionResult.diagnostics,
            },
          }
        : {}),
    };
  }

  async startInteractiveSolveSession(
    request: StartInteractiveSketchSolveSessionRequest,
  ): Promise<StartInteractiveSketchSolveSessionResponse> {
    assertSupportedRequest(request, this.options);
    const program = compileSketchSolveProgram({
      definition: request.definition,
      projectedReferences: request.projectedReferences,
      tolerances: request.tolerances,
      partialSolvePolicy: request.partialSolvePolicy,
      strategy: request.strategy,
    });
    const sessionId =
      `interactive_sketch_solve_${this.nextInteractiveSessionSequence++}` as InteractiveSketchSolveSessionId;
    const session = createCompiledSketchSolveSession({
      sessionId,
      program,
      priorSolvedSnapshot: request.priorSolvedSnapshot,
    });
    this.interactiveSessions.set(sessionId, {
      session,
      documentId: request.documentId,
      revisionId: request.revisionId,
      sketchId: request.sketchId,
    });

    return {
      ...makeResponseBase(request),
      sessionId,
      programId: program.programId,
      warmStarted: session.warmStarted,
      solvedSnapshot: session.lastAcceptedSnapshot,
      status: session.lastAcceptedSnapshot.status,
      diagnostics: session.lastAcceptedSnapshot.diagnostics,
    };
  }

  async updateInteractiveSolveSession(
    request: UpdateInteractiveSketchSolveSessionRequest,
  ): Promise<UpdateInteractiveSketchSolveSessionResponse> {
    assertSupportedRequest(request, this.options);
    const stored = this.interactiveSessions.get(request.sessionId);
    if (!stored || stored.session.disposed) {
      return {
        ...makeResponseBase(request),
        sessionId: request.sessionId,
        result: {
          kind: "blocked",
          reason: "staleSession",
          solvedSnapshot: null,
          diagnostics: [
            {
              code: "stale-interactive-solve-session",
              severity: "error",
              message: `Interactive solve session ${request.sessionId} is no longer active.`,
              target: { kind: "point", pointId: request.dragTarget.pointId },
            },
          ],
        },
      };
    }

    if (
      stored.documentId !== request.documentId ||
      stored.revisionId !== request.revisionId ||
      stored.sketchId !== request.sketchId
    ) {
      return {
        ...makeResponseBase(request),
        sessionId: request.sessionId,
        result: {
          kind: "blocked",
          reason: "staleRevision",
          solvedSnapshot: stored.session.lastAcceptedSnapshot,
          diagnostics: [
            {
              code: "stale-interactive-solve-session-basis",
              severity: "error",
              message: `Interactive solve session ${request.sessionId} does not match the request document, revision, and sketch basis.`,
              target: { kind: "point", pointId: request.dragTarget.pointId },
            },
          ],
        },
      };
    }

    const result = updateCompiledSketchSolveSession(
      stored.session,
      request.dragTarget,
      request.dragTarget.kind === "sketchPoint" ? 1e-4 : undefined,
    );
    return {
      ...makeResponseBase(request),
      sessionId: request.sessionId,
      result:
        result.kind === "solved"
          ? {
              kind: "accepted",
              status: result.solvedSnapshot.status,
              solvedSnapshot: result.solvedSnapshot,
              diagnostics: result.diagnostics,
            }
          : {
              kind: "blocked",
              reason: result.reason,
              solvedSnapshot: result.solvedSnapshot,
              diagnostics: result.diagnostics,
            },
    };
  }

  async finalizeInteractiveSolveSession(
    request: FinalizeInteractiveSketchSolveSessionRequest,
  ): Promise<FinalizeInteractiveSketchSolveSessionResponse> {
    assertSupportedRequest(request, this.options);
    const stored = this.interactiveSessions.get(request.sessionId);
    if (!stored || stored.session.disposed) {
      return {
        ...makeResponseBase(request),
        sessionId: request.sessionId,
        solvedSnapshot: null,
        status: null,
        diagnostics: [
          {
            code: "stale-interactive-solve-session",
            severity: "error",
            message: `Interactive solve session ${request.sessionId} is no longer active.`,
            target: null,
          },
        ],
      };
    }

    if (
      stored.documentId !== request.documentId ||
      stored.revisionId !== request.revisionId ||
      stored.sketchId !== request.sketchId
    ) {
      return {
        ...makeResponseBase(request),
        sessionId: request.sessionId,
        solvedSnapshot: null,
        status: null,
        diagnostics: [
          {
            code: "stale-interactive-solve-session-basis",
            severity: "error",
            message: `Interactive solve session ${request.sessionId} does not match the request document, revision, and sketch basis.`,
            target: null,
          },
        ],
      };
    }

    stored.session.disposed = true;
    this.interactiveSessions.delete(request.sessionId);
    return {
      ...makeResponseBase(request),
      sessionId: request.sessionId,
      solvedSnapshot: stored.session.lastAcceptedSnapshot,
      status: stored.session.lastAcceptedSnapshot.status,
      diagnostics: stored.session.lastAcceptedSnapshot.diagnostics,
    };
  }

  async disposeInteractiveSolveSession(
    request: DisposeInteractiveSketchSolveSessionRequest,
  ): Promise<DisposeInteractiveSketchSolveSessionResponse> {
    assertSupportedRequest(request, this.options);
    const stored = this.interactiveSessions.get(request.sessionId);
    const basisMatches = Boolean(
      stored &&
      stored.documentId === request.documentId &&
      stored.revisionId === request.revisionId &&
      stored.sketchId === request.sketchId,
    );
    const disposed = Boolean(
      stored && !stored.session.disposed && basisMatches,
    );
    if (stored && basisMatches) {
      stored.session.disposed = true;
      this.interactiveSessions.delete(request.sessionId);
    }
    return {
      ...makeResponseBase(request),
      sessionId: request.sessionId,
      disposed,
      diagnostics: disposed
        ? []
        : [
            basisMatches || !stored
              ? {
                  code: "stale-interactive-solve-session",
                  severity: "warning",
                  message: `Interactive solve session ${request.sessionId} was not active.`,
                  target: null,
                }
              : {
                  code: "stale-interactive-solve-session-basis",
                  severity: "warning",
                  message: `Interactive solve session ${request.sessionId} does not match the request document, revision, and sketch basis.`,
                  target: null,
                },
          ],
    };
  }

  async deriveSketchRegions(
    request: DeriveSketchRegionsRequest,
  ): Promise<DeriveSketchRegionsResponse> {
    assertSupportedRequest(request, this.options);
    const derived = deriveSketchRegionsCore({
      documentId: request.documentId,
      revisionId: request.revisionId,
      sketchId: request.sketchId,
      solvedSnapshot: request.solvedSnapshot,
      definition: request.definition,
      projectedReferences: request.projectedReferences,
    });
    return {
      ...makeResponseBase(request),
      regions: derived.regions,
      diagnostics: derived.diagnostics,
    };
  }

  async resolveSketchReference(
    request: ResolveSketchReferenceRequest,
  ): Promise<ResolveSketchReferenceResponse> {
    assertSupportedRequest(request, this.options);
    const base = makeResponseBase(request);

    if ("referenceId" in request.target && "geometryId" in request.target) {
      const target: ProjectedSketchGeometryRef = request.target;
      const exists = request.definition.references.some(
        (reference) => reference.referenceId === target.referenceId,
      );
      return {
        ...base,
        resolution: {
          target,
          label: `Projected geometry ${target.geometryId}`,
          isValid: exists,
          invalidationReason: exists ? null : "missingProjectedGeometry",
        },
        diagnostics: [],
      };
    }

    switch (request.target.kind) {
      case "sketch":
        return {
          ...base,
          resolution: {
            target: request.target,
            label:
              request.target.sketchId === request.sketchId
                ? "Solved sketch"
                : "Unknown sketch",
            isValid: request.target.sketchId === request.sketchId,
            invalidationReason:
              request.target.sketchId === request.sketchId
                ? null
                : "missingSketch",
          },
          diagnostics: [],
        };
      case "sketchEntity": {
        const target = request.target;
        const entity = request.definition.entities.find(
          (record) => record.entityId === target.entityId,
        );
        return {
          ...base,
          resolution: {
            target,
            label: entity?.label ?? "Unknown sketch entity",
            isValid: Boolean(entity),
            invalidationReason: entity ? null : "missingEntity",
          },
          diagnostics: [],
        };
      }
      case "sketchPoint": {
        const target = request.target;
        const point = request.definition.points.find(
          (record) => record.pointId === target.pointId,
        );
        return {
          ...base,
          resolution: {
            target,
            label: point?.label ?? "Unknown sketch point",
            isValid: Boolean(point),
            invalidationReason: point ? null : "missingPoint",
          },
          diagnostics: [],
        };
      }
      case "region": {
        const target = request.target;
        const region = request.regions.find(
          (record) => record.regionId === target.regionId,
        );
        return {
          ...base,
          resolution: {
            target,
            label: region?.label ?? "Unknown region",
            isValid: Boolean(region),
            invalidationReason: region ? null : "missingRegion",
          },
          diagnostics: [],
        };
      }
    }
  }
}
