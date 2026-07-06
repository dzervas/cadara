import { test, expect } from "vitest";

import type { ImportCapabilities } from "@/contracts/import/capabilities";
import type { ResolvedImportSource } from "@/contracts/import/source";
import { validateImportPreparedActions } from "@/contracts/import/validation";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createBuiltinImportProviderRegistry } from "@/domain/import/builtin-provider-composition";
import { assembleFixtureCaptureBundle } from "@/cli/commands/onshape-capture/fixtures/capture-bundle-fixture";
import { onshapeImportProvider } from "@/domain/import/onshape/provider";

function sourceFromBundle(bundle: unknown): ResolvedImportSource {
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  return {
    name: "mounts.onshape-capture.json",
    origin: { kind: "localFile", fileName: "mounts.onshape-capture.json" },
    mediaType: "application/json",
    bytes,
    fingerprint: `sha256:${"a".repeat(64)}`,
  };
}

const capabilities: ImportCapabilities = {
  context: {
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
  },
  modeling: {
    async bakeGeometry() {
      throw new Error("not used");
    },
    async reconstructMeshToBrep() {
      throw new Error("not used");
    },
  },
  sketch: {
    async convertVectorToSketch() {
      throw new Error("not used");
    },
  },
  assets: {
    async registerGeometryAsset() {
      throw new Error("not used");
    },
    async storeEmbeddedBinary() {
      throw new Error("not used");
    },
  },
  // history probe intentionally absent (probe-less v1).
};

test("src/domain/import/onshape/provider.spec.ts registration and acceptance", async () => {
  const registry = createBuiltinImportProviderRegistry();
  const bundle = await assembleFixtureCaptureBundle();
  const source = sourceFromBundle(bundle);

  const matches = registry.matchProviders(source);
  expect(
    matches.some((provider) => provider.id === "onshape-capture-bundle"),
    "The Onshape provider should be registered and match .onshape-capture.json sources.",
  ).toBeTruthy();
  expect(
    registry
      .getAcceptedFileTypes()
      .some((type) => type.extension === "onshape-capture.json"),
    "The bundle extension should be advertised as an accepted import file type.",
  ).toBeTruthy();
});

test("src/domain/import/onshape/provider.spec.ts review -> prepare pipeline", async () => {
  const bundle = await assembleFixtureCaptureBundle();
  const source = sourceFromBundle(bundle);

  const review = await onshapeImportProvider.review({ source, capabilities });
  expect(
    review.providerReview.valid && review.providerReview.studios.length === 2,
    "Review should validate the bundle and surface both Part Studios.",
  ).toBeTruthy();

  const selections = onshapeImportProvider.createDefaultSelections(review);
  const schema = onshapeImportProvider.getReviewFormSchema(review, selections);
  expect(
    schema.sections.some((section) => section.id === "fidelity-report"),
    "The review form should include a per-feature fidelity report section.",
  ).toBeTruthy();
  expect(
    schema.sections.some((section) => section.id === "verification"),
    "The review form should surface verification status.",
  ).toBeTruthy();

  const actions = await onshapeImportProvider.prepare({
    source,
    review,
    selections,
    capabilities,
  });

  expect(
    validateImportPreparedActions(actions).success,
    "Prepared actions (including the ordered sequence) should satisfy the contract invariants.",
  ).toBeTruthy();

  const orderedCount = actions.orderedActions?.length ?? 0;
  const totalActions =
    (actions.addDocumentVariables?.length ?? 0) +
    (actions.commitSketches?.length ?? 0);
  expect(
    orderedCount === totalActions,
    "Every emitted parametric action should appear in the ordered sequence.",
  ).toBeTruthy();

  expect(
    actions.binding?.kind === "localFile" &&
      actions.binding.fingerprint === source.fingerprint,
    "Prepare should attach a local-file binding carrying the bundle fingerprint.",
  ).toBeTruthy();

  expect(
    actions.diagnostics?.some(
      (diagnostic) => diagnostic.code === "onshape-fidelity-summary",
    ),
    "Prepare should emit an honest per-tier fidelity summary diagnostic.",
  ).toBeTruthy();

  const invalidSource: ResolvedImportSource = {
    ...source,
    bytes: new TextEncoder().encode("{ not a bundle }"),
  };
  const invalidReview = await onshapeImportProvider.review({
    source: invalidSource,
    capabilities,
  });
  expect(
    !invalidReview.providerReview.valid &&
      invalidReview.diagnostics.some(
        (diagnostic) => diagnostic.code === "onshape-bundle-invalid",
      ),
    "An invalid bundle should fail review with a structured diagnostic and no studios.",
  ).toBeTruthy();
});
