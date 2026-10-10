import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

/**
 * Architecture guard (T15b, [TECH] T-2, review A-3): mirror-relationship
 * reflection arithmetic lives only in its owner,
 * `src/contracts/sketch/mirror-requirements.ts`. Scope: mirror
 * *relationships*. The `symmetric`/`symmetricProjectedLine` constraint
 * residuals in `solver-core.ts` are user requirements and are not matched
 * (none of the patterns below names them).
 *
 * - The deleted second owner (`reflectAcrossLine`, `getMirrorTransform`,
 *   the `reflected ?? point` degenerate fallback) appears nowhere outside
 *   the owner (whose documentation names what it replaced).
 * - The owner's reflection, derivative and value-sync exports are imported
 *   only by the evaluation seam (`derived-geometry.ts`), which every
 *   other caller (solver projection, display, commit, creation, mock)
 *   reaches through `evaluateSketchDerivations`.
 *
 * Files are read as latin1, like `rg -a`, so a stray NUL byte (once found in
 * `derived-geometry.ts`) never hides a file from the scan. Specs are out of
 * scope: they may compute oracles.
 */
const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const OWNER = "src/contracts/sketch/mirror-requirements.ts";
const EVALUATION_SEAM = "src/contracts/sketch/derived-geometry.ts";
const OWNER_ARITHMETIC_EXPORTS = [
  "mirrorPoint",
  "mirrorVector",
  "mirrorAxisAngle",
  "mirrorArcVariables",
  "mirrorPointJvp",
  "mirrorVectorJvp",
  "mirrorArcVariablesJvp",
  "mirrorPointVjp",
  "mirrorVectorVjp",
  "mirrorArcVariablesVjp",
  "evaluateMirrorRelationship",
  "applyMirrorOutputStructure",
  "applyMirrorOutputValues",
];
const DELETED_OWNER =
  /\b(reflectAcrossLine|getMirrorTransform)\b|reflected\s*\?\?\s*point/;

function productionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return productionFiles(path);
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = productionFiles(SRC).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "latin1"),
}));

test("the mirror owner and its evaluation seam exist (the guard scans them)", () => {
  expect(files.map((file) => file.path)).toEqual(
    expect.arrayContaining([OWNER, EVALUATION_SEAM]),
  );
});

test("the deleted second mirror owner (reflectAcrossLine, getMirrorTransform, `reflected ?? point`) appears in no production file but the owner's history note", () => {
  expect(
    files
      .filter((file) => file.path !== OWNER && DELETED_OWNER.test(file.text))
      .map((file) => file.path),
  ).toEqual([]);
});

test("mirror reflection arithmetic is imported from the owner only by the evaluation seam", () => {
  const importers = files.flatMap((file) => {
    if (file.path === OWNER) return [];
    const imports = [
      ...file.text.matchAll(
        /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
      ),
    ].filter(([, , specifier]) =>
      /(^|\/)mirror-requirements$/.test(specifier!),
    );
    const names = imports.flatMap(([, list]) =>
      list!
        .split(",")
        .map(
          (entry) =>
            entry
              .trim()
              .replace(/^type\s+/, "")
              .split(/\s+as\s+/)[0]!,
        )
        .filter((name) => OWNER_ARITHMETIC_EXPORTS.includes(name)),
    );
    const namespaced =
      /import\s*\*\s*as\s+\w+\s*from\s*["'][^"']*mirror-requirements["']/.test(
        file.text,
      );
    return names.length > 0 || namespaced ? [file.path] : [];
  });
  expect(importers).toEqual([EVALUATION_SEAM]);
});
