import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import { extractDeclaredOffsetChainConnectivity } from "@/contracts/sketch/offset-chain-connectivity";
import type {
  OffsetFrameArcVariation,
  OffsetFrameCotangent,
  OffsetFrameJvp,
  OffsetFrameRelationship,
  OffsetSolveFrame,
} from "@/contracts/sketch/offset-derivation-frame";
import type {
  SketchDefinition,
  SketchDerivationDefinition,
  SketchPoint2D,
  SolvedSketchDerivedCubicSpan,
} from "@/contracts/sketch/schema";
import type { SplinePoles } from "@/contracts/sketch/spline-geometry";

/**
 * T08b-g5: the one mapping between an offset relationship's solve frame and
 * its authored outputs ([TECH] G6, D2). Every driven output point is one
 * published frame datum; value, JVP and pullback all read the same datum, so
 * the solver, display and publish cannot disagree on which number a point is.
 * - A line/seed-arc output end is its `lineArcEndpoints` end, a seed-arc or
 *   circle centre the piece centre, a shell terminal its owner's end pole.
 * - A trim adjacency is the trim point (shared by both neighbours); a
 *   vertex adjacency (parallel/absorbed) is the shared pole (bitwise equal on
 *   both sides after adoption); an arc adjacency keeps both neighbours' own
 *   ends and maps the joint arc's centre to the F1 arc centre.
 */

type OffsetRelationshipDefinition = Extract<
  SketchDerivationDefinition,
  { kind: "offset" }
>;

/** One published frame datum a driven output point reads. */
export type OffsetFramePointDatum =
  | {
      readonly kind: "lineArc";
      readonly seed: SketchEntityId;
      readonly end: "start" | "end";
    }
  | { readonly kind: "seedArcCenter"; readonly seed: SketchEntityId }
  | { readonly kind: "circleCenter"; readonly seed: SketchEntityId }
  | { readonly kind: "trim"; readonly jointIndex: number }
  | {
      readonly kind: "pole";
      readonly seed: SketchEntityId;
      readonly leaf: number;
      readonly pole: 0 | 3;
    }
  | { readonly kind: "arcCenter"; readonly jointIndex: number };

/** One published frame datum a driven output entity state (radius / angles) reads. */
export type OffsetFrameEntityDatum =
  | { readonly kind: "circle"; readonly seed: SketchEntityId }
  | { readonly kind: "seedArc"; readonly seed: SketchEntityId }
  | { readonly kind: "jointArc"; readonly jointIndex: number };

export interface OffsetFrameShellOutput {
  readonly entityId: SketchEntityId;
  readonly seed: SketchEntityId;
  /** Output span id by source occurrence key `${start}>${end}`. */
  readonly spanIds: ReadonlyMap<string, string>;
}

export interface OffsetFrameOutputMap {
  readonly points: ReadonlyMap<SketchPointId, OffsetFramePointDatum>;
  readonly entities: ReadonlyMap<SketchEntityId, OffsetFrameEntityDatum>;
  /** Sweep directions of the seed-arc and joint-arc outputs (the frame's). */
  readonly sweeps: ReadonlyMap<
    SketchEntityId,
    "clockwise" | "counterClockwise"
  >;
  readonly shells: readonly OffsetFrameShellOutput[];
}

const sameBits = (first: SketchPoint2D, second: SketchPoint2D) =>
  Object.is(first[0], second[0]) && Object.is(first[1], second[1]);

/**
 * The source spans of a spline seed as occurrence pairs in source order (the
 * reconstruction's spans: a smooth closure wraps, open and positional do
 * not). Null for an invalid occurrence order.
 */
export function splineSourceSpanPairs(
  entity: Extract<SketchDefinition["entities"][number], { kind: "spline" }>,
): { start: string; end: string }[] | null {
  const order = entity.pointOccurrenceIds;
  if (new Set(order).size !== order.length || order.length < 2) return null;
  const count = entity.closure === "smooth" ? order.length : order.length - 1;
  return Array.from({ length: count }, (_, index) => ({
    start: order[index]!,
    end: order[(index + 1) % order.length]!,
  }));
}

/** The source occurrence key of one owner sub-span (its output span key). */
export const ownerSpanKey = (source: {
  readonly startOccurrenceId: string;
  readonly endOccurrenceId: string;
}) => `${source.startOccurrenceId}>${source.endOccurrenceId}`;

/**
 * The frame's local relationship shape from a persisted offset relationship
 * (g1 routed item): the distance, the seeds, and [TECH] G6 authored arc
 * presence by declared adjacency index (mapped through N2 traversal order).
 * Null when an authored joint arc names no adjacency of the declared chain
 * (a source change: `topologyChanged`).
 */
export function offsetFrameRelationshipOf(
  relationship: OffsetRelationshipDefinition,
  distance: number,
  definition: Pick<SketchDefinition, "points" | "entities" | "constraints">,
): OffsetFrameRelationship | null {
  const base = {
    derivationId: relationship.derivationId,
    seedEntityIds: relationship.seedEntityIds,
    distance,
  };
  if (relationship.jointOutputs.length === 0) return { ...base, arcJoints: [] };
  const connectivity = extractDeclaredOffsetChainConnectivity({
    definition,
    seedIds: relationship.seedEntityIds,
  });
  // A disconnected chain fails in the solve frame with its own diagnostic.
  if (!connectivity.ok) return { ...base, arcJoints: [] };
  const pieces = connectivity.pieces;
  const arcJoints: number[] = [];
  for (const joint of relationship.jointOutputs) {
    const index = pieces.findIndex(
      (piece, position) =>
        piece.seedEntityId === joint.firstSeedEntityId &&
        pieces[(position + 1) % pieces.length]!.seedEntityId ===
          joint.secondSeedEntityId &&
        (connectivity.closed || position < pieces.length - 1),
    );
    if (index < 0) return null;
    arcJoints.push(index);
  }
  return { ...base, arcJoints };
}

/**
 * Maps a solve frame onto the relationship's authored outputs. A string is a
 * `topologyChanged` reason: the authored records (kinds, shared corner
 * points, joint arcs, output spans) no longer fit the frame. Authored intent
 * is never rewritten here.
 */
export function mapOffsetFrameOutputs(
  relationship: OffsetRelationshipDefinition,
  frame: OffsetSolveFrame,
  entityKind: (entityId: SketchEntityId) => string | undefined,
): OffsetFrameOutputMap | string {
  const { pieces } = frame;
  const count = pieces.length;
  const closed = frame.connectivity.closed;
  const plan = frame.plan.adjacencies;
  const outputs = new Map(
    relationship.outputs.map((output) => [output.seedEntityId, output]),
  );
  const shells = new Map(
    relationship.piecewiseCubicOutputs.map((output) => [
      output.seedEntityId,
      output,
    ]),
  );
  const points = new Map<SketchPointId, OffsetFramePointDatum>();
  const entities = new Map<SketchEntityId, OffsetFrameEntityDatum>();
  const sweeps = new Map<SketchEntityId, "clockwise" | "counterClockwise">();
  const shellOutputs: OffsetFrameShellOutput[] = [];
  const naturalEnds: { start: SketchPointId; end: SketchPointId }[] = [];
  if (relationship.outputs.length + shells.size !== count)
    return "the authored outputs do not cover the chain's seeds.";

  const adjacencyAt = (index: number, end: "entry" | "exit") => {
    const joint =
      end === "exit" ? index : closed ? (index - 1 + count) % count : index - 1;
    return joint >= 0 && joint < plan.length ? joint : null;
  };
  const endDatum = (
    index: number,
    natural: "start" | "end",
  ): OffsetFramePointDatum => {
    const piece = pieces[index]!;
    const traversal = (natural === "end") !== piece.reversed ? "exit" : "entry";
    const joint = adjacencyAt(index, traversal);
    if (joint !== null && plan[joint]!.kind === "trim")
      return { kind: "trim", jointIndex: joint };
    if (piece.kind === "derivedCubic") {
      const leaves = frame.cubics.get(piece.seedEntityId)!;
      return natural === "start"
        ? { kind: "pole", seed: piece.seedEntityId, leaf: 0, pole: 0 }
        : {
            kind: "pole",
            seed: piece.seedEntityId,
            leaf: leaves.length - 1,
            pole: 3,
          };
    }
    return { kind: "lineArc", seed: piece.seedEntityId, end: natural };
  };
  const bind = (
    pointId: SketchPointId,
    datum: OffsetFramePointDatum,
  ): string | null => {
    const known = points.get(pointId);
    if (!known) {
      points.set(pointId, datum);
      return null;
    }
    return sameBits(
      offsetFramePointValue(frame, known),
      offsetFramePointValue(frame, datum),
    )
      ? null
      : `output point ${pointId} is not one shared published position.`;
  };

  for (const [index, piece] of pieces.entries()) {
    const seed = piece.seedEntityId;
    if (piece.kind === "derivedCubic") {
      const shell = shells.get(seed);
      if (
        !shell ||
        entityKind(shell.outputEntityId) !== "derivedPiecewiseCubic"
      )
        return `spline seed ${seed} has no derived shell output.`;
      const keys: string[] = [];
      for (const leaf of frame.cubics.get(seed)!) {
        const key = ownerSpanKey(leaf.span.source);
        if (keys.at(-1) !== key) keys.push(key);
      }
      const spanIds = new Map(
        shell.spans.map((span) => [
          `${span.sourceStartOccurrenceId}>${span.sourceEndOccurrenceId}`,
          span.outputSpanId,
        ]),
      );
      if (
        keys.length !== shell.spans.length ||
        keys.some(
          (key, position) =>
            ownerSpanKey({
              startOccurrenceId: shell.spans[position]!.sourceStartOccurrenceId,
              endOccurrenceId: shell.spans[position]!.sourceEndOccurrenceId,
            }) !== key,
        )
      )
        return `the source spans of seed ${seed} no longer match its shell's output spans.`;
      shellOutputs.push({ entityId: shell.outputEntityId, seed, spanIds });
      const failure =
        bind(shell.startPointId, endDatum(index, "start")) ??
        bind(shell.endPointId, endDatum(index, "end"));
      if (failure) return failure;
      naturalEnds.push({ start: shell.startPointId, end: shell.endPointId });
      continue;
    }
    const output = outputs.get(seed);
    if (
      !output ||
      entityKind(output.outputEntityId) !== pieceEntityKind(piece.kind)
    )
      return `seed ${seed} no longer matches its output entity kind.`;
    const ids = output.outputPointIds;
    if (piece.kind === "circle") {
      if (ids.length !== 1)
        return `output ${output.outputEntityId} has a stale point map.`;
      const failure = bind(ids[0]!, { kind: "circleCenter", seed });
      if (failure) return failure;
      entities.set(output.outputEntityId, { kind: "circle", seed });
      naturalEnds.push({ start: ids[0]!, end: ids[0]! });
      continue;
    }
    const [startId, endId] =
      piece.kind === "arc" ? [ids[1], ids[2]] : [ids[0], ids[1]];
    if (ids.length !== (piece.kind === "arc" ? 3 : 2) || !startId || !endId)
      return `output ${output.outputEntityId} has a stale point map.`;
    if (piece.kind === "arc") {
      const failure = bind(ids[0]!, { kind: "seedArcCenter", seed });
      if (failure) return failure;
      entities.set(output.outputEntityId, { kind: "seedArc", seed });
      sweeps.set(output.outputEntityId, piece.sweepDirection);
    }
    const failure =
      bind(startId, endDatum(index, "start")) ??
      bind(endId, endDatum(index, "end"));
    if (failure) return failure;
    naturalEnds.push({ start: startId, end: endId });
  }

  const traversalEnd = (index: number, end: "entry" | "exit") => {
    const ends = naturalEnds[index]!;
    return (end === "exit") !== pieces[index]!.reversed ? ends.end : ends.start;
  };
  const arcs = new Map(frame.arcs.map((arc) => [arc.jointIndex, arc]));
  for (const [joint, entry] of plan.entries()) {
    const next = (joint + 1) % count;
    const exitId = traversalEnd(joint, "exit");
    const entryId = traversalEnd(next, "entry");
    if (entry.kind !== "arc") {
      if (count > 1 && exitId !== entryId)
        return `adjacency ${joint} is not one shared output point.`;
      continue;
    }
    const arc = arcs.get(joint);
    const output = relationship.jointOutputs.find(
      (item) =>
        item.firstSeedEntityId === pieces[joint]!.seedEntityId &&
        item.secondSeedEntityId === pieces[next]!.seedEntityId,
    );
    if (
      !arc ||
      !output ||
      entityKind(output.outputEntityId) !== "arc" ||
      output.startPointId !== exitId ||
      output.endPointId !== entryId
    )
      return `joint arc ${joint} no longer matches its authored arc.`;
    const failure = bind(output.centerPointId, {
      kind: "arcCenter",
      jointIndex: joint,
    });
    if (failure) return failure;
    entities.set(output.outputEntityId, {
      kind: "jointArc",
      jointIndex: joint,
    });
    sweeps.set(output.outputEntityId, arc.sweepDirection);
  }
  return { points, entities, sweeps, shells: shellOutputs };
}

function pieceEntityKind(kind: OffsetSolveFrame["pieces"][number]["kind"]) {
  return kind === "derivedCubic" ? "derivedPiecewiseCubic" : kind;
}

/** The published value of one point datum. */
export function offsetFramePointValue(
  frame: OffsetSolveFrame,
  datum: OffsetFramePointDatum,
): SketchPoint2D {
  switch (datum.kind) {
    case "lineArc":
      return frame.lineArcEndpoints.get(datum.seed)![datum.end];
    case "seedArcCenter":
    case "circleCenter": {
      const piece = frame.pieces.find(
        (item) => item.seedEntityId === datum.seed,
      );
      if (piece?.kind !== "arc" && piece?.kind !== "circle")
        throw new RangeError(`Offset seed ${datum.seed} has no centre.`);
      return piece.center;
    }
    case "trim":
      return frame.trims.find((trim) => trim.jointIndex === datum.jointIndex)!
        .position;
    case "pole":
      return frame.cubics.get(datum.seed)![datum.leaf]!.span.poles[datum.pole];
    case "arcCenter":
      return frame.arcs.find((arc) => arc.jointIndex === datum.jointIndex)!
        .center;
  }
}

/** The circle radius of one circle-output datum. */
export function offsetFrameCircleRadius(
  frame: OffsetSolveFrame,
  seed: SketchEntityId,
) {
  const piece = frame.pieces.find((item) => item.seedEntityId === seed);
  if (piece?.kind !== "circle")
    throw new RangeError(`Offset seed ${seed} is not a circle.`);
  return piece.radius;
}

/** The fixed-topology JVP of one point datum. */
export function offsetFramePointJvp(
  jvp: OffsetFrameJvp,
  datum: OffsetFramePointDatum,
): SketchPoint2D {
  switch (datum.kind) {
    case "lineArc":
      return jvp.lineArcEndpoints.get(datum.seed)![datum.end];
    case "seedArcCenter":
      return jvp.seedArcs.get(datum.seed)!.center;
    case "circleCenter":
      return jvp.circles.get(datum.seed)!.center;
    case "trim":
      return jvp.trims.find((trim) => trim.jointIndex === datum.jointIndex)!
        .position;
    case "pole":
      return jvp.cubics.get(datum.seed)![datum.leaf]!.poles[datum.pole];
    case "arcCenter":
      return jvp.arcs.find((arc) => arc.jointIndex === datum.jointIndex)!
        .center;
  }
}

/** The JVP of one entity datum: circle radius, or an arc's radius and end angles. */
export function offsetFrameEntityJvp(
  jvp: OffsetFrameJvp,
  datum: OffsetFrameEntityDatum,
):
  | { kind: "circle"; radius: number }
  | { kind: "arc"; radius: number; startAngle: number; endAngle: number } {
  if (datum.kind === "circle")
    return { kind: "circle", radius: jvp.circles.get(datum.seed)!.radius };
  const arc: OffsetFrameArcVariation =
    datum.kind === "seedArc"
      ? jvp.seedArcs.get(datum.seed)!
      : jvp.arcs.find((item) => item.jointIndex === datum.jointIndex)!;
  return {
    kind: "arc",
    radius: arc.radius,
    startAngle: arc.startAngle,
    endAngle: arc.endAngle,
  };
}

const zeroPoles = (): [
  SketchPoint2D,
  SketchPoint2D,
  SketchPoint2D,
  SketchPoint2D,
] => [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];

/** The frame cotangent that pairs `value` with one point datum (its pullback seed). */
export function offsetFramePointCotangent(
  datum: OffsetFramePointDatum,
  value: SketchPoint2D,
): OffsetFrameCotangent {
  switch (datum.kind) {
    case "lineArc":
      return {
        lineArcEndpoints: new Map([[datum.seed, { [datum.end]: value }]]),
      };
    case "seedArcCenter":
      return { seedArcs: new Map([[datum.seed, { center: value }]]) };
    case "circleCenter":
      return { circles: new Map([[datum.seed, { center: value }]]) };
    case "trim":
      return { trims: [{ jointIndex: datum.jointIndex, position: value }] };
    case "pole": {
      const poles = zeroPoles();
      poles[datum.pole] = value;
      const leaves: { poles: SplinePoles }[] = [];
      leaves[datum.leaf] = { poles };
      return { cubics: new Map([[datum.seed, leaves]]) };
    }
    case "arcCenter":
      return { arcs: [{ jointIndex: datum.jointIndex, center: value }] };
  }
}

/** The frame cotangent that pairs an entity-state cotangent with one entity datum. */
export function offsetFrameEntityCotangent(
  datum: OffsetFrameEntityDatum,
  value:
    | { kind: "circle"; radius: number }
    | { kind: "arc"; radius: number; startAngle: number; endAngle: number },
): OffsetFrameCotangent | null {
  if (datum.kind === "circle")
    return value.kind === "circle"
      ? { circles: new Map([[datum.seed, { radius: value.radius }]]) }
      : null;
  if (value.kind !== "arc") return null;
  const arc = {
    radius: value.radius,
    startAngle: value.startAngle,
    endAngle: value.endAngle,
  };
  return datum.kind === "seedArc"
    ? { seedArcs: new Map([[datum.seed, arc]]) }
    : { arcs: [{ jointIndex: datum.jointIndex, ...arc }] };
}

/**
 * The solved sub-spans of one shell from its frame (T08b slice design §2.2):
 * the owner's poles unchanged, `queryDomain` the representative active
 * domain, the output span id by source occurrence key.
 */
export function offsetFrameShellSpans(
  frame: OffsetSolveFrame,
  shell: OffsetFrameShellOutput,
): SolvedSketchDerivedCubicSpan[] {
  let subIndex = 0;
  let previous: string | null = null;
  return frame.cubics.get(shell.seed)!.map((leaf) => {
    const key = ownerSpanKey(leaf.span.source);
    subIndex = key === previous ? subIndex + 1 : 0;
    previous = key;
    return {
      outputSpanId: shell.spanIds.get(key)!,
      subIndex,
      sourceLocalInterval: [...leaf.span.sourceLocalInterval],
      sourceDomain: [...leaf.sourceDomain],
      queryDomain: [...leaf.representativeQueryDomain],
      poles: leaf.span.poles,
      certifiedError: leaf.span.certifiedError,
    };
  });
}
