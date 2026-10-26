// cadara-3wp6, logic lane (core registry seams: `inferDimensionAnnotationPlacement`,
// the Distance tool's `buildPreview` and `createCommitContribution`): a
// routing guard for the Distance tool's placement inference.
//
// `inferDimensionAnnotationPlacement` is an order-dependent if-chain over the
// picked target kinds. A branch inserted ahead of another (cadara-bmy0 added
// line + point before the generic line branch) silently re-routes other
// pairs, and rows that assert committed geometry keep passing. Every
// reachable pick combination here names the placement semantics it must be
// routed to, and the preview and committed kinds that read that placement;
// a placement equal to a different route's (or to none) fails the row.
import { expect, test } from "vitest";

import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type { ConstraintId, DimensionId } from "@/contracts/shared/ids";
import {
  FIXTURE_SKETCH_ID,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchConstraintTargetRecord } from "@/core/sketch-constraints/definition";
import {
  getSketchConstraintDefinition,
  inferDimensionAnnotationPlacement,
  inferLinePointDimensionPlacement,
  inferParallelLineDimensionPlacement,
  selectPointToPointDimensionReference,
} from "@/core/sketch-constraints/registry";

const distanceTool = getSketchConstraintDefinition("dimensionDistance");

function makeTargets() {
  const fixture = makeSketchFixture();
  fixture.point("p", 3, 5);
  fixture.point("q", 7, 9);
  fixture.point("l0", 1, 1);
  fixture.point("l1", 5, 2);
  fixture.point("m0", 1, 4);
  fixture.point("m1", 5, 5);
  fixture.point("n0", 8, 1);
  fixture.point("n1", 9, 6);
  fixture.point("h0", 1, 2);
  fixture.point("h1", 5, 2);
  fixture.point("c", 14, 4);
  fixture.point("a0", 16, 4);
  fixture.point("a1", 14, 6);
  fixture.line("L", "l0", "l1");
  fixture.line("M", "m0", "m1");
  fixture.line("N", "n0", "n1");
  fixture.line("H", "h0", "h1");
  fixture.circle("circle", "c", 2);
  fixture.arc("arc", "c", "a0", "a1");
  const definition = fixture.definition();
  const resolve = (target: PrimitiveRef) => {
    const resolved = distanceTool.resolveTarget(definition, target);
    if (!resolved)
      throw new Error(`premise: ${JSON.stringify(target)} resolves`);
    return resolved;
  };
  const point = (name: string) =>
    resolve({
      kind: "sketchPoint",
      sketchId: FIXTURE_SKETCH_ID,
      pointId: definition.points.find((entry) => entry.label === name)!.pointId,
    } as PrimitiveRef);
  const entity = (name: string) =>
    resolve({
      kind: "sketchEntity",
      sketchId: FIXTURE_SKETCH_ID,
      entityId: definition.entities.find((entry) => entry.label === name)!
        .entityId,
    } as PrimitiveRef);
  const datum = (datumId: "origin" | "xAxis" | "yAxis") =>
    resolve({
      kind: "sketchDatumReference",
      sketchId: FIXTURE_SKETCH_ID,
      datumId,
      geometryKind: datumId === "origin" ? "point" : "lineSegment",
    } as PrimitiveRef);
  return {
    point: point("p"),
    otherPoint: point("q"),
    line: entity("L"),
    parallelLine: entity("M"),
    crossingLine: entity("N"),
    horizontalLine: entity("H"),
    circle: entity("circle"),
    arc: entity("arc"),
    origin: datum("origin"),
    xAxis: datum("xAxis"),
    yAxis: datum("yAxis"),
  };
}

type Targets = ReturnType<typeof makeTargets>;
type Target = SketchConstraintTargetRecord;
type Line = NonNullable<Target["line"]>;

const unit = (line: Line) => {
  const dx = line.end[0] - line.start[0];
  const dy = line.end[1] - line.start[1];
  const length = Math.hypot(dx, dy);
  return [dx / length, dy / length] as const;
};

/**
 * Each placement semantics the Distance tool may route a pick to, as the
 * placement it gives `pointer` (null when it does not apply to the pick).
 */
const ROUTES = {
  /** A circle or arc: the rim direction towards the pointer. */
  circleAngle: ([first]: readonly Target[], pointer: SketchPoint) =>
    first?.circle
      ? {
          kind: "dimensionLine",
          offset: 0,
          angleRadians: Math.atan2(
            pointer[1] - first.circle.center[1],
            pointer[0] - first.circle.center[0],
          ),
        }
      : null,
  /** One line: the pointer's signed distance from it (its length line). */
  lineNormal: ([first]: readonly Target[], pointer: SketchPoint) => {
    if (!first?.line) return null;
    const [ux, uy] = unit(first.line);
    return {
      kind: "dimensionLine",
      offset:
        (pointer[0] - first.line.start[0]) * -uy +
        (pointer[1] - first.line.start[1]) * ux,
    };
  },
  /** Two crossing lines: an arc through the pointer. */
  angleArc: ([first, second]: readonly Target[]) =>
    first?.line && second?.line ? { kind: "angleArc" } : null,
  /** Two parallel lines: the pointer's position along the first line. */
  parallelAlong: ([first, second]: readonly Target[], pointer: SketchPoint) =>
    first?.line && second?.line
      ? inferParallelLineDimensionPlacement(first.line, pointer)
      : null,
  /** A line and a point (either order): the label at the pointer. */
  linePoint: ([first, second]: readonly Target[], pointer: SketchPoint) => {
    const line = first?.line ? first : second?.line ? second : null;
    const point = line === first ? second : first;
    return line?.line && point && !point.line
      ? inferLinePointDimensionPlacement(line.line, point.anchor, pointer)
      : null;
  },
  /** Two points: the offset across the reference axis the pointer picks. */
  pointPair: ([first, second]: readonly Target[], pointer: SketchPoint) => {
    if (!first || !second || first.line || second.line) return null;
    const axis = selectPointToPointDimensionReference({
      first: first.anchor,
      second: second.anchor,
      pointer,
    });
    if (axis === "horizontal") {
      return { kind: "dimensionLine", offset: pointer[1] - first.anchor[1] };
    }
    if (axis === "vertical") {
      return { kind: "dimensionLine", offset: pointer[0] - first.anchor[0] };
    }
    const [ux, uy] = unit({ start: first.anchor, end: second.anchor });
    return {
      kind: "dimensionLine",
      offset:
        (pointer[0] - first.anchor[0]) * -uy +
        (pointer[1] - first.anchor[1]) * ux,
    };
  },
} as const;

type Route = keyof typeof ROUTES;

/** Every route whose placement for the pick equals `placement`. */
function routesOf(
  targets: readonly Target[],
  pointer: SketchPoint,
  placement: unknown,
): Route[] {
  return (Object.keys(ROUTES) as Route[]).filter((route) => {
    const expected = ROUTES[route](targets, pointer);
    if (!expected || !placement || typeof placement !== "object") return false;
    if (route === "angleArc") {
      return (placement as { kind?: unknown }).kind === "angleArc";
    }
    const actual = placement as Record<string, unknown>;
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return [...keys].every((key) => {
      const want = (expected as Record<string, unknown>)[key];
      const got = actual[key];
      return typeof want === "number" && typeof got === "number"
        ? Math.abs(want - got) < 1e-9
        : want === got;
    });
  });
}

interface RoutingRow {
  pick: string;
  targets: (targets: Targets) => readonly Target[];
  pointer: SketchPoint;
  route: Route;
  /** The preview overlay's reference kind (null: an angle arc). */
  previewKind: string | null;
  committedKind: string;
}

const ROWS: readonly RoutingRow[] = [
  {
    pick: "circle",
    targets: (t) => [t.circle],
    pointer: [17, 5],
    route: "circleAngle",
    previewKind: "diameter",
    committedKind: "diameter",
  },
  {
    pick: "arc",
    targets: (t) => [t.arc],
    pointer: [17, 5],
    route: "circleAngle",
    previewKind: "diameter",
    committedKind: "diameter",
  },
  {
    pick: "line",
    targets: (t) => [t.line],
    pointer: [4, 4],
    route: "lineNormal",
    previewKind: "lineLength",
    committedKind: "lineLength",
  },
  {
    pick: "line + crossing line",
    targets: (t) => [t.line, t.crossingLine],
    pointer: [6, 3],
    route: "angleArc",
    previewKind: null,
    committedKind: "lineAngle",
  },
  {
    pick: "line + parallel line",
    targets: (t) => [t.line, t.parallelLine],
    pointer: [4, 3],
    route: "parallelAlong",
    previewKind: "lineDistance",
    committedKind: "lineDistance",
  },
  {
    pick: "horizontal line + X axis",
    targets: (t) => [t.horizontalLine, t.xAxis],
    pointer: [4, 1],
    route: "parallelAlong",
    previewKind: "lineDistance",
    committedKind: "lineDistance",
  },
  {
    pick: "line + Y axis",
    targets: (t) => [t.line, t.yAxis],
    pointer: [2, 4],
    route: "angleArc",
    previewKind: null,
    committedKind: "lineAngle",
  },
  {
    pick: "X axis + Y axis",
    targets: (t) => [t.xAxis, t.yAxis],
    pointer: [2, 3],
    route: "angleArc",
    previewKind: null,
    committedKind: "lineAngle",
  },
  {
    pick: "line + point",
    targets: (t) => [t.line, t.point],
    pointer: [6, 6],
    route: "linePoint",
    previewKind: "pointLineDistance",
    committedKind: "linePointDistance",
  },
  {
    pick: "point + line",
    targets: (t) => [t.point, t.line],
    pointer: [6, 6],
    route: "linePoint",
    previewKind: "pointLineDistance",
    committedKind: "linePointDistance",
  },
  {
    pick: "line + origin",
    targets: (t) => [t.line, t.origin],
    pointer: [-1, 2],
    route: "linePoint",
    previewKind: "pointLineDistance",
    committedKind: "linePointDistance",
  },
  {
    pick: "origin + line",
    targets: (t) => [t.origin, t.line],
    pointer: [-1, 2],
    route: "linePoint",
    previewKind: "pointLineDistance",
    committedKind: "linePointDistance",
  },
  {
    pick: "X axis + point",
    targets: (t) => [t.xAxis, t.point],
    pointer: [6, 3],
    route: "linePoint",
    previewKind: "pointLineDistance",
    committedKind: "linePointDistance",
  },
  {
    pick: "point + Y axis",
    targets: (t) => [t.point, t.yAxis],
    pointer: [2, 7],
    route: "linePoint",
    previewKind: "pointLineDistance",
    committedKind: "linePointDistance",
  },
  {
    pick: "point + point, aligned zone",
    targets: (t) => [t.point, t.otherPoint],
    pointer: [4.7, 7.3],
    route: "pointPair",
    previewKind: "aligned",
    committedKind: "distance",
  },
  {
    pick: "point + point, horizontal zone",
    targets: (t) => [t.point, t.otherPoint],
    pointer: [5, 13],
    route: "pointPair",
    previewKind: "horizontal",
    committedKind: "distance",
  },
  {
    pick: "point + point, vertical zone",
    targets: (t) => [t.point, t.otherPoint],
    pointer: [12, 7],
    route: "pointPair",
    previewKind: "vertical",
    committedKind: "distance",
  },
  {
    pick: "point + origin",
    targets: (t) => [t.point, t.origin],
    pointer: [-3, 3],
    route: "pointPair",
    previewKind: "vertical",
    committedKind: "pointDatumDistance",
  },
  {
    pick: "origin + point",
    targets: (t) => [t.origin, t.point],
    pointer: [1.5, 9],
    route: "pointPair",
    previewKind: "horizontal",
    committedKind: "pointDatumDistance",
  },
];

for (const row of ROWS) {
  test(`cadara-3wp6 routing guard: a Distance ${row.pick} pick is placed by the ${row.route} route, previewed as ${row.previewKind ?? "an angle arc"} and committed as ${row.committedKind}`, () => {
    const targets = row.targets(makeTargets());
    expect(
      distanceTool.isReadyForValue?.(targets),
      "premise: the pick is complete",
    ).toBe(true);
    const placement = inferDimensionAnnotationPlacement(targets, row.pointer);
    expect(
      routesOf(targets, row.pointer, placement),
      `the route that produced ${JSON.stringify(placement)}`,
    ).toEqual([row.route]);

    const preview = distanceTool
      .buildPreview({
        selectedTargets: targets,
        hoverTarget: null,
        pointer: row.pointer,
        value: 1,
        annotationPlacement: placement,
      })
      .find(
        (overlay) =>
          overlay.kind === "dimensionLine" || overlay.kind === "angleArc",
      );
    expect(
      preview?.kind === "dimensionLine"
        ? preview.referenceKind
        : preview?.kind === "angleArc"
          ? null
          : "no preview",
      "the preview that reads the placement",
    ).toBe(row.previewKind);

    const committed = distanceTool.createCommitContribution({
      sequence: 1,
      selectedTargets: targets,
      pointer: row.pointer,
      value: createLiteralAuthoredValue(1),
      annotationPlacement: placement,
      createConstraintId: (suffix) => `constraint_${suffix}` as ConstraintId,
      createDimensionId: (suffix) => `dimension_${suffix}` as DimensionId,
    }).dimensions;
    expect(
      committed?.map((dimension) => dimension.kind),
      "the committed dimension that reads the placement",
    ).toEqual([row.committedKind]);
    expect(
      committed?.[0] && "annotationPlacement" in committed[0]
        ? committed[0].annotationPlacement?.kind
        : undefined,
      "the commit stores the placement",
    ).toBe(placement?.kind);
  });
}
