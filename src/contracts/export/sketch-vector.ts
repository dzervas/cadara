import type { DocumentExportDiagnostic } from '@/contracts/modeling/export'
import type { SketchPoint2D, SketchStyleFill, SketchStyleStroke } from '@/contracts/sketch/schema'
import type { DocumentId, RegionId, RevisionId, SketchEntityId, SketchId, SketchPointId } from '@/contracts/shared/ids'

export interface SketchVectorStyle {
  fill: SketchStyleFill
  stroke: SketchStyleStroke | null
}

export type SketchVectorEntity =
  | {
      kind: 'lineSegment'
      entityId: SketchEntityId
      label: string
      start: SketchPoint2D
      end: SketchPoint2D
      isConstruction: boolean
      style: SketchVectorStyle | null
    }
  | {
      kind: 'circle'
      entityId: SketchEntityId
      label: string
      center: SketchPoint2D
      radius: number
      isConstruction: boolean
      style: SketchVectorStyle | null
    }
  | {
      kind: 'arc'
      entityId: SketchEntityId
      label: string
      center: SketchPoint2D
      start: SketchPoint2D
      end: SketchPoint2D
      radius: number
      sweepDirection: 'clockwise' | 'counterClockwise'
      isConstruction: boolean
      style: SketchVectorStyle | null
    }
  | {
      kind: 'spline'
      entityId: SketchEntityId
      label: string
      points: readonly SketchPoint2D[]
      degree: 2 | 3
      isConstruction: boolean
      style: SketchVectorStyle | null
    }
  | {
      kind: 'bezierCurve'
      entityId: SketchEntityId
      label: string
      controlPoints: readonly SketchPoint2D[]
      degree: 2 | 3
      isConstruction: boolean
      style: SketchVectorStyle | null
    }
  | {
      kind: 'conic'
      entityId: SketchEntityId
      label: string
      start: SketchPoint2D
      control: SketchPoint2D
      end: SketchPoint2D
      rho: number
      isConstruction: boolean
      style: SketchVectorStyle | null
    }

export interface SketchVectorRegionSegment {
  entityId: SketchEntityId
  traversalDirection: 'forward' | 'reverse'
}

export interface SketchVectorRegionLoop {
  role: 'outer' | 'inner'
  segments: readonly SketchVectorRegionSegment[]
  boundaryPointIds: readonly SketchPointId[]
  isClosed: boolean
}

export interface SketchVectorRegion {
  regionId: RegionId
  label: string
  loops: readonly SketchVectorRegionLoop[]
  style: SketchVectorStyle | null
}

export interface SketchVectorExportModel {
  documentId: DocumentId
  revisionId: RevisionId
  sketchId: SketchId
  label: string
  units: 'millimeter'
  points: ReadonlyMap<SketchPointId, SketchPoint2D>
  entities: readonly SketchVectorEntity[]
  regions: readonly SketchVectorRegion[]
  diagnostics: readonly DocumentExportDiagnostic[]
}
