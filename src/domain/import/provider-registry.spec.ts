import { test, expect } from "vitest";

import type { ImportProvider } from "@/contracts/import/provider";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import { createScopedImportProviderRegistryForTest } from "@/domain/extensions/test-registry-composition";

test("src/domain/import/provider-registry.spec.ts", async () => {
  const pngProvider: ImportProvider<
    { name: string },
    { planeKey: string | null }
  > = {
    id: "png-import",
    label: "PNG Import",
    acceptedFileTypes: [{ extension: "png", mediaType: "image/png" }],
    accepts(source) {
      return source.mediaType === "image/png";
    },
    async review(input) {
      return {
        providerReview: { name: input.source.name },
        diagnostics: [],
        proposedActionKinds: ["commitSketch"],
      };
    },
    createDefaultSelections() {
      return { planeKey: null };
    },
    getReviewFormSchema() {
      return { sections: [] };
    },
    applySelectionPatch(_review, selections) {
      return selections;
    },
    async prepare() {
      return { diagnostics: [] };
    },
  };
  const duplicatePngProvider = {
    ...pngProvider,
    label: "Duplicate PNG Import",
  };
  const stepProvider: ImportProvider<
    { name: string },
    { planeKey: string | null }
  > = {
    ...pngProvider,
    id: "step-import",
    label: "STEP Import",
    acceptedFileTypes: [{ extension: "step", mediaType: "model/step" }],
    accepts(source) {
      return source.mediaType === "model/step";
    },
  };

  const registry = createScopedImportProviderRegistryForTest([
    pngProvider,
    duplicatePngProvider,
    stepProvider,
  ]);

  expect(
    registry.getAll().length,
    "Import registry should dedupe providers by id.",
  ).toBe(2);
  expect(
    registry.getById("png-import"),
    "Import registry should resolve providers by id.",
  ).toBe(pngProvider);
  expect(
    registry
      .getAcceptedFileTypes()
      .some(
        (entry) => entry.extension === "png" && entry.mediaType === "image/png",
      ),
    "Import registry should expose accepted file types from its explicit composition.",
  ).toBeTruthy();
  expect(
    registry.matchProviders({
      name: "fixture.png",
      origin: { kind: "localFile", fileName: "fixture.png" },
      mediaType: "image/png",
      bytes: new Uint8Array([0]),
      fingerprint: `sha256:${"a".repeat(64)}` as const,
    }).length,
    "Import provider matching should be determined by the scoped registry composition.",
  ).toBe(1);

  const isolatedA = createScopedImportProviderRegistryForTest([pngProvider]);
  const isolatedB = createScopedImportProviderRegistryForTest([stepProvider]);

  expect(
    isolatedA.getById("step-import"),
    "Scoped import registries should not leak between tests.",
  ).toBe(null);
  expect(
    isolatedB.getById("png-import"),
    "Scoped import registries should remain isolated.",
  ).toBe(null);

  const review = await pngProvider.review({
    source: {
      name: "fixture.png",
      origin: { kind: "localFile", fileName: "fixture.png" },
      mediaType: "image/png",
      bytes: new Uint8Array([1]),
      fingerprint: `sha256:${"b".repeat(64)}` as const,
    },
    capabilities: {
      context: {
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_import_fixture",
        baseRevisionId: "rev_import_fixture",
      },
      modeling: {
        async bakeGeometry() {
          throw new Error("Not used in provider-registry coverage.");
        },
        async reconstructMeshToBrep() {
          throw new Error("Not used in provider-registry coverage.");
        },
      },
      sketch: {
        async convertVectorToSketch() {
          return {
            plane: createStandardPlaneDefinition("xy"),
            planeTarget: {
              kind: "construction",
              constructionId: "construction_plane-xy",
            },
            planeKey: "xy",
            sketches: [],
          };
        },
      },
      assets: {
        async registerGeometryAsset() {
          throw new Error("Not used in provider-registry coverage.");
        },
        async storeEmbeddedBinary() {
          return "asset_embedded_fixture";
        },
      },
    },
  });

  expect(
    review.providerReview.name,
    "Provider behavior should remain unchanged after registry composition refactor.",
  ).toBe("fixture.png");
});
