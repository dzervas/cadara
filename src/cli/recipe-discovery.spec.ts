import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import ts from "typescript";
import { cliEntry, invokeCliDocumentRecipe, invokeCliRecipe } from "../../test/helpers/cli-recipe-process";

const root = resolve(import.meta.dirname, "../..");
const options = { cwd: root, timeout: 90000, maxBuffer: 64 * 1024 * 1024 };

type Schema = { [key: string]: unknown };
interface CatalogOperation {
  operation: string;
  capability: { featureKind: string | null; execution: string; preview: string };
  units: readonly { path: string; unit: string }[];
  schema: Schema;
  components?: Record<string, Schema>;
}
interface Catalog {
  version: 1;
  lengthUnit: string;
  unitPolicy: string;
  capabilityModel: Record<string, string>;
  recipe: Schema;
  components: Record<string, Schema>;
  operations: readonly CatalogOperation[];
}

/** Exit-2 refusals keep stdout empty; the first stderr line is the JSON error, then the human summary. */
function refusal(run: { code: number; stdout: string; stderr: string }) {
  expect(run.code).toBe(2);
  expect(run.stdout).toBe("");
  const [json, ...summary] = run.stderr.trimEnd().split("\n");
  return { ...(JSON.parse(json!) as { version: 1; error: Record<string, unknown> }), summary: summary.join("\n") };
}

/** Independent source of truth: the closed literal union in the contract source. */
function closedSemanticOperations() {
  const source = ts.createSourceFile("schema.ts", readFileSync(resolve(root, "src/contracts/semantic/schema.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const operations = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isPropertySignature(node) && node.name.getText(source) === "operation" && node.type) {
      const collect = (type: ts.TypeNode) => {
        if (ts.isUnionTypeNode(type)) type.types.forEach(collect);
        else if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) operations.add(type.literal.text);
      };
      collect(node.type);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return operations;
}

function propertiesNamed(node: unknown, pattern: RegExp, found: { key: string; schema: Schema }[] = []) {
  if (Array.isArray(node)) node.forEach((child) => propertiesNamed(child, pattern, found));
  else if (node && typeof node === "object") {
    const properties = (node as Schema).properties;
    if (properties && typeof properties === "object")
      for (const [key, schema] of Object.entries(properties as Record<string, Schema>))
        if (pattern.test(key)) found.push({ key, schema });
    Object.values(node).forEach((child) => propertiesNamed(child, pattern, found));
  }
  return found;
}

describe("recipe operation discovery", () => {
  it("publishes every closed operation with its exact contract shape, capability tier and per-field angle units", async () => {
    const run = await invokeCliDocumentRecipe(["--schema"], options);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stderr).toBe("");
    const catalog = JSON.parse(run.stdout) as Catalog;
    expect(catalog.version).toBe(1);
    expect(catalog.lengthUnit, "Lengths use the production document linear unit.").toBe("millimeter");
    expect(Object.keys(catalog.capabilityModel).sort()).toEqual(["execution", "preview", "shape", "targetDependentRefusal"]);
    const names = catalog.operations.map((entry) => entry.operation);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...closedSemanticOperations()].sort());
    const byName = new Map(catalog.operations.map((entry) => [entry.operation, entry]));

    // Execution and preview come from the production kernel capability matrix.
    expect(byName.get("mirror.create")!.capability).toEqual({ featureKind: "mirror", execution: "supported", preview: "unsupported" });
    expect(byName.get("featureReplay.update")!.capability).toEqual({ featureKind: "featureReplay", execution: "supported", preview: "unsupported" });
    expect(byName.get("extrude.create")!.capability).toEqual({ featureKind: "extrude", execution: "supported", preview: "supported" });
    expect(byName.get("sketch.author")!.capability).toEqual({ featureKind: null, execution: "supported", preview: "not-applicable" });

    const units = (operation: string) => Object.fromEntries(byName.get(operation)!.units.map(({ path, unit }) => [path, unit]));
    expect(units("revolve.create")).toMatchObject({ "parameters.startAngle": "radian", "parameters.extent.end.angle": "radian", "parameters.extent.firstEnd.offset.angle": "radian" });
    expect(units("extrude.update")).toMatchObject({ "parameters.extent.end.draftAngle": "radian" });
    expect(units("sweep.create")).toMatchObject({ "parameters.options.twist.angle": "radian" });
    expect(units("chamfer.create")).toMatchObject({ "parameters.options.angle": "degree" });
    expect(units("circularPattern.create")).toMatchObject({ "parameters.options.angleDegrees": "degree" });
    expect(units("transform.update")).toMatchObject({ "parameters.options.angle": "degree" });
    expect(units("hole.create")).toMatchObject({ "parameters.options.countersinkAngleDegrees": "degree" });
    expect(units("sketch.image.update")).toMatchObject({ "edit.placement.rotationRadians": "radian" });
    expect(units("export.stl")).toMatchObject({ "options.meshAccuracy.angleToleranceRadians": "radian" });
    expect(units("document.create")).toEqual({});

    const unitless = propertiesNamed([catalog.components, catalog.operations.map((entry) => entry.schema)], /angle|rotation/i)
      .filter(({ schema }) => !("x-unit" in schema) && !("const" in schema) && !("$ref" in schema && /Direction|Kind|Form/.test(String(schema.$ref))))
      .map(({ key }) => key);
    expect(unitless, "Every angle-valued contract field states its unit.").toEqual([]);
    // A `value` whose unit depends on the dimension or derivation kind states its units in its description.
    const mixedUnitValues = {
      "sketch.requirement.add": ["degrees", "document length units"],
      "sketch.dimension.update": ["degrees", "document length units", "radians"],
      "sketch.derivation.create": ["document length units", "radians"],
    };
    for (const [operation, valueUnits] of Object.entries(mixedUnitValues)) {
      expect(catalog.unitPolicy).toContain(operation);
      const { description } = (byName.get(operation)!.schema.properties as Record<string, Schema>).value!;
      expect(typeof description, `${operation} value describes its units`).toBe("string");
      for (const unit of valueUnits) expect(description, `${operation} value names ${unit}`).toContain(unit);
    }

    // Closed objects: the generated shape refuses unknown fields like the validator.
    const author = byName.get("sketch.author")!.schema as Schema;
    expect(author).toMatchObject({ type: "object", additionalProperties: false });
    expect((author.properties as Record<string, Schema>).intent).toEqual({ oneOf: [{ const: "fulfill" }, { const: "author-invalid" }] });
  }, 120000);

  it("narrows discovery to one operation with every referenced component", async () => {
    const run = await invokeCliDocumentRecipe(["--schema", "revolve.create"], options);
    expect(run.code, run.stderr).toBe(0);
    const entry = JSON.parse(run.stdout) as CatalogOperation;
    expect(entry.operation).toBe("revolve.create");
    const references = new Set<string>();
    const collect = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(collect);
      else if (node && typeof node === "object")
        for (const [key, value] of Object.entries(node))
          if (key === "$ref") references.add(String(value).replace("#/components/schemas/", ""));
          else collect(value);
    };
    collect(entry);
    expect([...references].filter((name) => !(name in entry.components!))).toEqual([]);
    expect(entry.components!.SemanticRevolveSolidParameters).toBeDefined();
    expect(entry.components!.ExtrudeSurfaceFeatureParameters, "Unrelated components are not included.").toBeUndefined();
  }, 120000);

  it("refuses an unknown operation name with close suggestions and the usage exit code", async () => {
    const refused = refusal(await invokeCliDocumentRecipe(["--schema", "revolv.create"], options));
    expect(refused.summary).toContain("Unknown operation \"revolv.create\"");
    expect(refused).toMatchObject({
      version: 1,
      error: { code: "unknown-operation", phase: "preflight", path: null, suggestions: expect.arrayContaining(["revolve.create"]) },
    });
  }, 120000);
});

const basis = (alias: string) => ({ alias });
const region = { kind: "region", sketchId: "sketch_a", regionId: "region_a" };
function plate(overrides: Record<number, Record<string, unknown>> = {}) {
  return [
    { version: 1, commandId: "new", operation: "document.create", label: "Plate", basis: null, as: "part" },
    { version: 1, commandId: "begin", operation: "sketch.begin", plane: "xy", basis: basis("part"), as: "draft" },
    { version: 1, commandId: "draw", operation: "sketch.author", basis: basis("draft"), draft: basis("draft"), primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] }, construction: false, intent: "fulfill", as: "rectangle" },
    { version: 1, commandId: "publish", operation: "sketch.publish", basis: basis("rectangle"), draft: basis("rectangle"), requireProfiles: true, as: "published" },
    { version: 1, commandId: "solid", operation: "extrude.create", basis: basis("published"), profile: { alias: "published", label: "Outer region" }, depth: 7, intent: "fulfill", as: "solid" },
  ].map((operation, index) => ({ ...operation, ...overrides[index] }));
}

describe("recipe preflight diagnostics", () => {
  it("locates invalid fields by command and path with the expected contract shape, without starting the kernel", async () => {
    // Only the JS entry: no native assets, so any kernel start would fail initialization.
    const directory = await mkdtemp(resolve(tmpdir(), "cadara-preflight-"));
    try {
      const entry = resolve(directory, "main.js");
      await copyFile(cliEntry(), entry);
      const run = (operations: readonly Record<string, unknown>[]) =>
        invokeCliRecipe(directory, operations, { ...options, cwd: directory, entry });

      const plane = refusal(await run(plate({ 1: { plane: "xw" } })));
      expect(plane).not.toHaveProperty("initialization");
      expect(plane.error).toMatchObject({
        code: "invalid-recipe",
        phase: "preflight",
        commandIndex: 1,
        commandId: "begin",
        operation: "sketch.begin",
        path: "plane",
        help: "cadara document recipe --schema sketch.begin",
        issues: [{ path: "plane", value: "xw", schema: { oneOf: expect.arrayContaining([{ const: "xy" }, { const: "yz" }, { const: "xz" }]) } }],
      });
      expect(plane.summary).toContain("Invalid semantic operation");
      expect(plane.summary).toContain('operations[1] "begin" sketch.begin at plane');
      expect(plane.summary).toContain("cadara document recipe --schema sketch.begin");

      const extra = refusal(await run(plate({ 2: { colour: "red" } })));
      expect(extra.error).toMatchObject({ commandIndex: 2, commandId: "draw", path: "colour", issues: [{ path: "colour", allowed: expect.arrayContaining(["primitive", "construction", "intent", "draft"]) }] });

      const primitive = refusal(await run(plate({ 2: { primitive: { kind: "rectangle", start: [0, 0], end: [20] } } })));
      expect(primitive.error).toMatchObject({ path: "primitive.end", issues: [{ path: "primitive.end", expected: "[number, number]" }] });

      const operation = refusal(await run(plate({ 4: { operation: "extrude.creat" } })));
      expect(operation.error).toMatchObject({ code: "unknown-operation", commandIndex: 4, commandId: "solid", path: "operation", suggestions: expect.arrayContaining(["extrude.create"]) });

      const alias = refusal(await run(plate({ 3: { basis: basis("rectangel") } })));
      expect(alias.error).toMatchObject({ code: "invalid-recipe", commandIndex: 3, path: "basis", selector: { alias: "rectangel" }, knownAliases: ["part", "draft", "rectangle"] });
      expect(alias.summary).toContain("Unknown or ambiguous document alias.");

      const target = refusal(await run(plate({ 4: { profile: { alias: "publish", label: "Outer region" } } })));
      expect(target.error).toMatchObject({ code: "invalid-recipe", commandIndex: 4, path: "profile", selector: { alias: "publish", label: "Outer region" }, knownAliases: expect.arrayContaining(["published"]) });
      expect(target.error.expected, "Target selectors report the typed reference the field accepts.").toMatchObject({ properties: { kind: { const: "region" } } });

      // A wrongly named unit field reports the field the contract expects, with its unit.
      const revolve = refusal(await run([...plate().slice(0, 4), {
        version: 1, commandId: "turn", operation: "revolve.create", basis: basis("published"), intent: "fulfill",
        parameters: { resultBodyType: "solid", profiles: [region], axis: { kind: "construction", constructionId: "construction_plane-yz" }, startAngle: { source: "literal", value: 0 }, extent: { mode: "oneSide", end: { kind: "blind", direction: "clockwise", angleDegrees: 90 } }, operation: { source: "literal", value: "newBody" }, booleanScope: { kind: "standalone" } },
      }]));
      const issues = revolve.error.issues as { path: string; schema?: Record<string, unknown>; allowed?: string[] }[];
      expect(issues.find((issue) => issue.path === "parameters.extent.end.angle")?.schema).toMatchObject({ "x-unit": "radian" });

      const empty = refusal(await run([]));
      expect(empty.error).toMatchObject({ code: "invalid-recipe", commandIndex: null, path: "" });

      // The same JS-only package does need the kernel for a valid recipe.
      const valid = await run(plate());
      expect(valid.code).toBe(1);
      expect(valid.stderr).toContain("Document initialization failed.");
      expect(JSON.parse(valid.stdout)).toMatchObject({ results: [], initialization: { kind: "failed" }, error: { code: "initialization", phase: "initialization", commandIndex: null } });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 180000);
});

describe("recipe selection diagnostics and correction", () => {
  it("lists ambiguous typed candidates with owners without executing the command, then accepts the corrected recipe", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "cadara-correction-"));
    try {
      const run = (operations: readonly Record<string, unknown>[]) =>
        invokeCliRecipe(directory, operations.map((operation) => ({ version: 1, ...operation })), { ...options, cwd: directory });
      const execute = async (operations: readonly Record<string, unknown>[]) => {
        const output = await run(operations);
        return { ...output, envelope: JSON.parse(output.stdout) };
      };
      const sketch = (suffix: string, from: string, start: number[], end: number[]) => [
        { commandId: `begin-${suffix}`, operation: "sketch.begin", plane: "xy", basis: basis(from), as: `draft-${suffix}` },
        { commandId: `rect-${suffix}`, operation: "sketch.author", basis: basis(`draft-${suffix}`), draft: basis(`draft-${suffix}`), primitive: { kind: "rectangle", start, end }, construction: false, intent: "fulfill", as: `rect-${suffix}` },
        { commandId: `publish-${suffix}`, operation: "sketch.publish", basis: basis(`rect-${suffix}`), draft: basis(`rect-${suffix}`), requireProfiles: true, as: `published-${suffix}` },
      ];
      const twoSketches = [
        { commandId: "new", operation: "document.create", label: "Two sketches", basis: null, as: "part" },
        ...sketch("a", "part", [0, 0], [20, 10]),
        ...sketch("b", "published-a", [40, 0], [60, 10]),
      ];
      const boxBounds = (envelope: { results: { discovery: { model: { bodies: { bounds: unknown }[] } } }[] }) =>
        envelope.results.at(-1)!.discovery.model.bodies.map((b) => b.bounds);
      const sketchB = { min: [expect.closeTo(40, 5), expect.closeTo(0, 5), expect.closeTo(0, 5)], max: [expect.closeTo(60, 5), expect.closeTo(10, 5), expect.closeTo(7, 5)] };

      // In one recipe: the ambiguity names each candidate's owning sketch, which maps to
      // the publish alias that identifies it; an owner-qualified selector then succeeds.
      const fresh = (profile: unknown) => [...twoSketches, { commandId: "solid", operation: "extrude.create", basis: basis("published-b"), profile, depth: 7, intent: "fulfill" }];
      const unscoped = await execute(fresh({ alias: "published-b", label: "Outer region" }));
      expect(unscoped.code).toBe(1);
      expect(unscoped.envelope.error).toMatchObject({ code: "selection-ambiguous", commandId: "solid", path: "profile" });
      expect(unscoped.envelope.unexecuted).toEqual(["solid"]);
      const ownerAlias = (sketchId: string) => twoSketches.find((operation) => operation.commandId.startsWith("publish-") &&
        unscoped.envelope.results.find((r: { correlation: { commandId: string } }) => r.correlation.commandId === operation.commandId).discovery.sketch.sketchId === sketchId)?.as;
      const owners = unscoped.envelope.error.candidates.map((c: { owner: { sketchId: string } }) => ownerAlias(c.owner.sketchId));
      expect(owners.sort()).toEqual(["published-a", "published-b"]);
      const scopedMissing = await execute(fresh({ alias: "published-b", label: "Inner region", sketch: "published-b" }));
      expect(scopedMissing.code).toBe(1);
      expect(scopedMissing.envelope.error, "Owner-scoped errors report the recipe's own selector and only the owner's values.").toMatchObject({
        code: "selection-unresolved", path: "profile", selector: { alias: "published-b", label: "Inner region", sketch: "published-b" }, candidates: [], availableCount: 1,
      });
      const scoped = await execute(fresh({ alias: "published-b", label: "Outer region", sketch: "published-b" }));
      expect(scoped.code, scoped.stderr).toBe(0);
      expect(boxBounds(scoped.envelope)).toEqual([sketchB]);

      const built = await execute([
        ...twoSketches,
        { commandId: "save", operation: "document.save", path: "two-sketches.cadara", basis: basis("published-b") },
      ]);
      expect(built.code, built.stderr).toBe(0);
      const sketchIds = ["publish-a", "publish-b"].map((id) => built.envelope.results.find((r: { correlation: { commandId: string } }) => r.correlation.commandId === id).discovery.sketch.sketchId as string);

      const opened = { commandId: "open", operation: "document.open", path: "two-sketches.cadara", basis: null, as: "opened" };
      const inspect = { commandId: "inspect", operation: "document.inspect", basis: basis("solid") };
      const extrude = (profile: unknown) => ({ commandId: "solid", operation: "extrude.create", basis: basis("opened"), profile, depth: 7, intent: "fulfill", as: "solid" });

      const ambiguous = await execute([opened, extrude({ alias: "opened", label: "Outer region" }), inspect]);
      expect(ambiguous.code).toBe(1);
      expect(ambiguous.stderr).toContain("Profile target alias is missing or ambiguous.");
      expect(ambiguous.stderr).toContain('operations[1] "solid" extrude.create at profile');
      const { error } = ambiguous.envelope;
      expect(error).toMatchObject({ code: "selection-ambiguous", phase: "resolution", commandIndex: 1, commandId: "solid", operation: "extrude.create", path: "profile", selector: { alias: "opened", label: "Outer region" }, eligibleKinds: ["region"] });
      expect(error.expected, "The field's generated contract shape accompanies the candidates.").toMatchObject({ properties: { kind: { const: "region" } } });
      expect(error.candidates).toHaveLength(2);
      expect(error.candidates.map((c: { owner: { sketchId: string } }) => c.owner.sketchId).sort()).toEqual([...sketchIds].sort());
      for (const candidate of error.candidates)
        expect(candidate).toMatchObject({ label: "Outer region", target: { kind: "region", sketchId: candidate.owner.sketchId }, owner: { kind: "sketch", label: expect.any(String) } });
      // Prefix executed, affected command and suffix not executed, cleanup truthful.
      expect(ambiguous.envelope.results.map((r: { correlation: { commandId: string }; outcome: { kind: string } }) => [r.correlation.commandId, r.outcome.kind])).toEqual([["open", "completed"]]);
      expect(ambiguous.envelope.unexecuted).toEqual(["solid", "inspect"]);
      expect(ambiguous.envelope.cleanup).toMatchObject({ kind: "closed", resourcesReleased: true });

      const missing = await execute([opened, extrude({ alias: "opened", label: "Inner region" }), inspect]);
      expect(missing.code).toBe(1);
      expect(missing.envelope.error).toMatchObject({ code: "selection-unresolved", candidates: [], availableCount: 2 });
      expect(missing.envelope.error.available.map((c: { target: { sketchId: string } }) => c.target.sketchId).sort()).toEqual([...sketchIds].sort());

      // Correct by choosing the candidate owned by sketch B.
      const chosen = error.candidates.find((c: { owner: { sketchId: string } }) => c.owner.sketchId === sketchIds[1]).target;
      const corrected = await execute([opened, extrude(chosen), inspect]);
      expect(corrected.code, corrected.stderr).toBe(0);
      expect(corrected.envelope).not.toHaveProperty("error");
      expect(boxBounds(corrected.envelope)).toEqual([sketchB]);

      // Author a body copy from the shipped schema; a wrong-unit field is refused, the schema unit fixes it.
      const references = corrected.envelope.results.at(-1).discovery.references as { label: string; target: { kind: string; constructionId?: string } }[];
      const bodyLabel = references.find((r) => r.target.kind === "body")!.label;
      const axisLabel = references.find((r) => r.target.constructionId === "construction_plane-xy")!.label;
      const schema = JSON.parse((await invokeCliDocumentRecipe(["--schema", "circularPattern.create"], options)).stdout) as CatalogOperation;
      const pattern = (options: Record<string, unknown>) => ({
        commandId: "copy", operation: "circularPattern.create", basis: basis("solid"), intent: "fulfill", as: "copied",
        parameters: { participants: [{ role: "body", targets: [{ alias: "solid", label: bodyLabel }] }, { role: "axis", targets: [{ alias: "solid", label: axisLabel }] }], options: { instanceCount: 2, equalSpace: false, oppositeDirection: false, ...options } },
      });
      const halfTurnRadians = Math.PI;
      const wrongUnit = refusal(await run([opened, extrude(chosen), pattern({ angleRadians: halfTurnRadians })]));
      expect(wrongUnit.error).toMatchObject({ code: "invalid-recipe", commandIndex: 2, commandId: "copy" });
      const angleField = schema.units.find((u) => u.path.startsWith("parameters.options.angle"))!;
      expect(angleField).toEqual({ path: "parameters.options.angleDegrees", unit: "degree" });
      const fieldName = angleField.path.split(".").at(-1)!;
      expect(JSON.stringify(wrongUnit.error)).toContain(fieldName);
      const fixed = await execute([opened, extrude(chosen), pattern({ [fieldName]: angleField.unit === "degree" ? (halfTurnRadians * 180) / Math.PI : halfTurnRadians })]);
      expect(fixed.code, fixed.stderr).toBe(0);
      const bodies = fixed.envelope.results.at(-1).discovery.model.bodies as { bounds: { min: number[]; max: number[] } }[];
      expect(bodies).toHaveLength(2);
      const copy = bodies.find((b) => b.bounds.max[0]! < 0)!;
      expect(copy.bounds.min).toEqual([expect.closeTo(-60, 4), expect.closeTo(-10, 4), expect.closeTo(0, 4)]);
      expect(copy.bounds.max).toEqual([expect.closeTo(-40, 4), expect.closeTo(0, 4), expect.closeTo(7, 4)]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 300000);
});

