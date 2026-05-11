import type { ExportProvider } from "@/contracts/export/provider";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";
import { createExportProviderRegistry } from "@/domain/export/provider-registry";
import { dxfSketchExportProvider } from "@/domain/export/providers/dxf-sketch-export-provider";
import { svgSketchExportProvider } from "@/domain/export/providers/svg-sketch-export-provider";
import { stlExportProvider } from "@/domain/export/providers/stl-export-provider";
import { stepExportProvider } from "@/domain/export/providers/step-export-provider";
import { threeMfExportProvider } from "@/domain/export/providers/threemf-export-provider";

export const builtinExportProviders = [
  stlExportProvider,
  stepExportProvider,
  threeMfExportProvider,
  svgSketchExportProvider,
  dxfSketchExportProvider,
] as const satisfies readonly ExportProvider<
  unknown,
  FeatureEditorFormSchema
>[];

export function createBuiltinExportProviderRegistry() {
  return createExportProviderRegistry(builtinExportProviders);
}
