// cadara-3sq.6. Logic lane (docs/testing.md, domain): the model checkpoint
// cache identity is derived from every evaluation input of a complete open
// (document content, asset bytes, settings, diagnostics, build), never from
// the per-session document id, and refuses inputs it cannot fingerprint.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { ModelCheckpointStore } from "@/domain/modeling/model-checkpoint-store";
import { createModelCheckpointKey } from "@/domain/modeling/occ/model-checkpoint";

const bracket = JSON.parse(
  await readFile(
    new URL(
      "../../../../landing/examples/bracket/model.cadara",
      import.meta.url,
    ),
    "utf8",
  ),
) as AuthoredModelDocument;

function storeFor(compatibility: string | null): ModelCheckpointStore {
  return {
    compatibility: async () => compatibility,
    read: async () => null,
    publish: async () => undefined,
    report: () => undefined,
  };
}

type KeyInput = Parameters<typeof createModelCheckpointKey>[1];
function input(overrides: Partial<KeyInput> = {}): KeyInput {
  return {
    document: structuredClone(bracket),
    diagnostics: [],
    assetBlobs: new Map(),
    hasBakedBodyAssets: false,
    evaluationSettings: { modelingTolerance: 1e-6 },
    ...overrides,
  };
}

async function key(
  overrides: Partial<KeyInput> = {},
  compatibility: string | null = "build-1",
) {
  return createModelCheckpointKey(storeFor(compatibility), input(overrides));
}

function edited(
  edit: (document: AuthoredModelDocument & Record<string, unknown>) => void,
) {
  const document = structuredClone(bracket) as AuthoredModelDocument &
    Record<string, unknown>;
  edit(document);
  return document;
}

describe("model checkpoint cache identity", () => {
  it("is a stable content digest that ignores only the session document id", async () => {
    const base = await key();
    expect(base).toEqual({ key: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await key()).toEqual(base);
    expect(
      await key({
        document: edited((document) => {
          document.documentId = "doc_other" as never;
        }),
      }),
    ).toEqual(base);
  });

  it.each<
    [
      string,
      (document: AuthoredModelDocument & Record<string, unknown>) => void,
    ]
  >([
    [
      "a feature parameter (same ids and revision)",
      (document) => {
        (
          document.features[0]!.definition.parameters as unknown as {
            extent: { end: { distance: { value: number } } };
          }
        ).extent.end.distance.value += 1;
      },
    ],
    [
      "the revision id",
      (document) => {
        document.revisionId = "rev_9999" as never;
      },
    ],
    [
      "the document name",
      (document) => {
        document.name = `${document.name} copy`;
      },
    ],
    [
      "a body label",
      (document) => {
        document.bodyLabels[0]!.label = "Other";
      },
    ],
    [
      "the settings",
      (document) => {
        document.settings = {
          ...document.settings,
          modelingTolerance: document.settings.modelingTolerance * 2,
        };
      },
    ],
    [
      "the variables",
      (document) => {
        document.variables = [
          ...document.variables,
          {
            variableId: "variable_extra",
            name: "extra",
            expression: "1 mm",
          } as never,
        ];
      },
    ],
    [
      "the cursor",
      (document) => {
        document.cursor = {
          kind: "feature",
          featureId: document.featureOrder[3]!,
        } as never;
      },
    ],
    [
      "a suppression",
      (document) => {
        (
          document.features[1] as unknown as Record<string, unknown>
        ).suppressed = true;
      },
    ],
    [
      "the feature order",
      (document) => {
        document.featureOrder = [...document.featureOrder].reverse();
      },
    ],
    [
      "the topology lineage",
      (document) => {
        document.topologyLineage = {
          ...document.topologyLineage,
          extra: true,
        } as never;
      },
    ],
    [
      "a sketch",
      (document) => {
        document.sketches = document.sketches.slice(1);
      },
    ],
  ])("changes with %s", async (_name, edit) => {
    expect(await key({ document: edited(edit) })).not.toEqual(await key());
  });

  it("changes with restore diagnostics, evaluation settings and the build", async () => {
    const base = await key();
    const diagnostic = {
      code: "x",
      message: "x",
      severity: "warning",
    } as unknown as ModelingDiagnostic;
    expect(await key({ diagnostics: [diagnostic] })).not.toEqual(base);
    expect(
      await key({ evaluationSettings: { modelingTolerance: 1e-5 } }),
    ).not.toEqual(base);
    expect(await key({}, "build-2")).not.toEqual(base);
  });

  it("fingerprints geometry assets by their actual bytes, not their recorded hash", async () => {
    const hash = "sha256:recorded";
    const document = edited((value) => {
      value.assets = { ...value.assets, records: [{ hash } as never] };
    });
    const first = await key({
      document,
      assetBlobs: new Map([[hash, new Uint8Array([1, 2, 3])]]),
    });
    const changed = await key({
      document,
      assetBlobs: new Map([[hash, new Uint8Array([1, 2, 4])]]),
    });
    expect(first).toHaveProperty("key");
    expect(changed).toHaveProperty("key");
    expect(changed).not.toEqual(first);
    expect(await key({ document })).toEqual({
      bypass: "unresolved-geometry-asset",
    });
  });

  it("bypasses inputs it cannot fingerprint", async () => {
    expect(await key({ hasBakedBodyAssets: true })).toEqual({
      bypass: "baked-body-assets",
    });
    expect(await key({}, null)).toEqual({ bypass: "unfingerprinted-runtime" });
  });
});
