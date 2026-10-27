import type { ExportProvider } from "@/contracts/export/provider";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";
import { createExportProviderRegistry } from "@/core/export/provider-registry";
import { dxfSketchExportProvider } from "@/application/export/providers/dxf-sketch-export-provider";
import { svgSketchExportProvider } from "@/application/export/providers/svg-sketch-export-provider";
import { stlExportProvider } from "@/application/export/providers/stl-export-provider";
import { stepExportProvider } from "@/application/export/providers/step-export-provider";
import { threeMfExportProvider } from "@/application/export/providers/threemf-export-provider";

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
