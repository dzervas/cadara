import type {
  DeriveSketchRegionsRequest,
  DeriveSketchRegionsResponse,
  DisposeInteractiveSketchSolveSessionRequest,
  DisposeInteractiveSketchSolveSessionResponse,
  FinalizeInteractiveSketchSolveSessionRequest,
  FinalizeInteractiveSketchSolveSessionResponse,
  ProjectSketchExternalReferencesRequest,
  ProjectSketchExternalReferencesResponse,
  ResolveSketchReferenceRequest,
  ResolveSketchReferenceResponse,
  SolveSketchRequest,
  SolveSketchResponse,
  StartInteractiveSketchSolveSessionRequest,
  StartInteractiveSketchSolveSessionResponse,
  UpdateInteractiveSketchSolveSessionRequest,
  UpdateInteractiveSketchSolveSessionResponse,
  ValidateSketchRequest,
  ValidateSketchResponse,
} from '@/contracts/solver/schema'

/**
 * Dedicated sketch solver boundary.
 * Implementers must treat this as a standalone subsystem rather than folding it
 * into the kernel or editor runtime implicitly.
 */
export interface SketchSolverAdapter {
  /**
   * Projects authored external references into sketch-space coordinates.
   * This must be explicit so callers never infer projected geometry in UI code.
   */
  projectExternalReferences(
    request: ProjectSketchExternalReferencesRequest,
  ): Promise<ProjectSketchExternalReferencesResponse>
  /**
   * Validates an authored sketch definition before or alongside solving.
   * Validation diagnostics must be machine-readable and must not depend on
   * human-readable messages for control flow.
   */
  validateSketch(request: ValidateSketchRequest): Promise<ValidateSketchResponse>
  /**
   * Solves an authored sketch definition into authoritative solved geometry.
   * The solver owns the returned solved snapshot, statuses, and diagnostics.
   */
  solveSketch(request: SolveSketchRequest): Promise<SolveSketchResponse>
  /**
   * Starts a warm-startable interactive solve lifecycle for drag-style edits.
   */
  startInteractiveSolveSession(
    request: StartInteractiveSketchSolveSessionRequest,
  ): Promise<StartInteractiveSketchSolveSessionResponse>
  /**
   * Updates an active interactive solve session with the latest drag target.
   */
  updateInteractiveSolveSession(
    request: UpdateInteractiveSketchSolveSessionRequest,
  ): Promise<UpdateInteractiveSketchSolveSessionResponse>
  /**
   * Finalizes the latest accepted result for an interactive solve session.
   */
  finalizeInteractiveSolveSession(
    request: FinalizeInteractiveSketchSolveSessionRequest,
  ): Promise<FinalizeInteractiveSketchSolveSessionResponse>
  /**
   * Disposes an interactive solve session without committing a final result.
   */
  disposeInteractiveSolveSession(
    request: DisposeInteractiveSketchSolveSessionRequest,
  ): Promise<DisposeInteractiveSketchSolveSessionResponse>
  /**
   * Derives closed sketch regions from a solved sketch state.
   * Regions must be explicit outputs, never editor-authored durable facts.
   */
  deriveSketchRegions(
    request: DeriveSketchRegionsRequest,
  ): Promise<DeriveSketchRegionsResponse>
  /**
   * Resolves a sketch-local target and reports whether it is still valid.
   * Implementers must not silently remap invalid targets to surviving geometry.
   */
  resolveSketchReference(
    request: ResolveSketchReferenceRequest,
  ): Promise<ResolveSketchReferenceResponse>
}
