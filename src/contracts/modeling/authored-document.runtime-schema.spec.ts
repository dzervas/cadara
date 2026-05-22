import { test, expect } from "vitest";

import { createAuthoredModelDocumentFromSnapshot } from "@/contracts/modeling/authored-document";
import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

test("src/contracts/modeling/authored-document.runtime-schema.spec.ts", async () => {
  const adapter = new MockKernelAdapter();
  const snapshot = (
    await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_workspace",
    })
  ).snapshot;

  const authoredDocument = createAuthoredModelDocumentFromSnapshot(snapshot);
  const parsed = parseAuthoredModelDocument(authoredDocument);
  expect(
    parsed.ok,
    "Authored documents derived from snapshots should validate.",
  ).toBeTruthy();
  expect(
    parsed.ok &&
      parsed.document.features.every((feature) => feature.suppressed === false),
    "Authored documents derived from active snapshot features should persist explicit unsuppressed state.",
  ).toBeTruthy();
  expect(
    parsed.ok && parsed.document.name === snapshot.document.name,
    "Authored documents should preserve the durable document name.",
  ).toBeTruthy();
  expect(
    parsed.ok && parsed.document.assets.records.length === 0,
    "Authored documents should default to an empty geometry asset manifest.",
  ).toBeTruthy();
  expect(
    parsed.ok && parsed.document.embeddedBinaryAssets.length === 0,
    "Authored documents should default to an empty embedded binary asset list.",
  ).toBeTruthy();

  const missingSuppression = structuredClone(authoredDocument) as unknown as {
    features: Array<Record<string, unknown>>;
  };
  delete missingSuppression.features[0]!.suppressed;

  const rejected = parseAuthoredModelDocument(missingSuppression);
  expect(
    rejected.ok,
    "Authored feature records without explicit suppression state should be rejected.",
  ).toBeFalsy();

  const legacyRawAuthoredValue = structuredClone(authoredDocument);
  const extrude = legacyRawAuthoredValue.features.find(
    (feature) => feature.definition.kind === "extrude",
  );
  if (extrude?.definition.kind === "extrude") {
    const end = extrude.definition.parameters.extent.end;
    if (end.kind === "blind") {
      end.distance = 12;
    }
  }

  const rejectedLegacyLiteral = parseAuthoredModelDocument(
    legacyRawAuthoredValue,
  );
  expect(
    rejectedLegacyLiteral.ok,
    "Persisted authored documents should reject legacy raw literals on feature authored-value fields.",
  ).toBeFalsy();
});
