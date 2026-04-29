import type { SketchSolverAdapter as SketchSolverBoundary } from '@/contracts/solver/adapter'
import type {
  SolveSketchRequest,
  ValidateSketchRequest,
  DeriveSketchRegionsRequest,
  ProjectSketchExternalReferencesRequest,
  ResolveSketchReferenceRequest,
} from '@/contracts/solver/schema'
import type { RequestId } from '@/contracts/shared/ids'
import type { SketchSolverService } from './types'
import { withContractVersion } from './helpers'

export function createSketchSolverService(
  adapter: SketchSolverBoundary,
): SketchSolverService {
  return {
    solveSketch(input) {
      return adapter.solveSketch(withContractVersion<SolveSketchRequest>(input))
    },
    validateSketch(input) {
      return adapter.validateSketch(withContractVersion<ValidateSketchRequest>(input))
    },
    deriveSketchRegions(input) {
      return adapter.deriveSketchRegions(withContractVersion<DeriveSketchRegionsRequest>(input))
    },
    projectExternalReferences(input) {
      return adapter.projectExternalReferences(
        withContractVersion<ProjectSketchExternalReferencesRequest>(input),
      )
    },
    resolveSketchReference(input) {
      return adapter.resolveSketchReference(
        withContractVersion<ResolveSketchReferenceRequest>(input),
      )
    },
    createCommitCorrelation(requestId) {
      return {
        requestId,
        projectionRequestId: `${requestId}:project` as RequestId,
        validationRequestId: `${requestId}:validate` as RequestId,
        solveRequestId: `${requestId}:solve` as RequestId,
        regionRequestId: `${requestId}:regions` as RequestId,
      }
    },
  }
}
