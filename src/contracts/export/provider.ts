import type { ExportCapabilities } from "@/contracts/export/capabilities";
import type { ExportResult } from "@/contracts/export/result";
import type { BodyAppearance } from "@/contracts/modeling/body-appearance";
import type { DurableRef } from "@/contracts/shared/references";

export type ExportProviderResult = ExportResult | Promise<ExportResult>;
export type ExportTargetKind = DurableRef["kind"];

export interface ExportProviderInput<TOptions> {
  target: DurableRef;
  targetLabel: string;
  /** Display colour of a body target at the exported revision; `null` for other targets. */
  targetAppearance: BodyAppearance | null;
  options: TOptions;
  capabilities: ExportCapabilities;
}

export interface ExportProvider<TOptions = unknown, TFormSchema = unknown> {
  id: string;
  label: string;
  formatId: string;
  fileExtension: string;
  mimeType: string;
  targetKinds: readonly ExportTargetKind[];
  validateOptions?(options: unknown): void;
  getDefaultOptions(): TOptions;
  getOptionFormSchema(options: TOptions): TFormSchema;
  applyOptionPatch(options: TOptions, patch: Record<string, unknown>): TOptions;
  export(input: ExportProviderInput<TOptions>): ExportProviderResult;
}

export function exportProviderSupportsTarget(
  provider: Pick<ExportProvider<unknown, unknown>, "targetKinds">,
  target: DurableRef,
): boolean {
  return provider.targetKinds.includes(target.kind);
}
