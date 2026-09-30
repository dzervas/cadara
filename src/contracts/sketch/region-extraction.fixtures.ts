/**
 * Spec support for `region-extraction.spec.ts`: small builders for evaluated
 * definitions plus accepted solved snapshots. Solved geometry is taken
 * verbatim from the authored positions (the owner consumes a solve; it never
 * solves), so each fixture controls every bitwise coordinate and residual.
 */
import type {
  ConstraintId,
  DimensionId,
  ReferenceId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchDefinition,
  SketchReferenceDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
  SolvedSketchEntityGeometryRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type { OffsetSolveFrame } from "@/contracts/sketch/offset-derivation-frame";
import type {
  SketchArrangementDerivedCurve,
  SketchArrangementInput,
} from "@/contracts/sketch/region-extraction";
import {
  reconstructSplineAggregate,
  type SplineClosure,
  type SplinePoles,
  type SplineSpan,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";
import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
} from "@/contracts/solver/schema";

export const FIXTURE_SKETCH_ID = "sketch_arrangement" as const;
/** The production document default (`OCC_KERNEL_SETTINGS.modelingTolerance`). */
export const FIXTURE_TOLERANCE = 1e-3;

const pointId = (name: string) => `sketch_point_${name}` as SketchPointId;
const entityId = (name: string) => `sketch_entity_${name}` as SketchEntityId;

export interface SketchFixture {
  point(
    name: string,
    x: number,
    y: number,
    construction?: boolean,
  ): SketchPointId;
  line(
    name: string,
    start: string,
    end: string,
    construction?: boolean,
  ): SketchEntityId;
  arc(
    name: string,
    center: string,
    start: string,
    end: string,
    sweep?: "clockwise" | "counterClockwise",
  ): SketchEntityId;
  circle(
    name: string,
    center: string,
    radius: number,
    construction?: boolean,
  ): SketchEntityId;
  /** `tangents[i]`, when given, is occurrence i's authored handle vector. */
  spline(
    name: string,
    points: readonly string[],
    closure: SplineClosure,
    tangents?: readonly (SplineVector | null)[],
  ): SketchEntityId;
  ellipse(
    name: string,
    center: string,
    major: string,
    minorRadius: number,
  ): SketchEntityId;
  coincident(first: string, second: string): ConstraintId;
  pointOnCurve(point: string, curve: string): ConstraintId;
  midpoint(point: string, line: string): ConstraintId;
  lineLength(line: string, value: number): DimensionId;
  /** An authored model reference whose projection yields `geometry`. */
  project(
    name: string,
    geometry: ProjectedSketchReferenceGeometry[],
  ): ReferenceId;
  /** Moves an authored point (the solved position follows it verbatim). */
  move(name: string, x: number, y: number): void;
  definition(): SketchDefinition;
  build(options?: {
    modelingTolerance?: number;
    solvedSnapshot?: SolvedSketchSnapshot;
    projectedReferences?: ProjectedSketchReferenceRecord[];
    /** T08b-g3: published derived shells (absent: no `derivedCurves` field). */
    derivedCurves?: readonly SketchArrangementDerivedCurve[];
  }): SketchArrangementInput;
}

export function makeSketchFixture(): SketchFixture {
  const points: SketchPointDefinition[] = [];
  const entities: SketchEntityDefinition[] = [];
  const constraints: ConstraintDefinition[] = [];
  const dimensions: DimensionDefinition[] = [];
  const references: SketchReferenceDefinition[] = [];
  const projected: ProjectedSketchReferenceRecord[] = [];
  const entityTarget = (name: string) => ({
    kind: "sketchEntity" as const,
    sketchId: FIXTURE_SKETCH_ID,
    entityId: entityId(name),
  });
  const constraintId = () => `constraint_${constraints.length}` as ConstraintId;

  const definition = (): SketchDefinition => ({
    schemaVersion: "sketch-definition/v1alpha1",
    referenceIds: references.map((reference) => reference.referenceId),
    references: [...references],
    pointIds: points.map((point) => point.pointId),
    points: points.map((point) => ({ ...point })),
    entityIds: entities.map((entity) => entity.entityId),
    entities: [...entities],
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints: [...constraints],
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    dimensions: [...dimensions],
  });

  const solve = (current: SketchDefinition): SolvedSketchSnapshot => {
    const positions = Object.fromEntries(
      current.points.map((point) => [point.pointId, point.position]),
    ) as Record<SketchPointId, SplineVector>;
    const solvedEntities = current.entities.map(
      (entity): SolvedSketchEntityGeometryRecord => {
        switch (entity.kind) {
          case "lineSegment":
            return {
              entityId: entity.entityId,
              kind: "lineSegment",
              startPosition: positions[entity.startPointId]!,
              endPosition: positions[entity.endPointId]!,
            };
          case "arc":
            return {
              entityId: entity.entityId,
              kind: "arc",
              centerPosition: positions[entity.centerPointId]!,
              startPosition: positions[entity.startPointId]!,
              endPosition: positions[entity.endPointId]!,
              sweepDirection: entity.sweepDirection,
            };
          case "circle":
            return {
              entityId: entity.entityId,
              kind: "circle",
              centerPosition: positions[entity.centerPointId]!,
              solvedRadius: entity.radius,
            };
          case "spline":
            return {
              entityId: entity.entityId,
              kind: "spline",
              reconstruction: reconstructSplineAggregate(entity, positions),
            };
          case "ellipse":
            return {
              entityId: entity.entityId,
              kind: "ellipse",
              centerPosition: positions[entity.centerPointId]!,
              majorAxisEndpointPosition: positions[entity.majorAxisPointId]!,
              minorRadius: entity.minorRadius,
            };
          default:
            throw new Error(`fixture does not build ${entity.kind}`);
        }
      },
    );
    return {
      schemaVersion: "solved-sketch/v1alpha1",
      status: { solveState: "solved", constraintState: "wellConstrained" },
      solvedEntities,
      solvedPoints: current.points.map((point) => ({
        pointId: point.pointId,
        target: point.target,
        solvedPosition: point.position,
      })),
      constraintStatuses: current.constraints.map((constraint) => ({
        constraintId: constraint.constraintId,
        status: "satisfied",
      })),
      dimensionStatuses: [],
      diagnostics: [],
    };
  };

  return {
    point(name, x, y, construction = false) {
      points.push({
        pointId: pointId(name),
        label: name,
        target: {
          kind: "sketchPoint",
          sketchId: FIXTURE_SKETCH_ID,
          pointId: pointId(name),
        },
        position: [x, y],
        isConstruction: construction,
      });
      return pointId(name);
    },
    line(name, start, end, construction = false) {
      entities.push({
        kind: "lineSegment",
        entityId: entityId(name),
        label: name,
        target: entityTarget(name),
        isConstruction: construction,
        startPointId: pointId(start),
        endPointId: pointId(end),
      });
      return entityId(name);
    },
    arc(name, center, start, end, sweep = "counterClockwise") {
      entities.push({
        kind: "arc",
        entityId: entityId(name),
        label: name,
        target: entityTarget(name),
        isConstruction: false,
        centerPointId: pointId(center),
        startPointId: pointId(start),
        endPointId: pointId(end),
        sweepDirection: sweep,
      });
      return entityId(name);
    },
    circle(name, center, radius, construction = false) {
      entities.push({
        kind: "circle",
        entityId: entityId(name),
        label: name,
        target: entityTarget(name),
        isConstruction: construction,
        centerPointId: pointId(center),
        radius,
      });
      return entityId(name);
    },
    spline(name, names, closure, tangents = []) {
      entities.push({
        kind: "spline",
        entityId: entityId(name),
        label: name,
        target: entityTarget(name),
        isConstruction: false,
        pointOccurrenceIds: names.map((_, index) => `${name}_o${index}`),
        pointOccurrences: names.map((point, index) => ({
          occurrenceId: `${name}_o${index}`,
          pointId: pointId(point),
          tangent: tangents[index]
            ? { kind: "authored" as const, vector: tangents[index] }
            : { kind: "automatic" as const },
        })),
        closure,
        interpolationPolicy: "centripetal-mean-arm-v1",
      });
      return entityId(name);
    },
    ellipse(name, center, major, minorRadius) {
      entities.push({
        kind: "ellipse",
        entityId: entityId(name),
        label: name,
        target: entityTarget(name),
        isConstruction: false,
        centerPointId: pointId(center),
        majorAxisPointId: pointId(major),
        minorRadius,
      });
      return entityId(name);
    },
    coincident(first, second) {
      const id = constraintId();
      constraints.push({
        constraintId: id,
        kind: "coincident",
        label: id,
        pointIds: [pointId(first), pointId(second)],
      });
      return id;
    },
    pointOnCurve(point, curve) {
      const id = constraintId();
      constraints.push({
        constraintId: id,
        kind: "pointOnCurve",
        label: id,
        point: { kind: "localPoint", pointId: pointId(point) },
        curve: { kind: "localEntity", entityId: entityId(curve) },
      });
      return id;
    },
    midpoint(point, line) {
      const id = constraintId();
      constraints.push({
        constraintId: id,
        kind: "midpoint",
        label: id,
        point: { kind: "localPoint", pointId: pointId(point) },
        line: { kind: "localEntity", entityId: entityId(line) },
      });
      return id;
    },
    lineLength(line, value) {
      const id = `dimension_${dimensions.length}` as DimensionId;
      dimensions.push({
        dimensionId: id,
        kind: "lineLength",
        label: id,
        entityId: entityId(line),
        value,
      });
      return id;
    },
    project(name, geometry) {
      const referenceId = `ref_${name}` as ReferenceId;
      references.push({
        referenceId,
        kind: "modelReference",
        label: name,
        source: {
          kind: "edge",
          bodyId: "body_fixture",
          edgeId: `edge_${name}`,
        },
        projectionMode: "projectAlongPlaneNormal",
      } as SketchReferenceDefinition);
      projected.push({
        referenceId,
        status: "projected",
        geometry,
        diagnostics: [],
      });
      return referenceId;
    },
    move(name, x, y) {
      const index = points.findIndex(
        (point) => point.pointId === pointId(name),
      );
      points[index] = { ...points[index]!, position: [x, y] };
    },
    definition,
    build(options = {}) {
      const current = definition();
      return {
        documentId: "doc_arrangement",
        revisionId: "rev_arrangement",
        sketchId: FIXTURE_SKETCH_ID,
        definition: current,
        solvedSnapshot: options.solvedSnapshot ?? solve(current),
        projectedReferences: options.projectedReferences ?? [...projected],
        modelingTolerance: options.modelingTolerance ?? FIXTURE_TOLERANCE,
        ...(options.derivedCurves
          ? { derivedCurves: options.derivedCurves }
          : {}),
      };
    },
  };
}

/** One valid projected neutral cubic span over [start, start + 1], keyed by its knot occurrences. */
export function neutralSpan(
  poles: SplineVector[],
  index: number,
  occurrences: [string, string],
  start: number,
): SplineSpan {
  return {
    source: {
      splineId: "projected",
      spanIndex: index,
      startPointId: "a",
      endPointId: "b",
      startOccurrenceId: occurrences[0],
      endOccurrenceId: occurrences[1],
    },
    orientation: "forward",
    interval: [start, start + 1],
    poles: poles as unknown as SplineSpan["poles"],
    validity: "valid",
    differential: {
      interval: [0, 0],
      poles: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
    },
  };
}

/** A projected spline geometry given as neutral cubic spans. */
export function projectedSpline(
  geometryId: string,
  spans: SplineSpan[],
): ProjectedSketchReferenceGeometry {
  return {
    geometryId: geometryId as `projected_geometry_${string}`,
    kind: "spline",
    representation: { kind: "neutralCubicSpans", spans },
  };
}

/**
 * Axis-aligned rectangle `name` with corners `${name}0..3` (counter-clockwise
 * from (x0, y0)) and sides `${name}_s0..3`. `corners: "shared"` reuses one
 * point per corner; `"coincident"` gives each side its own endpoints joined by
 * satisfied coincident constraints, with `offset` added to side 0's end point
 * (a solver residual: positive overshoots along +x, negative undershoots).
 */
export function addRectangle(
  sketch: SketchFixture,
  name: string,
  [x0, y0, x1, y1]: readonly [number, number, number, number],
  corners: "shared" | "coincident" = "shared",
  offset = 0,
) {
  const at: SplineVector[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  if (corners === "shared") {
    at.forEach(([x, y], index) => sketch.point(`${name}${index}`, x, y));
    for (let index = 0; index < 4; index += 1)
      sketch.line(
        `${name}_s${index}`,
        `${name}${index}`,
        `${name}${(index + 1) % 4}`,
      );
    return;
  }
  for (let index = 0; index < 4; index += 1) {
    const [sx, sy] = at[index]!;
    const [ex, ey] = at[(index + 1) % 4]!;
    sketch.point(`${name}${index}s`, sx, sy);
    sketch.point(`${name}${index}e`, index === 0 ? ex + offset : ex, ey);
    sketch.line(`${name}_s${index}`, `${name}${index}s`, `${name}${index}e`);
  }
  for (let index = 0; index < 4; index += 1)
    sketch.coincident(`${name}${index}e`, `${name}${(index + 1) % 4}s`);
}

/** One published offset piece in traversal order (the area oracle's input). */
export type PublishedOffsetPiece =
  | { kind: "line"; start: SplineVector; end: SplineVector }
  | {
      kind: "arc";
      center: SplineVector;
      start: SplineVector;
      end: SplineVector;
      sweep: "clockwise" | "counterClockwise";
      reversed: boolean;
    }
  | { kind: "circle"; center: SplineVector; radius: number }
  | {
      kind: "cubic";
      spans: readonly {
        poles: SplinePoles;
        domain: readonly [number, number];
        queryDomain: readonly [number, number];
      }[];
      reversed: boolean;
    };

export interface OffsetPublicationOutputs {
  /** The shells' derived-curve inputs, one per derived-cubic piece. */
  derivedCurves: SketchArrangementDerivedCurve[];
  /** Point names of an open chain's traversal start and end (null when closed). */
  start: string | null;
  end: string | null;
  /** The published loop or chain in traversal order. */
  pieces: PublishedOffsetPiece[];
}

const sameBits = (first: SplineVector, second: SplineVector) =>
  Object.is(first[0], second[0]) && Object.is(first[1], second[1]);

/**
 * T08b-g3: authors one certified offset publication's outputs into `sketch`
 * the way T08b-g5 persists them, from the published frame only: line and
 * seed-arc outputs and joint arcs are ordinary entities; each derived-cubic
 * piece is one derived shell. Every adjacency is one shared driven point
 * (a trim at the published trim point, a vertex at the adopted shared pole,
 * [TECH] G6), or a joint arc between the neighbours' own terminal points.
 * Positions are the published binary64 values, checked bitwise where two
 * outputs share one (the solve takes authored positions verbatim).
 */
export function addOffsetFramePublication(
  sketch: SketchFixture,
  frame: OffsetSolveFrame,
  prefix = "off",
): OffsetPublicationOutputs {
  const { pieces } = frame;
  const count = pieces.length;
  const closed = frame.connectivity.closed;
  const plan = frame.plan.adjacencies;
  const trims = new Map(frame.trims.map((trim) => [trim.jointIndex, trim]));
  const arcs = new Map(frame.arcs.map((arc) => [arc.jointIndex, arc]));
  const name = (suffix: string) => `${prefix}_${suffix}`;
  const natural = (index: number) => {
    const piece = pieces[index]!;
    if (piece.kind === "derivedCubic") {
      const spans = frame.cubics.get(piece.seedEntityId)!;
      return {
        start: spans[0]!.span.poles[0],
        end: spans.at(-1)!.span.poles[3],
      };
    }
    if (piece.kind === "circle") throw new Error("a circle has no ends");
    const ends = frame.lineArcEndpoints.get(piece.seedEntityId)!;
    return { start: ends.start, end: ends.end };
  };
  const traversal = (index: number) => {
    const ends = natural(index);
    return pieces[index]!.reversed
      ? { entry: ends.end, exit: ends.start }
      : { entry: ends.start, exit: ends.end };
  };
  const junctions = closed ? count : count - 1;
  const exitName = (index: number) =>
    !closed && index === count - 1
      ? name("end")
      : name(`${plan[index]!.kind === "arc" ? "a" : "j"}${index}`);
  const entryName = (index: number) => {
    if (!closed && index === 0) return name("start");
    const joint = (index - 1 + count) % count;
    return name(`${plan[joint]!.kind === "arc" ? "b" : "j"}${joint}`);
  };
  const ids = new Map<string, SketchPointId>();
  const point = (key: string, at: SplineVector) =>
    ids.set(key, sketch.point(key, at[0], at[1]));
  const jointArcs: PublishedOffsetPiece[] = [];
  if (count === 1 && pieces[0]!.kind === "circle") {
    const circle = pieces[0];
    sketch.point(name("k0"), circle.center[0], circle.center[1]);
    sketch.circle(name("p0"), name("k0"), circle.radius);
    return {
      derivedCurves: [],
      start: null,
      end: null,
      pieces: [
        { kind: "circle", center: circle.center, radius: circle.radius },
      ],
    };
  }
  for (let joint = 0; joint < junctions; joint += 1) {
    const next = (joint + 1) % count;
    const entry = plan[joint]!;
    const exit = traversal(joint).exit;
    const enter = traversal(next).entry;
    if (entry.kind === "trim") {
      const trim = trims.get(joint)!;
      for (const side of [joint, next])
        if (
          pieces[side]!.kind !== "derivedCubic" &&
          !sameBits(side === joint ? exit : enter, trim.position)
        )
          throw new Error(`trim ${joint}: an output end is not the trim point`);
      point(name(`j${joint}`), trim.position);
    } else if (entry.kind === "arc") {
      const arc = arcs.get(joint)!;
      if (!sameBits(arc.start, exit) || !sameBits(arc.end, enter))
        throw new Error(`arc ${joint}: an end is not its neighbour's end`);
      point(name(`a${joint}`), arc.start);
      point(name(`b${joint}`), arc.end);
      sketch.point(name(`c${joint}`), arc.center[0], arc.center[1]);
      sketch.arc(
        name(`arc${joint}`),
        name(`c${joint}`),
        name(`a${joint}`),
        name(`b${joint}`),
        arc.sweepDirection,
      );
      jointArcs[joint] = {
        kind: "arc",
        center: arc.center,
        start: arc.start,
        end: arc.end,
        sweep: arc.sweepDirection,
        reversed: false,
      };
    } else {
      if (!sameBits(exit, enter))
        throw new Error(`vertex ${joint}: the shared pole is not bitwise`);
      point(name(`j${joint}`), exit);
    }
  }
  if (!closed) {
    point(name("start"), traversal(0).entry);
    point(name("end"), traversal(count - 1).exit);
  }
  const derivedCurves: SketchArrangementDerivedCurve[] = [];
  const published: PublishedOffsetPiece[] = [];
  pieces.forEach((piece, index) => {
    const startName = piece.reversed ? exitName(index) : entryName(index);
    const endName = piece.reversed ? entryName(index) : exitName(index);
    const own = name(`p${index}`);
    if (piece.kind === "lineSegment") {
      sketch.line(own, startName, endName);
      const { entry, exit } = traversal(index);
      published.push({ kind: "line", start: entry, end: exit });
    } else if (piece.kind === "arc") {
      sketch.point(name(`k${index}`), piece.center[0], piece.center[1]);
      sketch.arc(
        own,
        name(`k${index}`),
        startName,
        endName,
        piece.sweepDirection,
      );
      const ends = natural(index);
      published.push({
        kind: "arc",
        center: piece.center,
        start: ends.start,
        end: ends.end,
        sweep: piece.sweepDirection,
        reversed: piece.reversed,
      });
    } else if (piece.kind === "derivedCubic") {
      const spans = frame.cubics.get(piece.seedEntityId)!;
      let subIndex = 0;
      derivedCurves.push({
        outputEntityId: entityId(own),
        startPointId: ids.get(startName)!,
        endPointId: ids.get(endName)!,
        spans: spans.map((span, offset) => {
          const outputSpanId = `${span.span.source.startOccurrenceId}>${span.span.source.endOccurrenceId}`;
          const previous = spans[offset - 1]?.span.source;
          subIndex =
            previous &&
            `${previous.startOccurrenceId}>${previous.endOccurrenceId}` ===
              outputSpanId
              ? subIndex + 1
              : 0;
          return {
            outputSpanId,
            subIndex,
            poles: span.span.poles,
            sourceDomain: span.sourceDomain,
            queryDomain: span.representativeQueryDomain,
          };
        }),
      });
      published.push({
        kind: "cubic",
        spans: spans.map((span) => ({
          poles: span.span.poles,
          domain: span.sourceDomain,
          queryDomain: span.representativeQueryDomain,
        })),
        reversed: piece.reversed,
      });
    } else throw new Error("a circle in a chain");
    const arc = jointArcs[index];
    if (arc && (closed || index < count - 1)) published.push(arc);
  });
  return {
    derivedCurves,
    start: closed ? null : name("start"),
    end: closed ? null : name("end"),
    pieces: published,
  };
}

/** A parametrized curve piece traversed from `from` to `to` (spec-only area oracle). */
export interface OracleCurve {
  point(t: number): SplineVector;
  derivative(t: number): SplineVector;
  from: number;
  to: number;
}

export function lineOracle(
  start: SplineVector,
  end: SplineVector,
): OracleCurve {
  const d: SplineVector = [end[0] - start[0], end[1] - start[1]];
  return {
    point: (t) => [start[0] + t * d[0], start[1] + t * d[1]],
    derivative: () => d,
    from: 0,
    to: 1,
  };
}

/** A point-defined arc as consumers draw it: radius |start − centre|, atan2 end angles. */
export function arcOracle(
  center: SplineVector,
  start: SplineVector,
  end: SplineVector,
  sweep: "clockwise" | "counterClockwise",
  reversed = false,
): OracleCurve {
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
  const from = Math.atan2(start[1] - center[1], start[0] - center[0]);
  let to = Math.atan2(end[1] - center[1], end[0] - center[0]);
  if (sweep === "counterClockwise") while (to <= from) to += 2 * Math.PI;
  else while (to >= from) to -= 2 * Math.PI;
  return {
    point: (t) => [
      center[0] + radius * Math.cos(t),
      center[1] + radius * Math.sin(t),
    ],
    derivative: (t) => [-radius * Math.sin(t), radius * Math.cos(t)],
    from: reversed ? to : from,
    to: reversed ? from : to,
  };
}

/** A cubic Bézier on `domain` (Bernstein form), traversed `from` → `to`. */
export function cubicOracle(
  poles: SplinePoles,
  domain: readonly [number, number],
  from: number,
  to: number,
): OracleCurve {
  const [a, b] = domain;
  const u = (t: number) => (t - a) / (b - a);
  return {
    point: (t) => {
      const s = u(t);
      const w = [
        (1 - s) ** 3,
        3 * s * (1 - s) ** 2,
        3 * s * s * (1 - s),
        s ** 3,
      ];
      return [0, 1].map((axis) =>
        w.reduce((sum, weight, k) => sum + weight * poles[k]![axis]!, 0),
      ) as unknown as SplineVector;
    },
    derivative: (t) => {
      const s = u(t);
      const w = [(1 - s) ** 2, 2 * s * (1 - s), s * s];
      return [0, 1].map(
        (axis) =>
          (3 / (b - a)) *
          w.reduce(
            (sum, weight, k) =>
              sum + weight * (poles[k + 1]![axis]! - poles[k]![axis]!),
            0,
          ),
      ) as unknown as SplineVector;
    },
    from,
    to,
  };
}

/** Oracle curves of a published loop or chain, in traversal order. */
export function publishedOracleCurves(
  pieces: readonly PublishedOffsetPiece[],
): OracleCurve[] {
  return pieces.flatMap((piece): OracleCurve[] => {
    if (piece.kind === "line") return [lineOracle(piece.start, piece.end)];
    if (piece.kind === "arc")
      return [
        arcOracle(
          piece.center,
          piece.start,
          piece.end,
          piece.sweep,
          piece.reversed,
        ),
      ];
    if (piece.kind === "circle")
      return [
        arcOracle(
          piece.center,
          [piece.center[0] + piece.radius, piece.center[1]],
          [piece.center[0] + piece.radius, piece.center[1]],
          "counterClockwise",
        ),
      ];
    const curves = piece.spans.map((span) =>
      cubicOracle(
        span.poles,
        span.domain,
        span.queryDomain[0],
        span.queryDomain[1],
      ),
    );
    return piece.reversed
      ? curves
          .reverse()
          .map((curve) => ({ ...curve, from: curve.to, to: curve.from }))
      : curves;
  });
}

/**
 * Signed area of a closed sequence of curves (composite 5-point
 * Gauss–Legendre of ½∫(x y′ − y x′) dt, spec-only oracle), each consecutive
 * end joined to the next start by a straight connector.
 */
export function closedCurvesSignedArea(curves: readonly OracleCurve[]): number {
  const nodes = [
    0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664,
    0.906179845938664,
  ];
  const weights = [
    0.5688888888888889, 0.47862867049936647, 0.47862867049936647,
    0.23692688505618908, 0.23692688505618908,
  ];
  const origin = curves[0]!.point(curves[0]!.from);
  const cross = (p: SplineVector, q: SplineVector) =>
    0.5 *
    ((p[0] - origin[0]) * (q[1] - origin[1]) -
      (p[1] - origin[1]) * (q[0] - origin[0]));
  let total = 0;
  curves.forEach((curve, index) => {
    const pieces = 256;
    for (let piece = 0; piece < pieces; piece += 1) {
      const a = curve.from + ((curve.to - curve.from) * piece) / pieces;
      const b = curve.from + ((curve.to - curve.from) * (piece + 1)) / pieces;
      nodes.forEach((node, k) => {
        const t = (a + b) / 2 + ((b - a) / 2) * node;
        const [x, y] = curve.point(t);
        const [dx, dy] = curve.derivative(t);
        total +=
          weights[k]! *
          ((b - a) / 2) *
          0.5 *
          ((x - origin[0]) * dy - (y - origin[1]) * dx);
      });
    }
    const following = curves[(index + 1) % curves.length]!;
    total += cross(curve.point(curve.to), following.point(following.from));
  });
  return total;
}

/** Arc length of a sequence of curves (the same quadrature, spec-only oracle). */
export function curvesLength(curves: readonly OracleCurve[]): number {
  const nodes = [
    0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664,
    0.906179845938664,
  ];
  const weights = [
    0.5688888888888889, 0.47862867049936647, 0.47862867049936647,
    0.23692688505618908, 0.23692688505618908,
  ];
  let total = 0;
  for (const curve of curves) {
    const pieces = 256;
    for (let piece = 0; piece < pieces; piece += 1) {
      const a = curve.from + ((curve.to - curve.from) * piece) / pieces;
      const b = curve.from + ((curve.to - curve.from) * (piece + 1)) / pieces;
      nodes.forEach((node, k) => {
        const [dx, dy] = curve.derivative((a + b) / 2 + ((b - a) / 2) * node);
        total += weights[k]! * (Math.abs(b - a) / 2) * Math.hypot(dx, dy);
      });
    }
  }
  return total;
}
