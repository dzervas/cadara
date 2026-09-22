// Logic-lane shared OCC binding conformance; independent polynomial oracles are test-only.
// Reused by the staged build gate and production regression. No runtime/full-package fallback.
export function runNeutralCurveConformance(oc) {
  const tolerance = 1e-6,
    numericTolerance = 1e-10;
  const arch = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ];
  // x=u²-u; y=u³-13u/16. The unique interior crossing is u=1/4,3/4.
  const loop = [
    [0, 0],
    [-1 / 3, -13 / 48],
    [-1 / 3, -13 / 24],
    [0, 3 / 16],
  ];
  const result = { cases: [] };
  const needed = new Set();
  let owned;
  function make(name, ...args) {
    needed.add(name);
    assert(
      typeof oc[name] === "function",
      `Missing custom OCC binding: ${name}`,
    );
    const o = new oc[name](...args);
    owned.push(o);
    return o;
  }
  function keep(o) {
    owned.push(o);
    return o;
  }
  // Curves are native refcounted transients: only their handles own the pointees.
  function curve(name, ...args) {
    needed.add(name);
    assert(
      typeof oc[name] === "function",
      `Missing custom OCC binding: ${name}`,
    );
    return new oc[name](...args);
  }
  function handle(c, dim = 2) {
    return make(dim === 2 ? "Handle_Geom2d_Curve_2" : "Handle_Geom_Curve_2", c);
  }
  function assert(ok, message) {
    if (!ok) throw new Error(message);
  }
  function close(actual, expected, eps = numericTolerance) {
    assert(
      Math.abs(actual - expected) <= eps,
      `${actual} != ${expected} within ${eps}`,
    );
  }
  function xy(p) {
    return [p.X(), p.Y()];
  }
  function distance(a, b) {
    return Math.hypot(...a.map((v, i) => v - b[i]));
  }
  function evaluate(poles, u) {
    const v = 1 - u,
      weights = [v ** 3, 3 * v * v * u, 3 * v * u * u, u ** 3];
    return [0, 1].map((k) =>
      weights.reduce((s, w, i) => s + w * poles[i][k], 0),
    );
  }
  function derivative(p, u) {
    return [0, 1].map(
      (k) =>
        3 *
        ((1 - u) ** 2 * (p[1][k] - p[0][k]) +
          2 * (1 - u) * u * (p[2][k] - p[1][k]) +
          u * u * (p[3][k] - p[2][k])),
    );
  }
  function bezier(poles, dim = 2) {
    const array = make(
      dim === 2 ? "TColgp_Array1OfPnt2d_2" : "TColgp_Array1OfPnt_2",
      1,
      4,
    );
    poles.forEach((p, i) =>
      array.SetValue(
        i + 1,
        dim === 2 ? make("gp_Pnt2d_3", ...p) : make("gp_Pnt_3", ...p, 0),
      ),
    );
    const c = curve(
      dim === 2 ? "Geom2d_BezierCurve_1" : "Geom_BezierCurve_1",
      array,
    );
    return { c, h: handle(c, dim), evaluate: (u) => evaluate(poles, u) };
  }
  function line(y) {
    const c = curve(
      "Geom2d_Line_3",
      make("gp_Pnt2d_3", 0, y),
      make("gp_Dir2d_4", 1, 0),
    );
    return { c, h: handle(c), evaluate: (u) => [u, y] };
  }
  function circle() {
    const axis = make(
      "gp_Ax2d_2",
      make("gp_Pnt2d_3", 1.5, 0),
      make("gp_Dir2d_4", 1, 0),
    );
    const c = curve("Geom2d_Circle_2", axis, 1, true);
    return {
      c,
      h: handle(c),
      evaluate: (u) => [1.5 + Math.cos(u), Math.sin(u)],
    };
  }
  function intersections(a, b, self = false) {
    // Own the lower-level intersector: the high-level copied return failed the feasibility probe.
    const aa = make("Geom2dAdaptor_Curve_2", a.h);
    const inter = self
      ? make("Geom2dInt_GInter_2", aa, tolerance, tolerance)
      : make(
          "Geom2dInt_GInter_4",
          aa,
          make("Geom2dAdaptor_Curve_2", b.h),
          tolerance,
          tolerance,
        );
    assert(inter.IsDone(), "Direct Geom2dInt_GInter not done");
    const sample = (point) => {
      const u = point.ParamOnFirst(),
        v = point.ParamOnSecond();
      const first = a.evaluate(u),
        second = b.evaluate(v),
        reported = xy(keep(point.Value()));
      const residual = distance(first, second);
      return {
        u,
        v,
        first,
        second,
        reported,
        residual,
        reportedResidual: Math.max(
          distance(first, reported),
          distance(second, reported),
        ),
        withinCandidateBudget: residual <= tolerance,
      };
    };
    const points = Array.from({ length: inter.NbPoints() }, (_, i) =>
      sample(keep(inter.Point(i + 1))),
    );
    const segments = Array.from({ length: inter.NbSegments() }, (_, i) => {
      const s = keep(inter.Segment(i + 1));
      return {
        opposite: s.IsOpposite(),
        first: s.HasFirstPoint() ? sample(keep(s.FirstPoint())) : null,
        last: s.HasLastPoint() ? sample(keep(s.LastPoint())) : null,
      };
    });
    return {
      done: true,
      parameterBackend: "direct Geom2dInt_GInter",
      points,
      segments,
    };
  }
  function run(name, fn) {
    owned = [];
    const entry = { name, status: "running" };
    result.cases.push(entry);
    try {
      fn(entry);
      entry.status = "pass";
    } catch (error) {
      entry.status = "error";
      entry.error = { message: String(error), stack: error?.stack ?? null };
      console.error(name, error);
    } finally {
      // Cleanup failures must also surface, rather than being silently swallowed.
      for (const object of owned.reverse()) {
        try {
          object.delete();
        } catch (error) {
          entry.status = "error";
          (entry.cleanupErrors ??= []).push(String(error));
          console.error("cleanup", name, error);
        }
      }
    }
  }
  run("evaluation-derivative-and-source-parameter-trim", (out) => {
    const a = bezier(arch),
      trim = curve("Geom2d_TrimmedCurve", a.h, 0.2, 0.8, true, true);
    handle(trim);
    const segmented = bezier(arch);
    segmented.c.Segment(0.2, 0.8);
    out.samples = [0, 0.125, 0.371234, 0.5, 0.875, 1].map((u) => {
      const p = make("gp_Pnt2d_1"),
        d = make("gp_Vec2d_1");
      a.c.D1(u, p, d);
      const evaluationResidual = distance(xy(p), evaluate(arch, u));
      const derivativeResidual = distance(xy(d), derivative(arch, u));
      const sourceU = 0.2 + 0.6 * u;
      const preservedTrimResidual = distance(
        xy(keep(trim.Value(sourceU))),
        evaluate(arch, sourceU),
      );
      const segmentedResidual = distance(
        xy(keep(segmented.c.Value(u))),
        evaluate(arch, sourceU),
      );
      [
        evaluationResidual,
        derivativeResidual,
        preservedTrimResidual,
        segmentedResidual,
      ].forEach((r) => close(r, 0));
      return {
        u,
        sourceU,
        evaluationResidual,
        derivativeResidual,
        preservedTrimResidual,
        segmentedResidual,
      };
    });
    out.trimDomain = [trim.FirstParameter(), trim.LastParameter()];
    close(out.trimDomain[0], 0.2);
    close(out.trimDomain[1], 0.8);
    out.segmentedDomain = [
      segmented.c.FirstParameter(),
      segmented.c.LastParameter(),
    ];
    out.parameterRule =
      "Geom2d_TrimmedCurve preserves source u; Bezier.Segment reparameterizes to [0,1], source u=.2+.6*v.";
  });
  run("line-cubic-transverse", (out) => {
    out.query = intersections(bezier(arch), line(0.5));
    assert(
      out.query.points.length === 2 && out.query.segments.length === 0,
      "Expected two isolated intersections",
    );
    out.expectedCubicParameters = [
      (1 - Math.sqrt(1 / 3)) / 2,
      (1 + Math.sqrt(1 / 3)) / 2,
    ];
    out.query.points
      .sort((a, b) => a.u - b.u)
      .forEach((p, i) => {
        close(p.u, out.expectedCubicParameters[i]);
        close(p.residual, 0);
        close(p.reportedResidual, 0);
      });
  });
  run("exact-circle-cubic-transverse", (out) => {
    out.query = intersections(bezier(arch), circle());
    assert(
      out.query.points.length === 2 && out.query.segments.length === 0,
      "Expected two exact-circle intersections",
    );
    out.expectedCubicParameters = [
      0.5 - Math.sqrt(1 / 12),
      0.5 + Math.sqrt(1 / 12),
    ];
    out.query.points
      .sort((a, b) => a.u - b.u)
      .forEach((p, i) => {
        close(p.u, out.expectedCubicParameters[i]);
        close(p.residual, 0);
        close(p.reportedResidual, 0);
      });
  });
  run("same-span-cubic-self-intersection", (out) => {
    const c = bezier(loop);
    out.query = intersections(c, c, true);
    assert(
      out.query.points.length === 1,
      "Expected one self-intersection pair",
    );
    const p = out.query.points[0],
      params = [p.u, p.v].sort((a, b) => a - b);
    close(params[0], 0.25);
    close(params[1], 0.75);
    close(p.residual, 0);
    close(p.reportedResidual, 0);
  });
  run("tangent-line-cubic", (out) => {
    out.query = intersections(bezier(arch), line(0.75));
    assert(
      out.query.points.length + out.query.segments.length > 0,
      "Expected tangent contact",
    );
    assert(out.query.points.length === 1, "Fixture expects one tangent point");
    close(out.query.points[0].u, 0.5);
    close(out.query.points[0].v, 1.5);
    close(out.query.points[0].residual, 0);
    close(out.query.points[0].reportedResidual, 0);
    out.contactInterpretation =
      "Raw point/segment output only; no inferred crossing or overlap topology.";
  });
  run("identical-cubic-overlap", (out) => {
    out.query = intersections(bezier(arch), bezier(arch));
    assert(
      out.query.segments.length === 1,
      "Expected one contact interval, not empty/isolated crossing",
    );
    const interval = out.query.segments[0];
    assert(
      interval.first && interval.last,
      "Expected bounded overlap parameters",
    );
    close(interval.first.u, 0);
    close(interval.first.v, 0);
    close(interval.last.u, 1);
    close(interval.last.v, 1);
    close(interval.first.residual, 0);
    close(interval.last.residual, 0);
  });
  run("near-gap-query-and-explicit-endpoint-budget-gates", (out) => {
    out.samples = [0.5 * tolerance, 2 * tolerance].map((gap) => {
      const query = intersections(bezier(arch), line(0.75 + gap));
      assert(
        query.points.length === (gap < tolerance ? 1 : 0) &&
          query.segments.length === 0,
        "Near-gap fixture contact count changed",
      );
      if (gap < tolerance) close(query.points[0].residual, gap);
      const start = evaluate(arch, 1),
        candidate = [start[0] + gap, start[1]];
      const endpointGap = distance(start, candidate),
        endpointWithinCandidateBudget = endpointGap <= tolerance;
      assert(
        endpointWithinCandidateBudget === gap < tolerance,
        "Endpoint budget gate mismatch",
      );
      return {
        gap,
        lineY: 0.75 + gap,
        query,
        endpointGap,
        endpointWithinCandidateBudget,
        repairApplied: false,
        note: "Budget membership is diagnostic only, never permission to merge authored endpoints or bridge a gap.",
      };
    });
  });
  run("cubic-cubic-transverse", (out) => {
    const horizontal = [
      [0, 0.5],
      [1, 0.5],
      [2, 0.5],
      [3, 0.5],
    ];
    out.query = intersections(bezier(arch), bezier(horizontal));
    assert(
      out.query.points.length === 2 && out.query.segments.length === 0,
      "Expected two cubic/cubic crossings",
    );
    const expected = [(1 - Math.sqrt(1 / 3)) / 2, (1 + Math.sqrt(1 / 3)) / 2];
    out.query.points
      .sort((a, b) => a.u - b.u)
      .forEach((p, i) => {
        close(p.u, expected[i]);
        close(p.v, expected[i]);
        close(p.residual, 0);
        close(p.reportedResidual, 0);
      });
  });
  run("reversed-partial-cubic-overlap", (out) => {
    const a = bezier(arch),
      b = bezier([...arch].reverse());
    const trim = curve("Geom2d_TrimmedCurve", b.h, 0.2, 0.8, true, true);
    out.query = intersections(a, {
      c: trim,
      h: handle(trim),
      evaluate: (u) => evaluate(arch, 1 - u),
    });
    assert(
      out.query.segments.length === 1,
      "Expected one reversed partial contact interval",
    );
    const interval = out.query.segments[0];
    assert(
      interval.opposite && interval.first && interval.last,
      "Expected bounded opposite traversal",
    );
    const ordered = [interval.first, interval.last].sort((a, b) => a.u - b.u);
    close(ordered[0].u, 0.2);
    close(ordered[0].v, 0.8);
    close(ordered[1].u, 0.8);
    close(ordered[1].v, 0.2);
    ordered.forEach((p) => {
      close(p.residual, 0);
      close(p.reportedResidual, 0);
    });
  });
  run("point-touching-circles", (out) => {
    const a = circle();
    const axis = make(
      "gp_Ax2d_2",
      make("gp_Pnt2d_3", 3.5, 0),
      make("gp_Dir2d_4", 1, 0),
    );
    const c = curve("Geom2d_Circle_2", axis, 1, true);
    out.query = intersections(a, {
      c,
      h: handle(c),
      evaluate: (u) => [3.5 + Math.cos(u), Math.sin(u)],
    });
    assert(
      out.query.points.length === 1 && out.query.segments.length === 0,
      "Expected one point contact",
    );
    close(out.query.points[0].residual, 0);
    close(out.query.points[0].reportedResidual, 0);
    // Region ownership is sketch-side; this does not assert arrangement construction.
  });
  run("zero-endpoint-derivative-is-not-repaired", (out) => {
    const poles = [
        [0, 0],
        [0, 0],
        [2, 1],
        [3, 0],
      ],
      a = bezier(poles);
    const p = make("gp_Pnt2d_1"),
      d = make("gp_Vec2d_1");
    a.c.D1(0, p, d);
    out.point = xy(p);
    out.derivative = xy(d);
    close(distance(out.point, [0, 0]), 0);
    close(distance(out.derivative, [0, 0]), 0);
    // A zero authored handle is representable; regularity/degenerate-span policy belongs to the sketch owner.
  });
  function buildTrimmedBoundary(out, u0, u1, baseline, lineParameters) {
    const a = bezier(arch, 3);
    const edgeMaker = make("BRepBuilderAPI_MakeEdge_25", a.h, u0, u1);
    assert(edgeMaker.IsDone(), "Trimmed curve edge failed");
    const edge = keep(edgeMaker.Edge());
    const adaptor = make("BRepAdaptor_Curve_2", edge);
    out.edgeSourceDomain = [adaptor.FirstParameter(), adaptor.LastParameter()];
    close(out.edgeSourceDomain[0], u0);
    close(out.edgeSourceDomain[1], u1);
    out.edgeSourceResiduals = [u0, 0.37, 0.5, u1].map((u) => {
      const p = keep(adaptor.Value(u));
      const residual = distance(
        [p.X(), p.Y(), p.Z()],
        [...evaluate(arch, u), 0],
      );
      close(residual, 0);
      return { u, residual };
    });
    const start = lineParameters
      ? [lineParameters[0], baseline]
      : evaluate(arch, u0);
    const end = lineParameters
      ? [lineParameters[1], baseline]
      : evaluate(arch, u1);
    const chordMaker = make(
      "BRepBuilderAPI_MakeEdge_3",
      make("gp_Pnt_3", ...end, 0),
      make("gp_Pnt_3", ...start, 0),
    );
    assert(chordMaker.IsDone(), "Closing line edge failed");
    const wireMaker = make(
      "BRepBuilderAPI_MakeWire_3",
      edge,
      keep(chordMaker.Edge()),
    );
    assert(wireMaker.IsDone(), "Wire failed");
    const wire = keep(wireMaker.Wire()),
      faceMaker = make("BRepBuilderAPI_MakeFace_15", wire, true);
    assert(faceMaker.IsDone(), "Face failed");
    const face = keep(faceMaker.Face());
    const prism = make(
      "BRepPrimAPI_MakePrism_1",
      face,
      make("gp_Vec_4", 0, 0, 2),
      false,
      true,
    );
    assert(prism.IsDone(), "Extrusion failed");
    const solid = keep(prism.Shape());
    out.validity = Object.fromEntries(
      [
        ["wire", wire],
        ["face", face],
        ["extrusion", solid],
      ].map(([name, shape]) => [
        name,
        make("BRepCheck_Analyzer", shape, true, false).IsValid_2(),
      ]),
    );
    assert(
      Object.values(out.validity).every(Boolean),
      "BRepCheck validity failed",
    );
    const area = make("GProp_GProps_1"),
      volume = make("GProp_GProps_1");
    needed.add("BRepGProp");
    oc.BRepGProp.SurfaceProperties_1(face, area, false, false);
    oc.BRepGProp.VolumeProperties_1(solid, volume, true, false, false);
    // Independent analytic integral: x=3u, y=3u(1-u); area = integral [y(u)-baseline]*3 du.
    const primitive = (u) => 4.5 * u * u - 3 * u * u * u - 3 * baseline * u;
    const expectedArea = primitive(u1) - primitive(u0),
      expectedVolume = 2 * expectedArea;
    out.mass = {
      expectedArea,
      area: area.Mass(),
      expectedVolume,
      volume: volume.Mass(),
      areaResidual: Math.abs(area.Mass() - expectedArea),
      volumeResidual: Math.abs(volume.Mass() - expectedVolume),
    };
    close(area.Mass(), expectedArea, 1e-9);
    close(volume.Mass(), expectedVolume, 1e-9);
  }
  run("exact-trimmed-cubic-wire-face-extrusion", (out) => {
    buildTrimmedBoundary(out, 0.2, 0.8, 0.48);
  });
  run("intersection-parameters-to-trimmed-boundary-face-extrusion", (out) => {
    out.query = intersections(bezier(arch), line(0.5));
    assert(
      out.query.points.length === 2 && out.query.segments.length === 0,
      "Expected two isolated boundary intersections",
    );
    const ordered = [...out.query.points].sort((a, b) => a.u - b.u);
    ordered.forEach((p) => {
      close(p.residual, 0);
      close(p.reportedResidual, 0);
    });
    out.boundarySources = {
      cubic: { poles: arch, u0: ordered[0].u, u1: ordered[1].u },
      reverseLine: {
        origin: [0, 0.5],
        direction: [1, 0],
        v0: ordered[1].v,
        v1: ordered[0].v,
      },
    };
    // Build from the returned cubic parameters, not the independently known roots.
    buildTrimmedBoundary(out, ordered[0].u, ordered[1].u, 0.5, [
      ordered[0].v,
      ordered[1].v,
    ]);
    // Closed-form area between the analytic roots additionally checks the parameter interval.
    out.closedFormArea = 1 / (2 * Math.sqrt(3));
    close(out.mass.area, out.closedFormArea, 1e-9);
    close(out.mass.volume, 2 * out.closedFormArea, 1e-9);
  });
  result.usedBindings = [...needed].sort();
  result.summary = {
    pass: result.cases.filter((c) => c.status === "pass").length,
    error: result.cases.filter((c) => c.status === "error").length,
  };
  return result;
}
