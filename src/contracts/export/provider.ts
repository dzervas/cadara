import type { ExportCapabilities } from '@/contracts/export/capabilities'
import type { ExportResult } from '@/contracts/export/result'
import type { DurableRef } from '@/contracts/shared/references'
import type { FeatureEditorFormSchema } from '@/domain/feature-authoring/form-schema'

export interface ExportProviderInput<TOptions> {
  target: DurableRef
  targetLabel: string
  options: TOptions
  capabilities: ExportCapabilities
}

export interface ExportProvider<TOptions = unknown> {
  id: string
  label: string
  formatId: string
  fileExtension: string
  mimeType: string
  getDefaultOptions(): TOptions
  getOptionFormSchema(options: TOptions): FeatureEditorFormSchema
  applyOptionPatch(options: TOptions, patch: Record<string, unknown>): TOptions
  export(input: ExportProviderInput<TOptions>): ExportResult
}
