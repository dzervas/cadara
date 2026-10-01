import { describe, expect, test } from "vitest";
import type {
  CertifiedTubePieceChainRequests,
  NeutralCurveQueryRequest,
  NeutralCurveQueryResult,
  PieceTubeChainRequest,
  TubePieceChainResult,
} from "@/contracts/modeling/neutral-curve-query";
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import {
  evaluateSketchDerivationJvp,
  evaluateSketchDerivations,
  prepareSketchDerivationPullback,
} from "@/contracts/sketch/derived-geometry";
import type { SketchConstraintToolId } from "@/core/sketch-constraints/definition";
import {
  getSketchConstraintDefinition,
  resolveSketchConstraintTarget,
} from "@/core/sketch-constraints/registry";
import { lineSketchToolDefinition } from "@/core/sketch-tools/tools/line";
import { splineSketchToolDefinition } from "@/core/sketch-tools/tools/spline";
import { centerPointArcSketchToolDefinition } from "@/core/sketch-tools/tools/center-point-arc";
import { circleSketchToolDefinition } from "@/core/sketch-tools/tools/circle";
import { rectangleSketchToolDefinition } from "@/core/sketch-tools/tools/rectangle";
import {
  createSketchFilletMutation,
  createSketchOffsetDerivationContribution,
  createSketchSlotContribution,
} from "@/domain/sketch-editing/operations";
import { appendInferredSnapConstraints } from "@/domain/editor/sketch-session/tools";
import {
  createSessionCommitFactories,
  createSketchPointRef,
} from "@/domain/editor/sketch-session/internals";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { extractDeclaredOffsetChainConnectivity } from "@/contracts/sketch/offset-chain-connectivity";
import {
  ARCH_POINTS,
  CORNER_MATRIX_SOLVE_TOLERANCES,
  SS_60_OUTGOING,
  createNativeArcOffsetHarness,
  createNativeOffsetChainHarness,
  microSeedArcRows,
  nearCollinearCornerRow,
  offsetFrameChainRows,
  deepTrimRows,
  offsetFrameDerivativeRows,
  seedArcRows,
  type AcceptedPair,
  type Authored,
  type EndpointSnaps,
  type NativeArcAuthoring,
  type NativeToolAuthoring,
  type Vector,
} from "@/contracts/sketch/offset-chain.fixtures";
import {
  certifyDeclaredOffsetChain,
  declaredOffsetChainPieces,
  offsetArcSweepAdmissible,
  uncheckedDeclaredOffsetChainPieces,
  type CertifiedNeutralCurveRequestQuery,
  type CertifiedOffsetChainTubeStability,
  type DeclaredOffsetChainPieces,
} from "@/contracts/sketch/offset-chain-topology";
import {
  offsetFrameCurveResidual,
  prepareOffsetFrameDerivatives,
  publishOffsetFrame,
  solveOffsetFrame,
  solveOffsetFrameWithoutMemoForTest,
  type OffsetFrameArcVariation,
  type OffsetFrameCubicSpan,
  type OffsetFrameCotangent,
  type OffsetFrameJvp,
  type OffsetFrameSourceDof,
  type OffsetFrameVariation,
  type CertifiedOffsetFramePublication,
  type OffsetFramePlan,
  type OffsetFramePublication,
  type OffsetFrameRelationship,
  type OffsetSolveFrame,
  type OffsetSolveFrameResult,
} from "@/contracts/sketch/offset-derivation-frame";
import {
  OFFSET_DIAGNOSTIC_CODES,
  offsetLinePoints,
  type OffsetChainFailure,
} from "@/contracts/sketch/offset-geometry";
import {
  closestSplineSpanLocation,
  evaluateSplineSpan,
} from "@/contracts/sketch/spline-geometry";
import { solveCommittedConstraintDefinition } from "@/domain/editor/sketch-session/constraints";
import {
  offsetFrameShellSpans,
  ownerSpanKey,
} from "@/contracts/sketch/offset-derivation-outputs";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import { createCertifiedNeutralCurveRequestQuery } from "@/domain/modeling/neutral-curve-certification/query";

/*
 * The native authoring seams below are the offset-chain topology spec's own
 * (verbatim): contracts fixtures may not import implementation layers
 * (static guard), so each spec injects them.
 */

function createNativeToolAuthoring(sketchId: string): NativeToolAuthoring {
  const factories = createSessionCommitFactories(1, sketchId as never);
  const endpointSnap = (pointId: SketchPointId, point: Vector) => ({
    key: `endpoint:${pointId}`,
    kind: "endpoint" as const,
    point,
    rawPointer: point,
    distance: 0,
    priority: 0,
    sources: [{ kind: "localPoint" as const, pointId }],
    preview: { label: "endpoint", glyph: "endpoint" as const },
  });
  const infer = (
    previousDefinition: SketchDefinition,
    activeTool: "line" | "spline",
    patch: ReturnType<typeof lineSketchToolDefinition.createCommitContribution>,
    sequence: number,
    start: Vector,
    end: Vector,
    snaps: EndpointSnaps,
  ) =>
    appendInferredSnapConstraints({
      previousDefinition,
      patch,
      activeTool,
      startSnap: snaps.start ? endpointSnap(snaps.start, start) : null,
      endSnap: snaps.end ? endpointSnap(snaps.end, end) : null,
      sequence,
      createConstraintId: (name: string) => `constraint_${name}` as never,
    });
  return {
    line: ({ previousDefinition, sequence, start, end, snaps }) =>
      infer(
        previousDefinition,
        "line",
        lineSketchToolDefinition.createCommitContribution({
          sequence,
          start,
          end,
          isConstruction: false,
          factories,
        }),
        sequence,
        start,
        end,
        snaps,
      ),
    spline: ({ previousDefinition, sequence, points, snaps }) =>
      infer(
        previousDefinition,
        "spline",
        splineSketchToolDefinition.createCommitContribution({
          sequence,
          start: points[0]!,
          end: points.at(-1)!,
          points: points as [number, number][],
          isConstruction: false,
          factories,
        }),
        sequence,
        points[0]!,
        points.at(-1)!,
        snaps,
      ),
  };
}

function createNativeArcAuthoring(sketchId: string): NativeArcAuthoring {
  const factoriesOf = (sequence: number) =>
    createSessionCommitFactories(sequence, sketchId as never);
  const endpointSnap = (pointId: SketchPointId, point: Vector) => ({
    key: `endpoint:${pointId}`,
    kind: "endpoint" as const,
    point,
    rawPointer: point,
    distance: 0,
    priority: 0,
    sources: [{ kind: "localPoint" as const, pointId }],
    preview: { label: "endpoint", glyph: "endpoint" as const },
  });
  const infer = (
    previousDefinition: SketchDefinition,
    activeTool: "line" | "spline" | "centerPointArc",
    patch: Authored,
    sequence: number,
    start: Vector,
    end: Vector,
    snaps: EndpointSnaps,
  ) =>
    appendInferredSnapConstraints({
      previousDefinition,
      patch: patch as never,
      activeTool: activeTool as never,
      startSnap: snaps.start ? endpointSnap(snaps.start, start) : null,
      endSnap: snaps.end ? endpointSnap(snaps.end, end) : null,
      sequence,
      createConstraintId: (name: string) =>
        `constraint_${sequence}_${name}` as never,
    }) as Authored;
  return {
    line: ({ previousDefinition, sequence, start, end, snaps }) =>
      infer(
        previousDefinition,
        "line",
        lineSketchToolDefinition.createCommitContribution({
          sequence,
          start,
          end,
          isConstruction: false,
          factories: factoriesOf(sequence),
        }) as Authored,
        sequence,
        start,
        end,
        snaps,
      ),
    arc: ({ previousDefinition, sequence, center, start, end, snaps }) =>
      infer(
        previousDefinition,
        "centerPointArc",
        centerPointArcSketchToolDefinition.createCommitContribution({
          sequence,
          points: [center, start, end],
          isConstruction: false,
          factories: factoriesOf(sequence),
        } as never) as Authored,
        sequence,
        start,
        end,
        snaps,
      ),
    spline: ({ previousDefinition, sequence, points, snaps }) =>
      infer(
        previousDefinition,
        "spline",
        splineSketchToolDefinition.createCommitContribution({
          sequence,
          start: points[0]!,
          end: points.at(-1)!,
          points: points as [number, number][],
          isConstruction: false,
          factories: factoriesOf(sequence),
        }) as Authored,
        sequence,
        points[0]!,
        points.at(-1)!,
        snaps,
      ),
    circle: ({ sequence, center, rim }) =>
      circleSketchToolDefinition.createCommitContribution({
        sequence,
        start: center,
        end: rim,
        isConstruction: false,
        factories: factoriesOf(sequence),
      } as never) as Authored,
    rectangle: ({ sequence, start, end }) =>
      rectangleSketchToolDefinition.createCommitContribution({
        sequence,
        start,
        end,
        isConstruction: false,
        factories: factoriesOf(sequence),
      } as never) as Authored,
    fillet: ({ definition, sequence, entityIds, radius }) => {
      const result = createSketchFilletMutation({
        definition,
        entityIds,
        radius,
        sequence,
        factories: factoriesOf(sequence),
      } as never);
      if (!result.valid || !result.definition)
        throw new Error(`fillet: ${result.message}`);
      return result.definition;
    },
    slot: ({ definition, sequence, lineId, width }) => {
      const result = createSketchSlotContribution({
        definition,
        entityIds: [lineId],
        width,
        sequence,
        factories: factoriesOf(sequence),
      } as never);
      if (!result.valid || !result.contribution)
        throw new Error(`slot: ${result.message}`);
      return result.contribution as Authored;
    },
    constraint: ({ definition, sequence, toolId, entityIds }) => {
      const tool = toolId as SketchConstraintToolId;
      const contribution = getSketchConstraintDefinition(
        tool,
      ).createCommitContribution({
        sequence,
        selectedTargets: entityIds.map((entityId) => {
          const record = resolveSketchConstraintTarget(tool, definition, {
            kind: "sketchEntity",
            sketchId: sketchId as SketchId,
            entityId,
          });
          if (!record) throw new Error(`${toolId} rejected ${entityId}`);
          return record;
        }),
        pointer: null,
        value: null,
        annotationPlacement: null,
        createConstraintId: (suffix) =>
          `constraint_${sequence}_${suffix}` as const,
        createDimensionId: (suffix) =>
          `dimension_${sequence}_${suffix}` as const,
      });
      const constraints = contribution.constraints ?? [];
      const dimensions = contribution.dimensions ?? [];
      return {
        ...definition,
        constraintIds: [
          ...definition.constraintIds,
          ...constraints.map((constraint) => constraint.constraintId),
        ],
        constraints: [...definition.constraints, ...constraints],
        dimensionIds: [
          ...definition.dimensionIds,
          ...dimensions.map((dimension) => dimension.dimensionId),
        ],
        dimensions: [...definition.dimensions, ...dimensions],
      };
    },
    offset: ({ definition, sequence, entityIds, distance }) => {
      const result = createSketchOffsetDerivationContribution({
        definition,
        entityIds,
        distance: Math.abs(distance),
        side: distance >= 0 ? "left" : "right",
        sequence,
        factories: factoriesOf(sequence),
        modelingTolerance: 1e-3,
      } as never);
      return result.valid && result.contribution
        ? (result.contribution as never)
        : null;
    },
  };
}

const TOLERANCE = 1e-3;
const codes = OFFSET_DIAGNOSTIC_CODES;
const query = createCertifiedNeutralCurveRequestQuery();
const certifier = createCertifiedCubicTubeChain();
const SKETCH_DIRECT_EDIT_TOLERANCES =
  createDocumentSolverTolerances(OCC_KERNEL_SETTINGS);

const bits = new DataView(new ArrayBuffer(8));
/** Bitwise encoding (every number by its binary64 bits). */
const encode = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== "number") return item;
    bits.setFloat64(0, item);
    return `f64:${bits.getBigUint64(0).toString(16)}`;
  });

/** The adjacent binary64 value (finite, nonzero inputs). */
const nextUp = (value: number, steps = 1) => {
  bits.setFloat64(0, value);
  const raw = bits.getBigUint64(0);
  bits.setBigUint64(0, value > 0 ? raw + BigInt(steps) : raw - BigInt(steps));
  return bits.getFloat64(0);
};

const relationshipOf = (
  seedEntityIds: readonly SketchEntityId[],
  distance: number,
  arcJoints?: readonly number[],
): OffsetFrameRelationship => ({
  derivationId: "derivation_g1",
  seedEntityIds,
  distance,
  ...(arcJoints ? { arcJoints } : {}),
});

interface Ports {
  readonly query: CertifiedNeutralCurveRequestQuery;
  readonly certifier: CertifiedTubePieceChainRequests;
}

/**
 * Replaying ports (spec-only, runtime): the real whole-request query and the
 * real staged certifier are deterministic functions of their request
 * sequence, so an identical sequence (the SEL inside publish, run in full on
 * the same adapter output) replays the first run's results; the first
 * divergent request re-issues its prefix on a fresh real request and
 * continues live. Results are therefore exactly the real ports'.
 */
function replaying<Request, Result>(
  open: (size: number) => (request: Request) => Result,
) {
  const memo = new Map<string, Result>();
  return (size: number) => {
    const prefix: Request[] = [];
    let live: ((request: Request) => Result) | null = null;
    let key = `${size}`;
    return (request: Request) => {
      key += `|${encode(request)}`;
      prefix.push(request);
      const hit = live ? undefined : memo.get(key);
      if (hit !== undefined) return hit;
      if (!live) {
        const opened = open(size);
        for (const earlier of prefix.slice(0, -1)) opened(earlier);
        live = opened;
      }
      const result = live(request);
      memo.set(key, result);
      return result;
    };
  };
}

/** Fresh replaying ports over the real query and certifier, with an attempt count. */
function createReplayPorts(
  inner: Ports = { query, certifier },
): Ports & { readonly certifications: () => number } {
  const pairs = replaying<NeutralCurveQueryRequest, NeutralCurveQueryResult>(
    (size) => {
      const request = inner.query.openRequest(size);
      return (pair) => request.queryPair(pair);
    },
  );
  const chains = replaying<PieceTubeChainRequest, TubePieceChainResult>(
    (attempts) => {
      const request = inner.certifier.openRequest(attempts);
      return (chain) => request.certifyPieceChain(chain);
    },
  );
  let certifications = 0;
  return {
    query: { openRequest: (size) => ({ queryPair: pairs(size) }) },
    certifier: {
      openRequest: (attempts) => {
        const certify = chains(attempts);
        return {
          certifyPieceChain: (chain) => {
            certifications += 1;
            return certify(chain);
          },
        };
      },
    },
    certifications: () => certifications,
  };
}

const solveOf = (
  relationship: OffsetFrameRelationship,
  definition: AcceptedPair["definition"],
  plan?: OffsetFramePlan,
  solve: typeof solveOffsetFrame = solveOffsetFrame,
) => solve({ relationship, definition, modelingTolerance: TOLERANCE }, plan);

/** Bitwise encoding that also spells out Maps (frames carry `cubics` / `lineArcEndpoints`). */
const encodeDeep = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Map) return { map: [...item] };
    if (typeof item !== "number") return item;
    bits.setFloat64(0, item);
    return `f64:${bits.getBigUint64(0).toString(16)}`;
  });

const publishOf = (
  relationship: OffsetFrameRelationship,
  pair: AcceptedPair,
  solveFrame: OffsetSolveFrame,
  ports: Ports = { query, certifier },
) =>
  publishOffsetFrame({
    relationship,
    pair,
    modelingTolerance: TOLERANCE,
    ...ports,
    solveFrame,
  });

const solvedFrame = (result: OffsetSolveFrameResult): OffsetSolveFrame => {
  if (!result.ok) throw new Error(`solve frame: ${result.failure.message}`);
  return result;
};

/**
 * The orchestrator's contract (T08b-g plan §3.1): solve, publish, and on
 * `planChanged` ONE re-solve with the certifier's plan and one more publish.
 */
function publishCycle(
  relationship: OffsetFrameRelationship,
  pair: AcceptedPair,
  ports: Ports = { query, certifier },
  solver: typeof solveOffsetFrame = solveOffsetFrame,
) {
  const solves: OffsetSolveFrameResult[] = [];
  const publications: OffsetFramePublication[] = [];
  const solve = (plan?: OffsetFramePlan) => {
    const frame = solveOf(relationship, pair.definition, plan, solver);
    solves.push(frame);
    return frame;
  };
  const publish = (frame: OffsetSolveFrame) => {
    const publication = publishOf(relationship, pair, frame, ports);
    publications.push(publication);
    return publication;
  };
  let frame = solve();
  if (!frame.ok) return { solves, publications, final: frame } as const;
  let publication = publish(frame);
  if (publication.status === "planChanged") {
    frame = solve(publication.plan);
    if (!frame.ok) return { solves, publications, final: frame } as const;
    publication = publish(frame);
  }
  return { solves, publications, final: publication } as const;
}

type Cycle = ReturnType<typeof publishCycle>;

const certifiedOf = (cycle: Cycle): CertifiedOffsetFramePublication => {
  const { final } = cycle;
  if ("ok" in final)
    throw new Error(`solve frame failed: ${final.failure.message}`);
  if (final.status !== "certified")
    throw new Error(
      `${final.status}: ${final.status === "failed" ? final.failure.message : ""}`,
    );
  return final;
};

const failedOf = (publication: OffsetFramePublication) => {
  if (publication.status !== "failed")
    throw new Error(`expected a failed publication, got ${publication.status}`);
  return publication;
};

/** Checked adapter output of one accepted pair (the SEL input). */
function checkedOf(
  pair: AcceptedPair,
  seeds: readonly SketchEntityId[],
  distance: number,
) {
  const connectivity = extractDeclaredOffsetChainConnectivity({
    definition: pair.definition,
    seedIds: seeds,
  });
  if (!connectivity.ok) throw new Error(connectivity.message);
  return {
    connectivity,
    declared: declaredOffsetChainPieces({
      definition: pair.definition,
      solvedSnapshot: pair.solvedSnapshot,
      connectivity,
      distance,
      modelingTolerance: TOLERANCE,
    }),
  };
}

/**
 * G3 geometry agreement of a verified row: the published (solve-frame)
 * pieces are the certified pieces bitwise (poles included), and every
 * published representative lies in its witness bounds.
 */
function expectCertifiedGeometry(
  publication: CertifiedOffsetFramePublication,
  direct: CertifiedOffsetChainTubeStability,
) {
  const { frame } = publication;
  expect(encode(frame.pieces), "pieces bitwise").toBe(
    encode(direct.resolved.input.pieces),
  );
  for (const [index, piece] of frame.pieces.entries()) {
    const certified = direct.resolved.input.pieces[index]!;
    if (piece.kind !== "derivedCubic" || certified.kind !== "derivedCubic")
      continue;
    piece.spans.forEach((span, offset) =>
      span.poles.forEach((pole, k) => {
        const other = certified.spans[offset]!.poles[k]!;
        expect(
          Object.is(pole[0], other[0]) && Object.is(pole[1], other[1]),
        ).toBe(true);
      }),
    );
  }
  expect(frame.trims).toHaveLength(direct.resolved.joints.length);
  direct.resolved.joints.forEach((joint, position) => {
    const trim = frame.trims[position]!;
    expect(trim.jointIndex).toBe(joint.jointIndex);
    const [a, b] = joint.firstParameterBounds;
    const [c, d] = joint.secondParameterBounds;
    expect(trim.first.parameter >= a && trim.first.parameter <= b).toBe(true);
    expect(trim.second.parameter >= c && trim.second.parameter <= d).toBe(true);
  });
  expect(encode(publication.certified.resolved.input.pieces)).toBe(
    encode(direct.resolved.input.pieces),
  );
}

/**
 * Publish ≡ SEL on one native row, through the orchestrator's cycle:
 * - the unchecked piece builder is bitwise the checked adapter (G4);
 * - verified ⇒ certified within one hinted re-solve, with the certified
 *   geometry; SEL retries ⇒ `planChanged` first;
 * - not verified ⇒ never certified, and a publish that ran reports the
 *   SEL's own failure.
 */
function expectPublishMatchesSel(
  pair: AcceptedPair,
  seeds: readonly SketchEntityId[],
  distance: number,
) {
  const ports = createReplayPorts();
  const { connectivity, declared } = checkedOf(pair, seeds, distance);
  const unchecked = uncheckedDeclaredOffsetChainPieces({
    definition: pair.definition,
    connectivity,
    distance,
    modelingTolerance: TOLERANCE,
  });
  expect(unchecked.ok).toBe(declared.ok);
  if (declared.ok && unchecked.ok)
    expect(
      encode([unchecked.pieces, unchecked.sources, unchecked.vertices]),
      "G4: unchecked = checked bitwise on the accepted pair",
    ).toBe(encode([declared.pieces, declared.sources, declared.vertices]));
  const direct = declared.ok
    ? certifyDeclaredOffsetChain(declared, ports.query, ports.certifier)
    : declared;
  const attempts = ports.certifications();
  const cycle = publishCycle(relationshipOf(seeds, distance), pair, ports);
  // T08b-g5b memo equivalence: the same cycle without the solve-frame memo
  // (on the same replaying ports) has bitwise the same frames and the same
  // publications, and a repeated solve is the memo's same frame object.
  const uncached = publishCycle(
    relationshipOf(seeds, distance),
    pair,
    ports,
    solveOffsetFrameWithoutMemoForTest,
  );
  expect(
    encodeDeep(uncached.solves),
    "T08b-g5b: memoized solve frames are bitwise the uncached frames",
  ).toBe(encodeDeep(cycle.solves));
  expect(
    encodeDeep(uncached.publications),
    "T08b-g5b: publications of memoized frames are identical to the uncached ones",
  ).toBe(encodeDeep(cycle.publications));
  expect(
    solveOf(relationshipOf(seeds, distance), pair.definition),
    "T08b-g5b: a repeated solve frame is the memo's same object",
  ).toBe(cycle.solves[0]);
  if (direct.ok) {
    const publication = certifiedOf(cycle);
    expectCertifiedGeometry(publication, direct);
    expect(publication.frame).toBe(cycle.solves.at(-1));
    expect(publication.plan.origin).toBe("published");
    if (attempts > 1)
      expect(cycle.publications[0]!.status, "an SEL retry").toBe("planChanged");
    // The planChanged reason: an SEL retry changes the plan; a first-attempt
    // SEL plan is the first choice, so only representatives can miss.
    const first = cycle.publications[0]!;
    if (first.status === "planChanged")
      expect(first.reason, "planChanged reason").toBe(
        attempts > 1 ? "plan" : "representatives",
      );
    return { cycle, direct, attempts };
  }
  const last = cycle.publications.at(-1);
  expect(last?.status ?? "not published").not.toBe("certified");
  if (last?.status === "failed") expect(last.failure).toEqual(direct);
  return { cycle, direct, attempts };
}

const matrixHarnesses = {
  matrix: createNativeOffsetChainHarness({
    authoring: createNativeToolAuthoring("sketch_g1m"),
    query,
    modelingTolerance: TOLERANCE,
    solveTolerances: CORNER_MATRIX_SOLVE_TOLERANCES,
  }),
  native: createNativeOffsetChainHarness({
    authoring: createNativeToolAuthoring("sketch_g1n"),
    query,
    modelingTolerance: TOLERANCE,
  }),
};
const chainRows = offsetFrameChainRows();
/** One native chain row's accepted pair and seeds (every entity is a seed). */
const chainRow = (label: string) => {
  const row = chainRows.find(
    (item) => `${item.family} ${item.row} ${item.distance}` === label,
  );
  if (!row) throw new Error(`no row ${label}`);
  const harness = matrixHarnesses[row.harness];
  harness.resetSequence();
  const pair = harness.solvedPair(row.build(harness));
  const seeds = pair.definition.entities.map((entity) => entity.entityId);
  return { pair, seeds, distance: row.distance };
};

const arcHarness = createNativeArcOffsetHarness({
  authoring: createNativeArcAuthoring("sketch_g1f"),
  modelingTolerance: TOLERANCE,
  solveTolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
});
const d3Rows = [...seedArcRows(), ...microSeedArcRows()];
/** One native D3 row's accepted pair (Offset relationship authored) and seeds. */
const d3Row = (label: string) => {
  const row = d3Rows.find((item) => `${item.row} ${item.distance}` === label);
  if (!row) throw new Error(`no row ${label}`);
  const sketch = row.build(arcHarness);
  const { pair } = arcHarness.adapt(sketch, row.distance);
  return { pair, seeds: sketch.seeds, distance: row.distance };
};

describe("T08b-g1 frame owner: publish ≡ certifyDeclaredOffsetChain on every native row (corner matrix, convex arc, S2, positional wrap)", () => {
  test.each(
    chainRows.map((row) => [row.family, row.row, row.distance] as const),
  )(
    "%s %s d = %s",
    (family, row, distance) => {
      const { pair, seeds } = chainRow(`${family} ${row} ${distance}`);
      expectPublishMatchesSel(pair, seeds, distance);
    },
    120_000,
  );
});

describe("T08b-g1 frame owner: publish ≡ certifyDeclaredOffsetChain on every native D3 row (Offset relationship, seed arcs, micro arcs)", () => {
  test.each(d3Rows.map((row) => [row.row, row.distance] as const))(
    "D3 %s d = %s",
    (row, distance) => {
      const { pair, seeds } = d3Row(`${row} ${distance}`);
      expectPublishMatchesSel(pair, seeds, distance);
    },
    60_000,
  );
});

describe("T08b-g1 frame owner: [TECH] G3 plan agreement, one hinted re-solve", () => {
  test("a first-choice row (LL-90 d = 0.01, one concave trim) verifies with no re-solve; the published plan seeds the next frame", () => {
    const { pair, seeds, distance } = chainRow("corner matrix LL-90 0.01");
    const relationship = relationshipOf(seeds, distance);
    const cycle = publishCycle(relationship, pair);
    expect(cycle.publications.map((item) => item.status)).toEqual([
      "certified",
    ]);
    const publication = certifiedOf(cycle);
    expect(publication.frame.plan.origin).toBe("firstChoice");
    expect(publication.plan).toEqual({
      origin: "published",
      adjacencies: [
        {
          kind: "trim",
          leaves: [0, 0],
          representatives: [
            publication.frame.trims[0]!.first.parameter,
            publication.frame.trims[0]!.second.parameter,
          ],
        },
      ],
    });
    // The published plan is a converged seed: the next frame keeps it bitwise.
    const next = solvedFrame(
      solveOf(relationship, pair.definition, publication.plan),
    );
    expect(encode(next.trims)).toBe(encode(publication.frame.trims));
    expect(publishOf(relationship, pair, next).status).toBe("certified");
  });

  test("an SEL-retry row (convex arc C φ=0.1 d = −0.01: U-E absorption does not certify, the arc does) gives planChanged with the certifier's plan; the hinted re-solve verifies", () => {
    const { pair, seeds, distance } = chainRow("convex arc C φ=0.1 -0.01");
    const ports = createReplayPorts();
    const { declared } = checkedOf(pair, seeds, distance);
    if (!declared.ok) throw new Error(declared.message);
    const direct = certifyDeclaredOffsetChain(
      declared,
      ports.query,
      ports.certifier,
    );
    expect(direct.ok).toBe(true);
    expect(ports.certifications(), "SEL attempts").toBe(2);
    const cycle = publishCycle(relationshipOf(seeds, distance), pair, ports);
    const [first, second] = cycle.solves.map(solvedFrame);
    expect(first!.plan).toEqual({
      origin: "firstChoice",
      adjacencies: [{ kind: "absorbed", keeper: "first" }],
    });
    expect(cycle.publications[0]).toEqual({
      status: "planChanged",
      derivationId: "derivation_g1",
      reason: "plan",
      plan: { origin: "certified", adjacencies: [{ kind: "arc" }] },
    });
    expect(second!.plan).toEqual({
      origin: "certified",
      adjacencies: [{ kind: "arc" }],
    });
    expect(cycle.publications[1]!.status).toBe("certified");
    if (!direct.ok) throw new Error(direct.message);
    expectCertifiedGeometry(certifiedOf(cycle), direct);
  });

  test("a representative-only disagreement (line–arc–line semicircle d = −0.1: same plan, pieces bitwise, one Newton representative 9 ulps outside its witness bounds) is planChanged; the re-solve keeps the witness representatives bitwise and verifies", () => {
    const { pair, seeds, distance } = d3Row("line-arc-line semicircle -0.1");
    const cycle = publishCycle(relationshipOf(seeds, distance), pair);
    const [first, second] = cycle.solves.map(solvedFrame);
    const changed = cycle.publications[0]!;
    if (changed.status !== "planChanged") throw new Error(changed.status);
    expect(changed.reason).toBe("representatives");
    const kinds = (plan: OffsetFramePlan) =>
      plan.adjacencies.map((entry) =>
        entry.kind === "trim" ? [entry.kind, entry.leaves] : [entry.kind],
      );
    expect(kinds(first!.plan)).toEqual(kinds(changed.plan));
    const publication = certifiedOf(cycle);
    expect(encode(first!.pieces)).toBe(encode(publication.frame.pieces));
    const witnesses = publication.certified.resolved.joints;
    expect(
      second!.trims.map((trim) => [
        trim.first.parameter,
        trim.second.parameter,
      ]),
    ).toEqual(
      witnesses.map((joint) => [joint.firstParameter, joint.secondParameter]),
    );
    const outside = first!.trims.filter((trim, index) => {
      const joint = witnesses[index]!;
      const within = (value: number, [low, high]: readonly [number, number]) =>
        value >= low && value <= high;
      return !(
        within(trim.first.parameter, joint.firstParameterBounds) &&
        within(trim.second.parameter, joint.secondParameterBounds)
      );
    });
    expect(outside.length).toBeGreaterThan(0);
  });

  test("a forced second mismatch fails closed: a certified-origin hint that is not the certifier's plan (fabricated: C φ=0.1's arc flipped back to absorption) is never re-solved again", () => {
    const { pair, seeds, distance } = chainRow("convex arc C φ=0.1 -0.01");
    const relationship = relationshipOf(seeds, distance);
    const hint = (origin: OffsetFramePlan["origin"]): OffsetFramePlan => ({
      origin,
      adjacencies: [{ kind: "absorbed", keeper: "first" }],
    });
    const hinted = solvedFrame(
      solveOf(relationship, pair.definition, hint("certified")),
    );
    expect(hinted.plan).toEqual(hint("certified"));
    const publication = failedOf(publishOf(relationship, pair, hinted));
    expect(publication.failure).toEqual({
      ok: false,
      code: codes.topologyUncertain,
      message: "The certified corner plan does not match the solved frame.",
      seedEntityId: hinted.pieces[0]!.seedEntityId,
    });
    // Control: the same frame from a published (stale) plan is a first mismatch.
    const stale = solvedFrame(
      solveOf(relationship, pair.definition, hint("published")),
    );
    expect(publishOf(relationship, pair, stale)).toMatchObject({
      status: "planChanged",
      reason: "plan",
    });
  });

  test("bitwise, not a tolerance: a solve frame of another definition iterate (fabricated pairing: one source point 1 ulp off the accepted pair) has the same plan and nearly the same pieces, and is planChanged, then fails closed as a hinted re-solve", () => {
    const { pair, seeds, distance } = chainRow("corner matrix LL-90 -0.01");
    const relationship = relationshipOf(seeds, distance);
    const moved = pair.definition.points[1]!;
    const iterate = {
      ...pair.definition,
      points: pair.definition.points.map((point) =>
        point === moved
          ? {
              ...point,
              position: [nextUp(point.position[0] || 1), point.position[1]],
            }
          : point,
      ),
    } as SketchDefinition;
    const genuine = solvedFrame(solveOf(relationship, pair.definition));
    const other = solvedFrame(solveOf(relationship, iterate));
    expect(other.plan).toEqual(genuine.plan);
    expect(encode(other.pieces)).not.toBe(encode(genuine.pieces));
    expect(publishOf(relationship, pair, genuine).status).toBe("certified");
    expect(publishOf(relationship, pair, other)).toMatchObject({
      status: "planChanged",
      reason: "plan",
    });
    const rehinted = solvedFrame(
      solveOf(relationship, iterate, { ...other.plan, origin: "certified" }),
    );
    expect(
      failedOf(publishOf(relationship, pair, rehinted)).failure.message,
    ).toBe("The certified corner plan does not match the solved frame.");
  });

  test("representatives must lie in the witness bounds: a published plan 64 ulps off the certified roots is a converged seed the frame keeps bitwise, and publish returns planChanged", () => {
    const { pair, seeds, distance } = chainRow("corner matrix LL-90 0.01");
    const relationship = relationshipOf(seeds, distance);
    const publication = certifiedOf(publishCycle(relationship, pair));
    const [trim] = publication.frame.trims;
    const shifted: readonly [number, number] = [
      nextUp(trim!.first.parameter, 64),
      trim!.second.parameter,
    ];
    const stale = solvedFrame(
      solveOf(relationship, pair.definition, {
        origin: "published",
        adjacencies: [
          { kind: "trim", leaves: [0, 0], representatives: shifted },
        ],
      }),
    );
    expect([
      stale.trims[0]!.first.parameter,
      stale.trims[0]!.second.parameter,
    ]).toEqual(shifted);
    expect(encode(stale.pieces)).toBe(encode(publication.frame.pieces));
    expect(publishOf(relationship, pair, stale)).toEqual({
      status: "planChanged",
      derivationId: "derivation_g1",
      reason: "representatives",
      plan: {
        origin: "certified",
        adjacencies: [
          {
            kind: "trim",
            leaves: [0, 0],
            representatives: [
              publication.certified.resolved.joints[0]!.firstParameter,
              publication.certified.resolved.joints[0]!.secondParameter,
            ],
          },
        ],
      },
    });
  });
});

describe("T08b-g1 frame owner: every published datum is bound to the certified pieces", () => {
  test("a solve frame whose published trim point is not the evaluation of its representative (fabricated frame, not solveOffsetFrame output: the point moved 1e-9) is planChanged", () => {
    const { pair, seeds, distance } = chainRow("corner matrix LL-90 0.01");
    const relationship = relationshipOf(seeds, distance);
    const genuine = solvedFrame(solveOf(relationship, pair.definition));
    expect(publishOf(relationship, pair, genuine).status).toBe("certified");
    const [trim] = genuine.trims;
    const position: readonly [number, number] = [
      trim!.position[0] + 1e-9,
      trim!.position[1],
    ];
    const lineArcEndpoints = new Map(
      [...genuine.lineArcEndpoints].map(([seed, ends]) => [
        seed,
        {
          ...ends,
          start: ends.startDomainEnd.kind === "joint" ? position : ends.start,
          end: ends.endDomainEnd.kind === "joint" ? position : ends.end,
        },
      ]),
    );
    const forged: OffsetSolveFrame = {
      ...genuine,
      trims: [{ ...trim!, position }],
      lineArcEndpoints,
    };
    expect(publishOf(relationship, pair, forged)).toMatchObject({
      status: "planChanged",
      reason: "plan",
    });
  });
});

describe("T08b-g1 frame owner: §2.1 published seed-arc checks (R12 family, 0/2π wrap guard, R7 removed leaves, micro arcs)", () => {
  /** A certifier port rewriting every verified seed-arc record (fabricated, not owner-reachable). */
  const rewritingCertifier = (
    rewrite: (
      record: NonNullable<
        Extract<
          TubePieceChainResult,
          { kind: "verified" }
        >["certificate"]["seedArcs"]
      >[number],
    ) => object,
    request: (chain: PieceTubeChainRequest) => PieceTubeChainRequest = (
      chain,
    ) => chain,
  ): CertifiedTubePieceChainRequests => ({
    openRequest: (attempts) => {
      const inner = certifier.openRequest(attempts);
      return {
        certifyPieceChain: (chain) => {
          const result = inner.certifyPieceChain(request(chain));
          if (result.kind !== "verified") return result;
          return {
            ...result,
            certificate: {
              ...result.certificate,
              seedArcs: result.certificate.seedArcs?.map((record) => ({
                ...record,
                ...rewrite(record),
              })),
            },
          };
        },
      };
    },
  });

  test("R12 is load-bearing natively: a trimmed-start seed arc (half-disc d = 0.1) publishes hypot(X_rep − C), bitwise off the certified ρ_o but inside the certified family", () => {
    const { pair, seeds, distance } = d3Row("half-disc 0.1");
    const publication = certifiedOf(
      publishCycle(relationshipOf(seeds, distance), pair),
    );
    const { frame } = publication;
    const trimmed = publication.certified.certificate.seedArcs!.filter(
      (record) => {
        const piece = frame.pieces[record.piece]!;
        return (
          frame.lineArcEndpoints.get(piece.seedEntityId)?.startDomainEnd
            .kind === "joint"
        );
      },
    );
    expect(trimmed).toHaveLength(1);
    const record = trimmed[0]!;
    const piece = frame.pieces[record.piece]!;
    if (piece.kind !== "arc") throw new Error("not a seed arc");
    const ends = frame.lineArcEndpoints.get(piece.seedEntityId)!;
    const radius = Math.hypot(
      ends.start[0] - piece.center[0],
      ends.start[1] - piece.center[1],
    );
    expect(radius).not.toBe(record.radius);
    expect(radius).toBeGreaterThanOrEqual(record.radiusFamily[0]);
    expect(radius).toBeLessThanOrEqual(record.radiusFamily[1]);
  });

  test("R12 adversary (fabricated certificate, not owner-reachable): a radius family that excludes the published radius fails closed", () => {
    const { pair, seeds, distance } = d3Row("line-arc-line semicircle -0.1");
    const cycle = publishCycle(relationshipOf(seeds, distance), pair, {
      query,
      certifier: rewritingCertifier((record) => ({
        radiusFamily: [record.radius + 2 ** -20, record.radius + 2 ** -20],
      })),
    });
    expect(failedOf(cycle.final as OffsetFramePublication).failure).toEqual({
      ok: false,
      code: codes.topologyUncertain,
      message:
        "The published seed-arc radius lies outside the certified radius family.",
      seedEntityId: seeds[1],
    });
  });

  test("wrap-guard adversary (fabricated query bounds, certificate family and solve frame, not owner-reachable): published trimmed ends one ulp apart whose binary64 atan2 sweep wraps to a full turn fail closed", () => {
    // The flat 37° cap: ONE leaf trimmed at both natural ends (joints 0, 1).
    const { pair, seeds, distance } = d3Row("line-arc-line flat cap -0.1");
    const relationship = relationshipOf(seeds, distance);
    const genuine = certifiedOf(publishCycle(relationship, pair));
    const arc = genuine.frame.pieces[1]!;
    if (arc.kind !== "arc") throw new Error("not a seed arc");
    const point = (angle: number): readonly [number, number] => [
      arc.center[0] + arc.radius * Math.cos(angle),
      arc.center[1] + arc.radius * Math.sin(angle),
    ];
    // Two angles one ulp apart inside the retained cap whose points wrap
    // under the consumer's binary64 atan2 (a tie): searched, deterministic.
    const joints = genuine.certified.resolved.joints;
    expect(arc.sweepDirection).toBe("counterClockwise");
    const low = joints[0]!.secondParameter;
    const high = joints[1]!.firstParameter;
    let angles: readonly [number, number] | undefined;
    for (let sample = 1; sample <= 200 && !angles; sample += 1)
      for (let step = 0; step < 2000 && !angles; step += 1) {
        const start = nextUp(low + ((high - low) * sample) / 201, step);
        const end = nextUp(start);
        if (
          !offsetArcSweepAdmissible(
            arc.center,
            point(start),
            point(end),
            arc.sweepDirection,
          )
        )
          angles = [start, end];
      }
    if (!angles) throw new Error("no wrapping angle pair in the cap");
    const [startAngle, endAngle] = angles;
    expect(startAngle).toBeLessThan(endAngle);
    // Fabricated query: the arc-side witness bounds stretched into the
    // cap, still ordered (joint 0 up to the start angle, joint 1 down from
    // the end angle), so the resolver's trim-order check still holds.
    const widen = (
      bounds: readonly [number, number],
      side: "first" | "second",
    ) =>
      side === "second"
        ? ([bounds[0], Math.max(bounds[1], startAngle)] as const)
        : ([Math.min(bounds[0], endAngle), bounds[1]] as const);
    const fabricatedQuery: CertifiedNeutralCurveRequestQuery = {
      openRequest: (size) => {
        const inner = query.openRequest(size);
        return {
          queryPair: (request) => {
            const result = inner.queryPair(request);
            if (result.kind !== "verified" || result.points.length !== 1)
              return result;
            const arcSide =
              request.first.kind === "circle" ? "first" : "second";
            const [witness] = result.points;
            const proof = witness!.proof;
            return {
              ...result,
              points: [
                {
                  ...witness!,
                  proof: {
                    ...proof,
                    ...(arcSide === "first"
                      ? {
                          firstParameterBounds: widen(
                            proof.firstParameterBounds,
                            "first",
                          ),
                        }
                      : {
                          secondParameterBounds: widen(
                            proof.secondParameterBounds,
                            "second",
                          ),
                        }),
                  },
                },
              ],
            } as NeutralCurveQueryResult;
          },
        };
      },
    };
    // Fabricated certifier: certifies the genuine (unwidened) trims and
    // reports an unbounded radius family, so only the wrap guard remains.
    const genuineTrims = new Map(
      joints.map((joint) => [
        joint.jointIndex,
        [joint.firstParameterBounds, joint.secondParameterBounds] as const,
      ]),
    );
    const fabricatedCertifier = rewritingCertifier(
      () => ({ radiusFamily: [0, Number.POSITIVE_INFINITY] }),
      (chain) => ({
        ...chain,
        trims: chain.trims.map((trim) => ({
          ...trim,
          firstParameterBounds: genuineTrims.get(trim.jointIndex)![0],
          secondParameterBounds: genuineTrims.get(trim.jointIndex)![1],
        })),
      }),
    );
    // Fabricated frame: the arc-side representatives moved to the angles.
    const moved = (trim: OffsetSolveFrame["trims"][number]) =>
      trim.jointIndex === 0
        ? {
            ...trim,
            second: { ...trim.second, parameter: startAngle },
            position: point(startAngle),
          }
        : {
            ...trim,
            first: { ...trim.first, parameter: endAngle },
            position: point(endAngle),
          };
    const trims = genuine.frame.trims.map(moved);
    const lineArcEndpoints = new Map(
      [...genuine.frame.lineArcEndpoints].map(([seed, ends]) => {
        const position = (
          end: typeof ends.startDomainEnd,
          own: readonly [number, number],
        ) => (end.kind === "joint" ? trims[end.jointIndex]!.position : own);
        return [
          seed,
          {
            ...ends,
            start: position(ends.startDomainEnd, ends.start),
            end: position(ends.endDomainEnd, ends.end),
          },
        ] as const;
      }),
    );
    const frame: OffsetSolveFrame = {
      ...genuine.frame,
      plan: {
        origin: "certified",
        adjacencies: genuine.frame.plan.adjacencies.map((entry, index) =>
          entry.kind === "trim"
            ? {
                ...entry,
                representatives: [
                  trims[index]!.first.parameter,
                  trims[index]!.second.parameter,
                ],
              }
            : entry,
        ),
      },
      trims,
      lineArcEndpoints,
    };
    const publication = publishOf(relationship, pair, frame, {
      query: fabricatedQuery,
      certifier: fabricatedCertifier,
    });
    expect(failedOf(publication).failure).toEqual({
      ok: false,
      code: codes.topologyUncertain,
      message:
        "A published seed-arc end wraps across 0/2π against its exact sweep.",
      seedEntityId: arc.seedEntityId,
    });
  });

  test("joint-arc wrap-guard adversary (review R2; fabricated certifier port, not owner-reachable: the real SEL absorbs this corner): a native near-collinear convex line↔line corner with its arc authored, whose published F1 arc's binary64 atan2 sweep wraps, fails closed; one ulp more turn certifies (control)", () => {
    /** Fabricated: rejects the absorbed corner at its two terminal leaves, verifies any chain declaring an arc. */
    const arcOnlyCertifier: CertifiedTubePieceChainRequests = {
      openRequest: () => ({
        certifyPieceChain: (chain) =>
          (chain.arcs ?? []).length > 0
            ? {
                kind: "verified",
                certificate: {
                  joins: [],
                  leaves: [],
                  clearedPairs: [],
                  maxSplits: 0,
                },
              }
            : {
                kind: "uncertain",
                code: "cubic-tube-clearance-unproven",
                message: "fabricated: the absorbed corner is not certified",
                first: 0,
                second: 1,
              },
      }),
    };
    const corner = (ulps: number) => {
      const row = nearCollinearCornerRow(ulps);
      const harness = matrixHarnesses.native;
      harness.resetSequence();
      const pair = harness.solvedPair(row.build(harness));
      const seeds = pair.definition.entities.map((entity) => entity.entityId);
      return {
        pair,
        seeds,
        relationship: relationshipOf(seeds, row.distance, [0]),
      };
    };
    const wrapped = corner(1);
    // Natively the SEL absorbs the corner, so the authored arc is topologyChanged.
    const { declared } = checkedOf(wrapped.pair, wrapped.seeds, 0.25);
    if (!declared.ok) throw new Error(declared.message);
    const real = certifyDeclaredOffsetChain(declared, query, certifier);
    if (!real.ok) throw new Error(real.message);
    expect(real.resolved.arcs).toEqual([]);
    // The solve frame's arc (the SEL's F1 construction) wraps under atan2.
    const frame = solvedFrame(
      solveOf(wrapped.relationship, wrapped.pair.definition),
    );
    const [arc] = frame.arcs;
    expect(
      arc &&
        offsetArcSweepAdmissible(
          arc.center,
          arc.start,
          arc.end,
          arc.sweepDirection,
        ),
    ).toBe(false);
    const cycle = publishCycle(wrapped.relationship, wrapped.pair, {
      query,
      certifier: arcOnlyCertifier,
    });
    expect(cycle.publications).toHaveLength(1);
    expect(failedOf(cycle.final as OffsetFramePublication).failure).toEqual({
      ok: false,
      code: codes.topologyUncertain,
      message:
        "A published joint-arc end wraps across 0/2π against its exact sweep.",
      seedEntityId: wrapped.seeds[0],
    });
    // Control: the same fabricated port on an admissible arc certifies it.
    const admissible = corner(2);
    const control = certifiedOf(
      publishCycle(admissible.relationship, admissible.pair, {
        query,
        certifier: arcOnlyCertifier,
      }),
    );
    expect(control.frame.arcs).toHaveLength(1);
  });

  test("R7: a deep arc-leaf trim publishes its removed leaves, the certificate's own", () => {
    const { pair, seeds, distance } = d3Row(
      "line-arc-line semicircle long (R7) -2",
    );
    const publication = certifiedOf(
      publishCycle(relationshipOf(seeds, distance), pair),
    );
    const arc = publication.frame.pieces[1]!;
    expect(
      publication.frame.lineArcEndpoints.get(arc.seedEntityId)?.removedLeaves,
    ).toEqual([1, 1]);
    expect(publication.certified.certificate.seedArcs![0]!.removed).toEqual([
      1, 1,
    ]);
  });

  test("[TECH] G10: a micro seed arc (native quarter arc, certified R ≈ 4.8e-7 < 1e-6) is published as certified with no new threshold", () => {
    const { pair, seeds, distance } = d3Row(
      `quarter arc micro ${1 - 2 ** -21}`,
    );
    const publication = certifiedOf(
      publishCycle(relationshipOf(seeds, distance), pair),
    );
    const [record] = publication.certified.certificate.seedArcs!;
    expect(record!.radius).toBeGreaterThan(0);
    expect(record!.radius).toBeLessThan(1e-6);
  });
});

describe("T08b-g1 frame owner: [TECH] G5/G6/G16 relationship-scoped results, authored arc presence, diagnostics", () => {
  test("G6: authored arc presence is intent: the arc authored at C φ=0.1 publishes with no re-solve; authored without it, the certified arc is topologyChanged", () => {
    const { pair, seeds, distance } = chainRow("convex arc C φ=0.1 -0.01");
    const withArc = publishCycle(relationshipOf(seeds, distance, [0]), pair);
    expect(withArc.publications.map((item) => item.status)).toEqual([
      "certified",
    ]);
    const withoutArc = publishCycle(relationshipOf(seeds, distance, []), pair);
    expect(withoutArc.solves.map((item) => item.ok)).toEqual([true]);
    expect(
      failedOf(withoutArc.final as OffsetFramePublication).failure,
    ).toMatchObject({
      code: codes.topologyChanged,
      message: "The certified corner plan changes the authored arc set.",
    });
  });

  test("G5/G16: two relationships in one accepted sketch publish independently; a failure is a source-linked relationship diagnostic and never touches the solve's diagnostics", () => {
    const polygon = arcHarness.polygon(arcHarness.empty(), [
      [0, 0],
      [2, 0],
      [2, 1],
      [0, 1],
    ]);
    const circle = arcHarness.circle(polygon.definition, [5, 0], [6, 0]);
    const withOffsets = arcHarness.withOffset(
      arcHarness.withOffset(circle.definition, polygon.ids, 0.01).definition,
      [circle.id],
      0.01,
    ).definition;
    const pair = arcHarness.solved(withOffsets);
    const before = encode(pair.solvedSnapshot);
    const square = relationshipOf(polygon.ids, 0.01);
    const collapsed = {
      ...relationshipOf([circle.id], 1.5),
      derivationId: "derivation_g1_circle",
    };
    expect(certifiedOf(publishCycle(square, pair)).derivationId).toBe(
      "derivation_g1",
    );
    // The collapsing circle fails in the solve frame (a projection
    // diagnostic) and, published against its frame's twin, in publish.
    const solved = solveOf(collapsed, pair.definition);
    expect(solved.ok).toBe(false);
    const frame = solvedFrame(
      solveOf({ ...collapsed, distance: 0.01 }, pair.definition),
    );
    const publication = failedOf(publishOf(collapsed, pair, frame));
    expect(publication).toEqual({
      status: "failed",
      derivationId: "derivation_g1_circle",
      failure: {
        ok: false,
        code: codes.arcCollapse,
        message: "Offset distance collapses the circle radius.",
        seedEntityId: circle.id,
      },
      diagnostic: {
        code: codes.arcCollapse,
        severity: "error",
        message:
          "Offset relationship derivation_g1_circle: Offset distance collapses the circle radius.",
        target: { kind: "entity", entityId: circle.id },
      },
    });
    expect(encode(pair.solvedSnapshot)).toBe(before);
  });

  test("G4: the unchecked builder runs on a definition iterate the checked adapter rejects (no accepted pair), with the checked adapter's construction", () => {
    const { pair, seeds, distance } = chainRow("corner matrix LL-90 0.01");
    const { connectivity, declared } = checkedOf(pair, seeds, distance);
    if (!declared.ok) throw new Error(declared.message);
    const moved = pair.definition.points[0]!;
    const iterate = {
      ...pair.definition,
      points: pair.definition.points.map((point) =>
        point === moved
          ? { ...point, position: [point.position[0] + 0.5, point.position[1]] }
          : point,
      ),
    } as SketchDefinition;
    expect(
      declaredOffsetChainPieces({
        definition: iterate,
        solvedSnapshot: pair.solvedSnapshot,
        connectivity,
        distance,
        modelingTolerance: TOLERANCE,
      }),
    ).toMatchObject({
      ok: false,
      message: "The line seed geometry does not match the solve frame.",
    });
    const unchecked = uncheckedDeclaredOffsetChainPieces({
      definition: iterate,
      connectivity,
      distance,
      modelingTolerance: TOLERANCE,
    });
    expect(unchecked).toMatchObject({ ok: true, checked: false });
    if (!unchecked.ok) throw new Error(unchecked.message);
    const owner = pair.definition.entities.find(
      (entity) =>
        entity.kind === "lineSegment" && entity.startPointId === moved.pointId,
    )!.entityId;
    unchecked.pieces.forEach((piece, index) =>
      expect(
        encode(piece) === encode(declared.pieces[index]),
        piece.seedEntityId,
      ).toBe(piece.seedEntityId !== owner),
    );
  });
});

describe("T08b-g1 frame owner: brands (type-level, tsc)", () => {
  test("only the certifying entries construct the branded results; the unchecked builder's output is no SEL input", () => {
    const { pair, seeds, distance } = chainRow("corner matrix LL-90 -0.01");
    const publication = certifiedOf(
      publishCycle(relationshipOf(seeds, distance), pair),
    );
    const { certified, frame, plan } = publication;
    // @ts-expect-error the verified tube result is branded (T08b-a math A2)
    const forgedResult: CertifiedOffsetChainTubeStability = {
      ok: true,
      resolved: certified.resolved,
      seedEntityId: certified.seedEntityId,
      certificate: certified.certificate,
    };
    // @ts-expect-error only publishOffsetFrame constructs a certified publication
    const forgedPublication: CertifiedOffsetFramePublication = {
      status: "certified",
      derivationId: "derivation_g1",
      frame,
      certified,
      plan,
    };
    const { connectivity } = checkedOf(pair, seeds, distance);
    const unchecked = uncheckedDeclaredOffsetChainPieces({
      definition: pair.definition,
      connectivity,
      distance,
      modelingTolerance: TOLERANCE,
    });
    if (!unchecked.ok) throw new Error(unchecked.message);
    // @ts-expect-error the unchecked solve-frame pieces are never an SEL input
    const selInput: DeclaredOffsetChainPieces = unchecked;
    expect([forgedResult.ok, forgedPublication.status, selInput.ok]).toEqual([
      true,
      "certified",
      true,
    ]);
  });

  test("review R1: spreading or destructuring a genuine value does not forge a brand", () => {
    const { pair, seeds, distance } = chainRow("corner matrix LL-90 -0.01");
    const relationship = relationshipOf(seeds, distance);
    const publication = certifiedOf(publishCycle(relationship, pair));
    const other = certifiedOf(
      publishCycle(relationshipOf(seeds, -distance), pair),
    );
    // @ts-expect-error a spread of a genuine publication with another frame is no publication
    const forgedPublication: CertifiedOffsetFramePublication = {
      ...publication,
      frame: other.frame,
    };
    // @ts-expect-error a spread of a genuine tube result with another resolution is no tube result
    const forgedResult: CertifiedOffsetChainTubeStability = {
      ...publication.certified,
      resolved: other.certified.resolved,
    };
    const { connectivity } = checkedOf(pair, seeds, distance);
    const unchecked = uncheckedDeclaredOffsetChainPieces({
      definition: pair.definition,
      connectivity,
      distance,
      modelingTolerance: TOLERANCE,
    });
    if (!unchecked.ok) throw new Error(unchecked.message);
    const { checked, ...rest } = unchecked;
    // @ts-expect-error unchecked pieces with the marker destructured away are still no SEL input
    const selInput: DeclaredOffsetChainPieces = rest;
    // Runtime: the forgeries are plain copies, the genuine values are not.
    expect([
      checked,
      forgedPublication.frame === other.frame,
      forgedResult.resolved === other.certified.resolved,
      selInput.pieces === unchecked.pieces,
      Object.getPrototypeOf(forgedPublication) === Object.prototype,
      Object.getPrototypeOf(publication) === Object.prototype,
      Object.getPrototypeOf(publication.certified) === Object.prototype,
    ]).toEqual([false, true, true, true, true, false, false]);
  });
});

// ---------------------------------------------------------------------------
// T08b-g2: frame derivatives, pullback and residual helper
// ---------------------------------------------------------------------------

type V2 = readonly [number, number];
const angleOf = (center: V2, point: V2) =>
  Math.atan2(point[1] - center[1], point[0] - center[0]);

/**
 * Test-only flattening of every published datum of a frame (the FD side),
 * keyed as `flattenJvp` keys the JVP.
 */
function flattenFrame(frame: OffsetSolveFrame) {
  const out = new Map<string, number>();
  const vec = (key: string, value: V2) => {
    out.set(`${key}.x`, value[0]);
    out.set(`${key}.y`, value[1]);
  };
  for (const [seed, spans] of frame.cubics)
    spans.forEach((span, leaf) => {
      span.span.poles.forEach((pole, k) =>
        vec(`c:${seed}:${leaf}:p${k}`, pole),
      );
      out.set(`c:${seed}:${leaf}:q0`, span.representativeQueryDomain[0]);
      out.set(`c:${seed}:${leaf}:q1`, span.representativeQueryDomain[1]);
    });
  for (const [seed, ends] of frame.lineArcEndpoints) {
    vec(`e:${seed}:s`, ends.start);
    vec(`e:${seed}:e`, ends.end);
  }
  for (const piece of frame.pieces) {
    const seed = piece.seedEntityId;
    if (piece.kind === "arc") {
      const ends = frame.lineArcEndpoints.get(seed)!;
      vec(`a:${seed}:c`, piece.center);
      out.set(
        `a:${seed}:r`,
        Math.hypot(
          ends.start[0] - piece.center[0],
          ends.start[1] - piece.center[1],
        ),
      );
      out.set(`a:${seed}:t0`, angleOf(piece.center, ends.start));
      out.set(`a:${seed}:t1`, angleOf(piece.center, ends.end));
      vec(`a:${seed}:s`, ends.start);
      vec(`a:${seed}:e`, ends.end);
    }
    if (piece.kind === "circle") {
      vec(`o:${seed}:c`, piece.center);
      out.set(`o:${seed}:r`, piece.radius);
    }
  }
  for (const trim of frame.trims) {
    vec(`t:${trim.jointIndex}:p`, trim.position);
    out.set(`t:${trim.jointIndex}:s`, trim.first.parameter);
    out.set(`t:${trim.jointIndex}:t`, trim.second.parameter);
  }
  for (const arc of frame.arcs) {
    vec(`j:${arc.jointIndex}:c`, arc.center);
    vec(`j:${arc.jointIndex}:s`, arc.start);
    vec(`j:${arc.jointIndex}:e`, arc.end);
    out.set(`j:${arc.jointIndex}:r`, arc.radius);
    out.set(`j:${arc.jointIndex}:t0`, angleOf(arc.center, arc.start));
    out.set(`j:${arc.jointIndex}:t1`, angleOf(arc.center, arc.end));
  }
  return out;
}

function flattenJvp(jvp: OffsetFrameJvp) {
  const out = new Map<string, number>();
  const vec = (key: string, value: V2) => {
    out.set(`${key}.x`, value[0]);
    out.set(`${key}.y`, value[1]);
  };
  const arc = (key: string, value: OffsetFrameArcVariation) => {
    vec(`${key}:c`, value.center);
    out.set(`${key}:r`, value.radius);
    out.set(`${key}:t0`, value.startAngle);
    out.set(`${key}:t1`, value.endAngle);
    vec(`${key}:s`, value.start);
    vec(`${key}:e`, value.end);
  };
  for (const [seed, spans] of jvp.cubics)
    spans.forEach((span, leaf) => {
      span.poles.forEach((pole, k) => vec(`c:${seed}:${leaf}:p${k}`, pole));
      out.set(`c:${seed}:${leaf}:q0`, span.queryDomain[0]);
      out.set(`c:${seed}:${leaf}:q1`, span.queryDomain[1]);
    });
  for (const [seed, ends] of jvp.lineArcEndpoints) {
    vec(`e:${seed}:s`, ends.start);
    vec(`e:${seed}:e`, ends.end);
  }
  for (const [seed, value] of jvp.seedArcs) arc(`a:${seed}`, value);
  for (const [seed, value] of jvp.circles) {
    vec(`o:${seed}:c`, value.center);
    out.set(`o:${seed}:r`, value.radius);
  }
  for (const trim of jvp.trims) {
    vec(`t:${trim.jointIndex}:p`, trim.position);
    out.set(`t:${trim.jointIndex}:s`, trim.first);
    out.set(`t:${trim.jointIndex}:t`, trim.second);
  }
  for (const value of jvp.arcs) arc(`j:${value.jointIndex}`, value);
  return out;
}

/** The definition moved by h·v (points, authored tangents, circle radii). */
function perturbed(
  definition: SketchDefinition,
  variation: OffsetFrameVariation,
  h: number,
): SketchDefinition {
  const moved = (value: V2, by: V2 | undefined): V2 =>
    by ? [value[0] + h * by[0], value[1] + h * by[1]] : value;
  return {
    ...definition,
    points: definition.points.map((point) =>
      variation.points?.[point.pointId]
        ? {
            ...point,
            position: moved(point.position, variation.points[point.pointId]),
          }
        : point,
    ),
    entities: definition.entities.map((entity) => {
      if (
        entity.kind === "circle" &&
        variation.circleRadii?.[entity.entityId] !== undefined
      )
        return {
          ...entity,
          radius: entity.radius + h * variation.circleRadii[entity.entityId]!,
        };
      const tangents = variation.splineTangents?.[entity.entityId];
      if (entity.kind !== "spline" || !tangents) return entity;
      return {
        ...entity,
        pointOccurrences: entity.pointOccurrences.map((occurrence) =>
          occurrence.tangent.kind === "authored" &&
          tangents[occurrence.occurrenceId]
            ? {
                ...occurrence,
                tangent: {
                  kind: "authored" as const,
                  vector: moved(
                    occurrence.tangent.vector,
                    tangents[occurrence.occurrenceId],
                  ),
                },
              }
            : occurrence,
        ),
      };
    }),
  } as SketchDefinition;
}

/** Deterministic pseudo-random numbers in (−1, 1). */
function prng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return (state / 2 ** 31) * 2 - 1;
  };
}

/** A random direction over a frame's source DOFs (optionally one DOF kind only). */
function randomVariation(
  dofs: readonly OffsetFrameSourceDof[],
  random: () => number,
  only?: OffsetFrameSourceDof["kind"],
): OffsetFrameVariation {
  const points: Record<string, [number, number]> = {};
  const splineTangents: Record<string, Record<string, [number, number]>> = {};
  const circleRadii: Record<string, number> = {};
  for (const dof of dofs) {
    if (only && dof.kind !== only) continue;
    if (dof.kind === "point")
      (points[dof.pointId] ??= [0, 0])[dof.axis] = random();
    else if (dof.kind === "tangent")
      ((splineTangents[dof.entityId] ??= {})[dof.occurrenceId] ??= [0, 0])[
        dof.axis
      ] = random();
    else circleRadii[dof.entityId] = random();
  }
  return { points, splineTangents, circleRadii };
}

/** A random cotangent on every datum of a JVP (same shape). */
function randomCotangent(
  jvp: OffsetFrameJvp,
  random: () => number,
): OffsetFrameCotangent {
  const vec = (): V2 => [random(), random()];
  const arc = () => ({
    center: vec(),
    start: vec(),
    end: vec(),
    radius: random(),
    startAngle: random(),
    endAngle: random(),
  });
  return {
    cubics: new Map(
      [...jvp.cubics].map(([seed, spans]) => [
        seed,
        spans.map(() => ({
          poles: [vec(), vec(), vec(), vec()] as const,
          queryDomain: vec(),
        })),
      ]),
    ),
    lineArcEndpoints: new Map(
      [...jvp.lineArcEndpoints.keys()].map((seed) => [
        seed,
        { start: vec(), end: vec() },
      ]),
    ),
    seedArcs: new Map([...jvp.seedArcs.keys()].map((seed) => [seed, arc()])),
    circles: new Map(
      [...jvp.circles.keys()].map((seed) => [
        seed,
        { center: vec(), radius: random() },
      ]),
    ),
    trims: jvp.trims.map((trim) => ({
      jointIndex: trim.jointIndex,
      position: vec(),
      first: random(),
      second: random(),
    })),
    arcs: jvp.arcs.map((value) => ({ jointIndex: value.jointIndex, ...arc() })),
  };
}

/** ⟨v, u⟩ over the source space. */
function sourcePairing(v: OffsetFrameVariation, u: OffsetFrameVariation) {
  let sum = 0;
  for (const [id, value] of Object.entries(v.points ?? {}))
    sum +=
      value[0] * (u.points?.[id]?.[0] ?? 0) +
      value[1] * (u.points?.[id]?.[1] ?? 0);
  for (const [entity, occurrences] of Object.entries(v.splineTangents ?? {}))
    for (const [id, value] of Object.entries(occurrences))
      sum +=
        value[0] * (u.splineTangents?.[entity]?.[id]?.[0] ?? 0) +
        value[1] * (u.splineTangents?.[entity]?.[id]?.[1] ?? 0);
  for (const [id, value] of Object.entries(v.circleRadii ?? {}))
    sum += value * (u.circleRadii?.[id] ?? 0);
  return sum;
}

/** ⟨jvp, w⟩ over the published data (test-only, flattened). */
function outputPairing(jvp: OffsetFrameJvp, w: OffsetFrameCotangent) {
  const cotangentJvp: OffsetFrameJvp = {
    cubics: new Map(
      [...(w.cubics ?? [])].map(([seed, spans]) => [
        seed,
        spans.map((span) => ({
          poles: span!.poles!,
          queryDomain: span!.queryDomain!,
        })),
      ]),
    ),
    lineArcEndpoints: new Map(
      [...(w.lineArcEndpoints ?? [])].map(([seed, ends]) => [
        seed,
        { start: ends.start!, end: ends.end! },
      ]),
    ),
    seedArcs: new Map(
      [...(w.seedArcs ?? [])].map(([seed, value]) => [
        seed,
        value as OffsetFrameArcVariation,
      ]),
    ),
    circles: new Map(
      [...(w.circles ?? [])].map(([seed, value]) => [
        seed,
        { center: value.center!, radius: value.radius! },
      ]),
    ),
    trims: (w.trims ?? []) as OffsetFrameJvp["trims"],
    arcs: (w.arcs ?? []) as OffsetFrameJvp["arcs"],
  };
  const a = flattenJvp(jvp);
  const b = flattenJvp(cotangentJvp);
  let sum = 0;
  for (const [key, value] of b) sum += value * (a.get(key) ?? Number.NaN);
  return sum;
}

/**
 * The d-A3 row's FD direction: x-only point and tangent moves keep its
 * vertex exactly parallel with bitwise-shared poles, so the perturbed
 * frames keep the plan (a generic direction breaks the bitwise sharing and
 * the line, trimmed at its other end, cannot adopt: FD is undefined there).
 */
const horizontal = (variation: OffsetFrameVariation): OffsetFrameVariation => ({
  points: Object.fromEntries(
    Object.entries(variation.points ?? {}).map(([id, value]) => [
      id,
      [value[0], 0] as const,
    ]),
  ),
  splineTangents: Object.fromEntries(
    Object.entries(variation.splineTangents ?? {}).map(([id, occurrences]) => [
      id,
      Object.fromEntries(
        Object.entries(occurrences).map(([occurrence, value]) => [
          occurrence,
          [value[0], 0] as const,
        ]),
      ),
    ]),
  ),
});

const FD_STEP = 1e-6;
/**
 * FD bound: truncation O(h²·|f‴|) plus rounding O(ε·|f|/h) plus the Newton
 * trims' convergence (to the step's rounding fixpoint) at h = 1e-6 are
 * about 1e-9 relative on these rows (measured worst 9.5e-9); the bound is
 * 1e-7·max(1, |JVP|). The mutants move the affected entries by O(1).
 */
const FD_BOUND = 1e-7;

interface DerivativeRow {
  readonly label: string;
  readonly pair: AcceptedPair;
  readonly seeds: readonly SketchEntityId[];
  readonly distance: number;
}

const derivativeRows = offsetFrameDerivativeRows();
const derivativeRow = (label: string): DerivativeRow => {
  const row = derivativeRows.find(
    (item) => `${item.row} ${item.distance}` === label,
  );
  if (!row) throw new Error(`no row ${label}`);
  const harness = matrixHarnesses[row.harness];
  harness.resetSequence();
  const pair = harness.solvedPair(row.build(harness));
  return {
    label,
    pair,
    seeds: pair.definition.entities.map((entity) => entity.entityId),
    distance: row.distance,
  };
};
const d3DerivativeRow = (label: string): DerivativeRow => ({
  label,
  ...d3Row(label),
});

/** Native SS-60 with a Fix / Fix / Coincident source gap (3e-4, 2e-4) at its vertex (the T08b-e gapped row). */
function gappedSs60Row(distance: number): DerivativeRow {
  const harness = matrixHarnesses.native;
  harness.resetSequence();
  const first = harness.drawSpline([], ARCH_POINTS);
  const second = harness.drawSpline(
    [first],
    [[2 + 3e-4, 2e-4], ...SS_60_OUTGOING.slice(1)],
  );
  const end = harness.splineEnds(first)[1];
  const start = harness.splineEnds(second)[0];
  let definition = harness.sketch([first, second]);
  const commit = (
    toolId: SketchConstraintToolId,
    points: readonly SketchPointId[],
  ) => {
    const step = harness.nextSequence();
    const contribution = getSketchConstraintDefinition(
      toolId,
    ).createCommitContribution({
      sequence: step,
      selectedTargets: points.map((pointId) => {
        const record = resolveSketchConstraintTarget(
          toolId,
          definition,
          createSketchPointRef("sketch_g1n" as SketchId, pointId),
        );
        if (!record) throw new Error(`${toolId} rejected ${pointId}`);
        return record;
      }),
      pointer: null,
      value: null,
      annotationPlacement: null,
      createConstraintId: (suffix) => `constraint_${step}_${suffix}` as const,
      createDimensionId: (suffix) => `dimension_${step}_${suffix}` as const,
    });
    const constraints = contribution.constraints ?? [];
    definition = {
      ...definition,
      constraintIds: [
        ...definition.constraintIds,
        ...constraints.map((item) => item.constraintId),
      ],
      constraints: [...definition.constraints, ...constraints],
    };
  };
  commit("constraintFix", [end]);
  commit("constraintFix", [start]);
  commit("constraintCoincident", [end, start]);
  const solved = solveCommittedConstraintDefinition(
    definition,
    [],
    SKETCH_DIRECT_EDIT_TOLERANCES,
    [],
    { modelingTolerance: 1e-3 },
  );
  if (!solved.solvedSnapshot)
    throw new Error("gapped SS-60 was not solver-accepted");
  const pair = solved as AcceptedPair;
  return {
    label: `gapped coincident SS-60 (3e-4, 2e-4) ${distance}`,
    pair,
    seeds: pair.definition.entities.map((entity) => entity.entityId),
    distance,
  };
}

function frameAndDerivatives(row: DerivativeRow) {
  const relationship = relationshipOf(row.seeds, row.distance);
  const input = {
    relationship,
    definition: row.pair.definition,
    modelingTolerance: TOLERANCE,
  };
  const frame = solvedFrame(solveOffsetFrame(input));
  return {
    relationship,
    input,
    frame,
    derivatives: prepareOffsetFrameDerivatives(input, frame),
  };
}

const jvpOf = (
  result: OffsetFrameJvp | OffsetChainFailure | undefined,
): OffsetFrameJvp => {
  if (!result || "ok" in result)
    throw new Error(`JVP unavailable: ${result?.message}`);
  return result;
};

/** Central FD of every published datum along v (fixed plan: the frame's own, as a published hint). */
function expectJvpMatchesFd(
  row: DerivativeRow,
  variation: OffsetFrameVariation,
) {
  const { relationship, frame, derivatives } = frameAndDerivatives(row);
  const jvp = flattenJvp(jvpOf(derivatives.jvp([variation])[0]));
  const plan: OffsetFramePlan = {
    origin: "published",
    adjacencies: frame.plan.adjacencies,
  };
  const side = (h: number) =>
    flattenFrame(
      solvedFrame(
        solveOffsetFrame(
          {
            relationship,
            definition: perturbed(row.pair.definition, variation, h),
            modelingTolerance: TOLERANCE,
          },
          plan,
        ),
      ),
    );
  const plus = side(FD_STEP);
  const minus = side(-FD_STEP);
  expect(
    [...jvp.keys()].sort(),
    `${row.label}: the JVP covers every published datum`,
  ).toEqual([...flattenFrame(frame).keys()].sort());
  let worst = 0;
  for (const [key, value] of jvp) {
    let difference = plus.get(key)! - minus.get(key)!;
    // Angles and circle-leaf trim parameters are compared modulo 2π.
    if (/:t[01]$|^t:\d+:[st]$/.test(key))
      difference = Math.atan2(Math.sin(difference), Math.cos(difference));
    const fd = difference / (2 * FD_STEP);
    const error = Math.abs(fd - value) / Math.max(1, Math.abs(value));
    worst = Math.max(worst, error);
    expect(
      error,
      `${row.label} ${key}: FD ${fd} vs JVP ${value}`,
    ).toBeLessThanOrEqual(FD_BOUND);
  }
  return { worst, keys: jvp.size, frame, jvp };
}

const D3_DERIVATIVE_ROWS = [
  "rounded rect 0.1",
  "rounded rect -0.1",
  "rounded rect 0.01",
  "line-arc-line semicircle long (R7) -2",
  "lens 0.1",
  "lens -0.1",
  "half-disc 0.1",
  "circle 0.5",
  "line-arc-line cap 0.1",
  "two semicircles 0.01",
  "two semicircles -0.01",
  "S-curve 0.01",
  "arc→spline corner 0.01",
  "arc→spline corner -0.01",
] as const;

describe("T08b-g2 frame derivatives: JVP vs a test-only central FD on native rows (h = 1e-6, bound 1e-7·max(1, |JVP|))", () => {
  test.each(
    derivativeRows.map((row) => [row.covers, row.row, row.distance] as const),
  )(
    "%s: %s d = %s",
    (_covers, row, distance) => {
      const target = derivativeRow(`${row} ${distance}`);
      const { derivatives } = frameAndDerivatives(target);
      const variation = randomVariation(derivatives.sourceDofs, prng(17));
      expectJvpMatchesFd(
        target,
        _covers.startsWith("d math A3") ? horizontal(variation) : variation,
      );
    },
    60_000,
  );
  test.each(D3_DERIVATIVE_ROWS)(
    "D3 %s",
    (label) => {
      const target = d3DerivativeRow(label);
      const { derivatives } = frameAndDerivatives(target);
      expectJvpMatchesFd(
        target,
        randomVariation(derivatives.sourceDofs, prng(29)),
      );
    },
    60_000,
  );
  test("gapped vertex: native Fix / Fix / Coincident SS-60 (3e-4, 2e-4) at d = ±0.01", () => {
    for (const distance of [-0.01, 0.01]) {
      const target = gappedSs60Row(distance);
      const { derivatives, frame } = frameAndDerivatives(target);
      const vertex = frame.vertices[0]!;
      expect(
        Math.hypot(
          vertex.second.vertex[0] - vertex.first.vertex[0],
          vertex.second.vertex[1] - vertex.first.vertex[1],
        ),
        "a real source gap",
      ).toBeGreaterThan(1e-4);
      expectJvpMatchesFd(
        target,
        randomVariation(derivatives.sourceDofs, prng(41)),
      );
    }
  }, 60_000);
});

describe("T08b-g2 frame derivatives: adjoint identity ⟨Jv, w⟩ = ⟨v, Jᵀw⟩ (random v, w; the pullback by basis application)", () => {
  test.each([
    ...derivativeRows.map((row) => `${row.row} ${row.distance}`),
    ...D3_DERIVATIVE_ROWS,
  ])(
    "%s",
    (label) => {
      const target = (D3_DERIVATIVE_ROWS as readonly string[]).includes(label)
        ? d3DerivativeRow(label)
        : derivativeRow(label);
      const { derivatives } = frameAndDerivatives(target);
      const random = prng(7);
      for (let trial = 0; trial < 3; trial += 1) {
        const v = randomVariation(derivatives.sourceDofs, random);
        const jvp = jvpOf(derivatives.jvp([v])[0]);
        const w = randomCotangent(jvp, random);
        const pulled = derivatives.pullback(w);
        if ("ok" in pulled) throw new Error(pulled.message);
        const left = outputPairing(jvp, w);
        const right = sourcePairing(v, pulled);
        expect(
          Math.abs(left - right),
          `${label}: ${left} vs ${right}`,
        ).toBeLessThanOrEqual(1e-10 * Math.max(1, Math.abs(left)));
      }
    },
    60_000,
  );

  test("the pullback cache: one batched JVP per frame fills every column; a batch is bitwise its single directions", () => {
    const target = derivativeRow("SS-60 -0.01");
    const { derivatives } = frameAndDerivatives(target);
    const random = prng(3);
    const a = randomVariation(derivatives.sourceDofs, random);
    const b = randomVariation(derivatives.sourceDofs, random);
    const [batchA, batchB] = derivatives.jvp([a, b]);
    expect(encode([...flattenJvp(jvpOf(batchB))])).toBe(
      encode([...flattenJvp(jvpOf(derivatives.jvp([b])[0]))]),
    );
    expect(encode([...flattenJvp(jvpOf(batchA))])).toBe(
      encode([...flattenJvp(jvpOf(derivatives.jvp([a])[0]))]),
    );
    // Two pullbacks of one frame reuse its columns: bitwise equal results.
    const w = randomCotangent(jvpOf(batchA), random);
    expect(encode(derivatives.pullback(w))).toBe(
      encode(derivatives.pullback(w)),
    );
  });
});

describe("review R3: frames carry no source-basis directions", () => {
  test.each([
    "S1 0.01",
    "SL-90 0.01",
    "arch → 2-point spline (C φ=0.005 turn) → line (absorbed vertex + F1 arc at the one-span spline adopter's other end) -0.01",
  ])(
    "%s: a frame solved with the source basis is bitwise the frame without it, `cubics` included",
    (label) => {
      const row = derivativeRow(label);
      const input = {
        relationship: relationshipOf(row.seeds, row.distance),
        definition: row.pair.definition,
        modelingTolerance: TOLERANCE,
      };
      const plain = solvedFrame(solveOffsetFrame(input));
      const based = solvedFrame(
        solveOffsetFrame({ ...input, withSourceBasis: true }),
      );
      expect(plain.cubics.size, "premise: a spline piece").toBeGreaterThan(0);
      const flat = (frame: OffsetSolveFrame) => ({
        ...frame,
        cubics: [...frame.cubics],
        lineArcEndpoints: [...frame.lineArcEndpoints],
      });
      expect(encode([...based.cubics])).toBe(encode([...plain.cubics]));
      expect(encode(flat(based))).toBe(encode(flat(plain)));
      // The basis is still on the frame's own owner calls (kept beside it).
      const derivatives = prepareOffsetFrameDerivatives(input, based);
      jvpOf(
        derivatives.jvp([randomVariation(derivatives.sourceDofs, prng(11))])[0],
      );
    },
    60_000,
  );
});

describe("T08b-g5b solve-frame memo: content-keyed, bounded, never crosses an input the frame reads", () => {
  test("every read input misses (and then equals the uncached frame); geometry the frame does not read hits the same frame object", () => {
    const row = derivativeRow("SL-90 0.01");
    const definition = row.pair.definition;
    const input = {
      relationship: relationshipOf(row.seeds, row.distance),
      definition,
      modelingTolerance: TOLERANCE,
    };
    const base = solvedFrame(solveOffsetFrame(input));
    expect(
      solveOffsetFrame({ ...input, definition: structuredClone(definition) }),
      "The key is content, not identity: an equal clone hits the same frame.",
    ).toBe(base);
    const spline = definition.entities.find(
      (entity) => entity.kind === "spline",
    );
    const line = definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    );
    if (spline?.kind !== "spline" || line?.kind !== "lineSegment")
      throw new Error("premise: SL-90 is a spline and a line");
    const seedPoint = spline.pointOccurrences[1]!.pointId;
    const unrelated = {
      ...definition.points[0]!,
      pointId: "sketch_point_g5b_unrelated" as never,
      position: [40, 40] as const,
    };
    expect(
      solveOffsetFrame({
        ...input,
        definition: {
          ...definition,
          pointIds: [...definition.pointIds, unrelated.pointId],
          points: [...definition.points, unrelated],
        },
      }),
      "A point no seed and no coincident constraint names is not read: the same frame object.",
    ).toBe(base);
    const plan: OffsetFramePlan = { ...base.plan, origin: "published" };
    const variants: readonly [string, Parameters<typeof solveOffsetFrame>][] = [
      [
        "a seed point 1 ulp off",
        [
          {
            ...input,
            definition: {
              ...definition,
              points: definition.points.map((point) =>
                point.pointId === seedPoint
                  ? {
                      ...point,
                      position: [nextUp(point.position[0]), point.position[1]],
                    }
                  : point,
              ),
            },
          },
        ],
      ],
      [
        "an authored tangent on a seed",
        [
          {
            ...input,
            definition: {
              ...definition,
              entities: definition.entities.map((entity) =>
                entity.entityId === spline.entityId && entity.kind === "spline"
                  ? {
                      ...entity,
                      pointOccurrences: entity.pointOccurrences.map(
                        (occurrence, index) =>
                          index === 0
                            ? {
                                ...occurrence,
                                tangent: {
                                  kind: "authored" as const,
                                  vector: [1, 0.25] as const,
                                },
                              }
                            : occurrence,
                      ),
                    }
                  : entity,
              ),
            },
          },
        ],
      ],
      [
        "an added coincident constraint on seed terminals",
        [
          {
            ...input,
            definition: {
              ...definition,
              constraintIds: [
                ...definition.constraintIds,
                "constraint_g5b_coincident" as never,
              ],
              constraints: [
                ...definition.constraints,
                {
                  constraintId: "constraint_g5b_coincident",
                  kind: "coincident",
                  label: "g5b",
                  pointIds: [
                    line.endPointId,
                    spline.pointOccurrences[0]!.pointId,
                  ],
                } as SketchDefinition["constraints"][number],
              ],
            },
          },
        ],
      ],
      ["τ", [{ ...input, modelingTolerance: TOLERANCE / 2 }]],
      [
        "d",
        [
          {
            ...input,
            relationship: relationshipOf(row.seeds, nextUp(row.distance)),
          },
        ],
      ],
      [
        "the authored arc set",
        [
          {
            ...input,
            relationship: relationshipOf(row.seeds, row.distance, []),
          },
        ],
      ],
      ["the plan hint (origin published)", [input, plan]],
      ["the basis flag", [{ ...input, withSourceBasis: true }]],
    ];
    for (const [label, args] of variants) {
      const memoized = solveOffsetFrame(...args);
      expect(memoized, `${label}: a different key misses`).not.toBe(base);
      expect(
        encodeDeep(memoized),
        `${label}: the memoized frame is the uncached frame of that input`,
      ).toBe(encodeDeep(solveOffsetFrameWithoutMemoForTest(...args)));
      expect(solveOffsetFrame(...args), `${label}: then it hits`).toBe(
        memoized,
      );
    }
  });

  test("the memo is bounded: an evicted key is recomputed bitwise", () => {
    const row = derivativeRow("SL-90 0.01");
    const input = {
      relationship: relationshipOf(row.seeds, row.distance),
      definition: row.pair.definition,
      modelingTolerance: TOLERANCE,
    };
    const first = solveOffsetFrame(input);
    // More distinct keys than the memo holds (64).
    for (let index = 1; index <= 80; index += 1)
      solveOffsetFrame({
        ...input,
        modelingTolerance: TOLERANCE + index * 1e-9,
      });
    const again = solveOffsetFrame(input);
    expect(again, "The first key was evicted (bounded memo).").not.toBe(first);
    expect(encodeDeep(again)).toBe(encodeDeep(first));
  }, 60_000);
});

describe("T08b-g2 frame derivatives: unavailable directions, tangent authority, d math A3", () => {
  test("a singular joint (fabricated: a vertical half-disc diameter trim moved to the circle's tangency angle θ = 0, not owner-reachable) is derivativeUnavailable in every direction and in the pullback", () => {
    const a = arcHarness.arc(arcHarness.empty(), [0, 0], [0, -1], [0, 1]);
    const diameter = arcHarness.line(a.definition, [0, 1], [0, -1], {
      start: a.end,
      end: a.start,
    });
    const { pair } = arcHarness.adapt(
      { definition: diameter.definition, seeds: [a.id, diameter.id] },
      0.1,
    );
    const row: DerivativeRow = {
      label: "vertical half-disc 0.1",
      pair,
      seeds: [a.id, diameter.id],
      distance: 0.1,
    };
    const { input, frame, derivatives } = frameAndDerivatives(row);
    expect(frame.trims).toHaveLength(2);
    // Control: the native frame's JVP is available.
    const v = randomVariation(derivatives.sourceDofs, prng(5));
    jvpOf(derivatives.jvp([v])[0]);
    const arcIndex = frame.pieces.findIndex((piece) => piece.kind === "arc");
    const fabricated: OffsetSolveFrame = {
      ...frame,
      trims: frame.trims.map((trim, index) =>
        index !== 0
          ? trim
          : trim.jointIndex === arcIndex
            ? { ...trim, first: { ...trim.first, parameter: 0 } }
            : { ...trim, second: { ...trim.second, parameter: 0 } },
      ),
    };
    const singular = prepareOffsetFrameDerivatives(input, fabricated);
    for (const result of singular.jvp([
      v,
      randomVariation(singular.sourceDofs, prng(6)),
    ]))
      expect(result).toMatchObject({
        ok: false,
        code: codes.derivativeUnavailable,
      });
    expect(
      singular.pullback({
        lineArcEndpoints: new Map([[diameter.id, { start: [1, 0] as const }]]),
      }),
    ).toMatchObject({ ok: false, code: codes.derivativeUnavailable });
  });

  test("review A4: a singular frame derivative is reported by the derivation JVP and pullback, never silent zero motion", () => {
    const a = arcHarness.arc(arcHarness.empty(), [0, 0], [0, -1], [0, 1]);
    const diameter = arcHarness.line(a.definition, [0, 1], [0, -1], {
      start: a.end,
      end: a.start,
    });
    const { pair } = arcHarness.adapt(
      { definition: diameter.definition, seeds: [a.id, diameter.id] },
      0.1,
    );
    const evaluation = evaluateSketchDerivations({
      definition: pair.definition,
      modelingTolerance: TOLERANCE,
    });
    const record = evaluation.offsetFrames[0]!;
    expect(record.frame.trims, "premise: two trims").toHaveLength(2);
    const arcIndex = record.frame.pieces.findIndex(
      (piece) => piece.kind === "arc",
    );
    // The same fabricated singular joint as the frame-level row above.
    const fabricated = {
      ...evaluation,
      offsetFrames: [
        {
          ...record,
          frame: {
            ...record.frame,
            trims: record.frame.trims.map((trim, index) =>
              index !== 0
                ? trim
                : trim.jointIndex === arcIndex
                  ? { ...trim, first: { ...trim.first, parameter: 0 } }
                  : { ...trim, second: { ...trim.second, parameter: 0 } },
            ),
          },
        },
      ],
    };
    const variation = {
      points: { [pair.definition.points[0]!.pointId]: [1, 0] as const },
    };
    const [outputPointId] = [...record.outputs.points][0]!;
    const cotangent = { points: { [outputPointId]: [1, 0] as const } };
    expect(
      evaluateSketchDerivationJvp(evaluation, variation).derivativeUnavailable,
      "control: the native frame's derivative is available",
    ).toBeUndefined();
    expect(
      prepareSketchDerivationPullback(evaluation)(cotangent)
        .derivativeUnavailable,
    ).toBeUndefined();
    expect(
      evaluateSketchDerivationJvp(fabricated, variation).derivativeUnavailable,
    ).toEqual([record.derivationId]);
    expect(
      prepareSketchDerivationPullback(fabricated)(cotangent)
        .derivativeUnavailable,
    ).toEqual([record.derivationId]);
  });

  test("a non-finite direction is unavailable alone; the batch's other directions are bitwise unchanged", () => {
    const target = derivativeRow("SL-90 0.01");
    const { derivatives } = frameAndDerivatives(target);
    const good = randomVariation(derivatives.sourceDofs, prng(9));
    const [pointId] = Object.keys(good.points!);
    const bad: OffsetFrameVariation = {
      points: { [pointId!]: [Number.NaN, 0] },
    };
    const [first, second] = derivatives.jvp([good, bad]);
    expect(second).toMatchObject({
      ok: false,
      code: codes.derivativeUnavailable,
    });
    expect(encode([...flattenJvp(jvpOf(first))])).toBe(
      encode([...flattenJvp(jvpOf(derivatives.jvp([good])[0]))]),
    );
  });

  test("tangent authority: authored-tangent directions move the derived output (FD-checked) and the pullback returns their cotangent", () => {
    for (const label of [
      "arch with an authored interior tangent (native commit + tangent edit) 0.01",
      "SL-90 with an authored tangent at the joined spline end (native commit + tangent edit) 0.01",
    ]) {
      const target = derivativeRow(label);
      const { derivatives, frame } = frameAndDerivatives(target);
      const tangentDofs = derivatives.sourceDofs.filter(
        (dof) => dof.kind === "tangent",
      );
      expect(tangentDofs, label).toHaveLength(2);
      const variation = randomVariation(
        derivatives.sourceDofs,
        prng(11),
        "tangent",
      );
      const { jvp } = expectJvpMatchesFd(target, variation);
      expect(
        Math.max(...[...jvp.values()].map(Math.abs)),
        `${label}: nonzero`,
      ).toBeGreaterThan(0.01);
      // A residual-like cotangent on the first leaf's poles pulls back onto
      // the authored tangent.
      const [seed] = [...frame.cubics.keys()];
      const pulled = derivatives.pullback({
        cubics: new Map([
          [
            seed!,
            frame.cubics.get(seed!)!.map(() => ({
              poles: [
                [1, 1],
                [1, 1],
                [1, 1],
                [1, 1],
              ] as const,
            })),
          ],
        ]),
      });
      if ("ok" in pulled) throw new Error(pulled.message);
      const tangent = Object.values(pulled.splineTangents![seed!]!)[0]!;
      expect(Math.hypot(...tangent), label).toBeGreaterThan(1e-3);
    }
  }, 60_000);

  test("d math A3: at a line with a (bitwise-shared, no re-call) vertex end and a trim end, the trim JVP uses the line's adopted end variation", () => {
    const target = derivativeRow(
      "horizontal-ended arch → line → line (native commit + tangent edit): a bitwise-shared parallel vertex (no re-call; the line is the non-keeper) and a trim at the line's other end 0.01",
    );
    const { frame, derivatives } = frameAndDerivatives(target);
    expect(frame.plan.adjacencies.map((entry) => entry.kind)).toEqual([
      "parallel",
      "trim",
    ]);
    expect(frame.plan.adjacencies[0]).toMatchObject({ keeper: "first" });
    const spline = frame.pieces[0]!;
    const line = frame.pieces[1]!;
    if (spline.kind !== "derivedCubic" || line.kind !== "lineSegment")
      throw new Error("shape");
    expect(encode(line.start), "the poles are already bitwise shared").toBe(
      encode(spline.spans.at(-1)!.poles[3]),
    );
    const random = prng(13);
    for (let trial = 0; trial < 3; trial += 1) {
      const variation = randomVariation(derivatives.sourceDofs, random);
      const jvp = jvpOf(derivatives.jvp([variation])[0]);
      const ends = jvp.lineArcEndpoints.get(line.seedEntityId)!;
      // The shared driven point moves with the keeper's pole variation.
      expect(encode(ends.start)).toBe(
        encode(jvp.cubics.get(spline.seedEntityId)!.at(-1)!.poles[3]),
      );
      // The trim's parameter JVP is the parameter derivative on the PUBLISHED
      // (adopted) line: with A its adopted start and B its raw end (the
      // `offsetLinePoints` end, differentiated here by FD),
      // δX = δA + t(δB − δA) + (B − A)·δt.
      const trim = frame.trims[0]!;
      const t = trim.first.parameter;
      const dt = jvp.trims[0]!.first;
      const entity = target.pair.definition.entities.find(
        (item) => item.entityId === line.seedEntityId,
      );
      if (entity?.kind !== "lineSegment") throw new Error("line");
      const position = (pointId: SketchPointId, h: number): V2 => {
        const base = target.pair.definition.points.find(
          (item) => item.pointId === pointId,
        )!;
        const by = variation.points?.[pointId] ?? [0, 0];
        return [base.position[0] + h * by[0], base.position[1] + h * by[1]];
      };
      const rawEnd = (h: number) =>
        offsetLinePoints(
          position(entity.startPointId, h),
          position(entity.endPointId, h),
          line.reversed ? -target.distance : target.distance,
        )!.end;
      const dB: V2 = [
        (rawEnd(FD_STEP)[0] - rawEnd(-FD_STEP)[0]) / (2 * FD_STEP),
        (rawEnd(FD_STEP)[1] - rawEnd(-FD_STEP)[1]) / (2 * FD_STEP),
      ];
      const dA = ends.start;
      const dX = jvp.trims[0]!.position;
      for (const axis of [0, 1] as const)
        expect(
          Math.abs(
            dA[axis] +
              t * (dB[axis] - dA[axis]) +
              (line.end[axis] - line.start[axis]) * dt -
              dX[axis],
          ),
          "the trim parameter is differentiated on the published line",
        ).toBeLessThanOrEqual(FD_BOUND);
      expect(trim.jointIndex).toBe(1);
    }
  });
});

describe("T08b-g2 point-on-derived-curve residual helper", () => {
  const row = () => derivativeRow("SL-90 0.01");
  const splineOf = (frame: OffsetSolveFrame) => [...frame.cubics.keys()][0]!;
  const zeroDifferential = {
    interval: [0, 0] as const,
    poles: [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ] as const,
  };
  const local = (span: OffsetFrameCubicSpan, u: number) =>
    evaluateSplineSpan(
      {
        interval: span.sourceDomain,
        poles: span.span.poles,
        differential: zeroDifferential,
      },
      { kind: "local", value: u },
    );

  test("value and gradient (span and parameter held fixed) match a central FD along random source directions and the point", () => {
    const target = row();
    const { relationship, frame, derivatives } = frameAndDerivatives(target);
    const seed = splineOf(frame);
    const leaves = frame.cubics.get(seed)!;
    const at = local(leaves[0]!, 0.4);
    const speed = Math.hypot(...at.first);
    const point: V2 = [
      at.position[0] - (0.05 * at.first[1]) / speed,
      at.position[1] + (0.05 * at.first[0]) / speed,
    ];
    const base = offsetFrameCurveResidual({
      frame,
      derivatives,
      seedEntityId: seed,
      point,
    });
    if (!base.ok) throw new Error(base.message);
    expect(base.location.leaf).toBe(0);
    const plan: OffsetFramePlan = {
      origin: "published",
      adjacencies: frame.plan.adjacencies,
    };
    const random = prng(19);
    for (let trial = 0; trial < 3; trial += 1) {
      const variation = randomVariation(derivatives.sourceDofs, random);
      const valueAt = (h: number) => {
        const input = {
          relationship,
          definition: perturbed(target.pair.definition, variation, h),
          modelingTolerance: TOLERANCE,
        };
        const moved = solvedFrame(solveOffsetFrame(input, plan));
        expect(moved.cubics.get(seed)).toHaveLength(leaves.length);
        const result = offsetFrameCurveResidual({
          frame: moved,
          derivatives: prepareOffsetFrameDerivatives(input, moved),
          seedEntityId: seed,
          point,
          location: base.location,
        });
        if (!result.ok) throw new Error(result.message);
        return result.value;
      };
      const plus = valueAt(FD_STEP);
      const minus = valueAt(-FD_STEP);
      for (const axis of [0, 1] as const) {
        const fd = (plus[axis] - minus[axis]) / (2 * FD_STEP);
        const analytic = sourcePairing(variation, base.gradient.source[axis]);
        expect(
          Math.abs(fd - analytic),
          `r_${axis}: FD ${fd} vs ${analytic}`,
        ).toBeLessThanOrEqual(FD_BOUND * Math.max(1, Math.abs(analytic)));
      }
    }
    // ∂r/∂P = I (the point enters linearly).
    for (const axis of [0, 1] as const) {
      const moved: V2 =
        axis === 0
          ? [point[0] + FD_STEP, point[1]]
          : [point[0], point[1] + FD_STEP];
      const shifted = offsetFrameCurveResidual({
        frame,
        derivatives,
        seedEntityId: seed,
        point: moved,
        location: base.location,
      });
      if (!shifted.ok) throw new Error(shifted.message);
      const fd: V2 = [
        (shifted.value[0] - base.value[0]) / FD_STEP,
        (shifted.value[1] - base.value[1]) / FD_STEP,
      ];
      for (const component of [0, 1] as const)
        expect(
          Math.abs(fd[component] - base.gradient.point[component]![axis]),
        ).toBeLessThan(1e-6);
    }
  }, 60_000);

  test("a point outside the query domain never binds to the trimmed tail (the search is restricted to queryDomain)", () => {
    const { frame, derivatives } = frameAndDerivatives(row());
    const seed = splineOf(frame);
    const leaves = frame.cubics.get(seed)!;
    const last = leaves.length - 1;
    const tail = leaves[last]!;
    const [, domainEnd] = tail.representativeQueryDomain;
    expect(domainEnd, "the spline end is trimmed").toBeLessThan(
      tail.sourceDomain[1],
    );
    const localEnd =
      (domainEnd - tail.sourceDomain[0]) /
      (tail.sourceDomain[1] - tail.sourceDomain[0]);
    // The untrimmed end pole: ON the tail, off the published curve.
    const point = tail.span.poles[3];
    const unrestricted = closestSplineSpanLocation(
      point,
      leaves.map((leaf) => ({
        interval: leaf.sourceDomain,
        poles: leaf.span.poles,
        differential: zeroDifferential,
      })),
    );
    expect(unrestricted).toMatchObject({
      spanIndex: last,
      u: 1,
      distanceSquared: 0,
    });
    const result = offsetFrameCurveResidual({
      frame,
      derivatives,
      seedEntityId: seed,
      point,
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.location.leaf).toBe(last);
    expect(result.location.u).toBeLessThanOrEqual(localEnd);
    expect(Math.hypot(...result.value)).toBeGreaterThan(1e-4);
  });
});

// Logic lane (docs/testing.md): T08b-g5d (U-G6) at the exported solve /
// publish frame seam on the shared native rows `deepTrimRows()`: G3
// agreement on a deep trim, the record omission of removed sub-spans, the
// drawn-domain residual, and the fixed-topology JVP against a central FD.
describe("T08b-g5d frame: deep trims inside the terminal source span", () => {
  const rows = deepTrimRows();
  const deepRow = (label: string): DerivativeRow => {
    const row = rows.find((item) => `${item.row} ${item.distance}` === label);
    if (!row) throw new Error(`no row ${label}`);
    const harness = matrixHarnesses.native;
    harness.resetSequence();
    const pair = harness.solvedPair(row.build(harness));
    return {
      label,
      pair,
      seeds: pair.definition.entities.map((entity) => entity.entityId),
      distance: row.distance,
    };
  };
  const shellSpansOf = (frame: OffsetSolveFrame, seed: SketchEntityId) =>
    offsetFrameShellSpans(frame, {
      entityId: "shell" as SketchEntityId,
      seed,
      spanIds: new Map(
        frame.cubics
          .get(seed)!
          .map((leaf) => [
            ownerSpanKey(leaf.span.source),
            ownerSpanKey(leaf.span.source),
          ]),
      ),
    });

  test("SL h0.4 d = −0.1: the first-choice frame's ring Newton scan names the SEL's deep trim leaves, so publish certifies with no re-solve; the shell record omits the removed sub-spans", () => {
    const row = deepRow("SL h0.4 -0.1");
    const relationship = relationshipOf(row.seeds, row.distance);
    const cycle = publishCycle(relationship, row.pair);
    expect(cycle.publications.map((item) => item.status)).toEqual([
      "certified",
    ]);
    const publication = certifiedOf(cycle);
    const { frame } = publication;
    expect(
      frame.trims.map((trim) => [
        trim.jointIndex,
        trim.first.leaf,
        trim.second.leaf,
      ]),
    ).toEqual([
      [0, 6, 0],
      [1, 0, 1],
    ]);
    const spline = frame.pieces.find((piece) => piece.kind === "derivedCubic")!;
    const leaves = frame.cubics.get(spline.seedEntityId)!;
    // Removed: the vertex leaf of each trimmed end, marked by its trim.
    expect(
      leaves.flatMap((leaf, index) =>
        leaf.start.kind === "removed" ? [[index, leaf.start.jointIndex]] : [],
      ),
    ).toEqual([
      [0, 1],
      [7, 0],
    ]);
    expect(leaves.map((leaf) => [leaf.start.kind, leaf.end.kind])).toEqual(
      leaves.map((_, index) =>
        index === 0 || index === 7
          ? ["removed", "removed"]
          : [
              index === 1 ? "joint" : "source",
              index === 6 ? "joint" : "source",
            ],
      ),
    );
    // The record: removed sub-spans left out before the sub-index count; the
    // trim leaves are the record's first and last sub-spans, each trimmed
    // strictly inside (the g3/g5c region-input premise).
    const record = shellSpansOf(frame, spline.seedEntityId);
    expect(record).toHaveLength(leaves.length - 2);
    expect(record[0]!.poles).toBe(leaves[1]!.span.poles);
    expect(record.at(-1)!.poles).toBe(leaves[6]!.span.poles);
    expect(record[0]!.subIndex).toBe(0);
    for (const [span, end] of [
      [record[0]!, 0],
      [record.at(-1)!, 1],
    ] as const) {
      const [s0, s1] = span.sourceDomain;
      const trimmed = span.queryDomain[end];
      expect(trimmed > s0 && trimmed < s1, "trim strictly inside").toBe(true);
    }
    // Interior sub-spans and the contiguous domains are unchanged.
    for (const [index, span] of record.entries()) {
      if (index > 0)
        expect(span.sourceDomain[0]).toBe(record[index - 1]!.sourceDomain[1]);
      if (index > 0 && index < record.length - 1)
        expect(span.queryDomain).toEqual(span.sourceDomain);
    }
  }, 120_000);

  test("R3 vertex (math review A3): the arch → line corner absorbed first publishes its deferred deep trim within one hinted re-solve (planChanged with the certifier's plan, then certified on the deep leaf)", () => {
    const row = deepRow("SL arch R3 0.4");
    const cycle = publishCycle(
      relationshipOf(row.seeds, row.distance),
      row.pair,
    );
    expect(cycle.publications.map((item) => item.status)).toEqual([
      "planChanged",
      "certified",
    ]);
    const first = cycle.publications[0]!;
    if (first.status !== "planChanged") throw new Error("planChanged");
    expect(first.reason).toBe("plan");
    expect(cycle.solves).toHaveLength(2);
    const { frame } = certifiedOf(cycle);
    expect(frame.plan.origin, "the hinted re-solve").toBe("certified");
    const spline = frame.pieces.find((piece) => piece.kind === "derivedCubic")!;
    const leaves = frame.cubics.get(spline.seedEntityId)!;
    // The deep trim replaces the absorption: on the inner leaf 12 of the
    // terminal source span, the vertex leaf 13 removed by joint 0.
    expect(
      frame.trims.map((trim) => [
        trim.jointIndex,
        trim.first.leaf,
        trim.second.leaf,
      ]),
    ).toEqual([[0, leaves.length - 2, 0]]);
    expect(leaves.at(-1)!.start).toEqual({ kind: "removed", jointIndex: 0 });
  }, 120_000);

  test("SL h0.4 d = −0.1: the point-on-curve residual never binds to a removed leaf (its emitted vertex pole maps to the drawn domain)", () => {
    const row = deepRow("SL h0.4 -0.1");
    const { frame, derivatives } = frameAndDerivatives(row);
    const spline = frame.pieces.find((piece) => piece.kind === "derivedCubic")!;
    const leaves = frame.cubics.get(spline.seedEntityId)!;
    for (const removed of [0, 7]) {
      const residual = offsetFrameCurveResidual({
        frame,
        derivatives,
        seedEntityId: spline.seedEntityId,
        point: leaves[removed]!.span.poles[removed === 0 ? 0 : 3],
      });
      if ("ok" in residual && !residual.ok) throw new Error(residual.message);
      if (!residual.ok) throw new Error("residual");
      expect(residual.location.leaf).toBe(removed === 0 ? 1 : 6);
    }
  });

  test.each(["SL h0.4 -0.1", "SS lens 0.4/-0.3 -0.2"])(
    "%s: the fixed-topology JVP of every published datum (deep trim leaves, removed spans) matches a central FD",
    (label) => {
      const target = deepRow(label);
      const { derivatives, frame } = frameAndDerivatives(target);
      expect(
        frame.trims.some(
          (trim) =>
            trim.first.leaf !== 0 &&
            trim.first.leaf !==
              (frame.cubics.get(trim.first.seedEntityId)?.length ?? 1) - 1,
        ) ||
          frame.trims.some(
            (trim) =>
              trim.second.leaf !== 0 &&
              trim.second.leaf !==
                (frame.cubics.get(trim.second.seedEntityId)?.length ?? 1) - 1,
          ),
        "premise: a deep trim leaf",
      ).toBe(true);
      const { worst, keys } = expectJvpMatchesFd(
        target,
        randomVariation(derivatives.sourceDofs, prng(53)),
      );
      expect(keys).toBeGreaterThan(0);
      expect(worst).toBeLessThanOrEqual(FD_BOUND);
    },
    120_000,
  );
});
