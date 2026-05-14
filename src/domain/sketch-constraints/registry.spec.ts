import { test, expect } from "vitest";
import {
  beginSketchAnnotationEdit,
  beginSketchTool,
  createNewSketchSession,
  createNewSketchSessionFromSupport,
  deleteSelectedSketchAnnotation,
  getSketchAnnotationDescriptors,
  getSketchToolPresentation,
  patchSketchConstraintValue,
  patchSketchDimensionAnnotationPlacement,
  pinSketchConstraintPreview,
  selectSketchAnnotation,
  selectSketchConstraintTarget,
  startSketchDraw,
  acceptSketchDraw,
  updateSketchReferenceProjection,
  updateSketchPointer,
} from "@/domain/editor/sketch-session";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import { toolIconAssetFileNames } from "@/core/tools/tool-icons";
import {
  getSketchConstraintDefinition,
  getRegisteredSketchConstraintDefinitions,
  selectPointToPointDimensionReference,
} from "@/core/sketch-constraints/registry";
import {
  getToolById,
  getToolbarSectionsForMode,
  searchToolDefinitions,
} from "@/core/tools/tool-registry";
import { mapSketchPointToWorkspaceWorld } from "@/core/workspace/sketch-plane-mapping";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";

test("src/domain/sketch-constraints/registry.spec.ts", async () => {
  function createSessionWithTwoLines() {
    let session = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });

    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [10, 1]);

    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 5]);
    session = acceptSketchDraw(session, [10, 6]);

    return session;
  }

  function createSessionWithTwoCircles() {
    let session = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });

    session = beginSketchTool(session, "circle");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 0]);

    session = beginSketchTool(session, "circle");
    session = startSketchDraw(session, [10, 0]);
    session = acceptSketchDraw(session, [12, 0]);

    return session;
  }

  function createSessionWithLineAndCircle() {
    let session = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });

    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [1, 4]);
    session = acceptSketchDraw(session, [5, 4]);

    session = beginSketchTool(session, "circle");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 0]);

    return session;
  }

  function drawSketchTool(
    toolId: Parameters<typeof beginSketchTool>[1],
    points: readonly [number, number][],
  ) {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport({
        kind: "construction",
        constructionId: "construction_plane-xy",
      }),
      toolId,
    );
    session = startSketchDraw(session, points[0]!);
    for (const point of points.slice(1)) {
      session = acceptSketchDraw(session, point);
    }

    return session;
  }

  function addProjectedReference(
    session: ReturnType<typeof createNewSketchSessionFromSupport>,
    projectedReference: ProjectedSketchReferenceRecord,
  ) {
    const definitionWithReference = {
      ...session.definition,
      referenceIds: [projectedReference.referenceId],
      references: [
        {
          referenceId: projectedReference.referenceId,
          kind: "modelReference",
          label: "Projected reference",
          source: { kind: "edge", bodyId: "body_1", edgeId: "edge_1" },
          projectionMode: "projectAlongPlaneNormal",
        },
      ],
    } as typeof session.definition;

    return {
      ...updateSketchReferenceProjection(session, [projectedReference], []),
      definition: definitionWithReference,
      fullDefinition: definitionWithReference,
    };
  }

  function testToolbarDefinitionsExposeConstraintFamilies() {
    const dimensionTool = getToolById("dimension");
    expect(
      "dropdown" in dimensionTool && Boolean(dimensionTool.dropdown),
      "Dimension tool should expose a dropdown family.",
    ).toBeTruthy();
    expect(
      JSON.stringify(dimensionTool.dropdown?.variantIds),
      "Dimension dropdown should expose the supported dimensional authoring variants.",
    ).toBe(
      JSON.stringify([
        "dimensionDistance",
        "dimensionHorizontal",
        "dimensionVertical",
        "dimensionRadius",
      ]),
    );

    const newConstraintTools = {
      constraintCollinear: "sketch-collinear.svg",
      constraintHorizontal: "sketch-horizontal.svg",
      constraintVertical: "sketch-vertical.svg",
      constraintConcentric: "sketch-concentric.svg",
      constraintMidpoint: "sketch-midpoint.svg",
      constraintNormal: "sketch-normal.svg",
      constraintPierce: "sketch-pierce.svg",
      constraintSymmetric: "sketch-symmetric.svg",
      constraintFix: "sketch-fix.svg",
    } as const;
    const sketchConstraintSection = getToolbarSectionsForMode("sketch").find(
      (section) => section.id === "constraints",
    );
    const partToolIds = getToolbarSectionsForMode("part").flatMap(
      (section) => section.toolIds,
    );
    const registeredConstraintIds = new Set(
      getRegisteredSketchConstraintDefinitions().map(
        (definition) => definition.metadata.id,
      ),
    );

    for (const [toolId, asset] of Object.entries(newConstraintTools)) {
      const tool = getToolById(toolId as keyof typeof newConstraintTools);
      expect(
        tool.group,
        `${toolId} should register in the sketch constraint group.`,
      ).toBe("constraints");
      expect(
        tool.modes.length === 1 && tool.modes[0] === "sketch",
        `${toolId} should be sketch-only.`,
      ).toBeTruthy();
      expect(tool.icon, `${toolId} should use a stable matching icon id.`).toBe(
        toolId,
      );
      expect(
        toolIconAssetFileNames[tool.icon],
        `${toolId} should map to ${asset}.`,
      ).toBe(asset);
      expect(
        sketchConstraintSection?.toolIds.includes(tool.id),
        `${toolId} should be exposed in the sketch toolbar.`,
      ).toBeTruthy();
      expect(
        partToolIds.includes(tool.id),
        `${toolId} should not be exposed in part mode.`,
      ).toBeFalsy();
      expect(
        registeredConstraintIds.has(tool.id),
        `${toolId} should have sketch constraint behavior registered.`,
      ).toBeTruthy();
    }
    expect(
      searchToolDefinitions("collinear").some(
        (tool) => tool.id === "constraintCollinear",
      ),
      "Tool search should expose the Collinear sketch constraint.",
    ).toBeTruthy();
  }

  function testHorizontalAndVerticalAuthoringCommitDurableConstraints() {
    let horizontalSession = createSessionWithTwoLines();
    const [horizontalLineId] = horizontalSession.definition.entityIds;
    expect(
      horizontalLineId,
      "Expected a local line for horizontal authoring.",
    ).toBeTruthy();

    horizontalSession = beginSketchTool(
      horizontalSession,
      "constraintHorizontal",
    );
    horizontalSession = selectSketchConstraintTarget(horizontalSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: horizontalLineId,
    });

    const horizontalConstraint =
      horizontalSession.definition.constraints.at(-1);
    expect(
      horizontalConstraint?.kind,
      "Horizontal should commit a durable horizontal constraint.",
    ).toBe("horizontal");
    expect(
      horizontalConstraint.entityId,
      "Horizontal should target the selected line entity.",
    ).toBe(horizontalLineId);
    expect(
      horizontalSession.definition.dimensions.length,
      "Horizontal should not append a dimension record.",
    ).toBe(0);
    expect(
      getSketchAnnotationDescriptors(horizontalSession).some(
        (entry) => entry.glyphKind === "constraintHorizontal",
      ),
      "Horizontal constraints should expose the horizontal glyph in committed annotations.",
    ).toBeTruthy();

    let verticalSession = createSessionWithTwoLines();
    const [, verticalLineId] = verticalSession.definition.entityIds;
    expect(
      verticalLineId,
      "Expected a second local line for vertical authoring.",
    ).toBeTruthy();

    verticalSession = beginSketchTool(verticalSession, "constraintVertical");
    verticalSession = selectSketchConstraintTarget(verticalSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: verticalLineId,
    });

    const verticalConstraint = verticalSession.definition.constraints.at(-1);
    expect(
      verticalConstraint?.kind,
      "Vertical should commit a durable vertical constraint.",
    ).toBe("vertical");
    expect(
      verticalConstraint.entityId,
      "Vertical should target the selected line entity.",
    ).toBe(verticalLineId);
    expect(
      verticalSession.definition.dimensions.length,
      "Vertical should not append a dimension record.",
    ).toBe(0);
    expect(
      getSketchAnnotationDescriptors(verticalSession).some(
        (entry) => entry.glyphKind === "constraintVertical",
      ),
      "Vertical constraints should expose the vertical glyph in committed annotations.",
    ).toBeTruthy();
  }

  function testHorizontalAndVerticalRejectUnsupportedTargets() {
    let session = createSessionWithLineAndCircle();
    const circle = session.definition.entities.find(
      (entity) => entity.kind === "circle",
    );
    expect(
      circle?.kind,
      "Expected a circle target for unsupported constraint picks.",
    ).toBe("circle");
    const initialConstraintCount = session.definition.constraints.length;
    const initialDimensionCount = session.definition.dimensions.length;

    session = beginSketchTool(session, "constraintHorizontal");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: circle.entityId,
    });

    expect(
      session.definition.constraints.length,
      "Unsupported horizontal targets should not commit partial constraints.",
    ).toBe(initialConstraintCount);
    expect(
      session.definition.dimensions.length,
      "Unsupported horizontal targets should not append dimensions.",
    ).toBe(initialDimensionCount);
    expect(
      session.constraintAuthoring?.selectedTargets.length,
      "Unsupported horizontal targets should not stay selected.",
    ).toBe(0);
    expect(
      getSketchToolPresentation(session)?.validation?.[0]?.message,
      "Unsupported horizontal targets should surface validation feedback.",
    ).toBe("Horizontal needs the supported target combination.");

    session = beginSketchTool(session, "constraintVertical");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: circle.entityId,
    });

    expect(
      session.definition.constraints.length,
      "Unsupported vertical targets should not commit partial constraints.",
    ).toBe(initialConstraintCount);
    expect(
      session.definition.dimensions.length,
      "Unsupported vertical targets should not append dimensions.",
    ).toBe(initialDimensionCount);
    expect(
      session.constraintAuthoring?.selectedTargets.length,
      "Unsupported vertical targets should not stay selected.",
    ).toBe(0);
    expect(
      getSketchToolPresentation(session)?.validation?.[0]?.message,
      "Unsupported vertical targets should surface validation feedback.",
    ).toBe("Vertical needs the supported target combination.");
  }

  function testHorizontalAndVerticalUseSketchPlaneAxes() {
    let horizontalSession = createNewSketchSession(
      createStandardPlaneDefinition("yz"),
    );
    horizontalSession = beginSketchTool(horizontalSession, "line");
    horizontalSession = startSketchDraw(horizontalSession, [2, 1]);
    horizontalSession = acceptSketchDraw(horizontalSession, [5, 4]);

    const [horizontalLineId] = horizontalSession.definition.entityIds;
    expect(
      horizontalLineId,
      "Expected a local line on the YZ plane.",
    ).toBeTruthy();

    horizontalSession = beginSketchTool(
      horizontalSession,
      "constraintHorizontal",
    );
    horizontalSession = selectSketchConstraintTarget(horizontalSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: horizontalLineId,
    });

    const horizontalLine = horizontalSession.definition.entities.find(
      (entity) => entity.entityId === horizontalLineId,
    );
    expect(
      horizontalLine?.kind,
      "Expected the authored horizontal line to remain available.",
    ).toBe("lineSegment");
    const horizontalStart = horizontalSession.definition.points.find(
      (point) => point.pointId === horizontalLine.startPointId,
    );
    const horizontalEnd = horizontalSession.definition.points.find(
      (point) => point.pointId === horizontalLine.endPointId,
    );
    expect(
      horizontalStart && horizontalEnd,
      "Expected solved horizontal line endpoints.",
    ).toBeTruthy();

    const horizontalStartWorld = mapSketchPointToWorkspaceWorld(
      horizontalSession.plane,
      horizontalStart.position,
    );
    const horizontalEndWorld = mapSketchPointToWorkspaceWorld(
      horizontalSession.plane,
      horizontalEnd.position,
    );
    expect(
      Math.abs(horizontalEnd.position[1] - horizontalStart.position[1]) < 1e-6,
      "Horizontal should solve in local sketch coordinates.",
    ).toBeTruthy();
    expect(
      Math.abs(horizontalEndWorld[2] - horizontalStartWorld[2]) < 1e-6 &&
        Math.abs(horizontalEndWorld[1] - horizontalStartWorld[1]) > 1e-3,
      "Horizontal on the YZ plane should align to world Y, not reinterpret against world X.",
    ).toBeTruthy();

    let verticalSession = createNewSketchSession(
      createStandardPlaneDefinition("xz"),
    );
    verticalSession = beginSketchTool(verticalSession, "line");
    verticalSession = startSketchDraw(verticalSession, [1, 2]);
    verticalSession = acceptSketchDraw(verticalSession, [4, 5]);

    const [verticalLineId] = verticalSession.definition.entityIds;
    expect(
      verticalLineId,
      "Expected a local line on the XZ plane.",
    ).toBeTruthy();

    verticalSession = beginSketchTool(verticalSession, "constraintVertical");
    verticalSession = selectSketchConstraintTarget(verticalSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: verticalLineId,
    });

    const verticalLine = verticalSession.definition.entities.find(
      (entity) => entity.entityId === verticalLineId,
    );
    expect(
      verticalLine?.kind,
      "Expected the authored vertical line to remain available.",
    ).toBe("lineSegment");
    const verticalStart = verticalSession.definition.points.find(
      (point) => point.pointId === verticalLine.startPointId,
    );
    const verticalEnd = verticalSession.definition.points.find(
      (point) => point.pointId === verticalLine.endPointId,
    );
    expect(
      verticalStart && verticalEnd,
      "Expected solved vertical line endpoints.",
    ).toBeTruthy();

    const verticalStartWorld = mapSketchPointToWorkspaceWorld(
      verticalSession.plane,
      verticalStart.position,
    );
    const verticalEndWorld = mapSketchPointToWorkspaceWorld(
      verticalSession.plane,
      verticalEnd.position,
    );
    expect(
      Math.abs(verticalEnd.position[0] - verticalStart.position[0]) < 1e-6,
      "Vertical should solve in local sketch coordinates.",
    ).toBeTruthy();
    expect(
      Math.abs(verticalEndWorld[0] - verticalStartWorld[0]) < 1e-6 &&
        Math.abs(verticalEndWorld[2] - verticalStartWorld[2]) > 1e-3 &&
        Math.abs(verticalEndWorld[1] - verticalStartWorld[1]) < 1e-6,
      "Vertical on the XZ plane should align to world Z, not reinterpret against world Y.",
    ).toBeTruthy();
  }

  function testConcentricAuthoringCommitsLocalAndProjectedConstraints() {
    let localSession = createSessionWithTwoCircles();
    const [firstCircle, secondCircle] = localSession.definition.entities.filter(
      (entity) => entity.kind === "circle",
    );
    expect(
      firstCircle?.kind === "circle" && secondCircle?.kind === "circle",
      "Expected two local circles.",
    ).toBeTruthy();

    localSession = beginSketchTool(localSession, "constraintConcentric");
    localSession = selectSketchConstraintTarget(
      localSession,
      firstCircle.target,
    );
    localSession = selectSketchConstraintTarget(
      localSession,
      secondCircle.target,
    );

    expect(
      localSession.definition.constraints[0]?.kind,
      "Concentric should commit a local durable constraint.",
    ).toBe("concentric");
    const localAnnotation = getSketchAnnotationDescriptors(localSession).find(
      (entry) => entry.target.kind === "constraint",
    );
    expect(
      localAnnotation?.glyphKind,
      "Concentric constraints should expose a concentric glyph.",
    ).toBe("constraintConcentric");

    let projectedSession = createSessionWithTwoCircles();
    const projectedCircle = projectedSession.definition.entities.find(
      (entity) => entity.kind === "circle",
    );
    expect(
      projectedCircle?.kind,
      "Expected a local circle for projected concentric authoring.",
    ).toBe("circle");
    projectedSession = addProjectedReference(projectedSession, {
      referenceId: "ref_circle",
      status: "projected",
      geometry: [
        {
          geometryId: "projected_geometry_circle",
          kind: "circle",
          centerPosition: [6, 3],
          radius: 2,
        },
      ],
      diagnostics: [],
    });

    projectedSession = beginSketchTool(
      projectedSession,
      "constraintConcentric",
    );
    projectedSession = selectSketchConstraintTarget(
      projectedSession,
      projectedCircle.target,
    );
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_circle",
      geometryId: "projected_geometry_circle",
      geometryKind: "circle",
    });

    const projectedConstraint = projectedSession.definition.constraints[0];
    expect(
      projectedConstraint?.kind,
      "Concentric should commit a projected-curve durable constraint when one target is projected.",
    ).toBe("concentricProjectedCurve");
    const center = projectedSession.definition.points.find(
      (point) => point.pointId === projectedCircle.centerPointId,
    );
    expect(
      center &&
        Math.hypot(center.position[0] - 6, center.position[1] - 3) < 1e-4,
      "Projected concentric should solve the local center onto the projected center.",
    ).toBeTruthy();
  }

  function testMidpointAuthoringCommitsLocalAndProjectedConstraints() {
    let localSession = createSessionWithTwoLines();
    const [lineId] = localSession.definition.entityIds;
    const pointId = localSession.definition.pointIds[2];

    localSession = beginSketchTool(localSession, "constraintMidpoint");
    localSession = selectSketchConstraintTarget(localSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: pointId!,
    });
    localSession = selectSketchConstraintTarget(localSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: lineId!,
    });

    expect(
      localSession.definition.constraints[0]?.kind,
      "Midpoint should commit a local midpoint constraint.",
    ).toBe("midpoint");
    expect(
      getSketchAnnotationDescriptors(localSession)[0]?.glyphKind,
      "Midpoint should expose a midpoint glyph.",
    ).toBe("constraintMidpoint");

    let projectedSession = createSessionWithTwoLines();
    const projectedPointId = projectedSession.definition.pointIds[0];
    projectedSession = addProjectedReference(projectedSession, {
      referenceId: "ref_line_midpoint",
      status: "projected",
      geometry: [
        {
          geometryId: "projected_geometry_line_midpoint",
          kind: "lineSegment",
          startPosition: [2, 2],
          endPosition: [8, 2],
        },
      ],
      diagnostics: [],
    });

    projectedSession = beginSketchTool(projectedSession, "constraintMidpoint");
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_line_midpoint",
      geometryId: "projected_geometry_line_midpoint",
      geometryKind: "lineSegment",
    });
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: projectedPointId!,
    });

    expect(
      projectedSession.definition.constraints[0]?.kind,
      "Midpoint should commit a projected-line midpoint constraint.",
    ).toBe("midpointProjectedLine");
  }

  function testPierceAuthoringCommitsLocalAndProjectedConstraints() {
    let localSession = createSessionWithTwoLines();
    const [lineId] = localSession.definition.entityIds;
    const pointId = localSession.definition.pointIds[2];

    localSession = beginSketchTool(localSession, "constraintPierce");
    localSession = selectSketchConstraintTarget(localSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: lineId!,
    });
    localSession = selectSketchConstraintTarget(localSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: pointId!,
    });

    expect(
      localSession.definition.constraints[0]?.kind,
      "Pierce should commit a local point-on-curve constraint.",
    ).toBe("pointOnCurve");
    expect(
      getSketchAnnotationDescriptors(localSession)[0]?.glyphKind,
      "Pierce should expose a pierce glyph.",
    ).toBe("constraintPierce");

    let projectedSession = createSessionWithTwoLines();
    const projectedPointId = projectedSession.definition.pointIds[0];
    projectedSession = addProjectedReference(projectedSession, {
      referenceId: "ref_pierce",
      status: "projected",
      geometry: [
        {
          geometryId: "projected_geometry_pierce",
          kind: "circle",
          centerPosition: [0, 0],
          radius: 3,
        },
      ],
      diagnostics: [],
    });

    projectedSession = beginSketchTool(projectedSession, "constraintPierce");
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: projectedPointId!,
    });
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_pierce",
      geometryId: "projected_geometry_pierce",
      geometryKind: "circle",
    });

    expect(
      projectedSession.definition.constraints[0]?.kind,
      "Pierce should commit a projected point-on-curve constraint.",
    ).toBe("pointOnProjectedCurve");
  }

  function testCollinearAuthoringCommitsLocalProjectedAndMultiTargetConstraints() {
    let localSession = createSessionWithTwoLines();
    const [referenceLineId, drivenLineId] = localSession.definition.entityIds;
    expect(
      referenceLineId && drivenLineId,
      "Expected two local lines for collinear authoring.",
    ).toBeTruthy();

    localSession = beginSketchTool(localSession, "constraintCollinear");
    localSession = selectSketchConstraintTarget(localSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: referenceLineId!,
    });
    localSession = selectSketchConstraintTarget(localSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: drivenLineId!,
    });

    const localConstraint = localSession.definition.constraints.at(-1);
    expect(
      localConstraint?.kind,
      "Collinear should commit a durable local collinear constraint.",
    ).toBe("collinear");
    expect(
      localConstraint?.kind === "collinear" &&
        localConstraint.target.kind === "localEntity" &&
        localConstraint.target.entityId === drivenLineId &&
        localConstraint.line.entityId === referenceLineId,
      "Line-line Collinear should preserve selection order with the first line as reference.",
    ).toBeTruthy();
    expect(
      getSketchAnnotationDescriptors(localSession).some(
        (annotation) => annotation.glyphKind === "constraintCollinear",
      ),
      "Collinear should expose a committed collinear annotation glyph.",
    ).toBeTruthy();

    let pointLineSession = createSessionWithTwoLines();
    const pointId = pointLineSession.definition.pointIds[2];
    const lineId = pointLineSession.definition.entityIds[0];
    expect(
      pointId && lineId,
      "Expected a point and line for point-line collinear authoring.",
    ).toBeTruthy();
    pointLineSession = beginSketchTool(pointLineSession, "constraintCollinear");
    pointLineSession = selectSketchConstraintTarget(pointLineSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: pointId!,
    });
    pointLineSession = selectSketchConstraintTarget(pointLineSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: lineId!,
    });

    const pointConstraint = pointLineSession.definition.constraints.at(-1);
    expect(
      pointConstraint?.kind === "collinear" &&
        pointConstraint.target.kind === "localPoint" &&
        pointConstraint.target.pointId === pointId &&
        pointConstraint.line.entityId === lineId,
      "Point-line Collinear should commit with the editable point as the driven target regardless of selection order.",
    ).toBeTruthy();

    let projectedSession = createSessionWithTwoLines();
    const projectedLineId = projectedSession.definition.entityIds[0];
    projectedSession = addProjectedReference(projectedSession, {
      referenceId: "ref_collinear_line",
      status: "projected",
      geometry: [
        {
          geometryId: "projected_geometry_collinear_line",
          kind: "lineSegment",
          startPosition: [0, 3],
          endPosition: [10, 3],
        },
      ],
      diagnostics: [],
    });

    projectedSession = beginSketchTool(projectedSession, "constraintCollinear");
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: projectedLineId!,
    });
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_collinear_line",
      geometryId: "projected_geometry_collinear_line",
      geometryKind: "lineSegment",
    });

    const projectedConstraint = projectedSession.definition.constraints.at(-1);
    expect(
      projectedConstraint?.kind === "collinearProjectedLine" &&
        projectedConstraint.target.kind === "localEntity" &&
        projectedConstraint.projectedLine.kind === "projectedGeometry",
      "Collinear should commit editable local targets against a read-only projected line in either selection order.",
    ).toBeTruthy();

    const definition = getSketchConstraintDefinition("constraintCollinear");
    const projectedTarget = definition.resolveTarget(
      projectedSession.definition,
      {
        kind: "projectedReferenceGeometry",
        referenceId: "ref_collinear_line",
        geometryId: "projected_geometry_collinear_line",
        geometryKind: "lineSegment",
      },
      projectedSession.projectedReferences,
    );
    const localLineTarget = definition.resolveTarget(
      projectedSession.definition,
      {
        kind: "sketchEntity",
        sketchId: "sketch_draft",
        entityId: projectedLineId!,
      },
      projectedSession.projectedReferences,
    );
    const localPointTarget = definition.resolveTarget(
      projectedSession.definition,
      {
        kind: "sketchPoint",
        sketchId: "sketch_draft",
        pointId: projectedSession.definition.pointIds[2]!,
      },
      projectedSession.projectedReferences,
    );
    expect(
      projectedTarget && localLineTarget && localPointTarget,
      "Collinear registry should resolve projected lines, local lines, and local points.",
    ).toBeTruthy();

    const multi = definition.createCommitContribution({
      sequence: 42,
      selectedTargets: [projectedTarget!, localPointTarget!, localLineTarget!],
      pointer: null,
      value: null,
      annotationPlacement: null,
      createConstraintId: (suffix) => `constraint_42_${suffix}` as const,
      createDimensionId: (suffix) => `dimension_42_${suffix}` as const,
    });
    expect(
      multi.constraints?.length === 2 &&
        multi.constraints.every(
          (constraint) => constraint.kind === "collinearProjectedLine",
        ),
      "Collinear commit contribution should support multiple editable targets against the first projected reference line.",
    ).toBeTruthy();
  }

  function testCollinearRejectsUnsupportedDegenerateAndReadonlyOnlyTargets() {
    let unsupportedSession = createSessionWithLineAndCircle();
    const circle = unsupportedSession.definition.entities.find(
      (entity) => entity.kind === "circle",
    );
    expect(
      circle?.kind,
      "Expected a circle target for unsupported collinear picks.",
    ).toBe("circle");
    const unsupportedInitialConstraintCount =
      unsupportedSession.definition.constraints.length;
    unsupportedSession = beginSketchTool(
      unsupportedSession,
      "constraintCollinear",
    );
    unsupportedSession = selectSketchConstraintTarget(
      unsupportedSession,
      circle.target,
    );
    expect(
      unsupportedSession.definition.constraints.length,
      "Unsupported Collinear targets should not commit constraints.",
    ).toBe(unsupportedInitialConstraintCount);
    expect(
      getSketchToolPresentation(unsupportedSession)?.validation?.[0]?.message,
      "Unsupported Collinear targets should surface validation feedback.",
    ).toBe("Collinear needs the supported target combination.");

    let readonlySession = createSessionWithTwoLines();
    const readonlyInitialConstraintCount =
      readonlySession.definition.constraints.length;
    readonlySession = addProjectedReference(readonlySession, {
      referenceId: "ref_readonly_collinear",
      status: "projected",
      geometry: [
        {
          geometryId: "projected_geometry_readonly_collinear",
          kind: "lineSegment",
          startPosition: [0, 0],
          endPosition: [10, 0],
        },
      ],
      diagnostics: [],
    });
    readonlySession = beginSketchTool(readonlySession, "constraintCollinear");
    readonlySession = selectSketchConstraintTarget(readonlySession, {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_readonly_collinear",
      geometryId: "projected_geometry_readonly_collinear",
      geometryKind: "lineSegment",
    });
    readonlySession = selectSketchConstraintTarget(readonlySession, {
      kind: "sketchDatumReference",
      sketchId: "sketch_draft",
      datumId: "xAxis",
      geometryKind: "lineSegment",
    });
    expect(
      readonlySession.definition.constraints.length,
      "Readonly-only Collinear targets should not commit constraints.",
    ).toBe(readonlyInitialConstraintCount);
    expect(
      readonlySession.validationMessage?.includes("Collinear needs"),
      "Readonly-only Collinear should report validation feedback.",
    ).toBeTruthy();

    let degenerateSession = createSessionWithTwoLines();
    const firstLine = degenerateSession.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    );
    expect(
      firstLine?.kind,
      "Expected a line fixture for degenerate collinear validation.",
    ).toBe("lineSegment");
    const start = degenerateSession.definition.points.find(
      (point) => point.pointId === firstLine.startPointId,
    );
    expect(
      start,
      "Expected a start point for degenerate collinear validation.",
    ).toBeTruthy();
    const degenerateDefinition = {
      ...degenerateSession.definition,
      points: degenerateSession.definition.points.map((point) =>
        point.pointId === firstLine.endPointId
          ? { ...point, position: start!.position }
          : point,
      ),
    };
    degenerateSession = {
      ...degenerateSession,
      definition: degenerateDefinition,
      fullDefinition: degenerateDefinition,
    };
    degenerateSession = beginSketchTool(degenerateSession, "point");
    degenerateSession = startSketchDraw(degenerateSession, [1, 1]);
    degenerateSession = acceptSketchDraw(degenerateSession, [1, 1]);

    const degenerateLine = degenerateSession.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    );
    const standalonePoint = degenerateSession.definition.entities.find(
      (entity) => entity.kind === "point",
    );
    expect(
      degenerateLine?.kind === "lineSegment" &&
        standalonePoint?.kind === "point",
      "Expected degenerate line and standalone point fixtures.",
    ).toBeTruthy();

    degenerateSession = beginSketchTool(
      degenerateSession,
      "constraintCollinear",
    );
    degenerateSession = selectSketchConstraintTarget(
      degenerateSession,
      degenerateLine.target,
    );
    degenerateSession = selectSketchConstraintTarget(degenerateSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: standalonePoint.pointId,
    });
    expect(
      degenerateSession.definition.constraints.length,
      "Degenerate Collinear references should not commit constraints.",
    ).toBe(0);
    expect(
      degenerateSession.validationMessage?.includes("Collinear needs"),
      "Degenerate Collinear references should report validation feedback.",
    ).toBeTruthy();
  }

  function testFixGeometryCommitsSupportedTargets() {
    let pointSession = createSessionWithTwoLines();
    const pointId = pointSession.definition.pointIds[0];
    pointSession = beginSketchTool(pointSession, "constraintFix");
    pointSession = selectSketchConstraintTarget(pointSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: pointId!,
    });
    expect(
      pointSession.definition.constraints.length,
      "Fixing a point should commit one fix-point constraint.",
    ).toBe(1);
    expect(
      pointSession.definition.constraints[0]?.kind,
      "Point fix should use fixPoint.",
    ).toBe("fixPoint");
    expect(
      getSketchAnnotationDescriptors(pointSession)[0]?.glyphKind,
      "Fix constraints should expose the fixed glyph.",
    ).toBe("constraintFixed");

    let lineSession = createSessionWithTwoLines();
    const lineId = lineSession.definition.entityIds[0];
    lineSession = beginSketchTool(lineSession, "constraintFix");
    lineSession = selectSketchConstraintTarget(lineSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: lineId!,
    });
    expect(
      lineSession.definition.constraints.length,
      "Fixing a line should fix both endpoints.",
    ).toBe(2);
    expect(
      lineSession.definition.constraints.every(
        (constraint) => constraint.kind === "fixPoint",
      ),
      "Line fix should use fixPoint constraints.",
    ).toBeTruthy();

    let circleSession = createSessionWithTwoCircles();
    const circle = circleSession.definition.entities.find(
      (entity) => entity.kind === "circle",
    );
    expect(circle?.kind, "Expected a local circle.").toBe("circle");
    circleSession = beginSketchTool(circleSession, "constraintFix");
    circleSession = selectSketchConstraintTarget(circleSession, circle.target);
    expect(
      circleSession.definition.constraints.length,
      "Fixing a circle should fix its center point.",
    ).toBe(1);
    expect(
      circleSession.definition.dimensions[0]?.kind,
      "Fixing a circle should add a radius dimension for the current size.",
    ).toBe("circleRadius");
  }

  function testNormalAuthoringCommitsValidTargetsAndRejectsInvalidTargets() {
    let session = createSessionWithLineAndCircle();
    const line = session.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    );
    const circle = session.definition.entities.find(
      (entity) => entity.kind === "circle",
    );
    expect(
      line?.kind === "lineSegment" && circle?.kind === "circle",
      "Expected a line and circle for normal authoring.",
    ).toBeTruthy();

    session = beginSketchTool(session, "constraintNormal");
    session = selectSketchConstraintTarget(session, line.target);
    session = selectSketchConstraintTarget(session, circle.target);
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: line.startPointId,
    });

    expect(
      session.definition.constraints.some(
        (constraint) => constraint.kind === "normal",
      ),
      "Normal should commit a local normal constraint.",
    ).toBeTruthy();
    expect(
      getSketchAnnotationDescriptors(session).some(
        (annotation) => annotation.glyphKind === "constraintNormal",
      ),
      "Normal should expose a normal glyph.",
    ).toBeTruthy();

    let invalidSession = createSessionWithTwoCircles();
    const [firstCircle, secondCircle] =
      invalidSession.definition.entities.filter(
        (entity) => entity.kind === "circle",
      );
    expect(
      firstCircle?.kind === "circle" && secondCircle?.kind === "circle",
      "Expected two circles for invalid normal authoring.",
    ).toBeTruthy();
    invalidSession = beginSketchTool(invalidSession, "constraintNormal");
    invalidSession = selectSketchConstraintTarget(
      invalidSession,
      firstCircle.target,
    );
    invalidSession = selectSketchConstraintTarget(
      invalidSession,
      secondCircle.target,
    );
    invalidSession = selectSketchConstraintTarget(invalidSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: invalidSession.definition.pointIds[0]!,
    });

    expect(
      invalidSession.definition.constraints.length,
      "Invalid normal targets should not commit a partial constraint.",
    ).toBe(0);
    expect(
      invalidSession.validationMessage?.includes("Normal needs"),
      "Invalid normal targets should report validation feedback.",
    ).toBeTruthy();
  }

  function testSymmetricAuthoringCommitsLocalAndProjectedAxes() {
    let localSession = createSessionWithTwoLines();
    const [axisId] = localSession.definition.entityIds;
    const pointA = localSession.definition.pointIds[2];
    const pointB = localSession.definition.pointIds[3];

    localSession = beginSketchTool(localSession, "constraintSymmetric");
    localSession = selectSketchConstraintTarget(localSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: pointA!,
    });
    localSession = selectSketchConstraintTarget(localSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: pointB!,
    });
    localSession = selectSketchConstraintTarget(localSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: axisId!,
    });

    expect(
      localSession.definition.constraints[0]?.kind,
      "Symmetric should commit a local-axis constraint.",
    ).toBe("symmetric");
    expect(
      getSketchAnnotationDescriptors(localSession)[0]?.glyphKind,
      "Symmetric should expose a symmetric glyph.",
    ).toBe("constraintSymmetric");

    let projectedSession = createSessionWithTwoLines();
    projectedSession = addProjectedReference(projectedSession, {
      referenceId: "ref_axis",
      status: "projected",
      geometry: [
        {
          geometryId: "projected_geometry_axis",
          kind: "lineSegment",
          startPosition: [0, 0],
          endPosition: [0, 10],
        },
      ],
      diagnostics: [],
    });
    projectedSession = beginSketchTool(projectedSession, "constraintSymmetric");
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_axis",
      geometryId: "projected_geometry_axis",
      geometryKind: "lineSegment",
    });
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: projectedSession.definition.pointIds[0]!,
    });
    projectedSession = selectSketchConstraintTarget(projectedSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: projectedSession.definition.pointIds[1]!,
    });

    expect(
      projectedSession.definition.constraints[0]?.kind,
      "Symmetric should commit a projected-axis constraint.",
    ).toBe("symmetricProjectedLine");
  }

  function testGeometricConstraintAuthoringCommitsDurableRecord() {
    let session = createSessionWithTwoLines();
    const [firstLineId, secondLineId] = session.definition.entityIds;

    session = beginSketchTool(session, "constraintParallel");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: firstLineId!,
    });
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: secondLineId!,
    });

    expect(
      session.definition.constraintIds.length,
      "Parallel authoring should append one durable constraint record.",
    ).toBe(1);
    expect(
      session.constraintAuthoring,
      "Geometric constraints should commit immediately after the final selection.",
    ).toBe(null);
    const annotation = getSketchAnnotationDescriptors(session).find(
      (entry) => entry.target.kind === "constraint",
    );
    expect(
      annotation,
      "Committed geometric constraints should be exposed as durable annotation descriptors.",
    ).toBeTruthy();
    expect(
      annotation.glyphKind,
      "Parallel constraints should expose a distinct glyph kind.",
    ).toBe("constraintParallel");
    expect(
      annotation.anchor.kind,
      "Constraint descriptors should expose a viewport anchor.",
    ).toBe("sketchPoint");
    expect(
      annotation.affectedGeometryRefs.length === 2 &&
        annotation.affectedGeometryRefs.every(
          (target) => target.kind === "sketchEntity",
        ),
      "Constraint descriptors should expose affected sketch geometry refs.",
    ).toBeTruthy();

    session = selectSketchAnnotation(session, annotation.target);
    session = deleteSelectedSketchAnnotation(session);

    expect(
      session.definition.constraintIds.length,
      "Deleting the selected constraint should remove the durable constraint record.",
    ).toBe(0);
  }

  function testProjectedCoincidentAuthoringCommitsTypedOperand() {
    let session = createSessionWithTwoLines();
    const [firstPointId] = session.definition.pointIds;
    session = addProjectedReference(session, {
      referenceId: "ref_point",
      status: "projected",
      geometry: [
        {
          geometryId: "projected_geometry_point",
          kind: "point",
          position: [3, 3],
        },
      ],
      diagnostics: [],
    });

    session = beginSketchTool(session, "constraintCoincident");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: firstPointId!,
    });
    session = selectSketchConstraintTarget(session, {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_point",
      geometryId: "projected_geometry_point",
      geometryKind: "point",
    });

    const constraint = session.definition.constraints[0];
    expect(
      constraint?.kind,
      "Coincident authoring should commit a projected-point constraint through normal target selection.",
    ).toBe("coincidentProjectedPoint");
    expect(
      constraint.projectedPoint.reference.referenceId === "ref_point" &&
        constraint.projectedPoint.reference.geometryId ===
          "projected_geometry_point",
      "Projected-point coincident authoring should store the selected reference geometry operand.",
    ).toBeTruthy();
  }

  function testProjectedCoincidentAuthoringCanConstrainCircleCenter() {
    let session = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });

    session = beginSketchTool(session, "circle");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 0]);
    session = addProjectedReference(session, {
      referenceId: "ref_circle_center",
      status: "projected",
      geometry: [
        {
          geometryId: "projected_geometry_circle_center",
          kind: "point",
          position: [3, 3],
        },
      ],
      diagnostics: [],
    });

    const circle = session.definition.entities.find(
      (entity) => entity.kind === "circle",
    );
    expect(
      circle?.kind,
      "Circle authoring should create a local circle entity.",
    ).toBe("circle");

    session = beginSketchTool(session, "constraintCoincident");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: circle.entityId,
    });
    session = selectSketchConstraintTarget(session, {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_circle_center",
      geometryId: "projected_geometry_circle_center",
      geometryKind: "point",
    });

    const constraint = session.definition.constraints.find(
      (entry) => entry.kind === "coincidentProjectedPoint",
    );
    expect(
      constraint?.kind,
      "Coincident authoring should support selecting a circle and a projected point to constrain the circle center.",
    ).toBe("coincidentProjectedPoint");
    expect(
      constraint.point.pointId,
      "Circle-to-projected-point coincident authoring should target the circle center point.",
    ).toBe(circle.centerPointId);
    const center = session.definition.points.find(
      (point) => point.pointId === circle.centerPointId,
    );
    expect(
      center &&
        Math.hypot(center.position[0] - 3, center.position[1] - 3) < 1e-6,
      "Circle-to-projected-point coincident authoring should solve the circle center onto the projected point immediately.",
    ).toBeTruthy();
  }

  function testCoincidentAuthoringCommitsLocalPointOnCurveOperands() {
    const cases = [
      {
        label: "line",
        createSession: () => createSessionWithTwoLines(),
        selectCurve(
          session: ReturnType<typeof createNewSketchSessionFromSupport>,
        ) {
          return session.definition.entities.find(
            (entity) => entity.kind === "lineSegment",
          )?.entityId;
        },
      },
      {
        label: "circle",
        createSession: () =>
          drawSketchTool("circle", [
            [0, 0],
            [4, 0],
          ]),
        selectCurve(
          session: ReturnType<typeof createNewSketchSessionFromSupport>,
        ) {
          return session.definition.entities.find(
            (entity) => entity.kind === "circle",
          )?.entityId;
        },
      },
      {
        label: "arc",
        createSession: () =>
          drawSketchTool("centerPointArc", [
            [0, 0],
            [4, 0],
            [0, 4],
          ]),
        selectCurve(
          session: ReturnType<typeof createNewSketchSessionFromSupport>,
        ) {
          return session.definition.entities.find(
            (entity) => entity.kind === "arc",
          )?.entityId;
        },
      },
      {
        label: "spline",
        createSession: () =>
          drawSketchTool("spline", [
            [0, 0],
            [2, 3],
            [4, 0],
          ]),
        selectCurve(
          session: ReturnType<typeof createNewSketchSessionFromSupport>,
        ) {
          return session.definition.entities.find(
            (entity) => entity.kind === "spline",
          )?.entityId;
        },
      },
    ];

    for (const testCase of cases) {
      let session = testCase.createSession();
      const targetPointId = session.definition.pointIds.at(-1);
      const curveId = testCase.selectCurve(session);

      expect(
        Boolean(targetPointId),
        `${testCase.label} setup should create a selectable sketch point.`,
      ).toBeTruthy();
      expect(
        Boolean(curveId),
        `${testCase.label} setup should create a selectable sketch curve.`,
      ).toBeTruthy();

      session = beginSketchTool(session, "constraintCoincident");
      session = selectSketchConstraintTarget(session, {
        kind: "sketchPoint",
        sketchId: "sketch_draft",
        pointId: targetPointId!,
      });
      session = selectSketchConstraintTarget(session, {
        kind: "sketchEntity",
        sketchId: "sketch_draft",
        entityId: curveId!,
      });

      const constraint = session.definition.constraints.at(-1);
      expect(
        constraint?.kind,
        `Coincident authoring should commit a local point-on-${testCase.label} constraint.`,
      ).toBe("pointOnCurve");
      expect(
        constraint.kind === "pointOnCurve" &&
          constraint.point.pointId === targetPointId &&
          constraint.curve.entityId === curveId,
        `Local point-on-${testCase.label} coincident authoring should store typed point and curve operands.`,
      ).toBeTruthy();
    }
  }

  function testCoincidentAuthoringCanConstrainLocalCircleCenters() {
    let session = createSessionWithTwoCircles();
    const circles = session.definition.entities.filter(
      (entity) => entity.kind === "circle",
    );
    expect(
      circles.length,
      "Circle setup should create two selectable circle entities.",
    ).toBe(2);

    session = beginSketchTool(session, "constraintCoincident");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: circles[0]!.entityId,
    });
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: circles[1]!.entityId,
    });

    const constraint = session.definition.constraints.at(-1);
    expect(
      constraint?.kind,
      "Coincident authoring should support selecting two local circle entities by constraining their centers.",
    ).toBe("coincident");
    expect(
      constraint.kind === "coincident" &&
        constraint.pointIds[0] === circles[0]!.centerPointId &&
        constraint.pointIds[1] === circles[1]!.centerPointId,
      "Local circle-circle coincident authoring should store the selected circle center points.",
    ).toBeTruthy();
  }

  function testCoincidentAuthoringMakesLocalLinesShareUnderlyingGeometry() {
    let session = createSessionWithTwoLines();
    const lines = session.definition.entities.filter(
      (entity) => entity.kind === "lineSegment",
    );
    expect(
      lines.length,
      "Line setup should create two selectable line entities.",
    ).toBe(2);

    session = beginSketchTool(session, "constraintCoincident");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: lines[0]!.entityId,
    });
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: lines[1]!.entityId,
    });

    const constraints = session.definition.constraints.slice(-2);
    expect(
      constraints.length === 2 &&
        constraints.every((constraint) => constraint.kind === "pointOnCurve"),
      "Coincident authoring should constrain the second selected line onto the first selected line.",
    ).toBeTruthy();
    expect(
      constraints.every(
        (constraint) =>
          constraint.kind === "pointOnCurve" &&
          constraint.curve.entityId === lines[0]!.entityId &&
          (constraint.point.pointId === lines[1]!.startPointId ||
            constraint.point.pointId === lines[1]!.endPointId),
      ),
      "Line-line coincident authoring should store the driven line endpoints against the first selected line.",
    ).toBeTruthy();
  }

  function testProjectedParallelAuthoringCommitsTypedOperand() {
    let session = createSessionWithTwoLines();
    const [firstLineId] = session.definition.entityIds;
    session = addProjectedReference(session, {
      referenceId: "ref_line",
      status: "projected",
      geometry: [
        {
          geometryId: "projected_geometry_line",
          kind: "lineSegment",
          startPosition: [0, 0],
          endPosition: [10, 0],
        },
      ],
      diagnostics: [],
    });

    session = beginSketchTool(session, "constraintParallel");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: firstLineId!,
    });
    session = selectSketchConstraintTarget(session, {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_line",
      geometryId: "projected_geometry_line",
      geometryKind: "lineSegment",
    });

    const constraint = session.definition.constraints[0];
    expect(
      constraint?.kind,
      "Parallel authoring should commit a projected-line constraint through normal target selection.",
    ).toBe("parallelProjectedLine");
    expect(
      constraint.projectedLine.reference.referenceId === "ref_line" &&
        constraint.projectedLine.reference.geometryId ===
          "projected_geometry_line",
      "Projected parallel authoring should store the selected reference geometry operand.",
    ).toBeTruthy();
  }

  function testSketchDatumAuthoringCommitsTypedOperands() {
    let coincidentSession = createSessionWithTwoLines();
    const [pointId] = coincidentSession.definition.pointIds;
    coincidentSession = beginSketchTool(
      coincidentSession,
      "constraintCoincident",
    );
    coincidentSession = selectSketchConstraintTarget(coincidentSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: pointId!,
    });
    coincidentSession = selectSketchConstraintTarget(coincidentSession, {
      kind: "sketchDatumReference",
      sketchId: "sketch_draft",
      datumId: "origin",
      geometryKind: "point",
    });

    const coincident = coincidentSession.definition.constraints[0];
    expect(
      coincident?.kind === "coincidentProjectedPoint" &&
        coincident.projectedPoint.kind === "sketchDatum" &&
        coincident.projectedPoint.datum === "origin",
      "Coincident authoring should store the sketch origin as a durable datum operand.",
    ).toBeTruthy();

    let parallelSession = createSessionWithTwoLines();
    const [lineId] = parallelSession.definition.entityIds;
    parallelSession = beginSketchTool(parallelSession, "constraintParallel");
    parallelSession = selectSketchConstraintTarget(parallelSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: lineId!,
    });
    parallelSession = selectSketchConstraintTarget(parallelSession, {
      kind: "sketchDatumReference",
      sketchId: "sketch_draft",
      datumId: "xAxis",
      geometryKind: "lineSegment",
    });

    const parallel = parallelSession.definition.constraints[0];
    expect(
      parallel?.kind === "parallelProjectedLine" &&
        parallel.projectedLine.kind === "sketchDatum" &&
        parallel.projectedLine.datum === "xAxis",
      "Parallel authoring should store the sketch X axis as a durable datum operand.",
    ).toBeTruthy();
  }

  function testSketchDatumDimensionAuthoringCommitsTypedOperands() {
    let pointSession = createSessionWithTwoLines();
    const [pointId] = pointSession.definition.pointIds;
    pointSession = beginSketchTool(pointSession, "dimensionDistance");
    pointSession = selectSketchConstraintTarget(pointSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: pointId!,
    });
    pointSession = selectSketchConstraintTarget(pointSession, {
      kind: "sketchDatumReference",
      sketchId: "sketch_draft",
      datumId: "origin",
      geometryKind: "point",
    });
    pointSession = patchSketchConstraintValue(pointSession, { value: 3 });
    pointSession = patchSketchConstraintValue(pointSession, {
      intent: "commitConstraintValue",
    });

    const pointDatum = pointSession.definition.dimensions.find(
      (dimension) => dimension.kind === "pointDatumDistance",
    );
    expect(
      pointDatum?.kind === "pointDatumDistance" &&
        pointDatum.point.pointId === pointId &&
        pointDatum.datum.datum === "origin",
      "Point-to-origin distance authoring should commit a durable datum-point dimension.",
    ).toBeTruthy();

    let lineSession = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });
    lineSession = beginSketchTool(lineSession, "line");
    lineSession = startSketchDraw(lineSession, [0, 2]);
    lineSession = acceptSketchDraw(lineSession, [10, 2]);
    const [lineId] = lineSession.definition.entityIds;
    lineSession = beginSketchTool(lineSession, "dimensionDistance");
    lineSession = selectSketchConstraintTarget(lineSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: lineId!,
    });
    lineSession = selectSketchConstraintTarget(lineSession, {
      kind: "sketchDatumReference",
      sketchId: "sketch_draft",
      datumId: "xAxis",
      geometryKind: "lineSegment",
    });
    lineSession = patchSketchConstraintValue(lineSession, { value: 2 });
    lineSession = patchSketchConstraintValue(lineSession, {
      intent: "commitConstraintValue",
    });

    const lineDatum = lineSession.definition.dimensions.find(
      (dimension) => dimension.kind === "lineDistance",
    );
    expect(
      lineDatum?.kind === "lineDistance" &&
        lineDatum.lines.some(
          (line) => line.kind === "sketchDatum" && line.datum === "xAxis",
        ),
      "Line-to-axis distance authoring should commit a durable datum-axis operand.",
    ).toBeTruthy();
  }

  function testPointOnProjectedCurveAuthoringCommitsTypedOperand() {
    const cases = [
      {
        geometry: {
          geometryId: "projected_geometry_line",
          kind: "lineSegment" as const,
          startPosition: [0, 0] as const,
          endPosition: [10, 0] as const,
        },
        geometryKind: "lineSegment" as const,
      },
      {
        geometry: {
          geometryId: "projected_geometry_circle",
          kind: "circle" as const,
          centerPosition: [0, 0] as const,
          radius: 5,
        },
        geometryKind: "circle" as const,
      },
      {
        geometry: {
          geometryId: "projected_geometry_arc",
          kind: "arc" as const,
          centerPosition: [0, 0] as const,
          startPosition: [5, 0] as const,
          endPosition: [0, 5] as const,
          sweepDirection: "counterClockwise" as const,
        },
        geometryKind: "arc" as const,
      },
    ];

    for (const testCase of cases) {
      let session = createSessionWithTwoLines();
      const [firstPointId] = session.definition.pointIds;
      session = addProjectedReference(session, {
        referenceId: "ref_curve",
        status: "projected",
        geometry: [testCase.geometry],
        diagnostics: [],
      });

      session = beginSketchTool(session, "constraintCoincident");
      session = selectSketchConstraintTarget(session, {
        kind: "sketchPoint",
        sketchId: "sketch_draft",
        pointId: firstPointId!,
      });
      session = selectSketchConstraintTarget(session, {
        kind: "projectedReferenceGeometry",
        referenceId: "ref_curve",
        geometryId: testCase.geometry.geometryId,
        geometryKind: testCase.geometryKind,
      });

      const constraint = session.definition.constraints[0];
      expect(
        constraint?.kind,
        `Coincident authoring should commit a point-on-projected-${testCase.geometryKind} constraint.`,
      ).toBe("pointOnProjectedCurve");
      expect(
        constraint.projectedCurve.reference.geometryId,
        "Point-on-projected-curve authoring should store the selected reference geometry operand.",
      ).toBe(testCase.geometry.geometryId);
    }
  }

  function testReferenceTargetedConstraintAuthoringCommitsTypedOperands() {
    let session = createSessionWithTwoLines();
    const [firstLineId] = session.definition.entityIds;
    const projectedReference: ProjectedSketchReferenceRecord = {
      referenceId: "ref_edge",
      status: "projected",
      geometry: [
        {
          geometryId: "projected_geometry_line",
          kind: "lineSegment",
          startPosition: [0, 0],
          endPosition: [10, 0],
        },
      ],
      diagnostics: [],
    };

    session = addProjectedReference(session, projectedReference);
    session = beginSketchTool(session, "constraintPerpendicular");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: firstLineId!,
    });
    session = selectSketchConstraintTarget(session, {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_edge",
      geometryId: "projected_geometry_line",
      geometryKind: "lineSegment",
    });

    const constraint = session.definition.constraints[0];
    expect(
      constraint?.kind,
      "Perpendicular authoring should commit a durable projected-line constraint when the second target is projected.",
    ).toBe("perpendicularProjectedLine");
    expect(
      constraint.projectedLine.reference.referenceId === "ref_edge" &&
        constraint.projectedLine.reference.geometryId ===
          "projected_geometry_line",
      "Projected-line constraint should store typed reference and geometry IDs.",
    ).toBeTruthy();
    expect(
      session.commitRequest?.definition.constraints[0]?.kind,
      "Reference-targeted constraint should be present in the modeling-boundary commit payload.",
    ).toBe("perpendicularProjectedLine");

    const annotation = getSketchAnnotationDescriptors(session).find(
      (entry) => entry.target.kind === "constraint",
    );
    expect(
      annotation?.glyphKind,
      "Reference-targeted line constraint should render a perpendicular annotation.",
    ).toBe("constraintPerpendicular");
    expect(
      annotation.affectedGeometryRefs.some(
        (target) => target.kind === "projectedReferenceGeometry",
      ),
      "Reference-targeted annotation should highlight the projected target.",
    ).toBeTruthy();
  }

  function testDimensionalConstraintShowsFloatingInputAndSupportsDeletion() {
    let session = createSessionWithTwoLines();
    const [firstPointId, , , diagonalPointId] = session.definition.pointIds;

    session = beginSketchTool(session, "dimensionDistance");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: firstPointId!,
    });
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: diagonalPointId!,
    });
    session = pinSketchConstraintPreview(session, [5, 12]);

    const presentation = getSketchToolPresentation(session);
    expect(
      presentation?.floatingInput?.label,
      "Distance authoring should request a floating numeric input.",
    ).toBe("Distance");

    session = patchSketchConstraintValue(session, { value: 24 });
    session = patchSketchConstraintValue(session, {
      intent: "commitConstraintValue",
    });

    const annotation = getSketchAnnotationDescriptors(session).find(
      (entry) => entry.target.kind === "dimension",
    );
    expect(
      annotation,
      "Committed dimensions should be exposed as durable annotation descriptors.",
    ).toBeTruthy();
    expect(
      annotation.glyphKind === "dimensionDistance" ||
        annotation.glyphKind === "dimensionHorizontal" ||
        annotation.glyphKind === "dimensionVertical",
      "Distance dimensions should expose a dimension-specific glyph kind.",
    ).toBeTruthy();
    expect(
      annotation.anchor.kind,
      "Dimension descriptors should expose a viewport anchor.",
    ).toBe("sketchPoint");
    expect(
      annotation.visibleLabel,
      "Committed dimensions should expose compact visible value text.",
    ).toBe("24.00");
    expect(
      annotation.detail,
      "Committed distance dimension details should avoid deprecated directional role labels.",
    ).toBe("24.00 mm distance");
    expect(
      annotation.dragHandle?.dimensionId,
      "Committed dimensions should expose annotation-chip drag metadata for durable placement updates.",
    ).toBe(annotation.target.dimensionId);
    expect(
      annotation.affectedGeometryRefs.length === 2 &&
        annotation.affectedGeometryRefs.every(
          (target) => target.kind === "sketchPoint",
        ),
      "Dimension descriptors should expose affected sketch point refs.",
    ).toBeTruthy();

    session = selectSketchAnnotation(session, annotation!.target);
    session = deleteSelectedSketchAnnotation(session);

    expect(
      session.definition.dimensionIds.length,
      "Deleting the selected dimension should remove the durable dimension record.",
    ).toBe(0);
  }

  function testCommittedDimensionAnnotationReopensValueInputAndEditsDurableRecord() {
    let session = createSessionWithTwoLines();
    const [firstPointId, , , diagonalPointId] = session.definition.pointIds;

    session = beginSketchTool(session, "dimensionDistance");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: firstPointId!,
    });
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: diagonalPointId!,
    });
    session = patchSketchConstraintValue(session, { value: 24 });
    session = patchSketchConstraintValue(session, {
      intent: "commitConstraintValue",
    });

    const annotation = getSketchAnnotationDescriptors(session).find(
      (entry) => entry.target.kind === "dimension",
    );
    expect(
      annotation?.target.kind,
      "Committed dimension should expose an editable annotation target.",
    ).toBe("dimension");

    session = beginSketchAnnotationEdit(session, annotation.target);

    const input = getSketchToolPresentation(session)?.floatingInput;
    expect(
      input?.label,
      "Double-clicking a distance annotation should reopen its value input.",
    ).toBe("Distance");
    expect(
      input.value,
      "The reopened distance input should use the durable dimension value.",
    ).toBe(24);

    session = patchSketchConstraintValue(session, { value: 31 });
    session = patchSketchConstraintValue(session, {
      intent: "commitAnnotationValue",
    });

    expect(
      session.definition.dimensions[0]?.kind === "distance" &&
        session.definition.dimensions[0].value === 31,
      "Committing the reopened distance input should update the durable dimension record.",
    ).toBeTruthy();
    expect(
      session.commitRequest?.definition.dimensions[0]?.kind === "distance" &&
        session.commitRequest.definition.dimensions[0].value === 31,
      "Committing the reopened distance input should update the durable sketch mutation payload.",
    ).toBeTruthy();
  }

  function testCommittedRectangleWidthEditSolvesDraftGeometry() {
    let session = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });

    session = beginSketchTool(session, "rectangle");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [10, 5]);

    const annotation = getSketchAnnotationDescriptors(session).find(
      (entry) =>
        entry.glyphKind === "dimensionHorizontal" &&
        entry.target.kind === "dimension",
    );
    expect(
      annotation?.target.kind,
      "Rectangle width should expose an editable horizontal dimension.",
    ).toBe("dimension");

    session = patchSketchDimensionAnnotationPlacement(session, {
      intent: "setDimensionAnnotationPlacement",
      dimensionId: annotation.target.dimensionId,
      point: [5, -4],
    });
    const movedAnnotation = getSketchAnnotationDescriptors(session).find(
      (entry) =>
        entry.target.kind === "dimension" &&
        entry.target.dimensionId === annotation.target.dimensionId,
    );
    expect(
      movedAnnotation?.anchor.kind === "sketchPoint" &&
        Math.abs(movedAnnotation.anchor.point[0] - 5) < 1e-9 &&
        Math.abs(movedAnnotation.anchor.point[1] + 4) < 1e-9,
      "Committed dimension annotation chips should use the dynamic dimension label placement.",
    ).toBeTruthy();

    session = beginSketchAnnotationEdit(session, annotation.target);
    session = patchSketchConstraintValue(session, { value: 20 });
    session = patchSketchConstraintValue(session, {
      intent: "commitAnnotationValue",
    });

    const dimension = session.definition.dimensions.find(
      (entry) => entry.dimensionId === annotation.target.dimensionId,
    );
    expect(
      dimension?.kind === "distance" && dimension.value === 20,
      "Width edit should update the durable dimension.",
    ).toBeTruthy();
    expect(
      dimension.pointIds.length,
      "Width dimension should keep its point pair.",
    ).toBe(2);

    const points = new Map(
      session.definition.points.map((point) => [point.pointId, point.position]),
    );
    const left = points.get(dimension.pointIds[0]!);
    const right = points.get(dimension.pointIds[1]!);
    expect(
      left && right,
      "Edited width dimension should reference solved draft points.",
    ).toBeTruthy();
    expect(
      Math.abs(right[0] - left[0] - 20) < 1e-4,
      "Width edit should solve the draft geometry before finish.",
    ).toBeTruthy();
    const payloadDimension = session.commitRequest?.definition.dimensions.find(
      (entry) => entry.dimensionId === annotation.target.dimensionId,
    );
    expect(
      payloadDimension?.kind === "distance" && payloadDimension.value === 20,
      "Width edit should update the durable sketch mutation payload.",
    ).toBeTruthy();
  }

  function testCommittedCircleRadiusEditUpdatesEntityRadius() {
    let session = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });

    session = beginSketchTool(session, "circle");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [10, 0]);

    const annotation = getSketchAnnotationDescriptors(session).find(
      (entry) =>
        entry.glyphKind === "dimensionRadius" &&
        entry.target.kind === "dimension",
    );
    expect(
      annotation?.target.kind,
      "Circle radius should expose an editable radius dimension.",
    ).toBe("dimension");

    session = beginSketchAnnotationEdit(session, annotation.target);
    session = patchSketchConstraintValue(session, { value: 18 });
    session = patchSketchConstraintValue(session, {
      intent: "commitAnnotationValue",
    });

    const dimension = session.definition.dimensions.find(
      (entry) => entry.dimensionId === annotation.target.dimensionId,
    );
    expect(
      dimension?.kind === "circleRadius" && dimension.value === 18,
      "Radius edit should update the durable dimension.",
    ).toBeTruthy();
    const circle = session.definition.entities.find(
      (entity) => entity.kind === "circle",
    );
    expect(
      circle?.kind === "circle" && circle.radius === 18,
      "Radius edit should update the authored circle radius.",
    ).toBeTruthy();
    const payloadCircle = session.commitRequest?.definition.entities.find(
      (entity) => entity.kind === "circle",
    );
    expect(
      payloadCircle?.kind === "circle" && payloadCircle.radius === 18,
      "Radius edit should update the durable sketch mutation payload.",
    ).toBeTruthy();
  }

  function testExpandedDimensionAuthoringCommitsDurablePayloads() {
    let circleSession = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });
    circleSession = beginSketchTool(circleSession, "circle");
    circleSession = startSketchDraw(circleSession, [0, 0]);
    circleSession = acceptSketchDraw(circleSession, [5, 0]);
    const circleId = circleSession.definition.entities.find(
      (entity) => entity.kind === "circle",
    )?.entityId;
    expect(
      circleId,
      "Circle fixture should create a circle entity.",
    ).toBeTruthy();

    circleSession = beginSketchTool(circleSession, "dimensionDistance");
    circleSession = selectSketchConstraintTarget(circleSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: circleId,
    });
    expect(
      getSketchToolPresentation(circleSession)?.overlays?.some(
        (overlay) =>
          overlay.kind === "dimensionLine" &&
          overlay.referenceKind === "diameter",
      ),
      "Selecting one circle with Dimension should start a diameter preview before committing the value.",
    ).toBeTruthy();
    circleSession = patchSketchConstraintValue(circleSession, {
      intent: "setConstraintAnnotationPlacement",
      point: [0, 5],
    });
    circleSession = patchSketchConstraintValue(circleSession, { value: 12 });
    circleSession = patchSketchConstraintValue(circleSession, {
      intent: "commitConstraintValue",
    });
    const diameter = circleSession.definition.dimensions.find(
      (dimension) => dimension.kind === "diameter",
    );
    expect(
      diameter?.kind === "diameter" &&
        diameter.entityId === circleId &&
        diameter.value === 12 &&
        diameter.annotationPlacement?.kind === "dimensionLine",
      "Diameter authoring should commit a durable diameter dimension with annotation placement.",
    ).toBeTruthy();
    expect(
      getSketchToolPresentation(circleSession)?.overlays?.some(
        (overlay) =>
          overlay.kind === "dimensionLine" &&
          overlay.referenceKind === "diameter" &&
          !overlay.dragHandle,
      ),
      "Committed diameter dimensions should keep overlay geometry visible without reusing it as the durable drag handle.",
    ).toBeTruthy();
    circleSession = patchSketchDimensionAnnotationPlacement(circleSession, {
      intent: "setDimensionAnnotationPlacement",
      dimensionId: diameter.dimensionId,
      point: [5, 0],
    });
    const movedDiameter = circleSession.definition.dimensions.find(
      (dimension) => dimension.dimensionId === diameter.dimensionId,
    );
    expect(
      movedDiameter?.kind === "diameter" &&
        movedDiameter.annotationPlacement?.kind === "dimensionLine" &&
        Math.abs(movedDiameter.annotationPlacement.angleRadians ?? 0) < 1e-9,
      "Dragging a committed diameter annotation should update its durable annotation placement.",
    ).toBeTruthy();

    let lengthSession = createSessionWithTwoLines();
    const [lengthLineId] = lengthSession.definition.entityIds;
    expect(
      lengthLineId,
      "Line length fixture should create a line entity.",
    ).toBeTruthy();
    lengthSession = beginSketchTool(lengthSession, "dimensionDistance");
    lengthSession = selectSketchConstraintTarget(lengthSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: lengthLineId,
    });
    const lengthPreview = getSketchToolPresentation(
      lengthSession,
    )?.overlays?.find((overlay) => overlay.kind === "dimensionLine");
    expect(
      lengthPreview?.kind === "dimensionLine" &&
        lengthPreview.referenceKind === "lineLength",
      "Selecting one local line with Dimension should preview an editable line-length dimension.",
    ).toBeTruthy();
    lengthSession = pinSketchConstraintPreview(lengthSession, [5, -2]);
    expect(
      getSketchToolPresentation(lengthSession)?.floatingInput?.label,
      "Pinning a single-line Dimension preview should open line-length value entry.",
    ).toBe("Length");
    lengthSession = patchSketchConstraintValue(lengthSession, { value: 8 });
    lengthSession = patchSketchConstraintValue(lengthSession, {
      intent: "commitConstraintValue",
    });
    const lineLength = lengthSession.definition.dimensions.find(
      (dimension) => dimension.kind === "lineLength",
    );
    expect(
      lineLength?.kind === "lineLength" &&
        lineLength.entityId === lengthLineId &&
        lineLength.value === 8 &&
        lineLength.annotationPlacement?.kind === "dimensionLine",
      "Single-line Dimension authoring should commit a durable line-length dimension tied to the selected edge.",
    ).toBeTruthy();

    let lineSession = createSessionWithTwoLines();
    const [firstLineId, secondLineId] = lineSession.definition.entityIds;
    expect(
      firstLineId && secondLineId,
      "Line fixture should create two line entities.",
    ).toBeTruthy();
    lineSession = beginSketchTool(lineSession, "dimensionDistance");
    lineSession = selectSketchConstraintTarget(lineSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: firstLineId,
    });
    lineSession = selectSketchConstraintTarget(lineSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: secondLineId,
    });
    lineSession = patchSketchConstraintValue(lineSession, { value: 6 });
    lineSession = patchSketchConstraintValue(lineSession, {
      intent: "commitConstraintValue",
    });
    const lineDistance = lineSession.definition.dimensions.find(
      (dimension) => dimension.kind === "lineDistance",
    );
    expect(
      lineDistance?.kind === "lineDistance" &&
        lineDistance.lines.every((line) => line.kind === "localEntity") &&
        lineDistance.value === 6,
      "Parallel line targets should commit a durable line-to-line distance dimension.",
    ).toBeTruthy();

    let pointLineSession = createSessionWithTwoLines();
    const lineId = pointLineSession.definition.entityIds[0];
    const pointId = pointLineSession.definition.pointIds[3];
    expect(
      lineId && pointId,
      "Point-line fixture should expose a line and a point.",
    ).toBeTruthy();
    pointLineSession = beginSketchTool(pointLineSession, "dimensionDistance");
    pointLineSession = selectSketchConstraintTarget(pointLineSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId,
    });
    pointLineSession = selectSketchConstraintTarget(pointLineSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: lineId,
    });
    pointLineSession = patchSketchConstraintValue(pointLineSession, {
      value: 4,
    });
    pointLineSession = patchSketchConstraintValue(pointLineSession, {
      intent: "commitConstraintValue",
    });
    const pointLineDistance = pointLineSession.definition.dimensions.find(
      (dimension) => dimension.kind === "linePointDistance",
    );
    expect(
      pointLineDistance?.kind === "linePointDistance" &&
        pointLineDistance.line.kind === "localEntity" &&
        pointLineDistance.point.kind === "localPoint" &&
        pointLineDistance.value === 4,
      "Line and point targets should commit a durable line-to-point distance dimension in either selection order.",
    ).toBeTruthy();

    let angleSession = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });
    angleSession = beginSketchTool(angleSession, "line");
    angleSession = startSketchDraw(angleSession, [0, 0]);
    angleSession = acceptSketchDraw(angleSession, [10, 0]);
    angleSession = beginSketchTool(angleSession, "line");
    angleSession = startSketchDraw(angleSession, [5, -5]);
    angleSession = acceptSketchDraw(angleSession, [5, 5]);
    const [horizontalLineId, verticalLineId] =
      angleSession.definition.entityIds;
    expect(
      horizontalLineId && verticalLineId,
      "Angle fixture should create two non-parallel line entities.",
    ).toBeTruthy();
    angleSession = beginSketchTool(angleSession, "dimensionDistance");
    angleSession = selectSketchConstraintTarget(angleSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: horizontalLineId,
    });
    angleSession = selectSketchConstraintTarget(angleSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: verticalLineId,
    });
    const anglePreview = getSketchToolPresentation(
      angleSession,
    )?.overlays?.find((overlay) => overlay.kind === "angleArc");
    expect(
      anglePreview?.kind === "angleArc" &&
        Math.abs(anglePreview.center[0] - 5) < 1e-9 &&
        Math.abs(anglePreview.center[1]) < 1e-9 &&
        Math.abs(anglePreview.start[1]) < 1e-9 &&
        Math.abs(anglePreview.end[0] - 5) < 1e-9 &&
        anglePreview.side === "minor",
      "Angle preview arc should be centered at the line intersection and start/end on the selected line references.",
    ).toBeTruthy();
    angleSession = pinSketchConstraintPreview(angleSession, [4, -1]);
    const majorAnglePreview = getSketchToolPresentation(
      angleSession,
    )?.overlays?.find((overlay) => overlay.kind === "angleArc");
    expect(
      majorAnglePreview?.kind === "angleArc" &&
        majorAnglePreview.side === "major",
      "Dragging an angle preview across the opposite sector should select the major complement arc.",
    ).toBeTruthy();
    expect(
      getSketchToolPresentation(angleSession)?.floatingInput?.label ===
        "Angle" &&
        getSketchToolPresentation(angleSession)?.floatingInput?.unit === "deg",
      "Pinned non-parallel line dimensions should open degree-based angle value entry.",
    ).toBeTruthy();

    let angleHandleSession = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });
    angleHandleSession = beginSketchTool(angleHandleSession, "line");
    angleHandleSession = startSketchDraw(angleHandleSession, [0, 0]);
    angleHandleSession = acceptSketchDraw(angleHandleSession, [10, 0]);
    angleHandleSession = beginSketchTool(angleHandleSession, "line");
    angleHandleSession = startSketchDraw(angleHandleSession, [5, -5]);
    angleHandleSession = acceptSketchDraw(angleHandleSession, [5, 5]);
    const [handleHorizontalLineId, handleVerticalLineId] =
      angleHandleSession.definition.entityIds;
    expect(
      handleHorizontalLineId && handleVerticalLineId,
      "Angle handle fixture should create two non-parallel line entities.",
    ).toBeTruthy();
    angleHandleSession = beginSketchTool(
      angleHandleSession,
      "dimensionDistance",
    );
    angleHandleSession = selectSketchConstraintTarget(angleHandleSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: handleHorizontalLineId,
    });
    angleHandleSession = selectSketchConstraintTarget(angleHandleSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: handleVerticalLineId,
    });
    angleHandleSession = patchSketchConstraintValue(angleHandleSession, {
      intent: "setConstraintAnnotationPlacement",
      point: [4, -1],
    });
    expect(
      angleHandleSession.constraintAuthoring?.isPreviewPinned === true &&
        getSketchToolPresentation(angleHandleSession)?.floatingInput?.label ===
          "Angle",
      "Clicking or dragging an uncommitted angle preview handle should pin the preview and open value entry.",
    ).toBeTruthy();

    angleSession = patchSketchConstraintValue(angleSession, { value: 90 });
    angleSession = patchSketchConstraintValue(angleSession, {
      intent: "commitConstraintValue",
    });
    const angle = angleSession.definition.dimensions.find(
      (dimension) => dimension.kind === "lineAngle",
    );
    expect(
      angle?.kind === "lineAngle" &&
        Math.abs(angle.valueRadians - Math.PI / 2) < 1e-9 &&
        angle.lines.every((line) => line.kind === "localEntity") &&
        angle.annotationPlacement?.side === "major",
      "Non-parallel line targets should commit a durable line angle dimension with the selected arc side.",
    ).toBeTruthy();
    const angleAnnotation = getSketchAnnotationDescriptors(angleSession).find(
      (entry) =>
        entry.target.kind === "dimension" &&
        entry.target.dimensionId === angle.dimensionId,
    );
    expect(
      angleAnnotation?.glyphKind === "dimensionAngle" &&
        angleAnnotation.visibleLabel === "90.0°" &&
        angleAnnotation.detail === "90.0 deg angle",
      "Committed angle dimensions should expose angle-specific glyph metadata and degree-based detail text.",
    ).toBeTruthy();
    expect(
      angleAnnotation?.target.kind,
      "Committed angle annotation should expose a dimension target.",
    ).toBe("dimension");
    let angleEditSession = beginSketchAnnotationEdit(
      angleSession,
      angleAnnotation.target,
    );
    expect(
      getSketchToolPresentation(angleEditSession)?.floatingInput?.label ===
        "Angle" &&
        getSketchToolPresentation(angleEditSession)?.floatingInput?.unit ===
          "deg" &&
        getSketchToolPresentation(angleEditSession)?.floatingInput?.value ===
          90,
      "Reopened angle dimension edits should be seeded in degrees.",
    ).toBeTruthy();
    angleEditSession = patchSketchConstraintValue(angleEditSession, {
      value: 90,
    });
    angleEditSession = patchSketchConstraintValue(angleEditSession, {
      intent: "commitAnnotationValue",
    });
    const editedAngle = angleEditSession.definition.dimensions.find(
      (dimension) => dimension.dimensionId === angle.dimensionId,
    );
    expect(
      angleEditSession.status === "idle" &&
        editedAngle?.kind === "lineAngle" &&
        Math.abs(editedAngle.valueRadians - Math.PI / 2) < 1e-9,
      "Committed angle dimension edits should accept degree input and preserve durable radians.",
    ).toBeTruthy();
    const committedAngleOverlay = getSketchToolPresentation(
      angleSession,
    )?.overlays?.find((overlay) => overlay.kind === "angleArc");
    expect(
      committedAngleOverlay?.kind === "angleArc" &&
        Math.abs(committedAngleOverlay.center[0] - 5) < 1e-9 &&
        Math.abs(committedAngleOverlay.center[1]) < 1e-9 &&
        Math.abs(committedAngleOverlay.start[1]) < 1e-9 &&
        Math.abs(committedAngleOverlay.end[0] - 5) < 1e-9 &&
        committedAngleOverlay.side === "major" &&
        !committedAngleOverlay.dragHandle,
      "Committed line angle dimensions should render durable angle arcs without using them as a second drag handle.",
    ).toBeTruthy();
    expect(
      committedAngleOverlay?.kind === "angleArc" &&
        (committedAngleOverlay.witnessLines?.length ?? 0) === 0,
      "Committed line angle dimensions should avoid extra witness geometry when the true intersection lies on both segments.",
    ).toBeTruthy();
    angleSession = patchSketchDimensionAnnotationPlacement(angleSession, {
      intent: "setDimensionAnnotationPlacement",
      dimensionId: angle.dimensionId,
      point: [6, 1],
    });
    const movedAngle = angleSession.definition.dimensions.find(
      (dimension) => dimension.dimensionId === angle.dimensionId,
    );
    expect(
      movedAngle?.kind === "lineAngle" &&
        movedAngle.annotationPlacement?.side === "minor",
      "Dragging a committed angle annotation back across the close sector should update the durable arc side.",
    ).toBeTruthy();
  }

  function testDistancePreviewUsesPartialTargetAndPointer() {
    let session = createSessionWithTwoLines();
    const [firstPointId] = session.definition.pointIds;

    session = beginSketchTool(session, "dimensionDistance");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: firstPointId!,
    });
    session = updateSketchPointer(session, [8, 3]);

    const dimensionPreview = getSketchToolPresentation(session)?.overlays?.find(
      (overlay) => overlay.id === "distance-preview",
    );

    expect(
      dimensionPreview?.kind === "dimensionLine" &&
        dimensionPreview.referenceKind === "aligned" &&
        dimensionPreview.end[0] === 8 &&
        dimensionPreview.end[1] === 3,
      "Distance authoring should emit a transient dimension line from one selected point to the active pointer.",
    ).toBeTruthy();
  }

  function testAngleWitnessLinesAppearForOffSegmentIntersections() {
    let session = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 0]);
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [6, -3]);
    session = acceptSketchDraw(session, [6, 3]);
    const [horizontalLineId, verticalLineId] = session.definition.entityIds;
    expect(
      horizontalLineId && verticalLineId,
      "Off-segment angle fixture should create two non-parallel line entities.",
    ).toBeTruthy();

    session = beginSketchTool(session, "dimensionDistance");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: horizontalLineId,
    });
    session = selectSketchConstraintTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: verticalLineId,
    });

    const preview = getSketchToolPresentation(session)?.overlays?.find(
      (overlay) => overlay.kind === "angleArc",
    );
    expect(
      preview?.kind === "angleArc" &&
        preview.witnessLines?.some(
          (line) =>
            Math.abs(line.start[0] - 4) < 1e-9 &&
            line.end[0] > line.start[0] &&
            line.end[0] < 6,
        ),
      "Angle previews should add witness geometry when the true intersection lies beyond a selected segment.",
    ).toBeTruthy();

    session = patchSketchConstraintValue(session, { value: 90 });
    session = patchSketchConstraintValue(session, {
      intent: "commitConstraintValue",
    });
    const committed = getSketchToolPresentation(session)?.overlays?.find(
      (overlay) => overlay.kind === "angleArc",
    );
    expect(
      committed?.kind === "angleArc" &&
        committed.witnessLines?.some(
          (line) =>
            Math.abs(line.start[0] - 4) < 1e-9 &&
            line.end[0] > line.start[0] &&
            line.end[0] < 6,
        ),
      "Committed angle dimensions should preserve witness geometry for off-segment intersections.",
    ).toBeTruthy();
  }

  function testPointDistanceReferenceSelectionFollowsPointer() {
    expect(
      selectPointToPointDimensionReference({
        first: [0, 0],
        second: [10, 4],
        pointer: [5, 2],
      }),
      "Pointer near the point-to-point segment should keep the aligned reference.",
    ).toBe("aligned");
    expect(
      selectPointToPointDimensionReference({
        first: [0, 0],
        second: [10, 4],
        pointer: [5, 12],
      }),
      "Pointer above the target span should select the horizontal distance reference.",
    ).toBe("horizontal");
    expect(
      selectPointToPointDimensionReference({
        first: [0, 0],
        second: [10, 4],
        pointer: [18, 2],
      }),
      "Pointer beside the target span should select the vertical distance reference.",
    ).toBe("vertical");
  }

  function testDistancePreviewFollowsPointerUntilPlacementClick() {
    let session = createSessionWithTwoLines();
    const [firstPointId, , , diagonalPointId] = session.definition.pointIds;

    session = beginSketchTool(session, "dimensionDistance");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: firstPointId!,
    });
    session = updateSketchPointer(session, [5, 12]);
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: diagonalPointId!,
    });

    const horizontalPreview = getSketchToolPresentation(
      session,
    )?.overlays?.find((overlay) => overlay.id === "distance-preview");

    session = updateSketchPointer(session, [18, 2]);

    const verticalPreview = getSketchToolPresentation(session)?.overlays?.find(
      (overlay) => overlay.id === "distance-preview",
    );

    expect(
      horizontalPreview?.kind === "dimensionLine" &&
        horizontalPreview.referenceKind === "horizontal",
      "Distance preview should select a horizontal reference when the pointer is above the target span.",
    ).toBeTruthy();
    expect(
      session.constraintAuthoring?.isPreviewPinned === false &&
        verticalPreview?.kind === "dimensionLine" &&
        verticalPreview.referenceKind === "vertical",
      "Distance preview should keep following the pointer after value entry opens.",
    ).toBeTruthy();
  }

  function testConstraintPreviewStopsMovingAfterPinClick() {
    let session = createSessionWithTwoLines();
    const [firstPointId, , , diagonalPointId] = session.definition.pointIds;

    session = beginSketchTool(session, "dimensionDistance");
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: firstPointId!,
    });
    session = updateSketchPointer(session, [5, 12]);
    session = selectSketchConstraintTarget(session, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: diagonalPointId!,
    });
    session = pinSketchConstraintPreview(session, [5, 12]);

    const pinnedPreview = getSketchToolPresentation(session)?.overlays?.find(
      (overlay) => overlay.id === "distance-preview",
    );

    session = updateSketchPointer(session, [18, 2]);

    const afterMovePreview = getSketchToolPresentation(session)?.overlays?.find(
      (overlay) => overlay.id === "distance-preview",
    );

    expect(
      pinnedPreview?.kind === "dimensionLine" &&
        afterMovePreview?.kind === "dimensionLine" &&
        pinnedPreview.referenceKind === "horizontal" &&
        afterMovePreview.referenceKind === "horizontal" &&
        afterMovePreview.start[1] === pinnedPreview.start[1],
      "Pinned constraint previews should not move while the pointer travels to the Commit button.",
    ).toBeTruthy();

    let targetClickSession = createSessionWithTwoLines();
    const [targetClickLineId] = targetClickSession.definition.entityIds;
    const [targetClickFirstPointId, , , targetClickDiagonalPointId] =
      targetClickSession.definition.pointIds;

    targetClickSession = beginSketchTool(
      targetClickSession,
      "dimensionDistance",
    );
    targetClickSession = selectSketchConstraintTarget(targetClickSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: targetClickFirstPointId!,
    });
    targetClickSession = updateSketchPointer(targetClickSession, [18, 2]);
    targetClickSession = selectSketchConstraintTarget(targetClickSession, {
      kind: "sketchPoint",
      sketchId: "sketch_draft",
      pointId: targetClickDiagonalPointId!,
    });
    targetClickSession = pinSketchConstraintPreview(
      targetClickSession,
      [18, 2],
    );
    targetClickSession = selectSketchConstraintTarget(targetClickSession, {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: targetClickLineId!,
    });

    const targetClickPreview = getSketchToolPresentation(
      targetClickSession,
    )?.overlays?.find((overlay) => overlay.id === "distance-preview");

    targetClickSession = updateSketchPointer(targetClickSession, [5, 12]);

    const afterTargetClickMovePreview = getSketchToolPresentation(
      targetClickSession,
    )?.overlays?.find((overlay) => overlay.id === "distance-preview");

    expect(
      targetClickSession.constraintAuthoring?.isPreviewPinned === true &&
        targetClickSession.constraintAuthoring.selectedTargets.length === 2 &&
        targetClickPreview?.kind === "dimensionLine" &&
        afterTargetClickMovePreview?.kind === "dimensionLine" &&
        targetClickPreview.referenceKind === "vertical" &&
        afterTargetClickMovePreview.referenceKind === "vertical",
      "Pinned dimension previews should ignore later target selections instead of replacing operands.",
    ).toBeTruthy();
  }

  testToolbarDefinitionsExposeConstraintFamilies();
  testHorizontalAndVerticalAuthoringCommitDurableConstraints();
  testHorizontalAndVerticalRejectUnsupportedTargets();
  testHorizontalAndVerticalUseSketchPlaneAxes();
  testConcentricAuthoringCommitsLocalAndProjectedConstraints();
  testMidpointAuthoringCommitsLocalAndProjectedConstraints();
  testPierceAuthoringCommitsLocalAndProjectedConstraints();
  testCollinearAuthoringCommitsLocalProjectedAndMultiTargetConstraints();
  testCollinearRejectsUnsupportedDegenerateAndReadonlyOnlyTargets();
  testFixGeometryCommitsSupportedTargets();
  testNormalAuthoringCommitsValidTargetsAndRejectsInvalidTargets();
  testSymmetricAuthoringCommitsLocalAndProjectedAxes();
  testGeometricConstraintAuthoringCommitsDurableRecord();
  testProjectedCoincidentAuthoringCommitsTypedOperand();
  testProjectedCoincidentAuthoringCanConstrainCircleCenter();
  testCoincidentAuthoringCommitsLocalPointOnCurveOperands();
  testCoincidentAuthoringCanConstrainLocalCircleCenters();
  testCoincidentAuthoringMakesLocalLinesShareUnderlyingGeometry();
  testProjectedParallelAuthoringCommitsTypedOperand();
  testSketchDatumAuthoringCommitsTypedOperands();
  testSketchDatumDimensionAuthoringCommitsTypedOperands();
  testPointOnProjectedCurveAuthoringCommitsTypedOperand();
  testReferenceTargetedConstraintAuthoringCommitsTypedOperands();
  testDimensionalConstraintShowsFloatingInputAndSupportsDeletion();
  testCommittedDimensionAnnotationReopensValueInputAndEditsDurableRecord();
  testCommittedRectangleWidthEditSolvesDraftGeometry();
  testCommittedCircleRadiusEditUpdatesEntityRadius();
  testExpandedDimensionAuthoringCommitsDurablePayloads();
  testAngleWitnessLinesAppearForOffSegmentIntersections();
  testDistancePreviewUsesPartialTargetAndPointer();
  testPointDistanceReferenceSelectionFollowsPointer();
  testDistancePreviewFollowsPointerUntilPlacementClick();
  testConstraintPreviewStopsMovingAfterPinClick();
});
