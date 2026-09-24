// Focused production-native dispatcher negatives. These supplement, and never
// replace, the unchanged 13 semantic assertions in neutral-curve-conformance.
export function runNativeSemanticDispatcherConformance(oc) {
  const cases = [];
  let owned = [];
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const make = (name, ...args) => {
    assert(typeof oc[name] === "function", `Missing OCC binding: ${name}`);
    const value = new oc[name](...args);
    owned.push(value);
    return value;
  };
  const curve = (name, ...args) => {
    assert(typeof oc[name] === "function", `Missing OCC binding: ${name}`);
    return new oc[name](...args);
  };
  const handle = (value) => make("Handle_Geom2d_Curve_2", value);
  const queryDomains = (a, firstStart, firstEnd, b, secondStart, secondEnd) =>
    JSON.parse(
      oc.CadaraNativeNeutralCurveQuery.QueryJson(
        a.handle,
        firstStart,
        firstEnd,
        b.handle,
        secondStart,
        secondEnd,
        false,
        1e-6,
      ),
    );
  const query = (a, b) =>
    queryDomains(
      a,
      a.curve.FirstParameter(),
      a.curve.LastParameter(),
      b,
      b.curve.FirstParameter(),
      b.curve.LastParameter(),
    );
  const bezier = (poles) => {
    const array = make("TColgp_Array1OfPnt2d_2", 1, 4);
    poles.forEach((point, index) =>
      array.SetValue(index + 1, make("gp_Pnt2d_3", ...point)),
    );
    const value = curve("Geom2d_BezierCurve_1", array);
    return { curve: value, handle: handle(value) };
  };
  const circle = (x) => {
    const axis = make(
      "gp_Ax2d_2",
      make("gp_Pnt2d_3", x, 0),
      make("gp_Dir2d_4", 1, 0),
    );
    const value = curve("Geom2d_Circle_2", axis, 1, true);
    return { curve: value, handle: handle(value) };
  };
  const run = (name, body) => {
    owned = [];
    const entry = { name, status: "running" };
    cases.push(entry);
    try {
      body(entry);
      entry.status = "pass";
    } catch (error) {
      entry.status = "error";
      entry.error = String(error);
    } finally {
      for (const value of owned.reverse()) value.delete();
    }
  };

  run("exact-circle-guard-rejects-positive-gaps", (out) => {
    out.results = [Number.EPSILON * 2, 5e-7, 2e-6].map((gap) =>
      query(circle(1.5), circle(3.5 + gap)),
    );
    assert(
      out.results.every(
        (result) =>
          result.status === "verified" &&
          result.backend === "IntAna2d" &&
          result.points.length === 0 &&
          result.segments.length === 0,
      ),
      "Positive circle gaps must be exactly guarded as empty",
    );
  });

  run("analytic-angles-remain-support-candidates-across-seams", (out) => {
    const first = circle(1.5);
    const second = circle(3.5);
    out.piBoundary = queryDomains(first, 0, Math.PI, second, 0, Math.PI);
    out.nonzeroSeam = queryDomains(
      first,
      10,
      10 + 2 * Math.PI,
      second,
      1_000_000,
      1_000_000 + 2 * Math.PI,
    );
    for (const result of [out.piBoundary, out.nonzeroSeam]) {
      assert(
        result.status === "candidate" &&
          result.backend === "IntAna2d" &&
          result.points.length === 1,
        "Canonical analytic angles must be retained for certified winding/domain lifting",
      );
    }
  });

  run("structural-cubic-dispatch-is-exact-bit-identity-only", (out) => {
    const arch = [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ];
    const exact = query(bezier(arch), bezier([...arch].reverse()));
    const changed = structuredClone(arch).reverse();
    changed[1][1] = 1 + Number.EPSILON;
    const near = query(bezier(arch), bezier(changed));
    out.exactBackend = exact.backend;
    out.nearBackend = near.backend;
    assert(
      exact.status === "verified" &&
        exact.backend === "structuralBezierOverlap",
      "Exact reversed poles must use structural overlap",
    );
    assert(
      near.backend !== "structuralBezierOverlap",
      "One-ULP pole difference must not be tolerance-healed",
    );
  });

  run("reversed-structural-endpoints-preserve-exact-2^-53", (out) => {
    const arch = [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ];
    const epsilon = 2 ** -53;
    out.query = queryDomains(
      bezier(arch),
      0,
      1,
      bezier([...arch].reverse()),
      epsilon,
      0.5,
    );
    const last = out.query.segments[0]?.last;
    assert(
      out.query.status === "verified" &&
        out.query.backend === "structuralBezierOverlap" &&
        last?.u === 1 - epsilon &&
        last?.v === epsilon &&
        Math.hypot(
          last.first[0] - last.second[0],
          last.first[1] - last.second[1],
        ) <=
          Number.EPSILON * 16,
      "Exactly representable reversed complements must remain verified and incident",
    );
  });

  run("reversed-structural-endpoint-aliases-fail-closed", (out) => {
    const arch = [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ];
    const first = bezier(arch);
    const second = bezier([...arch].reverse());
    out.positiveMin = queryDomains(first, 0, 1, second, Number.MIN_VALUE, 0.5);
    out.negativeMin = queryDomains(first, 0, 1, second, -Number.MIN_VALUE, 0.5);
    assert(
      out.positiveMin.status === "uncertain" &&
        out.positiveMin.backend === "none" &&
        out.positiveMin.reason === "structural-domain-not-representable",
      "A distinct 1-MIN_VALUE bound that rounds to the active endpoint must fail closed",
    );
    assert(
      out.negativeMin.status === "verified" &&
        out.negativeMin.segments[0]?.last?.u === 1 &&
        out.negativeMin.segments[0]?.last?.v === 0,
      "A negative MIN_VALUE bound clipped by the opposite active endpoint remains exact",
    );
  });

  run("reversed-structural-rounding-is-ties-to-even", (out) => {
    const arch = [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ];
    const tie = 3 * 2 ** -54;
    out.tie = queryDomains(
      bezier(arch),
      0,
      1,
      bezier([...arch].reverse()),
      tie,
      0.5,
    );
    out.decimal = queryDomains(
      bezier(arch),
      0,
      1,
      bezier([...arch].reverse()),
      0.2,
      0.8,
    );
    const tieLast = out.tie.segments[0]?.last;
    assert(
      out.tie.status === "candidate" &&
        out.tie.reason ===
          "structural-rounded-endpoints-require-domain-certification" &&
        tieLast?.u === 1 - tie &&
        tieLast?.v === tie,
      "A nonrepresentable midpoint complement must round ties-to-even and remain a candidate",
    );
    assert(
      out.decimal.status === "candidate" &&
        out.decimal.backend === "structuralBezierOverlap" &&
        out.decimal.segments.length === 1,
      "Nonexact decimal endpoints must preserve the original structural fixture as candidates",
    );
  });

  run("noninjective-structural-overlap-is-component-only", (out) => {
    // This exact loop has an off-diagonal self-intersection at u=.25/.75.
    // The diagonal overlap segment alone is therefore not the complete set.
    const loop = [
      [0, 0],
      [-1 / 3, -13 / 48],
      [-1 / 3, -13 / 24],
      [0, 3 / 16],
    ];
    out.query = query(bezier(loop), bezier(loop));
    assert(
      out.query.status === "candidate" &&
        out.query.backend === "structuralBezierOverlap" &&
        out.query.reason === "structural-component-only-noninjective-basis",
      "Noninjective structural identity must not claim a complete verified set",
    );
  });

  return {
    cases,
    summary: {
      pass: cases.filter((entry) => entry.status === "pass").length,
      error: cases.filter((entry) => entry.status === "error").length,
    },
  };
}
