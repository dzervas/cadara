import type {
  CadaraExportOptions,
  DocumentExportFormat,
  StlExportOptions,
  StepExportOptions,
  ThreeMfExportOptions,
} from '@/contracts/modeling/export'
import type { ModelingExportDocumentInput } from '@/domain/modeling/modeling-service'
import type { ObjectExportModalState } from '@/app/object-export-state'

export function buildDocumentExportModalInput(
  target: ObjectExportModalState,
  format: 'stl',
  options: StlExportOptions,
): ModelingExportDocumentInput
export function buildDocumentExportModalInput(
  target: ObjectExportModalState,
  format: 'step',
  options: StepExportOptions,
): ModelingExportDocumentInput
export function buildDocumentExportModalInput(
  target: ObjectExportModalState,
  format: '3mf',
  options: ThreeMfExportOptions,
): ModelingExportDocumentInput
export function buildDocumentExportModalInput(
  target: ObjectExportModalState,
  format: 'cadara',
  options: CadaraExportOptions,
): ModelingExportDocumentInput
export function buildDocumentExportModalInput(
  target: ObjectExportModalState,
  format: DocumentExportFormat,
  options: StlExportOptions | StepExportOptions | ThreeMfExportOptions | CadaraExportOptions,
): ModelingExportDocumentInput {
  switch (format) {
    case 'stl':
      return {
        baseRevisionId: target.baseRevisionId,
        target: target.target,
        targetLabel: target.label,
        format,
        options: options as StlExportOptions,
      }
    case 'step':
      return {
        baseRevisionId: target.baseRevisionId,
        target: target.target,
        targetLabel: target.label,
        format,
        options: options as StepExportOptions,
      }
    case '3mf':
      return {
        baseRevisionId: target.baseRevisionId,
        target: target.target,
        targetLabel: target.label,
        format,
        options: options as ThreeMfExportOptions,
      }
    case 'cadara':
      return {
        baseRevisionId: target.baseRevisionId,
        target: target.target,
        targetLabel: target.label,
        format,
        options: options as CadaraExportOptions,
      }
  }
}
