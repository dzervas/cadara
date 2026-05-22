import { test, expect } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { getDefaultCadaraExportOptions } from "@/contracts/modeling/export.runtime-schema";
import { AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import { createMemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { createBuiltinExportProviderRegistry } from "@/domain/export/builtin-provider-composition";
import { stepExportProvider } from "@/domain/export/providers/step-export-provider";
import { stlExportProvider } from "@/domain/export/providers/stl-export-provider";

test("src/domain/modeling/modeling-export.spec.ts", async () => {
  async function testCadaraExportsDurableDocumentJson() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
    });
    const snapshot = await service.getCurrentDocumentSnapshot();

    const result = await service.exportDocument({
      baseRevisionId: snapshot.document.revisionId,
      target: { kind: "body", bodyId: "body_part-1" },
      targetLabel: "Part 1",
      format: "cadara",
      options: getDefaultCadaraExportOptions(),
    });

    expect(
      result.ok,
      "cadara export should succeed for the current document revision.",
    ).toBeTruthy();
    expect(
      result.filename,
      "cadara export should use the selected row label for the filename.",
    ).toBe("part-1.cadara");
    expect(
      result.mimeType,
      "cadara export should advertise a JSON MIME type.",
    ).toBe("application/vnd.cadara+json");
    expect(
      typeof result.payload,
      "cadara export should return text JSON.",
    ).toBe("string");

    const payload = JSON.parse(result.payload) as Record<string, unknown>;
    expect(
      payload.contractVersion,
      "cadara export should preserve contract version.",
    ).toBe(snapshot.document.contractVersion);
    expect(
      payload.schemaVersion,
      "cadara export should preserve schema version.",
    ).toBe(snapshot.document.schemaVersion);
    expect(
      "presentation" in payload,
      "cadara export should not include presentation-only workspace state.",
    ).toBeFalsy();
  }

  async function testGeometryExportPayloadMetadata() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      exportProviders: createBuiltinExportProviderRegistry(),
    });
    const snapshot = await service.getCurrentDocumentSnapshot();

    const result = await service.exportDocument({
      baseRevisionId: snapshot.document.revisionId,
      target: { kind: "body", bodyId: "body_part-1" },
      targetLabel: "Part 1",
      format: "step",
      options: stepExportProvider.getDefaultOptions(),
    });

    expect(
      result.ok,
      "Mock STEP export should succeed for a body target.",
    ).toBeTruthy();
    expect(
      result.filename,
      "Geometry export should include the returned filename.",
    ).toBe("part-1.step");
    expect(
      result.extension,
      "Geometry export should include the returned extension.",
    ).toBe("step");
    expect(
      result.mimeType,
      "Geometry export should include the returned MIME type.",
    ).toBe("model/step");
    expect(
      typeof result.payload,
      "Mock STEP export should return a text payload.",
    ).toBe("string");
    expect(
      result.payload.includes("cadara mock step export"),
      "Mock geometry export should identify the format.",
    ).toBeTruthy();
  }

  async function testUnexportableGeometryTargetReportsDiagnostic() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      exportProviders: createBuiltinExportProviderRegistry(),
    });
    const snapshot = await service.getCurrentDocumentSnapshot();

    const result = await service.exportDocument({
      baseRevisionId: snapshot.document.revisionId,
      target: { kind: "sketch", sketchId: "sketch_primary" },
      targetLabel: "Sketch 1",
      format: "stl",
      options: stlExportProvider.getDefaultOptions(),
    });

    expect(result.ok, "Geometry export should reject non-body targets.").toBe(
      false,
    );
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "export-incompatible-target",
      ),
      "Unexportable targets should report a structured diagnostic.",
    ).toBeTruthy();
  }

  async function testFileMenuExportImportsAuthoredDocumentJson() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository: createMemoryDocumentRepository(),
    });
    const exportResult = await service.exportCurrentDocument();

    expect(
      exportResult.filename,
      "Current document export should use a document-level cadara filename.",
    ).toBe("document.cadara");
    expect(
      exportResult.mimeType,
      "Current document export should use the cadara JSON MIME type.",
    ).toBe("application/vnd.cadara+json");
    expect(
      typeof exportResult.payload,
      "Current document export should return authored JSON text.",
    ).toBe("string");

    const exported = JSON.parse(exportResult.payload) as AuthoredModelDocument;
    expect(
      exported.schemaVersion,
      "Current document export should use the authored document schema.",
    ).toBe(AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION);
    expect(
      "presentation" in exported,
      "Current document export should exclude presentation-only state.",
    ).toBeFalsy();

    const importedDocument: AuthoredModelDocument = {
      ...exported,
      bodyLabels: exported.bodyLabels.map((label) => ({
        ...label,
        label: "Imported Body",
      })),
    };
    const importResult = await service.importDocument({
      document: importedDocument,
    });
    expect(
      importResult.ok,
      "Valid authored document import should succeed.",
    ).toBeTruthy();

    const snapshot = await service.getCurrentDocumentSnapshot();
    expect(
      snapshot.document.bodies.some((body) => body.label === "Imported Body"),
      "Imported authored body labels should appear in the refreshed snapshot.",
    ).toBeTruthy();

    const newResult = await service.createNewDocument();
    expect(
      newResult.ok,
      "New document reset should restore the seeded authored document.",
    ).toBeTruthy();
    const resetSnapshot = await service.getCurrentDocumentSnapshot();
    expect(
      resetSnapshot.document.bodies.every(
        (body) => body.label !== "Imported Body",
      ),
      "New document reset should remove imported authored body labels.",
    ).toBeTruthy();
  }

  async function testFileMenuImportRejectsInvalidDocumentJson() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
    });

    const result = await service.importDocument({
      document: {
        contractVersion: "modeling-contract/v1alpha1",
        schemaVersion: "authored-model-document/v999",
      },
    });

    expect(
      result.ok,
      "Invalid authored document import should be rejected.",
    ).toBeFalsy();
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "document-import-unsupported-schema-version",
      ),
      "Invalid import should report a structured schema diagnostic.",
    ).toBeTruthy();
  }

  async function testGeometryExportRequiresExplicitComposition() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
    });
    const snapshot = await service.getCurrentDocumentSnapshot();

    const result = await service.exportDocument({
      baseRevisionId: snapshot.document.revisionId,
      target: { kind: "body", bodyId: "body_part-1" },
      targetLabel: "Part 1",
      format: "step",
      options: stepExportProvider.getDefaultOptions(),
    });

    expect(
      result.ok,
      "Geometry export without an explicit export-provider composition should fail.",
    ).toBeFalsy();
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "export-unsupported-format",
      ),
      "Missing explicit export-provider composition should surface an unsupported-format diagnostic.",
    ).toBeTruthy();
  }

  await testCadaraExportsDurableDocumentJson();
  await testGeometryExportPayloadMetadata();
  await testUnexportableGeometryTargetReportsDiagnostic();
  await testFileMenuExportImportsAuthoredDocumentJson();
  await testFileMenuImportRejectsInvalidDocumentJson();
  await testGeometryExportRequiresExplicitComposition();
});
