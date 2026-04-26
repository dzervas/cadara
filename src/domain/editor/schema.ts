import type { ToolId } from '@/domain/tools/tool-registry'
import type { ToolbarMode } from '@/domain/tools/schema'
import type { DurableRef } from '@/contracts/shared/references'
import type { ProjectedGeometryId, ReferenceId } from '@/contracts/shared/ids'

export type {
  BodyId,
  CommandSessionId,
  ConstructionId,
  ConstraintId,
  DimensionId,
  DocumentHistoryItemId,
  DocumentId,
  DocumentVariableId,
  EdgeId,
  FaceId,
  FeatureId,
  FeatureInstanceId,
  FeatureTreeNodeId,
  LoopId,
  ObjectTreeNodeId,
  PickId,
  PreviewId,
  ReferenceId,
  RenderableId,
  RegionId,
  RequestId,
  RevisionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
  SnapshotEntityId,
  VertexId,
} from '@/contracts/shared/ids'

export interface ProjectedReferenceGeometryRef {
  kind: 'projectedReferenceGeometry'
  referenceId: ReferenceId
  geometryId: ProjectedGeometryId
  geometryKind: 'point' | 'lineSegment' | 'circle' | 'arc' | 'spline'
}

export interface SketchExternalReferenceRef {
  kind: 'sketchExternalReference'
  referenceId: ReferenceId
}

export type PrimitiveRef = DurableRef | ProjectedReferenceGeometryRef | SketchExternalReferenceRef

export type SelectionTarget = PrimitiveRef

export type SelectionSemantic =
  | 'body'
  | 'face'
  | 'edge'
  | 'vertex'
  | 'constructionPlane'
  | 'existingSketch'
  | 'regionProfile'
  | 'sketchEntity'
  | 'sketchPoint'
  | 'constraintAnnotation'
  | 'dimensionAnnotation'
  | 'projectedReferenceGeometry'
  | 'sketchExternalReference'
  | 'planarFace'
  | 'planarReference'

export interface CommandTargetSlot {
  id: string
  label: string
  description: string
  acceptedKinds: readonly PrimitiveRef['kind'][]
  acceptedSemantics: readonly SelectionSemantic[]
}

export interface CommandTargetRequirement {
  id: string
  label: string
  description: string
  slots: readonly CommandTargetSlot[]
}

export type SelectionFilterKind =
  | 'all'
  | 'measureTargets'
  | 'sketchSession'
  | 'sketchStart'
  | 'sectionViewSeed'
  | 'extrudeProfile'
  | 'revolveReferences'
  | 'sweepReferences'
  | 'loftReferences'
  | 'combineReferences'
  | 'splitReferences'
  | 'deleteSolidReferences'
  | 'mirrorReferences'
  | 'transformReferences'
  | 'thickenReferences'
  | 'filletEdges'
  | 'chamferEdges'
  | 'shellReferences'
  | 'planeReferences'

export interface SelectionFilter {
  kind: SelectionFilterKind
  allowedKinds: readonly PrimitiveRef['kind'][]
  label: string
  requirements: readonly CommandTargetRequirement[]
}

export interface SelectionTargetCatalog {
  selectableTargetKeys: readonly string[]
  existingSketchKeys: readonly string[]
  constructionPlaneKeys: readonly string[]
  planarFaceKeys: readonly string[]
}

export interface CommandPreview {
  kind: 'selection' | 'sketch'
  label: string
  target: PrimitiveRef | null
}

export const defaultSelectionFilter: SelectionFilter = {
  kind: 'all',
  allowedKinds: ['body', 'face', 'edge', 'vertex', 'loop', 'sketch', 'sketchEntity', 'sketchPoint', 'constraint', 'dimension', 'feature', 'construction', 'region'],
  label: 'All selectable geometry',
  requirements: [
    {
      id: 'all-geometry',
      label: 'General selection',
      description: 'Bodies, topology, sketches, features, and construction references are selectable.',
      slots: [
        {
          id: 'general-selection',
          label: 'General selection',
          description: 'Select any single durable target.',
          acceptedKinds: ['body', 'face', 'edge', 'vertex', 'loop', 'sketch', 'sketchEntity', 'sketchPoint', 'constraint', 'dimension', 'feature', 'construction', 'region'],
          acceptedSemantics: [
            'body',
            'face',
            'edge',
            'vertex',
            'constructionPlane',
            'existingSketch',
            'sketchEntity',
            'sketchPoint',
            'constraintAnnotation',
            'dimensionAnnotation',
            'regionProfile',
          ],
        },
      ],
    },
  ],
}

export const sketchSelectionFilter: SelectionFilter = {
  kind: 'sketchSession',
  allowedKinds: ['construction', 'sketch', 'sketchEntity', 'sketchPoint', 'constraint', 'dimension', 'projectedReferenceGeometry', 'sketchExternalReference', 'region'],
  label: 'Sketch references',
  requirements: [
    {
      id: 'sketch-references',
      label: 'Sketch references',
      description: 'Select sketch geometry or the owning sketch plane while editing a sketch.',
      slots: [
        {
          id: 'sketch-reference',
          label: 'Sketch reference',
          description: 'Select the sketch plane, sketch, or sketch primitive.',
          acceptedKinds: ['construction', 'sketch', 'sketchEntity', 'sketchPoint', 'constraint', 'dimension', 'projectedReferenceGeometry', 'sketchExternalReference', 'region'],
          acceptedSemantics: ['constructionPlane', 'existingSketch', 'sketchEntity', 'sketchPoint', 'constraintAnnotation', 'dimensionAnnotation', 'projectedReferenceGeometry', 'sketchExternalReference', 'regionProfile'],
        },
      ],
    },
  ],
}

export const sketchReferenceSelectionFilter: SelectionFilter = {
  kind: 'sketchSession',
  allowedKinds: ['face', 'edge', 'vertex', 'sketch', 'sketchEntity', 'sketchPoint'],
  label: 'Reference geometry',
  requirements: [
    {
      id: 'sketch-external-reference',
      label: 'Reference geometry',
      description: 'Select model topology or existing sketch geometry to reference in the active sketch.',
      slots: [
        {
          id: 'sketch-external-reference-target',
          label: 'Reference target',
          description: 'Select one model face, edge, vertex, existing sketch, sketch entity, or sketch point.',
          acceptedKinds: ['face', 'edge', 'vertex', 'sketch', 'sketchEntity', 'sketchPoint'],
          acceptedSemantics: ['face', 'edge', 'vertex', 'existingSketch', 'sketchEntity', 'sketchPoint'],
        },
      ],
    },
  ],
}

export const measureSelectionFilter: SelectionFilter = {
  kind: 'measureTargets',
  allowedKinds: ['body', 'face', 'edge', 'vertex', 'sketchEntity', 'sketchPoint', 'projectedReferenceGeometry', 'region'],
  label: 'Measurement targets',
  requirements: [
    {
      id: 'measure-target',
      label: 'Measurement target',
      description: 'Select one measurable body, topology target, sketch primitive, projected curve, or region.',
      slots: [
        {
          id: 'measure-target-primary',
          label: 'Measurement target',
          description: 'Select one measurable target to inspect or pair.',
          acceptedKinds: ['body', 'face', 'edge', 'vertex', 'sketchEntity', 'sketchPoint', 'projectedReferenceGeometry', 'region'],
          acceptedSemantics: ['body', 'face', 'edge', 'vertex', 'sketchEntity', 'sketchPoint', 'projectedReferenceGeometry', 'regionProfile'],
        },
      ],
    },
  ],
}

export const sketchStartSelectionFilter: SelectionFilter = {
  kind: 'sketchStart',
  allowedKinds: ['construction', 'face', 'sketch'],
  label: 'Sketch planes, planar faces, or sketches',
  requirements: [
    {
      id: 'sketch-plane',
      label: 'Sketch plane',
      description: 'Start a sketch from a construction plane or planar face, or reopen an existing sketch.',
      slots: [
        {
          id: 'sketch-start-target',
          label: 'Sketch start target',
          description: 'Select one construction plane, one planar face, or one existing sketch.',
          acceptedKinds: ['construction', 'face', 'sketch'],
          acceptedSemantics: ['constructionPlane', 'planarFace', 'planarReference', 'existingSketch'],
        },
      ],
    },
  ],
}

export const sectionViewSelectionFilter: SelectionFilter = {
  kind: 'sectionViewSeed',
  allowedKinds: ['construction', 'face', 'region'],
  label: 'Section view seeds',
  requirements: [
    {
      id: 'section-view-seed',
      label: 'Section seed',
      description: 'Section view accepts one planar face, closed region, or construction plane.',
      slots: [
        {
          id: 'section-view-seed',
          label: 'Section seed',
          description: 'Select one planar face, closed region, or construction plane.',
          acceptedKinds: ['construction', 'face', 'region'],
          acceptedSemantics: ['constructionPlane', 'planarFace', 'regionProfile'],
        },
      ],
    },
  ],
}

export const extrudeSelectionFilter: SelectionFilter = {
  kind: 'extrudeProfile',
  allowedKinds: ['region', 'face', 'body'],
  label: 'Extrude profiles, planar faces, or boolean bodies',
  requirements: [
    {
      id: 'extrude-profile',
      label: 'Extrude seed',
      description: 'Extrude accepts one or more explicit derived sketch regions or planar faces.',
      slots: [
        {
          id: 'extrude-seed',
          label: 'Extrude seed',
          description: 'Select one or more derived sketch regions or planar faces.',
          acceptedKinds: ['region', 'face'],
          acceptedSemantics: ['regionProfile', 'planarFace'],
        },
      ],
    },
    {
      id: 'extrude-boolean-target',
      label: 'Boolean target',
      description: 'Join, cut, and intersect require one explicit target body.',
      slots: [
        {
          id: 'extrude-profile-for-boolean',
          label: 'Extrude seed',
          description: 'Select one or more derived sketch regions or planar faces.',
          acceptedKinds: ['region', 'face'],
          acceptedSemantics: ['regionProfile', 'planarFace'],
        },
        {
          id: 'extrude-boolean-target',
          label: 'Boolean target',
          description: 'Select one body target.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
    {
      id: 'extrude-target-body',
      label: 'Boolean target body',
      description: 'The active extrude boolean target selector accepts durable body targets only.',
      slots: [
        {
          id: 'extrude-target-body',
          label: 'Boolean target body',
          description: 'Select one target body for the extrude boolean operation.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
  ],
}

export const filletSelectionFilter: SelectionFilter = {
  kind: 'filletEdges',
  allowedKinds: ['edge'],
  label: 'Fillet edges',
  requirements: [
    {
      id: 'fillet-edge',
      label: 'Edge target',
      description: 'Fillet currently accepts edge references only.',
      slots: [
        {
          id: 'fillet-edge',
          label: 'Edge target',
          description: 'Select one edge reference.',
          acceptedKinds: ['edge'],
          acceptedSemantics: ['edge'],
        },
      ],
    },
  ],
}

export const chamferSelectionFilter: SelectionFilter = {
  kind: 'chamferEdges',
  allowedKinds: ['edge'],
  label: 'Chamfer edges',
  requirements: [
    {
      id: 'chamfer-edge',
      label: 'Edge target',
      description: 'Chamfer accepts one or more durable edge references.',
      slots: [
        {
          id: 'chamfer-edge',
          label: 'Edge target',
          description: 'Select one edge reference.',
          acceptedKinds: ['edge'],
          acceptedSemantics: ['edge'],
        },
      ],
    },
  ],
}

export const revolveSelectionFilter: SelectionFilter = {
  kind: 'revolveReferences',
  allowedKinds: ['region', 'face', 'edge', 'construction', 'body'],
  label: 'Revolve references',
  requirements: [
    {
      id: 'revolve-profile',
      label: 'Profile target',
      description: 'Revolve accepts one or more explicit region or planar face profiles.',
      slots: [
        {
          id: 'revolve-profile',
          label: 'Revolve profile',
          description: 'Select one or more derived sketch regions or planar faces.',
          acceptedKinds: ['region', 'face'],
          acceptedSemantics: ['regionProfile', 'planarFace'],
        },
      ],
    },
    {
      id: 'revolve-axis',
      label: 'Axis target',
      description: 'Revolve accepts one explicit durable edge or construction axis.',
      slots: [
        {
          id: 'revolve-axis',
          label: 'Revolve axis',
          description: 'Select one linear edge or construction axis.',
          acceptedKinds: ['edge', 'construction'],
          acceptedSemantics: ['edge', 'constructionPlane'],
        },
      ],
    },
    {
      id: 'revolve-boolean-target',
      label: 'Boolean target',
      description: 'Join, cut, and intersect require one explicit target body.',
      slots: [
        {
          id: 'revolve-boolean-target',
          label: 'Boolean target',
          description: 'Select one body target.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
  ],
}

export const sweepSelectionFilter: SelectionFilter = {
  kind: 'sweepReferences',
  allowedKinds: ['region', 'face', 'edge', 'sketchEntity', 'construction', 'body'],
  label: 'Sweep references',
  requirements: [
    {
      id: 'sweep-profile',
      label: 'Profile target',
      description: 'Sweep accepts one or more explicit region or planar face profiles.',
      slots: [
        {
          id: 'sweep-profile',
          label: 'Sweep profile',
          description: 'Select one or more derived sketch regions or planar faces.',
          acceptedKinds: ['region', 'face'],
          acceptedSemantics: ['regionProfile', 'planarFace'],
        },
      ],
    },
    {
      id: 'sweep-path',
      label: 'Path target',
      description: 'Sweep accepts one durable edge or sketch entity as its initial path.',
      slots: [
        {
          id: 'sweep-path',
          label: 'Sweep path',
          description: 'Select one durable edge or sketch entity path.',
          acceptedKinds: ['edge', 'sketchEntity'],
          acceptedSemantics: ['edge', 'sketchEntity'],
        },
      ],
    },
    {
      id: 'sweep-guide-curve',
      label: 'Guide curve',
      description: 'Guide curves are contract-visible but not yet supported by the OCC sweep builder.',
      slots: [
        {
          id: 'sweep-guide-curve',
          label: 'Guide curve',
          description: 'Select a durable edge or sketch entity guide curve.',
          acceptedKinds: ['edge', 'sketchEntity'],
          acceptedSemantics: ['edge', 'sketchEntity'],
        },
      ],
    },
    {
      id: 'sweep-lock-profile-face',
      label: 'Lock profile face',
      description: 'Lock profile faces accepts one or more durable body faces.',
      slots: [
        {
          id: 'sweep-lock-profile-face',
          label: 'Lock profile face',
          description: 'Select one or more durable body faces.',
          acceptedKinds: ['face'],
          acceptedSemantics: ['planarFace'],
        },
      ],
    },
    {
      id: 'sweep-lock-profile-direction',
      label: 'Lock profile direction',
      description: 'Lock profile direction accepts one durable edge or construction target.',
      slots: [
        {
          id: 'sweep-lock-profile-direction',
          label: 'Lock profile direction',
          description: 'Select one durable edge or construction target.',
          acceptedKinds: ['edge', 'construction'],
          acceptedSemantics: ['edge', 'constructionPlane'],
        },
      ],
    },
    {
      id: 'sweep-boolean-target',
      label: 'Boolean target',
      description: 'Add, subtract, and intersect require one explicit target body.',
      slots: [
        {
          id: 'sweep-boolean-target',
          label: 'Boolean target',
          description: 'Select one body target.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
  ],
}

export const loftSelectionFilter: SelectionFilter = {
  kind: 'loftReferences',
  allowedKinds: ['region', 'face', 'edge', 'sketchEntity', 'body'],
  label: 'Loft references',
  requirements: [
    {
      id: 'loft-profile',
      label: 'Profile target',
      description: 'Loft accepts two or more explicit region or planar face profiles in user-defined order.',
      slots: [
        {
          id: 'loft-profile',
          label: 'Loft profile',
          description: 'Select one or more derived sketch regions or planar faces.',
          acceptedKinds: ['region', 'face'],
          acceptedSemantics: ['regionProfile', 'planarFace'],
        },
      ],
    },
    {
      id: 'loft-path',
      label: 'Path',
      description: 'Loft accepts one optional path control separately from guide curves.',
      slots: [
        {
          id: 'loft-path',
          label: 'Loft path',
          description: 'Select one durable edge or sketch entity path.',
          acceptedKinds: ['edge', 'sketchEntity'],
          acceptedSemantics: ['edge', 'sketchEntity'],
        },
      ],
    },
    {
      id: 'loft-guide-curve',
      label: 'Guide curve',
      description: 'Loft accepts optional guide curves separately from path controls.',
      slots: [
        {
          id: 'loft-guide-curve',
          label: 'Guide curve',
          description: 'Select a durable edge or sketch entity guide curve.',
          acceptedKinds: ['edge', 'sketchEntity'],
          acceptedSemantics: ['edge', 'sketchEntity'],
        },
      ],
    },
    {
      id: 'loft-boolean-target',
      label: 'Boolean target',
      description: 'Add, subtract, and intersect require one explicit target body.',
      slots: [
        {
          id: 'loft-boolean-target',
          label: 'Boolean target',
          description: 'Select one body target.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
  ],
}

export const splitSelectionFilter: SelectionFilter = {
  kind: 'splitReferences',
  allowedKinds: ['body'],
  label: 'Split references',
  requirements: [
    {
      id: 'split-target-body',
      label: 'Target body',
      description: 'Split requires one explicit durable body to split.',
      slots: [
        {
          id: 'split-target-body',
          label: 'Target body',
          description: 'Select one body to split.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
    {
      id: 'split-tool-body',
      label: 'Split tool body',
      description: 'The initial split implementation accepts one explicit durable tool body.',
      slots: [
        {
          id: 'split-tool-body',
          label: 'Split tool body',
          description: 'Select one body to use as the split tool.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
  ],
}

export const combineSelectionFilter: SelectionFilter = {
  kind: 'combineReferences',
  allowedKinds: ['body'],
  label: 'Combine references',
  requirements: [
    {
      id: 'combine-target-body',
      label: 'Target bodies',
      description: 'Combine requires one or more explicit target bodies.',
      slots: [
        {
          id: 'combine-target-body',
          label: 'Target body',
          description: 'Select one or more bodies to receive the boolean result.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
    {
      id: 'combine-tool-body',
      label: 'Tool bodies',
      description: 'Combine requires one or more explicit tool bodies.',
      slots: [
        {
          id: 'combine-tool-body',
          label: 'Tool body',
          description: 'Select one or more bodies used as boolean tools.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
  ],
}

export const deleteSolidSelectionFilter: SelectionFilter = {
  kind: 'deleteSolidReferences',
  allowedKinds: ['body'],
  label: 'Delete-solid references',
  requirements: [
    {
      id: 'delete-solid-body',
      label: 'Body target',
      description: 'Delete-solid accepts one or more explicit durable body targets.',
      slots: [
        {
          id: 'delete-solid-body',
          label: 'Body target',
          description: 'Select one body to remove.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
  ],
}

export const mirrorSelectionFilter: SelectionFilter = {
  kind: 'mirrorReferences',
  allowedKinds: ['body', 'construction', 'face'],
  label: 'Mirror references',
  requirements: [
    {
      id: 'mirror-body',
      label: 'Body target',
      description: 'Mirror accepts one or more explicit durable body targets in the first slice.',
      slots: [
        {
          id: 'mirror-body',
          label: 'Body target',
          description: 'Select one body to mirror.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
    {
      id: 'mirror-plane',
      label: 'Mirror plane',
      description: 'Mirror requires one explicit planar face or construction plane reference.',
      slots: [
        {
          id: 'mirror-plane',
          label: 'Mirror plane',
          description: 'Select one planar face or construction plane.',
          acceptedKinds: ['construction', 'face'],
          acceptedSemantics: ['planarReference'],
        },
      ],
    },
  ],
}

export const transformSelectionFilter: SelectionFilter = {
  kind: 'transformReferences',
  allowedKinds: ['body', 'construction', 'face'],
  label: 'Transform references',
  requirements: [
    {
      id: 'transform-body',
      label: 'Body target',
      description: 'Transform accepts one or more explicit durable body targets in the first slice.',
      slots: [
        {
          id: 'transform-body',
          label: 'Body target',
          description: 'Select one body to transform.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
    {
      id: 'transform-reference',
      label: 'Transform reference',
      description: 'The first transform slice translates bodies along the normal of one explicit planar reference.',
      slots: [
        {
          id: 'transform-reference',
          label: 'Transform reference',
          description: 'Select one planar face or construction plane.',
          acceptedKinds: ['construction', 'face'],
          acceptedSemantics: ['planarReference'],
        },
      ],
    },
  ],
}

export const planeSelectionFilter: SelectionFilter = {
  kind: 'planeReferences',
  allowedKinds: ['construction', 'face'],
  label: 'Plane references',
  requirements: [
    {
      id: 'plane-planar-reference',
      label: 'Single planar reference',
      description: 'Plane creation accepts one planar face or one construction plane in the current contract.',
      slots: [
        {
          id: 'plane-reference-primary',
          label: 'Primary planar reference',
          description: 'Select a construction plane or planar face.',
          acceptedKinds: ['construction', 'face'],
          acceptedSemantics: ['planarReference'],
        },
      ],
    },
  ],
}

export const shellSelectionFilter: SelectionFilter = {
  kind: 'shellReferences',
  allowedKinds: ['body', 'face'],
  label: 'Shell references',
  requirements: [
    {
      id: 'shell-body',
      label: 'Source body',
      description: 'Shell requires one explicit body target.',
      slots: [
        {
          id: 'shell-body',
          label: 'Body target',
          description: 'Select one body to shell.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
    {
      id: 'shell-face',
      label: 'Removable face',
      description: 'Shell accepts one explicit removable face per selection interaction.',
      slots: [
        {
          id: 'shell-face',
          label: 'Removable face',
          description: 'Select one face to remove.',
          acceptedKinds: ['face'],
          acceptedSemantics: ['face'],
        },
      ],
    },
    {
      id: 'shell-boolean-target',
      label: 'Boolean target body',
      description: 'The active shell boolean target selector accepts durable body targets only.',
      slots: [
        {
          id: 'shell-boolean-target',
          label: 'Boolean target body',
          description: 'Select one target body for the shell boolean operation.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
  ],
}

export const thickenSelectionFilter: SelectionFilter = {
  kind: 'thickenReferences',
  allowedKinds: ['face', 'body'],
  label: 'Thicken references',
  requirements: [
    {
      id: 'thicken-face',
      label: 'Face target',
      description: 'Thicken accepts one or more explicit durable face targets.',
      slots: [
        {
          id: 'thicken-face',
          label: 'Face target',
          description: 'Select one face to offset into a solid.',
          acceptedKinds: ['face'],
          acceptedSemantics: ['face', 'planarFace'],
        },
      ],
    },
    {
      id: 'thicken-boolean-target',
      label: 'Boolean target',
      description: 'Add, subtract, and intersect require one explicit target body.',
      slots: [
        {
          id: 'thicken-boolean-target',
          label: 'Boolean target',
          description: 'Select one body target.',
          acceptedKinds: ['body'],
          acceptedSemantics: ['body'],
        },
      ],
    },
  ],
}

export function getPrimitiveRefLabel(target: PrimitiveRef) {
  switch (target.kind) {
    case 'body':
      return target.bodyId
    case 'face':
      return `${target.bodyId}.${target.faceId}`
    case 'edge':
      return `${target.bodyId}.${target.edgeId}`
    case 'vertex':
      return `${target.bodyId}.${target.vertexId}`
    case 'loop':
      return `${target.bodyId}.${target.loopId}`
    case 'sketch':
      return target.sketchId
    case 'sketchEntity':
      return `${target.sketchId}.${target.entityId}`
    case 'sketchPoint':
      return `${target.sketchId}.${target.pointId}`
    case 'constraint':
      return `${target.sketchId}.${target.constraintId}`
    case 'dimension':
      return `${target.sketchId}.${target.dimensionId}`
    case 'feature':
      return target.featureId
    case 'construction':
      return target.constructionId
    case 'region':
      return `${target.sketchId}.${target.regionId}`
    case 'projectedReferenceGeometry':
      return `${target.referenceId}.${target.geometryId}`
    case 'sketchExternalReference':
      return target.referenceId
  }
}

export function getPrimitiveRefKey(target: PrimitiveRef) {
  switch (target.kind) {
    case 'body':
      return `body:${target.bodyId}`
    case 'face':
      return `face:${target.bodyId}:${target.faceId}`
    case 'edge':
      return `edge:${target.bodyId}:${target.edgeId}`
    case 'vertex':
      return `vertex:${target.bodyId}:${target.vertexId}`
    case 'loop':
      return `loop:${target.bodyId}:${target.loopId}`
    case 'sketch':
      return `sketch:${target.sketchId}`
    case 'sketchEntity':
      return `sketchEntity:${target.sketchId}:${target.entityId}`
    case 'sketchPoint':
      return `sketchPoint:${target.sketchId}:${target.pointId}`
    case 'constraint':
      return `constraint:${target.sketchId}:${target.constraintId}`
    case 'dimension':
      return `dimension:${target.sketchId}:${target.dimensionId}`
    case 'feature':
      return `feature:${target.featureId}`
    case 'construction':
      return `construction:${target.constructionId}`
    case 'region':
      return `region:${target.sketchId}:${target.regionId}`
    case 'projectedReferenceGeometry':
      return `projectedReferenceGeometry:${target.referenceId}:${target.geometryId}`
    case 'sketchExternalReference':
      return `sketchExternalReference:${target.referenceId}`
  }
}

export function primitiveRefEquals(left: PrimitiveRef, right: PrimitiveRef) {
  return getPrimitiveRefKey(left) === getPrimitiveRefKey(right)
}

export function isDurablePrimitiveRef(target: PrimitiveRef): target is DurableRef {
  return target.kind !== 'projectedReferenceGeometry' && target.kind !== 'sketchExternalReference'
}

export function getDefaultSelectionFilterForMode(mode: ToolbarMode): SelectionFilter {
  return mode === 'sketch' ? sketchSelectionFilter : defaultSelectionFilter
}

export function createSelectionFilterForRequirement(
  filter: SelectionFilter,
  requirementId: string,
  label = filter.label,
): SelectionFilter {
  const requirement = filter.requirements.find((entry) => entry.id === requirementId)

  if (!requirement) {
    return filter
  }

  const allowedKinds = Array.from(
    new Set(requirement.slots.flatMap((slot) => slot.acceptedKinds)),
  )

  return {
    ...filter,
    allowedKinds,
    label,
    requirements: [requirement],
  }
}

export function getSelectionFilterForCommand(
  toolId: ToolId,
  mode: ToolbarMode,
): SelectionFilter {
  switch (toolId) {
    case 'measure':
      return measureSelectionFilter
    case 'sketch':
      return sketchStartSelectionFilter
    case 'sectionView':
      return sectionViewSelectionFilter
    case 'projectReference':
      return sketchReferenceSelectionFilter
    default:
      return getDefaultSelectionFilterForMode(mode)
  }
}

export function selectionFilterAllowsTarget(
  filter: SelectionFilter | null,
  selection: PrimitiveRef[],
  target: PrimitiveRef,
  catalog: SelectionTargetCatalog | null,
) {
  return resolveSelectionCandidate(filter, selection, target, catalog).accepted
}

function getTargetSemantics(
  target: PrimitiveRef,
  catalog: SelectionTargetCatalog | null,
): SelectionSemantic[] {
  const semantics: SelectionSemantic[] = []
  const targetKey = getPrimitiveRefKey(target)

  const allowSessionOwnedTarget =
    target.kind === 'sketchEntity'
    || target.kind === 'sketchPoint'
    || target.kind === 'constraint'
    || target.kind === 'dimension'
    || target.kind === 'projectedReferenceGeometry'
    || target.kind === 'sketchExternalReference'

  if (
    catalog?.selectableTargetKeys
    && !catalog.selectableTargetKeys.includes(targetKey)
    && !allowSessionOwnedTarget
  ) {
    return semantics
  }

  switch (target.kind) {
    case 'body':
      semantics.push('body')
      break
    case 'face':
      semantics.push('face')
      if (catalog && catalog.planarFaceKeys.includes(targetKey)) {
        semantics.push('planarFace', 'planarReference')
      }
      break
    case 'edge':
      semantics.push('edge')
      break
    case 'vertex':
      semantics.push('vertex')
      break
    case 'construction':
      if (catalog && catalog.constructionPlaneKeys.includes(targetKey)) {
        semantics.push('constructionPlane', 'planarReference')
      }
      break
    case 'sketch':
      if (catalog && catalog.existingSketchKeys.includes(targetKey)) {
        semantics.push('existingSketch')
      }
      break
    case 'region':
      semantics.push('regionProfile')
      break
    case 'projectedReferenceGeometry':
      semantics.push('projectedReferenceGeometry')
      break
    case 'sketchExternalReference':
      semantics.push('sketchExternalReference')
      break
    case 'sketchEntity':
      semantics.push('sketchEntity')
      break
    case 'sketchPoint':
      semantics.push('sketchPoint')
      break
    case 'constraint':
      semantics.push('constraintAnnotation')
      break
    case 'dimension':
      semantics.push('dimensionAnnotation')
      break
    default:
      break
  }

  return semantics
}

function slotAcceptsTarget(
  slot: CommandTargetSlot,
  target: PrimitiveRef,
  catalog: SelectionTargetCatalog | null,
) {
  if (!slot.acceptedKinds.includes(target.kind)) {
    return false
  }

  const semantics = getTargetSemantics(target, catalog)
  return slot.acceptedSemantics.some((semantic) => semantics.includes(semantic))
}

function matchesRequirementPrefix(
  requirement: CommandTargetRequirement,
  selection: PrimitiveRef[],
  catalog: SelectionTargetCatalog | null,
) {
  if (selection.length > requirement.slots.length) {
    return false
  }

  return selection.every((target, index) => {
    const slot = requirement.slots[index]
    return slot ? slotAcceptsTarget(slot, target, catalog) : false
  })
}

function requirementAllowsDistinctAppend(
  requirement: CommandTargetRequirement,
  selection: PrimitiveRef[],
  target: PrimitiveRef,
) {
  if (selection.length === 0 || requirement.slots.length <= 1) {
    return true
  }

  return !selection.some((entry) => primitiveRefEquals(entry, target))
}

export function resolveSelectionCandidate(
  filter: SelectionFilter | null,
  selection: PrimitiveRef[],
  target: PrimitiveRef,
  catalog: SelectionTargetCatalog | null,
) {
  if (filter === null) {
    return {
      accepted: true,
      nextSelection: [target],
      requirement: null,
    }
  }

  if (!filter.allowedKinds.includes(target.kind)) {
    return {
      accepted: false,
      nextSelection: selection,
      requirement: null,
    }
  }

  const extendMatch = filter.requirements.find((requirement) => {
    if (!matchesRequirementPrefix(requirement, selection, catalog)) {
      return false
    }

    const slot = requirement.slots[selection.length]
    return (
      slot !== undefined &&
      requirementAllowsDistinctAppend(requirement, selection, target) &&
      slotAcceptsTarget(slot, target, catalog)
    )
  })

  if (extendMatch) {
    return {
      accepted: true,
      nextSelection: [...selection, target],
      requirement: extendMatch,
    }
  }

  const blockedByActiveRequirement = filter.requirements.some((requirement) => {
    if (!matchesRequirementPrefix(requirement, selection, catalog)) {
      return false
    }

    const slot = requirement.slots[selection.length]

    if (!slot) {
      return false
    }

    if (!slotAcceptsTarget(slot, target, catalog)) {
      return false
    }

    return !requirementAllowsDistinctAppend(requirement, selection, target)
  })

  if (blockedByActiveRequirement) {
    return {
      accepted: false,
      nextSelection: selection,
      requirement: null,
    }
  }

  const replaceMatch = filter.requirements.find((requirement) => {
    const slot = requirement.slots[0]
    return slot ? slotAcceptsTarget(slot, target, catalog) : false
  })

  if (replaceMatch) {
    return {
      accepted: true,
      nextSelection: [target],
      requirement: replaceMatch,
    }
  }

  return {
    accepted: false,
    nextSelection: selection,
    requirement: null,
  }
}

export function getSelectionFilterRejectionLabel(
  filter: SelectionFilter | null,
  target: PrimitiveRef,
) {
  if (filter === null) {
    return `${getPrimitiveRefLabel(target)} is not selectable.`
  }

  const requirementLabels = filter.requirements.map((requirement) => requirement.label.toLowerCase())
  const expectedLabel =
    requirementLabels.length > 0 ? requirementLabels.join(' or ') : filter.label.toLowerCase()

  return `${target.kind} is filtered out. Expected ${expectedLabel}.`
}

export function getSelectionPreviewLabel(
  filter: SelectionFilter | null,
  target: PrimitiveRef,
  interaction: 'hover' | 'select',
) {
  const verb = interaction === 'hover' ? 'Hovering' : 'Selected'

  if (!filter || filter.kind === 'all') {
    return `${verb} ${getPrimitiveRefLabel(target)}`
  }

  const noun =
    filter.kind === 'extrudeProfile'
      ? 'extrude profile'
      : filter.kind === 'revolveReferences'
      ? 'revolve reference'
      : filter.kind === 'sweepReferences'
        ? 'sweep reference'
        : filter.kind === 'combineReferences'
          ? 'combine reference'
        : filter.kind === 'thickenReferences'
          ? 'thicken reference'
        : filter.kind === 'filletEdges'
        ? 'fillet edge'
        : filter.kind === 'shellReferences'
          ? 'shell reference'
        : filter.kind === 'planeReferences'
          ? 'plane reference'
          : filter.kind === 'measureTargets'
            ? 'measurement target'
          : filter.kind === 'sketchStart'
            ? 'sketch reference'
            : 'selection'

  return `${verb} ${noun} ${getPrimitiveRefLabel(target)}`
}
