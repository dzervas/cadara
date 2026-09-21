/** Sole neutral reconstruction seam. No kernel, topology or persistence authority.
 * Differentials are analytic directional derivatives: seed a canonical coordinate
 * or authored handle component with 1 to obtain a Jacobian column. */
export type SplineVector = readonly [number, number];
export type SplinePoles = readonly [
  SplineVector,
  SplineVector,
  SplineVector,
  SplineVector,
];
export type SplineTangent =
  | { readonly kind: "automatic" }
  | { readonly kind: "authored"; readonly vector: SplineVector };
export interface ResolvedSplineInput {
  readonly id: string;
  readonly policy: "centripetal-mean-arm-v1";
  readonly closure: "open" | "positional" | "smooth";
  readonly points: readonly {
    readonly id: string;
    readonly position: SplineVector;
    readonly tangent: SplineTangent;
  }[];
}
export interface SplineVariation {
  /** Shared canonical IDs move together, including positional endpoint aliases. */
  readonly points?: Readonly<Record<string, SplineVector>>;
  /** Tangent intent belongs to an ordered occurrence, not the shared point record. */
  readonly tangents?: Readonly<Record<number, SplineVector>>;
}
export interface SplineSpan {
  readonly source: {
    readonly splineId: string;
    readonly spanIndex: number;
    readonly startPointId: string;
    readonly endPointId: string;
  };
  readonly orientation: "forward";
  /** t = interval[0] + u * (interval[1] - interval[0]). */
  readonly interval: readonly [number, number];
  readonly poles: SplinePoles;
  readonly validity: "valid";
  readonly differential: {
    readonly interval: readonly [number, number];
    readonly poles: SplinePoles;
  };
}
export interface SplineDiagnostic {
  readonly code:
    | "too-few-points"
    | "unsupported-policy"
    | "non-finite"
    | "inconsistent-point"
    | "coincident-points"
    | "positional-gap";
  readonly pointIndex?: number;
  readonly spanIndex?: number;
}
export type SplineGeometry =
  | {
      readonly validity: "invalid";
      readonly diagnostics: readonly SplineDiagnostic[];
      readonly spans: readonly [];
    }
  | {
      readonly validity: "valid";
      readonly diagnostics: readonly [];
      readonly spans: readonly SplineSpan[];
      readonly handles: readonly SplineVector[];
      readonly handleDifferentials: readonly SplineVector[];
    };

const zero: SplineVector = [0, 0];
const add = (a: SplineVector, b: SplineVector): SplineVector => [
  a[0] + b[0],
  a[1] + b[1],
];
const sub = (a: SplineVector, b: SplineVector): SplineVector => [
  a[0] - b[0],
  a[1] - b[1],
];
const scale = (a: SplineVector, b: number): SplineVector => [
  a[0] * b,
  a[1] * b,
];
const finite = (v: SplineVector) => v.every(Number.isFinite);

/** Positive intervals only; exact coincident points are retained and diagnosed.
 * 'valid' means reconstruction is defined, NOT regularity or profile validity.
 * Positional closure requires coincident endpoints, but never wraps tangents.
 * No near-degenerate modeling threshold or automatic repair is introduced. */
export function reconstructSpline(
  input: ResolvedSplineInput,
  variation: SplineVariation = {},
): SplineGeometry {
  const { points } = input;
  const n = points.length;
  const diagnostics: SplineDiagnostic[] = [];
  if (input.policy !== "centripetal-mean-arm-v1")
    diagnostics.push({ code: "unsupported-policy" });
  if (n < 2) diagnostics.push({ code: "too-few-points" });
  const canonical = new Map<string, SplineVector>();
  points.forEach((p, i) => {
    if (
      !finite(p.position) ||
      (p.tangent.kind === "authored" && !finite(p.tangent.vector)) ||
      !finite(variation.points?.[p.id] ?? zero) ||
      !finite(variation.tangents?.[i] ?? zero)
    )
      diagnostics.push({ code: "non-finite", pointIndex: i });
    const prior = canonical.get(p.id);
    if (prior && (prior[0] !== p.position[0] || prior[1] !== p.position[1]))
      diagnostics.push({ code: "inconsistent-point", pointIndex: i });
    canonical.set(p.id, p.position);
  });
  if (
    input.closure === "positional" &&
    n >= 2 &&
    points[0].position.some((v, axis) => v !== points[n - 1].position[axis])
  )
    diagnostics.push({ code: "positional-gap" });
  const invalid = (): SplineGeometry => ({
    validity: "invalid",
    diagnostics,
    spans: [],
  });
  if (diagnostics.length) return invalid();
  const wrapped = input.closure === "smooth";
  const count = wrapped ? n : n - 1;
  const dp = points.map((p) => variation.points?.[p.id] ?? zero);
  const h: number[] = [],
    dh: number[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    const r = sub(points[j].position, points[i].position);
    const dr = sub(dp[j], dp[i]);
    const length = Math.hypot(...r);
    h[i] = Math.sqrt(length);
    // dh = (r dot dr)/(2 |r|^(3/2)); normalized r avoids needless overflow.
    dh[i] =
      length === 0
        ? 0
        : ((r[0] / length) * dr[0] + (r[1] / length) * dr[1]) / (2 * h[i]);
    if (length === 0)
      diagnostics.push({ code: "coincident-points", spanIndex: i });
    else if (!Number.isFinite(h[i]) || !Number.isFinite(dh[i]))
      diagnostics.push({ code: "non-finite", spanIndex: i });
  }
  if (diagnostics.length) return invalid();
  const derivatives: SplineVector[] = [],
    dDerivatives: SplineVector[] = [];
  const handles: SplineVector[] = [],
    handleDifferentials: SplineVector[] = [];
  points.forEach((p, i) => {
    let w: number, dw: number, auto: SplineVector, dAuto: SplineVector;
    if (!wrapped && (i === 0 || i === n - 1)) {
      const k = i === 0 ? 0 : n - 2;
      w = h[k];
      dw = dh[k];
      auto = scale(sub(points[k + 1].position, points[k].position), 1 / w);
      dAuto = scale(sub(sub(dp[k + 1], dp[k]), scale(auto, dw)), 1 / w);
    } else {
      const previous = (i + n - 1) % n,
        next = (i + 1) % n;
      const a = h[previous],
        b = h[i],
        da = dh[previous],
        db = dh[i];
      w = (a + b) / 2;
      dw = (da + db) / 2;
      const v = scale(sub(p.position, points[previous].position), 1 / a);
      const z = scale(sub(points[next].position, p.position), 1 / b);
      const dv = scale(sub(sub(dp[i], dp[previous]), scale(v, da)), 1 / a);
      const dz = scale(sub(sub(dp[next], dp[i]), scale(z, db)), 1 / b);
      auto = scale(add(scale(v, b), scale(z, a)), 1 / (a + b));
      const dNumerator = add(
        add(scale(v, db), scale(dv, b)),
        add(scale(z, da), scale(dz, a)),
      );
      dAuto = scale(sub(dNumerator, scale(auto, da + db)), 1 / (a + b));
    }
    if (p.tangent.kind === "authored") {
      const handle = p.tangent.vector,
        dHandle = variation.tangents?.[i] ?? zero;
      handles[i] = handle;
      handleDifferentials[i] = dHandle;
      derivatives[i] = scale(handle, 3 / w);
      dDerivatives[i] = scale(
        sub(scale(dHandle, 3), scale(derivatives[i], dw)),
        1 / w,
      );
    } else {
      derivatives[i] = auto;
      dDerivatives[i] = dAuto;
      handles[i] = scale(auto, w / 3);
      handleDifferentials[i] = scale(
        add(scale(dAuto, w), scale(auto, dw)),
        1 / 3,
      );
    }
  });
  let t = 0,
    dt = 0;
  const spans: SplineSpan[] = h.map((length, i) => {
    const j = (i + 1) % n;
    const poles: SplinePoles = [
      points[i].position,
      add(points[i].position, scale(derivatives[i], length / 3)),
      sub(points[j].position, scale(derivatives[j], length / 3)),
      points[j].position,
    ];
    const differentialPoles: SplinePoles = [
      dp[i],
      add(
        dp[i],
        scale(
          add(scale(dDerivatives[i], length), scale(derivatives[i], dh[i])),
          1 / 3,
        ),
      ),
      sub(
        dp[j],
        scale(
          add(scale(dDerivatives[j], length), scale(derivatives[j], dh[i])),
          1 / 3,
        ),
      ),
      dp[j],
    ];
    const span: SplineSpan = {
      source: {
        splineId: input.id,
        spanIndex: i,
        startPointId: points[i].id,
        endPointId: points[j].id,
      },
      orientation: "forward",
      validity: "valid",
      interval: [t, t + length],
      poles,
      differential: { interval: [dt, dt + dh[i]], poles: differentialPoles },
    };
    t += length;
    dt += dh[i];
    if (
      !poles.every(finite) ||
      !differentialPoles.every(finite) ||
      !Number.isFinite(t) ||
      !Number.isFinite(dt) ||
      span.interval[1] <= span.interval[0]
    )
      diagnostics.push({ code: "non-finite", spanIndex: i });
    return span;
  });
  return diagnostics.length
    ? invalid()
    : {
        validity: "valid",
        diagnostics: [],
        spans,
        handles,
        handleDifferentials,
      };
}

export interface SplineEvaluation {
  readonly position: SplineVector;
  /** Derivatives in the requested parameter units (local u or source t). */
  readonly first: SplineVector;
  readonly second: SplineVector;
  readonly differential: {
    readonly position: SplineVector;
    readonly first: SplineVector;
    readonly second: SplineVector;
  };
}

/** Evaluate the same cubic, including analytic mixed variable/parameter derivatives.
 * Source-parameter differentiation accounts for moving cumulative knots. The
 * supplied span is held fixed; this API does not choose sides at a moving knot. */
export function evaluateSplineSpan(
  span: SplineSpan,
  parameter: {
    readonly kind: "local" | "source";
    readonly value: number;
    readonly differential?: number;
  },
): SplineEvaluation {
  const [lo, hi] = span.interval,
    [dlo, dhi] = span.differential.interval;
  const h = hi - lo,
    dh = dhi - dlo;
  const source = parameter.kind === "source";
  const u = source ? (parameter.value - lo) / h : parameter.value;
  const du = source
    ? ((parameter.differential ?? 0) - dlo - u * dh) / h
    : (parameter.differential ?? 0);
  if (!Number.isFinite(u) || !Number.isFinite(du) || u < 0 || u > 1)
    throw new RangeError(
      "Spline parameter must be finite and inside its source span",
    );
  const v = 1 - u;
  const weights = [v ** 3, 3 * v * v * u, 3 * v * u * u, u ** 3];
  const firstWeights = [
    -3 * v * v,
    3 * v * v - 6 * v * u,
    6 * v * u - 3 * u * u,
    3 * u * u,
  ];
  const secondWeights = [6 * v, -12 * v + 6 * u, 6 * v - 12 * u, 6 * u];
  const sum = (poles: SplinePoles, factors: readonly number[]) =>
    poles.reduce<SplineVector>(
      (sum, p, i) => add(sum, scale(p, factors[i])),
      zero,
    );
  const position = sum(span.poles, weights),
    first = sum(span.poles, firstWeights),
    second = sum(span.poles, secondWeights);
  const third = sum(span.poles, [-6, 18, -18, 6]);
  const dPosition = add(
    sum(span.differential.poles, weights),
    scale(first, du),
  );
  const dFirst = add(
    sum(span.differential.poles, firstWeights),
    scale(second, du),
  );
  const dSecond = add(
    sum(span.differential.poles, secondWeights),
    scale(third, du),
  );
  const unit = source ? h : 1,
    dUnit = source ? dh : 0;
  return {
    position,
    first: scale(first, 1 / unit),
    second: scale(second, 1 / unit ** 2),
    differential: {
      position: dPosition,
      first: scale(sub(dFirst, scale(first, dUnit / unit)), 1 / unit),
      second: scale(
        sub(dSecond, scale(second, (2 * dUnit) / unit)),
        1 / unit ** 2,
      ),
    },
  };
}
