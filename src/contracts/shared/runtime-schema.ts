import { z } from 'zod'

import type {
  BodyId,
  ConstructionId,
  ConstraintId,
  DimensionId,
  DocumentId,
  DocumentVariableId,
  EdgeId,
  FaceId,
  FeatureId,
  FeatureTreeNodeId,
  LoopId,
  ObjectTreeNodeId,
  PickId,
  PreviewId,
  ProjectedGeometryId,
  ReferenceId,
  RegionId,
  RenderableId,
  RequestId,
  RevisionId,
  SketchAuthoringOperationId,
  SketchEntityId,
  SketchId,
  SketchPointId,
  SketchStyleId,
  SnapshotEntityId,
  VertexId,
} from '@/contracts/shared/ids'
import type { ContractVersion } from '@/contracts/shared/versioning'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'

function prefixedIdSchema<T extends string>(prefix: string, label: string) {
  return z.string().regex(new RegExp(`^${prefix}.+$`), `${label} is invalid.`).transform((value) => value as T)
}

export function literalVersionSchema<T extends string>(
  expected: T,
  fieldLabel: string,
  mismatchMessage: string,
) {
  return z.string().superRefine((value, ctx) => {
    if (value !== expected) {
      ctx.addIssue({
        code: 'custom',
        message: `${mismatchMessage}; expected ${fieldLabel} ${expected}.`,
      })
    }
  }).transform(() => expected)
}

export const contractVersionSchema = literalVersionSchema<ContractVersion>(
  CONTRACT_VERSION,
  'contractVersion',
  'Unsupported contract version',
)

export const documentIdSchema = prefixedIdSchema<DocumentId>('doc_', 'Document ID')
export const documentVariableIdSchema = prefixedIdSchema<DocumentVariableId>('variable_', 'Document variable ID')
export const revisionIdSchema = prefixedIdSchema<RevisionId>('rev_', 'Revision ID')
export const featureIdSchema = prefixedIdSchema<FeatureId>('feature_', 'Feature ID')
export const sketchIdSchema = prefixedIdSchema<SketchId>('sketch_', 'Sketch ID')
export const bodyIdSchema = prefixedIdSchema<BodyId>('body_', 'Body ID')
export const faceIdSchema = prefixedIdSchema<FaceId>('face_', 'Face ID')
export const edgeIdSchema = prefixedIdSchema<EdgeId>('edge_', 'Edge ID')
export const vertexIdSchema = prefixedIdSchema<VertexId>('vertex_', 'Vertex ID')
export const loopIdSchema = prefixedIdSchema<LoopId>('loop_', 'Loop ID')
export const sketchEntityIdSchema = prefixedIdSchema<SketchEntityId>('sketch_entity_', 'Sketch entity ID')
export const sketchPointIdSchema = prefixedIdSchema<SketchPointId>('sketch_point_', 'Sketch point ID')
export const sketchStyleIdSchema = prefixedIdSchema<SketchStyleId>('sketch_style_', 'Sketch style ID')
export const sketchAuthoringOperationIdSchema = prefixedIdSchema<SketchAuthoringOperationId>('sketch_operation_', 'Sketch authoring operation ID')
export const constraintIdSchema = prefixedIdSchema<ConstraintId>('constraint_', 'Constraint ID')
export const dimensionIdSchema = prefixedIdSchema<DimensionId>('dimension_', 'Dimension ID')
export const regionIdSchema = prefixedIdSchema<RegionId>('region_', 'Region ID')
export const referenceIdSchema = prefixedIdSchema<ReferenceId>('ref_', 'Reference ID')
export const projectedGeometryIdSchema = prefixedIdSchema<ProjectedGeometryId>('projected_geometry_', 'Projected geometry ID')
export const previewIdSchema = prefixedIdSchema<PreviewId>('preview_', 'Preview ID')
export const requestIdSchema = prefixedIdSchema<RequestId>('request_', 'Request ID')
export const constructionIdSchema = prefixedIdSchema<ConstructionId>('construction_', 'Construction ID')
export const featureTreeNodeIdSchema = prefixedIdSchema<FeatureTreeNodeId>('feature_tree_node_', 'Feature tree node ID')
export const objectTreeNodeIdSchema = prefixedIdSchema<ObjectTreeNodeId>('object_tree_node_', 'Object tree node ID')
export const snapshotEntityIdSchema = prefixedIdSchema<SnapshotEntityId>('snapshot_entity_', 'Snapshot entity ID')
export const renderableIdSchema = prefixedIdSchema<RenderableId>('renderable_', 'Renderable ID')
export const pickIdSchema = prefixedIdSchema<PickId>('pick_', 'Pick ID')

export const booleanSchema = z.boolean()
export const stringSchema = z.string()
export const numberSchema = z.number()
export const positiveNumberSchema = (message: string) => z.number().positive(message)

export const point2dSchema = z.tuple([z.number(), z.number()]).transform((value) => value as readonly [number, number])
export const point3dSchema = z.tuple([z.number(), z.number(), z.number()]).transform((value) => value as readonly [number, number, number])

export const unknownRecordSchema = z.record(z.string(), z.unknown())
