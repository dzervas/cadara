import type { ExportCapabilities } from "@/contracts/export/capabilities";
import type {
  DocumentExportFailureResult,
  DocumentExportResult,
  DocumentExportSuccessResult,
} from "@/contracts/modeling/export";
import type { BodyAppearance } from "@/contracts/modeling/body-appearance";
import type { DurableRef } from "@/contracts/shared/references";
import type { ExportProviderRegistry } from "@/core/export/provider-registry";
import { exportProviderSupportsTarget } from "@/contracts/export/provider";

export interface OrchestratorGeometryExportInput {
  format: string;
  options: unknown;
  target: DurableRef;
  targetLabel: string;
  targetAppearance: BodyAppearance | null;
}

function createExportFilename(targetLabel: string, extension: string): string {
  const slug = targetLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${slug || "cadara-export"}.${extension}`;
}

export async function orchestrateGeometryExport(
  input: OrchestratorGeometryExportInput,
  capabilities: ExportCapabilities,
  exportProviders: ExportProviderRegistry,
): Promise<DocumentExportResult> {
  const provider = exportProviders.getByFormat(input.format);

  if (!provider) {
    const failure: DocumentExportFailureResult = {
      ok: false,
      format: input.format,
      diagnostics: [
        {
          code: "export-unsupported-format",
          severity: "error",
          message: `No export provider is registered for format '${input.format}'.`,
          target: input.target,
        },
      ],
    };

    return failure;
  }

  if (!exportProviderSupportsTarget(provider, input.target)) {
    const failure: DocumentExportFailureResult = {
      ok: false,
      format: input.format,
      diagnostics: [
        {
          code: "export-incompatible-target",
          severity: "error",
          message: `Format '${input.format}' cannot export target kind '${input.target.kind}'.`,
          target: input.target,
        },
      ],
    };

    return failure;
  }

  try {
    provider.validateOptions?.(input.options);
  } catch (error) {
    return {
      ok: false,
      format: input.format,
      diagnostics: [
        {
          code: `invalid-${input.format}-options`,
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
          target: input.target,
        },
      ],
    };
  }

  const result = await provider.export({
    target: input.target,
    targetLabel: input.targetLabel,
    targetAppearance: input.targetAppearance,
    options: input.options,
    capabilities,
  });

  if (!result.ok) {
    const failure: DocumentExportFailureResult = {
      ok: false,
      format: input.format,
      diagnostics: result.diagnostics,
    };

    return failure;
  }

  const success: DocumentExportSuccessResult = {
    ok: true,
    format: input.format,
    filename: createExportFilename(input.targetLabel, provider.fileExtension),
    extension: provider.fileExtension,
    mimeType: provider.mimeType,
    payload: result.payload,
    diagnostics: result.diagnostics,
  };

  return success;
}
