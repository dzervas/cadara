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
import type { SketchArrangementInput } from "@/contracts/sketch/region-extraction";
import {
  reconstructSplineAggregate,
  type SplineClosure,
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
