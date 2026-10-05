import { describe, expect, test } from "vitest";

import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SketchDerivationDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import {
  FIXTURE_SKETCH_ID,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { publishSketchOffsets } from "@/contracts/sketch/offset-publication";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import { createCertifiedNeutralCurveRequestQuery } from "@/domain/modeling/neutral-curve-certification/query";
import {
  acceptSketchDraw,
  beginSketchTool,
  completeSketchOffsetPreviewPublication,
  finalizeSketchDraw,
  createNewSketchSessionFromSupport,
  createSketchSessionFromSnapshot,
  getSketchSessionDisplayRenderables,
  patchSketchEditToolValue,
  selectSketchEditToolTarget,
  startSketchDraw,
  type SketchSessionDisplayRenderable,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  getSketchPointMarkerVisibility,
  getSketchRevealedPointIds,
  getSketchToolMarkerPointIds,
  type SketchPointMarkerContext,
} from "@/domain/editor/sketch-session/display";
import { withLiveSolveBasis } from "@/domain/editor/sketch-session/internals";
import { mapSketchPointToWorld } from "@/domain/editor/sketch-session/state";
import { collectSketchInteractionGeometry } from "@/domain/sketch-interaction/geometry";

// Lane: logic (docs/testing.md). Seams: the pure marker rule
// `getSketchPointMarkerVisibility` over the session's display renderables
// (T11-D8), and the marker positions of `getSketchSessionDisplayRenderables`
// against the curve sources the display draws and
// `collectSketchInteractionGeometry` picks (review A-2), bitwise.

const pointId = (name: string) => `sketch_point_${name}` as SketchPointId;
const entityId = (name: string) => `sketch_entity_${name}` as SketchEntityId;
const pointRef = (name: string): PrimitiveRef => ({
  kind: "sketchPoint",
  sketchId: FIXTURE_SKETCH_ID,
  pointId: pointId(name),
});
const entityRef = (
  name: string,
  sketchId: SketchId = FIXTURE_SKETCH_ID,
): PrimitiveRef => ({
  kind: "sketchEntity",
  sketchId,
  entityId: entityId(name),
});

/**
 * A line, arc, circle and spline; a free point and a Point-tool point; a
 * mirror (about a construction axis) and an offset of the line whose output
 * points are authored at the origin, so only the derivation places them.
 * `conflict` ties spline fit point s1 to a line with two conflicting
 * lengths: a not-accepted, best-effort live solve that moves s1.
 */
function markerSession({ conflict }: { conflict: boolean }) {
  const sketch = makeSketchFixture();
  sketch.point("la", 0.1, 0.2);
  sketch.point("lb", 3.3, 1.7);
  sketch.line("line", "la", "lb");
  sketch.point("ac", 6, 0.3);
  sketch.point("as", 7.5, 0.3);
  sketch.point("ae", 6, 1.8);
  sketch.arc("arc", "ac", "as", "ae");
  sketch.point("cc", 10.2, 1.1);
  sketch.circle("circle", "cc", 1.25);
  sketch.point("s0", 0.3, 5.1);
  sketch.point("s1", 1.3, 6.1);
  sketch.point("s2", 2.9, 4.7);
  sketch.point("s3", 4.4, 5.9);
  sketch.spline("spline", ["s0", "s1", "s2", "s3"], "open");
  sketch.point("free", -2.3, -2.1);
  // A Point-tool point on the circle (stays free: review R-1), a 3-point
  // circle style perimeter point and a midpoint line's midpoint.
  sketch.point("tool", 10.2, 2.35);
  sketch.pointOnCurve("tool", "circle");
  sketch.point("pc", 11.45, 1.1);
  sketch.pointOnCurve("pc", "circle");
  sketch.point("mid", 1.7, 0.95);
  sketch.midpoint("mid", "line");
  sketch.point("xa", -1, -5, true);
  sketch.point("xb", -1, 5, true);
  sketch.line("axis", "xa", "xb", true);
  sketch.point("ma", 0, 0);
  sketch.point("mb", 0, 0);
  sketch.line("mirrored", "ma", "mb");
  sketch.point("oa", 0, 0);
  sketch.point("ob", 0, 0);
  sketch.line("offset", "oa", "ob");
  if (conflict) {
    sketch.point("e", 1.3, 6.1);
    sketch.point("f", 1.3, 12);
    sketch.line("tie", "e", "f");
    sketch.coincident("s1", "e");
    sketch.lineLength("tie", 2);
    sketch.lineLength("tie", 9);
  }
  const input = sketch.build();
  const base = input.definition;
  const definition: SketchDefinition = {
    ...base,
    entityIds: [...base.entityIds, entityId("tool_point")],
    entities: [
      ...base.entities,
      {
        kind: "point",
        entityId: entityId("tool_point"),
        label: "tool_point",
        target: {
          kind: "sketchEntity",
          sketchId: FIXTURE_SKETCH_ID,
          entityId: entityId("tool_point"),
        },
        isConstruction: false,
        pointId: pointId("tool"),
      },
    ],
    derivedRelationships: [
      {
        derivationId: "mirror_line",
        kind: "mirror",
        label: "Mirror line",
        seedEntityIds: [entityId("line")],
        mirrorReference: { kind: "lineEntity", entityId: entityId("axis") },
        outputs: [
          {
            seedEntityId: entityId("line"),
            outputEntityId: entityId("mirrored"),
            instanceIndex: 1,
            seedPointIds: [pointId("la"), pointId("lb")],
            outputPointIds: [pointId("ma"), pointId("mb")],
          },
        ],
      },
      {
        derivationId: "offset_line",
        kind: "offset",
        label: "Offset line",
        seedEntityIds: [entityId("line")],
        distance: 0.75,
        jointPolicy: "trimExtendArcFallback",
        jointOutputs: [],
        piecewiseCubicOutputs: [],
        outputs: [
          {
            seedEntityId: entityId("line"),
            outputEntityId: entityId("offset"),
            instanceIndex: 1,
            seedPointIds: [pointId("la"), pointId("lb")],
            outputPointIds: [pointId("oa"), pointId("ob")],
          },
        ],
      } as SketchDerivationDefinition,
    ],
  };
  const opened = createSketchSessionFromSnapshot(
    sketchSnapshotRecordForTest(
      { ...input, definition },
      [],
      createStandardPlaneDefinition("yz"),
    ),
    OCC_KERNEL_SETTINGS,
  );
  return withLiveSolveBasis(opened, opened.definition);
}

function pointMarker(
  renderables: readonly SketchSessionDisplayRenderable[],
  name: string,
) {
  const marker = renderables.find(
    (renderable) =>
      renderable.geometry.kind === "marker" &&
      renderable.target?.kind === "sketchPoint" &&
      renderable.target.pointId === pointId(name) &&
      renderable.markerLayer === undefined,
  );
  if (!marker) throw new Error(`No marker for point ${name}.`);
  return marker;
}

const emptyContext: SketchPointMarkerContext = {
  hoverStack: [],
  hoverTarget: null,
  selection: [],
  toolPointIds: new Set(),
};

/** The rule as the viewport applies it: one revealed set, then per marker. */
function shown(
  renderables: readonly SketchSessionDisplayRenderable[],
  marker: SketchSessionDisplayRenderable,
  context: Partial<SketchPointMarkerContext>,
) {
  return getSketchPointMarkerVisibility(
    marker,
    getSketchRevealedPointIds(renderables, { ...emptyContext, ...context }),
  );
}

describe("T11f contextual point markers (T11-D8)", () => {
  test("the marker rule table: owner or point in the hover stack (anywhere), hovered, selected, or a tool anchor; free points and the origin always", () => {
    const session = markerSession({ conflict: false });
    const renderables = getSketchSessionDisplayRenderables(session);
    const lineEnd = pointMarker(renderables, "lb");
    const visible = (context: Partial<SketchPointMarkerContext>) =>
      shown(renderables, lineEnd, context);

    expect(
      lineEnd.pointMarker,
      "A line end point is contextual and owned by its line and by nothing else.",
    ).toEqual({
      visibility: "contextual",
      ownerEntityIds: [entityId("line")],
    });
    const rows: [string, Partial<SketchPointMarkerContext>, boolean][] = [
      ["nothing hovered or selected", {}, false],
      [
        "its line is the top of the hover stack",
        { hoverStack: [entityRef("line")] },
        true,
      ],
      [
        "its line is a non-top hover-stack entry",
        {
          hoverStack: [entityRef("arc"), entityRef("axis"), entityRef("line")],
        },
        true,
      ],
      [
        "only the point is in the stack (its line is not)",
        { hoverStack: [pointRef("lb")] },
        true,
      ],
      [
        "an unrelated stack",
        { hoverStack: [entityRef("arc"), pointRef("la")] },
        false,
      ],
      [
        "its line is hovered (a click or chooser preview)",
        { hoverTarget: entityRef("line") },
        true,
      ],
      ["the point itself is hovered", { hoverTarget: pointRef("lb") }, true],
      ["another curve is hovered", { hoverTarget: entityRef("circle") }, false],
      [
        "its line is selected",
        { selection: [entityRef("circle"), entityRef("line")] },
        true,
      ],
      ["the point itself is selected", { selection: [pointRef("lb")] }, true],
      [
        "the same entity id in another sketch",
        { hoverStack: [entityRef("line", "sketch_other" as SketchId)] },
        false,
      ],
      [
        "it anchors the active tool's draft",
        { toolPointIds: new Set([pointId("lb")]) },
        true,
      ],
    ];
    for (const [row, context, expected] of rows) {
      expect(visible(context), row).toBe(expected);
    }

    // Every curve's own points are contextual, owned by that curve.
    for (const [name, owner] of [
      ["ac", "arc"],
      ["as", "arc"],
      ["cc", "circle"],
      ["s2", "spline"],
      ["xa", "axis"],
      ["ma", "mirrored"],
      ["ob", "offset"],
    ] as const) {
      const marker = pointMarker(renderables, name);
      expect(marker.pointMarker, `${name} is owned by ${owner}.`).toEqual({
        visibility: "contextual",
        ownerEntityIds: [entityId(owner)],
      });
      expect(shown(renderables, marker, {})).toBe(false);
      expect(
        shown(renderables, marker, { hoverStack: [entityRef(owner)] }),
      ).toBe(true);
    }

    // Review R-1: a point tied to a curve only by a constraint (a 3-point
    // circle's perimeter point, a midpoint line's midpoint) is owned by that
    // curve.
    for (const [name, owner] of [
      ["pc", "circle"],
      ["mid", "line"],
    ] as const) {
      const marker = pointMarker(renderables, name);
      expect(
        marker.pointMarker,
        `${name} is owned by ${owner} through its constraint.`,
      ).toEqual({
        visibility: "contextual",
        ownerEntityIds: [entityId(owner)],
      });
      expect(shown(renderables, marker, {}), `${name} hidden`).toBe(false);
      expect(
        shown(renderables, marker, { hoverTarget: entityRef(owner) }),
        `hovering ${owner} reveals ${name}`,
      ).toBe(true);
    }

    // A free point (no entity, e.g. kept after Trim) and a Point-tool point
    // (only its own `point` entity, even constrained onto the circle) have
    // no owning curve: always shown.
    for (const name of ["free", "tool"]) {
      const marker = pointMarker(renderables, name);
      expect(marker.pointMarker, `${name} has no owning curve.`).toEqual({
        visibility: "always",
        ownerEntityIds: [],
      });
      expect(shown(renderables, marker, {}), name).toBe(true);
    }

    const origin = renderables.find(
      (renderable) =>
        renderable.target?.kind === "sketchDatumReference" &&
        renderable.target.datumId === "origin",
    )!;
    expect(
      shown(renderables, origin, {}),
      "The datum origin is always shown.",
    ).toBe(true);
  });

  test("a drawing tool's draft start point is a tool anchor; without an active tool there is none", () => {
    const session = markerSession({ conflict: false });
    const drawStartSnap = {
      key: "endpoint:lb",
      kind: "endpoint",
      point: [3.3, 1.7],
      rawPointer: [3.3, 1.7],
      distance: 0,
      priority: 0,
      sources: [
        { kind: "localPoint", pointId: pointId("lb") },
        {
          kind: "localEntity",
          entityId: entityId("line"),
          geometryKind: "lineSegment",
        },
      ],
      preview: {},
    } as unknown as SketchSessionState["drawStartSnap"];

    expect([
      ...getSketchToolMarkerPointIds({
        ...session,
        activeTool: "line",
        drawStartSnap,
      }),
    ]).toEqual([pointId("lb")]);
    expect(
      getSketchToolMarkerPointIds({
        ...session,
        activeTool: null,
        drawStartSnap,
      }).size,
    ).toBe(0);
    expect(
      getSketchToolMarkerPointIds({ ...session, activeTool: "line" }).size,
    ).toBe(0);
  });

  /**
   * Every marker equals, bitwise, the position its curve is drawn from and
   * picked from, per kind (review A-2).
   */
  function expectMarkersOnCurveSources(session: SketchSessionState) {
    const renderables = getSketchSessionDisplayRenderables(session);
    const marker = (name: string) => {
      const { geometry } = pointMarker(renderables, name);
      return geometry.kind === "marker" ? geometry.position : null;
    };
    const world = (point: SketchPoint2D) =>
      mapSketchPointToWorld(session.plane, point);
    const pick = collectSketchInteractionGeometry(session);
    const picked = (name: string) => {
      const geometry = pick.find(
        (entry) => entry.id === `sketch-entity:${entityId(name)}`,
      );
      if (!geometry) throw new Error(`No pick geometry for ${name}.`);
      return geometry;
    };
    const drawn = (name: string) => {
      const renderable = renderables.find(
        (entry) =>
          entry.geometry.kind === "polyline" &&
          entry.target?.kind === "sketchEntity" &&
          entry.target.entityId === entityId(name),
      );
      return renderable?.geometry.kind === "polyline"
        ? renderable.geometry.points
        : null;
    };

    for (const [line, start, end] of [
      ["line", "la", "lb"],
      ["mirrored", "ma", "mb"],
      ["offset", "oa", "ob"],
    ] as const) {
      const geometry = picked(line);
      if (geometry.kind !== "lineSegment") throw new Error(line);
      expect(
        [marker(start), marker(end)],
        `${line}: the end markers are the picked segment's ends, bitwise.`,
      ).toEqual([world(geometry.start), world(geometry.end)]);
      expect(
        [marker(start), marker(end)],
        `${line}: the end markers are the drawn segment's ends, bitwise.`,
      ).toEqual(drawn(line));
    }

    const arc = picked("arc");
    if (arc.kind !== "arc") throw new Error("arc");
    expect(
      [marker("ac"), marker("as"), marker("ae")],
      "Arc centre and end markers are the picked arc's, bitwise.",
    ).toEqual([world(arc.center), world(arc.start), world(arc.end)]);

    const circle = picked("circle");
    if (circle.kind !== "circle") throw new Error("circle");
    expect(
      marker("cc"),
      "The circle centre marker is the picked circle's centre, bitwise.",
    ).toEqual(world(circle.center));

    const spline = picked("spline");
    if (spline.kind !== "cubicSpans") throw new Error("spline");
    const fitPoints = [
      spline.spans[0]!.poles[0],
      ...spline.spans.map((span) => span.poles[3]),
    ];
    expect(
      ["s0", "s1", "s2", "s3"].map(marker),
      "Spline fit-point markers are the picked spans' knots, bitwise.",
    ).toEqual(fitPoints.map(world));
    const drawnSpline = drawn("spline")!;
    expect(
      ["s0", "s1", "s2", "s3"].map(marker),
      "Spline fit-point markers are the drawn spline's knot samples, bitwise.",
    ).toEqual([0, 16, 32, 48].map((index) => drawnSpline[index]));

    return { marker, world };
  }

  test("markers sit bitwise on their curves' drawn and picked sources under an accepted solve", () => {
    const session = markerSession({ conflict: false });
    expect(session.liveSolve?.accepted, "premise: accepted").toBe(true);
    const { marker, world } = expectMarkersOnCurveSources(session);
    // The derivations, not the authored origin positions, place the outputs.
    const mirrored = marker("ma")!;
    const expected = world([-2.1, 0.2]);
    expect(
      Math.hypot(...mirrored.map((value, axis) => value - expected[axis]!)),
      "premise: the mirror places ma at la reflected about x = -1",
    ).toBeLessThan(1e-12);
    expect(marker("oa")).not.toEqual(world([0, 0]));
  });

  test("markers sit bitwise on their curves' drawn and picked sources under a not-accepted, best-effort solve", () => {
    const session = markerSession({ conflict: true });
    expect(session.liveSolve?.accepted, "premise: not accepted").toBe(false);
    const solvedS1 = session.liveSolve!.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === pointId("s1"),
    )!.solvedPosition;
    expect(
      Math.hypot(solvedS1[0] - 1.3, solvedS1[1] - 6.1),
      "premise: the best-effort solve moves s1 off the drawn spline",
    ).toBeGreaterThan(0.1);
    const { marker, world } = expectMarkersOnCurveSources(session);
    expect(
      marker("s1"),
      "The marker stays on the drawn curve, not at the best-effort solved position.",
    ).toEqual(world([1.3, 6.1]));
  });

  test("an offset shell's driven terminal points are contextual, owned by the shell, and revealed by hovering it (review R-2)", () => {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport(
        { kind: "construction", constructionId: "construction_plane-xy" },
        OCC_KERNEL_SETTINGS,
      ),
      "spline",
    );
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [1, 0.6]);
    session = finalizeSketchDraw(acceptSketchDraw(session, [2, -0.4]));
    const seed = session.definition.entities[0]!;
    session = patchSketchEditToolValue(
      selectSketchEditToolTarget(
        beginSketchTool(session, "offset"),
        seed.target,
      ),
      { value: 0.2 },
    );
    // Commit, then deliver the preview's real publication (as in
    // sketch-offset-live-cutover.spec.ts).
    session = patchSketchEditToolValue(session, { intent: "commitOffset" });
    for (let round = 0; round < 2; round += 1) {
      const publication = session.activeEditTool?.offsetPublication;
      if (publication?.status !== "pending") break;
      const basis = publication.basis!;
      session = completeSketchOffsetPreviewPublication(
        session,
        publication.derivationId,
        publishSketchOffsets({
          definition: basis.definition,
          solvedSnapshot: basis.solvedSnapshot,
          modelingTolerance: basis.modelingTolerance,
          capabilities: {
            query: createCertifiedNeutralCurveRequestQuery(),
            certifier: createCertifiedCubicTubeChain(),
          },
        }),
      );
    }
    const relationship = session.definition.derivedRelationships?.find(
      (entry) => entry.kind === "offset",
    );
    const shell =
      relationship?.kind === "offset"
        ? relationship.piecewiseCubicOutputs[0]
        : undefined;
    if (!shell) throw new Error("premise: the offset committed a shell");
    const shellRef: PrimitiveRef = {
      kind: "sketchEntity",
      sketchId: session.sketchId ?? ("sketch_draft" as SketchId),
      entityId: shell.outputEntityId,
    };
    const renderables = getSketchSessionDisplayRenderables(session);
    for (const terminal of [shell.startPointId, shell.endPointId]) {
      const marker = renderables.find(
        (renderable) =>
          renderable.geometry.kind === "marker" &&
          renderable.target?.kind === "sketchPoint" &&
          renderable.target.pointId === terminal,
      );
      if (!marker) throw new Error(`No marker for terminal ${terminal}.`);
      expect(
        marker.pointMarker,
        "A shell terminal is contextual and owned by the shell alone.",
      ).toEqual({
        visibility: "contextual",
        ownerEntityIds: [shell.outputEntityId],
      });
      expect(shown(renderables, marker, {}), "hidden by default").toBe(false);
      expect(
        shown(renderables, marker, { hoverStack: [shellRef] }),
        "hovering the shell reveals its terminal",
      ).toBe(true);
    }
  });
});
