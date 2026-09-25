import type {
  ConstraintDefinition,
  SketchDefinition,
  SketchEntityDefinition,
} from "@/contracts/sketch/schema";
import { orderedSplinePointIds } from "@/contracts/sketch/spline-geometry";
import type {
  ConstraintId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";

/** A seed curve in declared traversal order. No geometry is consulted. */
export interface OffsetChainTraversalPiece {
  readonly seedEntityId: SketchEntityId;
  readonly reversed: boolean;
}

/**
 * Authored authority for one adjacency. Coincident point IDs remain distinct;
 * this records the residual constraint rather than merging their identities.
 */
export type DeclaredOffsetChainJoin =
  | {
      readonly kind: "sharedPoint";
      readonly pointId: SketchPointId;
    }
  | {
      readonly kind: "coincidentConstraint";
      readonly constraintId: ConstraintId;
      readonly pointIds: readonly [SketchPointId, SketchPointId];
    };

export interface DeclaredOffsetChainConnectivity {
  readonly ok: true;
  readonly closed: boolean;
  readonly pieces: readonly OffsetChainTraversalPiece[];
  /** In traversal order; the final entry is the wrap only for multi-piece loops. */
  readonly joins: readonly DeclaredOffsetChainJoin[];
}

export type DeclaredOffsetChainDiagnosticCode =
  | "degree>2"
  | "disconnected"
  | "multipleDeclarations"
  | "missingConstraint"
  | "unsupportedSeed";

export interface DeclaredOffsetChainConnectivityFailure {
  readonly ok: false;
  readonly code: DeclaredOffsetChainDiagnosticCode;
  readonly message: string;
  readonly seedEntityId: SketchEntityId | null;
}

export type DeclaredOffsetChainConnectivityResult =
  | DeclaredOffsetChainConnectivity
  | DeclaredOffsetChainConnectivityFailure;

interface Terminal {
  readonly pieceIndex: number;
  readonly end: "start" | "end";
  readonly pointId: SketchPointId;
}

interface SeedShape {
  readonly entity: SketchEntityDefinition;
  readonly terminals: readonly [SketchPointId, SketchPointId] | null;
  readonly pointIncidences: readonly SketchPointId[];
  readonly pointIds: readonly SketchPointId[];
  readonly closed: boolean;
  readonly intrinsicClosurePointIds:
    | readonly [SketchPointId, SketchPointId]
    | null;
}

const failure = (
  code: DeclaredOffsetChainDiagnosticCode,
  message: string,
  seedEntityId: SketchEntityId | null = null,
): DeclaredOffsetChainConnectivityFailure => ({
  ok: false,
  code,
  message,
  seedEntityId,
});

function seedShape(entity: SketchEntityDefinition): SeedShape | null {
  switch (entity.kind) {
    case "lineSegment":
    case "arc":
      return {
        entity,
        terminals: [entity.startPointId, entity.endPointId],
        pointIncidences: [entity.startPointId, entity.endPointId],
        pointIds: [entity.startPointId, entity.endPointId],
        closed: false,
        intrinsicClosurePointIds: null,
      };
    case "spline": {
      const pointIds = orderedSplinePointIds(
        entity,
      ) as readonly SketchPointId[];
      if (pointIds.length < 2) return null;
      const closed = entity.closure !== "open";
      return {
        entity,
        terminals: closed ? null : [pointIds[0]!, pointIds.at(-1)!],
        pointIncidences: closed
          ? (entity.closure === "positional" && pointIds[0] === pointIds.at(-1)
              ? pointIds.slice(0, -1)
              : pointIds
            ).flatMap((pointId) => [pointId, pointId])
          : pointIds.flatMap((pointId, index) =>
              index === 0 || index === pointIds.length - 1
                ? [pointId]
                : [pointId, pointId],
            ),
        pointIds,
        closed,
        intrinsicClosurePointIds:
          entity.closure === "positional"
            ? [pointIds[0]!, pointIds.at(-1)!]
            : null,
      };
    }
    case "circle":
      return {
        entity,
        terminals: null,
        pointIncidences: [],
        pointIds: [entity.centerPointId],
        closed: true,
        intrinsicClosurePointIds: null,
      };
    default:
      return null;
  }
}

function coincidentConstraints(
  definition: Pick<SketchDefinition, "constraints" | "points">,
) {
  return definition.constraints.filter(
    (
      constraint,
    ): constraint is Extract<ConstraintDefinition, { kind: "coincident" }> =>
      constraint.kind === "coincident",
  );
}

/**
 * Extracts the declared, terminal-only connectivity of selected offset seeds.
 *
 * Coincidence is deliberately direct: a terminal may participate in one
 * declaration only. Therefore transitive/redundant coincident constraints fail
 * with `multipleDeclarations`; the extractor neither discards declarations nor
 * aliases authored point IDs. Spline fit points in the interior count as two
 * incidences, so attaching a further seed there fails with `degree>2` rather
 * than inventing a split span.
 */
export function extractDeclaredOffsetChainConnectivity(input: {
  readonly definition: Pick<
    SketchDefinition,
    "entities" | "constraints" | "points"
  >;
  readonly seedIds: readonly SketchEntityId[];
}): DeclaredOffsetChainConnectivityResult {
  if (input.seedIds.length === 0) {
    return failure("disconnected", "Offset needs at least one seed segment.");
  }

  const seeds: SeedShape[] = [];
  const seenSeedIds = new Set<SketchEntityId>();
  for (const seedId of input.seedIds) {
    if (seenSeedIds.has(seedId)) {
      return failure(
        "multipleDeclarations",
        "Offset seed IDs must be selected at most once.",
        seedId,
      );
    }
    seenSeedIds.add(seedId);
    const entity = input.definition.entities.find(
      (candidate) => candidate.entityId === seedId,
    );
    const shape = entity && seedShape(entity);
    if (!shape) {
      return failure(
        "unsupportedSeed",
        "Offset seed is missing or has no declared terminal endpoints.",
        seedId,
      );
    }
    seeds.push(shape);
  }

  const knownPointIds = new Set(
    input.definition.points.map((point) => point.pointId),
  );
  for (const seed of seeds) {
    const missingPointId = seed.pointIds.find(
      (pointId) => !knownPointIds.has(pointId),
    );
    if (missingPointId !== undefined) {
      return failure(
        "unsupportedSeed",
        `Offset seed references missing point ${missingPointId}.`,
        seed.entity.entityId,
      );
    }
    if (
      (seed.entity.kind === "lineSegment" || seed.entity.kind === "arc") &&
      seed.terminals![0] === seed.terminals![1]
    ) {
      return failure(
        "unsupportedSeed",
        "Offset seed has identical declared terminal point IDs.",
        seed.entity.entityId,
      );
    }
  }

  if (seeds.some((seed) => seed.entity.kind === "circle")) {
    return seeds.length === 1
      ? {
          ok: true,
          closed: true,
          pieces: [{ seedEntityId: input.seedIds[0]!, reversed: false }],
          joins: [],
        }
      : failure(
          "disconnected",
          "A circle cannot join an offset chain with other segments.",
          seeds.find((seed) => seed.entity.kind === "circle")!.entity.entityId,
        );
  }

  const incidences = new Map<SketchPointId, number>();
  for (const seed of seeds) {
    for (const pointId of seed.pointIncidences) {
      incidences.set(pointId, (incidences.get(pointId) ?? 0) + 1);
    }
  }
  for (const [pointId, degree] of incidences) {
    if (degree > 2) {
      return failure(
        "degree>2",
        `Declared point ${pointId} has ${degree} selected seed incidences.`,
      );
    }
  }

  const constraints = coincidentConstraints(input.definition);
  const isIntrinsicPositionalClosure = (
    first: SketchPointId,
    second: SketchPointId,
  ) =>
    seeds.some((seed) => {
      const closure = seed.intrinsicClosurePointIds;
      return (
        closure !== null &&
        ((closure[0] === first && closure[1] === second) ||
          (closure[0] === second && closure[1] === first))
      );
    });
  for (const constraint of constraints) {
    const [first, second] = constraint.pointIds;
    const touchesSelected = incidences.has(first) || incidences.has(second);
    if (
      touchesSelected &&
      (!knownPointIds.has(first) || !knownPointIds.has(second))
    ) {
      return failure(
        "missingConstraint",
        `Coincident constraint ${constraint.constraintId} references a missing point.`,
      );
    }
    if (!touchesSelected) continue;
    if (first === second) {
      return failure(
        "multipleDeclarations",
        `Coincident constraint ${constraint.constraintId} repeats one declared point.`,
      );
    }
    if (
      !isIntrinsicPositionalClosure(first, second) &&
      (incidences.get(first) ?? 0) + (incidences.get(second) ?? 0) > 2
    ) {
      return failure(
        "degree>2",
        `Coincident constraint ${constraint.constraintId} creates more than two selected seed incidences.`,
      );
    }
  }
  // This only diagnoses ambiguous paths through unselected points. It never
  // creates a join or aliases point IDs: direct selected-terminal constraints
  // are still the sole accepted coincidence joins.
  const parent = new Map<SketchPointId, SketchPointId>();
  const root = (pointId: SketchPointId): SketchPointId => {
    let current = pointId;
    while (parent.has(current)) current = parent.get(current)!;
    return current;
  };
  for (const {
    pointIds: [first, second],
  } of constraints) {
    if (incidences.has(first) || incidences.has(second)) continue;
    const [left, right] = [root(first), root(second)];
    if (left !== right) parent.set(left, right);
  }
  const componentTouches = new Map<SketchPointId, number>();
  for (const {
    pointIds: [first, second],
  } of constraints) {
    for (const [selected, other] of [
      [first, second],
      [second, first],
    ] as const) {
      if (!incidences.has(selected) || incidences.has(other)) continue;
      const pointId = root(other);
      componentTouches.set(pointId, (componentTouches.get(pointId) ?? 0) + 1);
    }
  }
  for (const [pointId, count] of componentTouches) {
    if (count > 1) {
      return failure(
        "multipleDeclarations",
        `Declared point ${pointId} participates in multiple coincidence paths.`,
      );
    }
  }

  const closedSeed = seeds.find((seed) => seed.closed);
  if (closedSeed) {
    return seeds.length === 1
      ? {
          ok: true,
          closed: true,
          pieces: [{ seedEntityId: input.seedIds[0]!, reversed: false }],
          joins: [],
        }
      : failure(
          "disconnected",
          "A closed offset seed cannot join other selected segments.",
          closedSeed.entity.entityId,
        );
  }

  const terminals: Terminal[] = seeds.flatMap((seed, pieceIndex) => {
    const [startPointId, endPointId] = seed.terminals!;
    return [
      { pieceIndex, end: "start" as const, pointId: startPointId },
      { pieceIndex, end: "end" as const, pointId: endPointId },
    ];
  });
  const terminalsByPoint = new Map<SketchPointId, Terminal[]>();
  for (const terminal of terminals) {
    const entries = terminalsByPoint.get(terminal.pointId) ?? [];
    entries.push(terminal);
    terminalsByPoint.set(terminal.pointId, entries);
  }

  const declarations = new Map<Terminal, DeclaredOffsetChainJoin>();
  const declare = (
    first: Terminal,
    second: Terminal,
    join: DeclaredOffsetChainJoin,
  ): DeclaredOffsetChainConnectivityFailure | null => {
    if (first.pieceIndex === second.pieceIndex) {
      return failure(
        "unsupportedSeed",
        "An open offset seed declares a join with itself.",
        input.seedIds[first.pieceIndex]!,
      );
    }
    if (declarations.has(first) || declarations.has(second)) {
      return failure(
        "multipleDeclarations",
        "A selected terminal has multiple authored join declarations.",
        input.seedIds[first.pieceIndex]!,
      );
    }
    declarations.set(first, join);
    declarations.set(second, join);
    return null;
  };

  for (const [pointId, matching] of terminalsByPoint) {
    if (matching.length > 2) {
      return failure(
        "degree>2",
        `Declared point ${pointId} has too many terminals.`,
      );
    }
    if (matching.length === 2) {
      const issue = declare(matching[0]!, matching[1]!, {
        kind: "sharedPoint",
        pointId,
      });
      if (issue) return issue;
    }
  }
  for (const constraint of constraints) {
    const [firstPointId, secondPointId] = constraint.pointIds;
    for (const first of terminalsByPoint.get(firstPointId) ?? []) {
      for (const second of terminalsByPoint.get(secondPointId) ?? []) {
        const issue = declare(first, second, {
          kind: "coincidentConstraint",
          constraintId: constraint.constraintId,
          pointIds: [firstPointId, secondPointId],
        });
        if (issue) return issue;
      }
    }
  }

  const neighbor = (terminal: Terminal) => {
    const join = declarations.get(terminal);
    if (!join) return null;
    return (
      terminals.find(
        (candidate) =>
          candidate !== terminal && declarations.get(candidate) === join,
      ) ?? null
    );
  };
  const terminalAt = (pieceIndex: number, end: Terminal["end"]) =>
    terminals.find(
      (terminal) => terminal.pieceIndex === pieceIndex && terminal.end === end,
    )!;

  const firstPiece = 0;
  const firstStart = terminalAt(firstPiece, "start");
  const firstEnd = terminalAt(firstPiece, "end");
  const isClosed = terminals.every((terminal) => Boolean(neighbor(terminal)));
  if (
    !isClosed &&
    terminals.filter((terminal) => !neighbor(terminal)).length !== 2
  ) {
    return failure(
      "disconnected",
      "Offset selection must form a single connected chain.",
    );
  }

  // Match legacy buildTraversal's seed-order policy: start at seedIds[0] in
  // natural orientation, then prepend any path found behind its start.
  const pieces: OffsetChainTraversalPiece[] = [];
  const joins: DeclaredOffsetChainJoin[] = [];
  const used = new Set<number>();
  let current = { pieceIndex: firstPiece, reversed: false, exit: firstEnd };
  for (;;) {
    used.add(current.pieceIndex);
    pieces.push({
      seedEntityId: input.seedIds[current.pieceIndex]!,
      reversed: current.reversed,
    });
    const nextTerminal = neighbor(current.exit);
    if (!nextTerminal) break;
    const join = declarations.get(current.exit)!;
    if (used.has(nextTerminal.pieceIndex)) {
      if (
        isClosed &&
        nextTerminal.pieceIndex === firstPiece &&
        used.size === seeds.length
      ) {
        joins.push(join);
        break;
      }
      return failure(
        "disconnected",
        "Offset selection revisits a seed before completing its chain.",
      );
    }
    joins.push(join);
    current = {
      pieceIndex: nextTerminal.pieceIndex,
      reversed: nextTerminal.end === "end",
      exit: terminalAt(
        nextTerminal.pieceIndex,
        nextTerminal.end === "start" ? "end" : "start",
      ),
    };
  }

  if (!isClosed) {
    let cursor = firstStart;
    for (;;) {
      const previous = neighbor(cursor);
      if (!previous) break;
      if (used.has(previous.pieceIndex)) {
        return failure(
          "disconnected",
          "Offset selection revisits a seed before completing its chain.",
        );
      }
      used.add(previous.pieceIndex);
      pieces.unshift({
        seedEntityId: input.seedIds[previous.pieceIndex]!,
        reversed: previous.end === "start",
      });
      joins.unshift(declarations.get(cursor)!);
      cursor = terminalAt(
        previous.pieceIndex,
        previous.end === "start" ? "end" : "start",
      );
    }
  }

  if (
    used.size !== seeds.length ||
    (!isClosed && joins.length !== pieces.length - 1)
  ) {
    return failure(
      "disconnected",
      "Offset selection must form a single connected chain.",
    );
  }
  return { ok: true, closed: isClosed, pieces, joins };
}
