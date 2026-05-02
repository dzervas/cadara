import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import type {
  CreateFeatureResponse,
  CreateFeatureRequest,
  EvaluatePreviewResponse,
  EvaluatePreviewRequest,
  ResolveReferenceResponse,
  ResolveReferenceRequest,
  UpdateFeatureRequest,
  UpdateFeatureResponse,
} from '@/contracts/modeling/schema'
import type { RenderExport } from '@/contracts/render/schema'
import type {
  ProjectSketchExternalReferencesRequest,
  SolveSketchResponse,
  SolveSketchRequest,
} from '@/contracts/solver/schema'
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  SKETCH_SCHEMA_VERSION,
  type SketchDefinition,
} from '@/contracts/sketch/schema'
import {
  CONTRACT_VERSION,
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import { SOLVER_SCHEMA_VERSION } from '@/contracts/solver/schema'
import {
  chamferAdvancedFeatureExample,
  deleteSolidAdvancedFeatureExample,
  loftAdvancedFeatureExample,
  mirrorAdvancedFeatureExample,
  splitAdvancedFeatureExample,
  sweepAdvancedFeatureExample,
  thickenAdvancedFeatureExample,
  transformAdvancedFeatureExample,
} from '@/contracts/modeling/advanced-solid'

test('src/contracts/shared/contract-examples.spec.ts', async () => {  const sketchDefinition: SketchDefinition = {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: [
      'sketch_point_a',
      'sketch_point_b',
      'sketch_point_c',
      'sketch_point_d',
    ],
    points: [
      {
        pointId: 'sketch_point_a',
        label: 'A',
        target: { kind: 'sketchPoint', sketchId: 'sketch_profile', pointId: 'sketch_point_a' },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_b',
        label: 'B',
        target: { kind: 'sketchPoint', sketchId: 'sketch_profile', pointId: 'sketch_point_b' },
        position: [4, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_c',
        label: 'C',
        target: { kind: 'sketchPoint', sketchId: 'sketch_profile', pointId: 'sketch_point_c' },
        position: [4, 3],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_d',
        label: 'D',
        target: { kind: 'sketchPoint', sketchId: 'sketch_profile', pointId: 'sketch_point_d' },
        position: [0, 3],
        isConstruction: false,
      },
    ],
    entityIds: [
      'sketch_entity_bottom',
      'sketch_entity_right',
      'sketch_entity_top',
      'sketch_entity_left',
    ],
    entities: [
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_bottom',
        label: 'Bottom',
        target: { kind: 'sketchEntity', sketchId: 'sketch_profile', entityId: 'sketch_entity_bottom' },
        isConstruction: false,
        startPointId: 'sketch_point_a',
        endPointId: 'sketch_point_b',
      },
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_right',
        label: 'Right',
        target: { kind: 'sketchEntity', sketchId: 'sketch_profile', entityId: 'sketch_entity_right' },
        isConstruction: false,
        startPointId: 'sketch_point_b',
        endPointId: 'sketch_point_c',
      },
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_top',
        label: 'Top',
        target: { kind: 'sketchEntity', sketchId: 'sketch_profile', entityId: 'sketch_entity_top' },
        isConstruction: false,
        startPointId: 'sketch_point_c',
        endPointId: 'sketch_point_d',
      },
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_left',
        label: 'Left',
        target: { kind: 'sketchEntity', sketchId: 'sketch_profile', entityId: 'sketch_entity_left' },
        isConstruction: false,
        startPointId: 'sketch_point_d',
        endPointId: 'sketch_point_a',
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    derivedRelationships: [],
  }

  const solveSketchProjectionRequest: ProjectSketchExternalReferencesRequest = {
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: 'request_project_1',
    documentId: 'doc_workspace',
    revisionId: 'rev_7',
    sketchId: 'sketch_profile',
    plane: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
      linearUnit: 'documentLength',
      handedness: 'rightHanded',
    },
    tolerances: {
      coincidence: 0.0001,
      angleRadians: 0.0001,
      minimumSegmentLength: 0.001,
    },
    references: [],
  }

  const solveSketchRequest: SolveSketchRequest = {
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: 'request_solve_1',
    documentId: 'doc_workspace',
    revisionId: 'rev_7',
    sketchId: 'sketch_profile',
    plane: solveSketchProjectionRequest.plane,
    tolerances: solveSketchProjectionRequest.tolerances,
    partialSolvePolicy: 'bestEffort',
    definition: sketchDefinition,
    projectedReferences: [],
    incrementalEdit: null,
  }

  const solveSketchResponse: SolveSketchResponse = {
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: solveSketchRequest.requestId,
    documentId: solveSketchRequest.documentId,
    revisionId: solveSketchRequest.revisionId,
    sketchId: solveSketchRequest.sketchId,
    status: {
      solveState: 'solved',
      constraintState: 'wellConstrained',
    },
    solvedSnapshot: {
      schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
      status: {
        solveState: 'solved',
        constraintState: 'wellConstrained',
      },
      solvedEntities: [
        {
          entityId: 'sketch_entity_bottom',
          kind: 'lineSegment',
          startPosition: [0, 0],
          endPosition: [4, 0],
        },
        {
          entityId: 'sketch_entity_right',
          kind: 'lineSegment',
          startPosition: [4, 0],
          endPosition: [4, 3],
        },
        {
          entityId: 'sketch_entity_top',
          kind: 'lineSegment',
          startPosition: [4, 3],
          endPosition: [0, 3],
        },
        {
          entityId: 'sketch_entity_left',
          kind: 'lineSegment',
          startPosition: [0, 3],
          endPosition: [0, 0],
        },
      ],
      solvedPoints: [
        {
          pointId: 'sketch_point_a',
          target: { kind: 'sketchPoint', sketchId: 'sketch_profile', pointId: 'sketch_point_a' },
          solvedPosition: [0, 0],
        },
        {
          pointId: 'sketch_point_b',
          target: { kind: 'sketchPoint', sketchId: 'sketch_profile', pointId: 'sketch_point_b' },
          solvedPosition: [4, 0],
        },
        {
          pointId: 'sketch_point_c',
          target: { kind: 'sketchPoint', sketchId: 'sketch_profile', pointId: 'sketch_point_c' },
          solvedPosition: [4, 3],
        },
        {
          pointId: 'sketch_point_d',
          target: { kind: 'sketchPoint', sketchId: 'sketch_profile', pointId: 'sketch_point_d' },
          solvedPosition: [0, 3],
        },
      ],
      constraintStatuses: [],
      dimensionStatuses: [],
      diagnostics: [],
    },
    derivedRegions: [{
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_7',
        ownerFeatureId: null,
        ownerSketchId: 'sketch_profile',
        ownerBodyId: null,
        regionId: 'region_outer',
        label: 'Outer profile',
        target: {
          kind: 'region',
          sketchId: 'sketch_profile',
          regionId: 'region_outer',
        },
        sourceSketch: {
          kind: 'sketch',
          sketchId: 'sketch_profile',
        },
        loops: [
          {
            loopId: 'region_loop_outer',
            role: 'outer',
            orientation: 'counterClockwise',
            segments: [
              { source: { kind: 'entity', entityId: 'sketch_entity_bottom' }, startPointId: 'sketch_point_a', endPointId: 'sketch_point_b' },
              { source: { kind: 'entity', entityId: 'sketch_entity_right' }, startPointId: 'sketch_point_b', endPointId: 'sketch_point_c' },
              { source: { kind: 'entity', entityId: 'sketch_entity_top' }, startPointId: 'sketch_point_c', endPointId: 'sketch_point_d' },
              { source: { kind: 'entity', entityId: 'sketch_entity_left' }, startPointId: 'sketch_point_d', endPointId: 'sketch_point_a' },
            ],
            boundaryPointIds: [
              'sketch_point_a',
              'sketch_point_b',
              'sketch_point_c',
              'sketch_point_d',
            ],
            isClosed: true,
          },
        ],
        isClosed: true,
      }],
    diagnostics: [],
  }

  const createExtrudeRequest: CreateFeatureRequest = {
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_7',
    definition: {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [{
          kind: 'region',
          sketchId: 'sketch_profile',
          regionId: 'region_outer',
        }],
        startExtent: {
          kind: 'profilePlane',
        },
        extent: {
          mode: 'oneSide',
          end: {
            kind: 'blind',
            direction: 'positive',
            distance: 12,
          },
        },
        operation: 'newBody',
        booleanScope: {
          kind: 'standalone',
        },
      },
    },
  }

  const createExtrudeResponse: CreateFeatureResponse = {
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
    revisionId: 'rev_8',
    revisionState: {
      kind: 'accepted',
      baseRevisionId: 'rev_7',
    },
    rebuildResult: {
      kind: 'rebuilt',
      revisionId: 'rev_8',
      invalidatedTargets: [],
      diagnostics: [],
    },
    changedTargets: [
      {
        kind: 'feature',
        featureId: 'feature_extrude_1',
      },
      {
        kind: 'body',
        bodyId: 'body_main',
      },
      {
        kind: 'face',
        bodyId: 'body_main',
        faceId: 'face_side_1',
      },
    ],
    diagnostics: [],
    featureId: 'feature_extrude_1',
  }

  const previewExtrudeRequest: EvaluatePreviewRequest = {
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_7',
    previewId: 'preview_extrude_1',
    definition: createExtrudeRequest.definition,
  }

  const previewExtrudeResponse: EvaluatePreviewResponse = {
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
    revisionId: 'rev_8',
    previewId: 'preview_extrude_1',
    freshness: {
      kind: 'stale',
      requestedRevisionId: 'rev_7',
      currentRevisionId: 'rev_8',
    },
    render: {
      schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
      records: [],
    },
    diagnostics: [
      {
        code: 'preview.staleRevision',
        severity: 'warning',
        message: 'Preview response is stale and must be discarded.',
        target: null,
        detail: {
          kind: 'stalePreview',
          previewId: 'preview_extrude_1',
          requestedRevisionId: 'rev_7',
          currentRevisionId: 'rev_8',
        },
      },
    ],
  }

  const createShellRequest: CreateFeatureRequest = {
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_8',
    definition: {
      kind: 'shell',
      featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
      parameters: {
        bodyTarget: {
          kind: 'body',
          bodyId: 'body_main',
        },
        faceTargets: [
          {
            kind: 'face',
            bodyId: 'body_main',
            faceId: 'face_side_1',
          },
        ],
        thickness: 2,
        operation: 'newBody',
        booleanScope: {
          kind: 'standalone',
        },
      },
    },
  }

  const resolveDeadReferenceRequest: ResolveReferenceRequest = {
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
    target: {
      kind: 'face',
      bodyId: 'body_main',
      faceId: 'face_deleted',
    },
  }

  const resolveDeadReferenceResponse: ResolveReferenceResponse = {
    contractVersion: CONTRACT_VERSION,
    resolution: {
      label: 'Deleted face',
      target: {
        kind: 'face',
        bodyId: 'body_main',
        faceId: 'face_deleted',
      },
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_8',
      ownerFeatureId: 'feature_extrude_1',
      ownerSketchId: null,
      ownerBodyId: 'body_main',
      invalidation: {
        reason: 'deletedByRebuild',
        target: {
          kind: 'face',
          bodyId: 'body_main',
          faceId: 'face_deleted',
        },
        ownerFeatureId: 'feature_extrude_1',
        ownerSketchId: null,
        sourceTarget: null,
      },
    },
    diagnostics: [],
  }

  const topologyChangingRebuildRequest: UpdateFeatureRequest = {
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
    baseRevisionId: 'rev_8',
    featureId: 'feature_extrude_1',
    definition: {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [{
          kind: 'region',
          sketchId: 'sketch_profile',
          regionId: 'region_outer',
        }],
        startExtent: {
          kind: 'profilePlane',
        },
        extent: {
          mode: 'oneSide',
          end: {
            kind: 'blind',
            direction: 'positive',
            distance: 18,
          },
        },
        operation: 'newBody',
        booleanScope: {
          kind: 'standalone',
        },
      },
    },
  }

  const topologyChangingRebuildResponse: UpdateFeatureResponse = {
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
    revisionId: 'rev_9',
    revisionState: {
      kind: 'accepted',
      baseRevisionId: 'rev_8',
    },
    rebuildResult: {
      kind: 'rebuilt',
      revisionId: 'rev_9',
      invalidatedTargets: [
        {
          kind: 'face',
          bodyId: 'body_main',
          faceId: 'face_side_1',
        },
      ],
      diagnostics: [],
    },
    changedTargets: [
      {
        kind: 'feature',
        featureId: 'feature_extrude_1',
      },
      {
        kind: 'body',
        bodyId: 'body_main',
      },
      {
        kind: 'face',
        bodyId: 'body_main',
        faceId: 'face_top',
      },
    ],
    diagnostics: [],
    featureId: 'feature_extrude_1',
  }

  const renderMeshWithBindingsExample: RenderExport = {
    schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
    records: [
      {
        id: 'renderable_face_1',
        label: 'Extrude Side Face',
        ownerBodyId: 'body_main',
        ownerFeatureId: 'feature_extrude_1',
        binding: {
          pickId: 'pick_face_1',
          pickPriority: 10,
          topology: 'face',
          semanticClass: 'bodyFace',
          target: {
            kind: 'face',
            bodyId: 'body_main',
            faceId: 'face_side_1',
          },
        },
        geometry: {
          kind: 'mesh',
          vertexPositions: [
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 0],
          ],
          vertexNormals: null,
          triangleIndices: [[0, 1, 2]],
        },
      },
    ],
  }

  function testSolveSketchExampleIsFullyTyped() {
    expectTrue(solveSketchProjectionRequest.contractVersion === CONTRACT_VERSION, 'Solve-sketch example must declare the shared contract version.')
    expectTrue(solveSketchRequest.definition.schemaVersion === SKETCH_SCHEMA_VERSION, 'Solve-sketch example must use the authored sketch schema version.')
    expectTrue(solveSketchRequest.partialSolvePolicy === 'bestEffort', 'Solve-sketch example must use an explicit partial-solve policy.')
    expectTrue(solveSketchResponse.requestId === solveSketchRequest.requestId, 'Solve-sketch response must echo the request correlation ID.')
    expectTrue(solveSketchResponse.derivedRegions[0]?.ownerRevisionId === solveSketchResponse.revisionId, 'Solve-sketch derived regions must carry explicit ownership at the solved revision.')
  }

  function testCreateExtrudeExampleUsesTypedProfileRef() {
    expectTrue(createExtrudeRequest.definition.kind === 'extrude', 'Create-extrude example must use the extrude feature family.')
    expectTrue(createExtrudeRequest.definition.parameters.profiles[0]?.kind === 'region', 'Create-extrude example must use an explicit derived region reference.')
    expectTrue(createExtrudeRequest.definition.parameters.extent.end.distance > 0, 'Create-extrude example must use a positive blind extent distance.')
    expectTrue(createExtrudeResponse.revisionState.kind === 'accepted', 'Create-extrude response must report explicit revision acceptance.')
    expectTrue(createExtrudeResponse.rebuildResult.kind === 'rebuilt', 'Create-extrude response must report explicit rebuild success.')
  }

  function testPreviewExtrudeExampleReusesFeatureDefinition() {
    expectTrue(previewExtrudeRequest.definition === createExtrudeRequest.definition, 'Preview example must reuse the same typed definition family as create/update.')
    expectTrue(previewExtrudeRequest.previewId === 'preview_extrude_1', 'Preview example must carry an explicit preview correlation ID.')
    expectTrue(previewExtrudeResponse.freshness.kind === 'stale', 'Preview example must document stale-result handling explicitly.')
    expectTrue(previewExtrudeResponse.diagnostics[0]?.detail?.kind === 'stalePreview', 'Preview example must encode stale previews as machine-readable diagnostics.')
  }

  function testCreateShellExampleUsesTypedBodyAndFaceRefs() {
    expectTrue(createShellRequest.definition.kind === 'shell', 'Create-shell example must use the shell feature family.')
    expectTrue(createShellRequest.definition.parameters.bodyTarget.kind === 'body', 'Create-shell example must keep the source body explicit.')
    expectTrue(createShellRequest.definition.parameters.faceTargets[0]?.kind === 'face', 'Create-shell example must keep removable faces explicit.')
    expectTrue(createShellRequest.definition.parameters.thickness > 0, 'Create-shell example must use a positive thickness.')
  }

  function testResolveDeadReferenceExampleIsExplicit() {
    expectTrue(resolveDeadReferenceRequest.target.kind === 'face', 'Dead-reference example must use an explicit durable target.')
    expectTrue(resolveDeadReferenceRequest.target.faceId === 'face_deleted', 'Dead-reference example must name the exact dead durable target.')
    expectTrue(resolveDeadReferenceResponse.resolution.invalidation?.reason === 'deletedByRebuild', 'Dead-reference response must surface explicit invalidation semantics.')
    expectTrue(resolveDeadReferenceResponse.resolution.ownerRevisionId === 'rev_8', 'Dead-reference response must carry explicit ownership context.')
  }

  function testTopologyChangingRebuildExampleSeparatesPreservedAndInvalidatedTargets() {
    expectTrue(topologyChangingRebuildRequest.baseRevisionId === 'rev_8', 'Topology-changing rebuild example must declare the exact base revision.')
    expectTrue(topologyChangingRebuildResponse.revisionState.kind === 'accepted', 'Topology-changing rebuild example must report explicit revision acceptance.')
    expectTrue(topologyChangingRebuildResponse.rebuildResult.kind === 'rebuilt', 'Topology-changing rebuild example must report a rebuilt result.')
    expectTrue(topologyChangingRebuildResponse.rebuildResult.invalidatedTargets.length === 1, 'Topology-changing rebuild example must surface invalidated durable targets explicitly.')
    expectTrue(topologyChangingRebuildResponse.rebuildResult.invalidatedTargets[0]?.kind === 'face', 'Topology-changing rebuild example must invalidate the exact durable face that died in the rebuild.')
    expectTrue(
      topologyChangingRebuildResponse.changedTargets.some(
        (target) => target.kind === 'face' && target.faceId === 'face_top',
      ),
      'Topology-changing rebuild example must preserve unaffected topology through explicit durable refs.',
    )
  }

  function testRenderMeshWithBindingsExampleIsSelectionCapable() {
    const record = renderMeshWithBindingsExample.records[0]

    expectTrue(record !== undefined, 'Render example must include at least one render record.')
    expectTrue(record.binding.target.kind === 'face', 'Render example binding must map back to a durable face reference.')
    expectTrue(record.geometry.kind === 'mesh', 'Render example must use mesh geometry for tessellated faces.')
  }

  function testSolvedSketchVersionLiteralRemainsDocumented() {
    expectTrue(SOLVED_SKETCH_SCHEMA_VERSION === 'solved-sketch/v1alpha1', 'Solved sketch schema version literal must remain explicit in examples.')
  }

  function testAdvancedSolidExamplesUseRoleSpecificParticipants() {
    expectTrue(sweepAdvancedFeatureExample.parameters.participants.some((participant) => participant.role === 'profile'), 'Sweep example must preserve a profile participant role.')
    expectTrue(sweepAdvancedFeatureExample.parameters.participants.some((participant) => participant.role === 'path'), 'Sweep example must preserve a path participant role.')
    expectTrue(loftAdvancedFeatureExample.parameters.participants[0]?.role === 'profile', 'Loft example must preserve ordered profile participants.')
    expectTrue(loftAdvancedFeatureExample.parameters.participants.some((participant) => participant.role === 'path'), 'Loft example must preserve optional path participants.')
    expectTrue(loftAdvancedFeatureExample.parameters.participants.some((participant) => participant.role === 'guideCurve'), 'Loft example must preserve optional guide-curve participants.')
    expectTrue(chamferAdvancedFeatureExample.parameters.participants[0]?.role === 'edge', 'Chamfer example must preserve topology modifier edge participants.')
    expectTrue(thickenAdvancedFeatureExample.parameters.participants[0]?.role === 'face', 'Thicken example must preserve explicit face participants.')
    expectTrue(thickenAdvancedFeatureExample.parameters.options?.thickness === 1.5, 'Thicken example must preserve positive thickness options.')
    expectTrue(splitAdvancedFeatureExample.parameters.participants.some((participant) => participant.role === 'targetBody'), 'Split example must preserve explicit target-body participants.')
    expectTrue(splitAdvancedFeatureExample.parameters.participants.some((participant) => participant.role === 'toolBody'), 'Split example must preserve body-operation tool participants.')
    expectTrue(deleteSolidAdvancedFeatureExample.parameters.participants[0]?.role === 'body', 'Delete-solid example must preserve explicit body participants.')
    expectTrue(mirrorAdvancedFeatureExample.parameters.participants.some((participant) => participant.role === 'plane'), 'Mirror example must preserve an explicit plane participant.')
    expectTrue(mirrorAdvancedFeatureExample.parameters.options?.copy === true, 'Mirror example must preserve an explicit copy option.')
    expectTrue(transformAdvancedFeatureExample.parameters.participants.some((participant) => participant.role === 'transformReference'), 'Transform example must preserve an explicit transform-reference participant.')
    expectTrue(transformAdvancedFeatureExample.parameters.options?.distance === 5, 'Transform example must preserve a typed distance option.')
  }

  testSolveSketchExampleIsFullyTyped()
  testCreateExtrudeExampleUsesTypedProfileRef()
  testPreviewExtrudeExampleReusesFeatureDefinition()
  testCreateShellExampleUsesTypedBodyAndFaceRefs()
  testResolveDeadReferenceExampleIsExplicit()
  testTopologyChangingRebuildExampleSeparatesPreservedAndInvalidatedTargets()
  testRenderMeshWithBindingsExampleIsSelectionCapable()
  testSolvedSketchVersionLiteralRemainsDocumented()
  testAdvancedSolidExamplesUseRoleSpecificParticipants()
})
