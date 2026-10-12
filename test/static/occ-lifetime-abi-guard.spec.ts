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
};
const baseline = declarations
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

test("unbuilt STEP status declarations remain rejected pending the next binary audit", () => {
  // Header-derived prediction, not a golden artifact or approval of an unseen ABI.
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
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    "Existing declarations must equal the v8 reference",
  );
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
