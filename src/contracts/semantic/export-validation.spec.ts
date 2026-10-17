import { expect, it } from "vitest";
import { validateSemanticCommand } from "./runtime-schema";
import { requireGeometryExportOptions } from "@/contracts/export/options.runtime-schema";

it("accepts only each provider's closed canonical options at the public command boundary", () => {
  const base = {
    version: 1,
    commandId: "export-options",
    basis: {
      documentId: "doc_export",
      revisionId: "rev_export",
      repositoryHeads: [],
    },
    target: { kind: "body", bodyId: "body_export" },
    path: "output",
  };
  const meshAccuracy = { chordTolerance: 0.05, angleToleranceRadians: 0.1 };
  for (const [format, options] of [
    ["stl", { meshAccuracy, encoding: "binary" }],
    ["stl", { meshAccuracy, encoding: "ascii" }],
    ["step", { schema: "AP242", unit: "millimeter" }],
    ["3mf", { meshAccuracy, unit: "millimeter", includeMetadata: true }],
    ["svg", {}],
    ["dxf", {}],
  ] as const) {
    const command = { ...base, operation: `export.${format}`, options };
    expect(
      validateSemanticCommand(command).success,
      JSON.stringify(command),
    ).toBe(true);
    expect(
      validateSemanticCommand({
        ...command,
        options: { ...options, ignored: true },
      }).success,
    ).toBe(false);
    expect(() => requireGeometryExportOptions(format, options)).not.toThrow();
    expect(() =>
      requireGeometryExportOptions(format, { ...options, ignored: true }),
    ).toThrow();
  }
  for (const tolerance of [0, -1, Infinity, NaN]) {
    expect(() =>
      requireGeometryExportOptions("stl", {
        meshAccuracy: { ...meshAccuracy, chordTolerance: tolerance },
        encoding: "binary",
      }),
    ).toThrow();
    expect(() =>
      requireGeometryExportOptions("3mf", {
        meshAccuracy: { ...meshAccuracy, angleToleranceRadians: tolerance },
        unit: "millimeter",
        includeMetadata: false,
      }),
    ).toThrow();
  }
  for (const options of [
    { meshAccuracy, encoding: "unknown" },
    { meshAccuracy: { ...meshAccuracy, ignored: true }, encoding: "binary" },
  ]) {
    expect(
      validateSemanticCommand({ ...base, operation: "export.stl", options })
        .success,
    ).toBe(false);
  }
  expect(
    validateSemanticCommand({
      ...base,
      operation: "export.3mf",
      options: { meshAccuracy, unit: "millimeter", includeMetadata: "true" },
    }).success,
  ).toBe(false);
});
