import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createCertifiedNeutralCurveQueryWithBudgetObserverForTest } from "@/domain/modeling/neutral-curve-certification/query.ts";
import { createSketchArrangementDeriver } from "@/contracts/sketch/region-extraction.ts";
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures.ts";
const label = process.argv[2] || "baseline",
  repeats = Number(process.argv[3] || 3);
const dir = path.resolve("scripts/region-research/results", label);
fs.mkdirSync(dir, { recursive: true });
const events = [],
  rows = [];
let currentCase = "",
  budget,
  queryRows = [];
const query = createCertifiedNeutralCurveQueryWithBudgetObserverForTest(
  (x) => (budget = x),
);
function measured(op, req) {
  const start = performance.now();
  const result = query[op](req);
  const ms = performance.now() - start;
  const row = {
    case: currentCase,
    operation: op,
    ms,
    kind: result.kind,
    code: result.code,
    points: result.points?.length,
    budget,
  };
  queryRows.push(row);
  events.push({
    name: op,
    cat: "geometry",
    ph: "X",
    ts: start * 1000,
    dur: ms * 1000,
    pid: 1,
    tid: 1,
    args: { case: currentCase, kind: result.kind, code: result.code, budget },
  });
  return result;
}
const capability = {
  queryNeutralCurves: async (r) => measured("queryPair", r),
  queryNeutralCurveJoin: async (r) => measured("queryJoin", r),
  queryNeutralCurveSelfIntersections: async (r) => measured("querySelf", r),
};
const c = (id, poles) => ({
  kind: "cubicBezier",
  curveId: id,
  provenance: { sourceEntityId: id, sourceSpanId: id },
  poles,
  sourceDomain: [0, 1],
});
const cases = [
  [
    "integer-pair",
    () =>
      measured("queryPair", {
        modelingTolerance: 1e-6,
        first: c("a", [
          [0, 0],
          [1, 2],
          [2, -1],
          [3, 0],
        ]),
        second: c("b", [
          [0, 1],
          [1, -1],
          [2, 2],
          [3, -1],
        ]),
      }),
  ],
  [
    "decimal-pair",
    () =>
      measured("queryPair", {
        modelingTolerance: 1e-6,
        first: c("a", [
          [0.12, 0.31],
          [1.21, 2.13],
          [2.31, -1.17],
          [3.19, 0.27],
        ]),
        second: c("b", [
          [0.23, 1.17],
          [1.41, -1.31],
          [2.19, 2.23],
          [3.27, -1.13],
        ]),
      }),
  ],
];
for (const mode of ["arch", "crossing", "loop"]) {
  cases.push([
    mode,
    async () => {
      const s = makeSketchFixture();
      if (mode === "loop") {
        s.point("a", 0, 0);
        s.point("b", 1, 0);
        s.spline("loop", ["a", "b"], "open", [
          [6, 6],
          [6, -6],
        ]);
      } else {
        const coords =
          mode === "arch"
            ? [
                [0.12, 0.31],
                [1.21, 2.13],
                [2.31, 2.17],
                [3.19, 0.27],
              ]
            : [
                [0.12, 0.31],
                [2.21, 2.13],
                [0.31, 2.17],
                [2.19, 0.27],
              ];
        coords.forEach(([x, y], i) => s.point("p" + i, x, y));
        s.spline(
          "s",
          coords.map((_, i) => "p" + i),
          "open",
        );
        s.line("close", "p3", "p0");
      }
      const d = createSketchArrangementDeriver(capability),
        input = s.build();
      const result = await d.derive(input);
      const cold = performance.now();
      const cached = await d.derive(input);
      const cachedMs = performance.now() - cold;
      if (JSON.stringify(result) !== JSON.stringify(cached))
        throw new Error("cache parity");
      return { result, cachedMs };
    },
  ]);
}
for (let run = 0; run < repeats; run++)
  for (const [name, fn] of cases) {
    currentCase = `${name}:${run}`;
    queryRows = [];
    const start = performance.now();
    const value = await fn(),
      ms = performance.now() - start;
    const result = value.result ?? value;
    const row = {
      name,
      run,
      ms,
      cachedMs: value.cachedMs,
      queries: queryRows,
      result,
    };
    rows.push(row);
    fs.writeFileSync(
      path.join(dir, "measurements.json"),
      JSON.stringify(rows, null, 2),
    );
    events.push({
      name,
      cat: "case",
      ph: "X",
      ts: start * 1000,
      dur: ms * 1000,
      pid: 1,
      tid: 2,
      args: { run },
    });
    console.log(
      JSON.stringify({
        name,
        run,
        ms,
        cachedMs: value.cachedMs,
        kind: result.kind,
        regions: result.regions?.length,
        code: result.code,
      }),
    );
  }
fs.writeFileSync(
  path.join(dir, "trace.json"),
  JSON.stringify({ traceEvents: events }),
);
