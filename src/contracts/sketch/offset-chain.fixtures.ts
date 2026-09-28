/**
 * Spec support for `offset-chain-topology.spec.ts`: the native offset-chain
 * harness (native line/spline tool commit + endpoint-snap inference → solve →
 * N2 connectivity → fresh adapter → resolver) and the §1.5 native corner-matrix
 * rows. Every chain is built only by native tools. Contracts may not import
 * implementation layers (static guard), so the spec injects the native tool
 * authoring seam and the real kernel-free whole-request query.
 */
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import { extractDeclaredOffsetChainConnectivity } from "@/contracts/sketch/offset-chain-connectivity";
import {
  declaredOffsetChainPieces,
  resolveOffsetChainTopology,
  type CertifiedNeutralCurveRequestQuery,
} from "@/contracts/sketch/offset-chain-topology";
import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";

export type Vector = readonly [number, number];
/** One native tool commit contribution (after snap inference). */
export interface Authored {
  readonly points: SketchDefinition["points"];
  readonly entities: SketchDefinition["entities"];
  readonly constraints?: SketchDefinition["constraints"];
}

export interface EndpointSnaps {
  readonly start?: SketchPointId;
  readonly end?: SketchPointId;
}

/**
 * The native authoring seam: the line/spline tools' commit contribution plus
 * the session's endpoint-snap inference, for one commit sequence number.
 */
export interface NativeToolAuthoring {
  line(input: {
    readonly previousDefinition: SketchDefinition;
    readonly sequence: number;
    readonly start: Vector;
    readonly end: Vector;
    readonly snaps: EndpointSnaps;
  }): Authored;
  spline(input: {
    readonly previousDefinition: SketchDefinition;
    readonly sequence: number;
    readonly points: readonly Vector[];
    readonly snaps: EndpointSnaps;
  }): Authored;
}

export interface AcceptedPair {
  readonly definition: SketchDefinition;
  readonly solvedSnapshot: SolvedSketchSnapshot;
}

/** The three-fit-point arch used by the native rows. */
export const ARCH_POINTS: readonly Vector[] = [
  [0, 0],
  [1, 0.1],
  [2, 0],
];

/** Solver tolerances of the spec's native chains (editor coincidence). */
export const NATIVE_SOLVE_TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
};

/** Solver tolerances of the T08b design's corner-matrix probe (§1.5). */
export const CORNER_MATRIX_SOLVE_TOLERANCES = {
  coincidence: 1e-3,
  angleRadians: 1e-4,
  minimumSegmentLength: 1e-6,
};

export function createNativeOffsetChainHarness(options: {
  readonly authoring: NativeToolAuthoring;
  /** The resolver's default query (the real kernel-free request query). */
  readonly query: CertifiedNeutralCurveRequestQuery;
  readonly modelingTolerance: number;
  readonly solveTolerances?: typeof NATIVE_SOLVE_TOLERANCES;
}) {
  const { authoring, modelingTolerance } = options;
  const solveTolerances = options.solveTolerances ?? NATIVE_SOLVE_TOLERANCES;
  let sequence = 0;
  /** Full authored definition of native commit contributions. */
  const sketch = (patches: readonly Authored[]): SketchDefinition => {
    const points = patches.flatMap((patch) => patch.points);
    const entities = patches.flatMap((patch) => patch.entities);
    const constraints = patches.flatMap((patch) => patch.constraints ?? []);
    return {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: [],
      dimensions: [],
    } as SketchDefinition;
  };
  const drawLine = (
    previous: readonly Authored[],
    start: Vector,
    end: Vector,
    snaps: EndpointSnaps = {},
  ) => {
    sequence += 1;
    return authoring.line({
      previousDefinition: sketch(previous),
      sequence,
      start,
      end,
      snaps,
    });
  };
  const drawSpline = (
    previous: readonly Authored[],
    points: readonly Vector[],
    snaps: EndpointSnaps = {},
  ) => {
    sequence += 1;
    return authoring.spline({
      previousDefinition: sketch(previous),
      sequence,
      points,
      snaps,
    });
  };
  const lineEnds = (patch: Authored) => {
    const entity = patch.entities[0]!;
    if (entity.kind !== "lineSegment") throw new Error("not a line");
    return [entity.startPointId, entity.endPointId] as const;
  };
  const splineEnds = (patch: Authored) => {
    const entity = patch.entities[0]!;
    if (entity.kind !== "spline") throw new Error("not a spline");
    return [
      entity.pointOccurrences[0]!.pointId,
      entity.pointOccurrences.at(-1)!.pointId,
    ] as const;
  };

  /** One accepted (definition, solvedSnapshot) pair → N2 → fresh adapter → N1 resolver. */
  const pairChain = (
    pair: AcceptedPair,
    distance: number,
    seedIds: readonly SketchEntityId[] = pair.definition.entities.map(
      (entity) => entity.entityId,
    ),
    query: CertifiedNeutralCurveRequestQuery = options.query,
  ) => {
    const connectivity = extractDeclaredOffsetChainConnectivity({
      definition: pair.definition,
      seedIds,
    });
    if (!connectivity.ok) throw new Error(connectivity.message);
    const adapt = () => {
      const declared = declaredOffsetChainPieces({
        definition: pair.definition,
        solvedSnapshot: pair.solvedSnapshot,
        connectivity,
        distance,
        modelingTolerance,
      });
      if (!declared.ok) throw new Error(declared.message);
      return declared;
    };
    const declared = adapt();
    const resolution = resolveOffsetChainTopology({
      pieces: declared.pieces,
      closed: connectivity.closed,
      modelingTolerance,
      query,
    });
    return { connectivity, declared, resolution, adapt, pair };
  };

  /** Native commit → solve (must be solved) → the accepted pair. */
  const solvedPair = (patches: readonly Authored[]): AcceptedPair => {
    const definition = sketch(patches);
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: solveTolerances,
      partialSolvePolicy: "bestEffort",
    });
    if (solved.status.solveState !== "solved")
      throw new Error(`native chain solve is ${solved.status.solveState}`);
    const positions = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    return {
      definition: {
        ...definition,
        points: definition.points.map((point) => ({
          ...point,
          position: positions.get(point.pointId)!,
        })),
      },
      solvedSnapshot: solved.solvedSnapshot,
    };
  };

  /** commit → solve → N2 → fresh adapter → N1 resolver (real query by default). */
  const nativeChain = (
    patches: readonly Authored[],
    distance: number,
    options: {
      readonly seedIds?: readonly SketchEntityId[];
      readonly query?: CertifiedNeutralCurveRequestQuery;
    } = {},
  ) => {
    const pair = solvedPair(patches);
    return pairChain(pair, distance, options.seedIds, options.query);
  };

  const accepted = (chain: ReturnType<typeof nativeChain>) => {
    if (!chain.resolution.ok)
      throw new Error(`${chain.resolution.code}: ${chain.resolution.message}`);
    return chain.resolution;
  };

  return {
    sketch,
    drawLine,
    drawSpline,
    lineEnds,
    splineEnds,
    pairChain,
    nativeChain,
    accepted,
    /** Advances the shared native commit sequence (constraint tool commits). */
    nextSequence: () => (sequence += 1),
    resetSequence: () => {
      sequence = 0;
    },
  };
}

export type NativeOffsetChainHarness = ReturnType<
  typeof createNativeOffsetChainHarness
>;

export interface CornerMatrixRow {
  readonly row: string;
  readonly distance: number;
  readonly build: (harness: NativeOffsetChainHarness) => readonly Authored[];
}

/**
 * The T08b design §1.5 native corner matrix (τ = 1e-3), one entry per
 * (row, d), built exactly as the design probe builds it.
 */
export function cornerMatrixRows(): readonly CornerMatrixRow[] {
  const rows: CornerMatrixRow[] = [];
  const add = (
    row: string,
    build: CornerMatrixRow["build"],
    distances: readonly number[],
  ) => {
    for (const distance of distances) rows.push({ row, distance, build });
  };
  const splineThenLine =
    (end: Vector): CornerMatrixRow["build"] =>
    (h) => {
      const spline = h.drawSpline([], ARCH_POINTS);
      const [, splineEnd] = h.splineEnds(spline);
      return [spline, h.drawLine([spline], [2, 0], end, { start: splineEnd })];
    };
  const splineThenSpline =
    (points: readonly Vector[]): CornerMatrixRow["build"] =>
    (h) => {
      const first = h.drawSpline([], ARCH_POINTS);
      const [, firstEnd] = h.splineEnds(first);
      return [first, h.drawSpline([first], points, { start: firstEnd })];
    };
  add("S1", (h) => [h.drawSpline([], ARCH_POINTS)], [0.01, -0.01, 0.2]);
  add(
    "S1b",
    (h) => [
      h.drawSpline(
        [],
        [
          [0, 0],
          [1, 0.4],
          [2, -0.2],
          [3, 0.3],
          [4, 0],
        ],
      ),
    ],
    [0.01, -0.05],
  );
  add("SL-90", splineThenLine([2, 1]), [0.01, -0.01, 0.2, -0.2, 0.5]);
  add("SL-shallow", splineThenLine([3, -0.25]), [0.01, -0.01]);
  add("SL-tiny", splineThenLine([3, -0.1]), [0.01, -0.01]);
  add(
    "LS-90",
    (h) => {
      const line = h.drawLine([], [-1, 1], [0, 0]);
      const [, lineEnd] = h.lineEnds(line);
      return [line, h.drawSpline([line], ARCH_POINTS, { start: lineEnd })];
    },
    [0.01, -0.01],
  );
  add(
    "SS-60",
    splineThenSpline([
      [2, 0],
      [2.5, 0.7],
      [3, 1.6],
    ]),
    [0.01, -0.01, 0.2],
  );
  add(
    "SS-tiny",
    splineThenSpline([
      [2, 0],
      [3, -0.1],
      [4, -0.2],
    ]),
    [0.01, -0.01],
  );
  add(
    "LL-90",
    (h) => {
      const a = h.drawLine([], [0, 0], [1, 0]);
      const [, end] = h.lineEnds(a);
      return [a, h.drawLine([a], [1, 0], [1, 1], { start: end })];
    },
    [0.01, -0.01],
  );
  add(
    "SL-loop",
    (h) => {
      const spline = h.drawSpline(
        [],
        [
          [0, 0],
          [1, 0.6],
          [2, 0],
        ],
      );
      const [start, end] = h.splineEnds(spline);
      return [
        spline,
        h.drawLine([spline], [2, 0], [0, 0], { start: end, end: start }),
      ];
    },
    [0.01, -0.01],
  );
  add(
    "S2pt",
    (h) => [
      h.drawSpline(
        [],
        [
          [0, 0],
          [1, 0],
        ],
      ),
    ],
    [0.01],
  );
  return rows;
}
