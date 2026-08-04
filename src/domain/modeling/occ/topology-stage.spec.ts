import { expect, test } from "vitest";

import type {
  AuthoredFeatureTopologyLineage,
  AuthoredTopologyLineageOutput,
} from "@/contracts/modeling/authored-document";
import type { BodyId, EdgeId, FaceId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { DocumentHistoryOrderEntry } from "@/domain/modeling/document-history";
import {
  getOccDurableRefKey,
  type OccTrackedBody,
} from "@/domain/modeling/occ/topology";
import {
  createExactSuccessorTopologyStage,
  createOccFeatureTopologyLineageMap,
  createOccTopologyProvenanceIndex,
  formatExactSuccessorTopologySourceKey,
  formatCompositeTopologyProvenanceId,
  formatGeneratedAdjacencyTopologySourceKey,
  formatGeneratedFaceCompleteBoundaryTopologySourceKey,
  formatGeneratedProducerTopologySourceKey,
  formatMirrorOperandTopologySourceKey,
  type OccFeatureTopologyStage,
} from "@/domain/modeling/occ/topology-stage";
import { classifySemanticStageTopology } from "@/domain/modeling/occ/topology-naming";

const bodyId = "body_provenance" as BodyId;

function face(faceId: string, ownerBodyId = bodyId) {
  return {
    kind: "face" as const,
    bodyId: ownerBodyId,
    faceId: faceId as FaceId,
  };
}

function stage(
  featureId: FeatureId,
  target: Extract<DurableRef, { kind: "face" }>,
  sourceKey: string,
): OccFeatureTopologyStage {
  const body = {
    bodyId: target.bodyId,
    topologyToken: `token_${featureId}`,
    topology: { faceIds: [target.faceId], edgeIds: [], vertexIds: [] },
  } as unknown as OccTrackedBody;
  return {
    featureId,
    outputs: new Map([
      [
        target.bodyId,
        {
          outputSlot: target.bodyId,
          body,
          sourceTargets: new Map([[sourceKey, [target]]]),
          unsupportedSourceKeys: new Set(),
        },
      ],
    ]),
  };
}

function history(...featureIds: FeatureId[]): DocumentHistoryOrderEntry[] {
  return featureIds.map((featureId) => ({ kind: "feature", featureId }));
}

function persistedOutput(
  target: Extract<DurableRef, { kind: "face" }>,
  sourceKey: string,
): AuthoredTopologyLineageOutput {
  return {
    outputSlot: target.bodyId,
    topologyToken: "t0001",
    topology: { faceIds: [target.faceId], edgeIds: [], vertexIds: [] },
    sourceTargets: [{ sourceKey, targets: [target] }],
    unsupportedSourceKeys: [],
  };
}

test("exact successor stages publish fused source claims for provenance composition", () => {
  const rootFirstFeatureId = "feature_exact_successor_root_first" as FeatureId;
  const rootSecondFeatureId = "feature_exact_successor_root_second" as FeatureId;
  const featureId = "feature_exact_successor_convergence" as FeatureId;
  const sourceBody = {
    bodyId,
    topologyToken: "t0001",
    topology: { faceIds: ["face_source_a", "face_source_b"], edgeIds: [], vertexIds: [] },
  } as unknown as OccTrackedBody;
  const outputBody = {
    bodyId,
    topologyToken: "t0002",
    topology: { faceIds: ["face_output"], edgeIds: [], vertexIds: [] },
  } as unknown as OccTrackedBody;
  const sourceA = face("face_source_a");
  const sourceB = face("face_source_b");
  const outputFace = face("face_output");
  const manyStage = createExactSuccessorTopologyStage({
    featureId,
    sourceBody,
    outputBody,
    successorsBySourceKey: new Map([
      [getOccDurableRefKey(sourceA), outputFace],
      [getOccDurableRefKey(sourceB), outputFace],
    ]),
  }).outputs.get(bodyId)!;
  const zeroStage = createExactSuccessorTopologyStage({
    featureId,
    sourceBody,
    outputBody,
    successorsBySourceKey: new Map(),
  }).outputs.get(bodyId)!;

  expect(manyStage.sourceTargets.size).toBe(2);
  expect(manyStage.unsupportedSourceKeys).toEqual(new Set());
  expect(zeroStage.sourceTargets.size).toBe(0);
  expect(zeroStage.unsupportedSourceKeys.size).toBe(2);
  expect(
    createOccTopologyProvenanceIndex({
      stages: new Map([
        [rootFirstFeatureId, stage(rootFirstFeatureId, sourceA, "root:first")],
        [rootSecondFeatureId, stage(rootSecondFeatureId, sourceB, "root:second")],
        [featureId, { featureId, outputs: new Map([[bodyId, manyStage]]) }],
      ]),
      previousLineage: new Map(),
      historyOrder: history(rootFirstFeatureId, rootSecondFeatureId, featureId),
    }).resolveFace(outputFace),
  ).toBe(
    formatCompositeTopologyProvenanceId({
      sourceCanonicalProvenanceIds: ["root:first", "root:second"],
    }),
  );
});


test("topology provenance follows same-ID exact predecessors through decreasing history", () => {
  const rootFeatureId = "feature_same_id_root" as FeatureId;
  const rewriteFeatureId = "feature_same_id_rewrite" as FeatureId;
  const reusedFace = face("face_reused_across_stages");
  const rootSourceKey = "extrude:feature_same_id_root:profile:0:side";
  const rewriteSourceKey = formatExactSuccessorTopologySourceKey({
    featureId: rewriteFeatureId,
    bodyId,
    kind: "face",
    sourcePublicId: reusedFace.faceId,
  });

  expect(
    createOccTopologyProvenanceIndex({
      stages: new Map([
        [rootFeatureId, stage(rootFeatureId, reusedFace, rootSourceKey)],
        [rewriteFeatureId, stage(rewriteFeatureId, reusedFace, rewriteSourceKey)],
      ]),
      previousLineage: new Map(),
      historyOrder: history(rootFeatureId, rewriteFeatureId),
    }).resolveFace(reusedFace),
  ).toBe(rootSourceKey);
});

test("supplemental Mirror operand claims converge with target-side topology", () => {
  const featureId = "feature_mirror_operand_preservation" as FeatureId;
  const sourceBody = {
    bodyId,
    topologyToken: "t0001",
    topology: { faceIds: ["face_source"], edgeIds: [], vertexIds: [] },
  } as unknown as OccTrackedBody;
  const outputBody = {
    bodyId,
    topologyToken: "t0002",
    topology: { faceIds: ["face_output"], edgeIds: [], vertexIds: [] },
  } as unknown as OccTrackedBody;
  const output = face("face_output");
  const mirrorKey = formatMirrorOperandTopologySourceKey({
    featureId,
    bodyId,
    role: "right",
    sourceCanonicalProvenanceIds: ["extrude:feature_seed:profile:0:side"],
  });
  const outputStage = createExactSuccessorTopologyStage({
    featureId,
    sourceBody,
    outputBody,
    successorsBySourceKey: new Map([
      [getOccDurableRefKey(face("face_source")), output],
    ]),
    supplementalProducerTargetsBySourceKey: new Map([[mirrorKey, output]]),
  }).outputs.get(bodyId)!;

  expect(outputStage.sourceTargets.has(mirrorKey)).toBe(true);
  expect(outputStage.unsupportedSourceKeys.has(mirrorKey)).toBe(false);
  expect(outputStage.sourceTargets.size).toBe(2);
});

test("Mirror operand provenance survives serialization and rejects remintable keys", () => {
  const featureId = "feature_mirror_operand_provenance" as FeatureId;
  const target = face("face_mirror_operand_output");
  const sourceKey = formatMirrorOperandTopologySourceKey({
    featureId,
    bodyId,
    role: "mixed",
    sourceCanonicalProvenanceIds: [
      "extrude:feature_seed:profile:0:side-a",
      "extrude:feature_seed:profile:0:side-b",
    ],
  });
  expect(
    createOccTopologyProvenanceIndex({
      stages: new Map([[featureId, stage(featureId, target, sourceKey)]]),
      previousLineage: new Map(),
      historyOrder: history(featureId),
    }).resolveFace(target),
  ).toBe(sourceKey);
  expect(() =>
    createOccTopologyProvenanceIndex({
      stages: new Map([
        [
          featureId,
          stage(
            featureId,
            target,
            `mirror-operand:${featureId}:${bodyId}:right:face%3A${bodyId}%3Aface_reminted`,
          ),
        ],
      ]),
      previousLineage: new Map(),
      historyOrder: history(featureId),
    }).resolveFace(target),
  ).toThrow(/malformed-source-key/);
});

test("topology provenance resolves exact, boolean, and generated relationships transitively", () => {
  const rootFeature = "feature_provenance_root" as FeatureId;
  const booleanFeature = "feature_provenance_boolean" as FeatureId;
  const generatedFeature = "feature_provenance_generated" as FeatureId;
  const exactFeature = "feature_provenance_exact" as FeatureId;
  const root = face("face_root");
  const booleanResult = face("face_boolean_reminted");
  const generatedResult = face("face_generated_reminted");
  const exactResult = face("face_exact_reminted");
  const rootKey =
    "extrude:feature_provenance_root:profile:0:generated-side-face";
  const generatedKey = formatGeneratedProducerTopologySourceKey({
    featureId: generatedFeature,
    bodyId,
    sourceKind: "face",
    sourcePublicId: booleanResult.faceId,
    role: "generated-face",
  });
  const stages = new Map([
    [rootFeature, stage(rootFeature, root, rootKey)],
    [
      booleanFeature,
      stage(
        booleanFeature,
        booleanResult,
        `boolean:${booleanFeature}:input:face:${bodyId}:${root.faceId}`,
      ),
    ],
    [generatedFeature, stage(generatedFeature, generatedResult, generatedKey)],
    [
      exactFeature,
      stage(
        exactFeature,
        exactResult,
        formatExactSuccessorTopologySourceKey({
          featureId: exactFeature,
          bodyId,
          kind: "face",
          sourcePublicId: generatedResult.faceId,
        }),
      ),
    ],
  ]);
  const index = createOccTopologyProvenanceIndex({
    stages,
    previousLineage: new Map(),
    historyOrder: history(
      rootFeature,
      booleanFeature,
      generatedFeature,
      exactFeature,
    ),
  });

  expect(index.resolveFace(exactResult)).toBe(
    formatGeneratedProducerTopologySourceKey({
      featureId: generatedFeature,
      bodyId,
      sourceKind: "face",
      sourcePublicId: encodeURIComponent(rootKey) as FaceId,
      role: "generated-face",
    }),
  );
});

test("topology provenance canonicalizes generated adjacency from transitive face roots", () => {
  const rootFeature = "feature_adjacency_root" as FeatureId;
  const adjacencyFeature = "feature_adjacency" as FeatureId;
  const first = face("face_adjacency_first");
  const second = face("face_adjacency_second");
  const result = face("face_adjacency_result");
  const firstRoot = "extrude:feature_adjacency_root:first-face";
  const secondRoot = "extrude:feature_adjacency_root:last-face";
  const rootStage = stage(rootFeature, first, firstRoot);
  const rootOutput = rootStage.outputs.get(bodyId)!;
  rootStage.outputs = new Map([
    [
      bodyId,
      {
        ...rootOutput,
        body: {
          ...rootOutput.body,
          topology: {
            ...rootOutput.body.topology,
            faceIds: [first.faceId, second.faceId],
          },
        },
        sourceTargets: new Map([
          [firstRoot, [first]],
          [secondRoot, [second]],
        ]),
      },
    ],
  ]);
  const firstExact = formatExactSuccessorTopologySourceKey({
    featureId: adjacencyFeature,
    bodyId,
    kind: "face",
    sourcePublicId: first.faceId,
  });
  const secondExact = formatExactSuccessorTopologySourceKey({
    featureId: adjacencyFeature,
    bodyId,
    kind: "face",
    sourcePublicId: second.faceId,
  });
  const adjacencyKey = formatGeneratedAdjacencyTopologySourceKey({
    featureId: adjacencyFeature,
    bodyId,
    adjacentSourceKeys: [secondExact, firstExact],
    role: "generated-edge",
  });
  const index = createOccTopologyProvenanceIndex({
    stages: new Map([
      [rootFeature, rootStage],
      [adjacencyFeature, stage(adjacencyFeature, result, adjacencyKey)],
    ]),
    previousLineage: new Map(),
    historyOrder: history(rootFeature, adjacencyFeature),
  });

  expect(index.resolveFace(result)).toBe(
    formatGeneratedAdjacencyTopologySourceKey({
      featureId: adjacencyFeature,
      bodyId,
      adjacentSourceKeys: [firstRoot, secondRoot],
      role: "generated-edge",
    }),
  );
});

test("topology provenance resolves exact convergence and refuses missing lineage, future references, malformed keys, and cycles", () => {
  const firstFeature = "feature_refusal_first" as FeatureId;
  const secondFeature = "feature_refusal_second" as FeatureId;
  const target = face("face_refusal_target");
  const ambiguousStage = stage(firstFeature, target, "root:first");
  const output = ambiguousStage.outputs.get(bodyId)!;
  ambiguousStage.outputs = new Map([
    [
      bodyId,
      {
        ...output,
        sourceTargets: new Map([
          ["root:first", [target]],
          ["root:second", [target]],
        ]),
      },
    ],
  ]);
  expect(
    createOccTopologyProvenanceIndex({
      stages: new Map([[firstFeature, ambiguousStage]]),
      previousLineage: new Map(),
      historyOrder: history(firstFeature),
    }).resolveFace(target),
  ).toBe(
    formatCompositeTopologyProvenanceId({
      sourceCanonicalProvenanceIds: ["root:first", "root:second"],
    }),
  );

  const missing = face("face_missing");
  const missingStage = stage(
    secondFeature,
    target,
    formatExactSuccessorTopologySourceKey({
      featureId: secondFeature,
      bodyId,
      kind: "face",
      sourcePublicId: missing.faceId,
    }),
  );
  expect(() =>
    createOccTopologyProvenanceIndex({
      stages: new Map([[secondFeature, missingStage]]),
      previousLineage: new Map(),
      historyOrder: history(firstFeature, secondFeature),
    }).resolveFace(target),
  ).toThrow(/provenance-missing/);

  const futureStage = stage(secondFeature, missing, "root:future");
  const firstStage = stage(
    firstFeature,
    target,
    formatExactSuccessorTopologySourceKey({
      featureId: firstFeature,
      bodyId,
      kind: "face",
      sourcePublicId: missing.faceId,
    }),
  );
  expect(() =>
    createOccTopologyProvenanceIndex({
      stages: new Map([
        [firstFeature, firstStage],
        [secondFeature, futureStage],
      ]),
      previousLineage: new Map(),
      historyOrder: history(firstFeature, secondFeature),
    }).resolveFace(target),
  ).toThrow(/future-stage-reference/);

  expect(() =>
    createOccTopologyProvenanceIndex({
      stages: new Map([
        [firstFeature, stage(firstFeature, target, "exact-successor:broken")],
      ]),
      previousLineage: new Map(),
      historyOrder: history(firstFeature),
    }).resolveFace(target),
  ).toThrow(/malformed-source-key/);

  expect(() =>
    createOccTopologyProvenanceIndex({
      stages: new Map([
        [
          firstFeature,
          stage(
            firstFeature,
            target,
            "extrude:feature_refusal_first:face-profile:face:body_source:face_reminted",
          ),
        ],
      ]),
      previousLineage: new Map(),
      historyOrder: history(firstFeature),
    }).resolveFace(target),
  ).toThrow(/remintable-root/);

  const cycleStage = stage(
    firstFeature,
    target,
    formatExactSuccessorTopologySourceKey({
      featureId: firstFeature,
      bodyId,
      kind: "face",
      sourcePublicId: target.faceId,
    }),
  );
  expect(() =>
    createOccTopologyProvenanceIndex({
      stages: new Map([[firstFeature, cycleStage]]),
      previousLineage: new Map(),
      historyOrder: history(firstFeature),
    }).resolveFace(target),
  ).toThrow(/provenance-cycle/);
});

test("topology provenance restores transitive canonical roots from serialized lineage fallback", () => {
  const rootFeatureId = "feature_restored_provenance_root" as FeatureId;
  const exactFeatureId = "feature_restored_provenance_exact" as FeatureId;
  const root = face("face_restored_provenance_root");
  const target = face("face_restored_provenance_reminted");
  const rootKey =
    "extrude:feature_restored_provenance_root:profile:0:last-face";
  const records: AuthoredFeatureTopologyLineage[] = [
    {
      featureId: rootFeatureId,
      outputs: [persistedOutput(root, rootKey)],
    },
    {
      featureId: exactFeatureId,
      outputs: [
        persistedOutput(
          target,
          formatExactSuccessorTopologySourceKey({
            featureId: exactFeatureId,
            bodyId,
            kind: "face",
            sourcePublicId: root.faceId,
          }),
        ),
      ],
    },
  ];
  const index = createOccTopologyProvenanceIndex({
    stages: new Map(),
    previousLineage: createOccFeatureTopologyLineageMap(records),
    historyOrder: history(rootFeatureId, exactFeatureId),
  });

  expect(index.resolveFace(target)).toBe(rootKey);
});


test("topology provenance dedupes a feature's duplicate output bookkeeping", () => {
  const featureId = "feature_duplicate_output_bookkeeping" as FeatureId;
  const target = face("face_duplicate_output_bookkeeping");
  const sourceKey = "extrude:feature_duplicate_output_bookkeeping:profile:0:first-face";
  const first = stage(featureId, target, sourceKey);
  const firstOutput = first.outputs.get(bodyId)!;
  const duplicateOutput = {
    ...firstOutput,
    outputSlot: target.bodyId,
  };
  first.outputs = new Map([
    [target.bodyId, firstOutput],
    ["body_duplicate_output_bookkeeping" as BodyId, duplicateOutput],
  ]);

  expect(
    createOccTopologyProvenanceIndex({
      stages: new Map([[featureId, first]]),
      previousLineage: new Map(),
      historyOrder: history(featureId),
    }).resolveFace(target),
  ).toBe(sourceKey);
});


test("topology provenance composes converging exact source claims independently of insertion order", () => {
  const featureId = "feature_converging_output_bookkeeping" as FeatureId;
  const target = face("face_converging_output_bookkeeping");
  const expected = formatCompositeTopologyProvenanceId({
    sourceCanonicalProvenanceIds: ["root:first", "root:second"],
  });
  const resolve = (sourceTargets: ReadonlyMap<string, readonly DurableRef[]>) => {
    const output = stage(featureId, target, "root:placeholder").outputs.get(bodyId)!;
    return createOccTopologyProvenanceIndex({
      stages: new Map([
        [
          featureId,
          {
            featureId,
            outputs: new Map([
              [
                bodyId,
                {
                  ...output,
                  sourceTargets,
                  unsupportedSourceKeys: new Set(),
                },
              ],
            ]),
          },
        ],
      ]),
      previousLineage: new Map(),
      historyOrder: history(featureId),
    }).resolveFace(target);
  };

  expect(resolve(new Map([["root:first", [target]], ["root:second", [target]]]))).toBe(
    expected,
  );
  expect(resolve(new Map([["root:second", [target]], ["root:first", [target]]]))).toBe(
    expected,
  );
});

test("topology provenance leaves mixed exact and unsupported convergence missing", () => {
  const featureId = "feature_unsupported_output_convergence" as FeatureId;
  const target = face("face_unsupported_output_convergence");
  const output = stage(featureId, target, "root:exact").outputs.get(bodyId)!;
  const convergingStage: OccFeatureTopologyStage = {
    featureId,
    outputs: new Map([
      [
        bodyId,
        {
          ...output,
          sourceTargets: new Map([
            ["root:exact", [target]],
            ["root:unsupported", [target]],
          ]),
          unsupportedSourceKeys: new Set(["root:unsupported"]),
        },
      ],
    ]),
  };

  expect(() =>
    createOccTopologyProvenanceIndex({
      stages: new Map([[featureId, convergingStage]]),
      previousLineage: new Map(),
      historyOrder: history(featureId),
    }).resolveFace(target),
  ).toThrow(/occ-topology-provenance-missing/);
});


test("complete exact face boundaries claim only one fully covered generated face", () => {
  const featureId = "feature_complete_boundary" as FeatureId;
  const sourceBody = {
    bodyId,
    topologyToken: "t0001",
    topology: { faceIds: [], edgeIds: ["edge_profile_a", "edge_profile_b"], vertexIds: [] },
  } as unknown as OccTrackedBody;
  const outputBody = {
    bodyId,
    topologyToken: "t0002",
    topology: { faceIds: ["face_generated"], edgeIds: ["edge_result_a", "edge_result_b"], vertexIds: [] },
  } as unknown as OccTrackedBody;
  const outputFace = face("face_generated");
  const successors = new Map<string, DurableRef>([
    [
      getOccDurableRefKey({ kind: "edge", bodyId, edgeId: "edge_profile_a" as EdgeId }),
      { kind: "edge", bodyId, edgeId: "edge_result_a" as EdgeId },
    ],
    [
      getOccDurableRefKey({ kind: "edge", bodyId, edgeId: "edge_profile_b" as EdgeId }),
      { kind: "edge", bodyId, edgeId: "edge_result_b" as EdgeId },
    ],
  ]);
  const output = createExactSuccessorTopologyStage({
    featureId,
    sourceBody,
    outputBody,
    successorsBySourceKey: successors,
    generatedFaceCompleteBoundaries: [
      {
        target: outputFace,
        // Repeated native incidence from another wire does not alter the key.
        boundaryEdgeIds: ["edge_result_b", "edge_result_a", "edge_result_a"] as EdgeId[],
      },
    ],
  }).outputs.get(bodyId)!;
  const sourceKey = formatGeneratedFaceCompleteBoundaryTopologySourceKey({
    featureId,
    bodyId,
    boundaryEdgeSourceKeys: [
      formatExactSuccessorTopologySourceKey({
        featureId,
        bodyId,
        kind: "edge",
        sourcePublicId: "edge_profile_a" as EdgeId,
      }),
      formatExactSuccessorTopologySourceKey({
        featureId,
        bodyId,
        kind: "edge",
        sourcePublicId: "edge_profile_b" as EdgeId,
      }),
    ],
  });

  expect(output.sourceTargets.get(sourceKey)).toEqual([outputFace]);
});

test("complete exact face boundaries refuse missing edges and duplicate face keys", () => {
  const featureId = "feature_complete_boundary_refusal" as FeatureId;
  const sourceBody = {
    bodyId,
    topologyToken: "t0001",
    topology: { faceIds: [], edgeIds: ["edge_profile"], vertexIds: [] },
  } as unknown as OccTrackedBody;
  const outputBody = {
    bodyId,
    topologyToken: "t0002",
    topology: {
      faceIds: ["face_missing", "face_first", "face_second"],
      edgeIds: ["edge_result"],
      vertexIds: [],
    },
  } as unknown as OccTrackedBody;
  const output = createExactSuccessorTopologyStage({
    featureId,
    sourceBody,
    outputBody,
    successorsBySourceKey: new Map([
      [
        getOccDurableRefKey({ kind: "edge", bodyId, edgeId: "edge_profile" as EdgeId }),
        { kind: "edge", bodyId, edgeId: "edge_result" as EdgeId },
      ],
    ]),
    generatedFaceCompleteBoundaries: [
      {
        target: face("face_missing"),
        boundaryEdgeIds: ["edge_result", "edge_absent"] as EdgeId[],
      },
      { target: face("face_first"), boundaryEdgeIds: ["edge_result"] as EdgeId[] },
      { target: face("face_second"), boundaryEdgeIds: ["edge_result"] as EdgeId[] },
    ],
  }).outputs.get(bodyId)!;

  expect(
    [...output.sourceTargets.values()].flat().filter((target) => target.kind === "face"),
  ).toEqual([]);
});

test("complete exact boundary identity preserves a generated multi-profile face public ID across rebuild", () => {
  const featureId = "feature_multi_profile_complete_boundary" as FeatureId;
  const sourceBody = {
    bodyId,
    topologyToken: "t0001",
    topology: { faceIds: [], edgeIds: ["edge_profile_a", "edge_profile_b"], vertexIds: [] },
  } as unknown as OccTrackedBody;
  const build = (faceId: FaceId, edgeIds: readonly EdgeId[], topologyToken: string) => {
    const outputBody = {
      bodyId,
      topologyToken,
      topology: { faceIds: [faceId], edgeIds, vertexIds: [] },
    } as unknown as OccTrackedBody;
    return createExactSuccessorTopologyStage({
      featureId,
      sourceBody,
      outputBody,
      successorsBySourceKey: new Map([
        [
          getOccDurableRefKey({ kind: "edge", bodyId, edgeId: "edge_profile_a" as EdgeId }),
          { kind: "edge", bodyId, edgeId: edgeIds[0]! },
        ],
        [
          getOccDurableRefKey({ kind: "edge", bodyId, edgeId: "edge_profile_b" as EdgeId }),
          { kind: "edge", bodyId, edgeId: edgeIds[1]! },
        ],
      ]),
      generatedFaceCompleteBoundaries: [
        { target: face(faceId), boundaryEdgeIds: edgeIds },
      ],
    }).outputs.get(bodyId)!;
  };
  const previous = build(
    "face_multi_profile_before" as FaceId,
    ["edge_before_a", "edge_before_b"] as EdgeId[],
    "t0002",
  );
  const current = build(
    "face_multi_profile_after" as FaceId,
    ["edge_after_a", "edge_after_b"] as EdgeId[],
    "t0003",
  );

  expect(
    classifySemanticStageTopology({ previous, current }).preservedTargetsByCurrentKey.get(
      `face:${bodyId}:face_multi_profile_after`,
    ),
  ).toEqual(face("face_multi_profile_before"));
});
