import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Destructor-only repairs retain the original v8 ABI. The separately audited
// STEP inheritance closure may add ONLY this explicit registration/declaration
// inventory. Do not replace these baseline hashes with a new build's hashes.
export const EXPECTED_DTS_SHA256 =
  "e30f46eca4fa30d12b6ccb16281a86d2c439433e6c4de6a43eeef623c93a8443";
export const EXPECTED_ABI_SHA256 =
  "5c3617ab8ab5a10d41a5351e2ded5b472a19ece74880ece1e7a7c700bde87d8d";
// Independently derived from the original declarations: class/enum blocks remain
// byte-identical (including member order); only top-level/instance-entry order and
// blank lines between top-level declarations are immaterial to public signatures.
const BASELINE_DECLARATIONS_SHA256 =
  "42ed68c0445500c9b617ebbae8acdc8a77f13d0f8e27e45e9ba37cc4dd40c7c2";
const extension = JSON.parse(
  readFileSync(
    new URL("./step-binding-extension.json", import.meta.url),
    "utf8",
  ),
);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function assertLifetimeAbi(lines) {
  const added = lines.filter((line) =>
    /^(class|ctor|method|static) MoniTool_TypedValue(?:_[12])?[ (.]/.test(line),
  );
  if (added.length) {
    assert(
      JSON.stringify([...added].sort()) === JSON.stringify(extension.abi),
      "STEP registry extension must equal the approved MoniTool binding inventory",
    );
    assert(
      lines.includes("class Interface_TypedValue base=MoniTool_TypedValue"),
      "STEP registry extension must resolve Interface_TypedValue's base",
    );
  }
  const baseline = lines
    .filter((line) => !added.includes(line))
    .map((line) =>
      added.length &&
      line === "class Interface_TypedValue base=MoniTool_TypedValue"
        ? "class Interface_TypedValue base=?unbound:19MoniTool_TypedValue"
        : line,
    )
    .sort();
  const baselineAbiSha256 = hash(baseline.join("\n") + "\n");
  assert(
    baselineAbiSha256 === EXPECTED_ABI_SHA256,
    "Existing Embind registry ABI must equal the v8 reference",
  );
  return { baselineAbiSha256, approvedAbiEntries: added.length };
}

export function assertLifetimeDeclarations(declarations) {
  const classes = [
    ...declarations.matchAll(
      /^[ \t]*export declare (?:class|type) (\w+)[^\n]*\{\n[\s\S]*?^\s*}/gm,
    ),
  ];
  const added = classes.filter((match) => match[1] in extension.declarations);
  if (added.length) {
    assert(
      added.length === 3 &&
        added.every(
          (match) => match[0].trim() === extension.declarations[match[1]],
        ) &&
        new Set(added.map((match) => match[1])).size === 3,
      "STEP declarations must equal the approved MoniTool binding inventory",
    );
  }
  let rest = declarations.replace(
    /^[ \t]*export declare (?:class|type) (\w+)[^\n]*\{\n[\s\S]*?^\s*}/gm,
    "",
  );
  const instance = rest.match(
    /export type OpenCascadeInstance = \{FS: typeof FS\} & \{\n([\s\S]*?)\n\};/,
  );
  assert(instance, "Generated OpenCascadeInstance declaration must be present");
  const entries = instance[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const addedEntries = entries.filter((line) =>
    /^MoniTool_TypedValue(?:_[12])?:/.test(line),
  );
  assert(
    JSON.stringify(addedEntries.sort()) ===
      JSON.stringify(
        added.map((match) => `${match[1]}: typeof ${match[1]};`).sort(),
      ),
    "STEP instance entries must match the approved declarations",
  );
  rest = rest.replace(instance[0], "");
  const canonical =
    classes
      .filter((match) => !added.includes(match))
      .map((match) => match[0].trim())
      .sort()
      .join("\n\n") +
    "\n\n" +
    entries
      .filter((line) => !addedEntries.includes(line))
      .sort()
      .join("\n") +
    "\n\n" +
    rest
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n") +
    "\n";
  const baselineDeclarationsSha256 = hash(canonical);
  assert(
    baselineDeclarationsSha256 === BASELINE_DECLARATIONS_SHA256,
    "Existing declarations must equal the v8 reference",
  );
  return {
    baselineDeclarationsSha256,
    approvedDeclarationClasses: added.length,
  };
}
