import type { DurableRef } from '@/contracts/shared/references'
import type { DocumentExportDiagnostic as ExportDiagnostic } from '@/contracts/modeling/export'

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

export interface MeshTessellationCapability {
  tessellate(target: DurableRef, options: MeshExportAccuracy): MeshTriangle[] | ExportDiagnostic
}

export interface BRepWriterCapability {
  writeStep(target: DurableRef, options: StepWriterOptions): { payload: string } | { diagnostic: ExportDiagnostic }
}

export interface ExportCapabilities {
  mesh: MeshTessellationCapability
  brep: BRepWriterCapability
}
