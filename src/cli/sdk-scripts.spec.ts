import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, cp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { cliEntry, invokeCliDocumentRecipe, copyCliRuntimeWithoutAssets } from "../../test/helpers/cli-recipe-process";

const exec = promisify(execFile);

test("built package runs an SDK script, exports types, and replays its failed-step trace through the CLI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-sdk-script-"));
  try {
    const installed = join(directory, "node_modules/cadara-cli");
    await mkdir(dirname(installed), { recursive: true });
    await cp(dirname(cliEntry()), installed, { recursive: true });
    const script = join(directory, "model.ts");
    await writeFile(script, `import { SemanticOperationError, type SemanticDocument } from "cadara-cli/sdk";
export default async function (doc: SemanticDocument) {
  await doc.ops.document.rename({ label: "Shipped SDK" });
  await doc.ops.variable.add({ name: "depth", valueText: "3" });
  await doc.ops.sketch.begin({ plane: "xy" });
  await doc.ops.sketch.author({ primitive: { kind: "rectangle", start: [0, 0], end: [8, 5] }, construction: false });
  const published = await doc.ops.sketch.publish({ requireProfiles: true });
  const owner = { kind: "sketch", sketchId: published.discovery!.sketch!.sketchId! } as const;
  await doc.ops.document.inspect({ owner });
  const profile = doc.references({ owner, kind: "region" })[0].target;
  await doc.ops.extrude.create({ profile, depth: "depth" });
  const probe = await doc.probe([{ operation: "variable.update", fields: { variableId: { label: "depth" }, name: "depth", valueText: "7" } }]);
  if (probe.facts.bounds[0]!.max[2] !== 7) throw new Error("Probe did not rebuild");
  await doc.ops.document.save({ path: "model.cadara" });
  await doc.ops.export.step({ target: doc.references({ kind: "body" })[0]!.target, path: "model.step", options: { schema: "AP242", unit: "millimeter" } });
  const facts = doc.inspect(["bounds", "features"]);
  try { await doc.ops.sketch.open({ sketchId: "sketch_missing" }); }
  catch (error) { if (!(error instanceof SemanticOperationError)) throw error; }
  return { facts, probe: probe.facts.bounds };
}`);
    const run = await exec("bun", [join(installed, "main.js"), "script", script, "--trace", "trace.json"], { cwd: directory, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const output = JSON.parse(run.stdout);
    expect(output.value.facts.bounds).toEqual([{ min: [0, 0, 0], max: [8, 5, 3] }]);
    expect(output.value.probe).toEqual([{ min: [0, 0, 0], max: [8, 5, 7] }]);
    expect(output.cleanup.kind).toBe("closed");
    expect(output.results.some((r: { completion: { file: { kind: string } } }) => r.completion.file.kind === "written")).toBe(true);
    const trace = JSON.parse(await readFile(join(directory, "trace.json"), "utf8"));
    expect(trace.operations.at(-1).operation).toBe("sketch.open");
    const replay = await invokeCliDocumentRecipe(["trace.json"], { cwd: directory, entry: join(installed, "main.js"), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    expect(replay.code).toBe(1);
    const results = JSON.parse(replay.stdout).results;
    expect(results.at(-1).outcome.kind).toBe("rejected");
    expect(results.at(-2).discovery.model.bodies[0].bounds).toEqual(output.value.facts.bounds[0]);
    const direct = await exec("bun", ["-e", `import { openCadara } from "cadara-cli/sdk";
const doc = await openCadara({path:"model.cadara"});
try { console.log(JSON.stringify(doc.inspect(["bounds"]))); }
finally { const cleanup = await doc.close(); if (cleanup.kind !== "closed") throw new Error(JSON.stringify(cleanup)); }`], { cwd: directory, timeout: 60_000 });
    expect(JSON.parse(direct.stdout).bounds).toEqual(output.value.facts.bounds);
    const example = await exec("bun", [join(installed, "main.js"), "script", join(installed, "examples/sdk-plate.js"), "--trace", "example-trace.json"], { cwd: directory, timeout: 60_000 });
    expect(JSON.parse(example.stdout).value.facts.bounds).toEqual([{ min: [0, 0, 0], max: [40, 20, 4] }]);
    const metadata = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
    expect(metadata.exports["./sdk"].types).toBe("./types/sdk.d.ts");
    const types = await readFile(join(installed, "types/sdk.d.ts"), "utf8");
    expect(types).toContain("openCadara");
    // Independent consumer typecheck: no checkout aliases; only the declared Typia type dependency.
    expect(metadata.dependencies.typia).toBeDefined();
    await symlink(dirname(createRequire(import.meta.url).resolve("typia/package.json")), join(directory, "node_modules/typia"));
    await writeFile(join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strictNullChecks: true, noEmit: true }, files: ["model.ts"] }));
    await exec(process.execPath, [join(process.cwd(), "node_modules/typescript/lib/tsc.js"), "-p", join(directory, "tsconfig.json")], { cwd: directory, timeout: 60_000 });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);

test("script failures preserve semantic evidence, failed-step traces and cleanup; initialization stays structured", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-sdk-errors-"));
  try {
    const script = join(directory, "failure.ts");
    const run = (entry: string) => exec("bun", [entry, "script", script, "--trace", "trace.json"], { cwd: directory, timeout: 60_000 }).then(
      () => { throw new Error("Script failure unexpectedly succeeded"); },
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
    await writeFile(script, 'export default async (doc) => { await doc.ops.sketch.open({sketchId:"sketch_missing"}); };');
    const semantic = await run(cliEntry());
    expect(semantic.code).toBe(1);
    const envelope = JSON.parse(semantic.stdout);
    expect(envelope.error).toMatchObject({ name: "SemanticOperationError", result: { outcome: { kind: "rejected" } } });
    expect(envelope.cleanup).toMatchObject({ kind: "closed", resourcesReleased: true });
    const trace = JSON.parse(await readFile(join(directory, "trace.json"), "utf8"));
    expect(trace.operations.at(-1)).toMatchObject({ operation: "sketch.open", commandId: envelope.error.result.correlation.commandId });

    await writeFile(script, 'export default async (doc) => { await doc.ops.document.rename({label:"Before crash"}); throw new TypeError("broken script"); };');
    const programming = await run(cliEntry());
    expect(programming.code).toBe(1);
    expect(programming.stderr).toContain("TypeError: broken script");
    expect(JSON.parse(programming.stdout)).toMatchObject({ error: { name: "TypeError" }, cleanup: { kind: "closed" } });

    await writeFile(script, 'export default async () => { throw undefined; };');
    const falsy = await run(cliEntry());
    expect(falsy.code).toBe(1);
    expect(JSON.parse(falsy.stdout)).toMatchObject({ error: { message: "undefined" }, cleanup: { kind: "closed" } });

    await copyCliRuntimeWithoutAssets(directory);
    const initialization = await run(join(directory, "main.js"));
    expect(initialization.code).toBe(1);
    expect(JSON.parse(initialization.stdout)).toMatchObject({ results: [], initialization: { kind: "failed" }, error: { name: "SemanticInitializationError" }, cleanup: { kind: "closed" } });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);

test("built CLI replays SDK traces containing native extent targets and exact body-list selectors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-sdk-extents-"));
  try {
    const script = join(directory, "scoped.ts");
    await writeFile(script, `export default async (doc) => {
  const rectangle = async (plane, end, start = [0, 0]) => {
    await doc.ops.sketch.begin({plane});
    await doc.ops.sketch.author({primitive:{kind:"rectangle",start,end},construction:false});
    const sketch = await doc.ops.sketch.publish({requireProfiles:true});
    return doc.references({kind:"region",owner:{kind:"sketch",sketchId:sketch.discovery.sketch.sketchId}})[0].target;
  };
  await doc.ops.variable.add({name:"height",valueText:"10"});
  await doc.ops.extrude.create({profile:await rectangle("xy",[20,10]),depth:"height"});
  const base = doc.references({kind:"body"})[0].target;
  await doc.ops.extrude.create({parameters:{resultBodyType:"solid",profiles:[await rectangle("xy",[6,5],[2,2])],startExtent:{kind:"profilePlane"},extent:{mode:"oneSide",end:{kind:"upToPart",direction:"positive",target:base}},operation:{source:"literal",value:"newBody"},booleanScope:{kind:"standalone"}}});
  const bodies = doc.references({kind:"body"}).map((r)=>r.target);
  await doc.ops.extrude.create({parameters:{resultBodyType:"solid",profiles:[await rectangle("yz",[3,30])],startExtent:{kind:"profilePlane"},extent:{mode:"oneSide",end:{kind:"throughAll",direction:"positive"}},operation:{source:"literal",value:"cut"},booleanScope:{kind:"targetBodies",bodyIds:bodies}}});
  const probe = await doc.probe([{operation:"variable.update",fields:{variableId:{label:"height"},name:"height",valueText:"12"}}]);
  if (probe.results[0].outcome.kind !== "completed" || probe.facts.bounds.some((b)=>b.max[2] !== 12)) throw new Error("Native extent probe failed");
  return doc.inspect(["bounds"]);
};`);
    const run = await exec("bun", [cliEntry(), "script", script, "--trace", "scoped.json"], { cwd: directory, timeout: 60_000 });
    const facts = JSON.parse(run.stdout).value;
    expect(facts.bounds).toEqual([{ min: [0, 3, 0], max: [20, 10, 10] }, { min: [2, 3, 0], max: [6, 5, 10] }]);
    const trace = JSON.parse(await readFile(join(directory, "scoped.json"), "utf8"));
    expect(trace.operations.at(-1).parameters.booleanScope.bodyIds).toHaveLength(2);
    expect(trace.operations.at(-1).parameters.booleanScope.bodyIds[0]).toHaveProperty("alias");
    const replay = await invokeCliDocumentRecipe(["scoped.json"], { cwd: directory, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    expect(replay.code, replay.stderr).toBe(0);
    expect(JSON.parse(replay.stdout).results.at(-1).discovery.model.bodies.map((b: { bounds: unknown }) => b.bounds)).toEqual(facts.bounds);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);
