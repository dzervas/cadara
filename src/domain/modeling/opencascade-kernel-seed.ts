import type { SketchDefinition } from '@/contracts/sketch/schema'
import type {
  CommitSketchRequest,
  FeatureDefinition,
  ModelingDocumentSettings,
  ModelingKernelCapabilities,
} from '@/contracts/modeling/schema'
import type {
  ConstructionId,
  ConstraintId,
  DimensionId,
  DocumentId,
  FeatureId,
  RevisionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type { SketchPlaneDefinition, SketchPlaneKey } from '@/contracts/shared/sketch-plane'
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  FILLET_FEATURE_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'

export const OCC_KERNEL_DOCUMENT_ID = 'doc_workspace' as DocumentId
export const OCC_KERNEL_INITIAL_REVISION_ID = 'rev_0001' as RevisionId
export const OCC_KERNEL_PRIMARY_SKETCH_ID = 'sketch_primary' as SketchId

export const OCC_KERNEL_SETTINGS: ModelingDocumentSettings = {
  linearUnit: 'millimeter',
  modelingTolerance: 0.001,
  angularToleranceRadians: 0.0001,
}

export const OCC_KERNEL_CAPABILITIES: ModelingKernelCapabilities = {
  supportedFeatureKinds: ['extrude', 'fillet', 'plane', 'revolve', 'shell', 'sweep', 'loft', 'chamfer', 'thicken', 'combine', 'split', 'deleteSolid'],
  previewableFeatureKinds: ['extrude', 'fillet', 'plane', 'revolve', 'shell', 'sweep', 'loft', 'chamfer', 'thicken', 'combine', 'split', 'deleteSolid'],
  supportedProfileKinds: ['region', 'face'],
  supportsFaceBackedSketchPlanes: true,
  supportsDurableTopologyNaming: false,
}

export const OCC_KERNEL_CONSTRUCTION_IDS = {
  xy: 'construction_plane-xy' as ConstructionId,
  yz: 'construction_plane-yz' as ConstructionId,
  xz: 'construction_plane-xz' as ConstructionId,
} as const

function createPlaneFrame(key: SketchPlaneKey) {
  switch (key) {
    case 'xy':
      return {
        origin: [0, 0, 0] as const,
        xAxis: [1, 0, 0] as const,
        yAxis: [0, 1, 0] as const,
        normal: [0, 0, 1] as const,
        linearUnit: 'documentLength' as const,
        handedness: 'rightHanded' as const,
      }
    case 'yz':
      return {
        origin: [0, 0, 0] as const,
        xAxis: [0, 1, 0] as const,
        yAxis: [0, 0, 1] as const,
        normal: [1, 0, 0] as const,
        linearUnit: 'documentLength' as const,
        handedness: 'rightHanded' as const,
      }
    case 'xz':
      return {
        origin: [0, 0, 0] as const,
        xAxis: [1, 0, 0] as const,
        yAxis: [0, 0, 1] as const,
        normal: [0, -1, 0] as const,
        linearUnit: 'documentLength' as const,
        handedness: 'rightHanded' as const,
      }
  }
}

export function deriveStandardPlaneKeyFromConstructionId(
  constructionId: ConstructionId,
): SketchPlaneKey | null {
  if (constructionId === OCC_KERNEL_CONSTRUCTION_IDS.xy) {
    return 'xy'
  }

  if (constructionId === OCC_KERNEL_CONSTRUCTION_IDS.yz) {
    return 'yz'
  }

  if (constructionId === OCC_KERNEL_CONSTRUCTION_IDS.xz) {
    return 'xz'
  }

  return null
}

export function createStandardPlaneDefinition(
  planeKey: SketchPlaneKey,
): SketchPlaneDefinition {
  const constructionId = OCC_KERNEL_CONSTRUCTION_IDS[planeKey]
  return {
    support: { kind: 'construction', constructionId },
    frame: createPlaneFrame(planeKey),
    key: planeKey,
  }
}

export const OCC_KERNEL_SEED_SKETCH_DEFINITION: SketchDefinition = {
  schemaVersion: 'sketch-definition/v1alpha1',
  referenceIds: ['ref_sketch_primary_plane'],
  references: [
    {
      referenceId: 'ref_sketch_primary_plane',
      kind: 'constructionPlane',
      label: 'Sketch plane',
      source: { kind: 'construction', constructionId: OCC_KERNEL_CONSTRUCTION_IDS.xy },
      projectionMode: 'coplanar',
    },
  ],
  pointIds: [
    'sketch_point_1_rect-bottom-left' as SketchPointId,
    'sketch_point_1_rect-bottom-right' as SketchPointId,
    'sketch_point_1_rect-top-right' as SketchPointId,
    'sketch_point_1_rect-top-left' as SketchPointId,
  ],
  points: [
    {
      pointId: 'sketch_point_1_rect-bottom-left' as SketchPointId,
      label: 'Rectangle 1 bottom left',
      target: {
        kind: 'sketchPoint',
        sketchId: OCC_KERNEL_PRIMARY_SKETCH_ID,
        pointId: 'sketch_point_1_rect-bottom-left' as SketchPointId,
      },
      position: [-4, -3],
      isConstruction: false,
    },
    {
      pointId: 'sketch_point_1_rect-bottom-right' as SketchPointId,
      label: 'Rectangle 1 bottom right',
      target: {
        kind: 'sketchPoint',
        sketchId: OCC_KERNEL_PRIMARY_SKETCH_ID,
        pointId: 'sketch_point_1_rect-bottom-right' as SketchPointId,
      },
      position: [4, -3],
      isConstruction: false,
    },
    {
      pointId: 'sketch_point_1_rect-top-right' as SketchPointId,
      label: 'Rectangle 1 top right',
      target: {
        kind: 'sketchPoint',
        sketchId: OCC_KERNEL_PRIMARY_SKETCH_ID,
        pointId: 'sketch_point_1_rect-top-right' as SketchPointId,
      },
      position: [4, 3],
      isConstruction: false,
    },
    {
      pointId: 'sketch_point_1_rect-top-left' as SketchPointId,
      label: 'Rectangle 1 top left',
      target: {
        kind: 'sketchPoint',
        sketchId: OCC_KERNEL_PRIMARY_SKETCH_ID,
        pointId: 'sketch_point_1_rect-top-left' as SketchPointId,
      },
      position: [-4, 3],
      isConstruction: false,
    },
  ],
  entityIds: [
    'sketch_entity_1_rect-bottom' as SketchEntityId,
    'sketch_entity_1_rect-right' as SketchEntityId,
    'sketch_entity_1_rect-top' as SketchEntityId,
    'sketch_entity_1_rect-left' as SketchEntityId,
  ],
  entities: [
    {
      kind: 'lineSegment',
      entityId: 'sketch_entity_1_rect-bottom' as SketchEntityId,
      label: 'Rectangle 1 bottom',
      target: {
        kind: 'sketchEntity',
        sketchId: OCC_KERNEL_PRIMARY_SKETCH_ID,
        entityId: 'sketch_entity_1_rect-bottom' as SketchEntityId,
      },
      isConstruction: false,
      startPointId: 'sketch_point_1_rect-bottom-left' as SketchPointId,
      endPointId: 'sketch_point_1_rect-bottom-right' as SketchPointId,
    },
    {
      kind: 'lineSegment',
      entityId: 'sketch_entity_1_rect-right' as SketchEntityId,
      label: 'Rectangle 1 right',
      target: {
        kind: 'sketchEntity',
        sketchId: OCC_KERNEL_PRIMARY_SKETCH_ID,
        entityId: 'sketch_entity_1_rect-right' as SketchEntityId,
      },
      isConstruction: false,
      startPointId: 'sketch_point_1_rect-bottom-right' as SketchPointId,
      endPointId: 'sketch_point_1_rect-top-right' as SketchPointId,
    },
    {
      kind: 'lineSegment',
      entityId: 'sketch_entity_1_rect-top' as SketchEntityId,
      label: 'Rectangle 1 top',
      target: {
        kind: 'sketchEntity',
        sketchId: OCC_KERNEL_PRIMARY_SKETCH_ID,
        entityId: 'sketch_entity_1_rect-top' as SketchEntityId,
      },
      isConstruction: false,
      startPointId: 'sketch_point_1_rect-top-right' as SketchPointId,
      endPointId: 'sketch_point_1_rect-top-left' as SketchPointId,
    },
    {
      kind: 'lineSegment',
      entityId: 'sketch_entity_1_rect-left' as SketchEntityId,
      label: 'Rectangle 1 left',
      target: {
        kind: 'sketchEntity',
        sketchId: OCC_KERNEL_PRIMARY_SKETCH_ID,
        entityId: 'sketch_entity_1_rect-left' as SketchEntityId,
      },
      isConstruction: false,
      startPointId: 'sketch_point_1_rect-top-left' as SketchPointId,
      endPointId: 'sketch_point_1_rect-bottom-left' as SketchPointId,
    },
  ],
  constraintIds: [
    'constraint_1_bottom-horizontal' as ConstraintId,
    'constraint_1_top-horizontal' as ConstraintId,
    'constraint_1_right-vertical' as ConstraintId,
    'constraint_1_left-vertical' as ConstraintId,
  ],
  constraints: [
    {
      constraintId: 'constraint_1_bottom-horizontal' as ConstraintId,
      kind: 'horizontal',
      label: 'Rectangle 1 bottom horizontal',
      entityId: 'sketch_entity_1_rect-bottom' as SketchEntityId,
    },
    {
      constraintId: 'constraint_1_top-horizontal' as ConstraintId,
      kind: 'horizontal',
      label: 'Rectangle 1 top horizontal',
      entityId: 'sketch_entity_1_rect-top' as SketchEntityId,
    },
    {
      constraintId: 'constraint_1_right-vertical' as ConstraintId,
      kind: 'vertical',
      label: 'Rectangle 1 right vertical',
      entityId: 'sketch_entity_1_rect-right' as SketchEntityId,
    },
    {
      constraintId: 'constraint_1_left-vertical' as ConstraintId,
      kind: 'vertical',
      label: 'Rectangle 1 left vertical',
      entityId: 'sketch_entity_1_rect-left' as SketchEntityId,
    },
  ],
  dimensionIds: [
    'dimension_1_width' as DimensionId,
    'dimension_1_height' as DimensionId,
  ],
  dimensions: [
    {
      dimensionId: 'dimension_1_width' as DimensionId,
      kind: 'distance',
      label: 'Rectangle 1 width',
      axis: 'horizontal',
      pointIds: [
        'sketch_point_1_rect-bottom-left' as SketchPointId,
        'sketch_point_1_rect-bottom-right' as SketchPointId,
      ],
      value: 8,
    },
    {
      dimensionId: 'dimension_1_height' as DimensionId,
      kind: 'distance',
      label: 'Rectangle 1 height',
      axis: 'vertical',
      pointIds: [
        'sketch_point_1_rect-bottom-left' as SketchPointId,
        'sketch_point_1_rect-top-left' as SketchPointId,
      ],
      value: 6,
    },
  ],
}

export function createSeedSketchCommitRequest(): Pick<
  CommitSketchRequest,
  'sketchId' | 'sketchLabel' | 'plane' | 'definition'
> {
  const plane = createStandardPlaneDefinition('xy')

  return {
    sketchId: null,
    sketchLabel: 'Sketch 1',
    plane,
    definition: OCC_KERNEL_SEED_SKETCH_DEFINITION,
  }
}

export function createSeedFeatureDefinitions(
  regionId: `region_${string}`,
): readonly {
  featureId: FeatureId
  label: string
  definition: FeatureDefinition
}[] {
  return [
    {
      featureId: 'feature_extrude-1' as FeatureId,
      label: 'Extrude 1',
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{
            kind: 'region',
            sketchId: OCC_KERNEL_PRIMARY_SKETCH_ID,
            regionId,
          }],
          startExtent: { kind: 'profilePlane' },
          extent: {
            mode: 'oneSide',
            end: { kind: 'blind', direction: 'positive', distance: 12 },
          },
          operation: 'newBody',
          booleanScope: { kind: 'standalone' },
        },
      },
    },
    {
      featureId: 'feature_fillet-1' as FeatureId,
      label: 'Fillet 1',
      definition: {
        kind: 'fillet',
        featureTypeVersion: FILLET_FEATURE_SCHEMA_VERSION,
        parameters: {
          radius: 1.5,
          edgeTargets: [],
        },
      },
    },
  ]
}
