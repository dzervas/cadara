import type { MeshExportAccuracy, StepWriterOptions } from "./capabilities";

export interface StlExportOptions {
  meshAccuracy: MeshExportAccuracy;
  encoding: "binary" | "ascii";
}
export type StepExportOptions = StepWriterOptions;
export interface ThreeMfExportOptions {
  meshAccuracy: MeshExportAccuracy;
  unit: "millimeter";
  includeMetadata: boolean;
}
export type SketchVectorExportOptions = Record<string, never>;

export interface ExportProviderDescription {
  format: string;
  label: string;
  extension: string;
  mimeType: string;
  targetKinds: readonly import("./provider").ExportTargetKind[];
  defaultOptions: unknown;
}
