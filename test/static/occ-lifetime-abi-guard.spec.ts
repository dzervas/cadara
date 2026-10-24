import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

// Exercise the same public policy function used by the native registration probe.
// Node loads the .mjs boundary; no second TS implementation of the policy.
function checkDeclarations(declarations: string) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import { assertLifetimeDeclarations } from "./scripts/occ/lifetime-abi-policy.mjs";
      import { readFileSync } from "node:fs";
      assertLifetimeDeclarations(readFileSync(0, "utf8"));
    `,
    ],
    { input: declarations, encoding: "utf8" },
  );
}

const declarations = readFileSync("public/cadara-occ.d.ts", "utf8");
const extension = JSON.parse(
  readFileSync("scripts/occ/step-binding-extension.json", "utf8"),
) as {
  abi: string[];
  declarations: Record<string, string>;
  returnStatus: {
    abi: string[];
    resolvedAbi: string[];
    declaration: string;
    instanceEntry: string;
  };
};
const baseline = declarations
  .replace(extension.returnStatus.declaration, "")
  .replace("  " + extension.returnStatus.instanceEntry + "\n", "")
  .replace(
    /^[ \t]*export declare class MoniTool_TypedValue(?:_[12])?[^\n]*\{\n[\s\S]*?^\s*}/gm,
    "",
  )
  .replace(
    /^ {2}MoniTool_TypedValue(?:_[12])?: typeof MoniTool_TypedValue(?:_[12])?;\n/gm,
    "",
  );
const extended =
  Object.values(extension.declarations).join("\n\n") +
  "\n\n" +
  baseline.replace(
    "export type OpenCascadeInstance = {FS: typeof FS} & {",
    "export type OpenCascadeInstance = {FS: typeof FS} & {\n" +
      Object.keys(extension.declarations)
        .map((name) => `  ${name}: typeof ${name};`)
        .join("\n"),
  );

test("lifetime policy accepts the approved STEP inheritance extension", () => {
  const result = checkDeclarations(extended);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

test("lifetime policy accepts the original declarations with reordered top-level blocks", () => {
  const pattern =
    /^[ \t]*export declare (?:class|type) \w+[^\n]*\{\n[\s\S]*?^\s*}/gm;
  const blocks = [...baseline.matchAll(pattern)].map((match) => match[0]);
  const reordered =
    blocks.reverse().join("\n\n") + "\n\n" + baseline.replace(pattern, "");
  const result = checkDeclarations(reordered);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

test("lifetime policy rejects a changed approved extension", () => {
  const changed = extended.replace(
    "SetRealValue(rval: Standard_Real): Standard_Boolean;",
    "SetRealValue(rval: Standard_Real): void;",
  );
  expect(changed).not.toBe(extended);
  const result = checkDeclarations(changed);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    "STEP declarations must equal the approved MoniTool binding inventory",
  );
});

test("lifetime policy rejects a partial extension or missing instance entry", () => {
  for (const changed of [
    extended.replace(extension.declarations.MoniTool_TypedValue_2, ""),
    extended.replace(
      "  MoniTool_TypedValue_2: typeof MoniTool_TypedValue_2;",
      "",
    ),
  ]) {
    expect(changed).not.toBe(extended);
    expect(checkDeclarations(changed).status).not.toBe(0);
  }
});

test("lifetime policy rejects enum and declaration-ownership drift", () => {
  for (const changed of [
    extended.replace("TopAbs_COMPOUND: {};", "TopAbs_COMPOUND: number;"),
    extended.replace(
      "export declare class TopoDS_Shape {",
      "export declare class RenamedShape {",
    ),
  ]) {
    expect(changed).not.toBe(extended);
    const result = checkDeclarations(changed);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Existing declarations must equal the v8 reference",
    );
  }
});

test("lifetime policy accepts the independently audited STEP status declarations", () => {
  // Exact emitted declaration independently matched to the pinned native header.
  const anticipated =
    `export declare type IFSelect_ReturnStatus = {
  IFSelect_RetVoid: {};
  IFSelect_RetDone: {};
  IFSelect_RetError: {};
  IFSelect_RetFail: {};
  IFSelect_RetStop: {};
}\n\n` +
    extended.replace(
      "export type OpenCascadeInstance = {FS: typeof FS} & {",
      "export type OpenCascadeInstance = {FS: typeof FS} & {\n  IFSelect_ReturnStatus: IFSelect_ReturnStatus;",
    );
  const result = checkDeclarations(anticipated);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

test("lifetime policy rejects altered or partial STEP status declarations", () => {
  const status = extension.returnStatus;
  const complete =
    status.declaration +
    "\n\n" +
    extended.replace(
      "export type OpenCascadeInstance = {FS: typeof FS} & {",
      "export type OpenCascadeInstance = {FS: typeof FS} & {\n  " +
        status.instanceEntry,
    );
  for (const changed of [
    complete.replace("IFSelect_RetDone: {};", "IFSelect_RetDone: number;"),
    complete.replace(status.declaration, ""),
    complete.replace(status.instanceEntry, ""),
    complete.replace("IsNull(): Standard_Boolean;", "IsNull(): void;"),
  ]) {
    expect(changed).not.toBe(complete);
    expect(checkDeclarations(changed).status).not.toBe(0);
  }
});

test("lifetime policy rejects wrong status values, metadata and partial return resolutions", () => {
  const status = extension.returnStatus;
  const complete = [...status.abi, ...status.resolvedAbi];
  for (const changed of [
    complete.map((line) =>
      line.replace("IFSelect_RetDone=1", "IFSelect_RetDone=2"),
    ),
    complete.map((line) => line.replace("size=4 signed=0", "size=4 signed=1")),
    complete.map((line) => line.replace("size=4 signed=0", "size=8 signed=0")),
    complete.slice(1),
    complete.slice(0, -1),
    complete.map((line) => line.replace("emscripten::val) iiii", "bool) iiii")),
  ]) {
    expect(changed).not.toEqual(complete);
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { assertLifetimeAbi } from "./scripts/occ/lifetime-abi-policy.mjs";
      import { readFileSync } from "node:fs";
      assertLifetimeAbi(JSON.parse(readFileSync(0, "utf8")));
    `,
      ],
      { input: JSON.stringify(changed), encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "STEP status registry must equal the approved enum and return resolutions",
    );
  }
});

test("native probe reporting names the failed guard and labels the expected trap PASS", () => {
  // Execute the real reporting tail with explicit report cases, not a fake kernel.
  const source = readFileSync(
    "scripts/occ/native-lifetime-conformance.mjs",
    "utf8",
  );
  const reporting = source.slice(
    source.lastIndexOf("console.log(JSON.stringify(result));"),
  );
  for (const errors of [0, 1]) {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      const cases = [
        { name: "attribute-handle-after-document-is-unsafe-release-order", status: "pass" },
        ...( ${errors} ? [{name: "registry-abi-and-declarations-approved-extension", status: "error", error: "Existing Embind registry ABI must equal the v8 reference"}] : []),
      ];
      const result = {cases, summary: {pass: 1, error: ${errors}}};
      ${reporting}
    `,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(errors);
    expect(JSON.parse(result.stdout).summary.error).toBe(errors);
    expect(result.stderr).toContain(
      "PASS attribute-handle-after-document-is-unsafe-release-order: expected unsafe-release memory access out of bounds",
    );
    if (errors)
      expect(result.stderr).toContain(
        "ERROR registry-abi-and-declarations-approved-extension: Existing Embind registry ABI must equal the v8 reference",
      );
    else expect(result.stderr).not.toContain("ERROR registry-");
  }
});

test("production STEP recipe binds the return status shared by Transfer and Write", () => {
  const writer = declarations.match(
    /export declare class STEPControl_Writer \{([\s\S]*?)\n}/,
  )?.[1];
  expect(writer).toBeDefined();
  expect(writer).toMatch(/Transfer\([^\n]*\): IFSelect_ReturnStatus;/);
  expect(writer).toMatch(/Write\([^\n]*\): IFSelect_ReturnStatus;/);
  expect(readFileSync("opencascade-recipe.yaml", "utf8")).toMatch(
    /^ {4}- symbol: IFSelect_ReturnStatus$/m,
  );
});

test("STEP enum source receipts are conditional, post-acceptance and checksummed", () => {
  const script = readFileSync("scripts/occ/regen-patched-bindings.sh", "utf8");
  const copies = script.indexOf('if "IFSelect_ReturnStatus" in targets:');
  expect(copies).toBeGreaterThan(
    script.indexOf('sys.exit("Regeneration acceptance failed")'),
  );
  expect(script).toContain('rel = targets["IFSelect_ReturnStatus"]');
  expect(script).toContain(
    'shutil.copyfile(os.path.join(original_root, rel), receipts + "/IFSelect_ReturnStatus.original.cpp")',
  );
  expect(script).toContain(
    'shutil.copyfile(os.path.join(regenerated_root, rel), receipts + "/IFSelect_ReturnStatus.regenerated.cpp")',
  );
  expect(script).toMatch(
    /if \[\[ -f "\$receipts\/IFSelect_ReturnStatus\.original\.cpp" \]\]; then[\s\S]*?sha256sum IFSelect_ReturnStatus\.original\.cpp IFSelect_ReturnStatus\.regenerated\.cpp >> receipts\.sha256/,
  );
});

test("lifetime policy rejects drift in an existing public signature", () => {
  const changed = declarations.replace(
    "IsNull(): Standard_Boolean;",
    "IsNull(): Standard_Real;",
  );
  expect(changed).not.toBe(declarations);
  const result = checkDeclarations(changed);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    "Existing declarations must equal the v8 reference",
  );
});

// cadara-3sq.7: the bit-exact shape-set checkpoint shim is the only other
// approved extension; it must arrive complete and exactly as audited.
const checkpointExtension = JSON.parse(
  readFileSync("scripts/occ/shape-set-checkpoint-extension.json", "utf8"),
) as { abi: string[]; declaration: string; instanceEntry: string };
const withoutCheckpoint = declarations
  .replace(checkpointExtension.declaration + "\n\n", "")
  .replace("  " + checkpointExtension.instanceEntry + "\n", "");
const withCheckpoint =
  checkpointExtension.declaration +
  "\n\n" +
  withoutCheckpoint.replace(
    "export type OpenCascadeInstance = {FS: typeof FS} & {",
    "export type OpenCascadeInstance = {FS: typeof FS} & {\n  " +
      checkpointExtension.instanceEntry,
  );

function checkAbi(lines: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import { assertLifetimeAbi } from "./scripts/occ/lifetime-abi-policy.mjs";
      import { readFileSync } from "node:fs";
      assertLifetimeAbi(JSON.parse(readFileSync(0, "utf8")));
    `,
    ],
    { input: JSON.stringify(lines), encoding: "utf8" },
  );
}

test("lifetime policy accepts declarations with or without the approved shape-set checkpoint", () => {
  for (const candidate of [withoutCheckpoint, withCheckpoint]) {
    const result = checkDeclarations(candidate);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }
});

test("lifetime policy rejects an altered or partial shape-set checkpoint declaration", () => {
  for (const [changed, message] of [
    [
      withCheckpoint.replace(
        "static Write(root: TopoDS_Shape): CadaraNativeShapeSetCheckpoint;",
        "static Write(root: TopoDS_Shape): string;",
      ),
      "Shape-set checkpoint declaration must equal the approved inventory",
    ],
    [
      withCheckpoint.replace(checkpointExtension.instanceEntry, ""),
      "Shape-set checkpoint instance entry must match the approved declaration",
    ],
  ] as const) {
    expect(changed).not.toBe(withCheckpoint);
    const result = checkDeclarations(changed);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  }
});

test("lifetime policy rejects a partial or altered shape-set checkpoint registry", () => {
  for (const changed of [
    checkpointExtension.abi.slice(1),
    checkpointExtension.abi.map((line) =>
      line.replace(
        "Write(CadaraNativeShapeSetCheckpoint, TopoDS_Shape) iii",
        "Write(std::string, TopoDS_Shape) iii",
      ),
    ),
  ]) {
    expect(changed).not.toEqual(checkpointExtension.abi);
    const result = checkAbi(changed);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Shape-set checkpoint registry must equal the approved inventory",
    );
  }
});
