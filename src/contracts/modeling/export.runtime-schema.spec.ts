import { test, expect } from "vitest";

import {
  requireDocumentExportRequest,
  getDefaultCadaraExportOptions,
} from "@/contracts/modeling/export.runtime-schema";
import { stlExportProvider } from "@/domain/export/providers/stl-export-provider";
import { stepExportProvider } from "@/domain/export/providers/step-export-provider";
import { threeMfExportProvider } from "@/domain/export/providers/threemf-export-provider";

test("src/contracts/modeling/export.runtime-schema.spec.ts", () => {
  const stlDefaults = stlExportProvider.getDefaultOptions();
  const threeMfDefaults = threeMfExportProvider.getDefaultOptions();
  const stepDefaults = stepExportProvider.getDefaultOptions();
  const cadaraDefaults = getDefaultCadaraExportOptions();

  expect(
    stlDefaults.encoding,
    "STL export should default to binary encoding.",
  ).toBe("binary");
  expect(
    stlDefaults.meshAccuracy.chordTolerance > 0,
    "STL defaults should include positive mesh tolerance.",
  ).toBeTruthy();
  expect(
    threeMfDefaults.includeMetadata,
    "3MF export should include metadata by default.",
  ).toBeTruthy();
  expect(
    threeMfDefaults.meshAccuracy.angleToleranceRadians,
    "3MF and STL should share the mesh accuracy default.",
  ).toBe(stlDefaults.meshAccuracy.angleToleranceRadians);
  expect(stepDefaults.schema, "STEP export should default to AP242.").toBe(
    "AP242",
  );
  expect(
    cadaraDefaults.pretty,
    "cadara export should default to readable JSON.",
  ).toBeTruthy();

  const parsedStep = requireDocumentExportRequest({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: "rev_0001",
    target: { kind: "body", bodyId: "body_part-1" },
    targetLabel: "Part 1",
    format: "step",
    options: stepDefaults,
  });

  expect(
    parsedStep.format,
    "Export request parsing should preserve the format.",
  ).toBe("step");
});
