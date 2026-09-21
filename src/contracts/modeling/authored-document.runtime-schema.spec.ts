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

  authoredDocument.topologyLineage = [
    {
      featureId: "feature_extrude-1",
      outputs: [
        {
          outputSlot: "body_feature_extrude-1",
          topologyToken: "topology-lineage-token",
          topology: {
            faceIds: ["face_body_feature_extrude-1_preserved"],
            edgeIds: ["edge_body_feature_extrude-1_preserved"],
            vertexIds: ["vertex_body_feature_extrude-1_preserved"],
          },
          outputWitnesses: ["split-face:a", "split-face:b"],
          sourceTargets: [
            {
              sourceKey: "feature:feature_extrude-1:profile:0:generated-side-face",
              targets: [
                {
                  kind: "edge",
                  bodyId: "body_feature_extrude-1",
                  edgeId: "edge_body_feature_extrude-1_preserved",
                },
              ],
            },
          ],
          unsupportedSourceKeys: [],
        },
      ],
    },
  ];
  const parsedLineage = parseAuthoredModelDocument(authoredDocument);
  expect(parsedLineage.ok && parsedLineage.document.topologyLineage).toEqual(
    authoredDocument.topologyLineage,
  );
  expect(
    parsedLineage.ok && parsedLineage.document.topologyLineage?.[0]?.outputs[0]?.outputWitnesses,
  ).toEqual(["split-face:a", "split-face:b"]);

  const duplicateOutputWitnesses = structuredClone(authoredDocument);
  const duplicatedOutput = structuredClone(
    duplicateOutputWitnesses.topologyLineage![0]!.outputs[0]!,
  );
  duplicatedOutput.outputSlot = "body_other" as never;
  duplicateOutputWitnesses.topologyLineage![0]!.outputs.push(duplicatedOutput);
  expect(
    parseAuthoredModelDocument(duplicateOutputWitnesses).ok,
    "Two persisted outputs with the same witness set must be rejected.",
  ).toBe(false);

  const blankOutputWitness = structuredClone(authoredDocument);
  blankOutputWitness.topologyLineage![0]!.outputs[0]!.outputWitnesses = ["   "];
  expect(
    parseAuthoredModelDocument(blankOutputWitness).ok,
    "Whitespace-only output witnesses must be rejected.",
  ).toBe(false);

  const malformedLineage = structuredClone(authoredDocument);
  malformedLineage.topologyLineage![0]!.outputs[0]!.sourceTargets[0]!.targets[0]!.bodyId =
    "body_wrong_output";
  expect(
    parseAuthoredModelDocument(malformedLineage).ok,
    "Persisted lineage targets outside their declared output must be rejected.",
  ).toBe(false);

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

  const legacyOperationGraph = structuredClone(authoredDocument) as unknown as {
    sketches: Array<{ definition: Record<string, unknown> }>;
  };
  legacyOperationGraph.sketches[0]!.definition.createdGraph = {
    pointIds: ["legacy_point"],
  };
  expect(
    parseAuthoredModelDocument(legacyOperationGraph).ok,
    "Strict file validation must reject removed operation-graph fields before normalization can strip them.",
  ).toBe(false);

  const unsupportedImagePayload = structuredClone(authoredDocument) as unknown as {
    sketches: Array<{ definition: Record<string, unknown> }>;
  };
  unsupportedImagePayload.sketches[0]!.definition.authoredImageData = {
    base64Data: "legacy",
  };
  expect(
    parseAuthoredModelDocument(unsupportedImagePayload).ok,
    "Strict file validation must reject unsupported legacy image fields before normalization.",
  ).toBe(false);

  const malformedSketch = structuredClone(authoredDocument);
  const malformedDefinition = malformedSketch.sketches[0]!.definition;
  const centerPointId = malformedDefinition.pointIds[0]!;
  malformedDefinition.entityIds.push("sketch_entity_malformed_circle");
  malformedDefinition.entities.push({
    kind: "circle",
    entityId: "sketch_entity_malformed_circle",
    label: "Malformed circle",
    target: {
      kind: "sketchEntity",
      sketchId: malformedSketch.sketches[0]!.sketchId,
      entityId: "sketch_entity_malformed_circle",
    },
    isConstruction: false,
    centerPointId,
    radius: -1,
  });
  expect(
    parseAuthoredModelDocument(malformedSketch).ok,
    "Structurally malformed authored geometry must remain rejected.",
  ).toBe(false);
});
