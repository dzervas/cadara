import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const readSource = (path: string) => readFileSync(path, "utf8");

test("production kernel has no stock runtime or enumeration identity escape hatch", () => {
  const runtime = readSource("src/domain/modeling/occ/runtime.ts");
  const topology = readSource("src/domain/modeling/occ/topology.ts");
  for (const source of [runtime, topology]) {
    expect(source).not.toContain(
      "CadaraAllowLegacyTopologyEnumerationForTests",
    );
  }
  for (const name of [
    "enumerateFaces",
    "enumerateEdges",
    "enumerateVertices",
  ]) {
    expect(topology).not.toContain(name);
  }
  expect(runtime).not.toContain('"opencascade.js/dist/"');
});

test("kernel execution adapters remain independent of CLI and browser composition", () => {
  const filesystem = readSource(
    "src/infrastructure/occ/filesystem-kernel-runtime.ts",
  );
  const runtime = readSource("src/domain/modeling/occ/runtime.ts");
  const adapter = readSource(
    "src/domain/modeling/opencascade-kernel-adapter.ts",
  );
  for (const source of [filesystem, runtime, adapter]) {
    expect(source).not.toMatch(/(?:@\/|\.\.\/).*cli\//);
    expect(source).not.toMatch(
      /from ["'](?:react|@\/workbench|@\/hooks|@\/components)/,
    );
  }
  expect(filesystem).not.toContain("window");
  expect(filesystem).not.toContain("document.");
});
