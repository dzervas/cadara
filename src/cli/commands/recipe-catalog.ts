/**
 * Machine-consumable operation discovery for `cadara document recipe`.
 *
 * Every shape, variant and unit comes from the JSON Schemas Typia generates
 * from the closed `SemanticCommand` contract; execution/preview tiers come from
 * the production kernel capability matrix. Nothing here is a hand-maintained
 * operation inventory. Importing this module never starts the kernel.
 */
import { contractJsonSchemas } from "@/cli/commands/recipe-catalog.runtime-schema";
import {
  headlessDocumentSettings,
  headlessKernelCapabilities,
} from "@/composition/headless-capabilities";

export type JsonSchema = { [key: string]: unknown };
const REF = "#/components/schemas/";

/** The command validators are exact, so generated objects are closed too. */
function closeObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closeObjects);
  if (!node || typeof node !== "object") return node;
  const copy = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, closeObjects(value)]));
  if (copy.type === "object" && copy.properties && !("additionalProperties" in copy)) copy.additionalProperties = false;
  return copy;
}

const components = closeObjects(contractJsonSchemas.components.schemas) as Record<string, JsonSchema>;

/** Sibling keywords (description, x-unit) that annotate a `$ref`. */
function withoutRef(schema: JsonSchema) {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$ref"));
}

function refName(schema: JsonSchema) {
  return typeof schema.$ref === "string" ? schema.$ref.slice(REF.length) : null;
}

/** Concrete (non-union) schemas a value at this position may match, with the refs crossed to reach them. */
function expandTracked(schema: JsonSchema, seen: readonly string[]): { schema: JsonSchema; seen: readonly string[] }[] {
  const name = refName(schema);
  if (name) {
    if (seen.includes(name)) return [];
    return expandTracked({ ...components[name], ...withoutRef(schema) }, [...seen, name]);
  }
  const union = (schema.oneOf ?? schema.anyOf) as JsonSchema[] | undefined;
  return union ? union.flatMap((branch) => expandTracked(branch, seen)) : [{ schema, seen }];
}

function expand(schema: JsonSchema): JsonSchema[] {
  return expandTracked(schema, []).map((branch) => branch.schema);
}

function constants(schema: JsonSchema): string[] {
  return expand(schema).flatMap((branch) =>
    typeof branch.const === "string" ? [branch.const] : Array.isArray(branch.enum) ? branch.enum.map(String) : []);
}

const variantsByOperation = new Map<string, JsonSchema[]>();
for (const variant of expand(components.SemanticCommand!))
  for (const operation of constants((variant.properties as Record<string, JsonSchema>).operation!))
    variantsByOperation.set(operation, [...(variantsByOperation.get(operation) ?? []), variant]);

export const recipeOperationNames: readonly string[] = [...variantsByOperation.keys()];
export const recipeLengthUnit = headlessDocumentSettings.linearUnit;
// `schemas` follows the generated tuple [SemanticCommand, ModelingFeatureKind].
const [, featureKindSchema] = contractJsonSchemas.schemas;
const featureKinds = new Set(constants(featureKindSchema as JsonSchema));

function capability(operation: string) {
  const prefix = operation.split(".")[0]!;
  if (!featureKinds.has(prefix)) return { featureKind: null, execution: "supported", preview: "not-applicable" } as const;
  const kind = prefix as (typeof headlessKernelCapabilities.supportedFeatureKinds)[number];
  return {
    featureKind: kind,
    execution: headlessKernelCapabilities.supportedFeatureKinds.includes(kind) ? "supported" : "unsupported",
    preview: headlessKernelCapabilities.previewableFeatureKinds.includes(kind) ? "supported" : "unsupported",
  } as const;
}

/** Every field path whose contract declares an `@x-unit`. */
function units(schema: JsonSchema) {
  const found = new Map<string, { path: string; unit: string }>();
  const visit = (node: JsonSchema, path: string, seen: readonly string[]) => {
    for (const { schema: branch, seen: nextSeen } of expandTracked(node, seen)) {
      for (const [key, property] of Object.entries((branch.properties ?? {}) as Record<string, JsonSchema>)) {
        const propertyPath = path ? `${path}.${key}` : key;
        if (typeof property["x-unit"] === "string")
          found.set(`${propertyPath}:${property["x-unit"]}`, { path: propertyPath, unit: property["x-unit"] });
        visit(property, propertyPath, nextSeen);
      }
      for (const items of [branch.items, branch.additionalItems, ...((branch.prefixItems as JsonSchema[] | undefined) ?? [])])
        if (items && typeof items === "object") visit(items as JsonSchema, `${path}[]`, nextSeen);
    }
  };
  visit(schema, "", []);
  return [...found.values()];
}

function operationSchema(operation: string): JsonSchema {
  const variants = variantsByOperation.get(operation)!;
  return variants.length === 1 ? variants[0]! : { oneOf: variants };
}

function operationEntry(operation: string) {
  const schema = operationSchema(operation);
  return { operation, capability: capability(operation), units: units(schema), schema };
}

const capabilityModel = {
  shape: "`schema` is the exact closed input contract, generated from the TypeScript contract types the CLI validator uses. Objects are closed. A recipe violating it is refused before the kernel starts (exit 2, error.code invalid-recipe).",
  execution: "`capability.execution` for feature operations comes from the production kernel's supportedFeatureKinds (discovery.model.capabilities); other operations are executed by the semantic session itself.",
  preview: "`capability.preview` comes from previewableFeatureKinds: whether the kernel can evaluate the feature as a transient preview, a separate promise from durable execution. not-applicable for non-feature operations.",
  targetDependentRefusal: "A valid shape can still be refused for the current targets/options (for example an unsupported export target or an impossible extent). That command executes and returns a SemanticResult whose outcome is rejected, unavailable or failed with diagnostics (exit 1); it is not a CLI error.",
};

const aliasProperty = { type: "string", minLength: 1, description: "The `as` alias of an earlier operation." };
const recipe = {
  document: {
    type: "object",
    properties: {
      version: { const: 1 },
      operations: { type: "array", minItems: 1, items: { description: "One operation object matching `operations[].schema`, plus the optional `as`. `basis`, `draft` and typed target fields may use `selectors` instead of canonical values." } },
    },
    required: ["version", "operations"],
    additionalProperties: false,
  },
  as: { type: "string", minLength: 1, description: "Optional, unique per recipe: names this operation's completed discovery snapshot for later operations." },
  selectors: {
    basis: { type: "object", properties: { alias: aliasProperty }, required: ["alias"], additionalProperties: false, description: "Resolves to the aliased snapshot's {documentId, revisionId, repositoryHeads}." },
    draft: { type: "object", properties: { alias: aliasProperty }, required: ["alias"], additionalProperties: false, description: "Resolves to the aliased snapshot's private draft {commandSessionId, generation}." },
    target: {
      type: "object",
      properties: {
        alias: aliasProperty,
        label: { type: "string", minLength: 1, description: "Exact discovered reference label." },
        sketch: { ...aliasProperty, description: "Optional owner: the `as` alias of an earlier operation whose discovery identifies one sketch (a publish result's published sketch or a draft's sketch); only references owned by that sketch match." },
      },
      required: ["alias", "label"],
      additionalProperties: false,
      description: "Resolves to the single reference in the aliased snapshot with this label and a kind eligible for the field. No match or several matches stop the recipe before the operation with error.code selection-unresolved / selection-ambiguous and the eligible candidates.",
    },
  },
  output: "Exit 0/1: stdout carries exactly one JSON envelope {version:1, results, unexecuted?, cleanup?, initialization?, error?} and stderr a human summary. Exit 2: stdout is empty and the first stderr line is JSON {version:1, error}, followed by the human summary. See README \"Errors and exit codes\".",
  exitCodes: { "0": "every operation completed (or accepted-invalid) and cleanup closed", "1": "a semantic failure, a selection error after an executed prefix, or kernel initialization failure", "2": "invalid invocation or recipe; nothing executed and the kernel never started" },
};

/** Full catalog for `--schema`. */
export function recipeCatalog() {
  return {
    version: 1,
    kind: "cadara.document-recipe.catalog",
    schemaDialect: "OpenAPI 3.1 JSON Schema (Typia), $ref into `components`",
    lengthUnit: recipeLengthUnit,
    unitPolicy: "Lengths and coordinates use `lengthUnit`. Every angle-valued field states its unit with `x-unit` (radian or degree); see each operation's `units`. A `value` whose unit depends on the dimension or derivation kind (sketch.requirement.add, sketch.dimension.update, sketch.derivation.create) states its units in its `description`.",
    capabilityModel,
    recipe,
    operations: recipeOperationNames.map(operationEntry),
    components,
  };
}

/** One operation for `--schema <operation>`, with only the components it references. */
export function recipeOperationCatalog(operation: string) {
  if (!variantsByOperation.has(operation)) return null;
  const entry = operationEntry(operation);
  const included: Record<string, JsonSchema> = {};
  const collect = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === "object") {
      const name = refName(node as JsonSchema);
      if (name && !(name in included)) {
        included[name] = components[name]!;
        collect(components[name]);
      }
      Object.values(node).forEach(collect);
    }
  };
  collect(entry.schema);
  return { version: 1, lengthUnit: recipeLengthUnit, ...entry, components: included };
}

function pathTokens(path: string) {
  return [...path.matchAll(/\.?([A-Za-z_$][\w$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/g)].map((match) =>
    match[1] ?? (match[2] !== undefined ? Number(match[2]) : (JSON.parse(match[3]!) as string)));
}

/** Keep only object variants whose constant discriminants agree with `value`. */
function narrow(concrete: JsonSchema[], value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return concrete;
  const record = value as Record<string, unknown>;
  const matching = concrete.filter((schema) =>
    Object.entries((schema.properties ?? {}) as Record<string, JsonSchema>).every(([key, property]) =>
      !(key in record) || !("const" in property) || property.const === record[key]));
  return matching.length ? matching : concrete;
}

/** Inline component references (cycles stay as $ref) so a fragment reads standalone. */
function inline(node: unknown, seen: readonly string[] = []): unknown {
  if (Array.isArray(node)) return node.map((child) => inline(child, seen));
  if (!node || typeof node !== "object") return node;
  const name = refName(node as JsonSchema);
  if (name && !seen.includes(name)) {
    return inline({ ...components[name], ...withoutRef(node as JsonSchema) }, [...seen, name]);
  }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, inline(value, seen)]));
}

/**
 * Correction context for a contract validation issue: the generated schema at
 * `path` of `operation` (narrowed by the discriminants present in `input`) and,
 * for an unknown property, the properties its object accepts.
 */
export function contractSchemaAt(operation: string, path: string, input: unknown) {
  const variants = variantsByOperation.get(operation);
  if (!variants) return {};
  let candidates: JsonSchema[] = variants;
  let parents: JsonSchema[] = [];
  let value = input;
  for (const token of pathTokens(path)) {
    parents = narrow(candidates.flatMap((schema) => expand(schema)), value);
    candidates = parents.flatMap((schema) => {
      if (typeof token === "number") {
        const items = [(schema.prefixItems as JsonSchema[] | undefined)?.[token], schema.items, schema.additionalItems].find((item) => item && typeof item === "object");
        return items ? [items as JsonSchema] : [];
      }
      const property = (schema.properties as Record<string, JsonSchema> | undefined)?.[token];
      return property ? [property] : [];
    });
    value = value && typeof value === "object" ? (value as Record<string | number, unknown>)[token] : undefined;
  }
  const unique = [...new Map(candidates.map((schema) => [JSON.stringify(schema), schema])).values()];
  const allowed = [...new Set(parents.flatMap((schema) => Object.keys((schema.properties ?? {}) as object)))].sort();
  return {
    ...(unique.length ? { schema: inline(unique.length === 1 ? unique[0] : { oneOf: unique }) as JsonSchema } : {}),
    ...(unique.length ? {} : { allowed }),
  };
}

/** Short human rendering of an inlined schema fragment, e.g. for stderr. */
export function summarizeSchema(schema: JsonSchema, depth = 2): string {
  const branches = expand(schema);
  const unit = typeof schema["x-unit"] === "string" ? ` (${schema["x-unit"]})` : "";
  const parts = branches.map((branch) => {
    if ("const" in branch) return JSON.stringify(branch.const);
    if (branch.type === "array") return "array";
    if (branch.type !== "object" || !branch.properties) return String(branch.type ?? "value");
    if (depth <= 0) return "{...}";
    const required = new Set((branch.required as string[] | undefined) ?? []);
    return `{ ${Object.entries(branch.properties as Record<string, JsonSchema>).map(([key, property]) => `${key}${required.has(key) ? "" : "?"}: ${summarizeSchema(property, depth - 1)}`).join("; ")} }`;
  });
  return `${[...new Set(parts)].join(" | ")}${unit}`;
}

function editDistance(left: string, right: string) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1)
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[right.length]!;
}

/** Closest known operation names, for unknown-operation errors. */
export function suggestOperations(name: string) {
  return recipeOperationNames
    .map((operation) => ({ operation, distance: editDistance(name.toLowerCase(), operation.toLowerCase()) }))
    .filter(({ operation, distance }) => distance <= Math.max(2, Math.floor(operation.length / 3)) || operation.startsWith(`${name.split(".")[0]}.`))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map(({ operation }) => operation);
}
