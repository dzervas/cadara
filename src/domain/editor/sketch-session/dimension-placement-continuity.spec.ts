// cadara-3wp6, logic lane (sketch-session seams: `updateSketchPointer` → the
// armed dimension tool's preview overlay; `pinSketchConstraintPreview` +
// `commitConstraintValue` → `buildCommittedDimensionOverlays` and
// `getSketchAnnotationDescriptors`; `patchSketchDimensionAnnotationPlacement`
// for a committed label drag).
//
// Pointer-following behaviour is asserted along a dense pointer path, not at
// its endpoint: a label that jumps on intermediate steps but lands right
// passes an endpoint check. For every dimension kind the tools author (and
// reference variants), the pointer glides in steps of PATH_STEP sketch units
// and every step must satisfy:
//  (a) continuity: |Δlabel| <= LABEL_SPEED_LIMIT · |Δpointer|. k = 1: no
//      placement moves its label faster than the pointer (a projection onto
//      the placed carrier, a midpoint of a line that slides with the pointer,
//      a point at the pointer's radius, or a rim point seen from outside the
//      circle). Paths stay inside one reference zone (aligned / horizontal /
//      vertical, minor angle side) and outside circles: crossing a zone
//      boundary switches the carrier by design.
//  (b) tracking: in the creation preview the carrier (the infinite dimension
//      line, or the angle arc's circle) passes through the pointer, and the
//      label sits at the pointer (point-to-line kinds) or on its placed
//      segment / arc within the row's stated reach of the pointer. A
//      committed label dragged by Δ sits at its grab anchor + Δ (angle: on
//      the arc through the pointer).
//  (c) preview == committed: committing at a sampled pointer draws the
//      label, dimension line and chip anchor the preview showed there.
//
// What this lane cannot see: cadara-2wpl's causes were in the browser (the
// preview's DOM drag handle swallowing pointer moves, a displaced chip's
// first drag frame); the E2E glide rows (e2e/cadara-3wp6-dimension-glide.spec.ts)
// cover those. On main xonwsmot this table was green except the fixed
// Horizontal / Vertical tools' zone crossing, a pre-existing bug (same code at
// kzsllyol) tracked as cadara-y3p6 and pinned below as expected-fail rows.
import { describe, expect, test } from "vitest";

import type { SketchPoint } from "@/contracts/modeling/schema";
import type { SketchId } from "@/contracts/shared/ids";
import type { DimensionDefinition } from "@/contracts/sketch/schema";
import { isReferenceDimension } from "@/contracts/sketch/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchConstraintToolId } from "@/core/sketch-constraints/definition";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  getSketchAnnotationDescriptors,
  patchSketchConstraintValue,
  patchSketchDimensionAnnotationPlacement,
  pinSketchConstraintPreview,
  selectSketchConstraintTarget,
  startSketchDraw,
  updateSketchPointer,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { buildCommittedDimensionOverlays } from "@/domain/editor/sketch-session/annotations";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";

/** Pointer step along every path, in sketch units. */
const PATH_STEP = 0.05;
/** k in |Δlabel| <= k · |Δpointer|. */
const LABEL_SPEED_LIMIT = 1;
const EPSILON = 1e-6;
/** Every Nth creation sample (and the last) is committed for (c). */
const COMMIT_SAMPLE_EVERY = 20;

type Overlay = NonNullable<
  NonNullable<SketchSessionState["toolPresentation"]>["overlays"]
>[number];
type PlacedOverlay = Extract<Overlay, { kind: "dimensionLine" | "angleArc" }>;

function draw(
  session: SketchSessionState,
  toolId: Parameters<typeof beginSketchTool>[1],
  points: readonly SketchPoint[],
) {
  let next = startSketchDraw(beginSketchTool(session, toolId), points[0]!);
  for (const point of points.slice(1)) next = acceptSketchDraw(next, point);
  return beginSketchTool(next, "line");
}

/**
 * Lines A [2,2]–[6,2], C [2,8]–[6,8] (parallel to A), B [1,3]–[1,6] (across
 * A), D [14,2]–[17,6] (slanted), a circle (centre [10,3], r 2) and an upper
 * half arc (centre [10,-5], r 2), all clear of the sketch axes.
 */
function makeFixture() {
  let session = enterSketchSession(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  );
  session = draw(session, "line", [
    [2, 2],
    [6, 2],
  ]);
  session = draw(session, "line", [
    [2, 8],
    [6, 8],
  ]);
  session = draw(session, "line", [
    [1, 3],
    [1, 6],
  ]);
  session = draw(session, "line", [
    [14, 2],
    [17, 6],
  ]);
  session = draw(session, "circle", [
    [10, 3],
    [12, 3],
  ]);
  session = draw(session, "threePointArc", [
    [12, -5],
    [8, -5],
    [10, -3],
  ]);
  const [a, c, b, d, circle, arc] = session.definition.entities;
  if (
    a?.kind !== "lineSegment" ||
    c?.kind !== "lineSegment" ||
    b?.kind !== "lineSegment" ||
    d?.kind !== "lineSegment" ||
    circle?.kind !== "circle" ||
    arc?.kind !== "arc"
  ) {
    throw new Error("premise: four lines, a circle and an arc");
  }
  const point = (pointId: string) =>
    session.definition.points.find((entry) => entry.pointId === pointId)!
      .target;
  const sketchId = session.sketchId as SketchId;
  const datum = (datumId: "origin" | "xAxis") =>
    ({
      kind: "sketchDatumReference",
      sketchId,
      datumId,
      geometryKind: datumId === "origin" ? "point" : "lineSegment",
    }) as PrimitiveRef;
  return {
    session,
    a: a.target,
    b: b.target,
    c: c.target,
    circle: circle.target,
    arc: arc.target,
    bEnd: point(b.endPointId),
    dStart: point(d.startPointId),
    dEnd: point(d.endPointId),
    origin: datum("origin"),
    xAxis: datum("xAxis"),
  };
}

type Fixture = ReturnType<typeof makeFixture>;

interface ContinuityRow {
  name: string;
  tool: SketchConstraintToolId;
  targets: (fixture: Fixture) => readonly PrimitiveRef[];
  /** The preview's reference kind, constant along the path (premise). */
  referenceKind: string | null;
  committedKind: DimensionDefinition["kind"];
  /**
   * (b) where the creation label sits: at the pointer, or on its placed
   * segment / arc within `reach` sketch units of the pointer. The reach is
   * derived from the path: the pointer rides the carrier, so a midpoint label
   * is as far as the path strays along the carrier from the measured pair's
   * midpoint (horizontal pair path x 14.5–16.5 around 15.5: 1); a rim or arc
   * label as far as the pointer's clearance outside the circle (radius-3
   * paths and their chords around r = 2: 1.25).
   */
  label: "atPointer" | { reach: number };
  /** Waypoints of the creation glide (sketch coordinates). */
  creation: readonly SketchPoint[];
  /** Pointer displacements from the grab for the committed label drag. */
  drag: readonly SketchPoint[];
  /** Authors a driving dimension first, so this one commits as a reference. */
  reference?: true;
}

const DRAG: readonly SketchPoint[] = [
  [0, 0],
  [1.5, 0.5],
  [0.5, 2],
  [-1, 1],
];

const ROWS: readonly ContinuityRow[] = [
  {
    name: "point pair, aligned",
    tool: "dimensionDistance",
    targets: (f) => [f.dStart, f.dEnd],
    referenceKind: "aligned",
    committedKind: "distance",
    label: { reach: 1.5 },
    creation: [
      [14.2, 3.1],
      [15.1, 4.1],
      [15.92, 5.56],
    ],
    drag: [
      [0, 0],
      [0.3, -0.2],
      [-0.3, 0.2],
    ],
  },
  {
    name: "point pair, horizontal",
    tool: "dimensionDistance",
    targets: (f) => [f.dStart, f.dEnd],
    referenceKind: "horizontal",
    committedKind: "distance",
    label: { reach: 1 },
    creation: [
      [14.5, 8],
      [16.5, 9],
      [15, 10],
    ],
    drag: DRAG,
  },
  {
    name: "point pair, vertical",
    tool: "dimensionDistance",
    targets: (f) => [f.dStart, f.dEnd],
    referenceKind: "vertical",
    committedKind: "distance",
    label: { reach: 1 },
    creation: [
      [20, 3],
      [21, 5],
      [20.5, 4.5],
    ],
    drag: DRAG,
  },
  {
    name: "Horizontal tool, point pair",
    tool: "dimensionHorizontal",
    targets: (f) => [f.dStart, f.dEnd],
    referenceKind: "horizontal",
    committedKind: "horizontalDistance",
    label: { reach: 1 },
    creation: [
      [14.5, 8],
      [16.5, 9],
      [15, 10],
    ],
    drag: DRAG,
  },
  {
    name: "Vertical tool, point pair",
    tool: "dimensionVertical",
    targets: (f) => [f.dStart, f.dEnd],
    referenceKind: "vertical",
    committedKind: "verticalDistance",
    label: { reach: 1 },
    creation: [
      [20, 3],
      [21, 5],
      [20.5, 4.5],
    ],
    drag: DRAG,
  },
  {
    name: "line length",
    tool: "dimensionDistance",
    targets: (f) => [f.a],
    referenceKind: "lineLength",
    committedKind: "lineLength",
    label: { reach: 1 },
    creation: [
      [3, 3],
      [5, 4],
      [4, 0.5],
    ],
    drag: DRAG,
  },
  {
    name: "line length, reference",
    tool: "dimensionDistance",
    targets: (f) => [f.a],
    referenceKind: "lineLength",
    committedKind: "lineLength",
    label: { reach: 1 },
    creation: [
      [3, 3],
      [5, 4],
      [4, 0.5],
    ],
    drag: DRAG,
    reference: true,
  },
  {
    name: "point to line (line first)",
    tool: "dimensionDistance",
    targets: (f) => [f.a, f.bEnd],
    referenceKind: "pointLineDistance",
    committedKind: "linePointDistance",
    label: "atPointer",
    creation: [
      [2, 5],
      [4, 4],
      [7, 3],
    ],
    drag: DRAG,
  },
  {
    name: "point to line (point first)",
    tool: "dimensionDistance",
    targets: (f) => [f.bEnd, f.a],
    referenceKind: "pointLineDistance",
    committedKind: "linePointDistance",
    label: "atPointer",
    creation: [
      [2, 5],
      [4, 4],
      [7, 3],
    ],
    drag: DRAG,
  },
  {
    name: "point to axis",
    tool: "dimensionDistance",
    targets: (f) => [f.xAxis, f.bEnd],
    referenceKind: "pointLineDistance",
    committedKind: "linePointDistance",
    label: "atPointer",
    creation: [
      [2, 4],
      [3, 1],
      [0.5, -1],
    ],
    drag: DRAG,
  },
  {
    name: "line to origin",
    tool: "dimensionDistance",
    targets: (f) => [f.a, f.origin],
    referenceKind: "pointLineDistance",
    committedKind: "linePointDistance",
    label: "atPointer",
    creation: [
      [-1, -1],
      [-2, 1],
      [1, -1.5],
    ],
    drag: DRAG,
  },
  {
    name: "line to line, parallel",
    tool: "dimensionDistance",
    targets: (f) => [f.a, f.c],
    referenceKind: "lineDistance",
    committedKind: "lineDistance",
    label: { reach: 1 },
    creation: [
      [3, 4],
      [5, 6],
      [8, 5],
    ],
    drag: DRAG,
  },
  {
    name: "angle",
    tool: "dimensionDistance",
    targets: (f) => [f.a, f.b],
    referenceKind: null,
    committedKind: "lineAngle",
    label: { reach: 1.5 },
    creation: [
      [2, 3],
      [4, 4],
      [3, 6],
    ],
    drag: DRAG,
  },
  {
    name: "angle, reference",
    tool: "dimensionDistance",
    targets: (f) => [f.a, f.b],
    referenceKind: null,
    committedKind: "lineAngle",
    label: { reach: 1.5 },
    creation: [
      [2, 3],
      [4, 4],
      [3, 6],
    ],
    drag: DRAG,
    reference: true,
  },
  {
    name: "diameter",
    tool: "dimensionDistance",
    targets: (f) => [f.circle],
    referenceKind: "diameter",
    committedKind: "diameter",
    label: { reach: 1.25 },
    creation: [
      [13, 3],
      [12, 5.5],
      [10, 6],
    ],
    drag: DRAG,
  },
  {
    name: "diameter, arc",
    tool: "dimensionDistance",
    targets: (f) => [f.arc],
    referenceKind: "diameter",
    committedKind: "diameter",
    label: { reach: 1.25 },
    creation: [
      [12.6, -3.5],
      [10, -2],
      [7.4, -3.5],
    ],
    drag: DRAG,
  },
  {
    name: "radius",
    tool: "dimensionRadius",
    targets: (f) => [f.circle],
    referenceKind: "radius",
    committedKind: "circleRadius",
    label: { reach: 1.25 },
    creation: [
      [13, 3],
      [12, 5.5],
      [10, 6],
    ],
    drag: DRAG,
  },
  {
    name: "point to origin, vertical",
    tool: "dimensionDistance",
    targets: (f) => [f.bEnd, f.origin],
    referenceKind: "vertical",
    committedKind: "pointDatumDistance",
    label: { reach: 1 },
    creation: [
      [-3, 2],
      [-3.5, 4],
    ],
    drag: DRAG,
  },
  {
    name: "point to origin, horizontal",
    tool: "dimensionDistance",
    targets: (f) => [f.dStart, f.origin],
    referenceKind: "horizontal",
    committedKind: "pointDatumDistance",
    label: { reach: 1 },
    creation: [
      [6, 6],
      [8, 7],
    ],
    drag: DRAG,
  },
  {
    name: "point to origin, aligned",
    tool: "dimensionDistance",
    targets: (f) => [f.bEnd, f.origin],
    referenceKind: "aligned",
    committedKind: "pointDatumDistance",
    label: { reach: 1.25 },
    creation: [
      [1.19, 4.12],
      [0.94, 2.93],
      [0.79, 1.72],
    ],
    drag: DRAG,
  },
];

/** The waypoints joined by straight steps of at most PATH_STEP. */
function glidePath(waypoints: readonly SketchPoint[]): SketchPoint[] {
  const path: SketchPoint[] = [waypoints[0]!];
  for (let index = 1; index < waypoints.length; index += 1) {
    const from = waypoints[index - 1]!;
    const to = waypoints[index]!;
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / PATH_STEP),
    );
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      path.push([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
      ]);
    }
  }
  return path;
}

const distance = (first: readonly number[], second: readonly number[]) =>
  Math.hypot(first[0]! - second[0]!, first[1]! - second[1]!);

/** How far `pointer` is off the overlay's carrier (dimension line or arc). */
function carrierDistance(overlay: PlacedOverlay, pointer: SketchPoint) {
  if (overlay.kind === "angleArc") {
    return Math.abs(distance(pointer, overlay.center) - overlay.radius);
  }
  const length = distance(overlay.start, overlay.end);
  if (length <= EPSILON) return distance(pointer, overlay.start);
  return Math.abs(
    ((overlay.end[0] - overlay.start[0]) * (pointer[1] - overlay.start[1]) -
      (overlay.end[1] - overlay.start[1]) * (pointer[0] - overlay.start[0])) /
      length,
  );
}

function labelOf(overlay: PlacedOverlay): SketchPoint {
  if (overlay.labelAnchor?.kind !== "sketchPoint") {
    throw new Error(`${overlay.id}: a sketch-point label anchor`);
  }
  return overlay.labelAnchor.point as SketchPoint;
}

function previewOverlay(session: SketchSessionState): PlacedOverlay {
  const overlay = session.toolPresentation?.overlays?.find(
    (candidate): candidate is PlacedOverlay =>
      (candidate.kind === "dimensionLine" || candidate.kind === "angleArc") &&
      Boolean(candidate.dragHandle),
  );
  if (!overlay) throw new Error("premise: a dimension preview overlay");
  return overlay;
}

function committedOverlay(session: SketchSessionState, dimensionId: string) {
  const overlay = buildCommittedDimensionOverlays(
    session,
    session.definition,
  ).find((candidate) => candidate.id === `${dimensionId}-overlay`);
  if (overlay?.kind !== "dimensionLine" && overlay?.kind !== "angleArc") {
    throw new Error(`premise: a committed overlay for ${dimensionId}`);
  }
  return overlay;
}

function chipAnchor(session: SketchSessionState, dimensionId: string) {
  const descriptor = getSketchAnnotationDescriptors(session).find(
    (candidate) => candidate.id === dimensionId,
  );
  if (descriptor?.anchor.kind !== "sketchPoint") {
    throw new Error(`premise: a chip anchor for ${dimensionId}`);
  }
  return descriptor.anchor.point as SketchPoint;
}

/** The armed tool with every target picked, before any pointer motion. */
function armed(row: ContinuityRow) {
  const fixture = makeFixture();
  let session = fixture.session;
  if (row.reference) {
    session = commit(
      pointerAt(pick(session, row, fixture), row.creation[0]!),
      row.creation[0]!,
    ).session;
    const driving = session.definition.dimensions.at(-1);
    expect(
      driving && [driving.kind, isReferenceDimension(driving)],
      "premise: a driving dimension on the same targets",
    ).toEqual([row.committedKind, false]);
  }
  return pick(session, row, fixture);
}

function pick(
  session: SketchSessionState,
  row: ContinuityRow,
  fixture: Fixture,
) {
  let next = beginSketchTool(session, row.tool);
  for (const target of row.targets(fixture)) {
    next = selectSketchConstraintTarget(next, target);
  }
  expect(next.status, `${row.name}: premise: every target picked`).toBe(
    "awaitingValue",
  );
  return next;
}

const pointerAt = (session: SketchSessionState, pointer: SketchPoint) =>
  updateSketchPointer(session, pointer);

/** Places the preview at `pointer` and commits its prefilled value. */
function commit(session: SketchSessionState, pointer: SketchPoint) {
  const pinned = pinSketchConstraintPreview(session, pointer);
  const committed = patchSketchConstraintValue(pinned, {
    intent: "commitConstraintValue",
  });
  const dimension = committed.definition.dimensions.at(-1);
  if (
    !dimension ||
    committed.definition.dimensions.length !==
      session.definition.dimensions.length + 1
  ) {
    throw new Error("premise: the commit authors one dimension");
  }
  return { session: committed, dimension };
}

function glidePreview(row: ContinuityRow) {
  const path = glidePath(row.creation);
  let session = armed(row);
  return path.map((pointer) => {
    session = pointerAt(session, pointer);
    return { pointer, session, overlay: previewOverlay(session) };
  });
}

/** (b): why the creation label is misplaced, or null. */
function labelPlacementFinding(
  row: ContinuityRow,
  overlay: PlacedOverlay,
  pointer: SketchPoint,
): string | null {
  const label = labelOf(overlay);
  const reach = distance(label, pointer);
  if (row.label === "atPointer") {
    return reach > EPSILON ? `label ${reach.toFixed(4)} off the pointer` : null;
  }
  if (overlay.kind === "angleArc") {
    const off = Math.abs(distance(label, overlay.center) - overlay.radius);
    if (off > EPSILON) return `label ${off.toFixed(4)} off its arc`;
  } else {
    const along = [
      overlay.end[0] - overlay.start[0],
      overlay.end[1] - overlay.start[1],
    ] as const;
    const lengthSquared = along[0] ** 2 + along[1] ** 2;
    const t =
      ((label[0] - overlay.start[0]) * along[0] +
        (label[1] - overlay.start[1]) * along[1]) /
      lengthSquared;
    const foot: SketchPoint = [
      overlay.start[0] + along[0] * t,
      overlay.start[1] + along[1] * t,
    ];
    if (t < -EPSILON || t > 1 + EPSILON || distance(label, foot) > EPSILON) {
      return `label off its placed segment (t = ${t.toFixed(4)})`;
    }
  }
  return reach > row.label.reach + EPSILON
    ? `label ${reach.toFixed(4)} from the pointer (reach ${row.label.reach})`
    : null;
}

interface StepFinding {
  step: number;
  pointer: SketchPoint;
  detail: string;
}

/** (a): the steps whose label moved faster than k · |Δpointer|. */
function speedFindings(
  samples: readonly { pointer: SketchPoint; label: SketchPoint }[],
): StepFinding[] {
  return samples.slice(1).flatMap((sample, index) => {
    const previous = samples[index]!;
    const pointerStep = distance(sample.pointer, previous.pointer);
    const labelStep = distance(sample.label, previous.label);
    return labelStep > LABEL_SPEED_LIMIT * pointerStep + EPSILON
      ? [
          {
            step: index + 1,
            pointer: sample.pointer,
            detail: `label moved ${labelStep.toFixed(4)} for a pointer step of ${pointerStep.toFixed(4)}`,
          },
        ]
      : [];
  });
}

const summarize = (findings: readonly StepFinding[]) =>
  findings
    .slice(0, 3)
    .map(
      ({ step, pointer, detail }) =>
        `step ${step} at [${pointer.map((value) => value.toFixed(2)).join(", ")}]: ${detail}`,
    );

/** (a) and (b) along the row's creation glide, before the placing click. */
function expectCreationPreviewFollows(row: ContinuityRow) {
  const samples = glidePreview(row);
  expect(samples.length, "premise: a dense path").toBeGreaterThan(40);
  expect(
    [
      ...new Set(
        samples.map(({ overlay }) =>
          overlay.kind === "dimensionLine" ? overlay.referenceKind : null,
        ),
      ),
    ],
    "premise: one reference zone along the path",
  ).toEqual([row.referenceKind]);
  const findings = speedFindings(
    samples.map(({ pointer, overlay }) => ({
      pointer,
      label: labelOf(overlay),
    })),
  );
  const offCarrier = samples.flatMap(({ pointer, overlay }, step) => {
    const off = carrierDistance(overlay, pointer);
    return off > EPSILON
      ? [
          {
            step,
            pointer,
            detail: `pointer ${off.toFixed(4)} off the carrier`,
          },
        ]
      : [];
  });
  const offLabel = samples.flatMap(({ pointer, overlay }, step) => {
    const detail = labelPlacementFinding(row, overlay, pointer);
    return detail ? [{ step, pointer, detail }] : [];
  });
  expect.soft(summarize(findings), "(a) continuity, k = 1").toEqual([]);
  expect
    .soft(summarize(offCarrier), "(b) the carrier tracks the pointer")
    .toEqual([]);
  expect
    .soft(
      summarize(offLabel),
      row.label === "atPointer"
        ? "(b) the label sits at the pointer"
        : `(b) the label stays on its placed segment within ${row.label.reach} of the pointer`,
    )
    .toEqual([]);
}

describe("cadara-3wp6: dimension labels follow a gliding pointer continuously (creation preview, commit, committed drag)", () => {
  for (const row of ROWS) {
    test(`${row.name}: the creation preview's label never outruns the pointer and its carrier passes through the pointer`, () => {
      expectCreationPreviewFollows(row);
    });

    test(`${row.name}: committing at a pointer draws the label, line and chip the preview showed there`, () => {
      const samples = glidePreview(row);
      const sampled = samples.filter(
        (_, index) =>
          index % COMMIT_SAMPLE_EVERY === 0 || index === samples.length - 1,
      );
      for (const { pointer, session, overlay } of sampled) {
        const { session: committed, dimension } = commit(session, pointer);
        expect(dimension.kind, "premise: the committed kind").toBe(
          row.committedKind,
        );
        expect(
          isReferenceDimension(dimension),
          "premise: reference or driving",
        ).toBe(Boolean(row.reference));
        const shown = committedOverlay(committed, dimension.dimensionId);
        const at = `at [${pointer.map((value) => value.toFixed(2)).join(", ")}]`;
        expect(
          distance(labelOf(shown), labelOf(overlay)),
          `(c) committed label == preview label ${at}`,
        ).toBeLessThan(EPSILON);
        expect(
          distance(
            chipAnchor(committed, dimension.dimensionId),
            labelOf(overlay),
          ),
          `(c) committed chip anchor == preview label ${at}`,
        ).toBeLessThan(EPSILON);
        const ends = (placed: PlacedOverlay) =>
          [placed.start, placed.end] as const;
        const [shownStart, shownEnd] = ends(shown);
        const [previewStart, previewEnd] = ends(overlay);
        expect(
          Math.min(
            Math.max(
              distance(shownStart, previewStart),
              distance(shownEnd, previewEnd),
            ),
            // A point pair authored along its axis may store its ends swapped.
            Math.max(
              distance(shownStart, previewEnd),
              distance(shownEnd, previewStart),
            ),
          ),
          `(c) committed line == preview line ${at}`,
        ).toBeLessThan(EPSILON);
      }
    });

    test(`${row.name}: a committed label dragged by the pointer's displacement stays under the pointer and never outruns it`, () => {
      const samples = glidePreview(row);
      const last = samples.at(-1)!;
      const { session: committed, dimension } = commit(
        last.session,
        last.pointer,
      );
      const id = dimension.dimensionId;
      const grab = chipAnchor(committed, id);
      let session = committed;
      const drag = glidePath(row.drag).map((delta) => {
        const pointer: SketchPoint = [grab[0] + delta[0], grab[1] + delta[1]];
        session = patchSketchDimensionAnnotationPlacement(session, {
          intent: "setDimensionAnnotationPlacement",
          dimensionId: id,
          point: pointer,
        });
        return {
          pointer,
          label: chipAnchor(session, id),
          overlay: committedOverlay(session, id),
        };
      });
      expect(drag.length, "premise: a dense drag").toBeGreaterThan(10);
      const offPointer = drag.flatMap(({ pointer, label, overlay }, step) => {
        const off =
          overlay.kind === "angleArc"
            ? carrierDistance(overlay, pointer)
            : distance(label, pointer);
        const drawn = distance(labelOf(overlay), label);
        return off > EPSILON || drawn > EPSILON
          ? [
              {
                step,
                pointer,
                detail: `label ${off.toFixed(4)} off the pointer, drawn label ${drawn.toFixed(4)} off the chip`,
              },
            ]
          : [];
      });
      expect
        .soft(summarize(speedFindings(drag)), "(a) continuity, k = 1")
        .toEqual([]);
      expect
        .soft(summarize(offPointer), "(b) the label tracks the pointer")
        .toEqual([]);
    });
  }
});

// cadara-y3p6 (expected to fail until it lands; then drop `.fails`): the fixed
// Horizontal / Vertical tools store `inferDimensionAnnotationPlacement`'s
// zone-chosen point-pair offset, which their preview reads on the tool's own
// axis. Gliding the Horizontal tool from [15, 8] to [19, 8] to [20, 4] enters
// the vertical zone near [19.1, 7.6]: the label moves 0.506 for a 0.0497 step
// and the carrier then misses the pointer by 0.40–0.60. The Vertical tool
// gliding [20, 4] → [20, 8] → [15, 8] enters the horizontal zone at [19.5, 8]:
// 0.45 for a 0.05 step.
const ZONE_CROSSING_ROWS: readonly ContinuityRow[] = [
  {
    name: "Horizontal tool, point pair, pointer crossing into the vertical zone",
    tool: "dimensionHorizontal",
    targets: (f) => [f.dStart, f.dEnd],
    referenceKind: "horizontal",
    committedKind: "horizontalDistance",
    // Midpoint x 15.5, pointer up to x 20.
    label: { reach: 4.5 },
    creation: [
      [15, 8],
      [19, 8],
      [20, 4],
    ],
    drag: DRAG,
  },
  {
    name: "Vertical tool, point pair, pointer crossing into the horizontal zone",
    tool: "dimensionVertical",
    targets: (f) => [f.dStart, f.dEnd],
    referenceKind: "vertical",
    committedKind: "verticalDistance",
    // Midpoint y 4, pointer up to y 8.
    label: { reach: 4 },
    creation: [
      [20, 4],
      [20, 8],
      [15, 8],
    ],
    drag: DRAG,
  },
];

describe("cadara-y3p6 (expected to fail until fixed): a fixed-axis dimension tool's preview label follows the pointer across the other reference zone", () => {
  for (const row of ZONE_CROSSING_ROWS) {
    test.fails(
      `${row.name}: the creation preview's label never outruns the pointer and stays on its carrier`,
      () => {
        expectCreationPreviewFollows(row);
      },
    );
  }
});
