import type { DurableRef } from '@/contracts/shared/references'
import type { DocumentExportDiagnostic as ExportDiagnostic } from '@/contracts/modeling/export'
import type { SketchVectorExportModel } from '@/contracts/export/sketch-vector'

export type MeshPoint = readonly [number, number, number]

export interface MeshTriangle {
  normal: MeshPoint
  vertices: readonly [MeshPoint, MeshPoint, MeshPoint]
}

export interface MeshExportAccuracy {
  chordTolerance: number
  angleToleranceRadians: number
}

export interface StepWriterOptions {
  schema: 'AP203' | 'AP214' | 'AP242'
  unit: 'millimeter'
}

export type ExportCapabilityResult<T> = T | Promise<T>

export interface MeshTessellationCapability {
  tessellate(target: DurableRef, options: MeshExportAccuracy): ExportCapabilityResult<MeshTriangle[] | ExportDiagnostic>
}

export interface BRepWriterCapability {
  writeStep(target: DurableRef, options: StepWriterOptions): ExportCapabilityResult<{ payload: string } | { diagnostic: ExportDiagnostic }>
}

export interface SketchVectorExportCapability {
  resolveSketchVectorModel(target: DurableRef): ExportCapabilityResult<SketchVectorExportModel | { diagnostic: ExportDiagnostic }>
}

export interface ExportCapabilities {
  mesh: MeshTessellationCapability
  brep: BRepWriterCapability
  sketchVector: SketchVectorExportCapability
}
