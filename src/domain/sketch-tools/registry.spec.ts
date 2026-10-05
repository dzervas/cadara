import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { test, expect } from "vitest";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deriveSketchDisplayEntities,
  finalizeSketchDraw,
  getSketchSessionDerivedValidity,
  getSketchSessionDisplayRenderables,
  getSketchToolPresentation,
  patchSketchDrawingToolValue,
  startSketchDraw,
  updateSketchPointer,
} from "@/domain/editor/sketch-session";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import {
  getRegisteredSketchToolDefinitions,
  getSketchToolDefinition,
  isRegisteredSketchToolId,
} from "@/core/sketch-tools/registry";
import {
  getRegisteredSketchEditToolDefinitions,
  isRegisteredSketchEditToolId,
} from "@/core/sketch-edit-tools/registry";
import {
  getToolById,
  getToolbarSectionsForMode,
  searchToolDefinitions,
} from "@/core/tools/tool-registry";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";

const regionSolver = new SketchConstraintSolverAdapter({
  neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
});

test("src/domain/sketch-tools/registry.spec.ts", async () => {
  function testRegistryContainsCurrentSketchToolSet() {
    const registeredToolIds = getRegisteredSketchToolDefinitions()
      .map((definition) => definition.metadata.id)
      .sort();
    const registeredEditToolIds = getRegisteredSketchEditToolDefinitions()
      .map((definition) => definition.metadata.id)
      .sort();

    expect(
      JSON.stringify(registeredToolIds),
      "The sketch tool registry should contain every current drawing tool.",
    ).toBe(
      JSON.stringify([
        "alignedRectangle",
        "bezierCurve",
        "centerPointArc",
        "centerPointRectangle",
        "circle",
        "circumscribedPolygon",
        "conic",
        "controlPointSpline",
        "ellipse",
        "ellipticalArc",
        "inscribedPolygon",
        "line",
        "midpointLine",
        "point",
        "profileText",
        "rectangle",
        "spline",
        "tangentArc",
        "threePointArc",
        "threePointCircle",
      ]),
    );
    expect(
      isRegisteredSketchToolId("line"),
      "Line should resolve as a registered sketch tool.",
    ).toBeTruthy();
    expect(
      isRegisteredSketchToolId("midpointLine"),
      "Midpoint Line should resolve as a registered sketch tool.",
    ).toBeTruthy();
    expect(
      isRegisteredSketchToolId("spline"),
      "Spline should resolve as a registered sketch tool.",
    ).toBeTruthy();
    expect(
      JSON.stringify(registeredEditToolIds),
      "The sketch edit registry should contain every current edit operator.",
    ).toBe(
      JSON.stringify([
        "offset",
        "sketchChamfer",
        "sketchCircularPattern",
        "sketchExtend",
        "sketchFillet",
        "sketchLinearPattern",
        "sketchMirror",
        "sketchSlot",
        "sketchSplit",
        "sketchTransform",
        "trim",
      ]),
    );
    expect(
      isRegisteredSketchEditToolId("sketchFillet"),
      "Sketch fillet should resolve as a registered sketch edit tool.",
    ).toBeTruthy();
    expect(
      isRegisteredSketchEditToolId("fillet"),
      "Part fillet should stay distinct from sketch fillet.",
    ).toBeFalsy();
  }

  function testToolFamiliesAndDiscoveryExposePrimitiveConstructors() {
    expect(
      getToolById("line").dropdown?.variantIds.includes("midpointLine"),
      "Line family should expose the midpoint-line constructor.",
    ).toBeTruthy();
    expect(
      getToolById("rectangle").dropdown?.variantIds.includes(
        "centerPointRectangle",
      ) &&
        getToolById("rectangle").dropdown?.variantIds.includes(
          "alignedRectangle",
        ),
      "Rectangle family should expose center-point and aligned rectangle constructors.",
    ).toBeTruthy();
    expect(
      getToolById("circle").dropdown?.variantIds.includes("threePointCircle"),
      "Circle family should expose the 3-point circle constructor.",
    ).toBeTruthy();
    expect(
      getToolById("centerPointArc").dropdown?.variantIds.includes(
        "threePointArc",
      ) &&
        getToolById("centerPointArc").dropdown?.variantIds.includes(
          "tangentArc",
        ),
      "Arc family should expose center, 3-point, and tangent arc constructors.",
    ).toBeTruthy();
    expect(
      getToolById("inscribedPolygon").dropdown?.variantIds.includes(
        "circumscribedPolygon",
      ),
      "Polygon family should expose inscribed and circumscribed constructors.",
    ).toBeTruthy();
    expect(
      getToolById("ellipse").dropdown?.variantIds.includes("ellipticalArc") &&
        getToolById("ellipse").dropdown?.variantIds.includes("conic") &&
        getToolById("ellipse").dropdown?.variantIds.includes("bezierCurve"),
      "Advanced curve family should expose ellipse, elliptical arc, conic, and Bezier constructors.",
    ).toBeTruthy();
    expect(
      getToolById("spline").dropdown?.variantIds.includes("controlPointSpline"),
      "Spline family should expose fit-point and control-point spline constructors.",
    ).toBeTruthy();

    const sketchDrawingSection = getToolbarSectionsForMode("sketch").find(
      (section) => section.id === "drawing",
    );
    expect(
      getToolById("point").id,
      "Point should resolve through the shared tool registry.",
    ).toBe("point");
    expect(
      getToolById("point").icon,
      "Point should expose a dedicated toolbar icon instead of reusing Circle.",
    ).toBe("point");
    expect(
      sketchDrawingSection?.toolIds.includes("point"),
      "Sketch toolbar should include the Point constructor.",
    ).toBeTruthy();
    expect(
      sketchDrawingSection?.toolIds.includes("centerPointArc"),
      "Sketch toolbar should include an arc family trigger.",
    ).toBeTruthy();
    expect(
      sketchDrawingSection?.toolIds.includes("ellipse"),
      "Sketch toolbar should include an advanced curve family trigger.",
    ).toBeTruthy();
    expect(
      sketchDrawingSection?.toolIds.includes("inscribedPolygon"),
      "Sketch toolbar should include a polygon family trigger.",
    ).toBeTruthy();
    expect(
      sketchDrawingSection?.toolIds.includes("profileText"),
      "Sketch toolbar should include profile text.",
    ).toBeTruthy();
    expect(
      getToolbarSectionsForMode("sketch").some(
        (section) =>
          section.id === "sketchOps" &&
          section.toolIds.includes("importImage") &&
          section.toolIds.includes("sketchFillet") &&
          section.toolIds.includes("sketchChamfer") &&
          section.toolIds.includes("sketchExtend") &&
          section.toolIds.includes("sketchSplit") &&
          section.toolIds.includes("sketchSlot"),
      ),
      "Sketch toolbar should include the sketch edit operators.",
    ).toBeTruthy();
    expect(
      searchToolDefinitions("tangent").some(
        (tool) => tool.id === "tangentArc",
      ) &&
        searchToolDefinitions("polygon").some(
          (tool) => tool.id === "circumscribedPolygon",
        ),
      "Tool search should discover sketch constructor dropdown variants.",
    ).toBeTruthy();
    expect(
      searchToolDefinitions("fillet").some(
        (tool) => tool.id === "sketchFillet",
      ) && searchToolDefinitions("fillet").some((tool) => tool.id === "fillet"),
      "Tool search should expose sketch and part fillet tools separately.",
    ).toBeTruthy();
    expect(
      searchToolDefinitions("bezier").some(
        (tool) => tool.id === "bezierCurve",
      ) &&
        searchToolDefinitions("text").some((tool) => tool.id === "profileText"),
      "Tool search should discover advanced curve and text constructors.",
    ).toBeTruthy();
    expect(
      searchToolDefinitions("point").some((tool) => tool.id === "point"),
      "Tool search should discover the Point constructor.",
    ).toBeTruthy();
  }

  function testLinePointerLifecycleProducesStagedGeometry() {
    const tool = getSketchToolDefinition("line");
    const activated = tool.activate();
    const started = tool.pointerRelease({
      state: activated.state,
      point: [0, 0],
    });
    const moved = tool.pointerMove({
      state: started.state,
      point: [10, 0],
    });

    expect(
      moved.stagedEntities.length,
      "Line pointer movement should produce one staged line entity.",
    ).toBe(1);
    expect(
      moved.stagedEntities[0]?.kind,
      "Line staged geometry should be a line entity.",
    ).toBe("line");
    expect(
      moved.presentation.measurements?.[0]?.label,
      "Line presentation should expose live length guidance.",
    ).toBe("Length");
    const lengthOverlay = moved.presentation.overlays?.find(
      (overlay) => overlay.id === "line-length-overlay",
    );
    const angleOverlay = moved.presentation.overlays?.find(
      (overlay) => overlay.id === "line-angle-overlay",
    );
    expect(
      lengthOverlay?.kind === "measurement" &&
        lengthOverlay.value === 10 &&
        lengthOverlay.anchor.kind === "sketchPoint",
      "Line presentation should expose anchored live length guidance.",
    ).toBeTruthy();
    expect(
      angleOverlay?.kind === "measurement" &&
        angleOverlay.label === "Angle" &&
        angleOverlay.value === 0 &&
        angleOverlay.unit === "deg",
      "Line presentation should expose anchored live angle guidance.",
    ).toBeTruthy();
  }

  function testCirclePresentationSchemaExposesPromptControlAndDiameterOverlay() {
    const tool = getSketchToolDefinition("circle");
    const activated = tool.activate();
    const started = tool.pointerRelease({
      state: activated.state,
      point: [1, 1],
    });
    const moved = tool.pointerMove({
      state: started.state,
      point: [4, 5],
    });

    expect(
      moved.presentation.prompts[0]?.text,
      "Circle presentation should update its prompt by interaction step.",
    ).toBe("Set radius");
    expect(
      moved.presentation.controls?.some(
        (control) => control.id === "circle-radius",
      ),
      "Circle presentation should expose radius through a generic numeric control.",
    ).toBeTruthy();
    const diameterOverlay = moved.presentation.overlays?.find(
      (overlay) => overlay.id === "circle-diameter-overlay",
    );
    expect(
      diameterOverlay?.kind === "measurement" &&
        diameterOverlay.label === "Diameter" &&
        diameterOverlay.value === 10 &&
        diameterOverlay.anchor.kind === "cursor",
      "Circle presentation should expose diameter at the active circle edge.",
    ).toBeTruthy();
  }

  function testRectanglePresentationSchemaExposesAnchoredWidthAndHeightOverlays() {
    const tool = getSketchToolDefinition("rectangle");
    const activated = tool.activate();
    const started = tool.pointerRelease({
      state: activated.state,
      point: [0, 0],
    });
    const moved = tool.pointerMove({
      state: started.state,
      point: [4, 3],
    });
    const widthOverlay = moved.presentation.overlays?.find(
      (overlay) => overlay.id === "rectangle-width-overlay",
    );
    const heightOverlay = moved.presentation.overlays?.find(
      (overlay) => overlay.id === "rectangle-height-overlay",
    );

    expect(
      widthOverlay?.kind === "measurement" &&
        widthOverlay.value === 4 &&
        widthOverlay.anchor.kind === "sketchPoint",
      "Rectangle presentation should expose anchored live width guidance.",
    ).toBeTruthy();
    expect(
      heightOverlay?.kind === "measurement" &&
        heightOverlay.value === 3 &&
        heightOverlay.anchor.kind === "sketchPoint",
      "Rectangle presentation should expose anchored live height guidance.",
    ).toBeTruthy();
  }

  function testSessionRuntimeDelegatesCommitOutputToToolModule() {
    const session = beginSketchTool(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      "rectangle",
    );
    const started = startSketchDraw(session, [0, 0]);
    const moved = updateSketchPointer(started, [4, 3]);
    const accepted = acceptSketchDraw(moved, [4, 3]);

    expect(
      accepted.definition.entityIds.length,
      "Rectangle commit output should add four line entities.",
    ).toBe(4);
    expect(
      accepted.definition.constraintIds.length,
      "Rectangle commit output should add horizontal and vertical constraints.",
    ).toBe(4);
    expect(
      accepted.definition.dimensionIds.length,
      "Rectangle commit output should add width and height dimensions.",
    ).toBe(2);
    expect(
      accepted.toolStagedEntities.length,
      "Accepted rectangle geometry should clear preview entities.",
    ).toBe(0);
    expect(
      deriveSketchDisplayEntities(accepted).every(
        (entity) => entity.status === "accepted",
      ),
      "Accepted rectangle display geometry should derive from committed entities.",
    ).toBeTruthy();
  }

  function drawSketchTool(
    toolId: Parameters<typeof beginSketchTool>[1],
    points: readonly [number, number][],
  ) {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      toolId,
    );
    session = startSketchDraw(session, points[0]!);
    for (const point of points.slice(1)) {
      session = acceptSketchDraw(session, point);
    }

    // A fit-point spline commits only when finalized (T11i); for every other
    // tool this is a no-op.
    return finalizeSketchDraw(session);
  }

  function testPointAndMidpointLineConstructorsCommitDurableIntent() {
    // Point commits on a single click (T11-D19).
    const pointSession = drawSketchTool("point", [[1, 2]]);
    expect(
      pointSession.definition.entities[0]?.kind,
      "Point constructor should commit a durable point entity.",
    ).toBe("point");
    expect(
      pointSession.definition.entities,
      "One click should commit exactly one point entity.",
    ).toHaveLength(1);
    expect(
      pointSession.commitRequest?.definition.entities[0]?.kind,
      "Point commit request should include durable point geometry.",
    ).toBe("point");

    const midpointSession = drawSketchTool("midpointLine", [
      [1, 1],
      [3, 1],
    ]);
    const line = midpointSession.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    );
    const midpointConstraint = midpointSession.definition.constraints.find(
      (constraint) => constraint.kind === "midpoint",
    );
    expect(
      line?.kind,
      "Midpoint line should commit a durable line segment.",
    ).toBe("lineSegment");
    expect(
      midpointConstraint?.kind,
      "Midpoint line should commit midpoint intent.",
    ).toBe("midpoint");
  }

  function testRectangleConstructorsCommitDurableIntent() {
    const centerRectangle = drawSketchTool("centerPointRectangle", [
      [0, 0],
      [2, 1],
    ]);
    expect(
      centerRectangle.definition.entities.filter(
        (entity) => entity.kind === "lineSegment",
      ).length,
      "Center rectangle should commit four edges and two construction diagonals.",
    ).toBe(6);
    expect(
      centerRectangle.definition.constraints.filter(
        (constraint) => constraint.kind === "midpoint",
      ).length,
      "Center rectangle should preserve center intent through midpoint constraints.",
    ).toBe(2);

    const alignedRectangle = drawSketchTool("alignedRectangle", [
      [0, 0],
      [4, 0],
      [4, 3],
    ]);
    expect(
      alignedRectangle.definition.entities.length,
      "Aligned rectangle should commit four line entities.",
    ).toBe(4);
    expect(
      alignedRectangle.definition.constraints.some(
        (constraint) => constraint.kind === "parallel",
      ) &&
        alignedRectangle.definition.constraints.some(
          (constraint) => constraint.kind === "perpendicular",
        ) &&
        alignedRectangle.definition.constraints.some(
          (constraint) => constraint.kind === "equalLength",
        ),
      "Aligned rectangle should preserve parallel, perpendicular, and equal-length intent.",
    ).toBeTruthy();
  }

  function testCircleArcAndPolygonConstructorsCommitDurableIntent() {
    const threePointCircle = drawSketchTool("threePointCircle", [
      [0, 1],
      [1, 0],
      [0, -1],
    ]);
    expect(
      threePointCircle.definition.entities[0]?.kind,
      "3-point circle should commit a durable circle.",
    ).toBe("circle");
    expect(
      threePointCircle.definition.constraints.filter(
        (constraint) => constraint.kind === "pointOnCurve",
      ).length,
      "3-point circle should preserve its defining perimeter points.",
    ).toBe(3);

    const centerArc = drawSketchTool("centerPointArc", [
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
    expect(
      centerArc.definition.entities[0]?.kind,
      "Center-point arc should commit a durable arc.",
    ).toBe("arc");

    const threePointArc = drawSketchTool("threePointArc", [
      [1, 0],
      [0, 1],
      [-1, 0],
    ]);
    expect(
      threePointArc.definition.entities[0]?.kind,
      "3-point arc should commit a durable arc.",
    ).toBe("arc");
    expect(
      threePointArc.definition.constraints.some(
        (constraint) => constraint.kind === "pointOnCurve",
      ),
      "3-point arc should preserve its through-point relationship.",
    ).toBeTruthy();

    const tangentArc = drawSketchTool("tangentArc", [
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    expect(
      tangentArc.definition.entities[0]?.kind,
      "Tangent arc should commit a durable arc.",
    ).toBe("arc");

    const inscribedPolygon = drawSketchTool("inscribedPolygon", [
      [0, 0],
      [0, 2],
    ]);
    expect(
      inscribedPolygon.definition.entities.filter(
        (entity) => entity.kind === "lineSegment",
      ).length,
      "Inscribed polygon should commit a closed line loop.",
    ).toBe(6);
    expect(
      inscribedPolygon.definition.constraints.some(
        (constraint) => constraint.kind === "pointOnCurve",
      ),
      "Inscribed polygon should constrain vertices to its construction circle.",
    ).toBeTruthy();

    const circumscribedPolygon = drawSketchTool("circumscribedPolygon", [
      [0, 0],
      [0, 2],
    ]);
    expect(
      circumscribedPolygon.definition.entities.filter(
        (entity) => entity.kind === "lineSegment",
      ).length,
      "Circumscribed polygon should commit a closed line loop.",
    ).toBe(6);
    expect(
      circumscribedPolygon.definition.constraints.some(
        (constraint) => constraint.kind === "tangent",
      ),
      "Circumscribed polygon should constrain sides tangent to its construction circle.",
    ).toBeTruthy();
  }

  function testSplineCollectsFitPointsUntilFinalizedAndCommitsDurableGeometry() {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      "spline",
    );

    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [1, 2]);

    expect(
      session.status,
      "Spline should keep collecting after the second point.",
    ).toBe("drawing");
    expect(
      session.definition.entities.length,
      "Spline should not commit before it is finalized.",
    ).toBe(0);
    expect(
      session.toolStagedEntities.some(
        (entity) => entity.kind === "spline" && entity.status === "preview",
      ),
      "Spline should stage preview geometry while collecting points.",
    ).toBeTruthy();

    // T11i: the third click no longer completes the spline (T11-D10).
    session = acceptSketchDraw(session, [3, 0]);
    session = acceptSketchDraw(session, [4, 2]);
    expect(
      session.status,
      "Further clicks keep adding fit points instead of committing.",
    ).toBe("drawing");
    expect(session.definition.entities).toHaveLength(0);
    expect(session.toolPlacedPoints).toEqual([
      [0, 0],
      [1, 2],
      [3, 0],
      [4, 2],
    ]);

    session = finalizeSketchDraw(session);

    expect(
      session.status,
      "Spline should return to idle after its first complete curve.",
    ).toBe("idle");
    expect(session.activeTool, "Spline stays armed after finalize.").toBe(
      "spline",
    );
    expect(
      session.definition.entities[0]?.kind,
      "Spline commit output should add a durable spline entity.",
    ).toBe("spline");
    expect(
      session.definition.points.map(({ position }) => position),
      "Spline commit output should add all of its fit points (no 3-point cap).",
    ).toEqual([
      [0, 0],
      [1, 2],
      [3, 0],
      [4, 2],
    ]);
    expect(
      session.definition.entities[0]?.kind === "spline" &&
        session.definition.entities[0].pointOccurrences.length,
    ).toBe(4);
    expect(
      session.commitRequest?.definition.entities[0]?.kind,
      "Spline commit request should include durable spline geometry.",
    ).toBe("spline");
    expect(
      session.toolStagedEntities.length,
      "Spline commit should clear staged preview geometry.",
    ).toBe(0);
  }

  function testSplineIgnoresCoincidentFitPointReleases() {
    const tool = getSketchToolDefinition("spline");
    const activated = tool.activate();
    const first = tool.pointerRelease({
      state: activated.state,
      point: [0, 0],
    });
    const normalSecond = tool.pointerRelease({
      state: first.state,
      point: [1, 0],
    });

    expect(
      normalSecond.presentation.steps[0]?.label,
      "A released partial spline should count authored occurrences without appending its consumed live point.",
    ).toBe("2 points");
    expect(
      tool.getStagedEntities(normalSecond.state).length,
      "A normal released partial spline should retain its preview instead of reconstructing a duplicate live occurrence.",
    ).toBe(1);

    // T11i: a release on the last fit point is ignored (T11-D13), so no
    // coincident fit point is ever authored by the tool.
    const duplicateSecond = tool.pointerRelease({
      state: first.state,
      point: [0, 0],
    });
    expect(
      duplicateSecond.state.placedPoints,
      "A release on the last fit point adds no fit point.",
    ).toEqual([[0, 0]]);
    expect(
      duplicateSecond.state.status,
      "The ignored release keeps the draft.",
    ).toBe("drawing");
    expect(
      duplicateSecond.state.validationMessage,
      "An ignored release is not an error.",
    ).toBeNull();

    const afterIgnored = tool.pointerRelease({
      state: duplicateSecond.state,
      point: [2, 0],
    });
    expect(
      afterIgnored.state.status,
      "A release never completes the spline; it adds the next fit point.",
    ).toBe("drawing");
    expect(afterIgnored.state.placedPoints).toEqual([
      [0, 0],
      [2, 0],
    ]);

    const ignoredSession = drawSketchTool("spline", [
      [0, 0],
      [0, 0],
      [2, 0],
    ]);
    expect(
      ignoredSession.definition.points.map(({ position }) => position),
      "The finalized spline keeps only the genuinely distinct fit points.",
    ).toEqual([
      [0, 0],
      [2, 0],
    ]);
    const ignoredSolvedSpline = solveSketchDefinitionCore({
      definition: ignoredSession.definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    }).solvedSnapshot.solvedEntities.find((entity) => entity.kind === "spline");
    expect(
      ignoredSolvedSpline?.kind === "spline" &&
        ignoredSolvedSpline.reconstruction.validity,
      "The owner reconstructs the finalized spline as valid.",
    ).toBe("valid");
    expect(
      getSketchSessionDerivedValidity(ignoredSession).state,
      "An ignored duplicate click leaves no invalid derived state behind.",
    ).not.toBe("invalid");

    // Review R-1: the tool cannot author consecutive coincident fit points,
    // but a restore (Undo, load) or a drag can. Move the middle fit point of
    // a finalized spline onto the first and rebuild the session.
    const distinctSession = drawSketchTool("spline", [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const [firstFitPoint, middleFitPoint] = distinctSession.definition.points;
    const coincidentSession = rebuildSessionForDefinition(distinctSession, {
      definition: {
        ...distinctSession.definition,
        points: distinctSession.definition.points.map((point) =>
          point.pointId === middleFitPoint!.pointId
            ? { ...point, position: firstFitPoint!.position }
            : point,
        ),
      },
    });
    const invalidSpline = coincidentSession.definition.entities[0];
    expect(
      coincidentSession.definition.points.map(({ position }) => position),
      "premise: the restored spline has consecutive coincident fit points",
    ).toEqual([
      [0, 0],
      [0, 0],
      [2, 0],
    ]);
    const invalidSolvedSpline = solveSketchDefinitionCore({
      definition: coincidentSession.definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    }).solvedSnapshot.solvedEntities.find(
      (entity) => entity.entityId === invalidSpline?.entityId,
    );
    expect(
      invalidSolvedSpline?.kind === "spline" &&
        invalidSolvedSpline.reconstruction.diagnostics,
      "The reconstruction owner should diagnose the retained coincident occurrences.",
    ).toEqual([{ code: "coincident-points", spanIndex: 0 }]);
    expect(
      getSketchSessionDerivedValidity(coincidentSession).state,
      "A coincident spline from a restore becomes invalid derived state rather than a modal tool trap.",
    ).toBe("invalid");

    const nearDistinctSession = drawSketchTool("spline", [
      [0, 0],
      [1, 0],
      [1.00005, 0],
    ]);
    expect(
      nearDistinctSession.definition.points.map(({ position }) => position),
      "Distinct fit points below the removed tool epsilon should remain authored owner input.",
    ).toEqual([
      [0, 0],
      [1, 0],
      [1.00005, 0],
    ]);
    const nearDistinctSolved = solveSketchDefinitionCore({
      definition: nearDistinctSession.definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    }).solvedSnapshot.solvedEntities.find((entity) => entity.kind === "spline");
    expect(
      nearDistinctSolved?.kind === "spline" &&
        nearDistinctSolved.reconstruction.validity,
      "Near-but-distinct fit points should remain valid owner reconstruction input.",
    ).toBe("valid");

    const distinctSecond = tool.pointerRelease({
      state: first.state,
      point: [1, 0],
    });
    const liveOnLast = tool.pointerMove({
      state: distinctSecond.state,
      point: [1, 0],
    });
    expect(
      liveOnLast.state.validationMessage,
      "A live pointer on the last fit point (where a release is ignored) is not an error.",
    ).toBeNull();
    expect(liveOnLast.presentation.validation).toEqual([]);
    expect(
      liveOnLast.stagedEntities.map((entity) => entity.kind),
      "The preview keeps refitting through the placed points.",
    ).toEqual(["spline"]);
    expect(
      liveOnLast.presentation.completionHints?.[0],
      "With the minimum placed, the guidance offers finalizing the spline.",
    ).toMatchObject({
      text: "Press Enter, double-click or press Escape to finish the spline",
      ready: true,
    });
    expect(
      liveOnLast.presentation.completionHints?.[0]?.text,
      "A complete candidate should never request zero or a negative number of additional points.",
    ).not.toMatch(/Place (?:0|-\d+) more/);
    expect(
      tool.pointerMove({ state: first.state, point: [3, 0] }).presentation
        .completionHints?.[0],
      "Below the minimum, the guidance asks for the missing point.",
    ).toMatchObject({ text: "Place 1 more point", ready: false });
    const validLive = tool.pointerMove({
      state: liveOnLast.state,
      point: [1.00005, 0],
    });
    expect(
      validLive.state.validationMessage,
      "Live candidate validation should recompute instead of sticking to an earlier position.",
    ).toBeNull();
    expect(
      validLive.stagedEntities[0]?.kind === "spline" &&
        validLive.stagedEntities[0].points.length,
      "A live point just off the last fit point extends the preview.",
    ).toBeGreaterThan(
      liveOnLast.stagedEntities[0]?.kind === "spline"
        ? liveOnLast.stagedEntities[0].points.length
        : Infinity,
    );
  }

  async function testAdvancedCurveConstructorsCommitDurableIntent() {
    const ellipse = drawSketchTool("ellipse", [
      [0, 0],
      [2, 0],
      [0, 1],
    ]);
    expect(
      ellipse.definition.entities[0]?.kind,
      "Ellipse tool should commit a durable ellipse entity.",
    ).toBe("ellipse");
    expect(
      ellipse.definition.points.length,
      "Ellipse tool should persist center and major-axis defining points.",
    ).toBe(2);
    expect(
      getSketchSessionDisplayRenderables(ellipse).some(
        (renderable) =>
          renderable.target?.kind === "sketchEntity" &&
          renderable.target.entityId ===
            ellipse.definition.entities[0]?.entityId &&
          renderable.geometry.kind === "polyline",
      ),
      "Committed ellipse should render with a stable sketch entity target.",
    ).toBeTruthy();

    const ellipticalArc = drawSketchTool("ellipticalArc", [
      [0, 0],
      [3, 0],
      [0, 1],
      [3, 0],
      [0, 1],
    ]);
    expect(
      ellipticalArc.definition.entities[0]?.kind,
      "Elliptical arc tool should commit durable elliptical arc geometry.",
    ).toBe("ellipticalArc");

    const conic = drawSketchTool("conic", [
      [0, 0],
      [1, 2],
      [2, 0],
    ]);
    expect(
      conic.definition.entities[0]?.kind,
      "Conic tool should commit durable conic geometry.",
    ).toBe("conic");
    const solvedConic = solveSketchDefinitionCore({
      definition: conic.definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const conicRegions = await regionSolver.deriveSketchRegions({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: "request_regions",
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_draft",
      definition: conic.definition,
      solvedSnapshot: solvedConic.solvedSnapshot,
      projectedReferences: [],
      modelingTolerance: 1e-6,
    });
    expect(
      conicRegions.diagnostics.some(
        (diagnostic) => diagnostic.code === "region-unsupported-curve",
      ),
      "Valid advanced curves that are not profile-capable yet should emit region-unsupported-curve diagnostics.",
    ).toBeTruthy();

    const bezier = drawSketchTool("bezierCurve", [
      [0, 0],
      [1, 2],
      [2, 2],
      [3, 0],
    ]);
    expect(
      bezier.definition.entities[0]?.kind,
      "Bezier tool should commit durable Bezier geometry.",
    ).toBe("bezierCurve");
    expect(
      bezier.definition.entities[0]?.kind === "bezierCurve" &&
        bezier.definition.entities[0].degree === 3,
      "Bezier tool should preserve cubic degree.",
    ).toBeTruthy();

    const controlSpline = drawSketchTool("controlPointSpline", [
      [0, 0],
      [1, 2],
      [2, 2],
      [3, 0],
    ]);
    expect(
      controlSpline.definition.entities[0]?.kind,
      "Control-point spline should use the faithful cubic Bezier representation.",
    ).toBe("bezierCurve");
    expect(
      controlSpline.definition.entities[0]?.kind === "bezierCurve" &&
        controlSpline.definition.entities[0].degree === 3,
      "Control-point spline should stay distinct from ordinary interpolation.",
    ).toBeTruthy();

    const fitSpline = drawSketchTool("spline", [
      [0, 0],
      [1, 2],
      [2, 0],
    ]);
    expect(
      fitSpline.definition.entities[0]?.kind === "spline" &&
        fitSpline.definition.entities[0].interpolationPolicy ===
          "centripetal-mean-arm-v1" &&
        fitSpline.definition.entities[0].pointOccurrences.length === 3,
      "Fit-point spline should commit the complete ordinary-spline aggregate.",
    ).toBeTruthy();
  }

  function testAdvancedToolValidationRejectsDegenerateInput() {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      "ellipse",
    );
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [1, 0]);
    session = acceptSketchDraw(session, [2, 0]);

    expect(
      session.definition.entities.length,
      "Invalid ellipse input should not mutate the authored sketch definition.",
    ).toBe(0);
    expect(
      session.validationMessage,
      "Invalid ellipse input should report validation feedback.",
    ).toBe("Ellipse requires non-zero major and minor radii.");
  }

  async function testProfileTextCommitsEditableTextAndDerivedProfile() {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      "profileText",
    );
    session = patchSketchDrawingToolValue(session, {
      intent: "setToolSetting",
      key: "text",
      value: "CUT",
    });
    session = patchSketchDrawingToolValue(session, {
      intent: "setToolSetting",
      key: "horizontalAlign",
      value: "center",
    });
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [0, 2]);

    const textEntity = session.definition.entities[0];
    expect(
      textEntity?.kind,
      "Text tool should commit a durable profileText entity.",
    ).toBe("profileText");
    expect(
      textEntity.kind === "profileText" && textEntity.text === "CUT",
      "Text tool should preserve editable text content.",
    ).toBeTruthy();
    expect(
      textEntity.kind === "profileText" &&
        textEntity.horizontalAlign === "center",
      "Text tool should persist placement options.",
    ).toBeTruthy();
    expect(
      getSketchSessionDisplayRenderables(session).some(
        (renderable) =>
          renderable.target?.kind === "sketchEntity" &&
          renderable.target.entityId === textEntity.entityId &&
          renderable.geometry.kind === "polyline",
      ),
      "Committed text should render with a stable sketch entity target.",
    ).toBeTruthy();

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
    const regions = await regionSolver.deriveSketchRegions({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: "request_regions",
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_draft",
      definition: session.definition,
      solvedSnapshot: solved.solvedSnapshot,
      projectedReferences: [],
      modelingTolerance: 1e-6,
    });

    // U4: profile text has no exact neutral boundary yet; it is an
    // unsupported region curve with a targeted diagnostic, not a sampled box.
    expect(
      regions.regions,
      "Profile text derives no region until an exact text boundary exists (U4).",
    ).toEqual([]);
    expect(
      regions.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "region-unsupported-curve" &&
          diagnostic.target?.kind === "entity" &&
          diagnostic.target.entityId === textEntity.entityId,
      ),
      "Profile text reports region-unsupported-curve targeted at the text entity.",
    ).toBeTruthy();
  }

  function testInvalidProfileTextDoesNotCommitPartialEntity() {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      "profileText",
    );
    session = patchSketchDrawingToolValue(session, {
      intent: "setToolSetting",
      key: "text",
      value: "   ",
    });
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [0, 2]);

    expect(
      session.definition.entities.length,
      "Invalid text input should not commit a partial profileText entity.",
    ).toBe(0);
    expect(
      session.validationMessage,
      "Invalid text should report validation feedback.",
    ).toBe("Text content is required.");
  }

  function testFullSplinePreviewsMatchCommittedGeometry() {
    let ordinary = beginSketchTool(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      "spline",
    );
    ordinary = startSketchDraw(ordinary, [0, 0]);
    ordinary = acceptSketchDraw(ordinary, [1, 2]);
    const ordinaryPreviewSession = updateSketchPointer(ordinary, [2, 0]);
    const ordinaryPreview = ordinaryPreviewSession.toolStagedEntities.find(
      (entity) => entity.id === "preview-spline" && entity.kind === "spline",
    );
    const ordinaryCommitted = finalizeSketchDraw(
      acceptSketchDraw(ordinaryPreviewSession, [2, 0]),
    );
    const ordinaryOutput = deriveSketchDisplayEntities(ordinaryCommitted).find(
      (entity) => entity.label === "Spline 1" && entity.kind === "spline",
    );
    expect(ordinaryPreview?.points).toEqual(ordinaryOutput?.points);
    expect(
      ordinaryPreview?.points.length,
      "A complete ordinary-spline preview should be owner-reconstructed curve geometry, not its three-point control polygon.",
    ).toBeGreaterThan(3);

    let control = beginSketchTool(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      "controlPointSpline",
    );
    control = startSketchDraw(control, [0, 0]);
    control = acceptSketchDraw(control, [1, 2]);
    control = acceptSketchDraw(control, [2, 2]);
    const controlPreviewSession = updateSketchPointer(control, [3, 0]);
    const controlPreview = controlPreviewSession.toolStagedEntities.find(
      (entity) =>
        entity.id === "preview-control-spline" && entity.kind === "polyline",
    );
    const controlCommitted = acceptSketchDraw(controlPreviewSession, [3, 0]);
    const controlOutput = deriveSketchDisplayEntities(controlCommitted).find(
      (entity) =>
        entity.label === "Control spline 1" && entity.kind === "polyline",
    );
    expect(controlPreview?.points).toEqual(controlOutput?.points);
    expect(
      controlPreview?.points[32]?.[1],
      "A complete four-control-point preview should show the cubic Bezier curve rather than the control polygon.",
    ).toBeGreaterThan(1);
  }

  function testGenericPresentationAccessFromSession() {
    const session = beginSketchTool(
      createNewSketchSessionFromSupport(
        {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        OCC_KERNEL_SETTINGS,
      ),
      "line",
    );
    const presentation = getSketchToolPresentation(session);

    expect(
      presentation?.prompts[0]?.text,
      "Session presentation should be resolved through the active sketch tool schema.",
    ).toBe("Pick line start");
    expect(
      presentation?.validation?.length,
      "Newly activated sketch tools should expose validation as declarative schema state.",
    ).toBe(0);
  }

  testRegistryContainsCurrentSketchToolSet();
  testToolFamiliesAndDiscoveryExposePrimitiveConstructors();
  testLinePointerLifecycleProducesStagedGeometry();
  testCirclePresentationSchemaExposesPromptControlAndDiameterOverlay();
  testRectanglePresentationSchemaExposesAnchoredWidthAndHeightOverlays();
  testSessionRuntimeDelegatesCommitOutputToToolModule();
  testPointAndMidpointLineConstructorsCommitDurableIntent();
  testRectangleConstructorsCommitDurableIntent();
  testCircleArcAndPolygonConstructorsCommitDurableIntent();
  testSplineCollectsFitPointsUntilFinalizedAndCommitsDurableGeometry();
  testSplineIgnoresCoincidentFitPointReleases();
  await testAdvancedCurveConstructorsCommitDurableIntent();
  testAdvancedToolValidationRejectsDegenerateInput();
  await testProfileTextCommitsEditableTextAndDerivedProfile();
  testInvalidProfileTextDoesNotCommitPartialEntity();
  testFullSplinePreviewsMatchCommittedGeometry();
  testGenericPresentationAccessFromSession();
});
