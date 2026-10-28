import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// This inventory only shrinks: migrate existing files, never add legacy source.
const legacyDomainFiles = [
  "src/domain/bug-reporting/report.spec.ts",
  "src/domain/bug-reporting/report.ts",
  "src/domain/extensions/runtime-registry-composition.ts",
  "src/domain/extensions/test-registry-composition.ts",
  "src/domain/import/builtin-provider-composition.ts",
  "src/domain/import/kernel-history-probe.spec.ts",
  "src/domain/import/kernel-history-probe.ts",
  "src/domain/import/live-body-signatures.ts",
  "src/domain/import/onshape/apply-pipeline.heavy.spec.ts",
  "src/domain/import/onshape/bake-segment-planner.spec.ts",
  "src/domain/import/onshape/bake-segment-planner.ts",
  "src/domain/import/onshape/extrude-feature-translator.spec.ts",
  "src/domain/import/onshape/extrude-feature-translator.ts",
  "src/domain/import/onshape/fallback-feature-translator.spec.ts",
  "src/domain/import/onshape/fallback-feature-translator.ts",
  "src/domain/import/onshape/feature-translator-registry.ts",
  "src/domain/import/onshape/fidelity-planner.spec.ts",
  "src/domain/import/onshape/fidelity-planner.ts",
  "src/domain/import/onshape/provider.heavy.spec.ts",
  "src/domain/import/onshape/provider.ts",
  "src/domain/import/onshape/realkernel-acceptance-gate.spec.ts",
  "src/domain/import/onshape/rollback-bake.spec.ts",
  "src/domain/import/onshape/rollback-bake.ts",
  "src/domain/import/onshape/signature-interpreter.spec.ts",
  "src/domain/import/onshape/signature-interpreter.ts",
  "src/domain/import/onshape/sketch-feature-translator.ts",
  "src/domain/import/onshape/split-interface-face-query-reader.spec.ts",
  "src/domain/import/onshape/split-interface-face-query-reader.ts",
  "src/domain/import/onshape/split-interface-history.heavy.spec.ts",
  "src/domain/import/onshape/split-interface-owner-witness.spec.ts",
  "src/domain/import/onshape/split-interface-owner-witness.ts",
  "src/domain/import/onshape/topology-resolution-planner.spec.ts",
  "src/domain/import/onshape/topology-resolution-planner.ts",
  "src/domain/import/onshape/variable-feature-translator.ts",
  "src/domain/import/onshape/wave-a-capture-fixtures.ts",
  "src/domain/import/onshape/wave-a-feature-translators.spec.ts",
  "src/domain/import/onshape/wave-a-feature-translators.ts",
  "src/domain/import/onshape/wave-b-body-feature-translators.spec.ts",
  "src/domain/import/onshape/wave-b-body-feature-translators.ts",
  "src/domain/import/onshape/wave-b-capture-fixtures.ts",
  "src/domain/import/onshape/wave-t-capture-fixtures.ts",
  "src/domain/import/onshape/wave-w-pattern-capture-fixtures.ts",
  "src/domain/import/onshape/wave-x-capture-fixtures.ts",
  "src/domain/import/onshape/wave-x-pattern-mirror-capture-fixtures.ts",
  "src/domain/import/orchestrator.spec.ts",
  "src/domain/import/orchestrator.ts",
  "src/domain/import/provider-registry.spec.ts",
  "src/domain/import/provider-registry.ts",
  "src/domain/import/topology-materializer.spec.ts",
];

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

test("src/domain contains only the remaining legacy file inventory", () => {
  expect(listFiles("src/domain").sort()).toEqual(legacyDomainFiles);
});
