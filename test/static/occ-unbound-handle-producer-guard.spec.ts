import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

// Policy guard (T10 review R7): the shipped `public/cadara-occ` build binds
// `GC_MakeArcOfCircle` and `GC_MakeCircle` but not the handle types their
// `Value()` returns (`Handle_Geom_TrimmedCurve`, `Handle_Geom_Circle`), so every
// call throws an embind UnboundTypeError in the browser (open problem 8) while
// the stock Node package passes. Arcs are built by
// `src/domain/modeling/occ/exact-edges.ts` instead; no `src` file may name
// either producer.
const FORBIDDEN = /^GC_Make(ArcOfCircle|Circle)(_\d+)?$/;
const EXTENSIONS = new Set([".ts", ".tsx"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return EXTENSIONS.has(extname(path)) ? [path] : [];
  });
}

function forbiddenProducers(text: string, fileName: string) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const name =
      ts.isIdentifier(node) || ts.isPrivateIdentifier(node)
        ? node.text
        : ts.isStringLiteralLike(node)
          ? node.text
          : null;
    if (name !== null && FORBIDDEN.test(name)) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      found.push(`${fileName}:${line + 1} ${name}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test("test/static/occ-unbound-handle-producer-guard.spec.ts", () => {
  for (const fixture of [
    "const arc = new oc.GC_MakeArcOfCircle_4(a, m, b); arc.Value();",
    'const circle = new oc["GC_MakeCircle_6"](p, n, r);',
  ])
    expect(
      forbiddenProducers(fixture, "fixture.ts"),
      `The guard must catch ${fixture}`,
    ).toHaveLength(1);

  const root = process.cwd();
  const violations = sourceFiles(join(root, "src")).flatMap((path) =>
    forbiddenProducers(
      readFileSync(path, "utf8"),
      relative(root, path).replaceAll("\\", "/"),
    ),
  );
  expect(
    violations,
    "GC_MakeArcOfCircle/GC_MakeCircle return handles the shipped OCC build does not bind; build arcs with occ/exact-edges.ts",
  ).toEqual([]);
});
