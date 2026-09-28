/**
 * Sketch region arrangement owner (T09 design §2.2–§2.5 and §3): the only
 * producer of sketch `RegionRecord`s.
 *
 * Region policy is sketch-owned; every numerical contact comes from the
 * injected `NeutralCurveQueryCapability`. `input.modelingTolerance` is the
 * only semantic linear tolerance and is passed to every query unchanged.
 * Outward-rounded boxes, certified direction/curvature ordering and interval
 * analytic areas (`region-interval-geometry.ts`) are internal safeguards: none
 * of them can close a gap or create a contact.
 */
import {
  evaluateNeutralCurve,
  type NeutralCurveJoinLocation,
  type NeutralCurveJoinRequest,
  type NeutralCurveJoinResult,
  type NeutralCurvePointWitness,
  type NeutralCurveQueryCapability,
  type NeutralCurveQueryRequest,
  type NeutralCurveQueryResult,
  type NeutralCurveSelfIntersectionRequest,
  neutralCurveWitnessProvesTangency,
} from "@/contracts/modeling/neutral-curve-query";
import type { OwnershipRecord } from "@/contracts/shared/diagnostics";
import type {
  DocumentId,
  ReferenceId,
  RegionId,
  RegionLoopId,
  RevisionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import {
  canonicalRegionSignature,
  createRegionId,
  declaredJoinVertexKey,
  intersectionVertexKey,
  overlapEndVertexKey,
  regionBranchKey,
  selfIntersectionVertexKey,
} from "@/contracts/sketch/region-identity";
import {
  boxesOverlap,
  boxHull,
  boxOfIntervalPoint,
  boxOfPoints,
  curveBox,
  curveDerivatives,
  curvePoint,
  exact,
  iv,
  ivAdd,
  ivContainsZero,
  ivCross,
  ivDiv,
  ivHull,
  ivMid,
  ivMul,
  ivNeg,
  ivOverlap,
  ivPoint,
  ivPointSub,
  ivSub,
  nextDown,
  nextUp,
  TAU,
  type Box,
  type CircleCurve,
  type CubicCurve,
  type Interval,
  type IntervalPoint,
  type OwnedCurve,
  type SegmentCurve,
  certifyNeutralCurvePieceSignedArea,
} from "@/contracts/sketch/region-interval-geometry";
import type {
  ProjectedSketchGeometryRef,
  RegionBoundaryBranch,
  RegionBoundarySegmentRecord,
  RegionBoundarySource,
  RegionBoundaryVertex,
  RegionIntersectionWitness,
  RegionLoopRecord,
  RegionRecord,
  SketchDefinition,
  SketchPoint2D,
  SketchSolveDiagnostic,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  closestSplineSpanLocation,
  type SplinePoles,
  type SplineSpan,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";
import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
} from "@/contracts/solver/schema";

export interface SketchArrangementInput {
  documentId: DocumentId;
  revisionId: RevisionId;
  sketchId: SketchId;
  /** Evaluated definition that produced `solvedSnapshot` (one accepted pair). */
  definition: SketchDefinition;
  solvedSnapshot: SolvedSketchSnapshot;
  projectedReferences: readonly ProjectedSketchReferenceRecord[];
  /** The document's settings.modelingTolerance: the only semantic linear tolerance. */
  modelingTolerance: number;
}

export interface SketchArrangementResult {
  /** Only regions whose arrangement, nesting and identity are proven. */
  regions: RegionRecord[];
  /** Targeted diagnostics. Never severity "error" (validity stays sketch-wide, §2.4). */
  diagnostics: SketchSolveDiagnostic[];
}

export interface SketchArrangementDeriver {
  derive(input: SketchArrangementInput): Promise<SketchArrangementResult>;
}

// ---------------------------------------------------------------------------
// §3.1 Branches: the only place curve kinds are listed
// ---------------------------------------------------------------------------

interface Branch {
  index: number;
  record: RegionBoundaryBranch;
  key: string;
  curve: OwnedCurve;
  /** Full circle: one symbolic winding [0, 2π). */
  closed: boolean;
  domain: Interval;
  /** Join-class member key of each domain end (authored point id or projected knot key). */
  ports: { start: string | null; end: string | null };
  /** The branch's own authored point id at each domain end. */
  portPointIds: { start: SketchPointId | null; end: SketchPointId | null };
  /** The declared point at each port: a segment's or cubic's exact end, an arc's authored end. */
  portPositions: { start: SplineVector | null; end: SplineVector | null };
  entityId: SketchEntityId | null;
  description: string;
  box: Box;
}

/** An unsupported or degenerate curve: it blocks everything its box meets. */
interface Obstacle {
  box: Box;
  code: "region-unsupported-curve" | "region-degenerate-curve";
  entityId: SketchEntityId | null;
  description: string;
  reason: string;
}

type BranchDraft = Omit<Branch, "index" | "key" | "box" | "curve"> & {
  curve:
    | Omit<SegmentCurve, "curveId">
    | Omit<CircleCurve, "curveId">
    | Omit<CubicCurve, "curveId">;
};

function sourceDescription(source: RegionBoundarySource) {
  return source.kind === "entity"
    ? `entity ${source.entityId}`
    : `projected geometry ${source.reference.referenceId}/${source.reference.geometryId}`;
}

function provenanceOf(branch: RegionBoundaryBranch) {
  return {
    sourceEntityId:
      branch.source.kind === "entity"
        ? branch.source.entityId
        : `${branch.source.reference.referenceId}/${branch.source.reference.geometryId}`,
    sourceSpanId: branch.spanId,
  };
}

const projectedPointKey = (referenceId: ReferenceId, geometryId: string) =>
  `pp:${JSON.stringify([referenceId, geometryId])}`;
const projectedKnotKey = (
  referenceId: ReferenceId,
  geometryId: string,
  occurrenceId: string,
) => `pk:${JSON.stringify([referenceId, geometryId, occurrenceId])}`;

function segmentDraft(
  source: RegionBoundarySource,
  start: SplineVector,
  end: SplineVector,
  startPointId: SketchPointId | null,
  endPointId: SketchPointId | null,
): BranchDraft | string {
  if (start[0] === end[0] && start[1] === end[1]) return "zero-length line";
  const record = { source, spanId: "whole" };
  return {
    record,
    curve: {
      kind: "line",
      form: "endpointSegment",
      provenance: provenanceOf(record),
      start,
      end,
      sourceDomain: [0, 1],
    },
    closed: false,
    domain: [0, 1],
    ports: { start: startPointId, end: endPointId },
    portPointIds: { start: startPointId, end: endPointId },
    portPositions: { start, end },
    entityId: source.kind === "entity" ? source.entityId : null,
    description: sourceDescription(source),
  };
}

/** Counter-clockwise arc interval; a clockwise arc is a reversed traversal of it. */
function arcDraft(
  source: RegionBoundarySource,
  center: SplineVector,
  start: SplineVector,
  end: SplineVector,
  sweep: "clockwise" | "counterClockwise",
  startPointId: SketchPointId | null,
  endPointId: SketchPointId | null,
): BranchDraft | string {
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
  if (!(radius > 0) || !Number.isFinite(radius)) return "zero-radius arc";
  if (start[0] === end[0] && start[1] === end[1]) return "zero-sweep arc";
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
  const counterClockwise = sweep === "counterClockwise";
  const lo = counterClockwise ? startAngle : endAngle;
  let hi = counterClockwise ? endAngle : startAngle;
  if (hi <= lo) hi += TAU;
  if (!(hi > lo) || hi - lo >= TAU) return "degenerate arc sweep";
  const record = { source, spanId: "whole" };
  const loPoint = counterClockwise ? startPointId : endPointId;
  const hiPoint = counterClockwise ? endPointId : startPointId;
  return {
    record,
    curve: {
      kind: "circle",
      provenance: provenanceOf(record),
      center,
      radius,
      xAxis: [1, 0],
      sourceDomain: { kind: "arc", interval: [lo, hi] },
    },
    closed: false,
    domain: [lo, hi],
    ports: { start: loPoint, end: hiPoint },
    portPointIds: { start: loPoint, end: hiPoint },
    portPositions: counterClockwise
      ? { start, end }
      : { start: end, end: start },
    entityId: source.kind === "entity" ? source.entityId : null,
    description: sourceDescription(source),
  };
}

function circleDraft(
  source: RegionBoundarySource,
  center: SplineVector,
  radius: number,
): BranchDraft | string {
  if (!(radius > 0) || !Number.isFinite(radius))
    return "non-positive circle radius";
  const record = { source, spanId: "whole" };
  return {
    record,
    curve: {
      kind: "circle",
      provenance: provenanceOf(record),
      center,
      radius,
      xAxis: [1, 0],
      sourceDomain: { kind: "fullTurn", seam: 0 },
    },
    closed: true,
    domain: [0, TAU],
    ports: { start: null, end: null },
    portPointIds: { start: null, end: null },
    portPositions: { start: null, end: null },
    entityId: source.kind === "entity" ? source.entityId : null,
    description: sourceDescription(source),
  };
}

function spanDraft(
  source: RegionBoundarySource,
  span: SplineSpan,
  spanId: string,
  ports: Branch["ports"],
  portPointIds: Branch["portPointIds"],
): BranchDraft {
  const record = { source, spanId };
  return {
    record,
    curve: {
      kind: "cubicBezier",
      provenance: provenanceOf(record),
      poles: span.poles,
      sourceDomain: span.interval,
    },
    closed: false,
    domain: span.interval,
    ports,
    portPointIds,
    portPositions: { start: span.poles[0], end: span.poles[3] },
    entityId: source.kind === "entity" ? source.entityId : null,
    description: `${sourceDescription(source)} span ${spanId}`,
  };
}

function outwardBox(center: SplineVector, radius: number): Box {
  return {
    x: iv(center[0] - radius, center[0] + radius),
    y: iv(center[1] - radius, center[1] + radius),
  };
}

function authoredReferenceIds(definition: SketchDefinition): Set<ReferenceId> {
  const recorded = new Set(
    definition.references.map((reference) => reference.referenceId),
  );
  return new Set(
    definition.referenceIds.filter((referenceId) => recorded.has(referenceId)),
  );
}

function projectedSource(
  reference: ProjectedSketchReferenceRecord,
  geometry: ProjectedSketchReferenceGeometry,
): RegionBoundarySource {
  const kind = (
    {
      point: "projectedPoint",
      lineSegment: "projectedLineSegment",
      circle: "projectedCircle",
      arc: "projectedArc",
      spline: "projectedSpline",
    } as const
  )[geometry.kind];
  return {
    kind: "projectedGeometry",
    reference: {
      kind,
      referenceId: reference.referenceId,
      geometryId: geometry.geometryId,
    },
  };
}

/** Collects every region-capable branch plus the unsupported/degenerate obstacles. */
function collectArrangementBranches(
  definition: SketchDefinition,
  solved: SolvedSketchSnapshot,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): { branches: Branch[]; obstacles: Obstacle[] } {
  const drafts: BranchDraft[] = [];
  const obstacles: Obstacle[] = [];
  const solvedById = new Map(
    solved.solvedEntities.map((entity) => [entity.entityId, entity]),
  );
  const addDraft = (
    draft: BranchDraft | string,
    source: RegionBoundarySource,
    box: Box,
  ) => {
    if (typeof draft !== "string") {
      drafts.push(draft);
      return;
    }
    obstacles.push({
      box,
      code: "region-degenerate-curve",
      entityId: source.kind === "entity" ? source.entityId : null,
      description: sourceDescription(source),
      reason: draft,
    });
  };
  const unsupported = (
    source: RegionBoundarySource,
    box: Box,
    reason: string,
  ) =>
    obstacles.push({
      box,
      code: "region-unsupported-curve",
      entityId: source.kind === "entity" ? source.entityId : null,
      description: sourceDescription(source),
      reason,
    });

  for (const entity of definition.entities) {
    if (entity.isConstruction || entity.kind === "point") continue;
    const source: RegionBoundarySource = {
      kind: "entity",
      entityId: entity.entityId,
    };
    const geometry = solvedById.get(entity.entityId);
    if (!geometry || geometry.kind !== entity.kind) {
      obstacles.push({
        box: { x: [-Infinity, Infinity], y: [-Infinity, Infinity] },
        code: "region-degenerate-curve",
        entityId: entity.entityId,
        description: sourceDescription(source),
        reason: "no solved geometry",
      });
      continue;
    }
    switch (geometry.kind) {
      case "lineSegment":
        if (entity.kind !== "lineSegment") break;
        addDraft(
          segmentDraft(
            source,
            geometry.startPosition,
            geometry.endPosition,
            entity.startPointId,
            entity.endPointId,
          ),
          source,
          boxOfPoints([geometry.startPosition, geometry.endPosition]),
        );
        break;
      case "arc":
        if (entity.kind !== "arc") break;
        addDraft(
          arcDraft(
            source,
            geometry.centerPosition,
            geometry.startPosition,
            geometry.endPosition,
            geometry.sweepDirection,
            entity.startPointId,
            entity.endPointId,
          ),
          source,
          outwardBox(
            geometry.centerPosition,
            Math.hypot(
              geometry.startPosition[0] - geometry.centerPosition[0],
              geometry.startPosition[1] - geometry.centerPosition[1],
            ),
          ),
        );
        break;
      case "circle":
        addDraft(
          circleDraft(source, geometry.centerPosition, geometry.solvedRadius),
          source,
          outwardBox(geometry.centerPosition, Math.abs(geometry.solvedRadius)),
        );
        break;
      case "spline": {
        if (entity.kind !== "spline") break;
        const reconstruction = geometry.reconstruction;
        if (reconstruction.validity !== "valid") {
          const positions = new Map(
            solved.solvedPoints.map((point) => [
              point.pointId,
              point.solvedPosition,
            ]),
          );
          const fitPoints = entity.pointOccurrences.flatMap((occurrence) => {
            const position = positions.get(occurrence.pointId);
            return position ? [position] : [];
          });
          addDraft(
            `invalid spline reconstruction (${reconstruction.diagnostics.map((diagnostic) => diagnostic.code).join(", ")})`,
            source,
            fitPoints.length > 0
              ? boxOfPoints(fitPoints)
              : { x: [-Infinity, Infinity], y: [-Infinity, Infinity] },
          );
          break;
        }
        for (const span of reconstruction.spans) {
          drafts.push(
            spanDraft(
              source,
              span,
              `${span.source.startOccurrenceId}>${span.source.endOccurrenceId}`,
              { start: span.source.startPointId, end: span.source.endPointId },
              {
                start: span.source.startPointId as SketchPointId,
                end: span.source.endPointId as SketchPointId,
              },
            ),
          );
        }
        break;
      }
      case "ellipse":
      case "ellipticalArc": {
        const major = Math.hypot(
          geometry.majorAxisEndpointPosition[0] - geometry.centerPosition[0],
          geometry.majorAxisEndpointPosition[1] - geometry.centerPosition[1],
        );
        unsupported(
          source,
          outwardBox(
            geometry.centerPosition,
            Math.max(major, Math.abs(geometry.minorRadius)),
          ),
          geometry.kind,
        );
        break;
      }
      case "conic":
        unsupported(
          source,
          boxOfPoints([
            geometry.startPosition,
            geometry.controlPosition,
            geometry.endPosition,
          ]),
          "conic",
        );
        break;
      case "bezierCurve":
        unsupported(
          source,
          boxOfPoints(geometry.controlPoints),
          "Bézier curve",
        );
        break;
      case "profileText":
        // A conservative envelope of any outline anchored here (not a geometric claim).
        unsupported(
          source,
          outwardBox(
            geometry.anchorPosition,
            geometry.height * (geometry.text.length + 1),
          ),
          "profile text",
        );
        break;
    }
  }

  const authored = authoredReferenceIds(definition);
  for (const reference of projectedReferences) {
    if (
      !authored.has(reference.referenceId) ||
      reference.status !== "projected"
    )
      continue;
    for (const geometry of reference.geometry) {
      const source = projectedSource(reference, geometry);
      switch (geometry.kind) {
        case "point":
          break;
        case "lineSegment":
          addDraft(
            segmentDraft(
              source,
              geometry.startPosition,
              geometry.endPosition,
              null,
              null,
            ),
            source,
            boxOfPoints([geometry.startPosition, geometry.endPosition]),
          );
          break;
        case "arc":
          addDraft(
            arcDraft(
              source,
              geometry.centerPosition,
              geometry.startPosition,
              geometry.endPosition,
              geometry.sweepDirection,
              null,
              null,
            ),
            source,
            outwardBox(
              geometry.centerPosition,
              Math.hypot(
                geometry.startPosition[0] - geometry.centerPosition[0],
                geometry.startPosition[1] - geometry.centerPosition[1],
              ),
            ),
          );
          break;
        case "circle":
          addDraft(
            circleDraft(source, geometry.centerPosition, geometry.radius),
            source,
            outwardBox(geometry.centerPosition, Math.abs(geometry.radius)),
          );
          break;
        case "spline":
          if (geometry.representation.kind === "sourceSamples") {
            unsupported(
              source,
              boxOfPoints(geometry.representation.points),
              "projected source samples",
            );
            break;
          }
          geometry.representation.spans.forEach((span, index) => {
            const start = projectedKnotKey(
              reference.referenceId,
              geometry.geometryId,
              span.source.startOccurrenceId,
            );
            const end = projectedKnotKey(
              reference.referenceId,
              geometry.geometryId,
              span.source.endOccurrenceId,
            );
            drafts.push(
              spanDraft(
                source,
                span,
                `span${index}`,
                { start, end },
                { start: null, end: null },
              ),
            );
          });
          break;
      }
    }
  }

  const branches = drafts.map((draft, index): Branch => {
    const key = regionBranchKey(draft.record);
    const curve = { ...draft.curve, curveId: key } as OwnedCurve;
    return { ...draft, index, key, curve, box: curveBox(curve) };
  });
  return { branches, obstacles };
}

// ---------------------------------------------------------------------------
// §3.2 Declared joins without tolerance
// ---------------------------------------------------------------------------

class UnionFind<T> {
  readonly #parent = new Map<T, T>();
  find(value: T): T {
    let root = value;
    while (this.#parent.has(root) && this.#parent.get(root) !== root)
      root = this.#parent.get(root)!;
    let cursor = value;
    while (cursor !== root) {
      const next = this.#parent.get(cursor) ?? root;
      this.#parent.set(cursor, root);
      cursor = next;
    }
    if (!this.#parent.has(root)) this.#parent.set(root, root);
    return root;
  }
  union(left: T, right: T) {
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) this.#parent.set(a, b);
  }
}

interface Membership {
  branch: number;
  location: NeutralCurveJoinLocation;
  port: boolean;
}

interface DeclaredJoin {
  first: NeutralCurveJoinLocation;
  second: NeutralCurveJoinLocation;
  classRoot: string;
}

interface Declarations {
  classes: UnionFind<string>;
  classMembers: Map<string, string[]>;
  /** Keyed `${first}|${second}` with first < second (branch indices). */
  pairJoins: Map<string, DeclaredJoin[]>;
  /**
   * Declared pairs whose declaration cannot be queried. Both branches are in
   * `failures` (so both components stay blocked), and the pair is not sent
   * through the ordinary query, whose result would be unused (review 6).
   */
  failedPairs: Set<string>;
  failures: { branches: number[]; reason: string }[];
  /**
   * Classes whose every membership is a port and whose member points are
   * bitwise equal: the members share the join point exactly, so the curvature
   * tie-break may order tangent members there (re-review 2). An incidence
   * host carries no declared point, so its class is never exact.
   */
  exactPointClasses: Set<string>;
}

const pairKey = (first: number, second: number) => `${first}|${second}`;

function locationOnBranch(
  branch: Branch,
  parameter: number,
): NeutralCurveJoinLocation {
  if (branch.closed) return { interior: parameter };
  if (!(parameter > branch.domain[0])) return "start";
  if (!(parameter < branch.domain[1])) return "end";
  return { interior: parameter };
}

/** The solver's representative host parameter: the closest point (line/circle), never a join by itself. */
function incidenceParameter(branch: Branch, point: SplineVector): number {
  const curve = branch.curve;
  if (curve.kind === "line") {
    const dx = curve.end[0] - curve.start[0];
    const dy = curve.end[1] - curve.start[1];
    return (
      ((point[0] - curve.start[0]) * dx + (point[1] - curve.start[1]) * dy) /
      (dx * dx + dy * dy)
    );
  }
  if (curve.kind === "circle") {
    let angle = Math.atan2(
      point[1] - curve.center[1],
      point[0] - curve.center[0],
    );
    if (curve.sourceDomain.kind === "fullTurn")
      return angle < 0 ? angle + TAU : angle;
    const [lo, hi] = curve.sourceDomain.interval;
    while (angle < lo) angle += TAU;
    while (angle >= lo + TAU) angle -= TAU;
    if (angle <= hi) return angle;
    return angle - hi < lo + TAU - angle ? hi : lo;
  }
  const located = closestSplineSpanLocation(point, [
    {
      interval: curve.sourceDomain,
      poles: curve.poles,
      differential: {
        interval: [0, 0],
        poles: [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ] as SplinePoles,
      },
    },
  ]);
  const [s0, s1] = curve.sourceDomain;
  return located ? s0 + located.u * (s1 - s0) : s0;
}

function collectDeclarations(
  definition: SketchDefinition,
  solved: SolvedSketchSnapshot,
  branches: readonly Branch[],
): Declarations {
  const classes = new UnionFind<string>();
  const satisfied = new Set(
    solved.constraintStatuses
      .filter((status) => status.status === "satisfied")
      .map((status) => status.constraintId),
  );
  const positions = new Map(
    solved.solvedPoints.map((point) => [point.pointId, point.solvedPosition]),
  );
  const entityBranches = (entityId: SketchEntityId) =>
    branches.filter(
      (branch) =>
        branch.record.source.kind === "entity" &&
        branch.record.source.entityId === entityId,
    );
  const projectedBranches = (reference: ProjectedSketchGeometryRef) =>
    branches.filter(
      (branch) =>
        branch.record.source.kind === "projectedGeometry" &&
        branch.record.source.reference.referenceId === reference.referenceId &&
        branch.record.source.reference.geometryId === reference.geometryId,
    );
  const incidences: { member: string; hosts: Branch[]; half?: boolean }[] = [];

  for (const branch of branches) {
    if (branch.ports.start) classes.find(branch.ports.start);
    if (branch.ports.end) classes.find(branch.ports.end);
  }
  for (const constraint of definition.constraints) {
    if (!satisfied.has(constraint.constraintId)) continue;
    switch (constraint.kind) {
      case "coincident":
        classes.union(constraint.pointIds[0], constraint.pointIds[1]);
        break;
      case "coincidentProjectedPoint": {
        const target = constraint.projectedPoint;
        if (target.kind === "projectedGeometry")
          classes.union(
            constraint.point.pointId,
            projectedPointKey(
              target.reference.referenceId,
              target.reference.geometryId,
            ),
          );
        else if (target.datum === "origin")
          classes.union(constraint.point.pointId, "datum:origin");
        break;
      }
      case "pointOnCurve":
        incidences.push({
          member: constraint.point.pointId,
          hosts: entityBranches(constraint.curve.entityId),
        });
        break;
      case "pointOnProjectedCurve":
        if (constraint.projectedCurve.kind === "projectedGeometry")
          incidences.push({
            member: constraint.point.pointId,
            hosts: projectedBranches(constraint.projectedCurve.reference),
          });
        break;
      case "midpoint":
        incidences.push({
          member: constraint.point.pointId,
          hosts: entityBranches(constraint.line.entityId),
          half: true,
        });
        break;
      case "midpointProjectedLine":
        if (constraint.projectedLine.kind === "projectedGeometry")
          incidences.push({
            member: constraint.point.pointId,
            hosts: projectedBranches(constraint.projectedLine.reference),
            half: true,
          });
        break;
      default:
        break;
    }
  }

  const memberships = new Map<string, Membership[]>();
  const add = (root: string, membership: Membership) => {
    const list = memberships.get(root) ?? [];
    list.push(membership);
    memberships.set(root, list);
  };
  for (const branch of branches) {
    if (branch.ports.start)
      add(classes.find(branch.ports.start), {
        branch: branch.index,
        location: "start",
        port: true,
      });
    if (branch.ports.end)
      add(classes.find(branch.ports.end), {
        branch: branch.index,
        location: "end",
        port: true,
      });
  }
  for (const incidence of incidences) {
    const position = positions.get(incidence.member as SketchPointId);
    if (!position || incidence.hosts.length === 0) continue;
    let host = incidence.hosts[0]!;
    let parameter: number;
    if (incidence.half) {
      parameter = 0.5;
    } else if (incidence.hosts.length === 1) {
      parameter = incidenceParameter(host, position);
      // The solver's line `pointOnCurve` is the infinite line. A representative
      // outside the segment's [0, 1] is no incidence with the segment: dropping
      // it can neither close a gap nor hide a contact (the pair falls back to
      // the ordinary query).
      if (host.curve.kind === "line" && (parameter < 0 || parameter > 1))
        continue;
    } else {
      // A multi-span host: the span holding the closest point carries the incidence.
      const spans = incidence.hosts.map((candidate) => {
        const curve = candidate.curve as CubicCurve;
        return {
          interval: curve.sourceDomain,
          poles: curve.poles,
          differential: {
            interval: [0, 0] as const,
            poles: [
              [0, 0],
              [0, 0],
              [0, 0],
              [0, 0],
            ] as SplinePoles,
          },
        };
      });
      const located = closestSplineSpanLocation(position, spans);
      host = incidence.hosts[located?.spanIndex ?? 0]!;
      const [s0, s1] = (host.curve as CubicCurve).sourceDomain;
      parameter = s0 + (located?.u ?? 0) * (s1 - s0);
    }
    add(classes.find(incidence.member), {
      branch: host.index,
      location: locationOnBranch(host, parameter),
      port: false,
    });
  }

  const classMembers = new Map<string, string[]>();
  for (const member of [
    ...definition.points.map((point) => point.pointId as string),
    ...branches
      .flatMap((branch) => [branch.ports.start, branch.ports.end])
      .filter((key): key is string => !!key),
    ...memberships.keys(),
  ]) {
    const root = classes.find(member);
    const list = classMembers.get(root) ?? [];
    if (!list.includes(member)) list.push(member);
    classMembers.set(root, list);
  }
  // Projected-point and datum members are known only through unions.
  for (const constraint of definition.constraints) {
    if (
      constraint.kind !== "coincidentProjectedPoint" ||
      !satisfied.has(constraint.constraintId)
    )
      continue;
    const target = constraint.projectedPoint;
    const member =
      target.kind === "projectedGeometry"
        ? projectedPointKey(
            target.reference.referenceId,
            target.reference.geometryId,
          )
        : target.datum === "origin"
          ? "datum:origin"
          : null;
    if (!member) continue;
    const root = classes.find(member);
    const list = classMembers.get(root) ?? [];
    if (!list.includes(member)) list.push(member);
    classMembers.set(root, list);
  }

  const pairJoins = new Map<string, DeclaredJoin[]>();
  const failedPairs = new Set<string>();
  const failures: Declarations["failures"] = [];
  for (const [root, list] of memberships) {
    const byBranch = new Map<number, Membership[]>();
    for (const membership of list) {
      const entries = byBranch.get(membership.branch) ?? [];
      entries.push(membership);
      byBranch.set(membership.branch, entries);
    }
    const chosen: Membership[] = [];
    for (const [branch, entries] of byBranch) {
      const ports = entries.filter((entry) => entry.port);
      if (ports.length > 1) {
        // The branch's pairs with the rest of the class are not queried, so
        // those branches are blocked with it.
        const others = [...byBranch.keys()].filter((other) => other !== branch);
        for (const other of others)
          failedPairs.add(
            pairKey(Math.min(branch, other), Math.max(branch, other)),
          );
        failures.push({
          branches: [branch, ...others],
          reason: "both ends of one branch are declared to join each other",
        });
        continue;
      }
      chosen.push(ports[0] ?? entries[0]!);
    }
    chosen.sort((left, right) => left.branch - right.branch);
    for (let a = 0; a < chosen.length; a += 1) {
      for (let b = a + 1; b < chosen.length; b += 1) {
        const key = pairKey(chosen[a]!.branch, chosen[b]!.branch);
        const joins = pairJoins.get(key) ?? [];
        joins.push({
          first: chosen[a]!.location,
          second: chosen[b]!.location,
          classRoot: root,
        });
        pairJoins.set(key, joins);
      }
    }
  }
  for (const [key, joins] of pairJoins) {
    if (joins.length <= 2) continue;
    failures.push({
      branches: key.split("|").map(Number),
      reason: `${joins.length} declared joins between one branch pair (at most two are supported)`,
    });
    pairJoins.delete(key);
    failedPairs.add(key);
  }
  for (const key of failedPairs) pairJoins.delete(key);
  const exactPointClasses = new Set<string>();
  for (const [root, list] of memberships) {
    const points = list.map((membership) =>
      membership.port
        ? branches[membership.branch]!.portPositions[
            membership.location as "start" | "end"
          ]
        : null,
    );
    const first = points[0];
    if (
      first &&
      points.every(
        (point) => point && point[0] === first[0] && point[1] === first[1],
      )
    )
      exactPointClasses.add(root);
  }
  return {
    classes,
    classMembers,
    pairJoins,
    failedPairs,
    failures,
    exactPointClasses,
  };
}

// ---------------------------------------------------------------------------
// §3.3 Queries: box pruning, one request per pair, exact-request memoization
// ---------------------------------------------------------------------------

type JoinVerified = Extract<NeutralCurveJoinResult, { kind: "verified" }>;
type PairVerified = Extract<NeutralCurveQueryResult, { kind: "verified" }>;

interface CachedQueries {
  pair(request: NeutralCurveQueryRequest): Promise<NeutralCurveQueryResult>;
  self(
    request: NeutralCurveSelfIntersectionRequest,
  ): Promise<NeutralCurveQueryResult>;
  join(request: NeutralCurveJoinRequest): Promise<NeutralCurveJoinResult>;
}

/** Exact request key: every number by its round-trip decimal (bitwise), -0 kept. */
function exactRequestKey(operation: string, request: unknown) {
  return `${operation}:${JSON.stringify(request, (_, value: unknown) =>
    typeof value === "number"
      ? Object.is(value, -0)
        ? "n-0"
        : `n${String(value)}`
      : value,
  )}`;
}

function createCachedQueries(
  queries: NeutralCurveQueryCapability,
  capacity: number,
): CachedQueries {
  const cache = new Map<string, unknown>();
  const memo = async <T>(key: string, run: () => Promise<T>): Promise<T> => {
    if (cache.has(key)) {
      const value = cache.get(key) as T;
      cache.delete(key);
      cache.set(key, value);
      return value;
    }
    const value = await run();
    cache.set(key, value);
    while (cache.size > capacity) cache.delete(cache.keys().next().value!);
    return value;
  };
  return {
    pair: (request) =>
      memo(exactRequestKey("pair", request), () =>
        queries.queryNeutralCurves(request),
      ),
    self: (request) =>
      memo(exactRequestKey("self", request), () =>
        queries.queryNeutralCurveSelfIntersections(request),
      ),
    join: (request) =>
      memo(exactRequestKey("join", request), () =>
        queries.queryNeutralCurveJoin(request),
      ),
  };
}

type PairOutcome =
  | {
      kind: "verified";
      first: number;
      second: number;
      joins: { witness: JoinVerified["joins"][number]; classRoot: string }[];
      points: readonly NeutralCurvePointWitness[];
      overlaps: PairVerified["overlaps"];
    }
  | {
      kind: "failed";
      first: number;
      second: number;
      join: boolean;
      result: "uncertain" | "unsupported";
      code: string;
      message: string;
    };

async function queryArrangement(
  queries: CachedQueries,
  branches: readonly Branch[],
  declarations: Declarations,
  modelingTolerance: number,
): Promise<{
  pairs: PairOutcome[];
  selves: { branch: number; result: NeutralCurveQueryResult }[];
}> {
  const pairs: PairOutcome[] = [];
  for (let first = 0; first < branches.length; first += 1) {
    for (let second = first + 1; second < branches.length; second += 1) {
      const a = branches[first]!;
      const b = branches[second]!;
      if (declarations.failedPairs.has(pairKey(first, second))) continue;
      const declared = declarations.pairJoins.get(pairKey(first, second));
      if (declared) {
        const result = await queries.join({
          modelingTolerance,
          first: a.curve,
          second: b.curve,
          joins: declared.map((join) => ({
            first: join.first,
            second: join.second,
          })),
        });
        pairs.push(
          result.kind === "verified"
            ? {
                kind: "verified",
                first,
                second,
                joins: result.joins.map((witness, index) => ({
                  witness,
                  classRoot: declared[index]!.classRoot,
                })),
                points: result.points,
                overlaps: result.overlaps,
              }
            : {
                kind: "failed",
                first,
                second,
                join: true,
                result: result.kind,
                code: result.code,
                message: result.message,
              },
        );
        continue;
      }
      // U8: disjoint outward boxes prove an empty contact set.
      if (!boxesOverlap(a.box, b.box)) continue;
      const result = await queries.pair({
        modelingTolerance,
        first: a.curve,
        second: b.curve,
      });
      pairs.push(
        result.kind === "verified"
          ? {
              kind: "verified",
              first,
              second,
              joins: [],
              points: result.points,
              overlaps: result.overlaps,
            }
          : {
              kind: "failed",
              first,
              second,
              join: false,
              result: result.kind,
              code: result.code,
              message: result.message,
            },
      );
    }
  }
  const selves: { branch: number; result: NeutralCurveQueryResult }[] = [];
  for (const branch of branches) {
    if (branch.curve.kind !== "cubicBezier") continue;
    selves.push({
      branch: branch.index,
      result: await queries.self({ modelingTolerance, curve: branch.curve }),
    });
  }
  return { pairs, selves };
}

// ---------------------------------------------------------------------------
// §3.4–3.5 Vertices, occurrences and verified-contact components
// ---------------------------------------------------------------------------

interface VertexInfo {
  id: string;
  /** Join class root for a declared-join vertex, otherwise null. */
  classRoot: string | null;
  key: string;
  position: SplineVector;
  ballRadius: number;
  /** Outward box holding every reported join ball of the class (join vertices only). */
  ballBox: Box | null;
  /** Every reported join ball of the class (join vertices only). */
  balls: readonly { center: SplineVector; radius: number }[];
  witness: RegionIntersectionWitness | null;
  /**
   * The curvature tie-break is allowed here: a join whose member points are
   * bitwise equal (T09a: inside the ball the near pieces meet only at the
   * join; `sortLeaving` also bounds the flip point inside the ball), an exact
   * overlap end, or a contact proven tangent. At a gapped join the lateral
   * offset, not curvature, orders tangent members near the join.
   */
  tieBreak: boolean;
}

/** One place a vertex sits on one branch, with its outward parameter enclosure. */
interface Occurrence {
  key: string;
  branch: number;
  enclosure: Interval;
  representative: number;
  vertex: string;
}

interface OverlapRecord {
  first: number;
  second: number;
  orientation: "same" | "opposite";
  /** Occurrence keys of the lo and hi ends (ordered along the first branch). */
  ends: readonly [
    { first: string; second: string },
    { first: string; second: string },
  ];
}

interface ArrangementEvents {
  vertices: Map<string, VertexInfo>;
  occurrences: Map<string, Occurrence>;
  overlaps: OverlapRecord[];
  /** Pairs whose events have no certified seam-free identity rank. */
  unranked: { branches: number[]; reason: string }[];
}

/**
 * Singleton witness bounds are rounded representatives, not root enclosures
 * (for example `exactFiniteLineIntersection`): widen them by one ulp. Every
 * contact lies in the certified domain, so an open branch clips to it.
 */
function widenOnBranch(branch: Branch, bounds: Interval): Interval {
  const widened: Interval =
    bounds[0] === bounds[1] ? [nextDown(bounds[0]), nextUp(bounds[1])] : bounds;
  if (branch.closed) return widened;
  return [
    Math.max(branch.domain[0], widened[0]),
    Math.min(branch.domain[1], widened[1]),
  ];
}

function collectEvents(
  branches: readonly Branch[],
  declarations: Declarations,
  pairs: readonly PairOutcome[],
  selves: readonly { branch: number; result: NeutralCurveQueryResult }[],
): ArrangementEvents {
  const vertices = new Map<string, VertexInfo>();
  const occurrences = new Map<string, Occurrence>();
  const overlaps: OverlapRecord[] = [];
  const unranked: ArrangementEvents["unranked"] = [];
  const occur = (
    key: string,
    branch: number,
    enclosure: Interval,
    representative: number,
    vertex: string,
  ) => {
    const existing = occurrences.get(key);
    if (existing) {
      occurrences.set(key, {
        ...existing,
        enclosure: ivHull(existing.enclosure, enclosure),
      });
      return;
    }
    occurrences.set(key, { key, branch, enclosure, representative, vertex });
  };
  const classVertex = (
    root: string,
    position: SplineVector,
    ballRadius: number,
  ) => {
    const id = `c:${root}`;
    const ball = outwardBox(position, ballRadius);
    const existing = vertices.get(id);
    if (existing) {
      vertices.set(id, {
        ...existing,
        ballRadius: Math.max(existing.ballRadius, ballRadius),
        ballBox: boxHull(existing.ballBox!, ball),
        balls: [...existing.balls, { center: position, radius: ballRadius }],
      });
      return id;
    }
    vertices.set(id, {
      id,
      classRoot: root,
      key: declaredJoinVertexKey(declarations.classMembers.get(root) ?? [root]),
      position,
      ballRadius,
      ballBox: ball,
      balls: [{ center: position, radius: ballRadius }],
      witness: null,
      tieBreak: declarations.exactPointClasses.has(root),
    });
    return id;
  };
  const toPoint = (position: SplineVector): SplineVector => [
    position[0],
    position[1],
  ];

  for (const pair of pairs) {
    if (pair.kind !== "verified") continue;
    const a = branches[pair.first]!;
    const b = branches[pair.second]!;
    const joinOccurrence: {
      first: string;
      second: string;
      witness: JoinVerified["joins"][number];
    }[] = [];
    for (const { witness, classRoot } of pair.joins) {
      const vertex = classVertex(
        classRoot,
        toPoint(witness.position),
        witness.ballRadius,
      );
      const firstKey = `${vertex}@${a.index}`;
      const secondKey = `${vertex}@${b.index}`;
      occur(
        firstKey,
        a.index,
        witness.firstParameterBounds,
        witness.firstParameter,
        vertex,
      );
      occur(
        secondKey,
        b.index,
        witness.secondParameterBounds,
        witness.secondParameter,
        vertex,
      );
      joinOccurrence.push({ first: firstKey, second: secondKey, witness });
    }

    const count = pair.points.length;
    const rankAlong = (select: (point: NeutralCurvePointWitness) => number) => {
      const order = pair.points
        .map((_, index) => index)
        .sort((l, r) => select(pair.points[l]!) - select(pair.points[r]!));
      const rank = new Array<number>(count);
      order.forEach((index, position) => (rank[index] = position));
      return rank;
    };
    let firstRank = rankAlong((point) => point.firstParameter);
    let secondRank = rankAlong((point) => point.secondParameter);
    // A full circle's parameter starts at its fixed seam, which is not
    // topological. Its ranks are cyclic offsets from the event that is first
    // along the open partner; two circles (at most two events) rank by the
    // certified crossing orientation instead.
    const cyclicFrom = (ranks: number[], anchor: number) =>
      ranks.map((rank) => (rank - ranks[anchor]! + count) % count);
    if (a.closed && b.closed) {
      const oriented = orientationRanks(a, b, pair.points);
      if (oriented === null) {
        unranked.push({
          branches: [a.index, b.index],
          reason: `the contacts of ${a.description} and ${b.description} have no certified crossing orientation`,
        });
        firstRank = firstRank.map(() => -1);
        secondRank = firstRank;
      } else {
        firstRank = oriented;
        secondRank = oriented;
      }
    } else if (a.closed) {
      firstRank = cyclicFrom(firstRank, secondRank.indexOf(0));
    } else if (b.closed) {
      secondRank = cyclicFrom(secondRank, firstRank.indexOf(0));
    }
    pair.points.forEach((point, index) => {
      const id = `x:${a.index}:${b.index}:${index}`;
      const firstBounds = widenOnBranch(a, point.proof.firstParameterBounds);
      const secondBounds = widenOnBranch(b, point.proof.secondParameterBounds);
      vertices.set(id, {
        id,
        classRoot: null,
        key: intersectionVertexKey(
          a.key,
          b.key,
          count,
          firstRank[index]!,
          secondRank[index]!,
        ),
        position: toPoint(point.position),
        ballRadius: 0,
        ballBox: null,
        balls: [],
        witness: {
          first: {
            branch: a.record,
            parameter: point.firstParameter,
            parameterBounds: firstBounds,
          },
          second: {
            branch: b.record,
            parameter: point.secondParameter,
            parameterBounds: secondBounds,
          },
          classification: point.classification,
          proof: point.proof.kind,
        },
        tieBreak: neutralCurveWitnessProvesTangency(point),
      });
      occur(`${id}@${a.index}`, a.index, firstBounds, point.firstParameter, id);
      occur(
        `${id}@${b.index}`,
        b.index,
        secondBounds,
        point.secondParameter,
        id,
      );
    });

    const sorted = [...pair.overlaps].sort(
      (l, r) => l.firstInterval[0] - r.firstInterval[0],
    );
    // Identity measures overlap ends along the lower-key branch (review 7), so
    // keys do not depend on branch (entity) order.
    const along = (overlap: (typeof sorted)[number]) =>
      a.key < b.key ? overlap.firstInterval : overlap.secondInterval;
    const canonical = [...sorted].sort(
      (l, r) => Math.min(...along(l)) - Math.min(...along(r)),
    );
    sorted.forEach((overlap, overlapIndex) => {
      const ends = ([0, 1] as const).map((end) => {
        const firstParameter = overlap.firstInterval[end];
        const secondParameter = overlap.secondInterval[end];
        // A declared join on this overlap sits at a branch end exactly where the
        // overlap reaches that end: the overlap end is that join (T09a admits
        // the overlap only when every join lies on it).
        const joined = joinOccurrence.find(
          ({ witness }) =>
            witness.realization === "declaredEnds" &&
            ((firstParameter === witness.firstParameter &&
              (firstParameter === a.domain[0] ||
                firstParameter === a.domain[1])) ||
              (secondParameter === witness.secondParameter &&
                (secondParameter === b.domain[0] ||
                  secondParameter === b.domain[1]))),
        );
        if (joined) {
          const vertex = occurrences.get(joined.first)!.vertex;
          if (firstParameter !== joined.witness.firstParameter)
            occur(
              joined.first,
              a.index,
              widenOnBranch(a, exact(firstParameter)),
              firstParameter,
              vertex,
            );
          if (secondParameter !== joined.witness.secondParameter)
            occur(
              joined.second,
              b.index,
              widenOnBranch(b, exact(secondParameter)),
              secondParameter,
              vertex,
            );
          return { first: joined.first, second: joined.second };
        }
        const id = `o:${a.index}:${b.index}:${overlapIndex}:${end}`;
        const firstBounds = widenOnBranch(a, exact(firstParameter));
        const secondBounds = widenOnBranch(b, exact(secondParameter));
        const interval = along(overlap);
        vertices.set(id, {
          id,
          classRoot: null,
          key: overlapEndVertexKey(
            a.key,
            b.key,
            sorted.length,
            canonical.indexOf(overlap),
            interval[end] === Math.min(...interval) ? "lo" : "hi",
          ),
          position: evaluateNeutralCurve(a.curve, firstParameter),
          ballRadius: 0,
          ballBox: null,
          balls: [],
          witness: {
            first: {
              branch: a.record,
              parameter: firstParameter,
              parameterBounds: firstBounds,
            },
            second: {
              branch: b.record,
              parameter: secondParameter,
              parameterBounds: secondBounds,
            },
            classification: "unclassified",
            proof: "overlapEndpoint",
          },
          // Exact same support: the overlapping curves share the tangent line.
          tieBreak: true,
        });
        occur(`${id}@${a.index}`, a.index, firstBounds, firstParameter, id);
        occur(`${id}@${b.index}`, b.index, secondBounds, secondParameter, id);
        return { first: `${id}@${a.index}`, second: `${id}@${b.index}` };
      });
      overlaps.push({
        first: a.index,
        second: b.index,
        orientation: overlap.orientation,
        ends: [ends[0]!, ends[1]!],
      });
    });
  }

  for (const { branch: index, result } of selves) {
    if (result.kind !== "verified") continue;
    const branch = branches[index]!;
    result.points.forEach((point, pointIndex) => {
      const id = `s:${index}:${pointIndex}`;
      const firstBounds = widenOnBranch(
        branch,
        point.proof.firstParameterBounds,
      );
      const secondBounds = widenOnBranch(
        branch,
        point.proof.secondParameterBounds,
      );
      vertices.set(id, {
        id,
        classRoot: null,
        key: selfIntersectionVertexKey(branch.key, pointIndex),
        position: toPoint(point.position),
        ballRadius: 0,
        ballBox: null,
        balls: [],
        witness: {
          first: {
            branch: branch.record,
            parameter: point.firstParameter,
            parameterBounds: firstBounds,
          },
          second: {
            branch: branch.record,
            parameter: point.secondParameter,
            parameterBounds: secondBounds,
          },
          classification: point.classification,
          proof: point.proof.kind,
        },
        tieBreak: neutralCurveWitnessProvesTangency(point),
      });
      occur(`${id}@a`, index, firstBounds, point.firstParameter, id);
      occur(`${id}@b`, index, secondBounds, point.secondParameter, id);
    });
  }
  return { vertices, occurrences, overlaps, unranked };
}

/**
 * Seam-free ranks of the (at most two) contacts of two full circles: rank 0 is
 * the contact where cross(L′, H′) is certified positive, with L the lower-key
 * circle, and rank 1 the one where it is certified negative. Null when the
 * signs are not certified or do not tell the contacts apart.
 */
function orientationRanks(
  a: Branch,
  b: Branch,
  points: readonly NeutralCurvePointWitness[],
): number[] | null {
  // No contacts (e.g. concentric circles) means no events to rank.
  if (points.length === 0) return [];
  if (points.length === 1) return [0];
  if (points.length !== 2) return null;
  const signs = points.map((point) => {
    const first = curveDerivatives(
      a.curve,
      widenOnBranch(a, point.proof.firstParameterBounds),
    ).first;
    const second = curveDerivatives(
      b.curve,
      widenOnBranch(b, point.proof.secondParameterBounds),
    ).first;
    const cross =
      a.key < b.key ? ivCross(first, second) : ivCross(second, first);
    return cross[0] > 0 ? 1 : cross[1] < 0 ? -1 : 0;
  });
  if (signs[0] === 1 && signs[1] === -1) return [0, 1];
  if (signs[0] === -1 && signs[1] === 1) return [1, 0];
  return null;
}

// ---------------------------------------------------------------------------
// §3.4–3.7 One component: split, merge overlaps, prune, order, walk, area
// ---------------------------------------------------------------------------

interface SubEdge {
  id: number;
  branch: number;
  ordinal: number;
  /** Representative parameters, increasing (a circle's wrap edge ends past 2π). */
  interval: Interval;
  from: Occurrence | null;
  to: Occurrence | null;
  fromEnclosure: Interval;
  toEnclosure: Interval;
}

interface EdgeGroup {
  id: number;
  /** `same`: the member runs in the canonical member's direction. */
  members: { edge: SubEdge; same: boolean }[];
  start: string | null;
  end: string | null;
  primary: number;
}

interface Face {
  outer: number[];
  holes: number[][];
  area: Interval;
  box: Box;
}

interface BuiltComponent {
  root: number;
  branches: number[];
  groups: EdgeGroup[];
  alive: boolean[];
  /** Pruned arrangement degree per vertex id. */
  degree: Map<string, number>;
  ordered: Map<number, Occurrence[]>;
  faces: Face[];
  outerCycles: number[][];
  openBranches: number[];
  box: Box;
}

type ComponentOutcome =
  | { kind: "built"; component: BuiltComponent }
  | {
      kind: "blocked";
      code:
        | "region-vertex-order-uncertain"
        | "region-nesting-uncertain"
        | "region-degenerate-curve";
      reason: string;
      branches: number[];
    };

const ivSquare = (a: Interval): Interval =>
  ivContainsZero(a)
    ? [0, nextUp(Math.max(a[0] * a[0], a[1] * a[1]))]
    : iv(
        Math.min(a[0] * a[0], a[1] * a[1]),
        Math.max(a[0] * a[0], a[1] * a[1]),
      );
const ivSqrt = (a: Interval): Interval => [
  Math.max(0, nextDown(Math.sqrt(Math.max(0, a[0])))),
  nextUp(Math.sqrt(a[1])),
];
const shiftInterval = (a: Interval, turns: number): Interval =>
  turns === 0 ? a : ivAdd(a, iv(turns * TAU, turns * TAU));

/** Certified polar-angle interval of a direction box, or null when it may vanish. */
function angleInterval(direction: IntervalPoint): Interval | null {
  if (ivContainsZero(direction[0]) && ivContainsZero(direction[1])) return null;
  const center = Math.atan2(ivMid(direction[1]), ivMid(direction[0]));
  const angles = [
    [direction[0][0], direction[1][0]],
    [direction[0][0], direction[1][1]],
    [direction[0][1], direction[1][0]],
    [direction[0][1], direction[1][1]],
  ].map(([x, y]) => {
    let angle = Math.atan2(y!, x!);
    while (angle < center - Math.PI) angle += TAU;
    while (angle > center + Math.PI) angle -= TAU;
    return angle;
  });
  // atan2 is accurate to a few ulps of π.
  const slack = 32 * Number.EPSILON;
  return [
    nextDown(Math.min(...angles) - slack),
    nextUp(Math.max(...angles) + slack),
  ];
}

interface Leaving {
  half: number;
  angle: Interval;
  curvature: Interval;
}

function leavingDirection(
  curve: OwnedCurve,
  enclosure: Interval,
  forward: boolean,
): Omit<Leaving, "half"> | null {
  const { first, second } = curveDerivatives(curve, enclosure);
  const direction: IntervalPoint = forward
    ? first
    : [ivNeg(first[0]), ivNeg(first[1])];
  const angle = angleInterval(direction);
  if (!angle) return null;
  const squared = ivAdd(ivSquare(first[0]), ivSquare(first[1]));
  if (!(squared[0] > 0)) return null;
  const curvature = ivDiv(
    ivCross(first, second),
    ivMul(squared, ivSqrt(squared)),
  );
  if (!curvature) return null;
  return { angle, curvature: forward ? curvature : ivNeg(curvature) };
}

/**
 * Counter-clockwise order of the half-edges leaving one vertex. Overlapping
 * direction intervals are a tangent contact; they are ordered by certified
 * signed curvature (a path turning left lies counter-clockwise of one turning
 * less), otherwise the order is uncertain.
 *
 * `flipRadius` (joins only): two tied paths from one point whose tangents
 * differ by δ, not resolved by the angle intervals, can swap sides again at
 * s ≈ 2δ/Δκ. Each tied pair must bound that flip point below the smallest
 * join ball radius, where T09a excludes a second contact of the near pieces
 * (re-review 2 advisory 5).
 */
function sortLeaving(
  items: Leaving[],
  allowCurvatureTieBreak: boolean,
  flipRadius: number | null,
): Leaving[] | null {
  // Two half-edges have one cyclic order: no direction or tie-break decides it.
  if (items.length <= 2) return items;
  const normalized = items
    .map((item) => ({
      ...item,
      angle: shiftInterval(item.angle, -Math.floor(item.angle[0] / TAU)),
    }))
    .sort((left, right) => ivMid(left.angle) - ivMid(right.angle));
  const count = normalized.length;
  const angleAt = (index: number) =>
    index < count
      ? normalized[index]!.angle
      : shiftInterval(normalized[index - count]!.angle, 1);
  let gap = -1;
  for (let index = 0; index < count; index += 1) {
    if (!ivOverlap(angleAt(index), angleAt(index + 1))) {
      gap = index;
      break;
    }
  }
  if (gap < 0) return null;
  const rotated = [...Array(count).keys()].map((offset) => {
    const index = gap + 1 + offset;
    return {
      item: index < count ? normalized[index]! : normalized[index - count]!,
      angle: angleAt(index),
    };
  });
  const result: Leaving[] = [];
  let cluster = [rotated[0]!];
  const flush = () => {
    if (cluster.length > 1 && !allowCurvatureTieBreak) return false;
    for (let a = 0; a < cluster.length; a += 1) {
      for (let b = a + 1; b < cluster.length; b += 1) {
        if (!ivOverlap(cluster[a]!.angle, cluster[b]!.angle)) return false;
        const left = cluster[a]!.item.curvature;
        const right = cluster[b]!.item.curvature;
        if (ivOverlap(left, right)) return false;
        if (flipRadius === null) continue;
        const angles = ivHull(cluster[a]!.angle, cluster[b]!.angle);
        const width = nextUp(angles[1] - angles[0]);
        const gap = nextDown(
          left[0] > right[1] ? left[0] - right[1] : right[0] - left[1],
        );
        if (!(gap > 0 && nextUp((2 * width) / gap) < flipRadius)) return false;
      }
    }
    result.push(
      ...[...cluster]
        .sort((l, r) => l.item.curvature[0] - r.item.curvature[0])
        .map((entry) => entry.item),
    );
    return true;
  };
  for (let index = 1; index < count; index += 1) {
    if (ivOverlap(rotated[index - 1]!.angle, rotated[index]!.angle)) {
      cluster.push(rotated[index]!);
      continue;
    }
    if (!flush()) return null;
    cluster = [rotated[index]!];
  }
  return flush() ? result : null;
}

/** Removes bridge traversals, then splits at repeated vertices into simple cycles. */
function splitWalk(
  walk: readonly number[],
  startOf: (half: number) => string | null,
): number[][] {
  if (walk.length === 0) return [];
  const position = new Map(walk.map((half, index) => [half, index]));
  for (let index = 0; index < walk.length; index += 1) {
    const twin = position.get(walk[index]! ^ 1);
    if (twin === undefined) continue;
    const rotated = [...walk.slice(index), ...walk.slice(0, index)];
    const twinAt = (twin - index + walk.length) % walk.length;
    return [
      ...splitWalk(rotated.slice(1, twinAt), startOf),
      ...splitWalk(rotated.slice(twinAt + 1), startOf),
    ];
  }
  const seen = new Map<string, number>();
  for (let index = 0; index < walk.length; index += 1) {
    const vertex = startOf(walk[index]!);
    if (vertex === null) break;
    const earlier = seen.get(vertex);
    if (earlier !== undefined) {
      return [
        ...splitWalk(walk.slice(earlier, index), startOf),
        ...splitWalk(
          [...walk.slice(0, earlier), ...walk.slice(index)],
          startOf,
        ),
      ];
    }
    seen.set(vertex, index);
  }
  return [[...walk]];
}

function buildComponent(
  root: number,
  componentBranches: number[],
  branches: readonly Branch[],
  events: ArrangementEvents,
  classOf: (member: string) => string,
): ComponentOutcome {
  const members = new Set(componentBranches);
  const byBranch = new Map<number, Occurrence[]>();
  for (const index of componentBranches) byBranch.set(index, []);
  for (const occurrence of events.occurrences.values()) {
    if (members.has(occurrence.branch))
      byBranch.get(occurrence.branch)!.push(occurrence);
  }

  // §3.4 order vertices along every branch by their parameter enclosures.
  const ordered = new Map<number, Occurrence[]>();
  for (const [index, list] of byBranch) {
    const branch = branches[index]!;
    const sorted = [...list].sort(
      (l, r) => l.representative - r.representative,
    );
    for (let k = 0; k + 1 < sorted.length; k += 1) {
      if (!(sorted[k]!.enclosure[1] < sorted[k + 1]!.enclosure[0]))
        return {
          kind: "blocked",
          code: "region-vertex-order-uncertain",
          reason: `two contacts on ${branch.description} cannot be ordered (an undeclared concurrent crossing or an ulp-close pair)`,
          branches: componentBranches,
        };
    }
    if (branch.closed && sorted.length >= 2) {
      const first = shiftInterval(sorted[0]!.enclosure, 1);
      if (!(sorted.at(-1)!.enclosure[1] < first[0]))
        return {
          kind: "blocked",
          code: "region-vertex-order-uncertain",
          reason: `two contacts on ${branch.description} cannot be ordered across the seam`,
          branches: componentBranches,
        };
    }
    ordered.set(index, sorted);
  }

  // Sub-edges between consecutive vertices. Open tails end at a free branch end
  // (degree 1) and are dangling by construction, so they are not built.
  const edges: SubEdge[] = [];
  const edgeAt = new Map<string, SubEdge>();
  for (const [index, list] of ordered) {
    const branch = branches[index]!;
    const push = (edge: Omit<SubEdge, "id">) => {
      const built = { ...edge, id: edges.length };
      edges.push(built);
      edgeAt.set(`${index}:${edge.ordinal}`, built);
    };
    if (branch.closed && list.length === 0) {
      push({
        branch: index,
        ordinal: 0,
        interval: [0, TAU],
        from: null,
        to: null,
        fromEnclosure: exact(0),
        toEnclosure: iv(TAU, TAU),
      });
      continue;
    }
    const spans = branch.closed ? list.length : list.length - 1;
    for (let k = 0; k < spans; k += 1) {
      const from = list[k]!;
      const wrap = k + 1 === list.length;
      const to = list[wrap ? 0 : k + 1]!;
      push({
        branch: index,
        ordinal: k,
        interval: [
          from.representative,
          wrap ? to.representative + TAU : to.representative,
        ],
        from,
        to,
        fromEnclosure: from.enclosure,
        toEnclosure: wrap ? shiftInterval(to.enclosure, 1) : to.enclosure,
      });
    }
  }

  // §3.5 merge exactly overlapping sub-edges into one edge.
  const links = new Map<number, { other: number; opposite: boolean }[]>();
  const link = (a: SubEdge, b: SubEdge, opposite: boolean) => {
    links.set(a.id, [...(links.get(a.id) ?? []), { other: b.id, opposite }]);
    links.set(b.id, [...(links.get(b.id) ?? []), { other: a.id, opposite }]);
  };
  for (const overlap of events.overlaps) {
    if (!members.has(overlap.first)) continue;
    const firstList = ordered.get(overlap.first)!;
    const secondList = ordered.get(overlap.second)!;
    const indexOf = (list: Occurrence[], key: string) =>
      list.findIndex((occurrence) => occurrence.key === key);
    const aLo = indexOf(firstList, overlap.ends[0].first);
    const aHi = indexOf(firstList, overlap.ends[1].first);
    const bLo = indexOf(secondList, overlap.ends[0].second);
    const bHi = indexOf(secondList, overlap.ends[1].second);
    const step = overlap.orientation === "same" ? 1 : -1;
    const consistent =
      aLo >= 0 &&
      bLo >= 0 &&
      aHi > aLo &&
      (bHi - bLo) * step === aHi - aLo &&
      [...Array(aHi - aLo + 1).keys()].every(
        (k) =>
          firstList[aLo + k]!.vertex === secondList[bLo + step * k]!.vertex,
      );
    if (!consistent)
      return {
        kind: "blocked",
        code: "region-vertex-order-uncertain",
        reason: `a contact inside the exact overlap of ${branches[overlap.first]!.description} and ${branches[overlap.second]!.description} is not shared by both branches`,
        branches: componentBranches,
      };
    for (let k = 0; k < aHi - aLo; k += 1) {
      const a = edgeAt.get(`${overlap.first}:${aLo + k}`)!;
      const b = edgeAt.get(
        `${overlap.second}:${step === 1 ? bLo + k : bLo - k - 1}`,
      )!;
      link(a, b, step === -1);
    }
  }
  const groups: EdgeGroup[] = [];
  const grouped = new Set<number>();
  const edgeOrder = (edge: SubEdge) =>
    `${branches[edge.branch]!.key}\u0000${String(edge.ordinal).padStart(12, "0")}`;
  for (const seed of [...edges].sort((l, r) =>
    edgeOrder(l) < edgeOrder(r) ? -1 : 1,
  )) {
    if (grouped.has(seed.id)) continue;
    const groupMembers: EdgeGroup["members"] = [];
    const queue: { id: number; same: boolean }[] = [
      { id: seed.id, same: true },
    ];
    grouped.add(seed.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      groupMembers.push({ edge: edges[current.id]!, same: current.same });
      for (const next of links.get(current.id) ?? []) {
        if (grouped.has(next.other)) continue;
        grouped.add(next.other);
        queue.push({ id: next.other, same: current.same !== next.opposite });
      }
    }
    groups.push({
      id: groups.length,
      members: groupMembers,
      start: seed.from?.vertex ?? null,
      end: seed.to?.vertex ?? null,
      primary: 0,
    });
  }

  // §3.6.1 prune dangling edges iteratively.
  const alive = groups.map(() => true);
  const degree = new Map<string, number>();
  const bump = (vertex: string | null, delta: number) => {
    if (vertex !== null) degree.set(vertex, (degree.get(vertex) ?? 0) + delta);
  };
  for (const group of groups) {
    bump(group.start, 1);
    bump(group.end, 1);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const group of groups) {
      if (!alive[group.id] || group.start === null) continue;
      if (degree.get(group.start) === 1 || degree.get(group.end!) === 1) {
        alive[group.id] = false;
        bump(group.start, -1);
        bump(group.end, -1);
        changed = true;
      }
    }
  }
  const retained = new Set(
    groups
      .filter((group) => alive[group.id])
      .flatMap((group) => group.members.map((member) => member.edge.branch)),
  );
  const openBranches = componentBranches.filter(
    (index) => !retained.has(index),
  );
  const box = componentBranches
    .map((index) => branches[index]!.box)
    .reduce(boxHull);

  const halfStart = (half: number) =>
    half % 2 === 0 ? groups[half >> 1]!.start : groups[half >> 1]!.end;
  const halfEnd = (half: number) =>
    half % 2 === 0 ? groups[half >> 1]!.end : groups[half >> 1]!.start;
  const live = groups.filter((group) => alive[group.id]);

  // §3.6.2–3 certified counter-clockwise order at every vertex.
  const leavingAt = new Map<string, Leaving[]>();
  for (const group of live) {
    if (group.start === null) continue;
    const canonical = group.members[0]!.edge;
    const curve = branches[canonical.branch]!.curve;
    for (const forward of [true, false]) {
      const leaving = leavingDirection(
        curve,
        forward ? canonical.fromEnclosure : canonical.toEnclosure,
        forward,
      );
      if (!leaving)
        return {
          kind: "blocked",
          code: "region-vertex-order-uncertain",
          reason: `${branches[canonical.branch]!.description} has a possibly vanishing tangent at a vertex`,
          branches: componentBranches,
        };
      const vertex = forward ? group.start : group.end!;
      leavingAt.set(vertex, [
        ...(leavingAt.get(vertex) ?? []),
        { half: group.id * 2 + (forward ? 0 : 1), ...leaving },
      ]);
    }
  }
  const order = new Map<string, number[]>();
  for (const [vertex, items] of leavingAt) {
    // Curvature orders tangent curves only when their tangents are proven
    // equal; otherwise a tangent difference below the interval width decides
    // the order and curvature may contradict it (re-review 2). The tie-break
    // is allowed only where `VertexInfo.tieBreak` holds: joins at a bitwise
    // shared point (with the flip-radius bound), contacts whose witness
    // proves tangency, and exact overlap ends.
    const info = events.vertices.get(vertex)!;
    const sorted = sortLeaving(
      items,
      info.tieBreak,
      info.classRoot === null
        ? null
        : Math.min(...info.balls.map((ball) => ball.radius)),
    );
    if (!sorted)
      return {
        kind: "blocked",
        code: "region-vertex-order-uncertain",
        reason: `the curves meeting at vertex ${info.key} cannot be ordered by certified direction and curvature`,
        // A join names its members; the whole component is blocked either way.
        branches:
          info.classRoot === null
            ? componentBranches
            : [
                ...new Set(
                  items.flatMap((item) =>
                    groups[item.half >> 1]!.members.map(
                      (member) => member.edge.branch,
                    ),
                  ),
                ),
              ],
      };
    order.set(
      vertex,
      sorted.map((item) => item.half),
    );
  }

  // §3.6.4 face walk: the next edge is the one before the reversed edge in counter-clockwise order.
  const next = (half: number) => {
    const list = order.get(halfEnd(half)!)!;
    const index = list.indexOf(half ^ 1);
    return list[(index - 1 + list.length) % list.length]!;
  };
  const walks: number[][] = [];
  const visited = new Set<number>();
  for (const group of live) {
    for (const half of [group.id * 2, group.id * 2 + 1]) {
      if (visited.has(half)) continue;
      if (group.start === null) {
        visited.add(half);
        walks.push([half]);
        continue;
      }
      const walk: number[] = [];
      for (let cursor = half; !visited.has(cursor); cursor = next(cursor)) {
        visited.add(cursor);
        walk.push(cursor);
      }
      walks.push(walk);
    }
  }

  // §3.7 analytic signed areas with rigorous bounds.
  const piece = (half: number) => {
    const canonical = groups[half >> 1]!.members[0]!.edge;
    const forward = half % 2 === 0;
    return {
      curve: branches[canonical.branch]!.curve,
      from: forward ? canonical.fromEnclosure : canonical.toEnclosure,
      to: forward ? canonical.toEnclosure : canonical.fromEnclosure,
    };
  };
  const cycleArea = (cycle: readonly number[]): Interval => {
    const first = piece(cycle[0]!);
    const originPoint = curvePoint(first.curve, first.from);
    const origin: SplineVector = [ivMid(originPoint[0]), ivMid(originPoint[1])];
    const o = ivPoint(origin);
    let total: Interval = exact(0);
    cycle.forEach((half, index) => {
      const current = piece(half);
      const following = piece(cycle[(index + 1) % cycle.length]!);
      total = ivAdd(
        total,
        certifyNeutralCurvePieceSignedArea(
          current.curve,
          current.from,
          current.to,
          origin,
        ),
      );
      // Connector through the join realization (zero width at an exact contact).
      const end = ivPointSub(curvePoint(current.curve, current.to), o);
      const start = ivPointSub(curvePoint(following.curve, following.from), o);
      total = ivAdd(total, ivMul(exact(0.5), ivCross(end, start)));
    });
    return total;
  };
  const cycleBox = (cycle: readonly number[]) =>
    cycle
      .map((half) => branches[groups[half >> 1]!.members[0]!.edge.branch]!.box)
      .reduce(boxHull);
  const zeroArea = (cycle: readonly number[]): ComponentOutcome => ({
    kind: "blocked",
    code: "region-degenerate-curve",
    reason: "a zero-area cell (its certified area interval contains zero)",
    branches: [
      ...new Set(
        cycle.map((half) => groups[half >> 1]!.members[0]!.edge.branch),
      ),
    ],
  });

  const faces: Face[] = [];
  let outerCycles: number[][] | null = null;
  for (const walk of walks) {
    const area = cycleArea(walk);
    if (ivContainsZero(area)) return zeroArea(walk);
    const cycles = splitWalk(walk, halfStart);
    const areas = cycles.map(cycleArea);
    const zero = areas.findIndex(ivContainsZero);
    if (zero >= 0) return zeroArea(cycles[zero]!);
    if (area[1] < 0) {
      if (outerCycles !== null || areas.some((value) => value[0] > 0))
        return {
          kind: "blocked",
          code: "region-nesting-uncertain",
          reason:
            "the component does not have exactly one certified unbounded face",
          branches: componentBranches,
        };
      outerCycles = cycles;
      continue;
    }
    const positive = areas.flatMap((value, index) =>
      value[0] > 0 ? [index] : [],
    );
    if (positive.length !== 1)
      return {
        kind: "blocked",
        code: "region-nesting-uncertain",
        reason:
          "a bounded face does not have exactly one certified outer cycle",
        branches: componentBranches,
      };
    const outer = cycles[positive[0]!]!;
    faces.push({
      outer,
      holes: cycles.filter((_, index) => index !== positive[0]),
      area: areas[positive[0]!]!,
      box: cycleBox(outer),
    });
  }
  if (live.length > 0 && outerCycles === null)
    return {
      kind: "blocked",
      code: "region-nesting-uncertain",
      reason: "the component does not have a certified unbounded face",
      branches: componentBranches,
    };

  choosePrimaries(groups, alive, degree, branches, events, classOf);
  return {
    kind: "built",
    component: {
      root,
      branches: componentBranches,
      groups,
      alive,
      degree,
      ordered,
      faces,
      outerCycles: outerCycles ?? [],
      openBranches,
      box,
    },
  };
}

/**
 * U6 identity: a merged overlap edge reports one primary branch. Chains are
 * runs of edges through degree-2 vertices that some branch continues through;
 * a chain takes a branch present on all its edges, preferring the branch whose
 * own declared ports are the chain's end vertices (the boundary side, not the
 * duplicate lying on it), then the smallest branch key.
 */
function choosePrimaries(
  groups: EdgeGroup[],
  alive: readonly boolean[],
  degree: ReadonlyMap<string, number>,
  branches: readonly Branch[],
  events: ArrangementEvents,
  classOf: (member: string) => string,
) {
  const live = groups.filter(
    (group) => alive[group.id] && group.start !== null,
  );
  const incident = new Map<string, { group: EdgeGroup; atStart: boolean }[]>();
  for (const group of live) {
    incident.set(group.start!, [
      ...(incident.get(group.start!) ?? []),
      { group, atStart: true },
    ]);
    incident.set(group.end!, [
      ...(incident.get(group.end!) ?? []),
      { group, atStart: false },
    ]);
  }
  const continuesThrough = (vertex: string) => {
    const list = incident.get(vertex) ?? [];
    if (degree.get(vertex) !== 2 || list.length !== 2) return false;
    const [p, q] = list as [(typeof list)[number], (typeof list)[number]];
    return p.group.members.some((mp) =>
      q.group.members.some((mq) => {
        if (mp.edge.branch !== mq.edge.branch) return false;
        const at = (entry: typeof p, member: typeof mp) =>
          entry.atStart === member.same ? member.edge.from : member.edge.to;
        const occurrence = at(p, mp);
        if (!occurrence || at(q, mq)?.key !== occurrence.key) return false;
        return (
          (mp.edge.to?.key === occurrence.key &&
            mq.edge.from?.key === occurrence.key) ||
          (mp.edge.from?.key === occurrence.key &&
            mq.edge.to?.key === occurrence.key)
        );
      }),
    );
  };
  const noise = new Set([...incident.keys()].filter(continuesThrough));
  const portAt = (branch: Branch, vertex: string) => {
    const root = events.vertices.get(vertex)?.classRoot;
    if (!root) return false;
    return [branch.ports.start, branch.ports.end].some(
      (port) => port !== null && classOf(port) === root,
    );
  };
  const pick = (candidates: number[], score: (branch: number) => number) =>
    [...candidates].sort(
      (l, r) =>
        score(r) - score(l) || (branches[l]!.key < branches[r]!.key ? -1 : 1),
    )[0]!;

  const assigned = new Set<number>();
  for (const seed of live) {
    if (assigned.has(seed.id)) continue;
    const chain: EdgeGroup[] = [];
    const queue = [seed];
    assigned.add(seed.id);
    while (queue.length > 0) {
      const group = queue.shift()!;
      chain.push(group);
      for (const vertex of [group.start!, group.end!]) {
        if (!noise.has(vertex)) continue;
        for (const { group: neighbour } of incident.get(vertex)!) {
          if (assigned.has(neighbour.id)) continue;
          assigned.add(neighbour.id);
          queue.push(neighbour);
        }
      }
    }
    const ends = [
      ...new Set(chain.flatMap((group) => [group.start!, group.end!])),
    ].filter((vertex) => !noise.has(vertex));
    const sets = chain.map(
      (group) => new Set(group.members.map((member) => member.edge.branch)),
    );
    const common = [...sets[0]!].filter((branch) =>
      sets.every((set) => set.has(branch)),
    );
    if (common.length > 0) {
      const chosen = pick(
        common,
        (branch) =>
          ends.filter((vertex) => portAt(branches[branch]!, vertex)).length,
      );
      for (const group of chain)
        group.primary = group.members.findIndex(
          (member) => member.edge.branch === chosen,
        );
      continue;
    }
    for (const group of chain) {
      const neighbours = [group.start!, group.end!].flatMap((vertex) =>
        noise.has(vertex)
          ? incident
              .get(vertex)!
              .map((entry) => entry.group)
              .filter((other) => other !== group)
          : [],
      );
      const chosen = pick(
        group.members.map((member) => member.edge.branch),
        (branch) =>
          [group.start!, group.end!].filter((vertex) =>
            portAt(branches[branch]!, vertex),
          ).length +
          neighbours.filter((other) =>
            other.members.some((member) => member.edge.branch === branch),
          ).length,
      );
      group.primary = group.members.findIndex(
        (member) => member.edge.branch === chosen,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// §3.8 Nesting through the arrangement plus capability ray queries
// ---------------------------------------------------------------------------

interface ComponentState {
  root: number;
  branches: number[];
  box: Box;
  built: BuiltComponent | null;
}

/** A ray height away from symmetric vertices; a start choice, not a tolerance. */
const RAY_FRACTION = Math.SQRT2 - 1;

type RayVerdict = "inside" | "outside" | "retry";

async function rayContainment(
  queries: CachedQueries,
  modelingTolerance: number,
  branches: readonly Branch[],
  vertices: ReadonlyMap<string, VertexInfo>,
  child: ComponentState,
  face: Face,
  parent: BuiltComponent,
  global: Box,
  direction: number,
): Promise<RayVerdict> {
  const span = Math.max(
    1,
    global.x[1] - global.x[0],
    global.y[1] - global.y[0],
  );
  const y = child.box.y[0] + (child.box.y[1] - child.box.y[0]) * RAY_FRACTION;
  const x = child.box.x[0] + (child.box.x[1] - child.box.x[0]) * RAY_FRACTION;
  const [start, end]: [SplineVector, SplineVector] =
    direction === 0
      ? [
          [child.box.x[0], y],
          [global.x[1] + span, y],
        ]
      : direction === 1
        ? [
            [child.box.x[1], y],
            [global.x[0] - span, y],
          ]
        : direction === 2
          ? [
              [x, child.box.y[0]],
              [x, global.y[1] + span],
            ]
          : [
              [x, child.box.y[1]],
              [x, global.y[0] - span],
            ];
  if (start[0] === end[0] && start[1] === end[1]) return "retry";
  const ray: SegmentCurve = {
    kind: "line",
    form: "endpointSegment",
    curveId: "ray",
    provenance: { sourceEntityId: "ray", sourceSpanId: `ray${direction}` },
    start,
    end,
    sourceDomain: [0, 1],
  };
  const rayBox = boxOfPoints([start, end]);
  // Inside a join ball F's realized boundary runs through a connector that no
  // ray query sees: a ray meeting any outer-cycle join ball retries.
  for (const half of face.outer) {
    const group = parent.groups[half >> 1]!;
    for (const vertex of [group.start, group.end]) {
      const ball = vertex === null ? null : vertices.get(vertex)!.ballBox;
      if (ball && boxesOverlap(rayBox, ball)) return "retry";
    }
  }
  const rayBounds = (bounds: Interval): Interval =>
    bounds[0] === bounds[1]
      ? [Math.max(0, nextDown(bounds[0])), Math.min(1, nextUp(bounds[1]))]
      : bounds;
  const contacts = async (index: number) => {
    if (!boxesOverlap(rayBox, branches[index]!.box)) return [];
    const result = await queries.pair({
      modelingTolerance,
      first: ray,
      second: branches[index]!.curve,
    });
    if (result.kind !== "verified" || result.overlaps.length > 0) return null;
    return result.points;
  };

  // K's last verified crossing X: beyond it the ray never meets K again.
  let last: Interval | null = null;
  for (const index of child.branches) {
    const points = await contacts(index);
    if (points === null) return "retry";
    for (const point of points) {
      const bounds = rayBounds(point.proof.firstParameterBounds);
      if (last === null || bounds[1] > last[1]) last = bounds;
    }
  }
  if (last === null) return "retry";

  // Count verified crossings of F's outer cycle beyond X.
  const outerEdges = face.outer.map(
    (half) => parent.groups[half >> 1]!.members[0]!.edge,
  );
  let crossings = 0;
  for (const index of [...new Set(outerEdges.map((edge) => edge.branch))]) {
    const points = await contacts(index);
    if (points === null) return "retry";
    const branch = branches[index]!;
    for (const point of points) {
      const along = rayBounds(point.proof.firstParameterBounds);
      if (along[1] < last[0]) continue;
      if (along[0] <= last[1]) return "retry";
      const onBranch = widenOnBranch(branch, point.proof.secondParameterBounds);
      let onCycle = false;
      for (const edge of outerEdges.filter(
        (candidate) => candidate.branch === index,
      )) {
        for (const turns of branch.closed ? [-1, 0, 1] : [0]) {
          const shifted = shiftInterval(onBranch, turns);
          if (
            edge.fromEnclosure[1] < shifted[0] &&
            shifted[1] < edge.toEnclosure[0]
          )
            onCycle = true;
          // Too close to a vertex of the cycle to count once.
          else if (
            ivOverlap(shifted, [edge.fromEnclosure[0], edge.toEnclosure[1]])
          )
            return "retry";
        }
      }
      if (!onCycle) continue;
      if (point.classification === "unclassified") return "retry";
      if (point.classification === "crossing") crossings += 1;
    }
  }
  return crossings % 2 === 1 ? "inside" : "outside";
}

// ---------------------------------------------------------------------------
// §2.4 diagnostics, §3.9 records, §2.5 identity, and the owner
// ---------------------------------------------------------------------------

/**
 * The complete contact set of `branch` with the four exact sides of the closed
 * box, through the capability. Null unless every side query verifies with no
 * overlap; each contact carries its side-segment bounds in `first`.
 */
async function boxBoundaryContacts(
  queries: CachedQueries,
  modelingTolerance: number,
  branch: Branch,
  box: Box,
): Promise<NeutralCurvePointWitness[] | null> {
  const corners: SplineVector[] = [
    [box.x[0], box.y[0]],
    [box.x[1], box.y[0]],
    [box.x[1], box.y[1]],
    [box.x[0], box.y[1]],
  ];
  const contacts: NeutralCurvePointWitness[] = [];
  for (let side = 0; side < 4; side += 1) {
    const result = await queries.pair({
      modelingTolerance,
      first: {
        kind: "line",
        form: "endpointSegment",
        curveId: "join-ball",
        provenance: {
          sourceEntityId: "join-ball",
          sourceSpanId: `side${side}`,
        },
        start: corners[side]!,
        end: corners[(side + 1) % 4]!,
        sourceDomain: [0, 1],
      },
      second: branch.curve,
    });
    if (result.kind !== "verified" || result.overlaps.length > 0) return null;
    contacts.push(...result.points);
  }
  return contacts;
}

/** The certified point of `branch` at `parameter` lies strictly outside the closed box. */
function provenOutsideBox(branch: Branch, parameter: number, box: Box) {
  const point = boxOfIntervalPoint(curvePoint(branch.curve, exact(parameter)));
  return (
    point.x[1] < box.x[0] ||
    point.x[0] > box.x[1] ||
    point.y[1] < box.y[0] ||
    point.y[0] > box.y[1]
  );
}

/** The certified point of `branch` at `parameter` lies strictly outside the closed disk. */
function provenOutsideBall(
  branch: Branch,
  parameter: number,
  ball: { center: SplineVector; radius: number },
) {
  const point = curvePoint(branch.curve, exact(parameter));
  // Lower bound of |coordinate − centre| over the enclosure.
  const gap = (value: Interval, center: number) => {
    const offset = ivSub(value, exact(center));
    return offset[0] > 0 ? offset[0] : offset[1] < 0 ? -offset[1] : 0;
  };
  const dx = gap(point[0], ball.center[0]);
  const dy = gap(point[1], ball.center[1]);
  const distanceSquared = ivAdd(
    ivMul(exact(dx), exact(dx)),
    ivMul(exact(dy), exact(dy)),
  );
  const radiusSquared = ivMul(exact(ball.radius), exact(ball.radius));
  return distanceSquared[0] > radiusSquared[1];
}

/**
 * Proves `branch` disjoint from the closed box through the capability: it has
 * no contact with any of the four sides, so the connected branch lies wholly
 * inside or wholly outside the box, and one certified point of it is outside.
 */
async function provenClearOfBox(
  queries: CachedQueries,
  modelingTolerance: number,
  branch: Branch,
  box: Box,
): Promise<boolean> {
  const contacts = await boxBoundaryContacts(
    queries,
    modelingTolerance,
    branch,
    box,
  );
  return (
    contacts !== null &&
    contacts.length === 0 &&
    provenOutsideBox(branch, branch.domain[0], box)
  );
}

/**
 * Proves that a join member meets the join's contraction region in one
 * connected piece (re-review 1). T09a separates each member only from the
 * other member's pieces, so a member's own far part could re-enter the region
 * and cross the realized boundary there. The region is the join's single
 * ball when `ballContraction` holds (a two-member class of segments and
 * arcs), otherwise the ball box `vertex.ballBox`. Everything inside the region
 * stands for the single join point: with every member meeting it in one
 * piece and every non-member proven clear of the ball box, contracting it to
 * that point preserves the topology outside it. This does not prove that a
 * member's piece in the region is its near piece, nor that it avoids the
 * connector: a lobe against the connector inside the region is not a face
 * (re-review 2 rows A and C1).
 * - A segment meets any convex set in a connected set.
 * - An arc in the one ball: circle ∩ disk is one circular arc. With the
 *   arc's free end(s) certified outside the disk, arc ∩ disk is one interval
 *   of the arc. With several balls (three or more members) their union need
 *   not be one disk around every member's point, so the arc takes the box
 *   test below instead.
 * - Otherwise (a cubic, or an arc against the box): its only contacts with
 *   the ball box's boundary are exactly one (end join) or two (interior join)
 *   verified crossings interior to a side, and its free end(s) are certified
 *   outside the box. The join end lies in the box, so the parameters inside
 *   the closed box form one interval.
 */
async function provenSingleEntry(
  queries: CachedQueries,
  modelingTolerance: number,
  branch: Branch,
  location: NeutralCurveJoinLocation,
  vertex: VertexInfo,
  ballContraction: boolean,
): Promise<boolean> {
  if (branch.curve.kind === "line") return true;
  if (branch.closed) return false;
  const freeEnds =
    location === "start"
      ? [branch.domain[1]]
      : location === "end"
        ? [branch.domain[0]]
        : [branch.domain[0], branch.domain[1]];
  if (branch.curve.kind === "circle" && ballContraction)
    return freeEnds.every((parameter) =>
      provenOutsideBall(branch, parameter, vertex.balls[0]!),
    );
  const box = vertex.ballBox!;
  if (!freeEnds.every((parameter) => provenOutsideBox(branch, parameter, box)))
    return false;
  const contacts = await boxBoundaryContacts(
    queries,
    modelingTolerance,
    branch,
    box,
  );
  return (
    contacts !== null &&
    contacts.length === freeEnds.length &&
    contacts.every((contact) => {
      // Strictly inside the side: no corner contact, which two sides share.
      const bounds = contact.proof.firstParameterBounds;
      const side: Interval =
        bounds[0] === bounds[1]
          ? [nextDown(bounds[0]), nextUp(bounds[1])]
          : bounds;
      return (
        contact.classification === "crossing" && side[0] > 0 && side[1] < 1
      );
    })
  );
}

function makeDiagnostic(
  code: string,
  message: string,
  target: SketchSolveDiagnostic["target"],
): SketchSolveDiagnostic {
  return { code, severity: "warning", message, target };
}

function projectedReferenceDiagnostics(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SketchSolveDiagnostic[] {
  const authored = authoredReferenceIds(definition);
  const byId = new Map(
    projectedReferences.map((reference) => [reference.referenceId, reference]),
  );
  const diagnostics = projectedReferences
    .filter((reference) => !authored.has(reference.referenceId))
    .map((reference) =>
      makeDiagnostic(
        "projected-region-reference-unauthored",
        `Projected reference ${reference.referenceId} cannot participate in region derivation because it is not backed by the current authored sketch references.`,
        null,
      ),
    );
  for (const referenceId of definition.referenceIds) {
    if (!authored.has(referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "projected-region-reference-unauthored",
          `Reference ${referenceId} cannot participate in region derivation because it is not backed by both referenceIds and references.`,
          null,
        ),
      );
      continue;
    }
    const projected = byId.get(referenceId);
    if (!projected)
      diagnostics.push(
        makeDiagnostic(
          "projected-region-reference-unresolved",
          `Reference ${referenceId} is unavailable for region derivation.`,
          null,
        ),
      );
    else if (projected.status !== "projected")
      diagnostics.push(
        makeDiagnostic(
          "projected-region-reference-invalid",
          `Reference ${referenceId} cannot participate in region derivation because projection status is ${projected.status}.`,
          null,
        ),
      );
  }
  return diagnostics;
}

function isAcceptedSolve(solved: SolvedSketchSnapshot) {
  return (
    solved.status.solveState === "solved" &&
    solved.constraintStatuses.every((entry) => entry.status === "satisfied")
  );
}

export function createSketchArrangementDeriver(
  queries: NeutralCurveQueryCapability,
  options?: { queryCacheEntries?: number },
): SketchArrangementDeriver {
  const cached = createCachedQueries(
    queries,
    options?.queryCacheEntries ?? 4096,
  );
  return { derive: (input) => deriveArrangement(cached, input) };
}

async function deriveArrangement(
  queries: CachedQueries,
  input: SketchArrangementInput,
): Promise<SketchArrangementResult> {
  if (
    !(input.modelingTolerance > 0) ||
    !Number.isFinite(input.modelingTolerance)
  )
    throw new RangeError(
      "Region derivation requires the document's positive finite modelingTolerance.",
    );
  const diagnostics: SketchSolveDiagnostic[] = projectedReferenceDiagnostics(
    input.definition,
    input.projectedReferences,
  );
  const seen = new Set<string>();
  const emit = (diagnostic: SketchSolveDiagnostic) => {
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push(diagnostic);
  };
  if (!isAcceptedSolve(input.solvedSnapshot)) {
    emit(
      makeDiagnostic(
        "regions-unavailable",
        "Closed regions are derived only from an accepted solve (solved, with every constraint satisfied).",
        null,
      ),
    );
    return { regions: [], diagnostics };
  }

  const { branches, obstacles } = collectArrangementBranches(
    input.definition,
    input.solvedSnapshot,
    input.projectedReferences,
  );
  const emitForBranches = (
    code: string,
    reason: string,
    indices: readonly number[],
  ) => {
    for (const index of [...new Set(indices)].sort((l, r) => l - r)) {
      const branch = branches[index]!;
      emit(
        makeDiagnostic(
          code,
          `${reason} Affects ${branch.description}.`,
          branch.entityId
            ? { kind: "entity", entityId: branch.entityId }
            : null,
        ),
      );
    }
  };
  const declarations = collectDeclarations(
    input.definition,
    input.solvedSnapshot,
    branches,
  );
  const classOf = (member: string) => declarations.classes.find(member);
  const { pairs, selves } = await queryArrangement(
    queries,
    branches,
    declarations,
    input.modelingTolerance,
  );
  const events = collectEvents(branches, declarations, pairs, selves);

  // Components over verified contacts only.
  const components = new UnionFind<number>();
  for (const branch of branches) components.find(branch.index);
  for (const pair of pairs) {
    if (
      pair.kind === "verified" &&
      (pair.joins.length > 0 ||
        pair.points.length > 0 ||
        pair.overlaps.length > 0)
    )
      components.union(pair.first, pair.second);
  }
  const blocked = new Set<number>();
  const block = (index: number) => blocked.add(components.find(index));

  for (const failure of declarations.failures) {
    failure.branches.forEach(block);
    emitForBranches(
      "region-join-uncertain",
      `A declared join cannot be queried: ${failure.reason}.`,
      failure.branches,
    );
  }
  for (const pair of pairs) {
    if (pair.kind !== "failed") continue;
    block(pair.first);
    block(pair.second);
    const code = pair.join
      ? "region-join-uncertain"
      : pair.result === "unsupported"
        ? "region-query-unsupported"
        : "region-query-uncertain";
    emitForBranches(
      code,
      `The ${pair.join ? "declared-join" : "pair"} query of ${branches[pair.first]!.description} and ${branches[pair.second]!.description} is ${pair.result} (${pair.code}): ${pair.message}`,
      [pair.first, pair.second],
    );
  }
  for (const { branch, result } of selves) {
    if (result.kind === "verified") continue;
    block(branch);
    emitForBranches(
      result.kind === "unsupported"
        ? "region-query-unsupported"
        : "region-query-uncertain",
      `The self-intersection query of ${branches[branch]!.description} is ${result.kind} (${result.code}): ${result.message}`,
      [branch],
    );
  }
  for (const failure of events.unranked) {
    failure.branches.forEach(block);
    emitForBranches(
      "region-vertex-order-uncertain",
      `Region identity cannot be derived: ${failure.reason}.`,
      failure.branches,
    );
  }
  for (const obstacle of obstacles) {
    const label =
      obstacle.code === "region-unsupported-curve"
        ? `${obstacle.description} (${obstacle.reason}) has no neutral region curve form.`
        : `${obstacle.description} is degenerate (${obstacle.reason}).`;
    emit(
      makeDiagnostic(
        obstacle.code,
        label,
        obstacle.entityId
          ? { kind: "entity", entityId: obstacle.entityId }
          : null,
      ),
    );
    const touched = branches
      .filter((branch) => boxesOverlap(branch.box, obstacle.box))
      .map((branch) => branch.index);
    touched.forEach(block);
    emitForBranches(
      obstacle.code,
      `Regions near ${obstacle.description} are blocked: ${label}`,
      touched,
    );
  }

  // Build every unblocked component.
  const members = new Map<number, number[]>();
  for (const branch of branches) {
    const root = components.find(branch.index);
    members.set(root, [...(members.get(root) ?? []), branch.index]);
  }
  const states: ComponentState[] = [];
  for (const [root, list] of members) {
    const box = list.map((index) => branches[index]!.box).reduce(boxHull);
    if (blocked.has(root)) {
      states.push({ root, branches: list, box, built: null });
      continue;
    }
    const outcome = buildComponent(root, list, branches, events, classOf);
    if (outcome.kind === "blocked") {
      blocked.add(root);
      emitForBranches(
        outcome.code,
        `Regions are blocked: ${outcome.reason}.`,
        outcome.branches,
      );
      states.push({ root, branches: list, box, built: null });
      continue;
    }
    states.push({ root, branches: list, box, built: outcome.component });
    for (const index of outcome.component.openBranches)
      emitForBranches(
        "profile-open-segment",
        "The curve is not part of any closed boundary.",
        [index],
      );
  }

  // Join-ball clearance (review 2, re-review 1). T09a certifies only the
  // joined pair's pieces against each other; inside a join ball the realized
  // boundary runs through a connector that no pair query sees. Each member
  // must meet the join's contraction region in one piece, and every
  // other branch whose box meets the ball is proven clear of it, or the
  // components fail closed. It runs after the build so an already blocked
  // component keeps its root-cause diagnostic and costs no clearance queries.
  const joinedAt = new Map<string, number[]>();
  for (const occurrence of events.occurrences.values())
    joinedAt.set(occurrence.vertex, [
      ...(joinedAt.get(occurrence.vertex) ?? []),
      occurrence.branch,
    ]);
  const memberLocation = new Map<string, NeutralCurveJoinLocation>();
  for (const [key, joins] of declarations.pairJoins) {
    const [first, second] = key.split("|");
    for (const join of joins) {
      memberLocation.set(`${join.classRoot}@${first}`, join.first);
      memberLocation.set(`${join.classRoot}@${second}`, join.second);
    }
  }
  for (const vertex of events.vertices.values()) {
    if (vertex.ballBox === null) continue;
    const joined = new Set(joinedAt.get(vertex.id) ?? []);
    const joinedRoot = components.find([...joined][0]!);
    // One ball contracts only a two-member class without a cubic member: a
    // cubic is proven against the box, so its class contracts the box.
    const ballContraction =
      vertex.balls.length === 1 &&
      [...joined].every(
        (member) => branches[member]!.curve.kind !== "cubicBezier",
      );
    for (const member of joined) {
      if (blocked.has(joinedRoot)) break;
      if (
        await provenSingleEntry(
          queries,
          input.modelingTolerance,
          branches[member]!,
          memberLocation.get(`${vertex.classRoot}@${member}`)!,
          vertex,
          ballContraction,
        )
      )
        continue;
      blocked.add(joinedRoot);
      emitForBranches(
        "region-join-uncertain",
        `The declared join ${vertex.key} is not proven to be entered once by ${branches[member]!.description}: its own far part may re-enter the join ball, where the realized boundary is not queried.`,
        [...joined],
      );
    }
    for (const branch of branches) {
      if (joined.has(branch.index) || !boxesOverlap(branch.box, vertex.ballBox))
        continue;
      if (blocked.has(joinedRoot) && blocked.has(components.find(branch.index)))
        continue;
      if (
        await provenClearOfBox(
          queries,
          input.modelingTolerance,
          branch,
          vertex.ballBox,
        )
      )
        continue;
      blocked.add(joinedRoot);
      block(branch.index);
      emitForBranches(
        "region-join-uncertain",
        `The declared join ${vertex.key} is not proven clear of ${branch.description}: a curve may pass through the join ball, where the realized boundary is not queried.`,
        [...joined, branch.index],
      );
    }
  }
  for (const state of states) if (blocked.has(state.root)) state.built = null;

  // Nesting: each component's parent face is the smallest certified face containing it.
  const global = branches
    .map((branch) => branch.box)
    .reduce(boxHull, { x: [0, 0], y: [0, 0] } as Box);
  const faceBlock = new Map<Face, string>();
  const faceOwner = new Map<Face, ComponentState>();
  for (const state of states)
    for (const face of state.built?.faces ?? []) faceOwner.set(face, state);
  const children = new Map<Face, ComponentState[]>();
  for (const child of states) {
    const inside: Face[] = [];
    for (const [face, owner] of faceOwner) {
      // Conservative boxes prove only non-containment when disjoint; any
      // overlap goes to the certified ray test (review 1).
      if (owner === child || !boxesOverlap(face.box, child.box)) continue;
      // K inside F puts every bounded face of K inside F's outer cycle, so a
      // face of K certified larger than F proves K is not inside F.
      if (child.built?.faces.some((own) => own.area[0] > face.area[1]))
        continue;
      let verdict: RayVerdict = "retry";
      for (
        let direction = 0;
        direction < 4 && verdict === "retry";
        direction += 1
      )
        verdict = await rayContainment(
          queries,
          input.modelingTolerance,
          branches,
          events.vertices,
          child,
          face,
          owner.built!,
          global,
          direction,
        );
      if (verdict === "retry") {
        faceBlock.set(
          face,
          "the nesting of a nearby component cannot be certified by ray crossings",
        );
        emitForBranches(
          "region-nesting-uncertain",
          "Region nesting cannot be certified by ray crossings.",
          [...child.branches, ...owner.branches],
        );
        continue;
      }
      if (verdict === "inside") inside.push(face);
    }
    if (inside.length === 0) continue;
    const smallest = [...inside].sort((l, r) => l.area[0] - r.area[0])[0]!;
    const ambiguous = inside.filter(
      (face) => face !== smallest && !(smallest.area[1] < face.area[0]),
    );
    if (ambiguous.length > 0) {
      for (const face of [smallest, ...ambiguous])
        faceBlock.set(
          face,
          "the containing face of a nested component is ambiguous",
        );
      emitForBranches(
        "region-nesting-uncertain",
        "The containing face of a nested component cannot be certified.",
        child.branches,
      );
      continue;
    }
    children.set(smallest, [...(children.get(smallest) ?? []), child]);
  }

  // Publish every face whose arrangement, holes and nesting are proven.
  const degreeByKey = new Map<string, number>();
  for (const state of states) {
    for (const [vertex, value] of state.built?.degree ?? [])
      degreeByKey.set(events.vertices.get(vertex)!.key, value);
  }
  const drafts: RegionDraft[] = [];
  for (const [face, state] of faceOwner) {
    const nested = children.get(face) ?? [];
    const unproven = nested.find((child) => child.built === null);
    const obstacle = obstacles.find((candidate) =>
      boxesOverlap(candidate.box, face.box),
    );
    const nesting =
      faceBlock.get(face) ??
      (unproven
        ? "it contains a component whose arrangement is not proven"
        : null);
    if (nesting || obstacle) {
      emitForBranches(
        nesting ? "region-nesting-uncertain" : obstacle!.code,
        `A region is blocked because ${nesting ?? `it may contain ${obstacle!.description}`}.`,
        state.branches,
      );
      continue;
    }
    const built = state.built!;
    drafts.push({
      area: face.area,
      loops: [
        { built, cycle: face.outer, role: "outer" },
        ...face.holes.map((cycle) => ({
          built,
          cycle,
          role: "inner" as const,
        })),
        ...nested.flatMap((child) =>
          child.built!.outerCycles.map((cycle) => ({
            built: child.built!,
            cycle,
            role: "inner" as const,
          })),
        ),
      ],
    });
  }
  const membersOf = (root: string) =>
    declarations.classMembers.get(root) ?? [root];
  const regions = await publishRegions(
    input,
    branches,
    events,
    classOf,
    membersOf,
    drafts,
    degreeByKey,
    emit,
  );
  return { regions, diagnostics };
}

interface RegionDraft {
  area: Interval;
  loops: { built: BuiltComponent; cycle: number[]; role: "outer" | "inner" }[];
}

async function publishRegions(
  input: SketchArrangementInput,
  branches: readonly Branch[],
  events: ArrangementEvents,
  classOf: (member: string) => string,
  membersOf: (root: string) => string[],
  drafts: readonly RegionDraft[],
  degreeByKey: ReadonlyMap<string, number>,
  emit: (diagnostic: SketchSolveDiagnostic) => void,
): Promise<RegionRecord[]> {
  const vertexRecord = (
    vertex: string | null,
    built: BuiltComponent,
    branch: Branch,
    edge: SubEdge,
    side: "from" | "to",
  ): RegionBoundaryVertex | null => {
    if (vertex === null) return null;
    const info = events.vertices.get(vertex)!;
    const position: SketchPoint2D = [info.position[0], info.position[1]];
    if (info.witness)
      return {
        kind: "verifiedIntersection",
        key: info.key,
        witness: info.witness,
        position,
      };
    const list = built.ordered.get(branch.index)!;
    const port =
      side === "from"
        ? edge.from === list[0] &&
          branch.ports.start !== null &&
          classOf(branch.ports.start) === info.classRoot
          ? branch.portPointIds.start
          : null
        : edge.to === list.at(-1) &&
            branch.ports.end !== null &&
            classOf(branch.ports.end) === info.classRoot
          ? branch.portPointIds.end
          : null;
    return {
      kind: "declaredJoin",
      key: info.key,
      pointIds: membersOf(info.classRoot!)
        .filter((member): member is SketchPointId =>
          member.startsWith("sketch_point_"),
        )
        .sort(),
      portPointId: branch.closed ? null : port,
      position,
      ballRadius: info.ballRadius,
    };
  };
  const segment = (
    built: BuiltComponent,
    half: number,
  ): RegionBoundarySegmentRecord => {
    const group = built.groups[half >> 1]!;
    const primary = group.members[group.primary]!;
    const branch = branches[primary.edge.branch]!;
    const forwardHalf = half % 2 === 0;
    const forward = forwardHalf === primary.same;
    const startVertex = forwardHalf ? group.start : group.end;
    const endVertex = forwardHalf ? group.end : group.start;
    const coincident = group.members
      .filter((member) => member !== primary)
      .map((member) => branches[member.edge.branch]!)
      .sort((l, r) => (l.key < r.key ? -1 : 1))
      .map((other) => other.record);
    return {
      branch: branch.record,
      ...(coincident.length > 0 ? { coincidentBranches: coincident } : {}),
      sourceParameterInterval: primary.edge.interval,
      traversalDirection: forward ? "forward" : "reverse",
      start: vertexRecord(
        startVertex,
        built,
        branch,
        primary.edge,
        forward ? "from" : "to",
      ),
      end: vertexRecord(
        endVertex,
        built,
        branch,
        primary.edge,
        forward ? "to" : "from",
      ),
      sourceSegmentOrdinal: primary.edge.ordinal,
    };
  };

  const candidates = await Promise.all(
    drafts.map(async (draft) => {
      const loops = draft.loops.map((loop) => {
        const segments = loop.cycle.map((half) => segment(loop.built, half));
        return {
          role: loop.role,
          orientation:
            loop.role === "outer"
              ? ("counterClockwise" as const)
              : ("clockwise" as const),
          segments,
          boundaryPointIds: segments.flatMap((entry) =>
            entry.start?.kind === "declaredJoin" && entry.start.portPointId
              ? [entry.start.portPointId]
              : [],
          ),
          isClosed: true,
        };
      });
      const signature = canonicalRegionSignature(
        { loops: loops as RegionLoopRecord[] },
        degreeByKey,
      );
      return {
        draft,
        loops,
        signature,
        regionId: await createRegionId(input.sketchId, signature),
      };
    }),
  );

  // A hash (or signature) collision inside one sketch fails closed.
  const byId = new Map<RegionId, typeof candidates>();
  for (const candidate of candidates)
    byId.set(candidate.regionId, [
      ...(byId.get(candidate.regionId) ?? []),
      candidate,
    ]);
  const unique = candidates.filter((candidate) => {
    if (byId.get(candidate.regionId)!.length === 1) return true;
    emit(
      makeDiagnostic(
        "region-identity-collision",
        `Two derived regions share identity ${candidate.regionId}; both are withheld.`,
        null,
      ),
    );
    return false;
  });
  unique.sort(
    (l, r) =>
      ivMid(r.draft.area) - ivMid(l.draft.area) ||
      (l.signature < r.signature ? -1 : l.signature > r.signature ? 1 : 0),
  );
  const ownership: OwnershipRecord = {
    ownerDocumentId: input.documentId,
    ownerRevisionId: input.revisionId,
    ownerFeatureId: null,
    ownerSketchId: input.sketchId,
    ownerBodyId: null,
  };
  return unique.map((candidate, index) => ({
    ...ownership,
    regionId: candidate.regionId,
    signature: candidate.signature,
    label: index === 0 ? "Outer region" : `Loop region ${index + 1}`,
    target: {
      kind: "region",
      sketchId: input.sketchId,
      regionId: candidate.regionId,
    },
    sourceSketch: { kind: "sketch", sketchId: input.sketchId },
    loops: candidate.loops.map((loop, ordinal) => ({
      ...loop,
      loopId: `region_loop_${candidate.regionId}_${ordinal}` as RegionLoopId,
    })),
    isClosed: true,
  }));
}
