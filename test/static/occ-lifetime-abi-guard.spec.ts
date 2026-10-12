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
