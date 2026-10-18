// Run from the repository root: bun landing/scripts/build-enclosure.ts
// Authoring and tessellation exclusively use the production document recipe CLI.
import { buildExample } from "./build-example";
import { spawnSync } from "node:child_process";
import type { SemanticResult } from "../../src/contracts/semantic/schema";
type Alias = { alias: string; label: string };
type Operation = Record<string, unknown> & {
  operation: string;
  commandId: string;
  as: string;
  basis: unknown;
  parameters?: {
    profiles: Array<Alias | unknown>;
    booleanScope?: { bodyId?: Alias };
  };
  bodyId?: Alias;
};
type RecipeReceipt = { results: SemanticResult[]; unexecuted: string[] };
await buildExample("enclosure", async (dir, repoRoot) => {
  const ops: Operation[] = [];
  let current = "";
  let seq = 0;
  let extrudes = 0;
  const ref = (alias: string, label: string) => ({ alias, label });
  function command(operation: string, args: Record<string, unknown> = {}) {
    const as = `step${++seq}`;
    ops.push({
      version: 1,
      commandId: as,
      operation,
      basis: current ? { alias: current } : null,
      ...args,
      as,
    } as Operation);
    current = as;
    return as;
  }
  const literal = (value: string | number) => ({ source: "literal", value });
  command("document.create", { label: "VENT / 100 — electronics enclosure" });
  function sketch(
    primitive: Record<string, unknown>,
    plane = "xy",
    beveled = false,
  ) {
    command("sketch.begin", { plane });
    command("sketch.author", {
      draft: { alias: current },
      primitive,
      construction: false,
      intent: "fulfill",
    });
    if (beveled) {
      for (const pair of [
        ["bottom", "right"],
        ["right", "top"],
        ["top", "left"],
        ["left", "bottom"],
      ]) {
        command("sketch.geometry.build", {
          draft: { alias: current },
          targets: pair.map((side) => ref(current, `Rectangle 1 ${side}`)),
          kind: "chamfer",
          distance: 1.5,
          intent: "fulfill",
        });
      }
    }
    return command("sketch.publish", {
      draft: { alias: current },
      requireProfiles: true,
    });
  }
  function extrude(
    profile: string,
    depth: number,
    offset = 0,
    operation = "newBody",
    body?: Alias,
    direction = "positive",
    symmetric = false,
  ) {
    extrudes++;
    return command("extrude.create", {
      intent: "fulfill",
      parameters: {
        resultBodyType: "solid",
        profiles: [ref(profile, "Outer region")],
        startExtent: offset
          ? {
              kind: "blindOffset",
              distance: literal(Math.abs(offset)),
              direction: offset > 0 ? "positive" : "negative",
            }
          : { kind: "profilePlane" },
        extent: {
          mode: symmetric ? "symmetric" : "oneSide",
          end: { kind: "blind", direction, distance: literal(depth) },
        },
        operation: literal(operation),
        booleanScope: body
          ? { kind: "targetBody", bodyId: body }
          : { kind: "standalone" },
      },
    });
  }
  function rename(alias: string, label: string) {
    return command("body.rename", {
      bodyId: ref(alias, `Extrude ${extrudes}`),
      label,
      intent: "fulfill",
    });
  }
  const rectangle = (x0: number, y0: number, x1: number, y1: number) => ({
    kind: "rectangle",
    start: [x0, y0],
    end: [x1, y1],
  });
  const circle = (x: number, y: number, radius: number) => ({
    kind: "circle",
    center: [x, y],
    radius,
  });
  let p = sketch(rectangle(-50, -35, 50, 35), "xy", true);
  const shellAlias = rename(extrude(p, 28.7), "Graphite enclosure shell");
  const shell = ref(shellAlias, "Graphite enclosure shell");
  p = sketch(rectangle(-47, -32, 47, 32));
  extrude(p, 30, 3, "cut", shell);
  const corners = [
    [-42, -27],
    [42, -27],
    [42, 27],
    [-42, 27],
  ];
  for (const [x, y] of corners) {
    p = sketch(circle(x, y, 4.5));
    extrude(p, 26.7, 2, "join", shell);
  }
  for (const [x, y] of corners) {
    p = sketch(circle(x, y, 1.8));
    extrude(p, 25, 7, "cut", shell);
  }
  // Eight parallel ventilation apertures on EACH long side; one swept cutter crosses both walls.
  for (let i = 0; i < 8; i++) {
    const x = -26.25 + i * 7.5;
    p = sketch(rectangle(x - 1.5, 10, x + 1.5, 22), "xz");
    extrude(p, 36, 0, "cut", shell, "positive", true);
  }
  // Front (negative X) connectors. YZ's native normal is positive X.
  p = sketch(rectangle(-19, 10, -3, 19), "yz");
  extrude(p, 4, -50.5, "cut", shell);
  p = sketch(circle(15, 14.5, 4.25), "yz");
  extrude(p, 4, -50.5, "cut", shell);
  p = sketch(rectangle(-50, -35, 50, 35), "xy");
  const lidAlias = rename(extrude(p, 3, 29), "Amber orange lid");
  const lid = ref(lidAlias, "Amber orange lid");
  for (const [x, y] of corners) {
    p = sketch(circle(x, y, 1.8));
    extrude(p, 4, 28.8, "cut", lid);
    p = sketch(circle(x, y, 3.05));
    extrude(p, 3, 29.7, "cut", lid);
  }
  const screwLabels: string[] = [];
  for (const [i, [x, y]] of corners.entries()) {
    const label = `Black socket-head screw ${i + 1}`;
    p = sketch(circle(x, y, 1.5));
    const a = rename(extrude(p, 10, 20), label);
    const screw = ref(a, label);
    p = sketch(circle(x, y, 2.8));
    extrude(p, 2, 30, "join", screw);
    p = sketch({ kind: "inscribedPolygon", center: [x, y], radius: 1.3 });
    extrude(p, 2, 30.7, "cut", screw);
    screwLabels.push(label);
  }
  command("document.inspect");
  command("document.save", { path: `${dir}/enclosure.cadara` });
  async function run(name: string, operations: Record<string, unknown>[]) {
    const path = `${dir}/${name}.recipe.json`;
    await Bun.write(
      path,
      JSON.stringify({ version: 1, operations }, null, 2) + "\n",
    );
    const r = spawnSync(
      "bun",
      ["run", "cli", "--", "document", "recipe", path],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 512 },
    );
    await Bun.write(`${dir}/${name}.log`, r.stdout + "\n" + r.stderr);
    if (r.status !== 0)
      throw new Error(`${name} failed (${r.status}); see ${name}.log`);
    const receipt = JSON.parse(
      r.stdout.slice(r.stdout.indexOf("{")),
    ) as RecipeReceipt;
    if (receipt.unexecuted.length)
      throw new Error("Unexecuted recipe commands");
    return receipt;
  }
  // Region aliases are globally ambiguous after the first published sketch. Discover
  // exact region references from newly published sketches, then use those receipts.
  const sketchOps = ops.filter(
    (o) =>
      o.operation === "document.create" || o.operation.startsWith("sketch."),
  );
  let previous = "";
  for (const op of sketchOps) {
    op.basis = previous ? { alias: previous } : null;
    previous = op.as;
  }
  sketchOps.push({
    version: 1,
    commandId: "save-sketches",
    operation: "document.save",
    basis: { alias: previous },
    path: `${dir}/enclosure-sketches.cadara`,
  });
  const authored = await run("enclosure-sketches", sketchOps);
  const regions = new Map<string, unknown>();
  const seen = new Set<string>();
  for (const result of authored.results) {
    const operation = sketchOps.find(
      (o) => o.commandId === result.correlation.commandId,
    );
    if (operation?.operation !== "sketch.publish") continue;
    const fresh = result.discovery!.references.filter(
      (r: { target: { kind: string; sketchId?: string } }) =>
        r.target.kind === "region" && !seen.has(r.target.sketchId!),
    );
    if (fresh.length !== 1)
      throw new Error("Expected one newly published region");
    regions.set(operation.as, fresh[0].target);
    seen.add(fresh[0].target.sketchId);
  }
  const modelOps: Operation[] = [
    {
      version: 1,
      commandId: "open-sketches",
      operation: "document.open",
      basis: null,
      path: `${dir}/enclosure-sketches.cadara`,
      as: "sketches",
    },
    ...ops.filter(
      (o) =>
        !o.operation.startsWith("sketch.") && o.operation !== "document.create",
    ),
  ];
  previous = "sketches";
  for (const op of modelOps.slice(1)) {
    op.basis = { alias: previous };
    if (op.operation === "extrude.create")
      op.parameters!.profiles = [
        regions.get((op.parameters!.profiles[0] as Alias).alias),
      ];
    previous = op.as;
  }
  let inputPath = `${dir}/enclosure-sketches.cadara`;
  const mutations = modelOps
    .slice(1)
    .filter(
      (o) =>
        o.operation !== "document.save" && o.operation !== "document.inspect",
    );
  for (let start = 0; start < mutations.length; start += 8) {
    const stage = Math.floor(start / 8) + 1;
    const outputPath =
      start + 8 >= mutations.length
        ? `${dir}/enclosure.cadara`
        : `${dir}/enclosure-stage-${stage}.cadara`;
    const batch = mutations.slice(start, start + 8);
    const available = new Set(["opened"]);
    previous = "opened";
    for (const op of batch) {
      op.basis = { alias: previous };
      const scope = op.parameters?.booleanScope;
      if (scope?.bodyId?.alias && !available.has(scope.bodyId.alias))
        scope.bodyId.alias = "opened";
      if (op.bodyId?.alias && !available.has(op.bodyId.alias))
        op.bodyId.alias = "opened";
      available.add(op.as);
      previous = op.as;
    }
    // Real rename settles CLI repository provenance before save; a save immediately
    // after the feature batch can refuse the otherwise accepted basis.
    await run(`enclosure-stage-${stage}`, [
      {
        version: 1,
        commandId: "open",
        operation: "document.open",
        basis: null,
        path: inputPath,
        as: "opened",
      },
      ...batch,
      {
        version: 1,
        commandId: "settle",
        operation: "document.rename",
        basis: { alias: previous },
        label:
          start + 8 >= mutations.length
            ? "VENT / 100 — electronics enclosure"
            : `VENT / 100 — build ${stage}`,
        as: "settled",
      },
      {
        version: 1,
        commandId: "save",
        operation: "document.save",
        basis: { alias: "settled" },
        path: outputPath,
      },
    ]);
    inputPath = outputPath;
  }
  const parts: Array<{
    file: string;
    label: string;
    finish: "silver" | "graphite" | "orange" | "black";
    explode: [number, number, number];
  }> = [
    {
      file: "enclosure-shell.stl",
      label: "Graphite enclosure shell",
      finish: "graphite",
      explode: [0, 0, 0],
    },
    {
      file: "enclosure-lid.stl",
      label: "Amber orange lid",
      finish: "orange",
      explode: [0, 0, 25],
    },
    ...screwLabels.map((label, i) => ({
      file: `enclosure-screw-${i + 1}.stl`,
      label,
      finish: "black" as const,
      explode: [0, 0, 40] as [number, number, number],
    })),
  ];
  const reopen: Record<string, unknown>[] = [
    {
      version: 1,
      commandId: "reopen",
      operation: "document.open",
      path: `${dir}/enclosure.cadara`,
      basis: null,
      as: "reopened",
    },
    {
      version: 1,
      commandId: "inspect-final-native",
      operation: "document.inspect",
      basis: { alias: "reopened" },
      as: "final",
    },
  ];
  for (const [i, part] of parts.entries())
    reopen.push({
      version: 1,
      commandId: `export-${i}`,
      operation: "export.stl",
      basis: { alias: "final" },
      target: ref("final", part.label),
      path: `${dir}/${part.file}`,
      options: {
        meshAccuracy: { chordTolerance: 0.05, angleToleranceRadians: 0.1 },
        encoding: "binary",
      },
    });
  const exported = await run("enclosure-export-reopen", reopen);
  const discovery = exported.results.find(
    (r) => r.correlation.commandId === "inspect-final-native",
  )!.discovery!;
  const bodies = discovery.model!.bodies;
  if (
    bodies.length !== 6 ||
    bodies.some(
      (b) =>
        !discovery.references.some(
          (r) =>
            r.target.kind === "body" &&
            r.target.bodyId === b.bodyId &&
            parts.some((p) => p.label === r.label),
        ),
    )
  )
    throw new Error("Native/manifest body mismatch");
  if (
    exported.results.some(
      (r) =>
        r.outcome.kind !== "completed" ||
        r.diagnostics.some((d) => d.severity === "error"),
    )
  )
    throw new Error("Native reopen/export diagnostics");
  await Bun.write(
    `${dir}/enclosure.model.json`,
    JSON.stringify(
      { name: "VENT / 100", dimensions: "100 × 70 × 32 mm", parts },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        bodies: bodies.map((b) => ({
          label: discovery.references.find(
            (r) => r.target.kind === "body" && r.target.bodyId === b.bodyId,
          )?.label,
          bounds: b.bounds,
        })),
        exports: parts.length,
      },
      null,
      2,
    ),
  );
});
