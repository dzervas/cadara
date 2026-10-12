import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const readSource = (path: string) => readFileSync(path, "utf8");

test("production kernel has no stock runtime or enumeration identity escape hatch", () => {
  const runtime = readSource("src/domain/modeling/occ/runtime.ts");
  const topology = readSource("src/domain/modeling/occ/topology.ts");
  const bootstrap = readSource("src/infrastructure/occ/runtime.ts");
  const initialization = readSource("src/infrastructure/occ/initialization.ts");
  for (const source of [runtime, bootstrap, initialization, topology]) {
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
  for (const source of [runtime, bootstrap, initialization]) {
    expect(source).not.toContain('"opencascade.js/dist/"');
  }
});

test("OCC bootstrap selection and shared initialization have no adapter cycle", () => {
  const neutral = readSource("src/domain/modeling/occ/runtime.ts");
  expect(neutral).not.toMatch(/(?:import|export)[\s\S]*?["']@\/infrastructure\//);
  const initialization = readSource("src/infrastructure/occ/initialization.ts");
  expect(initialization).not.toMatch(
    /(?:filesystem-kernel-runtime|@\/infrastructure\/occ\/runtime)/,
  );
  expect(initialization).not.toMatch(/node:|import\s*\(|window|document\./);
  const filesystem = readSource(
    "src/infrastructure/occ/filesystem-kernel-runtime.ts",
  );
  expect(filesystem).toContain('from "@/infrastructure/occ/initialization"');
  expect(filesystem).not.toContain('from "@/infrastructure/occ/runtime"');
  const bootstrap = readSource("src/infrastructure/occ/runtime.ts");
  expect(bootstrap).toContain(
    'import("@/infrastructure/occ/filesystem-kernel-runtime")',
  );
  expect(neutral).not.toContain("loadDefaultOpenCascadeFactory");
  expect(neutral).not.toContain(
    "createProductionOpenCascadeInitializerFromMainJS",
  );
});

test("kernel execution adapters remain independent of CLI and browser composition", () => {
  const filesystem = readSource(
    "src/infrastructure/occ/filesystem-kernel-runtime.ts",
  );
  const runtime = readSource("src/domain/modeling/occ/runtime.ts");
  const adapter = readSource(
    "src/domain/modeling/opencascade-kernel-adapter.ts",
  );
  const bootstrap = readSource("src/infrastructure/occ/runtime.ts");
  const initialization = readSource("src/infrastructure/occ/initialization.ts");
  for (const source of [filesystem, runtime, bootstrap, initialization, adapter]) {
    expect(source).not.toMatch(/(?:@\/|\.\.\/).*cli\//);
    expect(source).not.toMatch(
      /from ["'](?:react|@\/workbench|@\/hooks|@\/components)/,
    );
  }
  expect(filesystem).not.toContain("window");
  expect(filesystem).not.toContain("document.");
});
