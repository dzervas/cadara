import type {
  AddDocumentVariableRequest,
  CommitSketchRequest,
  CreateFeatureRequest,
} from '@/contracts/modeling/schema'
import type { ImportBinding } from '@/contracts/import/binding'
import type { ImportDiagnostic } from '@/contracts/import/diagnostics'

export type ImportPreparedActionKind = 'createFeature' | 'commitSketch' | 'addDocumentVariable'

/**
 * The orchestrator applies these through existing adapter methods.
 */
export interface ImportPreparedActions {
  createFeatures?: CreateFeatureRequest[]
  commitSketches?: CommitSketchRequest[]
  addDocumentVariables?: AddDocumentVariableRequest[]
  binding?: ImportBinding
  diagnostics?: ImportDiagnostic[]
}
