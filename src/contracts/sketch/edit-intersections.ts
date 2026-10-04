/**
 * Exact edit-intersection service (T10g design §2, as amended by its review;
 * T10g-1). The one owner of where an edit tool's target is cut: Trim now,
 * Extend and Split on the same function in T10g-2. The real solver adapter,
 * the mock adapter and the derivation worker all call
 * `querySketchEditIntersections`; there is no second implementation.
 *
 * It builds neutral curves with the region arrangement's own branch builder
 * (construction included, A4), its declared-join classes and its pair
 * queries (declared pairs through `queryNeutralCurveJoin`), restricted to
 * (target, cutter) pairs. Every cut is a certified enclosure on the target:
 * - parameters are the target branch's SOURCE parameter (line t ∈ [0, 1];
 *   arc: the angle in its counter-clockwise interval; circle θ ∈ [0, 2π)
 *   from the seam at angle 0, i.e. the +x axis; spline: global source t),
 *   and cuts are listed in the target's traversal order (a clockwise arc
 *   runs from its larger angle down, `parameterOrder: "decreasing"`);
 * - `position` is the sole evaluator (`evaluateNeutralCurve`) at the
 *   representative on the solved target branch.
 * Any point of a certified enclosure is a valid representative of its root,
 * so the endpoint and knot rules below are not tolerance merges.
 */
import {
  evaluateNeutralCurve,
  type NeutralCurveJoinLocation,
  type NeutralCurveQueryCapability,
} from "@/contracts/modeling/neutral-curve-query";
import type {
  ConstraintId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import {
  collectArrangementBranches,
  collectDeclarations,
  createCachedQueries,
  incidenceOnHosts,
  offsetArrangementInput,
  pairKey,
  queryArrangement,
  widenOnBranch,
  type Branch,
} from "@/contracts/sketch/region-extraction";
import {
  boxesOverlap,
  boxHull,
  exact,
  nextDown,
  nextUp,
  TAU,
  type Interval,
} from "@/contracts/sketch/region-interval-geometry";
import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";

/** One accepted live pair (the `SketchLiveRegionBasis` fields) and the operation. */
export interface SketchEditIntersectionInput {
  /** Evaluated definition of the accepted pair. */
  definition: SketchDefinition;
  /** Its solved snapshot, with the offset publications applied. */
  solvedSnapshot: SolvedSketchSnapshot;
  /** Carried with the pair; projected geometry is not a cutter (A4, T13). */
  projectedReferences: ProjectedSketchReferenceRecord[];
  /** The document's settings.modelingTolerance. */
  modelingTolerance: number;
  /** Trim: the cutters are every other sketch curve (A4). Extend/Split: T10g-2. */
  operation: { kind: "trim"; targetEntityId: SketchEntityId };
}

/** Q1b tie of a new end: a cutter's end point (R-2), or onto the cutter. */
export type SketchEditTie =
  | { kind: "coincident"; pointId: SketchPointId }
  | { kind: "pointOnCurve" };

export interface SketchEditCut {
  /** Outward, widened enclosure of the root(s) on the target (source parameter). */
  enclosure: [number, number];
  /** Inside `enclosure`; a knot when the knot rule snaps. */
  representative: number;
  /** A spline cut exactly on a fit point: its occurrence index (else null). */
  knotOccurrenceIndex: number | null;
  /** `evaluateNeutralCurve(target branch, representative)`. */
  position: [number, number];
  /**
   * Every distinct cutter of this cut. `tie` is null for a cutter of a
   * multi-cutter cut that does not share the cut's declared join class
   * (review R-4: only the representative member's cutter is tied).
   */
  cutters: { entityId: SketchEntityId; tie: SketchEditTie | null }[];
}

/** A `pointOnCurve` on the target: its closest-point parameter and its cut. */
export interface SketchEditIncidence {
  constraintId: ConstraintId;
  pointId: SketchPointId;
  /** Closest point on the solved target (the arrangement's incidence rule). */
  parameter: number;
  /** Index of the cut its declared join produced or whose enclosure holds it (R-3). */
  cut: number | null;
}

export type SketchEditFailureCode =
  | "edit-target-unsupported"
  | "edit-target-invalid"
  | "edit-intersection-uncertain"
  | "edit-intersections-unordered"
  | "edit-too-few-cuts";

export type SketchEditIntersectionResult =
  | {
      kind: "verified";
      /** Strictly ordered along the target's traversal, disjoint enclosures. */
      cuts: SketchEditCut[];
      parameterOrder: "increasing" | "decreasing";
      incidences: SketchEditIncidence[];
      /**
       * [TECH] T-g5: non-accepted offset outputs (never cutters) whose
       * outward box meets the target's; the apply step refuses with
       * `edit-input-offset-not-certified` naming them.
       */
      nonAcceptedNearTarget: SketchEntityId[];
    }
  | {
      kind: "failed";
      code: SketchEditFailureCode;
      message: string;
      entityIds: SketchEntityId[];
      /** As in `verified`: C3 refuses before this failure is shown. */
      nonAcceptedNearTarget: SketchEntityId[];
    };

export const TRIM_TARGET_UNSUPPORTED_MESSAGE =
  "Trim supports line, circle, arc, and spline entities.";
export const TRIM_TOO_FEW_CUTS_MESSAGE =
  "Trim needs two unambiguous intersections on the target curve.";

/** The exact-request memo capacity of one call (edit lane, A-3: no shared memo). */
const QUERY_MEMO_CAPACITY = 256;
/** fl(2π) < 2π < TAU_UP: the outward bound of the true period. */
const TAU_UP = nextUp(TAU);

interface Candidate {
  enclosure: Interval;
  representative: number;
  knot: number | null;
  cutter: SketchEntityId;
  tie: SketchEditTie;
  /** Declared join class at this contact (a join, or a coincident tie's point class). */
  classRoot: string | null;
  /**
   * A contact at a closed target's seam (circle θ = 0, closed-spline knot
   * 0): `enclosure` is its part after the seam and this is the lower bound
   * of its part before the seam end (the wrap), else null.
   */
  wrapFrom: number | null;
}

type Failure = Omit<
  Extract<SketchEditIntersectionResult, { kind: "failed" }>,
  "nonAcceptedNearTarget"
>;

class EditFailure extends Error {
  readonly failure: Failure;
  constructor(failure: Failure) {
    super(failure.message);
    this.failure = failure;
  }
}

const fail = (
  code: SketchEditFailureCode,
  message: string,
  entityIds: SketchEntityId[],
): never => {
  throw new EditFailure({ kind: "failed", code, message, entityIds });
};

export async function querySketchEditIntersections(
  input: SketchEditIntersectionInput,
  queries: NeutralCurveQueryCapability,
): Promise<SketchEditIntersectionResult> {
  const context = { nonAcceptedNearTarget: [] as SketchEntityId[] };
  try {
    return await queryTrim(input, queries, context);
  } catch (error) {
    if (error instanceof EditFailure)
      return {
        ...error.failure,
        nonAcceptedNearTarget: context.nonAcceptedNearTarget,
      };
    throw error;
  }
}

async function queryTrim(
  input: SketchEditIntersectionInput,
  queries: NeutralCurveQueryCapability,
  context: { nonAcceptedNearTarget: SketchEntityId[] },
): Promise<SketchEditIntersectionResult> {
  const { definition, solvedSnapshot: solved, modelingTolerance } = input;
  const targetId = input.operation.targetEntityId;
  const labelOf = (entityId: SketchEntityId) =>
    definition.entities.find((entity) => entity.entityId === entityId)?.label ??
    entityId;
  const nonAccepted = new Set(
    (
      offsetArrangementInput(definition, solved, []).unpublishedOffsetOutputs ??
      []
    ).map((output) => output.entityId),
  );
  // Non-accepted outputs are built as branches here only to test their
  // boxes; they are never cutters (C3, [TECH] T-g5).
  const { branches: all, obstacles } = collectArrangementBranches(
    definition,
    solved,
    [],
    [],
    [],
    { includeConstruction: true },
  );
  const targetBranches = all.filter((branch) => branch.entityId === targetId);
  if (targetBranches.length === 0) {
    const obstacle = obstacles.find((entry) => entry.entityId === targetId);
    return obstacle?.code === "region-degenerate-curve"
      ? fail(
          "edit-target-invalid",
          `Trim can't trim ${labelOf(targetId)}: its shape is invalid (${obstacle.reason}).`,
          [targetId],
        )
      : fail("edit-target-unsupported", TRIM_TARGET_UNSUPPORTED_MESSAGE, [
          targetId,
        ]);
  }
  const targetBox = targetBranches
    .map((branch) => branch.box)
    .reduce((hull, box) => boxHull(hull, box));
  const nonAcceptedNearTarget = [
    ...new Set(
      all.flatMap((branch) =>
        branch.entityId !== null &&
        branch.entityId !== targetId &&
        nonAccepted.has(branch.entityId) &&
        boxesOverlap(branch.box, targetBox)
          ? [branch.entityId]
          : [],
      ),
    ),
  ];
  context.nonAcceptedNearTarget = nonAcceptedNearTarget;
  const cutterBranches = all.filter(
    (branch) =>
      branch.entityId !== null &&
      branch.entityId !== targetId &&
      !nonAccepted.has(branch.entityId),
  );
  // Re-indexed to the target and cutter branches only.
  const branches: Branch[] = [...targetBranches, ...cutterBranches].map(
    (branch, index) => ({ ...branch, index }),
  );
  const isTarget = (branch: Branch) => branch.entityId === targetId;
  const declarations = collectDeclarations(definition, solved, branches);
  for (const failure of declarations.failures) {
    if (!failure.branches.some((index) => isTarget(branches[index]!))) continue;
    const cutter = failure.branches
      .map((index) => branches[index]!)
      .find((branch) => !isTarget(branch));
    fail(
      "edit-intersection-uncertain",
      `Trim could not verify where ${labelOf(targetId)} meets ${cutter ? labelOf(cutter.entityId!) : "itself"} (${failure.reason}). Nothing was changed.`,
      cutter ? [targetId, cutter.entityId!] : [targetId],
    );
  }
  const { pairs } = await queryArrangement(
    createCachedQueries(queries, QUERY_MEMO_CAPACITY),
    branches,
    declarations,
    modelingTolerance,
    { pairs: (a, b) => isTarget(a) !== isTarget(b), selves: false },
  );

  // The target's traversal: open ends, knots, and the closed (seam) case.
  const ordered = [...targetBranches].sort(
    (left, right) => left.domain[0] - right.domain[0],
  );
  const first = ordered[0]!;
  const circle = ordered.length === 1 && first.closed;
  const domainStart = ordered[0]!.domain[0];
  const domainEnd = ordered.at(-1)!.domain[1];
  const splineClosed =
    first.curve.kind === "cubicBezier" &&
    ordered[0]!.ports.start !== null &&
    ordered[0]!.ports.start === ordered.at(-1)!.ports.end;
  /** Interior knots (index = the occurrence that starts span k). */
  const knots = ordered.slice(1).map((branch, k) => ({
    parameter: branch.domain[0],
    index: k + 1,
  }));
  const targetEntity = solved.solvedEntities.find(
    (entity) => entity.entityId === targetId,
  );
  const parameterOrder =
    targetEntity?.kind === "arc" && targetEntity.sweepDirection === "clockwise"
      ? "decreasing"
      : "increasing";

  /** Cutter-side tie (review R-2): a port inside the cutter's enclosure is a `coincident`. */
  const cutterTie = (cutter: Branch, enclosure: Interval): SketchEditTie => {
    if (!cutter.closed) {
      if (enclosure[0] <= cutter.domain[0] && cutter.portPointIds.start)
        return { kind: "coincident", pointId: cutter.portPointIds.start };
      if (enclosure[1] >= cutter.domain[1] && cutter.portPointIds.end)
        return { kind: "coincident", pointId: cutter.portPointIds.end };
    }
    return { kind: "pointOnCurve" };
  };
  const classOfTie = (tie: SketchEditTie) =>
    tie.kind === "coincident" ? declarations.classes.find(tie.pointId) : null;

  const candidates: Candidate[] = [];
  /** Normalizes one target-side contact; null when it is at an open target end. */
  const addCandidate = (
    rawEnclosure: Interval,
    representative: number,
    cutter: Branch,
    tie: SketchEditTie,
    classRoot: string | null,
  ) => {
    let enclosure = rawEnclosure;
    let rep = representative;
    let knot: number | null = null;
    if (circle) {
      // θ mod 2π from the seam (A-8: the seam is angle 0, today's Trim origin).
      if (enclosure[1] < 0 || enclosure[0] >= TAU) {
        const shift = enclosure[1] < 0 ? TAU : -TAU;
        // The true period 2π lies in [TAU, TAU_UP]; widen by it outward.
        enclosure =
          shift > 0
            ? [nextDown(enclosure[0] + TAU), nextUp(enclosure[1] + TAU_UP)]
            : [nextDown(enclosure[0] - TAU_UP), nextUp(enclosure[1] - TAU)];
        rep += shift;
      }
      // [TECH] 2026-10-04: an enclosure holding θ = 0 (mod 2π; TAU < 2π, so
      // only `> TAU` holds 2π) is the seam contact: its representative is
      // θ = 0 bitwise and it is the first cut from the seam, as the knot
      // rule snaps (any point of a certified enclosure is a valid
      // representative of its root).
      if (enclosure[0] <= 0 || enclosure[1] > TAU) {
        const before = enclosure[0] <= 0;
        candidates.push({
          enclosure: [0, before ? enclosure[1] : nextUp(enclosure[1] - TAU)],
          representative: 0,
          knot: null,
          cutter: cutter.entityId!,
          tie,
          classRoot,
          wrapFrom: before ? nextDown(enclosure[0] + TAU) : enclosure[0],
        });
        return;
      }
    } else {
      if (
        splineClosed &&
        (enclosure[0] <= domainStart || enclosure[1] >= domainEnd)
      ) {
        // The closing knot (smooth seam or positional corner) is knot 0.
        candidates.push({
          enclosure: [
            domainStart,
            enclosure[0] <= domainStart ? enclosure[1] : domainStart,
          ],
          representative: domainStart,
          knot: 0,
          cutter: cutter.entityId!,
          tie,
          classRoot,
          wrapFrom: enclosure[1] >= domainEnd ? enclosure[0] : domainEnd,
        });
        return;
      }
      if (enclosure[0] <= domainStart || enclosure[1] >= domainEnd) return;
      const inside = knots.filter(
        (entry) =>
          enclosure[0] <= entry.parameter && entry.parameter <= enclosure[1],
      );
      if (inside.length > 1)
        fail(
          "edit-intersections-unordered",
          `Trim can't tell which fit point of ${labelOf(targetId)} ${labelOf(cutter.entityId!)} crosses: two fit points are too close together. Nothing was changed.`,
          [targetId, cutter.entityId!],
        );
      if (inside[0]) {
        knot = inside[0].index;
        rep = inside[0].parameter;
      }
    }
    candidates.push({
      enclosure,
      representative: rep,
      knot,
      cutter: cutter.entityId!,
      tie,
      classRoot,
      wrapFrom: null,
    });
  };

  for (const pair of pairs) {
    const a = branches[pair.first]!;
    const b = branches[pair.second]!;
    const targetFirst = isTarget(a);
    const target = targetFirst ? a : b;
    const cutter = targetFirst ? b : a;
    if (pair.kind === "failed")
      fail(
        "edit-intersection-uncertain",
        `Trim could not verify where ${labelOf(targetId)} meets ${labelOf(cutter.entityId!)} (${pair.code}). Nothing was changed.`,
        [targetId, cutter.entityId!],
      );
    if (pair.kind !== "verified") continue;
    const side = <T>(first: T, second: T) =>
      targetFirst ? ([first, second] as const) : ([second, first] as const);
    for (const point of pair.points) {
      const [targetBounds, cutterBounds] = side(
        point.proof.firstParameterBounds,
        point.proof.secondParameterBounds,
      );
      const [targetParameter] = side(
        point.firstParameter,
        point.secondParameter,
      );
      const tie = cutterTie(cutter, widenOnBranch(cutter, cutterBounds));
      addCandidate(
        widenOnBranch(target, targetBounds),
        targetParameter,
        cutter,
        tie,
        classOfTie(tie),
      );
    }
    const declared =
      declarations.pairJoins.get(pairKey(pair.first, pair.second)) ?? [];
    pair.joins.forEach(({ witness, classRoot }, index) => {
      const join = declared[index]!;
      const [targetLocation, cutterLocation] = side<NeutralCurveJoinLocation>(
        join.first,
        join.second,
      );
      const [targetBounds, cutterBounds] = side(
        witness.firstParameterBounds,
        witness.secondParameterBounds,
      );
      const [targetParameter] = side(
        witness.firstParameter,
        witness.secondParameter,
      );
      // A declared join at a target port: an open end is no cut; an interior
      // spline knot (or a closed spline's seam) is a knot cut.
      const at =
        targetLocation === "start"
          ? target.domain[0]
          : targetLocation === "end"
            ? target.domain[1]
            : null;
      const tie: SketchEditTie =
        cutterLocation === "start" && cutter.portPointIds.start
          ? { kind: "coincident", pointId: cutter.portPointIds.start }
          : cutterLocation === "end" && cutter.portPointIds.end
            ? { kind: "coincident", pointId: cutter.portPointIds.end }
            : cutterTie(cutter, widenOnBranch(cutter, cutterBounds));
      if (at !== null) addCandidate(exact(at), at, cutter, tie, classRoot);
      else
        addCandidate(
          widenOnBranch(target, targetBounds),
          targetParameter,
          cutter,
          tie,
          classRoot,
        );
    });
    for (const overlap of pair.overlaps) {
      const [targetInterval, cutterInterval] = side(
        overlap.firstInterval,
        overlap.secondInterval,
      );
      for (const end of [0, 1] as const) {
        const tie = cutterTie(
          cutter,
          widenOnBranch(cutter, exact(cutterInterval[end])),
        );
        addCandidate(
          widenOnBranch(target, exact(targetInterval[end])),
          targetInterval[end],
          cutter,
          tie,
          classOfTie(tie),
        );
      }
    }
  }

  // Clusters: connected components of overlapping enclosures, one cut each.
  candidates.sort((left, right) => left.enclosure[0] - right.enclosure[0]);
  const clusters: Candidate[][] = [];
  let hull = -Infinity;
  for (const candidate of candidates) {
    if (clusters.length === 0 || candidate.enclosure[0] > hull) {
      clusters.push([candidate]);
      hull = candidate.enclosure[1];
    } else {
      clusters.at(-1)!.push(candidate);
      hull = Math.max(hull, candidate.enclosure[1]);
    }
  }
  // The seam cluster (first from the seam) wraps: a cluster near the seam
  // end that reaches a seam member's part before the end joins it.
  const period = domainEnd - domainStart;
  let wrapFrom = Math.min(
    ...(clusters[0] ?? []).flatMap((member) => member.wrapFrom ?? []),
  );
  while (clusters.length > 1) {
    const last = clusters.at(-1)!;
    if (Math.max(...last.map((member) => member.enclosure[1])) < wrapFrom)
      break;
    clusters.pop();
    clusters[0]!.push(...last);
    wrapFrom = Math.min(wrapFrom, ...last.map((member) => member.enclosure[0]));
  }
  const cuts = clusters.map((cluster) => cutOf(cluster));
  if (parameterOrder === "decreasing") cuts.reverse();
  if (cuts.length < 2)
    fail("edit-too-few-cuts", TRIM_TOO_FEW_CUTS_MESSAGE, [targetId]);

  function cutOf(cluster: Candidate[]): SketchEditCut {
    const knotIndices = new Set(cluster.flatMap((member) => member.knot ?? []));
    if (knotIndices.size > 1)
      fail(
        "edit-intersections-unordered",
        `Trim can't tell which fit point of ${labelOf(targetId)} is meant: two are too close together. Nothing was changed.`,
        [targetId],
      );
    // One member per root: the same cutter at the same knot or the same
    // cutter end point is one contact (the knot / R-2 rules); any other
    // repeated cutter is two certified roots that cannot be ordered.
    const members: Candidate[] = [];
    for (const member of cluster) {
      const twin = members.find(
        (kept) =>
          kept.cutter === member.cutter &&
          ((kept.knot !== null && kept.knot === member.knot) ||
            (kept.tie.kind === "coincident" &&
              member.tie.kind === "coincident" &&
              kept.tie.pointId === member.tie.pointId)),
      );
      if (twin) continue;
      if (members.some((kept) => kept.cutter === member.cutter))
        fail(
          "edit-intersections-unordered",
          `Trim can't tell apart where ${labelOf(member.cutter)} crosses ${labelOf(targetId)}: the crossings are too close together. Nothing was changed.`,
          [targetId, member.cutter],
        );
      members.push(member);
    }
    const narrowest = [...members].sort(
      (left, right) =>
        left.enclosure[1] -
          left.enclosure[0] -
          (right.enclosure[1] - right.enclosure[0]) ||
        (left.cutter < right.cutter ? -1 : left.cutter > right.cutter ? 1 : 0),
    )[0]!;
    const knotMember = members.find((member) => member.knot !== null);
    const seamMember = members.find((member) => member.wrapFrom !== null);
    const chosen = knotMember ?? seamMember ?? narrowest;
    const representative = chosen.representative;
    // A seam cut's enclosure is reported in the lift around the seam start:
    // its lower bound lies before the start by the wrapped part.
    const enclosure: [number, number] = seamMember
      ? [
          nextDown(domainStart - ((circle ? TAU_UP : domainEnd) - wrapFrom)),
          Math.max(
            ...cluster.flatMap((member) =>
              member.enclosure[0] < wrapFrom ? [member.enclosure[1]] : [],
            ),
          ),
        ]
      : [
          Math.min(...cluster.map((member) => member.enclosure[0])),
          Math.max(...cluster.map((member) => member.enclosure[1])),
        ];
    // Review R-4: several cutters are all tied only when they share one
    // declared join class here; otherwise only the representative member's.
    const shared =
      members.length > 1 &&
      members.every(
        (member) =>
          member.classRoot !== null &&
          member.classRoot === members[0]!.classRoot,
      );
    // One `coincident` tie per declared class (review A-5): the points of
    // one satisfied class are already joined.
    const tiedClasses = new Set<string>();
    const cutters = members.map((member) => {
      if (members.length > 1 && !shared && member !== chosen)
        return { entityId: member.cutter, tie: null };
      if (member.tie.kind === "coincident") {
        const root = declarations.classes.find(member.tie.pointId);
        if (tiedClasses.has(root))
          return { entityId: member.cutter, tie: null };
        tiedClasses.add(root);
      }
      return { entityId: member.cutter, tie: member.tie };
    });
    const host =
      ordered.find(
        (branch) =>
          branch.domain[0] <= representative &&
          representative <= branch.domain[1],
      ) ?? ordered[0]!;
    const position = evaluateNeutralCurve(host.curve, representative);
    return {
      enclosure,
      representative,
      knotOccurrenceIndex: knotMember?.knot ?? null,
      position: [position[0], position[1]],
      cutters,
    };
  }

  // Review R-3: `pointOnCurve` constraints on the target, with their cut.
  const satisfied = new Set(
    solved.constraintStatuses.flatMap((status) =>
      status.status === "satisfied" ? [status.constraintId] : [],
    ),
  );
  const positions = new Map(
    solved.solvedPoints.map((point) => [point.pointId, point.solvedPosition]),
  );
  const cutClasses = clusters.map(
    (cluster) => new Set(cluster.flatMap((member) => member.classRoot ?? [])),
  );
  if (parameterOrder === "decreasing") cutClasses.reverse();
  const incidences: SketchEditIncidence[] = definition.constraints.flatMap(
    (constraint) => {
      if (
        constraint.kind !== "pointOnCurve" ||
        constraint.curve.entityId !== targetId
      )
        return [];
      const position = positions.get(constraint.point.pointId);
      if (!position) return [];
      const { parameter } = incidenceOnHosts(ordered, position);
      const root = declarations.classes.find(constraint.point.pointId);
      const byClass = satisfied.has(constraint.constraintId)
        ? cutClasses.findIndex((classes) => classes.has(root))
        : -1;
      const byEnclosure = cuts.findIndex(
        (cut) =>
          (cut.enclosure[0] <= parameter && parameter <= cut.enclosure[1]) ||
          (cut.enclosure[0] < domainStart &&
            parameter >= cut.enclosure[0] + period),
      );
      const cut = byClass >= 0 ? byClass : byEnclosure;
      return [
        {
          constraintId: constraint.constraintId,
          pointId: constraint.point.pointId,
          parameter,
          cut: cut >= 0 ? cut : null,
        },
      ];
    },
  );

  return {
    kind: "verified",
    cuts,
    parameterOrder,
    incidences,
    nonAcceptedNearTarget,
  };
}
