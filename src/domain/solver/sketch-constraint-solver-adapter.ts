import type { SketchSolverAdapter } from '@/contracts/solver/adapter'
import {
  SOLVER_SCHEMA_VERSION,
  type DeriveSketchRegionsRequest,
  type DeriveSketchRegionsResponse,
  type ProjectedSketchReferenceRecord,
  type ProjectSketchExternalReferencesRequest,
  type ProjectSketchExternalReferencesResponse,
  type ResolveSketchReferenceRequest,
  type ResolveSketchReferenceResponse,
  type SketchSolverResponseBase,
  type SolveSketchRequest,
  type SolveSketchResponse,
  type ValidateSketchRequest,
  type ValidateSketchResponse,
} from '@/contracts/solver/schema'
import { sketchSolverEnvelopeSchema } from '@/contracts/solver/runtime-schema'
import {
  deriveSketchRegionsCore,
  solveSketchDefinitionWithDraggedPointTarget,
  solveSketchDefinitionCore,
  validateSketchDefinitionCore,
  type ProjectedSketchGeometryRef,
  type SketchSolveDiagnostic,
} from '@/contracts/sketch'
import type { DocumentId, RevisionId } from '@/contracts/shared/ids'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'

export interface SketchConstraintSolverAdapterOptions {
  documentId: DocumentId
  revisionId: RevisionId | null
}

const DEFAULT_OPTIONS: SketchConstraintSolverAdapterOptions = {
  documentId: 'doc_workspace',
  revisionId: 'rev_0001',
}

function makeResponseBase(
  request:
    | ProjectSketchExternalReferencesRequest
    | ValidateSketchRequest
    | SolveSketchRequest
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
  }
}

function makeProjectionDiagnostic(
  code: string,
  severity: SketchSolveDiagnostic['severity'],
  message: string,
): SketchSolveDiagnostic {
  return {
    code,
    severity,
    message,
    target: null,
  }
}

function projectReference(
  reference: ProjectSketchExternalReferencesRequest['references'][number],
): Omit<ProjectedSketchReferenceRecord, 'referenceId'> {
  if (reference.reference.kind === 'constructionPlane') {
    return {
      status: 'projected',
      geometry: [],
      diagnostics: [],
    }
  }

  if (reference.reference.kind === 'sketchReference') {
    return {
      status: 'unsupportedSource',
      geometry: [],
      diagnostics: [{
        code: 'unsupported-sketch-reference-source',
        severity: 'warning',
        message: `Sketch reference ${reference.referenceId} does not expose projectable geometry in this solver.`,
        target: null,
      }],
    }
  }

  return {
    status: 'unsupportedSource',
    geometry: [],
    diagnostics: [
      makeProjectionDiagnostic(
        'unsupported-model-reference-source',
        'warning',
        `Model reference ${reference.referenceId} cannot be projected because this solver adapter has no resolved source geometry.`,
      ),
    ],
  }
}

function assertSupportedRequest(
  request:
    | ProjectSketchExternalReferencesRequest
    | ValidateSketchRequest
    | SolveSketchRequest
    | DeriveSketchRegionsRequest
    | ResolveSketchReferenceRequest,
  options: SketchConstraintSolverAdapterOptions,
) {
  const parsed = sketchSolverEnvelopeSchema.safeParse(request)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid sketch solver request envelope.')
  }

  if (request.documentId !== options.documentId || (options.revisionId !== null && request.revisionId !== options.revisionId)) {
    throw new Error(
      `Solver request targeted ${request.documentId}@${request.revisionId}, but the runtime is configured for ${options.documentId}@${options.revisionId}.`,
    )
  }
}

export class SketchConstraintSolverAdapter implements SketchSolverAdapter {
  private readonly options: SketchConstraintSolverAdapterOptions

  constructor(options: Partial<SketchConstraintSolverAdapterOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  async projectExternalReferences(
    request: ProjectSketchExternalReferencesRequest,
  ): Promise<ProjectSketchExternalReferencesResponse> {
    assertSupportedRequest(request, this.options)
    return {
      ...makeResponseBase(request),
      projectedReferences: request.references.map((reference) => ({
        referenceId: reference.referenceId,
        ...projectReference(reference),
      })),
      diagnostics: [],
    }
  }

  async validateSketch(request: ValidateSketchRequest): Promise<ValidateSketchResponse> {
    assertSupportedRequest(request, this.options)
    const validation = validateSketchDefinitionCore({
      definition: request.definition,
      projectedReferences: request.projectedReferences,
      tolerances: request.tolerances,
    })
    return {
      ...makeResponseBase(request),
      isValid: validation.isValid,
      diagnostics: validation.diagnostics,
    }
  }

  async solveSketch(request: SolveSketchRequest): Promise<SolveSketchResponse> {
    assertSupportedRequest(request, this.options)
    const solved = request.dragTarget
      ? (() => {
          const result = solveSketchDefinitionWithDraggedPointTarget({
            definition: request.definition,
            projectedReferences: request.projectedReferences,
            dragTarget: request.dragTarget,
            tolerances: request.tolerances,
            partialSolvePolicy: request.partialSolvePolicy,
          })

          return {
            status: result.solvedSnapshot?.status ?? {
              solveState: 'failed' as const,
              constraintState: 'inconsistent' as const,
            },
            solvedSnapshot: result.solvedSnapshot ?? solveSketchDefinitionCore({
              definition: request.definition,
              projectedReferences: request.projectedReferences,
              tolerances: request.tolerances,
              partialSolvePolicy: 'failOnConflict',
            }).solvedSnapshot,
            diagnostics: result.diagnostics,
          }
        })()
      : solveSketchDefinitionCore({
          definition: request.definition,
          projectedReferences: request.projectedReferences,
          tolerances: request.tolerances,
          partialSolvePolicy: request.partialSolvePolicy,
        })
    const derived = deriveSketchRegionsCore({
      documentId: request.documentId,
      revisionId: request.revisionId,
      sketchId: request.sketchId,
      solvedSnapshot: solved.solvedSnapshot,
      definition: request.definition,
      projectedReferences: request.projectedReferences,
    })

    return {
      ...makeResponseBase(request),
      status: solved.status,
      solvedSnapshot: solved.solvedSnapshot,
      derivedRegions: derived.regions,
      diagnostics: [...solved.diagnostics, ...derived.diagnostics],
    }
  }

  async deriveSketchRegions(
    request: DeriveSketchRegionsRequest,
  ): Promise<DeriveSketchRegionsResponse> {
    assertSupportedRequest(request, this.options)
    const derived = deriveSketchRegionsCore({
      documentId: request.documentId,
      revisionId: request.revisionId,
      sketchId: request.sketchId,
      solvedSnapshot: request.solvedSnapshot,
      definition: request.definition,
      projectedReferences: request.projectedReferences,
    })
    return {
      ...makeResponseBase(request),
      regions: derived.regions,
      diagnostics: derived.diagnostics,
    }
  }

  async resolveSketchReference(
    request: ResolveSketchReferenceRequest,
  ): Promise<ResolveSketchReferenceResponse> {
    assertSupportedRequest(request, this.options)
    const base = makeResponseBase(request)

    if ('referenceId' in request.target && 'geometryId' in request.target) {
      const target: ProjectedSketchGeometryRef = request.target
      const exists = request.definition.references.some((reference) => reference.referenceId === target.referenceId)
      return {
        ...base,
        resolution: {
          target,
          label: `Projected geometry ${target.geometryId}`,
          isValid: exists,
          invalidationReason: exists ? null : 'missingProjectedGeometry',
        },
        diagnostics: [],
      }
    }

    switch (request.target.kind) {
      case 'sketch':
        return {
          ...base,
          resolution: {
            target: request.target,
            label: request.target.sketchId === request.sketchId ? 'Solved sketch' : 'Unknown sketch',
            isValid: request.target.sketchId === request.sketchId,
            invalidationReason: request.target.sketchId === request.sketchId ? null : 'missingSketch',
          },
          diagnostics: [],
        }
      case 'sketchEntity': {
        const target = request.target
        const entity = request.definition.entities.find((record) => record.entityId === target.entityId)
        return {
          ...base,
          resolution: {
            target,
            label: entity?.label ?? 'Unknown sketch entity',
            isValid: Boolean(entity),
            invalidationReason: entity ? null : 'missingEntity',
          },
          diagnostics: [],
        }
      }
      case 'sketchPoint': {
        const target = request.target
        const point = request.definition.points.find((record) => record.pointId === target.pointId)
        return {
          ...base,
          resolution: {
            target,
            label: point?.label ?? 'Unknown sketch point',
            isValid: Boolean(point),
            invalidationReason: point ? null : 'missingPoint',
          },
          diagnostics: [],
        }
      }
      case 'region': {
        const target = request.target
        const region = request.regions.find((record) => record.regionId === target.regionId)
        return {
          ...base,
          resolution: {
            target,
            label: region?.label ?? 'Unknown region',
            isValid: Boolean(region),
            invalidationReason: region ? null : 'missingRegion',
          },
          diagnostics: [],
        }
      }
    }
  }
}
