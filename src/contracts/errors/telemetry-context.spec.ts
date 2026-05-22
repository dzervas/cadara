import { test, expect } from "vitest";

import {
  clearActiveDocumentTelemetryContext,
  createActiveDocumentTelemetryContext,
  getErrorReporterTelemetryContext,
  publishActiveDocumentTelemetryContext,
} from "@/contracts/errors/telemetry-context";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createGeometryAssetDiagnostic } from "@/contracts/modeling/geometry-assets";
import { createDeterministicGeometryAsset } from "@/domain/modeling/geometry-asset-test-helpers";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

test("src/contracts/errors/telemetry-context.spec.ts", async () => {
  clearActiveDocumentTelemetryContext();
  expect(
    getErrorReporterTelemetryContext().activeDocument.availability,
    "Telemetry context should start unavailable.",
  ).toBe("unavailable");

  const adapter = new MockKernelAdapter();
  const snapshot = (
    await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_workspace",
    })
  ).snapshot;
  const context = createActiveDocumentTelemetryContext(snapshot);

  expect(
    context.availability,
    "Snapshot telemetry context should be loaded.",
  ).toBe("loaded");
  expect(
    context.documentId,
    "Snapshot telemetry should include document id.",
  ).toBe(snapshot.document.documentId);
  expect(
    context.revisionId,
    "Snapshot telemetry should include revision id.",
  ).toBe(snapshot.document.revisionId);
  expect(
    context.counts.sketches,
    "Snapshot telemetry should include sketch count.",
  ).toBe(snapshot.document.sketches.length);
  expect(
    context.counts.features,
    "Snapshot telemetry should include feature count.",
  ).toBe(snapshot.document.features.length);
  expect(
    context.payloadStatus,
    "Small durable authored document payloads should be attached.",
  ).toBe("attached");
  expect(
    context.document.documentId,
    "Attached payload should be the durable authored document.",
  ).toBe(snapshot.document.documentId);
  expect(
    "render" in context.document,
    "Attached payload should exclude render exports.",
  ).toBeFalsy();
  expect(
    "presentation" in context.document,
    "Attached payload should exclude presentation state.",
  ).toBeFalsy();

  const asset = await createDeterministicGeometryAsset({
    ownerFeatureIds: [snapshot.document.features[0]!.featureId],
  });
  const diagnosticSnapshot = structuredClone(snapshot);
  diagnosticSnapshot.document.diagnostics = [
    createGeometryAssetDiagnostic(
      "geometry-asset-missing",
      asset.asset,
      "Referenced geometry asset bytes are missing.",
    ),
  ];
  const assetContext = createActiveDocumentTelemetryContext(diagnosticSnapshot);
  expect(
    assetContext.availability === "loaded" &&
      assetContext.assetDiagnostics[0]?.hashPrefix ===
        asset.asset.hash.replace(/^sha256:/, "").slice(0, 12) &&
      !("bytes" in assetContext.assetDiagnostics[0]),
    "Telemetry should summarize geometry asset diagnostics without raw bytes.",
  ).toBeTruthy();

  publishActiveDocumentTelemetryContext(context);
  expect(
    getErrorReporterTelemetryContext().activeDocument.availability,
    "Published telemetry context should be readable by reporters.",
  ).toBe("loaded");

  const omittedContext = createActiveDocumentTelemetryContext(snapshot, {
    payloadByteLimit: 1,
  });
  expect(
    omittedContext.availability,
    "Oversized document telemetry should still carry identity.",
  ).toBe("loaded");
  expect(
    omittedContext.payloadStatus,
    "Oversized payloads should be omitted explicitly.",
  ).toBe("omitted-too-large");
  expect(
    omittedContext.documentId,
    "Oversized fallback should keep document id.",
  ).toBe(snapshot.document.documentId);
  expect(
    omittedContext.revisionId,
    "Oversized fallback should keep revision id.",
  ).toBe(snapshot.document.revisionId);
  expect(
    "omittedReason" in omittedContext,
    "Oversized fallback should explain why the payload is absent.",
  ).toBeTruthy();
  expect(
    "document" in omittedContext,
    "Oversized fallback should not attach the full document.",
  ).toBeFalsy();

  clearActiveDocumentTelemetryContext();
  expect(
    getErrorReporterTelemetryContext().activeDocument.availability,
    "Clearing telemetry context should mark the active document unavailable.",
  ).toBe("unavailable");
});
