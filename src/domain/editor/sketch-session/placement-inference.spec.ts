import { describe, expect, test } from "vitest";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  SketchDefinition,
} from "@/contracts/sketch/schema";
import type { SketchToolId } from "@/core/sketch-tools/definition";
import { getSketchToolDefinition } from "@/core/sketch-tools/registry";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  finalizeSketchDraw,
  patchSketchDrawingToolValue,
  startSketchDraw,
  updateSketchPointer,
} from "@/domain/editor/sketch-session";
import {
  createSessionCommitFactories,
  rebuildSessionForDefinition,
} from "@/domain/editor/sketch-session/internals";
import type { SketchSessionState } from "@/domain/editor/sketch-session/types";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/domain/editor/sketch-session/test-snap-scale";
import {
  bindPlacementInferences,
  inferPlacementFromCandidate,
  type InferredRequirement,
} from "@/domain/sketch-inference/placement-inference";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";

// T13g (T13-D15–D21): what a placement shows before its click is exactly
// what its commit authors. Every row reads the shown text from the tool
// overlays (the viewport's seam) and the authored relations from the
// committed definition, and compares both with the stored inference.

type Session = SketchSessionState;
type Click = readonly [number, number];

function blank(): Session {
  return createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
}

/** Draws `clicks` with a tool; with no snap scale nothing snaps. */
function drawFree(session: Session, toolId: SketchToolId, clicks: Click[]) {
  return draw(session, toolId, clicks).session;
}

interface Shown {
  /** The snap glyph's kind and label the viewport renders at the pointer. */
  candidateKind: string | null;
  label: string | null;
  /** The "Inferred constraint" preview's detail. */
  detail: string | null;
}

/**
 * Hovers then clicks each point; a fit-point tool is finalized. Returns the
 * shown feedback before every click.
 */
function draw(session: Session, toolId: SketchToolId, clicks: Click[]) {
  let current = beginSketchTool(session, toolId);
  const shown: Shown[] = [];
  clicks.forEach((click, index) => {
    current = updateSketchPointer(current, [...click]);
    const overlays = current.toolPresentation?.overlays ?? [];
    const glyph = overlays.find((overlay) => overlay.id === "active-snap");
    const preview = overlays.find(
      (overlay) => overlay.id === "active-snap-inferred-constraint",
    );
    shown.push({
      candidateKind:
        glyph?.kind === "snapIndicator" ? glyph.candidateKind : null,
      label: glyph?.kind === "snapIndicator" ? glyph.label : null,
      detail: preview?.kind === "constraintPreview" ? preview.detail : null,
    });
    current =
      index === 0
        ? startSketchDraw(current, [...click])
        : acceptSketchDraw(current, [...click]);
  });
  if (typeof getSketchToolDefinition(toolId).lifecycle === "object") {
    current = finalizeSketchDraw(current);
  }
  return { session: current, shown };
}

/** The rendered label of a placement badge (`placement-N-snap`). */
function badgeLabel(session: Session, id: string) {
  const badge = session.toolPresentation?.overlays?.find(
    (overlay) => overlay.id === id,
  );
  return badge?.kind === "snapIndicator" ? badge.label : null;
}

/** The relations a commit authored, named by their pre-existing targets. */
function authoredRelations(before: SketchDefinition, after: SketchDefinition) {
  const oldPointIds = new Set(before.points.map(({ pointId }) => pointId));
  const oldEntityIds = new Set(before.entities.map(({ entityId }) => entityId));
  const oldConstraintIds = new Set(
    before.constraints.map(({ constraintId }) => constraintId),
  );
  const joins = after.entities
    .filter((entity) => !oldEntityIds.has(entity.entityId))
    .flatMap((entity) =>
      entity.kind === "lineSegment"
        ? [entity.startPointId, entity.endPointId]
        : [],
    )
    .filter((pointId) => oldPointIds.has(pointId))
    .map((pointId) => `joins:${pointId}`);
  const constraints = after.constraints
    .filter(({ constraintId }) => !oldConstraintIds.has(constraintId))
    .map((constraint) =>
      describeConstraint(constraint, oldPointIds, oldEntityIds),
    );

  return { joins, constraints };
}

function describeConstraint(
  constraint: ConstraintDefinition,
  oldPointIds: ReadonlySet<string>,
  oldEntityIds: ReadonlySet<string>,
) {
  const operand = (value: {
    kind: string;
    datum?: string;
    reference?: { geometryId: string };
  }) => value.datum ?? value.reference?.geometryId ?? "";
  const entity = (entityId: string) =>
    oldEntityIds.has(entityId) ? entityId : "new";
  switch (constraint.kind) {
    case "coincident":
      return `coincident:${constraint.pointIds.filter((id) => oldPointIds.has(id)).join(",")}`;
    case "midpoint":
      return `midpoint:${entity(constraint.line.entityId)}`;
    case "pointOnCurve":
      return `pointOnCurve:${entity(constraint.curve.entityId)}`;
    case "concentric":
    case "perpendicular":
    case "tangent":
    case "parallel":
    case "equalLength":
      return `${constraint.kind}:${constraint.entityIds.filter((id) => oldEntityIds.has(id)).join(",")}`;
    case "coincidentProjectedPoint":
      return `${constraint.kind}:${operand(constraint.projectedPoint)}`;
    case "pointOnProjectedCurve":
      return `${constraint.kind}:${operand(constraint.projectedCurve)}`;
    default:
      return constraint.kind;
  }
}

function describeRequirement(requirement: InferredRequirement) {
  switch (requirement.kind) {
    case "joins":
    case "coincident":
      return `${requirement.kind}:${requirement.pointId}`;
    case "midpoint":
    case "pointOnCurve":
    case "concentric":
    case "perpendicular":
    case "tangent":
      return `${requirement.kind}:${requirement.entityId}`;
    case "horizontal":
    case "vertical":
      return requirement.kind;
    default:
      return `${requirement.kind}:${
        "datum" in requirement.target
          ? requirement.target.datum
          : requirement.target.reference.geometryId
      }`;
  }
}

/**
 * Draws with the tool and returns: the shown feedback per click, the
 * stored inferences' requirements, and what the commit authored beyond the
 * tool's own primitive relations (the same tool drawn free).
 */
function drawAndCompare(
  session: Session,
  toolId: SketchToolId,
  clicks: Click[],
) {
  // The stored placements are read just before the final click commits.
  let beforeFinal = beginSketchTool(session, toolId);
  clicks.slice(0, -1).forEach((click, index) => {
    beforeFinal =
      index === 0
        ? startSketchDraw(beforeFinal, [...click])
        : acceptSketchDraw(beforeFinal, [...click]);
  });
  const finalHover = updateSketchPointer(beforeFinal, [...clicks.at(-1)!]);
  const placements = [
    ...(finalHover.toolPlacements ?? []),
    finalHover.activeInference!,
  ];

  const { session: after, shown } = draw(session, toolId, clicks);
  // The tool's own relations do not depend on where its clicks snapped.
  const free = drawFree(blank(), toolId, clicks);
  const primitive = authoredRelations(
    blank().definition,
    free.definition,
  ).constraints;
  const authored = authoredRelations(session.definition, after.definition);
  const inferredConstraints = [...authored.constraints];
  for (const own of primitive) {
    const index = inferredConstraints.indexOf(own);
    if (index !== -1) inferredConstraints.splice(index, 1);
  }

  return {
    after,
    shown,
    placements,
    requirements: placements
      .flatMap((placement) => placement?.requirements ?? [])
      .map(describeRequirement)
      .sort(),
    authored: [...authored.joins, ...inferredConstraints].sort(),
  };
}

/**
 * The shared fixture, drawn free (no snap scale) and then given the spec
 * scale: Line 1, Circle 2, Spline 3, a vertical Line 4 crossing Line 1, a
 * centre-point arc.
 */
function fixture() {
  let session = blank();
  session = drawFree(session, "line", [
    [2, 2],
    [6, 3],
  ]);
  session = drawFree(session, "circle", [
    [10, 10],
    [12, 10],
  ]);
  session = drawFree(session, "spline", [
    [2, 8],
    [4, 9],
    [6, 8],
  ]);
  session = drawFree(session, "line", [
    [3, 0.5],
    [3, 5],
  ]);
  session = beginSketchTool(session, "point");
  session = withSketchSnapScale(session, SPEC_SKETCH_UNITS_PER_PIXEL);
  const { definition } = session;
  const ofKind = (kind: string) =>
    definition.entities.filter((entity) => entity.kind === kind);
  const [line1, line4] = ofKind("lineSegment");
  const [circle] = ofKind("circle");
  const [spline] = ofKind("spline");
  if (
    line1?.kind !== "lineSegment" ||
    line4?.kind !== "lineSegment" ||
    circle?.kind !== "circle" ||
    !spline
  ) {
    throw new Error("fixture: unexpected entities");
  }
  const pointLabel = (pointId: SketchPointId) =>
    definition.points.find((point) => point.pointId === pointId)!.label;
  const entityLabel = (entityId: SketchEntityId) =>
    definition.entities.find((entity) => entity.entityId === entityId)!.label;
  return { session, line1, line4, circle, spline, pointLabel, entityLabel };
}

describe("T13g shown == authored: tool × placement role × candidate kind", () => {
  test("Point × point × endpoint: coincident with the line end, named", () => {
    const { session, line1, pointLabel } = fixture();
    const result = drawAndCompare(session, "point", [[6.05, 3.05]]);
    const expected = [`coincident:${line1.endPointId}`];
    expect(result.authored, "committed").toEqual(expected);
    expect(result.requirements, "stored inference").toEqual(expected);
    expect(result.shown[0]).toEqual({
      candidateKind: "endpoint",
      label: `Coincident · ${pointLabel(line1.endPointId)}`,
      detail: `Coincident · ${pointLabel(line1.endPointId)}`,
    });
  });

  test("Line × start × endpoint: joins the existing point (reused id), named", () => {
    const { session, line1, pointLabel } = fixture();
    const result = drawAndCompare(session, "line", [
      [6.05, 3.02],
      [8, 6],
    ]);
    const expected = [`joins:${line1.endPointId}`];
    expect(result.authored).toEqual(expected);
    expect(result.requirements).toEqual(expected);
    expect(result.shown[0]!.label).toBe(
      `Joins ${pointLabel(line1.endPointId)}`,
    );
  });

  test("Line × end × midpoint: midpoint of the line, named", () => {
    const { session, line1, entityLabel } = fixture();
    const result = drawAndCompare(session, "line", [
      [4, 6],
      [4.02, 2.53],
    ]);
    const expected = [`midpoint:${line1.entityId}`];
    expect(result.shown[1]!.candidateKind).toBe("midpoint");
    expect(result.authored).toEqual(expected);
    expect(result.requirements).toEqual(expected);
    expect(result.shown[1]!.detail).toBe(
      `Midpoint of ${entityLabel(line1.entityId)}`,
    );
  });

  test("Line × end × on circle: point on the circle, named", () => {
    const { session, circle, entityLabel } = fixture();
    const result = drawAndCompare(session, "line", [
      [14, 14],
      [11.45, 11.45],
    ]);
    const expected = [`pointOnCurve:${circle.entityId}`];
    expect(result.shown[1]!.candidateKind).toBe("nearestOnCircle");
    expect(result.authored).toEqual(expected);
    expect(result.requirements).toEqual(expected);
    expect(result.shown[1]!.detail).toBe(`On ${entityLabel(circle.entityId)}`);
  });

  test("finding 4.1 — Line × end × on spline: shown 'On Spline' is authored as pointOnCurve", () => {
    const { session, spline, entityLabel } = fixture();
    const result = drawAndCompare(session, "line", [
      [3, 12],
      [3, 8.75],
    ]);
    const expected = [`pointOnCurve:${spline.entityId}`];
    expect(result.shown[1]!.candidateKind).toBe("nearestOnSpline");
    expect(result.authored, "the spline on-curve relation is authored").toEqual(
      expected,
    );
    expect(result.requirements).toEqual(expected);
    expect(result.shown[1]!.detail).toBe(`On ${entityLabel(spline.entityId)}`);
    expect(
      result.after.liveSolve?.accepted,
      "the authored spline relation solves with every constraint satisfied",
    ).toBe(true);
  });

  test("finding 4.2 — Line × start × origin at distance 0: coincident with the sketch origin", () => {
    const { session } = fixture();
    const result = drawAndCompare(session, "line", [
      [0, 0],
      [-3, -4],
    ]);
    const expected = ["coincidentProjectedPoint:origin"];
    expect(result.authored).toEqual(expected);
    expect(result.requirements).toEqual(expected);
    expect(result.shown[0]!.label).toBe("Coincident · Sketch origin");
  });

  test("Line × end × horizontal alignment: horizontal (Line only, D17)", () => {
    const { session } = fixture();
    const result = drawAndCompare(session, "line", [
      [30, 5],
      [34, 5.05],
    ]);
    expect(result.shown[1]!.candidateKind).toBe("horizontalAlignment");
    expect(result.authored).toEqual(["horizontal"]);
    expect(result.requirements).toEqual(["horizontal"]);
    expect(result.shown[1]!.detail).toBe("Horizontal");
  });

  test("Line × end × tangent: tangent to the circle and on it, both named", () => {
    const { session, circle, entityLabel } = fixture();
    // From (16, 10) the tangent touches the r = 2 circle at cos θ = 1/3.
    const touch: Click = [10 + 2 / 3, 10 + (2 * Math.sqrt(8)) / 3];
    const result = drawAndCompare(session, "line", [
      [16, 10],
      [touch[0] + 0.01, touch[1] + 0.01],
    ]);
    const expected = [
      `pointOnCurve:${circle.entityId}`,
      `tangent:${circle.entityId}`,
    ];
    expect(result.shown[1]!.candidateKind).toBe("tangent");
    expect(result.authored).toEqual(expected);
    expect(result.requirements).toEqual(expected);
    const label = entityLabel(circle.entityId);
    expect(result.shown[1]!.detail).toBe(`Tangent to ${label}, On ${label}`);
  });

  test("Line × end × perpendicular foot: perpendicular to the line and on it", () => {
    const { session, line1, entityLabel } = fixture();
    // The foot of (2, 5) on Line 1 is (2 + 12/17, 2 + 3/17).
    const result = drawAndCompare(session, "line", [
      [2, 5],
      [2 + 12 / 17 + 0.01, 2 + 3 / 17 + 0.01],
    ]);
    const expected = [
      `perpendicular:${line1.entityId}`,
      `pointOnCurve:${line1.entityId}`,
    ];
    expect(result.shown[1]!.candidateKind).toBe("perpendicularFoot");
    expect(result.authored).toEqual(expected);
    expect(result.requirements).toEqual(expected);
    const label = entityLabel(line1.entityId);
    expect(result.shown[1]!.detail).toBe(
      `Perpendicular to ${label}, On ${label}`,
    );
  });

  test("finding 4.3 — Rectangle × corner: no horizontal/vertical alignment is offered (D17)", () => {
    const { session } = fixture();
    const result = drawAndCompare(session, "rectangle", [
      [30, 10],
      [34, 10.05],
    ]);
    expect(
      result.shown[1]!.candidateKind,
      "alignment is never shown to a non-Line tool",
    ).toBe(null);
    expect(result.authored).toEqual([]);
    expect(result.requirements).toEqual([]);
  });

  test("finding 4.6 — Circle × centre × circle centre: says and authors concentric", () => {
    const { session, circle, entityLabel } = fixture();
    const result = drawAndCompare(session, "circle", [
      [10.02, 10.02],
      [11, 10],
    ]);
    const expected = [`concentric:${circle.entityId}`];
    expect(result.authored).toEqual(expected);
    expect(result.requirements).toEqual(expected);
    expect(result.shown[0]!.detail).toBe(
      `Concentric with ${entityLabel(circle.entityId)}`,
    );
  });

  test("finding 4.6 — Line × start × circle centre: says and authors a centre coincident", () => {
    const { session, circle, entityLabel } = fixture();
    const result = drawAndCompare(session, "line", [
      [10.02, 9.98],
      [13, 6],
    ]);
    const expected = [`coincident:${circle.centerPointId}`];
    expect(result.authored).toEqual(expected);
    expect(result.requirements).toEqual(expected);
    expect(result.shown[0]!.detail).toBe(
      `Coincident with ${entityLabel(circle.entityId)} centre`,
    );
  });

  test("finding 4.4 — Circle × rim (shape) × on line: says position only and authors nothing", () => {
    const { session } = fixture();
    const result = drawAndCompare(session, "circle", [
      [4, -1],
      [5, 2.77],
    ]);
    expect(result.shown[1]).toEqual({
      candidateKind: "nearestOnLine",
      label: "Snap position only — no relation",
      detail: null,
    });
    expect(result.authored).toEqual([]);
    expect(result.requirements).toEqual([]);
  });

  test("finding 4.5 — 3-point arc × middle click × on circle: authored on the through point", () => {
    const { session, circle, entityLabel } = fixture();
    const result = drawAndCompare(session, "threePointArc", [
      [16, 6],
      [12.02, 10],
      [16, 14],
    ]);
    const expected = [`pointOnCurve:${circle.entityId}`];
    expect(result.authored).toEqual(expected);
    expect(result.requirements).toEqual(expected);
    expect(result.shown[1]!.detail).toBe(`On ${entityLabel(circle.entityId)}`);
    const arc = result.after.definition.entities.find(
      (entity) => entity.kind === "arc",
    );
    const onCircle = result.after.definition.constraints.find(
      (constraint) =>
        constraint.kind === "pointOnCurve" &&
        constraint.curve.entityId === circle.entityId,
    );
    expect(
      onCircle?.kind === "pointOnCurve" &&
        arc?.kind === "arc" &&
        ![arc.startPointId, arc.endPointId, arc.centerPointId].includes(
          onCircle.point.pointId,
        ),
      "bound to the through point, not an arc end",
    ).toBe(true);
  });

  test("finding 4.5 — Spline × middle fit point × on line: authored", () => {
    const { session, line1, entityLabel } = fixture();
    const result = drawAndCompare(session, "spline", [
      [1, 4],
      [5.02, 2.76],
      [7, 5],
    ]);
    const expected = [`pointOnCurve:${line1.entityId}`];
    expect(result.authored).toEqual(expected);
    expect(result.requirements).toEqual(expected);
    expect(result.shown[1]!.detail).toBe(`On ${entityLabel(line1.entityId)}`);
  });

  test("finding 4.5 — Centre-point arc: centre concentric and start-click coincident are both authored", () => {
    const { session, line1, circle, pointLabel } = fixture();
    const result = drawAndCompare(session, "centerPointArc", [
      [10.02, 10.02],
      [6.02, 3.02],
      [18, 10],
    ]);
    const expected = [
      `coincident:${line1.endPointId}`,
      `concentric:${circle.entityId}`,
    ];
    expect(result.authored).toEqual(expected);
    expect(result.requirements).toEqual(expected);
    expect(result.shown[1]!.detail).toBe(
      `Coincident · ${pointLabel(line1.endPointId)}`,
    );
  });

  test("Point × point × intersection: on both curves, both named", () => {
    const { session, line1, line4, entityLabel } = fixture();
    const result = drawAndCompare(session, "point", [[3.01, 2.26]]);
    const expected = [
      `pointOnCurve:${line1.entityId}`,
      `pointOnCurve:${line4.entityId}`,
    ].sort();
    expect(result.shown[0]!.candidateKind).toBe("intersection");
    expect(result.authored).toEqual(expected);
    expect(result.requirements).toEqual(expected);
    expect(result.shown[0]!.detail).toBe(
      `On ${entityLabel(line1.entityId)}, On ${entityLabel(line4.entityId)}`,
    );
  });

  test("R-7 — Tangent arc records its tangent source at the first click; the commit keeps it", () => {
    const { session, line1, entityLabel } = fixture();
    // Line 1 passes through (4.5, 2.625).
    let draft = beginSketchTool(session, "tangentArc");
    draft = startSketchDraw(
      updateSketchPointer(draft, [4.5, 2.64]),
      [4.5, 2.64],
    );
    expect(
      draft.toolTangentSourceEntityId,
      "the tangent source is tool state, not a snap",
    ).toBe(line1.entityId);

    const result = drawAndCompare(session, "tangentArc", [
      [4.5, 2.64],
      [6.5, 3.5],
      [7, 6],
    ]);
    expect(result.shown[0]!.detail).toBe(`On ${entityLabel(line1.entityId)}`);
    expect(result.requirements).toEqual([`pointOnCurve:${line1.entityId}`]);
    expect(
      result.authored,
      "the shown on-curve relation plus the structural tangency",
    ).toEqual([`pointOnCurve:${line1.entityId}`, `tangent:${line1.entityId}`]);
  });

  test("D20 — a chain continues structurally from its last end; closing onto its start is an endpoint inference", () => {
    let session = withSketchSnapScale(blank(), SPEC_SKETCH_UNITS_PER_PIXEL);
    const { session: chained, shown } = draw(session, "line", [
      [30, 30],
      [33, 30.5],
      [33.5, 33.5],
      [30.02, 30.01],
    ]);
    session = chained;
    const lines = session.definition.entities.filter(
      (entity) => entity.kind === "lineSegment",
    );
    expect(lines).toHaveLength(3);
    const [first, second, third] = lines;
    if (
      first?.kind !== "lineSegment" ||
      second?.kind !== "lineSegment" ||
      third?.kind !== "lineSegment"
    ) {
      throw new Error("expected lines");
    }
    expect(second.startPointId, "continuation reuses the end id").toBe(
      first.endPointId,
    );
    expect(third.startPointId).toBe(second.endPointId);
    expect(third.endPointId, "the closure joins the chain start").toBe(
      first.startPointId,
    );
    expect(
      session.definition.constraints.filter(
        (constraint) => constraint.kind === "coincident",
      ),
      "continuity is structural: no coincident is authored",
    ).toEqual([]);
    const startLabel = session.definition.points.find(
      (point) => point.pointId === first.startPointId,
    )!.label;
    expect(shown[3]!.label, "the closure is shown as a join").toBe(
      `Joins ${startLabel}`,
    );
    expect(
      shown[2]!.candidateKind,
      "the continuation itself is not a shown snap",
    ).not.toBe("endpoint");
  });

  test("a tool setting changed mid-draft keeps the placed clicks' badges", () => {
    const { session, line1, pointLabel } = fixture();
    let draft = beginSketchTool(session, "profileText");
    draft = startSketchDraw(
      updateSketchPointer(draft, [6.02, 3.01]),
      [6.02, 3.01],
    );
    const label = `Coincident · ${pointLabel(line1.endPointId)}`;
    expect(badgeLabel(draft, "placement-1-snap"), "premise").toBe(label);

    const patched = patchSketchDrawingToolValue(draft, {
      intent: "setToolSetting",
      key: "text",
      value: "B",
    });
    expect(
      badgeLabel(patched, "placement-1-snap"),
      "the badge of the relation the commit will author stays shown",
    ).toBe(label);
  });

  test("D21/A5 — after an Undo moved a snapped point, the finalize authors the recomputed inference", () => {
    let session = blank();
    session = drawFree(session, "line", [
      [50, 20],
      [60, 20],
    ]);
    const line = session.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    );
    if (line?.kind !== "lineSegment") throw new Error("expected a line");
    // The state an Undo restores: the line end at (62, 20).
    const moved: SketchDefinition = {
      ...session.definition,
      points: session.definition.points.map((point) =>
        point.pointId === line.endPointId
          ? { ...point, position: [62, 20] as SketchPoint }
          : point,
      ),
    };
    session = withSketchSnapScale(session, SPEC_SKETCH_UNITS_PER_PIXEL);
    let draft = beginSketchTool(session, "spline");
    draft = startSketchDraw(draft, [55, 24]);
    draft = acceptSketchDraw(draft, [60.02, 20.02]);
    expect(
      draft.toolPresentation?.overlays?.some(
        (overlay) =>
          overlay.kind === "snapIndicator" &&
          overlay.candidateKind === "endpoint",
      ),
      "premise: the last fit point snapped onto the line end",
    ).toBe(true);

    const restored = rebuildSessionForDefinition(draft, { definition: moved });
    const finalized = finalizeSketchDraw(restored);
    const authored = authoredRelations(moved, finalized.definition);
    expect(
      authored.constraints,
      "the moved point no longer pulls the finalize",
    ).toEqual([`pointOnCurve:${line.entityId}`]);
    expect(
      badgeLabel(restored, "placement-2-snap"),
      "the rendered badge shows the recomputed inference, without a pointer move",
    ).toBe(`On ${line.label}`);
  });
});

describe("T13g commit binding (D16)", () => {
  const factories = createSessionCommitFactories(1, "sketch_draft" as never);
  const circlePatch = () =>
    getSketchToolDefinition("circle").createCommitContribution({
      sequence: 1,
      start: [0, 0],
      end: [1, 0],
      isConstruction: false,
      factories,
    });
  const definition = {
    points: [],
    entities: [
      {
        entityId: "sketch_entity_target" as SketchEntityId,
        kind: "lineSegment",
        label: "Line 9",
      },
    ],
    constraints: [],
  } as unknown as SketchDefinition;
  const onLine = (role: "point" | "shape") =>
    inferPlacementFromCandidate(
      { toolId: "circle", role, definition },
      {
        candidate: {
          key: "nearestOnLine:target",
          kind: "nearestOnLine",
          point: [1, 0],
          rawPointer: [1, 0],
          distance: 0,
          sources: [
            {
              kind: "localEntity",
              entityId: "sketch_entity_target" as SketchEntityId,
              geometryKind: "lineSegment",
            },
          ],
          preview: { label: "On line", glyph: "onCurve" },
        } as never,
        rawPosition: [1, 0],
        sketchUnitsPerPixel: null,
      },
    );

  test("a requirement bound to a click that authors no point throws", () => {
    expect(() =>
      bindPlacementInferences({
        patch: circlePatch(),
        placements: [null, onLine("point")],
        sequence: 1,
        createConstraintId: (suffix) => `constraint_${suffix}` as never,
      }),
    ).toThrow(/authors none/);
  });

  test("placements not aligned with the tool's clicks throw", () => {
    expect(() =>
      bindPlacementInferences({
        patch: circlePatch(),
        placements: [null],
        sequence: 1,
        createConstraintId: (suffix) => `constraint_${suffix}` as never,
      }),
    ).toThrow(/1 placements for 2 tool clicks/);
  });

  test("a shape click's inference authors nothing and says so", () => {
    const shape = onLine("shape");
    expect(shape.requirements).toEqual([]);
    expect(shape.text).toBe("Snap position only — no relation");
    expect(
      bindPlacementInferences({
        patch: circlePatch(),
        placements: [null, shape],
        sequence: 1,
        createConstraintId: (suffix) => `constraint_${suffix}` as never,
      }).constraints ?? [],
    ).toEqual([]);
  });
  test("D18 — a Line end never joins a point already coincident with its start", () => {
    const pointA = "sketch_point_a" as SketchPointId;
    const pointB = "sketch_point_b" as SketchPointId;
    const withClass = (declared: boolean) =>
      ({
        points: [
          { pointId: pointA, label: "Point A", position: [0, 0] },
          { pointId: pointB, label: "Point B", position: [0, 1] },
        ],
        entities: [],
        constraints: declared
          ? [
              {
                constraintId: "constraint_ab",
                kind: "coincident",
                label: "A = B",
                pointIds: [pointA, pointB],
              },
            ]
          : [],
      }) as unknown as SketchDefinition;
    const atB = (declared: boolean) =>
      inferPlacementFromCandidate(
        {
          toolId: "line",
          role: "point",
          definition: withClass(declared),
          lineStartPointId: pointA,
        },
        {
          candidate: {
            key: "endpoint:b",
            kind: "endpoint",
            point: [0, 1],
            rawPointer: [0, 1],
            distance: 0,
            sources: [{ kind: "localPoint", pointId: pointB }],
            preview: { label: "Endpoint", glyph: "endpoint" },
          } as never,
          rawPosition: [0, 1],
          sketchUnitsPerPixel: null,
        },
      );

    expect(atB(false).requirements.map(describeRequirement)).toEqual([
      `joins:${pointB}`,
    ]);
    expect(atB(true).requirements, "nothing inside one class").toEqual([]);
    expect(atB(true).text).toBe(
      "Snap position only — Point B is already coincident with the line start",
    );
  });
});
