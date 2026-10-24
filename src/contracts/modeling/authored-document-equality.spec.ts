import { expect, it } from "vitest";
import type {
  AuthoredModelDocument,
  AuthoredTopologyLineageOutput,
} from "./authored-document";
import {
  authoredModelDocumentsEqual,
  classifyAuthoredModelDocumentChange,
} from "./authored-document-equality";
import {
  createRebuiltTopologyLineage,
  createSeedAuthoredModelDocument,
} from "@/domain/modeling/modeling-test-fixtures";

// Logic contract seam: the shared certification equality that decides whether
// a repository receipt represents a runtime export.
type Variant = (document: AuthoredModelDocument) => void;
const output = (
  document: AuthoredModelDocument,
): AuthoredTopologyLineageOutput =>
  document.topologyLineage!.find((record) => record.outputs.length)!
    .outputs[0]!;
const withSecondOutput: Variant = (document) => {
  document
    .topologyLineage!.find((record) => record.outputs.length)!
    .outputs.push({
      ...structuredClone(output(document)),
      outputSlot: "body_other",
      sourceTargets: [],
    });
};
const withTwoTargets: Variant = (document) => {
  output(document).sourceTargets[0]!.targets.push({
    kind: "edge",
    bodyId: output(document).outputSlot,
    edgeId: "edge_stable_a",
  });
};

/** Both documents start from the rebuilt keyed-lineage fixture; `shared`
 * applies to both, `change` only to the right-hand document. */
async function pair(change: Variant, shared: Variant = () => undefined) {
  const seed = await createSeedAuthoredModelDocument();
  const left = {
    ...seed,
    topologyLineage: createRebuiltTopologyLineage(seed).rebuilt,
  };
  shared(left);
  const right = structuredClone(left);
  change(right);
  expect(JSON.stringify(right), "the variant changes the document").not.toBe(
    JSON.stringify(left),
  );
  return [left, right] as const;
}

it.each<[string, Variant, Variant?]>([
  ["lineage records", (d) => void d.topologyLineage!.reverse()],
  [
    "outputs",
    (d) =>
      void d.topologyLineage!.find((r) => r.outputs.length)!.outputs.reverse(),
    withSecondOutput,
  ],
  ["source targets", (d) => void output(d).sourceTargets.reverse()],
])(
  "certifies documents whose keyed topology %s differ only in order",
  async (_, change, shared) => {
    const [left, right] = await pair(change, shared);
    expect(authoredModelDocumentsEqual(left, right)).toBe(true);
  },
);

it.each<[string, Variant, Variant?]>([
  [
    "a changed source key",
    (d) => void (output(d).sourceTargets[0]!.sourceKey = "source:fallback:h1"),
  ],
  [
    "a changed target identity",
    (d) =>
      void Object.assign(output(d).sourceTargets[1]!.targets[0]!, {
        edgeId: "edge_stable_b",
      }),
  ],
  [
    "reordered targets of one source",
    (d) => void output(d).sourceTargets[0]!.targets.reverse(),
    withTwoTargets,
  ],
  [
    "a changed native output witness",
    (d) => void (output(d).outputWitnesses = ["witness:other"]),
  ],
  [
    "reordered output topology ids",
    (d) => void output(d).topology.edgeIds.reverse(),
  ],
  [
    "reordered unsupported source keys",
    (d) => void output(d).unsupportedSourceKeys.reverse(),
    (d) => void (output(d).unsupportedSourceKeys = ["source:x", "source:y"]),
  ],
  ["a removed lineage record", (d) => void d.topologyLineage!.pop()],
  ["a changed revision", (d) => void (d.revisionId = "rev_9999")],
  ["reordered feature order", (d) => void d.featureOrder.reverse()],
  ["reordered history order", (d) => void d.historyOrder.reverse()],
  [
    "reordered sketch points",
    (d) => void d.sketches[0]!.definition.points.reverse(),
  ],
])("distinguishes %s", async (_, change, shared) => {
  const [left, right] = await pair(change, shared);
  expect(authoredModelDocumentsEqual(left, right)).toBe(false);
});

// cadara-xkg: the metadata-only classifier that lets Undo/Redo of a body
// rename or recolour skip the full restore.
const secondBody: Variant = (d) => {
  d.bodyLabels.push({ bodyId: "body_other", label: "Other" });
  d.bodyAppearances?.push({
    bodyId: "body_other",
    appearance: { kind: "palette", slot: 1 },
  });
};

it("classifies body label and colour changes as body metadata", async () => {
  const [left, right] = await pair((d) => {
    d.revisionId = "rev_9999";
    d.bodyLabels[1]!.label = "Renamed";
    d.bodyAppearances![0]!.appearance = { kind: "custom", hex: "#123abc" };
  }, secondBody);
  expect(classifyAuthoredModelDocumentChange(left, right)).toEqual({
    kind: "bodyMetadata",
    bodyLabels: [right.bodyLabels[1]],
    bodyAppearances: [right.bodyAppearances![0]],
  });
});

it("classifies a revision-only difference as the same content", async () => {
  const [left, right] = await pair((d) => void (d.revisionId = "rev_9999"));
  expect(classifyAuthoredModelDocumentChange(left, right)).toEqual({
    kind: "sameContent",
  });
});

// A repository materializes keyed sketch and feature records in its own order.
it("ignores the record order of sketches and features", async () => {
  const [left, right] = await pair(
    (d) => {
      d.sketches.reverse();
      d.features.reverse();
      d.bodyLabels[0]!.label = "Renamed";
    },
    (d) => {
      d.sketches.push({
        ...structuredClone(d.sketches[0]!),
        sketchId: "sketch_other",
      });
      d.historyOrder.push({ kind: "sketch", sketchId: "sketch_other" });
    },
  );
  expect(classifyAuthoredModelDocumentChange(left, right)).toMatchObject({
    kind: "bodyMetadata",
    bodyLabels: [{ label: "Renamed" }],
  });
});

it.each<[string, Variant, Variant?]>([
  ["a feature label", (d) => void (d.features[0]!.label = "Relabelled")],
  ["a sketch label", (d) => void (d.sketches[0]!.label = "Relabelled")],
  ["the document name", (d) => void (d.name = "Renamed document")],
  [
    "a body label next to a geometric change",
    (d) => {
      d.bodyLabels[0]!.label = "Renamed";
      d.featureOrder.reverse();
    },
  ],
  ["an added body label", secondBody],
  ["reordered body labels", (d) => void d.bodyLabels.reverse(), secondBody],
  ["dropped body colours", (d) => void delete d.bodyAppearances],
])("classifies %s as an authored change", async (_, change, shared) => {
  const [left, right] = await pair(change, shared);
  expect(classifyAuthoredModelDocumentChange(left, right)).toEqual({
    kind: "authored",
  });
});
