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
      schemaVersion: "sketch-definition/v1alpha2",
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
      modelingTolerance,
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
    /** Native commit → solve (must be solved) → the accepted pair only (T08b-g1 frame rows). */
    solvedPair,
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
 * The S2 design §7 native spline→spline rows (τ = 1e-3), built exactly as the
 * design probe builds them: `C` draws the second spline from the arch's end
 * (endpoint snap ⇒ a direct coincidence between distinct IDs) at a left turn
 * φ; `R` authors the arch backwards so its START is the join (the first piece
 * is traversed reversed). Rows are labelled `C φ=<φ to 3 places>` / `R φ=<φ>`.
 */
function archOutgoing(phi: number): readonly Vector[] {
  const rotate = (vector: Vector, angle: number): Vector => [
    vector[0] * Math.cos(angle) - vector[1] * Math.sin(angle),
    vector[0] * Math.sin(angle) + vector[1] * Math.cos(angle),
  ];
  const length = Math.hypot(1, -0.1);
  const archEnd: Vector = [1 / length, -0.1 / length];
  const first = rotate(archEnd, phi);
  const second = rotate(archEnd, phi + 0.05);
  return [
    [2, 0],
    [2 + first[0], first[1]],
    [2 + first[0] + second[0], first[1] + second[1]],
  ];
}

export function splineSplineCornerRows(): readonly CornerMatrixRow[] {
  const outgoing = archOutgoing;
  const rows: CornerMatrixRow[] = [];
  for (const phi of [Math.PI / 2, 0.5, 0.2, 0.1, 0.05])
    for (const distance of [0.01, 0.2])
      rows.push({
        row: `C φ=${phi.toFixed(3)}`,
        distance,
        build: (h) => {
          const first = h.drawSpline([], ARCH_POINTS);
          const [, end] = h.splineEnds(first);
          return [first, h.drawSpline([first], outgoing(phi), { start: end })];
        },
      });
  for (const phi of [0.5, 0.2])
    for (const distance of [-0.01, -0.2, 0.01, 0.2])
      rows.push({
        row: `R φ=${phi}`,
        distance,
        build: (h) => {
          const first = h.drawSpline([], [...ARCH_POINTS].reverse());
          const [start] = h.splineEnds(first);
          return [first, h.drawSpline([first], outgoing(phi), { start })];
        },
      });
  return rows;
}

/**
 * The S2 design §7 native `B` rows (τ = 1e-3), built exactly as the design
 * probe builds them: a line drawn from the arch's end (shared point ID) at a
 * shallow left turn φ from the arch's end chord, concave for d > 0. They are
 * Lemma-T (line↔cubic) trims. Rows are labelled `B φ=<φ>`.
 */
export function splineLineShallowRows(): readonly CornerMatrixRow[] {
  const rotate = (vector: Vector, angle: number): Vector => [
    vector[0] * Math.cos(angle) - vector[1] * Math.sin(angle),
    vector[0] * Math.sin(angle) + vector[1] * Math.cos(angle),
  ];
  const length = Math.hypot(1, -0.1);
  const archEnd: Vector = [1 / length, -0.1 / length];
  const rows: CornerMatrixRow[] = [];
  for (const phi of [0.5, 0.2, 0.1, 0.05, 0.02])
    for (const distance of [0.01, 0.2])
      rows.push({
        row: `B φ=${phi}`,
        distance,
        build: (h) => {
          const spline = h.drawSpline([], ARCH_POINTS);
          const [, end] = h.splineEnds(spline);
          const direction = rotate(archEnd, phi);
          return [
            spline,
            h.drawLine([spline], [2, 0], [2 + direction[0], direction[1]], {
              start: end,
            }),
          ];
        },
      });
  return rows;
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

/**
 * The T08b-e convex arc rows on the corner-matrix harness (τ = 1e-3): the
 * §1.5 convex corners LS-90, SS-60 and LL-90 at d = −0.2 (SL-90 −0.2 is
 * already a matrix row), built exactly as the design probe builds them.
 */
export function convexArcMatrixRows(): readonly CornerMatrixRow[] {
  return cornerMatrixRows()
    .filter(
      (row) =>
        ["LS-90", "SS-60", "LL-90"].includes(row.row) && row.distance === -0.01,
    )
    .map((row) => ({ ...row, distance: -0.2 }));
}

/**
 * The T08b-e convex rows on the editor-tolerance harness (τ = 1e-3), built
 * exactly as the T08b-d / T08b-e probes build them: the arch-then-spline
 * `C φ` corners at d = −0.01 (φ = 0.1: sub-τ but absorption infeasible, so
 * U-E takes the arc; φ = 0.005: absorbed, its arc too short for K3), and the
 * nearly straight line↔line `LL-phi1e-12` (a 1e-14 arc, absorbed under U-E).
 */
export function convexArcNativeRows(): readonly CornerMatrixRow[] {
  const archThen =
    (phi: number): CornerMatrixRow["build"] =>
    (h) => {
      const first = h.drawSpline([], ARCH_POINTS);
      const [, end] = h.splineEnds(first);
      return [first, h.drawSpline([first], archOutgoing(phi), { start: end })];
    };
  return [
    { row: "C φ=0.1", distance: -0.01, build: archThen(0.1) },
    { row: "C φ=0.005", distance: -0.01, build: archThen(0.005) },
    {
      row: "LL-phi1e-12",
      distance: -0.01,
      build: (h) => {
        const a = h.drawLine([], [0, 0], [1, 0]);
        const [, end] = h.lineEnds(a);
        return [a, h.drawLine([a], [1, 0], [2, 1e-12], { start: end })];
      },
    },
  ];
}

/**
 * A closed native U-slot polygon (T08b-e), lines only, drawn with endpoint
 * snaps and rotated by `angle` so that no box is axis-aligned: at an outward
 * d = −0.48 (τ = 1e-3) its six convex corners take F1 arcs and its two reflex
 * corners are concave trims, and the prong-tip arcs face the opposite
 * prong's offset wall across a 0.04 gap, so K3 bisects arc wedges. Another
 * `outline` (the same polygon convention) replaces the U-slot's corners.
 */
export function uSlotPolygon(
  harness: NativeOffsetChainHarness,
  angle: number,
  outline: readonly Vector[] = [
    [0, 0],
    [3, 0],
    [3, 2],
    [2, 2],
    [2, 1],
    [1, 1],
    [1, 2],
    [0, 2],
  ],
): readonly Authored[] {
  const rotate = (point: Vector): Vector => [
    point[0] * Math.cos(angle) - point[1] * Math.sin(angle),
    point[0] * Math.sin(angle) + point[1] * Math.cos(angle),
  ];
  const corners = outline.map(rotate);
  const patches: Authored[] = [];
  let first: SketchPointId | undefined;
  let previous: SketchPointId | undefined;
  corners.forEach((corner, index) => {
    const last = index === corners.length - 1;
    const patch = harness.drawLine(
      patches,
      corner,
      corners[(index + 1) % corners.length]!,
      {
        ...(previous ? { start: previous } : {}),
        ...(last && first ? { end: first } : {}),
      },
    );
    patches.push(patch);
    const [start, end] = harness.lineEnds(patch);
    first ??= start;
    previous = end;
  });
  return patches;
}

/**
 * Outline of a regular n-gon of circumradius `radius` (counter-clockwise from
 * the +x axis), for `uSlotPolygon` capacity rows: an outward offset gives
 * every corner a T08b-e joint arc (a rounded n-gon).
 */
export function regularPolygonOutline(n: number, radius = 2): Vector[] {
  return Array.from({ length: n }, (_, k): Vector => {
    const angle = (2 * Math.PI * k) / n;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
}

/** SS-60's outgoing spline fit points (the §1.5 matrix row). */
export const SS_60_OUTGOING: readonly Vector[] = [
  [2, 0],
  [2.5, 0.7],
  [3, 1.6],
];

/**
 * Positional-closure wrap (T08b-d), labelled "native commit + closure edit":
 * no native tool authors positional closure (`spline.ts` / session
 * internals), so this is a native 3-point spline commit whose closure field
 * is edited to "positional" with a closing occurrence of its first point;
 * points after the third are appended fit points cloned from the commit's
 * own point record shape. Nothing else is changed.
 */
export function positionalClosureSpline(
  harness: NativeOffsetChainHarness,
  points: readonly Vector[],
): Authored {
  const patch = harness.drawSpline([], points.slice(0, 3));
  const entity = patch.entities[0]!;
  if (entity.kind !== "spline") throw new Error("not a spline");
  const template = patch.points[0]!;
  const extraPoints = points.slice(3).map((position, index) => ({
    ...template,
    pointId: `${template.pointId}_extra${index}` as typeof template.pointId,
    label: `${template.label} extra ${index}`,
    position: position as typeof template.position,
  }));
  const first = entity.pointOccurrences[0]!;
  const occurrences = [
    ...entity.pointOccurrences,
    ...extraPoints.map((point, index) => ({
      occurrenceId: `${first.occurrenceId}_extra${index}`,
      pointId: point.pointId,
      tangent: { kind: "automatic" as const },
    })),
    {
      occurrenceId: `${first.occurrenceId}_close`,
      pointId: first.pointId,
      tangent: { kind: "automatic" as const },
    },
  ];
  return {
    ...patch,
    points: [...patch.points, ...extraPoints],
    entities: [
      {
        ...entity,
        closure: "positional",
        pointOccurrences: occurrences,
        pointOccurrenceIds: occurrences.map(
          (occurrence) => occurrence.occurrenceId,
        ),
      } as typeof entity,
    ],
  };
}

/** The positional-closure wraps of the T08b-d design (τ = 1e-3). */
export const POSITIONAL_WRAPS = {
  /** Exactly parallel closure tangents (cross 0). */
  "wrap-flat4": [
    [0, 0],
    [1, 0],
    [0, 1.5],
    [-1, 0],
  ],
  /** Near-parallel closure (cross ≈ 1.1e-4). */
  "wrap-near4 1e-3": [
    [0, 0],
    [1, 0],
    [0, 1.5],
    [-1, 0.001],
  ],
  /** The smaller loops (fewer leaves, lower K3 cost). */
  "wrap-flat4s": [
    [0, 0],
    [0.5, 0],
    [0, 0.6],
    [-0.5, 0],
  ],
  "wrap-near4s 1e-3": [
    [0, 0],
    [0.5, 0],
    [0, 0.6],
    [-0.5, 0.0005],
  ],
  /**
   * A mirror-symmetric 34-point zig-zag (parallel closure, SEL sized 1): the
   * heavy staged-cap row after the T08b-f0 broad phase (378 leaves at
   * d = 0.05, 204 at d = −0.01).
   */
  "wrap-zig34": [
    [0, 0],
    [1, 0],
    [2, 0.5],
    [1.3, 1.2],
    [2, 1.9],
    [1.3, 2.6],
    [2, 3.3],
    [1.3, 4],
    [2, 4.7],
    [1.3, 5.4],
    [2, 6.1],
    [1.3, 6.8],
    [2, 7.5],
    [1.3, 8.2],
    [2, 8.9],
    [1.3, 9.6],
    [2, 10.3],
    [0, 11.7],
    [-2, 10.3],
    [-1.3, 9.6],
    [-2, 8.9],
    [-1.3, 8.2],
    [-2, 7.5],
    [-1.3, 6.8],
    [-2, 6.1],
    [-1.3, 5.4],
    [-2, 4.7],
    [-1.3, 4],
    [-2, 3.3],
    [-1.3, 2.6],
    [-2, 1.9],
    [-1.3, 1.2],
    [-2, 0.5],
    [-1, 0],
  ],
} as const satisfies Record<string, readonly Vector[]>;

/** The positional-closure wraps as rows (T08b-g1 frame rows), d = ±0.01. */
export function positionalWrapRows(): readonly CornerMatrixRow[] {
  return Object.entries(POSITIONAL_WRAPS).flatMap(([name, points]) =>
    [0.01, -0.01].map(
      (distance): CornerMatrixRow => ({
        row: name,
        distance,
        build: (h) => [positionalClosureSpline(h, points)],
      }),
    ),
  );
}

/** One T08b-g1 frame row on the offset-chain harness of its family. */
export interface OffsetFrameChainRow extends CornerMatrixRow {
  /**
   * `matrix`: the corner-matrix solve tolerances; `native`: the editor
   * tolerances (S2, convex-arc native and positional-wrap rows).
   */
  readonly harness: "matrix" | "native";
  readonly family:
    | "corner matrix"
    | "convex arc"
    | "S2"
    | "S2 B"
    | "positional wrap";
}

/**
 * Every native offset-chain row of the corner-matrix, convex-arc, S2 and
 * positional-wrap families (T08b-g1 plan agreement), on the harness each
 * row is measured on (the D3 rows are `seedArcRows`).
 */
export function offsetFrameChainRows(): readonly OffsetFrameChainRow[] {
  const tag = (
    rows: readonly CornerMatrixRow[],
    family: OffsetFrameChainRow["family"],
    harness: OffsetFrameChainRow["harness"],
  ) => rows.map((row): OffsetFrameChainRow => ({ ...row, family, harness }));
  return [
    ...tag(cornerMatrixRows(), "corner matrix", "matrix"),
    ...tag(convexArcMatrixRows(), "convex arc", "matrix"),
    ...tag(convexArcNativeRows(), "convex arc", "native"),
    ...tag(splineSplineCornerRows(), "S2", "native"),
    ...tag(splineLineShallowRows(), "S2 B", "native"),
    ...tag(positionalWrapRows(), "positional wrap", "native"),
  ];
}

/**
 * T08b-g1 review R2: a native line↔line corner through V = (0, 0), from
 * (−1, −1) to (1 + k·2⁻⁵², 1 − k·2⁻⁵²) (a right turn of about k ulps),
 * left offset d = 0.25 (convex). With its F1 arc, at k = 1 the arc's
 * binary64 atan2 sweep wraps across 0/2π; at k = 2 it does not (found by a
 * deterministic search, `T08b-g1-evidence/review-fixes/probes`). The SEL
 * absorbs this corner natively.
 */
export function nearCollinearCornerRow(ulps: number): CornerMatrixRow {
  return {
    row: `LL-ulp${ulps}`,
    distance: 0.25,
    build: (h) => {
      const a = h.drawLine([], [-1, -1], [0, 0]);
      const [, end] = h.lineEnds(a);
      return [
        a,
        h.drawLine([a], [0, 0], [1 + ulps * 2 ** -52, 1 - ulps * 2 ** -52], {
          start: end,
        }),
      ];
    },
  };
}

/**
 * T08b-f native arc authoring seam (injected by the spec, as the line/spline
 * seam is): the line, centre-point arc, circle and rectangle tools with the
 * session's endpoint-snap inference, the Fillet and Slot edit operations,
 * a constraint tool commit on entity targets, and the native Offset tool's
 * relationship contribution (review R8: the certified seeds are the
 * point-defined arcs of a real offset relationship).
 */
export interface NativeArcAuthoring {
  line(input: {
    readonly previousDefinition: SketchDefinition;
    readonly sequence: number;
    readonly start: Vector;
    readonly end: Vector;
    readonly snaps: EndpointSnaps;
  }): Authored;
  arc(input: {
    readonly previousDefinition: SketchDefinition;
    readonly sequence: number;
    readonly center: Vector;
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
  circle(input: {
    readonly previousDefinition: SketchDefinition;
    readonly sequence: number;
    readonly center: Vector;
    readonly rim: Vector;
  }): Authored;
  rectangle(input: {
    readonly previousDefinition: SketchDefinition;
    readonly sequence: number;
    readonly start: Vector;
    readonly end: Vector;
  }): Authored;
  /** The Fillet edit operation: the whole edited definition. */
  fillet(input: {
    readonly definition: SketchDefinition;
    readonly sequence: number;
    readonly entityIds: readonly [SketchEntityId, SketchEntityId];
    readonly radius: number;
  }): SketchDefinition;
  /** The Slot edit operation's contribution on one line. */
  slot(input: {
    readonly definition: SketchDefinition;
    readonly sequence: number;
    readonly lineId: SketchEntityId;
    readonly width: number;
  }): Authored;
  /** A constraint tool commit on entity targets (e.g. `constraintTangent`). */
  constraint(input: {
    readonly definition: SketchDefinition;
    readonly sequence: number;
    readonly toolId: string;
    readonly entityIds: readonly SketchEntityId[];
  }): SketchDefinition;
  /** The native Offset tool's contribution, or null when it rejects. */
  offset(input: {
    readonly definition: SketchDefinition;
    readonly sequence: number;
    readonly entityIds: readonly SketchEntityId[];
    readonly distance: number;
  }):
    | (Authored & {
        readonly derivedRelationships: NonNullable<
          SketchDefinition["derivedRelationships"]
        >;
      })
    | null;
}

/** One authored arc-harness sketch and its offset seeds, natural order. */
export interface SeedArcSketch {
  readonly definition: SketchDefinition;
  readonly seeds: readonly SketchEntityId[];
}

/**
 * The T08b-f native arc harness: definitions are edited in place by native
 * tools and edit operations (Fillet edits whole definitions), then the
 * native Offset relationship is authored on the seeds so the solve is the
 * point-defined frame T08b-g will feed (review R8), solved, and adapted.
 */
export function createNativeArcOffsetHarness(options: {
  readonly authoring: NativeArcAuthoring;
  readonly modelingTolerance: number;
  readonly solveTolerances: typeof NATIVE_SOLVE_TOLERANCES;
}) {
  const { authoring, modelingTolerance, solveTolerances } = options;
  let sequence = 100;
  const next = () => (sequence += 1);
  const empty = (): SketchDefinition =>
    ({
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }) as unknown as SketchDefinition;
  const merge = (
    definition: SketchDefinition,
    patch: Authored & {
      readonly derivedRelationships?: SketchDefinition["derivedRelationships"];
    },
  ): SketchDefinition => {
    const points = [...definition.points, ...patch.points];
    const entities = [...definition.entities, ...patch.entities];
    const constraints = [
      ...definition.constraints,
      ...(patch.constraints ?? []),
    ];
    return {
      ...definition,
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      ...(patch.derivedRelationships
        ? {
            derivedRelationships: [
              ...(definition.derivedRelationships ?? []),
              ...patch.derivedRelationships,
            ],
          }
        : {}),
    };
  };
  const ends = (definition: SketchDefinition) => {
    const entity = definition.entities.at(-1)!;
    if (entity.kind !== "lineSegment" && entity.kind !== "arc")
      throw new Error("not a line or an arc");
    return {
      definition,
      id: entity.entityId,
      start: entity.startPointId,
      end: entity.endPointId,
    };
  };
  const line = (
    definition: SketchDefinition,
    start: Vector,
    end: Vector,
    snaps: EndpointSnaps = {},
  ) =>
    ends(
      merge(
        definition,
        authoring.line({
          previousDefinition: definition,
          sequence: next(),
          start,
          end,
          snaps,
        }),
      ),
    );
  const arc = (
    definition: SketchDefinition,
    center: Vector,
    start: Vector,
    end: Vector,
    snaps: EndpointSnaps = {},
  ) =>
    ends(
      merge(
        definition,
        authoring.arc({
          previousDefinition: definition,
          sequence: next(),
          center,
          start,
          end,
          snaps,
        }),
      ),
    );
  const spline = (
    definition: SketchDefinition,
    points: readonly Vector[],
    snaps: EndpointSnaps = {},
  ) => {
    const merged = merge(
      definition,
      authoring.spline({
        previousDefinition: definition,
        sequence: next(),
        points,
        snaps,
      }),
    );
    return { definition: merged, id: merged.entities.at(-1)!.entityId };
  };
  const circle = (
    definition: SketchDefinition,
    center: Vector,
    rim: Vector,
  ) => {
    const merged = merge(
      definition,
      authoring.circle({
        previousDefinition: definition,
        sequence: next(),
        center,
        rim,
      }),
    );
    return { definition: merged, id: merged.entities.at(-1)!.entityId };
  };
  const rectangle = (
    definition: SketchDefinition,
    start: Vector,
    end: Vector,
  ) =>
    merge(
      definition,
      authoring.rectangle({
        previousDefinition: definition,
        sequence: next(),
        start,
        end,
      }),
    );
  /** A closed line polygon drawn with endpoint snaps. */
  const polygon = (
    definition: SketchDefinition,
    corners: readonly Vector[],
  ) => {
    let current = definition;
    const ids: SketchEntityId[] = [];
    let first: SketchPointId | undefined;
    let previous: SketchPointId | undefined;
    corners.forEach((corner, index) => {
      const last = index === corners.length - 1;
      const drawn = line(
        current,
        corner,
        corners[(index + 1) % corners.length]!,
        {
          ...(previous ? { start: previous } : {}),
          ...(last && first ? { end: first } : {}),
        },
      );
      current = drawn.definition;
      ids.push(drawn.id);
      first ??= drawn.start;
      previous = drawn.end;
    });
    return { definition: current, ids };
  };
  const fillet = (
    definition: SketchDefinition,
    first: SketchEntityId,
    second: SketchEntityId,
    radius: number,
  ) =>
    authoring.fillet({
      definition,
      sequence: next(),
      entityIds: [first, second],
      radius,
    });
  const slot = (
    definition: SketchDefinition,
    lineId: SketchEntityId,
    width: number,
  ) => {
    const contribution = authoring.slot({
      definition,
      sequence: next(),
      lineId,
      width,
    });
    return {
      definition: merge(definition, contribution),
      ids: contribution.entities.map((entity) => entity.entityId),
    };
  };
  const constraint = (
    definition: SketchDefinition,
    toolId: string,
    entityIds: readonly SketchEntityId[],
  ) =>
    authoring.constraint({ definition, sequence: next(), toolId, entityIds });
  /**
   * The native Offset relationship on the seeds (R8). The tool is driven by
   * the legacy offset, so where legacy rejects the row distance (arc
   * collapse) it is authored at d = ±0.01 (labelled): the seeds' point-
   * defined solve does not depend on the relationship's distance.
   */
  const withOffset = (
    definition: SketchDefinition,
    seeds: readonly SketchEntityId[],
    distance: number,
  ) => {
    for (const value of [distance, Math.sign(distance || 1) * 0.01]) {
      const contribution = authoring.offset({
        definition,
        sequence: next(),
        entityIds: seeds,
        distance: value,
      });
      if (contribution)
        return {
          definition: merge(definition, contribution),
          relationshipDistance: value,
        };
    }
    throw new Error("the native Offset tool rejected the seeds");
  };
  /** Solve (must be solved) with solved point positions written back. */
  const solved = (definition: SketchDefinition): AcceptedPair => {
    const result = solveSketchDefinitionCore({
      definition,
      tolerances: solveTolerances,
      modelingTolerance,
      partialSolvePolicy: "bestEffort",
    });
    if (result.status.solveState !== "solved")
      throw new Error(`native arc sketch solve is ${result.status.solveState}`);
    const positions = new Map(
      result.solvedSnapshot.solvedPoints.map((point) => [
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
      solvedSnapshot: result.solvedSnapshot,
    };
  };
  /** Authored sketch → Offset relationship → solve → N2 → fresh adapter. */
  const adapt = (sketch: SeedArcSketch, distance: number) => {
    let { definition, relationshipDistance } = withOffset(
      sketch.definition,
      sketch.seeds,
      distance,
    );
    let pair: AcceptedPair;
    try {
      pair = solved(definition);
    } catch {
      // The solver may not accept the frame with the relationship at the
      // row distance (its derived outputs join the solve): the seeds'
      // point-defined solve is then taken with the nominal relationship.
      ({ definition, relationshipDistance } = withOffset(
        sketch.definition,
        sketch.seeds,
        Math.sign(distance || 1) * 0.01,
      ));
      pair = solved(definition);
    }
    const connectivity = extractDeclaredOffsetChainConnectivity({
      definition: pair.definition,
      seedIds: sketch.seeds,
    });
    if (!connectivity.ok) throw new Error(connectivity.message);
    const declared = declaredOffsetChainPieces({
      definition: pair.definition,
      solvedSnapshot: pair.solvedSnapshot,
      connectivity,
      distance,
      modelingTolerance,
    });
    return { pair, connectivity, declared, relationshipDistance };
  };
  return {
    empty,
    merge,
    line,
    arc,
    spline,
    circle,
    rectangle,
    polygon,
    fillet,
    slot,
    constraint,
    withOffset,
    solved,
    adapt,
    /** The seed entities (lines and arcs) of a filleted / slotted sketch. */
    lineArcSeeds: (definition: SketchDefinition) =>
      definition.entities
        .filter(
          (entity) => entity.kind === "lineSegment" || entity.kind === "arc",
        )
        .map((entity) => entity.entityId),
  };
}

export type NativeArcOffsetHarness = ReturnType<
  typeof createNativeArcOffsetHarness
>;

/** One T08b-f native D3 row: a sketch builder and its offset distance. */
export interface SeedArcRow {
  readonly row: string;
  readonly distance: number;
  readonly build: (harness: NativeArcOffsetHarness) => SeedArcSketch;
}

/** A regular n-gon of the given side (first corner at angle 0.1). */
const regularSeedPolygon = (n: number, side: number): Vector[] => {
  const radius = side / (2 * Math.sin(Math.PI / n));
  return Array.from({ length: n }, (_, k): Vector => {
    const angle = (2 * Math.PI * k) / n + 0.1;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
};

/** A native n-gon (side 1) with Fillet r = 0.15 at the given corners (default all). */
const roundedPolygon =
  (n: number, corners?: readonly number[]) =>
  (h: NativeArcOffsetHarness): SeedArcSketch => {
    const drawn = h.polygon(h.empty(), regularSeedPolygon(n, 1));
    let definition = drawn.definition;
    for (const corner of corners ?? Array.from({ length: n }, (_, k) => k))
      definition = h.fillet(
        definition,
        drawn.ids[corner]!,
        drawn.ids[(corner + 1) % n]!,
        0.15,
      );
    return { definition, seeds: h.lineArcSeeds(definition) };
  };

/**
 * The T08b-f design §5 native D3 rows as amended by review R6/R7 (τ = 1e-3),
 * built with native tools and edit operations only, exactly as the design
 * probe builds them (rotations by 0.3 rad; Fillet r = 0.2 on rectangles,
 * 0.15 on n-gons; Slot w = 0.4), plus the partially filleted rectangles and
 * polygons (R6) and the deep arc-leaf trims at |d| = r, 2r, 4r, 9r (R7, on a
 * semicircle between long lines so only the arc side is deep).
 */
export function seedArcRows(): readonly SeedArcRow[] {
  const rows: SeedArcRow[] = [];
  const add = (
    row: string,
    build: SeedArcRow["build"],
    distances: readonly number[],
  ) => {
    for (const distance of distances) rows.push({ row, distance, build });
  };
  const rotate =
    (angle: number) =>
    (point: Vector): Vector => [
      point[0] * Math.cos(angle) - point[1] * Math.sin(angle),
      point[0] * Math.sin(angle) + point[1] * Math.cos(angle),
    ];
  const RECT: readonly Vector[] = [
    [0, 0],
    [2, 0],
    [2, 1],
    [0, 1],
  ];
  const filleted =
    (
      angle: number,
      radius: number,
      corners: readonly number[] = [0, 1, 2, 3],
    ) =>
    (h: NativeArcOffsetHarness): SeedArcSketch => {
      let definition =
        angle === 0
          ? h.rectangle(h.empty(), [0, 0], [2, 1])
          : h.polygon(h.empty(), RECT.map(rotate(angle))).definition;
      const lines = definition.entities
        .filter((entity) => entity.kind === "lineSegment")
        .map((entity) => entity.entityId);
      for (const corner of corners)
        definition = h.fillet(
          definition,
          lines[corner]!,
          lines[(corner + 1) % lines.length]!,
          radius,
        );
      return { definition, seeds: h.lineArcSeeds(definition) };
    };
  const slot = (angle: number) => (h: NativeArcOffsetHarness) => {
    const base = h.line(
      h.empty(),
      rotate(angle)([0, 0]),
      rotate(angle)([2, 0]),
    );
    const slotted = h.slot(base.definition, base.id, 0.4);
    return { definition: slotted.definition, seeds: slotted.ids };
  };
  const semicircles = (angle: number) => (h: NativeArcOffsetHarness) => {
    const r = rotate(angle);
    const a = h.arc(h.empty(), [0, 0], r([1, 0]), r([-1, 0]));
    const b = h.arc(a.definition, [0, 0], r([-1, 0]), r([1, 0]), {
      start: a.end,
      end: a.start,
    });
    return { definition: b.definition, seeds: [a.id, b.id] };
  };
  const lens = (h: NativeArcOffsetHarness) => {
    const a = h.arc(h.empty(), [0, -0.6], [1, 0], [-1, 0]);
    const b = h.arc(a.definition, [0, 0.6], [-1, 0], [1, 0], {
      start: a.end,
      end: a.start,
    });
    return { definition: b.definition, seeds: [a.id, b.id] };
  };
  const lineArcLine =
    (centerY: number, length = 1) =>
    (h: NativeArcOffsetHarness) => {
      const first = h.line(h.empty(), [-length, 0], [0, 0]);
      const arc = h.arc(first.definition, [0.5, centerY], [0, 0], [1, 0], {
        start: first.end,
      });
      const last = h.line(arc.definition, [1, 0], [1 + length, 0], {
        start: arc.end,
      });
      return {
        definition: last.definition,
        seeds: [first.id, arc.id, last.id],
      };
    };
  const arcSpline =
    (points: readonly Vector[]) => (h: NativeArcOffsetHarness) => {
      const a = h.arc(h.empty(), [0, 0], [1, 0], [0, 1]);
      const spline = h.spline(a.definition, points, { start: a.end });
      return { definition: spline.definition, seeds: [a.id, spline.id] };
    };
  add("rect", filleted(0, 0, []), [0.01, -0.01, 0.2, -0.2]);
  add("rect rotated 0.3", filleted(0.3, 0, []), [0.01, -0.01, 0.2, -0.2]);
  add("rounded rect", filleted(0, 0.2), [0.01, -0.01, 0.1, -0.1, 0.25]);
  add(
    "rounded rect rotated 0.3",
    filleted(0.3, 0.2),
    [0.01, -0.01, 0.1, -0.1, 0.25],
  );
  add("rect + 1 fillet", filleted(0, 0.2, [0]), [0.01, -0.01, 0.1, -0.1]);
  add(
    "rect rotated 0.3 + 2 fillets",
    filleted(0.3, 0.2, [0, 2]),
    [0.01, -0.01, 0.1, -0.1],
  );
  add("slot", slot(0), [0.01, -0.01, 0.1, -0.1, 0.25]);
  add("slot rotated 0.3", slot(0.3), [0.01, -0.01, 0.1, -0.1, 0.25]);
  add(
    "circle",
    (h) => {
      const drawn = h.circle(h.empty(), [0, 0], [1, 0]);
      return { definition: drawn.definition, seeds: [drawn.id] };
    },
    [0.01, -0.01, 0.5, 1.5],
  );
  add("two semicircles", semicircles(0), [0.01, -0.01, 0.2, -0.2]);
  add("two semicircles rotated 0.3", semicircles(0.3), [0.01, -0.01]);
  add("lens", lens, [0.01, -0.01, 0.1, -0.1, 0.2, 0.3, -0.5]);
  // A thin lens: two flat arcs (centres (0, ±3), sweep ≈ 37° < atan 2, one
  // leaf each), so each arc's single leaf holds BOTH corners' roots.
  add(
    "thin lens",
    (h) => {
      const a = h.arc(h.empty(), [0, -3], [1, 0], [-1, 0]);
      const b = h.arc(a.definition, [0, 3], [-1, 0], [1, 0], {
        start: a.end,
        end: a.start,
      });
      return { definition: b.definition, seeds: [a.id, b.id] };
    },
    [0.01, -0.01, 0.1, -0.1],
  );
  add(
    "line-arc-line semicircle",
    lineArcLine(0),
    [0.01, -0.01, 0.1, -0.1, -0.3, -0.6, 0.3, 0.45, 0.6],
  );
  add(
    "line-arc-line cap",
    lineArcLine(0.5),
    [0.01, -0.01, 0.1, -0.1, -0.3, -0.6, 0.3, 0.6, 0.8],
  );
  add(
    "line-arc-line semicircle long (R7)",
    lineArcLine(0, 6),
    [-0.5, -1, -2, -4.5],
  );
  // A flat 37° cap: ONE rule-B′ leaf, trimmed at both ends inward.
  add("line-arc-line flat cap", lineArcLine(1.5), [0.01, -0.01, 0.1, -0.1]);
  add(
    "arc→spline corner",
    arcSpline([
      [0, 1],
      [-0.5, 1.6],
      [-1, 2.4],
    ]),
    [0.01, -0.01],
  );
  add(
    "arc→spline near-tangent",
    arcSpline([
      [0, 1],
      [-0.5, 1.02],
      [-1, 1.1],
    ]),
    [0.01, -0.01],
  );
  add(
    "quarter arc",
    (h) => {
      const drawn = h.arc(h.empty(), [0, 0], [1, 0], [0, 1]);
      return { definition: drawn.definition, seeds: [drawn.id] };
    },
    [0.01, -0.01, 0.99, 1.2],
  );
  add(
    "3/4 arc",
    (h) => {
      const drawn = h.arc(h.empty(), [0, 0], [1, 0], [0, -1]);
      return { definition: drawn.definition, seeds: [drawn.id] };
    },
    [0.01, -0.01],
  );
  // Review R9: a 300° arc closed by its chord ("D"); outward, F1 arcs with
  // Lemma-W junctions sit at both ends of a near-full seed arc.
  add(
    "D (300° arc + chord)",
    (h) => {
      const start: Vector = [Math.cos(-Math.PI / 3), Math.sin(-Math.PI / 3)];
      const end: Vector = [
        Math.cos((4 * Math.PI) / 3),
        Math.sin((4 * Math.PI) / 3),
      ];
      const arc = h.arc(h.empty(), [0, 0], start, end);
      const chord = h.line(arc.definition, end, start, {
        start: arc.end,
        end: arc.start,
      });
      return { definition: chord.definition, seeds: [arc.id, chord.id] };
    },
    [0.01, -0.01, 0.1, -0.1],
  );
  // A half-disc (semicircle + diameter): inward, both corners are Lemma-T°
  // trims of ONE line leaf against one circle (the T°2 pair).
  add(
    "half-disc",
    (h) => {
      const arc = h.arc(h.empty(), [0, 0], [1, 0], [-1, 0]);
      const diameter = h.line(arc.definition, [-1, 0], [1, 0], {
        start: arc.end,
        end: arc.start,
      });
      return { definition: diameter.definition, seeds: [arc.id, diameter.id] };
    },
    [0.01, -0.01, 0.1, -0.1, 0.3],
  );
  add(
    "thin D (37° arc + chord)",
    (h) => {
      const arc = h.arc(h.empty(), [0, -3], [1, 0], [-1, 0]);
      const chord = h.line(arc.definition, [-1, 0], [1, 0], {
        start: arc.end,
        end: arc.start,
      });
      return { definition: chord.definition, seeds: [arc.id, chord.id] };
    },
    // d = 0.1 exceeds half its height (0.162): the true inward offset is
    // empty (the spec checks that it fails closed where legacy draws an
    // inverted loop).
    [0.01, -0.01, 0.05, -0.1],
  );
  add(
    "S-curve",
    (h) => {
      const a = h.arc(h.empty(), [0, 0], [0, -1], [1, 0]);
      const b = h.arc(a.definition, [2, 0], [2, 1], [1, 0], { end: a.end });
      return { definition: b.definition, seeds: [a.id, b.id] };
    },
    [0.01, -0.01],
  );
  for (const n of [6, 12])
    add(`rounded ${n}-gon`, roundedPolygon(n), [0.01, -0.01]);
  add(
    "hexagon + 2 fillets",
    roundedPolygon(6, [0, 3]),
    [0.01, -0.01, 0.1, -0.1],
  );
  add(
    "rounded rect rotated + Tangent, dragged 1e-4",
    (h) => {
      let { definition } = filleted(0.3, 0.2)(h);
      const arcs = definition.entities.filter(
        (entity) => entity.kind === "arc",
      );
      const lines = definition.entities.filter(
        (entity) => entity.kind === "lineSegment",
      );
      for (const arc of arcs)
        for (const line of lines)
          if (
            arc.kind === "arc" &&
            line.kind === "lineSegment" &&
            [line.startPointId, line.endPointId].some(
              (point) => point === arc.startPointId || point === arc.endPointId,
            )
          )
            definition = h.constraint(definition, "constraintTangent", [
              arc.entityId,
              line.entityId,
            ]);
      const first = arcs[0]!;
      if (first.kind !== "arc") throw new Error("not an arc");
      definition = {
        ...definition,
        points: definition.points.map((point) =>
          point.pointId === first.centerPointId
            ? {
                ...point,
                position: [
                  point.position[0] + 1e-4,
                  point.position[1],
                ] as const,
              }
            : point,
        ),
      } as SketchDefinition;
      return { definition, seeds: h.lineArcSeeds(definition) };
    },
    [0.01, -0.01, 0.1, -0.1],
  );
  return rows;
}

/**
 * T08b-g1 micro seed arcs ([TECH] G10): a native quarter arc (r = 1) offset
 * inward to a certified radius below 1e-6 (0 < R < 1e-6, the range T08b-f
 * newly accepts); published as certified with no new threshold.
 */
export function microSeedArcRows(): readonly SeedArcRow[] {
  const quarter = (h: NativeArcOffsetHarness): SeedArcSketch => {
    const drawn = h.arc(h.empty(), [0, 0], [1, 0], [0, 1]);
    return { definition: drawn.definition, seeds: [drawn.id] };
  };
  return [{ row: "quarter arc micro", distance: 1 - 2 ** -21, build: quarter }];
}

/**
 * T08b-f1 capacity rows ([TECH] F12, the leaf-scaled ceiling), kept out of
 * the D3 table (their adapter solves take seconds): the rounded 32-gon (64
 * leaves, m = 2; it needs more than one production Euclid ceiling), and the
 * leaf boundary pair: 16 lines + 15 fillets outward (31 piece leaves + 1 F1
 * arc = 32, m = 1) and 17 lines + 16 fillets inward (33 leaves, m = 2).
 */
export function seedArcCapacityRows(): readonly SeedArcRow[] {
  const corners = (count: number) => Array.from({ length: count }, (_, k) => k);
  return [
    { row: "rounded 32-gon", distance: -0.01, build: roundedPolygon(32) },
    {
      row: "16-gon with 15 fillets",
      distance: -0.01,
      build: roundedPolygon(16, corners(15)),
    },
    {
      row: "17-gon with 16 fillets",
      distance: 0.01,
      build: roundedPolygon(17, corners(16)),
    },
  ];
}

/**
 * T08b-g2, labelled "native commit + appended fit points": the native
 * spline tool commits only its first three fit points (`MIN_SPLINE_POINTS`),
 * so a longer open spline is a native 3-point commit whose later fit points
 * are appended as `positionalClosureSpline` appends them (point records
 * cloned from the commit's own shape, automatic tangents). Nothing else is
 * changed.
 */
export function appendedFitPointsSpline(
  harness: NativeOffsetChainHarness,
  points: readonly Vector[],
  snaps: EndpointSnaps = {},
): Authored {
  const patch = harness.drawSpline([], points.slice(0, 3), snaps);
  const entity = patch.entities[0]!;
  if (entity.kind !== "spline") throw new Error("not a spline");
  const template = patch.points[0]!;
  const extraPoints = points.slice(3).map((position, index) => ({
    ...template,
    pointId: `${template.pointId}_extra${index}` as typeof template.pointId,
    label: `${template.label} extra ${index}`,
    position: position as typeof template.position,
  }));
  const first = entity.pointOccurrences[0]!;
  const occurrences = [
    ...entity.pointOccurrences,
    ...extraPoints.map((point, index) => ({
      occurrenceId: `${first.occurrenceId}_extra${index}`,
      pointId: point.pointId,
      tangent: { kind: "automatic" as const },
    })),
  ];
  return {
    ...patch,
    points: [...patch.points, ...extraPoints],
    entities: [
      {
        ...entity,
        pointOccurrences: occurrences,
        pointOccurrenceIds: occurrences.map(
          (occurrence) => occurrence.occurrenceId,
        ),
      } as typeof entity,
    ],
  };
}

/**
 * T08b-g2, labelled "native commit + tangent edit": native commits carry
 * automatic tangents only, so an authored tangent is an edit of one
 * occurrence's `tangent` to `{ kind: "authored", vector }` on a native
 * spline commit. Nothing else is changed.
 */
export function tangentEdit(
  patch: Authored,
  edits: readonly { readonly occurrence: number; readonly vector: Vector }[],
): Authored {
  return {
    ...patch,
    entities: patch.entities.map((entity) =>
      entity.kind !== "spline"
        ? entity
        : ({
            ...entity,
            pointOccurrences: entity.pointOccurrences.map(
              (occurrence, index) => {
                const edit = edits.find((item) => item.occurrence === index);
                return edit
                  ? {
                      ...occurrence,
                      tangent: {
                        kind: "authored" as const,
                        vector: edit.vector,
                      },
                    }
                  : occurrence;
              },
            ),
          } as typeof entity),
    ),
  };
}

/** One T08b-g2 derivative row on the offset-chain harness of its kind. */
export interface OffsetFrameDerivativeRow extends CornerMatrixRow {
  readonly harness: "matrix" | "native";
  /** Why the row is in the FD table (the brief's acceptance row it covers). */
  readonly covers: string;
}

/** The S1b fit points (the native tool commits only the first three). */
const S1B_POINTS: readonly Vector[] = [
  [0, 0],
  [1, 0.4],
  [2, -0.2],
  [3, 0.3],
  [4, 0],
];

/** An 8-point open wave (T08b-g2 G8 row). */
const WAVE8_POINTS: readonly Vector[] = [
  [0, 0],
  [1, 0.4],
  [2, 0],
  [3, -0.4],
  [4, 0],
  [5, 0.4],
  [6, 0],
  [7, -0.4],
];

/**
 * T08b-g2 frame-derivative rows on the offset-chain harness: the brief's FD
 * table rows that are not D3 rows (those are `seedArcRows` by label), the
 * G8 5- / 8-point splines, the authored-tangent rows and the self-trim
 * positional wraps at d = +0.01 (T08b-g2 review R1), each labelled.
 */
export function offsetFrameDerivativeRows(): readonly OffsetFrameDerivativeRow[] {
  const matrixRow = (label: string, distance: number, covers: string) => {
    const row = cornerMatrixRows().find(
      (item) => item.row === label && item.distance === distance,
    )!;
    return { ...row, harness: "matrix" as const, covers };
  };
  const selfTrimWrapRow = (label: keyof typeof POSITIONAL_WRAPS) => ({
    ...positionalWrapRows().find(
      (item) => item.row === label && item.distance === 0.01,
    )!,
    harness: "native" as const,
    covers:
      "self-trim queryDomain (T08b-g2 review R1: one positional-closure piece trimmed against itself)",
  });
  const archThenTangentEdit = (h: NativeOffsetChainHarness) =>
    tangentEdit(h.drawSpline([], ARCH_POINTS), [
      { occurrence: 1, vector: [0.4, 0.05] },
    ]);
  return [
    matrixRow("S1", 0.01, "S1"),
    matrixRow("S1b", 0.01, "S1b (the native commit keeps 3 fit points)"),
    {
      row: "5-point spline (native commit + appended fit points)",
      distance: 0.01,
      harness: "matrix",
      covers: "G8 5-point row",
      build: (h) => [appendedFitPointsSpline(h, S1B_POINTS)],
    },
    {
      row: "8-point spline (native commit + appended fit points)",
      distance: 0.01,
      harness: "matrix",
      covers: "G8 8-point row",
      build: (h) => [appendedFitPointsSpline(h, WAVE8_POINTS)],
    },
    matrixRow("SL-90", 0.01, "SL-90 +"),
    matrixRow("SL-90", -0.01, "SL-90 −"),
    matrixRow("LS-90", 0.01, "LS-90"),
    matrixRow("SS-60", 0.01, "G8 SS-60 trim row"),
    matrixRow("SS-60", -0.01, "SS-60 −"),
    matrixRow("SL-loop", 0.01, "SL-loop +"),
    matrixRow("SL-loop", -0.01, "SL-loop −"),
    matrixRow("SL-tiny", 0.01, "step-2(b) absorbed vertex, line adopter"),
    {
      row: "SL-tiny then a 165° return (absorbed vertex + F1 arc at the adopting line's other end)",
      distance: -0.01,
      harness: "matrix",
      covers: "absorbed + arc-end row (line adopter)",
      build: (h) => {
        const spline = h.drawSpline([], ARCH_POINTS);
        const line = h.drawLine([spline], [2, 0], [3, -0.1], {
          start: h.splineEnds(spline)[1],
        });
        return [
          spline,
          line,
          h.drawLine([spline, line], [3, -0.1], [2.95, -0.085], {
            start: h.lineEnds(line)[1],
          }),
        ];
      },
    },
    {
      row: "arch → 2-point spline (C φ=0.005 turn) → line (absorbed vertex + F1 arc at the one-span spline adopter's other end)",
      distance: -0.01,
      harness: "native",
      covers:
        "absorbed + arc-end row (T08b-e review §7: one-span spline adopter)",
      build: (h) => {
        const length = Math.hypot(1, -0.1);
        const phi = 0.005;
        const direction: Vector = [
          (Math.cos(phi) * 1 + Math.sin(phi) * 0.1) / length,
          (Math.sin(phi) * 1 - Math.cos(phi) * 0.1) / length,
        ];
        const first = h.drawSpline([], ARCH_POINTS);
        const end: Vector = [2 + direction[0], direction[1]];
        const second = h.drawSpline([first], [[2, 0], end], {
          start: h.splineEnds(first)[1],
        });
        return [
          first,
          second,
          h.drawLine(
            [first, second],
            end,
            [end[0] - direction[1], end[1] + direction[0]],
            { start: h.splineEnds(second)[1] },
          ),
        ];
      },
    },
    {
      row: "horizontal-ended arch → line → line (native commit + tangent edit): a bitwise-shared parallel vertex (no re-call; the line is the non-keeper) and a trim at the line's other end",
      distance: 0.01,
      harness: "matrix",
      covers: "d math A3 (a line with a vertex end and a trim end)",
      build: (h) => {
        const spline = tangentEdit(h.drawSpline([], ARCH_POINTS), [
          { occurrence: 2, vector: [0.5, 0] },
        ]);
        const line = h.drawLine([spline], [2, 0], [3, 0], {
          start: h.splineEnds(spline)[1],
        });
        return [
          spline,
          line,
          h.drawLine([spline, line], [3, 0], [3, 1], {
            start: h.lineEnds(line)[1],
          }),
        ];
      },
    },
    {
      row: "arch with an authored interior tangent (native commit + tangent edit)",
      distance: 0.01,
      harness: "matrix",
      covers: "tangent authority (interior occurrence)",
      build: (h) => [archThenTangentEdit(h)],
    },
    {
      row: "SL-90 with an authored tangent at the joined spline end (native commit + tangent edit)",
      distance: 0.01,
      harness: "matrix",
      covers: "tangent authority (trimmed end)",
      build: (h) => {
        const spline = tangentEdit(h.drawSpline([], ARCH_POINTS), [
          { occurrence: 2, vector: [0.35, -0.12] },
        ]);
        const [, splineEnd] = h.splineEnds(spline);
        return [
          spline,
          h.drawLine([spline], [2, 0], [2, 1], { start: splineEnd }),
        ];
      },
    },
    selfTrimWrapRow("wrap-near4 1e-3"),
    selfTrimWrapRow("wrap-near4s 1e-3"),
  ];
}

/** One T08b-g3 probe-drag row: a committed outline and its fit-point drag. */
export interface OffsetPartitionDragRow extends CornerMatrixRow {
  /** The dragged fit point's heights along the drag. */
  readonly heights: readonly number[];
  /** The committed outline with the dragged fit point at `height` (ids unchanged). */
  readonly drag: (
    patches: readonly Authored[],
    height: number,
  ) => readonly Authored[];
}

/**
 * The T08b-g3 probe drag (T08b design §0.3, `partition-stability.probe.ts`),
 * labelled "native commit + point drag": the SL-loop outline (a native
 * 3-point arch closed by a native line with endpoint snaps), whose middle fit
 * point is moved to each height by an edit of that one point's position (a
 * drag keeps every id). The owner's sub-partition of the arch offset has 4,
 * 6, 6, 8 and 10 sub-spans at these heights (T08b-g3 evidence
 * `partition-heights.result.txt`); its source spans never change.
 */
export function offsetPartitionDragRows(): readonly OffsetPartitionDragRow[] {
  const heights = [0.4, 0.5, 0.6, 0.7, 0.85];
  return [0.01, -0.01].map((distance) => ({
    row: "SL-loop probe drag",
    distance,
    heights,
    build: (h) => {
      const spline = h.drawSpline(
        [],
        [
          [0, 0],
          [1, heights[0]!],
          [2, 0],
        ],
      );
      const [start, end] = h.splineEnds(spline);
      return [
        spline,
        h.drawLine([spline], [2, 0], [0, 0], { start: end, end: start }),
      ];
    },
    drag: (patches, height) => {
      const spline = patches[0]!.entities[0]!;
      if (spline.kind !== "spline") throw new Error("not a spline");
      const middle = spline.pointOccurrences[1]!.pointId;
      return patches.map((patch, index) =>
        index !== 0
          ? patch
          : {
              ...patch,
              points: patch.points.map((point) =>
                point.pointId === middle
                  ? { ...point, position: [1, height] as const }
                  : point,
              ),
            },
      );
    },
  }));
}
