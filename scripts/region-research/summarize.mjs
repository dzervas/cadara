import fs from "node:fs";
const root = "scripts/region-research/results/";
const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
for (const label of process.argv.slice(2)) {
  const file = root + label + "/measurements.json";
  if (!fs.existsSync(file)) continue;
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log("\n" + label);
  for (const name of new Set(rows.map((x) => x.name))) {
    const rs = rows.filter((x) => x.name === name);
    const times = rs.map((x) => x.ms - (x.cachedMs ?? 0));
    const groups = {};
    for (const r of rs)
      for (const q of r.queries) {
        const g = (groups[q.operation] ??= { ms: 0, count: 0 });
        g.ms += q.ms;
        g.count++;
      }
    console.log(
      JSON.stringify({
        name,
        n: rs.length,
        medianMs: median(times),
        minMs: Math.min(...times),
        maxMs: Math.max(...times),
        cachedMedianMs:
          rs[0].cachedMs === undefined
            ? undefined
            : median(rs.map((x) => x.cachedMs)),
        groups,
        result: rs[0].result.kind ?? {
          regions: rs[0].result.regions.length,
          diagnostics: rs[0].result.diagnostics.length,
        },
      }),
    );
  }
  const profile = root + label + ".cpuprofile";
  if (!fs.existsSync(profile)) continue;
  const p = JSON.parse(fs.readFileSync(profile, "utf8")),
    nodes = new Map(p.nodes.map((n) => [n.id, n])),
    parent = new Map();
  for (const n of p.nodes)
    for (const child of n.children ?? []) parent.set(child, n.id);
  const self = new Map(),
    inclusive = new Map();
  function accumulate(map, id, us) {
    const f = nodes.get(id).callFrame,
      key = f.functionName + " @ " + f.url.split("/").pop();
    map.set(key, (map.get(key) ?? 0) + us);
  }
  for (let i = 0; i < p.samples.length; i++) {
    const id = p.samples[i],
      us = p.timeDeltas[i];
    accumulate(self, id, us);
    let cur = id;
    while (cur !== undefined) {
      accumulate(inclusive, cur, us);
      cur = parent.get(cur);
    }
  }
  for (const [type, table] of [
    ["self", self],
    ["inclusive", inclusive],
  ])
    console.log(
      type,
      JSON.stringify(
        [...table.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([name, us]) => ({ name, ms: us / 1000 })),
      ),
    );
}
if (process.argv.length === 4) {
  const [a, b] = process.argv
    .slice(2)
    .map((l) =>
      JSON.parse(fs.readFileSync(root + l + "/measurements.json", "utf8")),
    );
  for (const r of a) {
    const s = b.find((s) => s.name === r.name && s.run === r.run);
    if (JSON.stringify(r.result) !== JSON.stringify(s?.result))
      throw new Error("Result mismatch: " + r.name + ":" + r.run);
  }
  console.log("All full query/region results match across revisions.");
}
