import type { ExportCapabilities } from "@/contracts/export/capabilities";
import type {
  ExportProvider,
  ExportProviderInput,
  ExportProviderResult,
} from "@/contracts/export/provider";
import type { ExportResult } from "@/contracts/export/result";
import type { DurableRef } from "@/contracts/shared/references";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";

export interface StepExportOptions {
  schema: "AP203" | "AP214" | "AP242";
  unit: "millimeter";
}

function exportStep(
  target: DurableRef,
  options: StepExportOptions,
  capabilities: ExportCapabilities,
): Promise<ExportResult> {
  return Promise.resolve(
    capabilities.brep.writeStep(target, {
      schema: options.schema,
      unit: options.unit,
    }),
  ).then((result) => {
    if (!("payload" in result)) {
      return { ok: false, diagnostics: [result.diagnostic] };
    }

    return { ok: true, payload: result.payload, diagnostics: [] };
  });
}

export const stepExportProvider: ExportProvider<
  StepExportOptions,
  FeatureEditorFormSchema
> = {
  id: "step",
  label: "STEP",
  formatId: "step",
  fileExtension: "step",
  mimeType: "model/step",
  targetKinds: ["body"],

  getDefaultOptions(): StepExportOptions {
    return { schema: "AP242", unit: "millimeter" };
  },

  getOptionFormSchema(options: StepExportOptions): FeatureEditorFormSchema {
    return {
      sections: [
        {
          id: "step-options",
          title: "STEP options",
          fields: [
            {
              kind: "enum",
              id: "schema",
              label: "Schema",
              value: options.schema,
              options: [
                { value: "AP242", label: "AP242" },
                { value: "AP214", label: "AP214" },
                { value: "AP203", label: "AP203" },
              ],
              patch: { patchKey: "schema" },
            },
            {
              kind: "enum",
              id: "unit",
              label: "Unit",
              value: options.unit,
              options: [{ value: "millimeter", label: "Millimeter" }],
              patch: { patchKey: "unit" },
            },
          ],
        },
      ],
    };
  },

  applyOptionPatch(
    options: StepExportOptions,
    patch: Record<string, unknown>,
  ): StepExportOptions {
    let current = { ...options };

    if (
      patch["schema"] === "AP203" ||
      patch["schema"] === "AP214" ||
      patch["schema"] === "AP242"
    ) {
      current = { ...current, schema: patch["schema"] };
    }

    if (patch["unit"] === "millimeter") {
      current = { ...current, unit: patch["unit"] };
    }

    return current;
  },

  export(input: ExportProviderInput<StepExportOptions>): ExportProviderResult {
    return exportStep(input.target, input.options, input.capabilities);
  },
};
