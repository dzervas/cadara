import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");

test("semantic exports use shared provider preparation and adapter-owned binary output, never CLI translators", () => {
  const semantic = read("src/infrastructure/modeling/semantic-export-port.ts");
  expect(semantic).toContain("input.service.exportDocument({");
  expect(semantic).toContain(
    "input.files.writeBytes(command.path, result.payload)",
  );
  expect(semantic).not.toMatch(
    /TextDecoder|writeBinaryStl|zipSync|serializeSvg|serializeDxf|STEPControl/,
  );
  const orchestrator = read("src/domain/export/export-orchestrator.ts");
  expect(orchestrator).toContain("provider.validateOptions?.(input.options)");
  expect(orchestrator).toContain("provider.export({");
  for (const provider of [
    "stl-export-provider",
    "step-export-provider",
    "threemf-export-provider",
    "svg-sketch-export-provider",
    "dxf-sketch-export-provider",
  ])
    expect(read(`src/domain/export/providers/${provider}.ts`)).toContain(
      "requireGeometryExportOptions(",
    );
  const cli = read("src/cli/commands/document-recipes.ts");
  expect(cli).not.toMatch(
    /writeBinaryStl|zipSync|serializeSvg|serializeDxf|STEPControl|createOccExportCapabilities/,
  );
  const file = read("src/infrastructure/modeling/native-document-file-io.ts");
  expect(file).toContain("await handle.sync()");
  expect(file).toContain("await handle.close()");
});
