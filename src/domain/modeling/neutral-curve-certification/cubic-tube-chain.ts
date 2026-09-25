import type {
  CertifiedCubicTubeChain,
  CubicTubeChainJoin,
  CubicTubeChainRequest,
  CubicTubeChainResult,
  NeutralCubicTube,
} from "@/contracts/modeling/neutral-curve-query";
import type {
  SplinePoles,
  SplineVector,
} from "@/contracts/sketch/spline-geometry";
import {
  crossExact,
  restrictCubicBernstein,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-exact";
import {
  ExactProofBudget,
  ExactQueryProofBudgetExceeded,
  addExact,
  compareExact,
  exact,
  exactFromNumber,
  multiplyExact,
  subtractExact,
  type ExactFraction,
  type ExactProofBudgetSnapshot,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

/**
 * C6-S1′ tube-stability certificate of one emitted cubic chain (design review
 * §2/§6). All checks are exact on binary64 inputs under ONE proof budget per
 * request; nothing is sampled, rounded into identity or tolerance-compared
 * beyond the owner's own ε ≤ τ acceptance.
 *
 * - J0 admission: finite data, ordered boxes and leaves, 0 ≤ ε ≤ τ, bitwise
 *   emitted joins, present owner metadata.
 * - J1 exact true-offset endpoint identity at every declared join: the same
 *   source span and bitwise split parameter (same-leaf), or a source knot with
 *   a bitwise shared source point whose one-sided source tangents have exactly
 *   zero cross and positive dot (parallel-knot). No window, no exemption.
 * - K1 cone at every join (single open span: on itself): the emitted hodograph
 *   and the owner's O′ box are strictly positive along one candidate e.
 * - K3 clearance of every non-join pair: exact control-polygon boxes farther
 *   apart than ε_i + ε_j, by exact dyadic de Casteljau subdivision.
 *
 * Then E and the true offset O are simple curves of the same type and the
 * leafwise map E → O is a homeomorphism moving points by ≤ ε whose only
 * incidences are the declared joins. A failed check is uncertain, never a
 * claim that the true geometry changed topology.
 */

type ExactPoint = readonly [ExactFraction, ExactFraction];
type ExactCubic = readonly [ExactPoint, ExactPoint, ExactPoint, ExactPoint];
type ExactScalarCubic = readonly [
  ExactFraction,
  ExactFraction,
  ExactFraction,
  ExactFraction,
];
type Failure = Exclude<CubicTubeChainResult, { kind: "verified" }>;
type LowerProofLimits = ConstructorParameters<typeof ExactProofBudget>[0];

const EXHAUSTED: Failure = {
  kind: "uncertain",
  code: "exact-query-proof-budget-exhausted",
  message: "The deterministic exact-query arithmetic budget was exhausted.",
};

function uncertain(
  code: string,
  message: string,
  first?: number,
  second?: number,
): Failure {
  return {
    kind: "uncertain",
    code,
    message,
    ...(first === undefined ? {} : { first }),
    ...(second === undefined ? {} : { second }),
  };
}

const finitePoles = (poles: SplinePoles | undefined) =>
  Array.isArray(poles) &&
  poles.length === 4 &&
  poles.every(
    (pole) =>
      Array.isArray(pole) &&
      Number.isFinite(pole[0]) &&
      Number.isFinite(pole[1]),
  );

const orderedFinite = (interval: readonly [number, number] | undefined) =>
  Array.isArray(interval) &&
  Number.isFinite(interval[0]) &&
  Number.isFinite(interval[1]) &&
  interval[0] <= interval[1];

const samePoint = (first: SplineVector, second: SplineVector) =>
  Object.is(first[0], second[0]) && Object.is(first[1], second[1]);

/** J0 structural admission of one tube; null when admitted. */
function admissionDefect(
  tube: NeutralCubicTube,
  modelingTolerance: number,
): string | null {
  // Persisted, projected and fabricated spans may lack owner metadata at runtime.
  const reference = tube.reference as NeutralCubicTube["reference"] | undefined;
  const source = tube.source as NeutralCubicTube["source"] | undefined;
  if (!reference || !source) return "missing owner proof metadata";
  if (!finitePoles(tube.poles)) return "non-finite emitted poles";
  if (!finitePoles(reference.sourcePoles)) return "non-finite source poles";
  const derivative = reference.derivative as
    | NeutralCubicTube["reference"]["derivative"]
    | undefined;
  if (
    !Array.isArray(derivative) ||
    !orderedFinite(derivative[0]) ||
    !orderedFinite(derivative[1])
  )
    return "non-finite or reversed derivative enclosure";
  const leaf = tube.sourceLocalInterval as
    | NeutralCubicTube["sourceLocalInterval"]
    | undefined;
  if (!Array.isArray(leaf)) return "invalid source-local leaf";
  const [a, b] = leaf;
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !(a >= 0) ||
    !(b <= 1) ||
    !(a < b)
  )
    return "invalid source-local leaf";
  if (
    !Number.isFinite(tube.certifiedError) ||
    !(tube.certifiedError >= 0) ||
    !(tube.certifiedError <= modelingTolerance)
  )
    return "certified error outside [0, modelingTolerance]";
  if (
    typeof source.splineId !== "string" ||
    !Number.isSafeInteger(source.spanIndex) ||
    typeof source.startOccurrenceId !== "string" ||
    typeof source.endOccurrenceId !== "string"
  )
    return "invalid source provenance";
  return null;
}

/** J1(a): both leaves split one source span at one bitwise parameter. */
function sameLeaf(first: NeutralCubicTube, second: NeutralCubicTube) {
  return (
    first.source.splineId === second.source.splineId &&
    first.source.spanIndex === second.source.spanIndex &&
    first.reference.sourcePoles.every((pole, index) =>
      samePoint(pole, second.reference.sourcePoles[index]!),
    ) &&
    Object.is(first.sourceLocalInterval[1], second.sourceLocalInterval[0])
  );
}

function certifyChain(
  request: CubicTubeChainRequest,
  budget: ExactProofBudget,
): CubicTubeChainResult {
  const { tubes, closed, modelingTolerance } = request;
  const count = tubes.length;
  // Admission and preallocation guard: charged before any per-tube work.
  budget.operation(64 + 16 * count);
  if (count === 0)
    return {
      kind: "unsupported",
      code: "cubic-tube-chain-empty",
      message: "A cubic tube chain needs at least one emitted cubic.",
    };
  if (closed && count < 3)
    return {
      kind: "unsupported",
      code: "cubic-tube-chain-closed-too-short",
      message: "A closed cubic tube chain needs at least three cubics.",
    };
  if (!Number.isFinite(modelingTolerance) || !(modelingTolerance > 0))
    return uncertain(
      "invalid-cubic-tube-chain",
      "The modeling tolerance must be finite and positive.",
    );
  for (const [index, tube] of tubes.entries()) {
    const defect = admissionDefect(tube, modelingTolerance);
    if (defect)
      return uncertain(
        "invalid-cubic-tube-chain",
        `Tube ${index}: ${defect}.`,
        index,
      );
  }

  const joins: (readonly [number, number])[] = [];
  for (let index = 0; index + 1 < count; index += 1)
    joins.push([index, index + 1]);
  if (closed) joins.push([count - 1, 0]);
  for (const [first, second] of joins) {
    if (!samePoint(tubes[first]!.poles[3], tubes[second]!.poles[0]))
      return uncertain(
        "cubic-tube-chain-join-not-bitwise",
        "A declared join does not share one bitwise emitted pole.",
        first,
        second,
      );
  }

  // Every binary64 input is converted exactly once per request.
  const zero = exact(0n, 1n, budget);
  const exactPoint = (point: SplineVector): ExactPoint => [
    exactFromNumber(point[0], budget),
    exactFromNumber(point[1], budget),
  ];
  const difference = (to: ExactPoint, from: ExactPoint): ExactPoint => [
    subtractExact(to[0], from[0], budget),
    subtractExact(to[1], from[1], budget),
  ];
  const dot = (left: ExactPoint, right: ExactPoint) =>
    addExact(
      multiplyExact(left[0], right[0], budget),
      multiplyExact(left[1], right[1], budget),
      budget,
    );
  const positive = (value: ExactFraction) =>
    compareExact(value, zero, budget) > 0;
  const poles: ExactCubic[] = tubes.map(
    (tube) => tube.poles.map(exactPoint) as unknown as ExactCubic,
  );
  const hodographs = poles.map((cubic) =>
    [0, 1, 2].map((index) => difference(cubic[index + 1]!, cubic[index]!)),
  );
  const derivatives = tubes.map((tube) =>
    tube.reference.derivative.map((axis) => [
      exactFromNumber(axis[0], budget),
      exactFromNumber(axis[1], budget),
    ]),
  );
  const errors = tubes.map((tube) =>
    exactFromNumber(tube.certifiedError, budget),
  );

  // J1: exact true-offset endpoint identity at every declared join.
  const kinds: CubicTubeChainJoin["kind"][] = [];
  for (const [first, second] of joins) {
    const left = tubes[first]!;
    const right = tubes[second]!;
    if (sameLeaf(left, right)) {
      kinds.push("same-leaf");
      continue;
    }
    const p = left.reference.sourcePoles;
    const q = right.reference.sourcePoles;
    const knot =
      left.source.splineId === right.source.splineId &&
      left.source.endOccurrenceId === right.source.startOccurrenceId &&
      left.sourceLocalInterval[1] === 1 &&
      right.sourceLocalInterval[0] === 0 &&
      samePoint(p[3], q[0]);
    const incoming = knot && difference(exactPoint(p[3]), exactPoint(p[2]));
    const outgoing = knot && difference(exactPoint(q[1]), exactPoint(q[0]));
    if (
      !incoming ||
      !outgoing ||
      compareExact(crossExact(incoming, outgoing, budget), zero, budget) !==
        0 ||
      !positive(dot(incoming, outgoing))
    )
      return uncertain(
        "cubic-tube-knot-incidence-unproven",
        "The true offset endpoints of a declared join are not proved identical.",
        first,
        second,
      );
    kinds.push("parallel-knot");
  }

  // K1: strict cone of the emitted hodographs and the owner O′ boxes.
  const coneDirection = (indices: readonly number[]): SplineVector | null => {
    const direction: [number, number] = [0, 0];
    for (const index of indices) {
      const cubic = tubes[index]!.poles;
      for (let pole = 0; pole < 3; pole += 1) {
        direction[0] += cubic[pole + 1]![0] - cubic[pole]![0];
        direction[1] += cubic[pole + 1]![1] - cubic[pole]![1];
      }
    }
    if (!direction.every(Number.isFinite)) return null;
    const e = exactPoint(direction);
    for (const index of indices) {
      if (!hodographs[index]!.every((step) => positive(dot(e, step))))
        return null;
      // min over the box of e·v is attained at the e-signed corner.
      const box = derivatives[index]!;
      const corner: ExactPoint = [
        box[0]![direction[0] >= 0 ? 0 : 1]!,
        box[1]![direction[1] >= 0 ? 0 : 1]!,
      ];
      if (!positive(dot(e, corner))) return null;
    }
    return direction;
  };
  const directions: SplineVector[] = [];
  for (const [first, second] of joins) {
    const direction = coneDirection([first, second]);
    if (!direction)
      return uncertain(
        "cubic-tube-cone-unproven",
        "The emitted and true offset derivatives are not proved inside one open half-plane.",
        first,
        second,
      );
    directions.push(direction);
  }
  let isolatedSpanDirection: SplineVector | undefined;
  if (count === 1) {
    const direction = coneDirection([0]);
    if (!direction)
      return uncertain(
        "cubic-tube-cone-unproven",
        "The emitted and true offset derivatives are not proved inside one open half-plane.",
        0,
      );
    isolatedSpanDirection = direction;
  }

  // K3: exact hull clearance of every non-join pair.
  const isJoin = (first: number, second: number) =>
    second === first + 1 || (closed && first === 0 && second === count - 1);
  const half = exact(1n, 2n, budget);
  const one = exact(1n, 1n, budget);
  const minimum = (values: readonly ExactFraction[]) =>
    values.reduce((low, value) =>
      compareExact(value, low, budget) < 0 ? value : low,
    );
  const maximum = (values: readonly ExactFraction[]) =>
    values.reduce((high, value) =>
      compareExact(value, high, budget) > 0 ? value : high,
    );
  const box = (cubic: ExactCubic) =>
    ([0, 1] as const).map((axis) => {
      const values = cubic.map((point) => point[axis]);
      return [minimum(values), maximum(values)] as const;
    });
  const restrict = (
    cubic: ExactCubic,
    lower: ExactFraction,
    upper: ExactFraction,
  ): ExactCubic => {
    const axis = (index: 0 | 1) =>
      restrictCubicBernstein(
        cubic.map((point) => point[index]) as unknown as ExactScalarCubic,
        lower,
        upper,
        budget,
      );
    const x = axis(0);
    const y = axis(1);
    return x.map((value, index) => [value, y[index]!]) as unknown as ExactCubic;
  };
  const squaredLength = (vector: ExactPoint) => dot(vector, vector);
  const clearedPairs: (readonly [number, number])[] = [];
  let maxSplits = 0;
  for (let first = 0; first < count; first += 1) {
    for (let second = first + 1; second < count; second += 1) {
      if (isJoin(first, second)) continue;
      const radius = addExact(errors[first]!, errors[second]!, budget);
      const radiusSquared = multiplyExact(radius, radius, budget);
      const stack: (readonly [ExactCubic, ExactCubic])[] = [
        [poles[first]!, poles[second]!],
      ];
      let splits = 0;
      while (stack.length > 0) {
        const [left, right] = stack.pop()!;
        const leftBox = box(left);
        const rightBox = box(right);
        const gap = (axis: 0 | 1) => {
          const above = subtractExact(
            rightBox[axis]![0],
            leftBox[axis]![1],
            budget,
          );
          const below = subtractExact(
            leftBox[axis]![0],
            rightBox[axis]![1],
            budget,
          );
          const larger = compareExact(above, below, budget) > 0 ? above : below;
          return positive(larger) ? larger : zero;
        };
        if (
          compareExact(squaredLength([gap(0), gap(1)]), radiusSquared, budget) >
          0
        )
          continue;
        // Diagnostic and cost shortcut only: exact on-curve endpoints within
        // ε_i + ε_j cannot be separated by this certificate. Soundness never
        // depends on it; without it the loop fails closed on the budget.
        for (const u of [left[0], left[3]])
          for (const v of [right[0], right[3]])
            if (
              compareExact(
                squaredLength(difference(u, v)),
                radiusSquared,
                budget,
              ) <= 0
            )
              return uncertain(
                "cubic-tube-clearance-unproven",
                "Certified error tubes overlap; true-offset separation not proved.",
                first,
                second,
              );
        budget.refinementStep();
        splits += 1;
        const width = (bounds: typeof leftBox) => {
          const x = subtractExact(bounds[0]![1], bounds[0]![0], budget);
          const y = subtractExact(bounds[1]![1], bounds[1]![0], budget);
          return compareExact(x, y, budget) > 0 ? x : y;
        };
        if (compareExact(width(leftBox), width(rightBox), budget) >= 0)
          stack.push(
            [restrict(left, zero, half), right],
            [restrict(left, half, one), right],
          );
        else
          stack.push(
            [left, restrict(right, zero, half)],
            [left, restrict(right, half, one)],
          );
      }
      maxSplits = Math.max(maxSplits, splits);
      clearedPairs.push([first, second]);
    }
  }

  budget.operation(8 + joins.length + clearedPairs.length);
  return {
    kind: "verified",
    certificate: {
      joins: joins.map(([first, second], index) => ({
        first,
        second,
        kind: kinds[index]!,
        direction: directions[index]!,
      })),
      ...(isolatedSpanDirection ? { isolatedSpanDirection } : {}),
      clearedPairs,
      maxSplits,
    },
  };
}

function createCertifier(
  lowerLimits?: LowerProofLimits,
  observeBudget?: (snapshot: ExactProofBudgetSnapshot) => void,
): CertifiedCubicTubeChain {
  return {
    certifyChain(request) {
      // One budget for the whole request: admission, conversion, every join,
      // pair, split and the certificate. Never reset or replaced.
      const budget = new ExactProofBudget(lowerLimits);
      try {
        return certifyChain(request, budget);
      } catch (error) {
        if (error instanceof ExactQueryProofBudgetExceeded) return EXHAUSTED;
        throw error;
      } finally {
        observeBudget?.(budget.snapshot());
      }
    },
  };
}

/** Production certifier under the unchanged exact-proof ceilings. */
export function createCertifiedCubicTubeChain(): CertifiedCubicTubeChain {
  return createCertifier();
}

/** Test-only lower ceilings; construction clamps every value to production. */
export function createCertifiedCubicTubeChainWithLowerBudgetForTest(
  lowerLimits: LowerProofLimits,
): CertifiedCubicTubeChain {
  return createCertifier(lowerLimits);
}

/** Test-only whole-request meter observation under production ceilings. */
export function createCertifiedCubicTubeChainWithBudgetObserverForTest(
  observeBudget: (snapshot: ExactProofBudgetSnapshot) => void,
): CertifiedCubicTubeChain {
  return createCertifier(undefined, observeBudget);
}
