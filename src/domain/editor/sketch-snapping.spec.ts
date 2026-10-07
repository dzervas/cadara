import { test, expect } from "vitest";

import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deriveSketchDisplayEntities,
  startSketchDraw,
  updateSketchPointer,
} from "@/domain/editor/sketch-session";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/domain/editor/sketch-session/test-snap-scale";

test("src/domain/editor/sketch-snapping.spec.ts", () => {
  function assertClosePoint(
    actual: readonly [number, number] | null | undefined,
    expected: readonly [number, number],
    message: string,
  ) {
    expect(actual, `${message} Missing point.`).toBeTruthy();
    const distance = Math.hypot(
      actual[0] - expected[0],
      actual[1] - expected[1],
    );
    expect(
      distance < 1e-6,
      `${message} Expected ${expected.join(", ")}, received ${actual.join(", ")}.`,
    ).toBeTruthy();
  }

  function createSketchLineSession(y = 0) {
    let session = withSketchSnapScale(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    );
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, y]);
    session = acceptSketchDraw(session, [2, y]);

    return session;
  }

  function addProjectedLineReference(
    session: ReturnType<typeof createNewSketchSessionFromSupport>,
    projectedReferences: ProjectedSketchReferenceRecord[],
  ) {
    const referenceRecord = {
      referenceId: projectedReferences[0]!.referenceId,
      kind: "modelReference" as const,
      label: "Projected reference",
      source: { kind: "edge" as const, bodyId: "body_1", edgeId: "edge_1" },
      projectionMode: "projectAlongPlaneNormal" as const,
    };

    return {
      ...session,
      definition: {
        ...session.definition,
        referenceIds: [referenceRecord.referenceId],
        references: [referenceRecord],
      },
      projectedReferences,
    };
  }

  function testLocalSnapPreviewAndCommit() {
    // Off the X axis: an axis under the pointer is an on-curve snap, which
    // outranks the horizontal alignment this row is about (T13-D14).
    let session = createSketchLineSession(1);

    session = startSketchDraw(session, [1, 1.04]);
    expect(
      session.activeInference?.candidate?.kind,
      "Starting a new line near an existing line midpoint should activate midpoint snap.",
    ).toBe("midpoint");
    assertClosePoint(
      session.pointerDownPoint,
      [1, 1],
      "Line start should use the snapped midpoint coordinate.",
    );
    expect(
      session.toolPresentation?.overlays?.some(
        (overlay) =>
          overlay.kind === "snapIndicator" &&
          overlay.candidateKind === "midpoint" &&
          overlay.label === "Midpoint of Line 1",
      ),
      "Active snap should be exposed as transient viewport feedback.",
    ).toBeTruthy();

    session = updateSketchPointer(session, [3, 1.04]);
    expect(
      session.activeInference?.candidate?.kind,
      "Line preview should snap horizontally from the snapped start.",
    ).toBe("horizontalAlignment");
    assertClosePoint(
      session.livePoint,
      [3, 1],
      "Line preview should use the snap-adjusted endpoint.",
    );

    const preview = deriveSketchDisplayEntities(session).find(
      (entity) => entity.status === "preview",
    );
    expect(preview?.kind, "Expected a transient preview line.").toBe("line");
    assertClosePoint(
      preview.start,
      [1, 1],
      "Preview line should start at the snapped midpoint.",
    );
    assertClosePoint(
      preview.end,
      [3, 1],
      "Preview line should end at the snapped horizontal point.",
    );

    session = acceptSketchDraw(session, [3, 1.04]);
    const committed = session.definition.entities.at(-1);
    expect(
      committed?.kind,
      "Snapped commit should author the normal line entity.",
    ).toBe("lineSegment");
    const start = session.definition.points.find(
      (point) => point.pointId === committed.startPointId,
    );
    const end = session.definition.points.find(
      (point) => point.pointId === committed.endPointId,
    );
    assertClosePoint(
      start?.position,
      [1, 1],
      "Committed line start should use the snapped midpoint.",
    );
    assertClosePoint(
      end?.position,
      [3, 1],
      "Committed line end should use the snapped horizontal point.",
    );
    expect(
      session.definition.constraints.some(
        (constraint) => constraint.kind === "midpoint",
      ),
      "Accepted midpoint snap should append a durable midpoint constraint.",
    ).toBeTruthy();
    expect(
      session.definition.constraints.some(
        (constraint) => constraint.kind === "horizontal",
      ),
      "Accepted horizontal snap should append a durable horizontal constraint.",
    ).toBeTruthy();
    expect(
      session.activeInference?.candidate ?? null,
      "Accepted draw commits should clear transient snap state.",
    ).toBe(null);
  }

  function testEndpointSnapReusesExistingLocalPointIds() {
    let session = createSketchLineSession();
    const baseLine = session.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    );
    expect(baseLine?.kind, "Expected a committed baseline line.").toBe(
      "lineSegment",
    );

    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [2.04, 0.02]);
    expect(
      session.activeInference?.candidate?.kind,
      "Starting near an existing endpoint should activate endpoint snap.",
    ).toBe("endpoint");
    session = updateSketchPointer(session, [3, 1]);
    session = acceptSketchDraw(session, [3, 1]);

    const committed = session.definition.entities.at(-1);
    expect(
      committed?.kind,
      "Snapped endpoint commit should author a line entity.",
    ).toBe("lineSegment");
    expect(
      committed.startPointId,
      "Snapped line start should reuse the existing endpoint point id instead of creating a duplicate point.",
    ).toBe(baseLine.endPointId);
    expect(
      session.definition.points.length,
      "Endpoint snap should only add the one unsnapped endpoint point.",
    ).toBe(3);
    expect(
      session.definition.constraints.some(
        (constraint) =>
          constraint.kind === "coincident" &&
          constraint.pointIds.includes(baseLine.endPointId),
      ),
      "Reused local endpoints should not need an extra inferred coincident constraint.",
    ).toBeFalsy();
  }

  function testProjectedSnapPreviewWithoutCopyingReferenceGeometry() {
    const projectedReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: "ref_projected_edge",
        status: "projected",
        geometry: [
          {
            geometryId: "projected_geometry_edge",
            kind: "lineSegment",
            startPosition: [1, -1],
            endPosition: [1, 1],
          },
        ],
        diagnostics: [],
      },
    ];
    let session = withSketchSnapScale(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    );
    session = {
      ...session,
      projectedReferences,
    };
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [1.08, 0.3]);

    expect(
      session.activeInference?.candidate?.kind,
      "Projected reference geometry should feed snap candidates.",
    ).toBe("nearestOnLine");
    assertClosePoint(
      session.pointerDownPoint,
      [1, 0.3],
      "Line start should snap onto projected reference geometry.",
    );
    expect(
      session.activeInference!.candidate!.sources.some(
        (source) => source.kind === "projectedGeometry",
      ),
      "Projected snap metadata should identify the derived reference geometry source.",
    ).toBeTruthy();
    expect(
      session.definition.references.length,
      "Snapping to projected geometry should not author or copy reference records.",
    ).toBe(0);
    expect(
      session.definition.entities.length,
      "Starting from a projected snap should not copy projected geometry into entities.",
    ).toBe(0);
  }

  function testProjectedSnapCommitsReferenceConstraintWithoutCopyingGeometry() {
    const projectedReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: "ref_projected_edge",
        status: "projected",
        geometry: [
          {
            geometryId: "projected_geometry_edge",
            kind: "lineSegment",
            startPosition: [1, -1],
            endPosition: [1, 1],
          },
        ],
        diagnostics: [],
      },
    ];
    const referenceRecord = {
      referenceId: "ref_projected_edge",
      kind: "modelReference" as const,
      label: "Projected edge",
      source: { kind: "edge" as const, bodyId: "body_1", edgeId: "edge_1" },
      projectionMode: "projectAlongPlaneNormal" as const,
    };
    let session = withSketchSnapScale(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    );
    session = {
      ...session,
      definition: {
        ...session.definition,
        referenceIds: ["ref_projected_edge"],
        references: [referenceRecord],
      },
      projectedReferences,
    };
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [1.08, 0.3]);
    session = updateSketchPointer(session, [2, 0.3]);
    session = acceptSketchDraw(session, [2, 0.3]);

    expect(
      session.definition.constraints.some(
        (constraint) => constraint.kind === "pointOnProjectedCurve",
      ),
      "Accepted projected line snap should append a durable point-on-projected-curve constraint.",
    ).toBeTruthy();
    expect(
      session.definition.entities.length,
      "Snapping to projected geometry should only author the requested local line entity.",
    ).toBe(1);
  }

  function testBothEndpointsSnappedToSameLineUseUniqueConstraintIds() {
    let session = withSketchSnapScale(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    );
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [2, 1]);

    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0.54, 0.23]);
    expect(
      session.activeInference?.candidate?.kind,
      "Line start should snap onto the existing line.",
    ).toBe("nearestOnLine");
    session = updateSketchPointer(session, [1.48, 0.76]);
    expect(
      session.activeInference?.candidate?.kind,
      "Line end should snap onto the same existing line.",
    ).toBe("nearestOnLine");
    session = acceptSketchDraw(session, [1.48, 0.76]);

    const constraintIds = session.definition.constraints.map(
      (constraint) => constraint.constraintId,
    );
    expect(
      new Set(constraintIds).size,
      "Accepted start/end snaps against the same source should create unique durable constraint IDs.",
    ).toBe(constraintIds.length);

    const solved = solveSketchDefinitionCore({
      definition: session.definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    expect(
      solved.diagnostics.some(
        (diagnostic) => diagnostic.code === "duplicate-constraint-id",
      ),
      "Solved snapped sketch should not report duplicate inferred constraint IDs.",
    ).toBeFalsy();
  }

  function testProjectedMidpointSnapCommitsDerivedReferenceConstraint() {
    const projectedReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: "ref_projected_midpoint_edge",
        status: "projected",
        geometry: [
          {
            geometryId: "projected_geometry_midpoint_edge",
            kind: "lineSegment",
            startPosition: [0, 0],
            endPosition: [2, 0],
          },
        ],
        diagnostics: [],
      },
    ];
    let session = addProjectedLineReference(
      withSketchSnapScale(
        createNewSketchSessionFromSupport(
          {
            kind: "construction",
            constructionId: "construction_plane-xy",
          },
          OCC_KERNEL_SETTINGS,
        ),
        SPEC_SKETCH_UNITS_PER_PIXEL,
      ),
      projectedReferences,
    );

    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [1, 0.04]);
    session = updateSketchPointer(session, [2, 1]);
    session = acceptSketchDraw(session, [2, 1]);

    expect(
      session.definition.constraints.some(
        (constraint) => constraint.kind === "midpointProjectedLine",
      ),
      "Accepted projected midpoint snap should append a durable midpoint-to-projected-line constraint.",
    ).toBeTruthy();
    expect(
      session.definition.entities.length,
      "Projected midpoint snapping should not copy reference geometry.",
    ).toBe(1);
  }

  function testProjectedConcentricSnapCommitsDerivedReferenceConstraint() {
    const projectedReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: "ref_projected_circle",
        status: "projected",
        geometry: [
          {
            geometryId: "projected_geometry_circle",
            kind: "circle",
            centerPosition: [2, 2],
            radius: 1,
          },
        ],
        diagnostics: [],
      },
    ];
    let session = addProjectedLineReference(
      withSketchSnapScale(
        createNewSketchSessionFromSupport(
          {
            kind: "construction",
            constructionId: "construction_plane-xy",
          },
          OCC_KERNEL_SETTINGS,
        ),
        SPEC_SKETCH_UNITS_PER_PIXEL,
      ),
      projectedReferences,
    );

    session = beginSketchTool(session, "circle");
    session = startSketchDraw(session, [2.03, 2.02]);
    session = updateSketchPointer(session, [3, 2]);
    session = acceptSketchDraw(session, [3, 2]);

    expect(
      session.definition.constraints.some(
        (constraint) => constraint.kind === "concentricProjectedCurve",
      ),
      "Accepted projected center snap while drawing a circle should append a durable concentric projected constraint.",
    ).toBeTruthy();
    expect(
      session.definition.entities.length,
      "Projected concentric snapping should only author the requested local circle.",
    ).toBe(1);
  }

  function testProjectedPointCenterSnapCommitsDerivedReferenceConstraint() {
    const projectedReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: "ref_projected_vertex",
        status: "projected",
        geometry: [
          {
            geometryId: "projected_geometry_vertex",
            kind: "point",
            position: [2, 2],
          },
        ],
        diagnostics: [],
      },
    ];
    let session = addProjectedLineReference(
      withSketchSnapScale(
        createNewSketchSessionFromSupport(
          {
            kind: "construction",
            constructionId: "construction_plane-xy",
          },
          OCC_KERNEL_SETTINGS,
        ),
        SPEC_SKETCH_UNITS_PER_PIXEL,
      ),
      projectedReferences,
    );

    session = beginSketchTool(session, "circle");
    session = startSketchDraw(session, [2.03, 2.02]);
    session = updateSketchPointer(session, [3, 2]);
    session = acceptSketchDraw(session, [3, 2]);

    expect(
      session.definition.constraints.some(
        (constraint) => constraint.kind === "coincidentProjectedPoint",
      ),
      "Accepted projected point center snap while drawing a circle should constrain the circle center to the projected point.",
    ).toBeTruthy();
    expect(
      session.definition.entities.length,
      "Projected point center snapping should only author the requested local circle.",
    ).toBe(1);
  }

  function testSketchDatumSnapsCommitDerivedReferenceConstraints() {
    let originSession = withSketchSnapScale(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    );
    originSession = beginSketchTool(originSession, "line");
    originSession = startSketchDraw(originSession, [0.04, 0.03]);
    expect(
      originSession.activeInference?.candidate?.kind,
      "Starting near the sketch origin should activate datum-origin snap.",
    ).toBe("endpoint");
    assertClosePoint(
      originSession.pointerDownPoint,
      [0, 0],
      "Line start should snap to the exact sketch origin.",
    );
    originSession = updateSketchPointer(originSession, [2, 1]);
    originSession = acceptSketchDraw(originSession, [2, 1]);

    const originConstraint = originSession.definition.constraints.find(
      (constraint) =>
        constraint.kind === "coincidentProjectedPoint" &&
        constraint.projectedPoint.kind === "sketchDatum" &&
        constraint.projectedPoint.datum === "origin",
    );
    expect(
      originConstraint,
      "Accepted datum-origin snap should constrain the authored endpoint to the sketch origin.",
    ).toBeTruthy();

    // T13-D19: an exact origin or axis placement is the same snap at distance
    // 0 and authors the same constraint (shown == authored).
    let exactSession = withSketchSnapScale(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    );
    exactSession = beginSketchTool(exactSession, "line");
    exactSession = startSketchDraw(exactSession, [0, 0]);
    expect(
      exactSession.activeInference?.candidate?.distance,
      "premise: distance 0",
    ).toBe(0);
    expect(
      exactSession.activeInference?.candidate?.sources,
      "premise: the exact origin snap is shown",
    ).toEqual([
      { kind: "sketchDatum", datumId: "origin", geometryKind: "point" },
    ]);
    exactSession = acceptSketchDraw(exactSession, [3, 2]);
    const exactLine = exactSession.definition.entities.at(-1);
    expect(exactLine?.kind).toBe("lineSegment");
    expect(
      exactSession.definition.constraints.map((constraint) =>
        constraint.kind === "coincidentProjectedPoint"
          ? [
              constraint.kind,
              constraint.point.pointId,
              constraint.projectedPoint,
            ]
          : [constraint.kind],
      ),
      "An exact origin snap authors the origin coincidence at distance 0.",
    ).toEqual([
      [
        "coincidentProjectedPoint",
        exactLine?.kind === "lineSegment" ? exactLine.startPointId : null,
        { kind: "sketchDatum", datum: "origin" },
      ],
    ]);

    let axisSession = withSketchSnapScale(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    );
    axisSession = beginSketchTool(axisSession, "line");
    axisSession = startSketchDraw(axisSession, [2, 1]);
    axisSession = updateSketchPointer(axisSession, [4, 0.04]);
    expect(
      axisSession.activeInference?.candidate?.kind,
      "Moving near a sketch datum axis should activate an on-axis snap.",
    ).toBe("nearestOnLine");
    assertClosePoint(
      axisSession.livePoint,
      [4, 0],
      "Line endpoint should snap onto the X datum axis.",
    );
    axisSession = acceptSketchDraw(axisSession, [4, 0.04]);

    const axisConstraint = axisSession.definition.constraints.find(
      (constraint) =>
        constraint.kind === "pointOnProjectedCurve" &&
        constraint.projectedCurve.kind === "sketchDatum" &&
        constraint.projectedCurve.datum === "xAxis",
    );
    expect(
      axisConstraint,
      "Accepted datum-axis snap should constrain the authored endpoint onto the sketch axis.",
    ).toBeTruthy();

    let exactAxisSession = withSketchSnapScale(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    );
    exactAxisSession = beginSketchTool(exactAxisSession, "line");
    exactAxisSession = startSketchDraw(exactAxisSession, [2, 1]);
    exactAxisSession = acceptSketchDraw(exactAxisSession, [4, 0]);
    const exactAxisLine = exactAxisSession.definition.entities.at(-1);
    expect(
      exactAxisSession.definition.constraints.map((constraint) =>
        constraint.kind === "pointOnProjectedCurve"
          ? [
              constraint.kind,
              constraint.point.pointId,
              constraint.projectedCurve,
            ]
          : [constraint.kind],
      ),
      "An exact X-axis snap authors the point-on-axis constraint at distance 0.",
    ).toEqual([
      [
        "pointOnProjectedCurve",
        exactAxisLine?.kind === "lineSegment" ? exactAxisLine.endPointId : null,
        { kind: "sketchDatum", datum: "xAxis" },
      ],
    ]);
  }

  function testProjectedPerpendicularAndTangentSnapsCommitDerivedReferenceConstraints() {
    const projectedLineReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: "ref_projected_perpendicular_edge",
        status: "projected",
        geometry: [
          {
            geometryId: "projected_geometry_perpendicular_edge",
            kind: "lineSegment",
            startPosition: [1, -1],
            endPosition: [1, 2],
          },
        ],
        diagnostics: [],
      },
    ];
    let perpendicularSession = addProjectedLineReference(
      withSketchSnapScale(
        createNewSketchSessionFromSupport(
          {
            kind: "construction",
            constructionId: "construction_plane-xy",
          },
          OCC_KERNEL_SETTINGS,
        ),
        SPEC_SKETCH_UNITS_PER_PIXEL,
      ),
      projectedLineReferences,
    );

    // Off the X axis: the projected line crosses it at (1, 0), and an
    // intersection outranks a perpendicular foot (T13-D14).
    perpendicularSession = beginSketchTool(perpendicularSession, "line");
    perpendicularSession = startSketchDraw(perpendicularSession, [0.5, 1]);
    perpendicularSession = updateSketchPointer(perpendicularSession, [1, 1]);
    expect(
      perpendicularSession.activeInference?.candidate?.kind,
      "Projected line should provide a perpendicular-foot snap.",
    ).toBe("perpendicularFoot");
    perpendicularSession = acceptSketchDraw(perpendicularSession, [1, 1]);

    expect(
      perpendicularSession.definition.constraints.some(
        (constraint) => constraint.kind === "perpendicularProjectedLine",
      ),
      "Accepted projected perpendicular snap should append a durable perpendicular projected constraint.",
    ).toBeTruthy();
    expect(
      perpendicularSession.definition.constraints.some(
        (constraint) => constraint.kind === "pointOnProjectedCurve",
      ),
      "Accepted projected perpendicular snap should keep the foot point on the projected line.",
    ).toBeTruthy();

    const projectedCircleReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: "ref_projected_tangent_circle",
        status: "projected",
        geometry: [
          {
            geometryId: "projected_geometry_tangent_circle",
            kind: "circle",
            centerPosition: [0, 0],
            radius: 1,
          },
        ],
        diagnostics: [],
      },
    ];
    let tangentSession = addProjectedLineReference(
      withSketchSnapScale(
        createNewSketchSessionFromSupport(
          {
            kind: "construction",
            constructionId: "construction_plane-xy",
          },
          OCC_KERNEL_SETTINGS,
        ),
        SPEC_SKETCH_UNITS_PER_PIXEL,
      ),
      projectedCircleReferences,
    );

    tangentSession = beginSketchTool(tangentSession, "line");
    tangentSession = startSketchDraw(tangentSession, [0, 3]);
    tangentSession = updateSketchPointer(
      tangentSession,
      [0.9428090415820634, 0.33333333333333337],
    );
    expect(
      tangentSession.activeInference?.candidate?.kind,
      "Projected circle should provide a tangent snap.",
    ).toBe("tangent");
    tangentSession = acceptSketchDraw(
      tangentSession,
      [0.9428090415820634, 0.33333333333333337],
    );

    expect(
      tangentSession.definition.constraints.some(
        (constraint) => constraint.kind === "tangentProjectedCurve",
      ),
      "Accepted projected tangent snap should append a durable tangent projected constraint.",
    ).toBeTruthy();
    // The start on the Y axis adds a datum point-on-curve (T13-D19); the
    // tangent endpoint's one names the projected circle.
    expect(
      tangentSession.definition.constraints.some(
        (constraint) =>
          constraint.kind === "pointOnProjectedCurve" &&
          constraint.projectedCurve.kind === "projectedGeometry",
      ),
      "Accepted projected tangent snap should keep the tangent endpoint on the projected curve.",
    ).toBeTruthy();
    expect(
      tangentSession.definition.entities.length,
      "Projected tangent snapping should only author the requested local line.",
    ).toBe(1);
  }

  testLocalSnapPreviewAndCommit();
  testEndpointSnapReusesExistingLocalPointIds();
  testProjectedSnapPreviewWithoutCopyingReferenceGeometry();
  testProjectedSnapCommitsReferenceConstraintWithoutCopyingGeometry();
  testBothEndpointsSnappedToSameLineUseUniqueConstraintIds();
  testProjectedMidpointSnapCommitsDerivedReferenceConstraint();
  testProjectedConcentricSnapCommitsDerivedReferenceConstraint();
  testProjectedPointCenterSnapCommitsDerivedReferenceConstraint();
  testSketchDatumSnapsCommitDerivedReferenceConstraints();
  testProjectedPerpendicularAndTangentSnapsCommitDerivedReferenceConstraints();
});
