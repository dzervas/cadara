import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type {
  SketchDefinition,
  SketchRecord,
} from '@/contracts/sketch/schema'
import {
  SKETCH_SCHEMA_VERSION,
} from '@/contracts/sketch/schema'
import { sketchDefinitionSchema, solvedSketchSnapshotSchema } from '@/contracts/sketch/runtime-schema'
import { solveSketchDefinitionCore, validateSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import { deriveSketchRegionsCore } from '@/contracts/sketch/region-extraction'
import { validateOperationHistoryPayload } from '@/contracts/modeling/operation-history'
import { CONTRACT_VERSION, OPERATION_HISTORY_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { createNewSketchSession, getSketchSessionDisplayRenderables } from '@/domain/editor/sketch-session'
import { buildOccRenderExport } from '@/domain/modeling/occ/snapshot'
import { createOccAuthoringState } from '@/domain/modeling/occ/authoring-state'
import type { SketchSnapshotRecord } from '@/contracts/modeling/schema'

test('src/contracts/sketch/advanced-entities.spec.ts', () => {  const sketchId = 'sketch_advanced' as const
  const plane = createStandardPlaneDefinition('xy')
  const tolerances = {
    coincidence: 1e-6,
    angleRadians: 1e-6,
    minimumSegmentLength: 1e-6,
  }

  const definition: SketchDefinition = {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: [
      'sketch_point_center',
      'sketch_point_major',
      'sketch_point_arc_start',
      'sketch_point_arc_end',
      'sketch_point_conic_start',
      'sketch_point_conic_control',
      'sketch_point_conic_end',
      'sketch_point_bezier_start',
      'sketch_point_bezier_c1',
      'sketch_point_bezier_c2',
      'sketch_point_bezier_end',
      'sketch_point_text_anchor',
    ],
    points: [
      ['sketch_point_center', [0, 0], 'Center'],
      ['sketch_point_major', [3, 0], 'Major'],
      ['sketch_point_arc_start', [3, 0], 'Arc start'],
      ['sketch_point_arc_end', [0, 1], 'Arc end'],
      ['sketch_point_conic_start', [5, 0], 'Conic start'],
      ['sketch_point_conic_control', [6, 2], 'Conic control'],
      ['sketch_point_conic_end', [7, 0], 'Conic end'],
      ['sketch_point_bezier_start', [8, 0], 'Bezier start'],
      ['sketch_point_bezier_c1', [9, 2], 'Bezier c1'],
      ['sketch_point_bezier_c2', [10, -2], 'Bezier c2'],
      ['sketch_point_bezier_end', [11, 0], 'Bezier end'],
      ['sketch_point_text_anchor', [0, 4], 'Text anchor'],
    ].map(([pointId, position, label]) => ({
      pointId: pointId as SketchDefinition['pointIds'][number],
      label: label as string,
      target: { kind: 'sketchPoint' as const, sketchId, pointId: pointId as SketchDefinition['pointIds'][number] },
      position: position as readonly [number, number],
      isConstruction: false,
    })),
    entityIds: [
      'sketch_entity_ellipse',
      'sketch_entity_elliptical_arc',
      'sketch_entity_conic',
      'sketch_entity_bezier',
      'sketch_entity_text',
    ],
    entities: [
      {
        kind: 'ellipse',
        entityId: 'sketch_entity_ellipse',
        label: 'Ellipse',
        target: { kind: 'sketchEntity', sketchId, entityId: 'sketch_entity_ellipse' },
        isConstruction: false,
        centerPointId: 'sketch_point_center',
        majorAxisPointId: 'sketch_point_major',
        minorRadius: 1,
      },
      {
        kind: 'ellipticalArc',
        entityId: 'sketch_entity_elliptical_arc',
        label: 'Elliptical arc',
        target: { kind: 'sketchEntity', sketchId, entityId: 'sketch_entity_elliptical_arc' },
        isConstruction: false,
        centerPointId: 'sketch_point_center',
        majorAxisPointId: 'sketch_point_major',
        startPointId: 'sketch_point_arc_start',
        endPointId: 'sketch_point_arc_end',
        minorRadius: 1,
        sweepDirection: 'counterClockwise',
      },
      {
        kind: 'conic',
        entityId: 'sketch_entity_conic',
        label: 'Conic',
        target: { kind: 'sketchEntity', sketchId, entityId: 'sketch_entity_conic' },
        isConstruction: false,
        startPointId: 'sketch_point_conic_start',
        controlPointId: 'sketch_point_conic_control',
        endPointId: 'sketch_point_conic_end',
        rho: 0.5,
      },
      {
        kind: 'bezierCurve',
        entityId: 'sketch_entity_bezier',
        label: 'Bezier',
        target: { kind: 'sketchEntity', sketchId, entityId: 'sketch_entity_bezier' },
        isConstruction: false,
        controlPointIds: [
          'sketch_point_bezier_start',
          'sketch_point_bezier_c1',
          'sketch_point_bezier_c2',
          'sketch_point_bezier_end',
        ],
        degree: 3,
      },
      {
        kind: 'profileText',
        entityId: 'sketch_entity_text',
        label: 'Text',
        target: { kind: 'sketchEntity', sketchId, entityId: 'sketch_entity_text' },
        isConstruction: false,
        anchorPointId: 'sketch_point_text_anchor',
        text: 'CAD',
        height: 1,
        rotationRadians: 0,
        horizontalAlign: 'left',
        verticalAlign: 'baseline',
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    styleIds: [],
    styles: [],
  }

  const parsed = sketchDefinitionSchema.safeParse(definition)
  expectTrue(parsed.success, 'Runtime schema should accept advanced sketch entity payloads.')

  const invalid = sketchDefinitionSchema.safeParse({
    ...definition,
    entities: [
      {
        ...definition.entities[0]!,
        minorRadius: 0,
      },
    ],
  })
  expectTrue(!invalid.success, 'Runtime schema should reject invalid advanced entity payloads.')

  const validation = validateSketchDefinitionCore({ definition, tolerances })
  expectTrue(validation.isValid, 'Advanced entities with valid defining data should pass sketch validation.')

  const solved = solveSketchDefinitionCore({
    definition,
    tolerances,
    partialSolvePolicy: 'bestEffort',
  })
  const solvedKinds = new Set(solved.solvedSnapshot.solvedEntities.map((entity) => entity.kind))
  expectTrue(solvedKinds.has('ellipse'), 'Solved snapshot should preserve ellipse geometry.')
  expectTrue(solvedKinds.has('ellipticalArc'), 'Solved snapshot should preserve elliptical arc geometry.')
  expectTrue(solvedKinds.has('conic'), 'Solved snapshot should preserve conic geometry.')
  expectTrue(solvedKinds.has('bezierCurve'), 'Solved snapshot should preserve Bezier geometry.')
  expectTrue(solvedKinds.has('profileText'), 'Solved snapshot should preserve profile text geometry.')
  expectTrue(solvedSketchSnapshotSchema.safeParse(solved.solvedSnapshot).success, 'Solved snapshot runtime schema should validate advanced entities.')

  const unsupportedConstraintValidation = validateSketchDefinitionCore({
    definition: {
      ...definition,
      constraintIds: ['constraint_advanced_point_on_curve'],
      constraints: [{
        constraintId: 'constraint_advanced_point_on_curve',
        kind: 'pointOnCurve',
        label: 'Unsupported advanced curve constraint',
        point: { kind: 'localPoint', pointId: 'sketch_point_text_anchor' },
        curve: { kind: 'localEntity', entityId: 'sketch_entity_ellipse' },
      }],
    },
    tolerances,
  })
  expectTrue(
    unsupportedConstraintValidation.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-solver-entity-constraint'),
    'Solver validation should emit an explicit unsupported advanced-constraint diagnostic.',
  )

  const derived = deriveSketchRegionsCore({
    documentId: 'doc_workspace',
    revisionId: 'rev_0001',
    sketchId,
    definition,
    solvedSnapshot: solved.solvedSnapshot,
  })
  expectTrue(derived.regions.length >= 2, 'Ellipse and profile text should derive selectable closed regions.')
  expectTrue(
    derived.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-profile-entity'),
    'Unsupported advanced profile conversion should produce a structured diagnostic.',
  )

  const session = {
    ...createNewSketchSession(plane),
    sketchId,
    definition,
    fullDefinition: definition,
  }
  const sessionRenderables = getSketchSessionDisplayRenderables(session)
  expectTrue(
    sessionRenderables.some((renderable) =>
      renderable.target?.kind === 'sketchEntity' && renderable.target.entityId === 'sketch_entity_ellipse' && renderable.geometry.kind === 'polyline',
    ),
    'Active sketch display should render advanced entities as sketch polylines.',
  )

  const sketchRecord: SketchRecord = {
    ownerDocumentId: 'doc_workspace',
    ownerRevisionId: 'rev_0001',
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    sketchId,
    label: 'Advanced',
    planeSupport: plane.support,
    definition,
    solvedSnapshot: solved.solvedSnapshot,
    regions: [],
  }
  const sketchSnapshot: SketchSnapshotRecord = {
    ownerDocumentId: 'doc_workspace',
    ownerRevisionId: 'rev_0001',
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    sketchId,
    label: 'Advanced',
    plane,
    planeTarget: plane.support,
    planeKey: plane.key,
    sketch: sketchRecord,
  }
  const renderExport = buildOccRenderExport(createOccAuthoringState({} as never, { sketches: [sketchSnapshot] }))
  expectTrue(
    renderExport.records.some((record) =>
      record.binding.semanticClass === 'sketchCurve'
      && record.binding.target.kind === 'sketchEntity'
      && record.binding.target.entityId === 'sketch_entity_text'
      && record.geometry.kind === 'polyline',
    ),
    'Committed sketch render export should render advanced entities as sketch curves.',
  )

  const operationHistory = validateOperationHistoryPayload({
    contractVersion: CONTRACT_VERSION,
    schemaVersion: OPERATION_HISTORY_SCHEMA_VERSION,
    documentId: 'doc_workspace',
    entries: [{
      kind: 'commitSketch',
      payload: {
        sketchId,
        sketchLabel: 'Advanced',
        plane,
        planeTarget: plane.support,
        planeKey: plane.key,
        definition,
      },
    }],
  })
  expectTrue(operationHistory.ok, 'Operation history should persist advanced sketch entity definitions.')
})
