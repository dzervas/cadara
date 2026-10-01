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
import { validateSketchSolverEnvelope } from "@/contracts/solver/runtime-schema";
import type { NeutralCurveQueryCapability } from "@/contracts/modeling/neutral-curve-query";
import {
  compileSketchSolveProgram,
  createCompiledSketchSolveSession,
  createSketchArrangementDeriver,
  solveSketchDefinitionCore,
  updateCompiledSketchSolveSession,
  validateSketchDefinitionCore,
  type SketchArrangementDeriver,
  type SketchCompiledSolveSession,
  type ProjectedSketchGeometryRef,
  type SketchSolveDiagnostic,
} from "@/contracts/sketch";
import type { DocumentId, RevisionId } from "@/contracts/shared/ids";
import { OffsetCertificationMemo } from "@/contracts/sketch/offset-derivation-frame";
import { publishSketchOffsets } from "@/contracts/sketch/offset-publication";
import type { OffsetPublicationCapabilities } from "@/contracts/sketch/offset-publication";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import { createCertifiedNeutralCurveRequestQuery } from "@/domain/modeling/neutral-curve-certification/query";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";

/**
 * Answers `deriveSketchRegions` elsewhere, e.g. the dedicated sketch-derivation
 * worker. It may reject a request with `SketchRegionDerivationSupersededError`
 * when a newer request for the same document replaced it; any other rejection
 * is a real failure.
 */
export type SketchRegionDerivationDelegate = Pick<
  SketchSolverAdapter,
  "deriveSketchRegions"
>;

/** A live region derivation cancelled because a newer one for its document started. */
export class SketchRegionDerivationSupersededError extends Error {
  override readonly name = "SketchRegionDerivationSupersededError";
  readonly requestId: DeriveSketchRegionsRequest["requestId"];
  readonly supersededBy: DeriveSketchRegionsRequest["requestId"];

  constructor(
    request: DeriveSketchRegionsRequest,
    supersededBy: DeriveSketchRegionsRequest,
  ) {
    super(
      `Sketch region derivation ${request.requestId} was superseded by ${supersededBy.requestId} for document ${request.documentId}.`,
    );
    this.requestId = request.requestId;
    this.supersededBy = supersededBy.requestId;
  }
}

export interface SketchConstraintSolverAdapterOptions {
  documentId: DocumentId;
  revisionId: RevisionId | null;
  /** The selected kernel's neutral curve queries; only `deriveSketchRegions` uses them. */
  neutralCurveQueries: NeutralCurveQueryCapability;
  /**
   * When present, `deriveSketchRegions` forwards the validated request here
   * unchanged instead of deriving on this thread; the delegate recomputes the
   * result from the plain request.
   */
  regionDerivation?: SketchRegionDerivationDelegate;
}

interface StoredInteractiveSolveSession {
  session: SketchCompiledSolveSession;
  documentId: StartInteractiveSketchSolveSessionRequest["documentId"];
  revisionId: StartInteractiveSketchSolveSessionRequest["revisionId"];
  sketchId: StartInteractiveSketchSolveSessionRequest["sketchId"];
}

const DEFAULT_OPTIONS = {
  documentId: "doc_workspace",
  revisionId: "rev_0001",
} satisfies Partial<SketchConstraintSolverAdapterOptions>;

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
  const parsed = validateSketchSolverEnvelope(request);
  if (!parsed.success) {
    throw new Error(
      parsed.issues[0]?.message ??
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

/** Region requests carry the document's modeling tolerance; there is no default. */
export function assertDocumentModelingTolerance(modelingTolerance: unknown) {
  if (
    typeof modelingTolerance !== "number" ||
    !Number.isFinite(modelingTolerance) ||
    modelingTolerance <= 0
  ) {
    throw new RangeError(
      `Region derivation requires the document modelingTolerance as a positive finite number; received ${String(modelingTolerance)}.`,
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
  private readonly regionDeriver: SketchArrangementDeriver;
  /** Kernel-free offset certification ([TECH] G1): one memo per adapter. */
  private readonly offsetPublication: OffsetPublicationCapabilities = {
    query: createCertifiedNeutralCurveRequestQuery(),
    certifier: createCertifiedCubicTubeChain(),
    memo: new OffsetCertificationMemo(),
  };

  /** Live derivations forwarded to a terminable delegate are superseded (T08b-g5). */
  get supersedesRegionDerivation() {
    return this.options.regionDerivation !== undefined;
  }

  constructor(
    options: Partial<Omit<SketchConstraintSolverAdapterOptions, "neutralCurveQueries">> &
      Pick<SketchConstraintSolverAdapterOptions, "neutralCurveQueries">,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.regionDeriver = createSketchArrangementDeriver(
      options.neutralCurveQueries,
    );
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
      modelingTolerance: request.modelingTolerance,
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
      modelingTolerance: request.modelingTolerance,
      ...(request.offsetPlans ? { offsetPlans: request.offsetPlans } : {}),
      partialSolvePolicy: request.partialSolvePolicy,
    });

    return {
      ...makeResponseBase(request),
      status: solved.status,
      solvedSnapshot: solved.solvedSnapshot,
      diagnostics: solved.diagnostics,
    };
  }

  async startInteractiveSolveSession(
    request: StartInteractiveSketchSolveSessionRequest,
  ): Promise<StartInteractiveSketchSolveSessionResponse> {
    assertSupportedRequest(request, this.options);
    const offsetPlans = request.priorSolvedSnapshot?.offsetFramePlans;
    const program = compileSketchSolveProgram({
      definition: request.definition,
      projectedReferences: request.projectedReferences,
      tolerances: request.tolerances,
      modelingTolerance: request.modelingTolerance,
      ...(offsetPlans ? { offsetPlans } : {}),
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
    assertDocumentModelingTolerance(request.modelingTolerance);
    if (this.options.regionDerivation) {
      return this.options.regionDerivation.deriveSketchRegions(request);
    }
    // [TECH] G1: publish first (relationship-scoped), then regions.
    const offsetPublications = publishSketchOffsets({
      definition: request.definition,
      solvedSnapshot: request.solvedSnapshot,
      modelingTolerance: request.modelingTolerance,
      capabilities: this.offsetPublication,
    });
    const derived = await this.regionDeriver.derive({
      documentId: request.documentId,
      revisionId: request.revisionId,
      sketchId: request.sketchId,
      solvedSnapshot: request.solvedSnapshot,
      definition: request.definition,
      projectedReferences: request.projectedReferences,
      modelingTolerance: request.modelingTolerance,
    });
    return {
      ...makeResponseBase(request),
      regions: derived.regions,
      diagnostics: derived.diagnostics,
      offsetPublications,
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
