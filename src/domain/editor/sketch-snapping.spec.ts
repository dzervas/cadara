import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deriveSketchDisplayEntities,
  startSketchDraw,
  updateSketchPointer,
} from '@/domain/editor/sketch-session'

test('src/domain/editor/sketch-snapping.spec.ts', () => {  function assertClosePoint(
    actual: readonly [number, number] | null | undefined,
    expected: readonly [number, number],
    message: string,
  ) {
    expectTrue(actual, `${message} Missing point.`)
    const distance = Math.hypot(actual[0] - expected[0], actual[1] - expected[1])
    expectTrue(distance < 1e-6, `${message} Expected ${expected.join(', ')}, received ${actual.join(', ')}.`)
  }

  function createSketchLineSession() {
    let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [2, 0])

    return session
  }

  function addProjectedLineReference(
    session: ReturnType<typeof createNewSketchSessionFromSupport>,
    projectedReferences: ProjectedSketchReferenceRecord[],
  ) {
    const referenceRecord = {
      referenceId: projectedReferences[0]!.referenceId,
      kind: 'modelReference' as const,
      label: 'Projected reference',
      source: { kind: 'edge' as const, bodyId: 'body_1', edgeId: 'edge_1' },
      projectionMode: 'projectAlongPlaneNormal' as const,
    }

    return {
      ...session,
      definition: {
        ...session.definition,
        referenceIds: [referenceRecord.referenceId],
        references: [referenceRecord],
      },
      fullDefinition: {
        ...session.fullDefinition,
        referenceIds: [referenceRecord.referenceId],
        references: [referenceRecord],
      },
      projectedReferences,
    }
  }

  function testLocalSnapPreviewAndCommit() {
    let session = createSketchLineSession()

    session = startSketchDraw(session, [1, 0.04])
    expectTrue(session.activeSnap?.kind === 'midpoint', 'Starting a new line near an existing line midpoint should activate midpoint snap.')
    assertClosePoint(session.pointerDownPoint, [1, 0], 'Line start should use the snapped midpoint coordinate.')
    expectTrue(
      session.toolPresentation?.overlays?.some((overlay) => overlay.kind === 'snapIndicator' && overlay.label === 'Midpoint'),
      'Active snap should be exposed as transient viewport feedback.',
    )

    session = updateSketchPointer(session, [3, 0.04])
    expectTrue(session.activeSnap?.kind === 'horizontalAlignment', 'Line preview should snap horizontally from the snapped start.')
    assertClosePoint(session.livePoint, [3, 0], 'Line preview should use the snap-adjusted endpoint.')

    const preview = deriveSketchDisplayEntities(session).find((entity) => entity.status === 'preview')
    expectTrue(preview?.kind === 'line', 'Expected a transient preview line.')
    assertClosePoint(preview.start, [1, 0], 'Preview line should start at the snapped midpoint.')
    assertClosePoint(preview.end, [3, 0], 'Preview line should end at the snapped horizontal point.')

    session = acceptSketchDraw(session, [3, 0.04])
    const committed = session.definition.entities.at(-1)
    expectTrue(committed?.kind === 'lineSegment', 'Snapped commit should author the normal line entity.')
    const start = session.definition.points.find((point) => point.pointId === committed.startPointId)
    const end = session.definition.points.find((point) => point.pointId === committed.endPointId)
    assertClosePoint(start?.position, [1, 0], 'Committed line start should use the snapped midpoint.')
    assertClosePoint(end?.position, [3, 0], 'Committed line end should use the snapped horizontal point.')
    expectTrue(
      session.definition.constraints.some((constraint) => constraint.kind === 'midpoint'),
      'Accepted midpoint snap should append a durable midpoint constraint.',
    )
    expectTrue(
      session.definition.constraints.some((constraint) => constraint.kind === 'horizontal'),
      'Accepted horizontal snap should append a durable horizontal constraint.',
    )
    expectTrue(session.activeSnap === null, 'Accepted draw commits should clear transient snap state.')
  }

  function testEndpointSnapReusesExistingLocalPointIds() {
    let session = createSketchLineSession()
    const baseLine = session.definition.entities.find((entity) => entity.kind === 'lineSegment')
    expectTrue(baseLine?.kind === 'lineSegment', 'Expected a committed baseline line.')

    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [2.04, 0.02])
    expectTrue(session.activeSnap?.kind === 'endpoint', 'Starting near an existing endpoint should activate endpoint snap.')
    session = updateSketchPointer(session, [3, 1])
    session = acceptSketchDraw(session, [3, 1])

    const committed = session.definition.entities.at(-1)
    expectTrue(committed?.kind === 'lineSegment', 'Snapped endpoint commit should author a line entity.')
    expectTrue(
      committed.startPointId === baseLine.endPointId,
      'Snapped line start should reuse the existing endpoint point id instead of creating a duplicate point.',
    )
    expectTrue(session.definition.points.length === 3, 'Endpoint snap should only add the one unsnapped endpoint point.')
    expectTrue(
      !session.definition.constraints.some((constraint) =>
        constraint.kind === 'coincident'
        && constraint.pointIds.includes(baseLine.endPointId)
      ),
      'Reused local endpoints should not need an extra inferred coincident constraint.',
    )
  }

  function testProjectedSnapPreviewWithoutCopyingReferenceGeometry() {
    const projectedReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: 'ref_projected_edge',
        status: 'projected',
        geometry: [
          {
            geometryId: 'projected_geometry_edge',
            kind: 'lineSegment',
            startPosition: [1, -1],
            endPosition: [1, 1],
          },
        ],
        diagnostics: [],
      },
    ]
    let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    session = {
      ...session,
      projectedReferences,
    }
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [1.08, 0.3])

    expectTrue(session.activeSnap?.kind === 'nearestOnLine', 'Projected reference geometry should feed snap candidates.')
    assertClosePoint(session.pointerDownPoint, [1, 0.3], 'Line start should snap onto projected reference geometry.')
    expectTrue(
      session.activeSnap.sources.some((source) => source.kind === 'projectedGeometry'),
      'Projected snap metadata should identify the derived reference geometry source.',
    )
    expectTrue(session.definition.references.length === 0, 'Snapping to projected geometry should not author or copy reference records.')
    expectTrue(session.definition.entities.length === 0, 'Starting from a projected snap should not copy projected geometry into entities.')
  }

  function testProjectedSnapCommitsReferenceConstraintWithoutCopyingGeometry() {
    const projectedReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: 'ref_projected_edge',
        status: 'projected',
        geometry: [
          {
            geometryId: 'projected_geometry_edge',
            kind: 'lineSegment',
            startPosition: [1, -1],
            endPosition: [1, 1],
          },
        ],
        diagnostics: [],
      },
    ]
    const referenceRecord = {
      referenceId: 'ref_projected_edge',
      kind: 'modelReference' as const,
      label: 'Projected edge',
      source: { kind: 'edge' as const, bodyId: 'body_1', edgeId: 'edge_1' },
      projectionMode: 'projectAlongPlaneNormal' as const,
    }
    let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    session = {
      ...session,
      definition: {
        ...session.definition,
        referenceIds: ['ref_projected_edge'],
        references: [referenceRecord],
      },
      fullDefinition: {
        ...session.fullDefinition,
        referenceIds: ['ref_projected_edge'],
        references: [referenceRecord],
      },
      projectedReferences,
    }
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [1.08, 0.3])
    session = updateSketchPointer(session, [2, 0.3])
    session = acceptSketchDraw(session, [2, 0.3])

    expectTrue(
      session.definition.constraints.some((constraint) => constraint.kind === 'pointOnProjectedCurve'),
      'Accepted projected line snap should append a durable point-on-projected-curve constraint.',
    )
    expectTrue(
      session.definition.entities.length === 1,
      'Snapping to projected geometry should only author the requested local line entity.',
    )
  }

  function testBothEndpointsSnappedToSameLineUseUniqueConstraintIds() {
    let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [2, 1])

    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0.54, 0.23])
    expectTrue(session.activeSnap?.kind === 'nearestOnLine', 'Line start should snap onto the existing line.')
    session = updateSketchPointer(session, [1.48, 0.76])
    expectTrue(session.activeSnap?.kind === 'nearestOnLine', 'Line end should snap onto the same existing line.')
    session = acceptSketchDraw(session, [1.48, 0.76])

    const constraintIds = session.definition.constraints.map((constraint) => constraint.constraintId)
    expectTrue(
      new Set(constraintIds).size === constraintIds.length,
      'Accepted start/end snaps against the same source should create unique durable constraint IDs.',
    )

    const solved = solveSketchDefinitionCore({
      definition: session.definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: 'bestEffort',
    })
    expectTrue(
      !solved.diagnostics.some((diagnostic) => diagnostic.code === 'duplicate-constraint-id'),
      'Solved snapped sketch should not report duplicate inferred constraint IDs.',
    )
  }

  function testProjectedMidpointSnapCommitsDerivedReferenceConstraint() {
    const projectedReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: 'ref_projected_midpoint_edge',
        status: 'projected',
        geometry: [
          {
            geometryId: 'projected_geometry_midpoint_edge',
            kind: 'lineSegment',
            startPosition: [0, 0],
            endPosition: [2, 0],
          },
        ],
        diagnostics: [],
      },
    ]
    let session = addProjectedLineReference(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      projectedReferences,
    )

    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [1, 0.04])
    session = updateSketchPointer(session, [2, 1])
    session = acceptSketchDraw(session, [2, 1])

    expectTrue(
      session.definition.constraints.some((constraint) => constraint.kind === 'midpointProjectedLine'),
      'Accepted projected midpoint snap should append a durable midpoint-to-projected-line constraint.',
    )
    expectTrue(session.definition.entities.length === 1, 'Projected midpoint snapping should not copy reference geometry.')
  }

  function testProjectedConcentricSnapCommitsDerivedReferenceConstraint() {
    const projectedReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: 'ref_projected_circle',
        status: 'projected',
        geometry: [
          {
            geometryId: 'projected_geometry_circle',
            kind: 'circle',
            centerPosition: [2, 2],
            radius: 1,
          },
        ],
        diagnostics: [],
      },
    ]
    let session = addProjectedLineReference(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      projectedReferences,
    )

    session = beginSketchTool(session, 'circle')
    session = startSketchDraw(session, [2.03, 2.02])
    session = updateSketchPointer(session, [3, 2])
    session = acceptSketchDraw(session, [3, 2])

    expectTrue(
      session.definition.constraints.some((constraint) => constraint.kind === 'concentricProjectedCurve'),
      'Accepted projected center snap while drawing a circle should append a durable concentric projected constraint.',
    )
    expectTrue(session.definition.entities.length === 1, 'Projected concentric snapping should only author the requested local circle.')
  }

  function testProjectedPointCenterSnapCommitsDerivedReferenceConstraint() {
    const projectedReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: 'ref_projected_vertex',
        status: 'projected',
        geometry: [
          {
            geometryId: 'projected_geometry_vertex',
            kind: 'point',
            position: [2, 2],
          },
        ],
        diagnostics: [],
      },
    ]
    let session = addProjectedLineReference(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      projectedReferences,
    )

    session = beginSketchTool(session, 'circle')
    session = startSketchDraw(session, [2.03, 2.02])
    session = updateSketchPointer(session, [3, 2])
    session = acceptSketchDraw(session, [3, 2])

    expectTrue(
      session.definition.constraints.some((constraint) => constraint.kind === 'coincidentProjectedPoint'),
      'Accepted projected point center snap while drawing a circle should constrain the circle center to the projected point.',
    )
    expectTrue(session.definition.entities.length === 1, 'Projected point center snapping should only author the requested local circle.')
  }

  function testSketchDatumSnapsCommitDerivedReferenceConstraints() {
    let originSession = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    originSession = beginSketchTool(originSession, 'line')
    originSession = startSketchDraw(originSession, [0.04, 0.03])
    expectTrue(originSession.activeSnap?.kind === 'endpoint', 'Starting near the sketch origin should activate datum-origin snap.')
    assertClosePoint(originSession.pointerDownPoint, [0, 0], 'Line start should snap to the exact sketch origin.')
    originSession = updateSketchPointer(originSession, [2, 1])
    originSession = acceptSketchDraw(originSession, [2, 1])

    const originConstraint = originSession.definition.constraints.find((constraint) =>
      constraint.kind === 'coincidentProjectedPoint'
      && constraint.projectedPoint.kind === 'sketchDatum'
      && constraint.projectedPoint.datum === 'origin'
    )
    expectTrue(originConstraint, 'Accepted datum-origin snap should constrain the authored endpoint to the sketch origin.')

    let axisSession = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    axisSession = beginSketchTool(axisSession, 'line')
    axisSession = startSketchDraw(axisSession, [2, 1])
    axisSession = updateSketchPointer(axisSession, [4, 0.04])
    expectTrue(axisSession.activeSnap?.kind === 'nearestOnLine', 'Moving near a sketch datum axis should activate an on-axis snap.')
    assertClosePoint(axisSession.livePoint, [4, 0], 'Line endpoint should snap onto the X datum axis.')
    axisSession = acceptSketchDraw(axisSession, [4, 0.04])

    const axisConstraint = axisSession.definition.constraints.find((constraint) =>
      constraint.kind === 'pointOnProjectedCurve'
      && constraint.projectedCurve.kind === 'sketchDatum'
      && constraint.projectedCurve.datum === 'xAxis'
    )
    expectTrue(axisConstraint, 'Accepted datum-axis snap should constrain the authored endpoint onto the sketch axis.')
  }

  function testProjectedPerpendicularAndTangentSnapsCommitDerivedReferenceConstraints() {
    const projectedLineReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: 'ref_projected_perpendicular_edge',
        status: 'projected',
        geometry: [
          {
            geometryId: 'projected_geometry_perpendicular_edge',
            kind: 'lineSegment',
            startPosition: [1, -1],
            endPosition: [1, 2],
          },
        ],
        diagnostics: [],
      },
    ]
    let perpendicularSession = addProjectedLineReference(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      projectedLineReferences,
    )

    perpendicularSession = beginSketchTool(perpendicularSession, 'line')
    perpendicularSession = startSketchDraw(perpendicularSession, [0, 0])
    perpendicularSession = updateSketchPointer(perpendicularSession, [1, 0])
    expectTrue(perpendicularSession.activeSnap?.kind === 'perpendicularFoot', 'Projected line should provide a perpendicular-foot snap.')
    perpendicularSession = acceptSketchDraw(perpendicularSession, [1, 0])

    expectTrue(
      perpendicularSession.definition.constraints.some((constraint) => constraint.kind === 'perpendicularProjectedLine'),
      'Accepted projected perpendicular snap should append a durable perpendicular projected constraint.',
    )
    expectTrue(
      perpendicularSession.definition.constraints.some((constraint) => constraint.kind === 'pointOnProjectedCurve'),
      'Accepted projected perpendicular snap should keep the foot point on the projected line.',
    )

    const projectedCircleReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: 'ref_projected_tangent_circle',
        status: 'projected',
        geometry: [
          {
            geometryId: 'projected_geometry_tangent_circle',
            kind: 'circle',
            centerPosition: [0, 0],
            radius: 1,
          },
        ],
        diagnostics: [],
      },
    ]
    let tangentSession = addProjectedLineReference(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      projectedCircleReferences,
    )

    tangentSession = beginSketchTool(tangentSession, 'line')
    tangentSession = startSketchDraw(tangentSession, [0, 3])
    tangentSession = updateSketchPointer(tangentSession, [0.9428090415820634, 0.33333333333333337])
    expectTrue(tangentSession.activeSnap?.kind === 'tangent', 'Projected circle should provide a tangent snap.')
    tangentSession = acceptSketchDraw(tangentSession, [0.9428090415820634, 0.33333333333333337])

    expectTrue(
      tangentSession.definition.constraints.some((constraint) => constraint.kind === 'tangentProjectedCurve'),
      'Accepted projected tangent snap should append a durable tangent projected constraint.',
    )
    expectTrue(
      tangentSession.definition.constraints.some((constraint) => constraint.kind === 'pointOnProjectedCurve'),
      'Accepted projected tangent snap should keep the tangent endpoint on the projected curve.',
    )
    expectTrue(tangentSession.definition.entities.length === 1, 'Projected tangent snapping should only author the requested local line.')
  }

  testLocalSnapPreviewAndCommit()
  testEndpointSnapReusesExistingLocalPointIds()
  testProjectedSnapPreviewWithoutCopyingReferenceGeometry()
  testProjectedSnapCommitsReferenceConstraintWithoutCopyingGeometry()
  testBothEndpointsSnappedToSameLineUseUniqueConstraintIds()
  testProjectedMidpointSnapCommitsDerivedReferenceConstraint()
  testProjectedConcentricSnapCommitsDerivedReferenceConstraint()
  testProjectedPointCenterSnapCommitsDerivedReferenceConstraint()
  testSketchDatumSnapsCommitDerivedReferenceConstraints()
  testProjectedPerpendicularAndTangentSnapsCommitDerivedReferenceConstraints()
})
