import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, cp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { cliEntry, invokeCliDocumentRecipe, copyCliRuntimeWithoutAssets } from "../../test/helpers/cli-recipe-process";

const exec = promisify(execFile);

test("built package runs an SDK script, exports types, and replays its catch-and-continue trace through the CLI", async () => {
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
  await doc.ops.document.rename({ label: "Recovered SDK" });
  return { facts, probe: probe.facts.bounds, label: doc.current!.discovery!.document!.label };
}`);
    const run = await exec("bun", [join(installed, "main.js"), "script", script, "--trace", "trace.json"], { cwd: directory, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const output = JSON.parse(run.stdout);
    expect(output.value.facts.bounds).toEqual([{ min: [0, 0, 0], max: [8, 5, 3] }]);
    expect(output.value.probe).toEqual([{ min: [0, 0, 0], max: [8, 5, 7] }]);
    expect(output.cleanup.kind).toBe("closed");
    expect(output.results.some((r: { completion: { file: { kind: string } } }) => r.completion.file.kind === "written")).toBe(true);
    const trace = JSON.parse(await readFile(join(directory, "trace.json"), "utf8"));
    expect(trace.operations.some((operation: { operation: string }) => operation.operation === "sketch.open")).toBe(false);
    expect(trace.operations.at(-1).operation).toBe("document.rename");
    expect(output.results.at(-2).outcome.kind).toBe("rejected");
    const replay = await invokeCliDocumentRecipe(["trace.json"], { cwd: directory, entry: join(installed, "main.js"), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    expect(replay.code, replay.stderr).toBe(0);
    const results = JSON.parse(replay.stdout).results;
    expect(results.at(-1).outcome.kind).toBe("completed");
    expect(results.at(-1).discovery.model.bodies[0].bounds).toEqual(output.value.facts.bounds[0]);
    expect(results.at(-1).discovery.document.label).toBe(output.value.label);
    expect(output.value.label).toBe("Recovered SDK");
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

test("built CLI replays exported duplicate-label and reopened tangent creation references", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-sdk-creation-refs-"));
  try {
    const script = join(directory, "references.ts");
    await writeFile(script, `export default async (doc) => {
      await doc.ops.sketch.begin({plane:"xy"});
      const targets = [];
      for (const position of [[0,0],[8,9]]) {
        await doc.ops.sketch.author({primitive:{kind:"point",position},construction:false});
        targets.push(doc.references({kind:"sketchPoint"}).at(-1).target);
      }
      for (const target of targets) await doc.ops.sketch.label.set({target,label:"duplicate"});
      await doc.ops.sketch.construction.set({target:targets[0],construction:true});
      await doc.ops.sketch.geometry.update({edit:{kind:"point",target:targets[1],position:[11,12]}});
      await doc.ops.sketch.author({primitive:{kind:"spline",fitPoints:[[20,0],[23,2],[26,0]]},construction:false});
      const editTangent = async (slot,vector) => {
        const sketch = doc.current.discovery.sketch;
        const entity = sketch.entities.find(e=>e.kind === "spline");
        const tangent = entity.tangents[slot];
        await doc.ops.sketch.geometry.update({edit:{kind:"tangent",target:{kind:"sketchTangentHandle",sketchId:sketch.sketchId,entityId:entity.entityId,pointId:tangent.pointId,occurrenceId:tangent.occurrenceId},vector}});
      };
      await editTangent(0,[2,0]);
      await editTangent(2,[0,-3]);
      const published = await doc.ops.sketch.publish({requireProfiles:false});
      await doc.ops.sketch.open({sketchId:published.discovery.sketch.sketchId});
      await editTangent(1,[4,1]);
      return {points:doc.current.discovery.sketch.points,entities:doc.current.discovery.sketch.entities};
    };`);
    const run = await exec("bun", [cliEntry(), "script", script, "--trace", "references.json"], { cwd: directory, timeout: 60_000 });
    const source = JSON.parse(run.stdout).value;
    const trace = JSON.parse(await readFile(join(directory, "references.json"), "utf8"));
    expect(trace.version).toBe(2);
    expect(trace.operations.at(-1).edit.target).toMatchObject({ kind: "recipeRef", version: 1, output: { role: "splineOccurrence", index: 1 } });
    const replay = await invokeCliDocumentRecipe(["references.json"], { cwd: directory, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    expect(replay.code, replay.stderr).toBe(0);
    const actual = JSON.parse(replay.stdout).results.at(-1).discovery.sketch;
    expect(actual.points.slice(0, 2).map((p: { position: number[]; construction: boolean }) => [p.position, p.construction])).toEqual([[[0, 0], true], [[11, 12], false]]);
    expect(actual.entities.find((e: { kind: string }) => e.kind === "spline").tangents.map((t: { vector: number[] | null }) => t.vector)).toEqual([[2, 0], [4, 1], [0, -3]]);
    expect(actual.points[0].pointId).not.toBe(source.points[0].pointId);
    expect(actual.entities.find((e: { kind: string }) => e.kind === "spline").tangents[0].occurrenceId).not.toBe(source.entities.find((e: { kind: string }) => e.kind === "spline").tangents[0].occurrenceId);

    await copyCliRuntimeWithoutAssets(directory);
    const mutations = [
      (r: typeof trace) => { r.version = 99; },
      (r: typeof trace) => { r.extra = true; },
      (r: typeof trace) => { r.operations.at(-1).edit.target.kind = "unknownRef"; },
      (r: typeof trace) => { r.operations.at(-1).edit.target.version = 99; },
      (r: typeof trace) => { r.operations.at(-1).edit.target.extra = true; },
      (r: typeof trace) => { r.operations.at(-1).edit.target.createdBy = "future"; },
      (r: typeof trace) => { r.operations.at(-1).edit.target.owner.alias = "missing"; },
      (r: typeof trace) => { r.operations.at(-1).edit.target.output.index = -1; },
      (r: typeof trace) => { r.operations.at(-1).edit.target.output.index = 0.5; },
      (r: typeof trace) => { r.operations.at(-1).edit.target.output.index = 999; },
      (r: typeof trace) => { r.operations.at(-1).edit.target.output.kind = "sketchPoint"; },
    ];
    for (const mutate of mutations) {
      const malformed = structuredClone(trace);
      mutate(malformed);
      await writeFile(join(directory, "malformed.json"), JSON.stringify(malformed));
      const refused = await invokeCliDocumentRecipe(["malformed.json"], { cwd: directory, entry: join(directory, "main.js"), timeout: 20_000 });
      expect(refused.code, refused.stderr).toBe(2);
      expect(refused.stdout).toBe("");
      expect(JSON.parse(refused.stderr.split("\n")[0]!).error).toMatchObject({ code: "invalid-recipe", phase: "preflight" });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 120_000);

test("script failures preserve semantic evidence and cleanup but omit failed recipe steps; initialization stays structured", async () => {
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
    expect(trace.operations).toHaveLength(1);
    expect(trace.operations[0]).toMatchObject({ operation: "document.create" });
    expect(trace.operations.some((operation: { commandId: string }) => operation.commandId === envelope.error.result.correlation.commandId)).toBe(false);

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
