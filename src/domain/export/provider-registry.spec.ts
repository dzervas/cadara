import { test, expect } from "vitest";

import {
  createScopedExportProviderRegistryForTest,
  createScopedRuntimeExtensionRegistryCompositionForTest,
} from "@/domain/extensions/test-registry-composition";
import { dxfSketchExportProvider } from "@/domain/export/providers/dxf-sketch-export-provider";
import { svgSketchExportProvider } from "@/domain/export/providers/svg-sketch-export-provider";
import { stepExportProvider } from "@/domain/export/providers/step-export-provider";
import { stlExportProvider } from "@/domain/export/providers/stl-export-provider";
import { threeMfExportProvider } from "@/domain/export/providers/threemf-export-provider";

test("src/domain/export/provider-registry.spec.ts", () => {
  const registry = createScopedExportProviderRegistryForTest([
    stlExportProvider,
    stepExportProvider,
    threeMfExportProvider,
    svgSketchExportProvider,
    dxfSketchExportProvider,
    stlExportProvider,
  ]);

  const providers = registry.getAll();
  expect(providers.length, "Registry should dedupe providers by id.").toBe(5);
  expect(
    registry.getByFormat("stl"),
    "Lookup by STL format should return STL provider.",
  ).toBe(stlExportProvider);
  expect(
    registry.getByFormat("step"),
    "Lookup by STEP format should return STEP provider.",
  ).toBe(stepExportProvider);
  expect(
    registry.getByFormat("3mf"),
    "Lookup by 3MF format should return 3MF provider.",
  ).toBe(threeMfExportProvider);
  expect(
    registry.getByFormat("svg"),
    "Lookup by SVG format should return SVG sketch provider.",
  ).toBe(svgSketchExportProvider);
  expect(
    registry.getByFormat("dxf"),
    "Lookup by DXF format should return DXF sketch provider.",
  ).toBe(dxfSketchExportProvider);
  expect(registry.getByFormat("unknown"), "Unknown formats should not resolve.").toBe(undefined);
  expect(
    registry
      .getCompatibleFormats({ kind: "body", bodyId: "body_1" })
      .join("|"),
    "Body targets should only resolve body-compatible formats.",
  ).toBe("stl|step|3mf");
  expect(
    registry
      .getCompatibleFormats({ kind: "sketch", sketchId: "sketch_1" })
      .join("|"),
    "Committed sketch targets should only resolve sketch vector formats.",
  ).toBe("svg|dxf");

  const isolatedA = createScopedRuntimeExtensionRegistryCompositionForTest({
    exportProviders: [stlExportProvider],
  }).exportProviders;
  const isolatedB = createScopedRuntimeExtensionRegistryCompositionForTest({
    exportProviders: [stepExportProvider],
  }).exportProviders;

  expect(
    isolatedA.getAll().length,
    "Scoped export registries should preserve local membership.",
  ).toBe(1);
  expect(
    isolatedB.getAll().length,
    "Separate scoped export registries should not inherit other tests.",
  ).toBe(1);
  expect(
    isolatedA.getByFormat("step"),
    "Scoped export registries should not leak providers across compositions.",
  ).toBe(undefined);
});
