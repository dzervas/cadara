import { test } from 'bun:test'
import * as THREE from 'three'

import type { SketchDefinition } from '@/contracts/sketch/schema'
import type { SketchSnapshotRecord } from '@/contracts/modeling/schema'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import {
  beginSketchGeometryDrag,
  beginSketchTool,
  createSketchSessionFromSnapshot,
  deleteSketchReferenceTarget,
  getSketchSessionDisplayRenderables,
  selectSketchReferenceTarget,
  toggleSketchConstructionTarget,
  updateSketchReferenceProjection,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import { validateSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import {
  bindRenderableObject,
  collectBindings,
  SURFACE_COLORS,
  updateWorkspaceHighlight,
} from '@/domain/workspace/render-picking'

test('src/domain/editor/sketch-reference-geometry.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function createDefinition(): SketchDefinition {
    return {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b'],
      points: [
        {
          pointId: 'sketch_point_a',
          label: 'A',
          target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_a' },
          position: [0, 0],
          isConstruction: false,
        },
        {
          pointId: 'sketch_point_b',
          label: 'B',
          target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_b' },
          position: [1, 0],
          isConstruction: false,
        },
      ],
      entityIds: ['sketch_entity_ab'],
      entities: [
        {
          kind: 'lineSegment',
          entityId: 'sketch_entity_ab',
          label: 'AB',
          target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_ab' },
          isConstruction: false,
          startPointId: 'sketch_point_a',
          endPointId: 'sketch_point_b',
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }
  }

  function createSession(definition: SketchDefinition = createDefinition()) {
    const plane = createStandardPlaneDefinition('xy')
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: 'bestEffort',
    })

    return createSketchSessionFromSnapshot({
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_primary',
      ownerBodyId: null,
      sketchId: 'sketch_primary',
      label: 'Sketch',
      plane,
      planeTarget: plane.support,
      planeKey: 'xy',
      sketch: {
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_0001',
        ownerFeatureId: null,
        ownerSketchId: 'sketch_primary',
        ownerBodyId: null,
        sketchId: 'sketch_primary',
        label: 'Sketch',
        planeSupport: plane.support,
        definition,
        solvedSnapshot: solved.solvedSnapshot,
        regions: [],
      },
    } satisfies SketchSnapshotRecord)
  }

  function testReferenceAuthoringPersistsInCommitRequest() {
    let session = beginSketchTool(createSession(), 'projectReference')
    session = selectSketchReferenceTarget(session, {
      kind: 'edge',
      bodyId: 'body_seed',
      edgeId: 'edge_seed',
    })

    assert(session.definition.referenceIds.length === 1, 'Accepted edge references should be authored on the sketch definition.')
    assert(session.definition.references[0]?.kind === 'modelReference', 'Model topology should create a model reference record.')
    assert(
      session.commitRequest?.definition.references[0]?.referenceId === session.definition.references[0]?.referenceId,
      'Reference additions should flow into the sketch commit payload.',
    )

    const reopened = createSession(session.commitRequest!.definition)
    assert(reopened.definition.references.length === 1, 'Reopened sketch sessions should preserve authored references.')
  }

  function testFaceBackedReopenPreservesNullPlaneKeyInCommitRequest() {
    const plane = {
      ...createStandardPlaneDefinition('xy'),
      support: {
        kind: 'face' as const,
        bodyId: 'body_seed' as const,
        faceId: 'face_seed' as const,
      },
      key: null,
    }
    const solved = solveSketchDefinitionCore({
      definition: createDefinition(),
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: 'bestEffort',
    })
    const session = createSketchSessionFromSnapshot({
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_face',
      ownerBodyId: null,
      sketchId: 'sketch_face',
      label: 'Face Sketch',
      plane,
      planeTarget: plane.support,
      planeKey: null,
      sketch: {
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_0001',
        ownerFeatureId: null,
        ownerSketchId: 'sketch_face',
        ownerBodyId: null,
        sketchId: 'sketch_face',
        label: 'Face Sketch',
        planeSupport: plane.support,
        definition: createDefinition(),
        solvedSnapshot: solved.solvedSnapshot,
        regions: [],
      },
    } satisfies SketchSnapshotRecord)

    assert(session.plane.key === null, 'Face-backed reopened sketches should preserve a null authored plane key.')
    assert(session.commitRequest?.planeKey === null, 'Face-backed reopened sketch commits should not default planeKey to XY.')
  }

  function testDuplicateReferencesAreRejected() {
    let session = beginSketchTool(createSession(), 'projectReference')
    const target = {
      kind: 'edge' as const,
      bodyId: 'body_seed' as const,
      edgeId: 'edge_seed' as const,
    }

    session = selectSketchReferenceTarget(session, target)
    session = beginSketchTool(session, 'projectReference')
    session = selectSketchReferenceTarget(session, target)

    assert(session.definition.references.length === 1, 'Duplicate external references should not be appended.')
    assert(session.validationMessage?.includes('already authored'), 'Duplicate rejection should surface explicit feedback.')
  }

  function testInvalidReferenceDiagnosticsStayExplicit() {
    const definition = {
      ...createDefinition(),
      referenceIds: ['ref_missing'],
      references: [],
    } satisfies SketchDefinition
    const validation = validateSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
    })

    assert(!validation.isValid, 'Invalid reference order should fail validation.')
    assert(
      validation.diagnostics.some((diagnostic) => diagnostic.code === 'reference-missing-from-records'),
      'Invalid references should report a stable diagnostic code.',
    )
  }

  function testDuplicateReferenceRecordsAreRejected() {
    const reference = {
      referenceId: 'ref_duplicate',
      kind: 'modelReference',
      label: 'Reference edge',
      source: { kind: 'edge', bodyId: 'body_seed', edgeId: 'edge_seed' },
      projectionMode: 'projectAlongPlaneNormal',
    } satisfies SketchDefinition['references'][number]
    const validation = validateSketchDefinitionCore({
      definition: {
        ...createDefinition(),
        referenceIds: ['ref_duplicate'],
        references: [reference, reference],
      },
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
    })

    assert(!validation.isValid, 'Duplicate reference records should fail validation.')
    assert(
      validation.diagnostics.some((diagnostic) => diagnostic.code === 'duplicate-reference-record'),
      'Duplicate reference records should report a stable diagnostic code.',
    )
  }

  function testProjectionRenderablesAreReadOnlyReferenceTargets() {
    const projected: ProjectedSketchReferenceRecord = {
      referenceId: 'ref_1_edge',
      status: 'projected',
      diagnostics: [],
      geometry: [
        {
          geometryId: 'projected_geometry_ref_1_edge_0',
          kind: 'lineSegment',
          startPosition: [0, 0],
          endPosition: [2, 0],
        },
      ],
    }
    let session = updateSketchReferenceProjection(createSession(), [projected], [])
    const renderable = getSketchSessionDisplayRenderables(session).find((entry) =>
      entry.target?.kind === 'projectedReferenceGeometry'
    )

    assert(renderable, 'Projected reference geometry should produce a viewport renderable.')
    assert(renderable.role === 'reference', 'Projected reference renderables should use read-only reference styling.')

    session = beginSketchGeometryDrag(session, renderable.target!, [0, 0])
    assert(session.activeDrag === null, 'Projected reference geometry should not start direct sketch dragging.')

    const toggled = toggleSketchConstructionTarget(beginSketchTool(session, 'construction'), renderable.target!)
    assert(
      toggled.definition.references.length === session.definition.references.length,
      'Projected reference geometry should not be toggled into sketch-owned construction geometry.',
    )
  }

  function testFailedProjectionReferencesProduceDeletableMarkers() {
    let session = beginSketchTool(createSession(), 'projectReference')
    session = selectSketchReferenceTarget(session, {
      kind: 'edge',
      bodyId: 'body_seed',
      edgeId: 'edge_seed',
    })
    session = updateSketchReferenceProjection(session, [
      {
        referenceId: session.definition.referenceIds[0]!,
        status: 'unsupportedSource',
        geometry: [],
        diagnostics: [
          {
            code: 'unsupported-model-reference-source',
            severity: 'warning',
            message: 'No source geometry is available.',
            target: null,
          },
        ],
      },
    ], [])

    const marker = getSketchSessionDisplayRenderables(session).find((entry) =>
      entry.target?.kind === 'sketchExternalReference'
    )

    assert(marker, 'Failed or empty reference projections should produce a selectable reference marker.')
    assert(marker.role === 'reference', 'Reference markers should use read-only reference styling.')

    const deleted = deleteSketchReferenceTarget(session, marker.target!)
    assert(deleted.definition.references.length === 0, 'Deleting a reference marker should remove the authored reference.')
    assert(
      deleted.commitRequest?.definition.references.length === 0,
      'Reference marker deletion should flow into the sketch commit payload.',
    )
  }

  function testReferenceHighlightRefreshKeepsReferenceColor() {
    const target = {
      kind: 'sketchExternalReference',
      referenceId: 'ref_style',
    } as const
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
      ]),
      new THREE.LineBasicMaterial({ color: SURFACE_COLORS.sketchReference }),
    )
    const root = new THREE.Group()
    root.add(line)
    bindRenderableObject(line, null, target, 'sketchReference', 'document')

    const bindings = collectBindings(root)
    assert(bindings, 'Reference style test should collect the bound line.')

    updateWorkspaceHighlight(bindings.targetToObjects, [], target)
    updateWorkspaceHighlight(bindings.targetToObjects, [], null)

    const material = line.material
    assert(!Array.isArray(material), 'Reference style test line should have one material.')
    assert(
      material.color.getHex() === SURFACE_COLORS.sketchReference,
      'Reference geometry should keep its distinct inactive color after highlight refresh.',
    )

    line.geometry.dispose()
    material.dispose()
  }

  testReferenceAuthoringPersistsInCommitRequest()
  testFaceBackedReopenPreservesNullPlaneKeyInCommitRequest()
  testDuplicateReferencesAreRejected()
  testInvalidReferenceDiagnosticsStayExplicit()
  testDuplicateReferenceRecordsAreRejected()
  testProjectionRenderablesAreReadOnlyReferenceTargets()
  testFailedProjectionReferencesProduceDeletableMarkers()
  testReferenceHighlightRefreshKeepsReferenceColor()
})
