import { expect, test } from "vitest";

import type { HistoryProbeTopologySignature } from "@/contracts/import/capabilities";
import type { BodyId, FaceId } from "@/contracts/shared/ids";
import {
  resolveHistoricalTopology,
  type HistoricalTopologySignatureStep,
} from "@/domain/import/historical-topology-selector";

const captured = {
  entityClass: "face" as const,
  geometryType: "plane",
  definingData: { origin: [0, 0, 0], normal: [0, 0, 1] },
  boundingBox: { low: [0, 0, 0] as [number, number, number], high: [10, 10, 0] as [number, number, number] },
};
const source = {
  consumerFeatureId: "consumer",
  parameterId: "entities",
  deterministicId: "captured-face",
};

function face(bodyId: string, faceId: string, z = 0): HistoryProbeTopologySignature {
  return {
    entityClass: "face",
    geometryType: "plane",
    definingData: { origin: [0, 0, z], normal: [0, 0, 1] },
    boundingBox: { low: [0, 0, z], high: [10, 10, z] },
    reference: { kind: "face", bodyId: bodyId as BodyId, faceId: faceId as FaceId },
  };
}

function resolve(
  historicalSteps: readonly HistoricalTopologySignatureStep[],
  consumerSignatures: readonly HistoryProbeTopologySignature[],
) {
  return resolveHistoricalTopology({
    expectedKind: "face",
    capturedSignature: captured,
    historicalSteps: historicalSteps.map((step) => ({
      ...step,
      sourceFeatureId: step.sourceFeatureId ?? `feature-${step.orderedActionIndex}`,
    })),
    consumerSignatures,
    source,
  });
}

function modifiedFaceStep(
  actionIndex: number,
  current: HistoryProbeTopologySignature,
  successor: HistoryProbeTopologySignature,
): HistoricalTopologySignatureStep {
  if (current.reference.kind !== "face" || successor.reference.kind !== "face") {
    throw new Error("Expected face references for exact Modified lineage.");
  }
  const featureId = `feature-${actionIndex}`;
  return {
    orderedActionIndex: actionIndex,
    signatures: [successor],
    exactTopologyEvidence: {
      actionOutputs: [{ actionIndex, featureId }],
      faceIncidence: [],
      topologyLineage: [{
        featureId,
        outputs: [{
          outputSlot: "body-apply" as BodyId,
          topologyToken: "t2",
          topology: { faceIds: [successor.reference.faceId], edgeIds: [], vertexIds: [] },
          sourceTargets: [{
            sourceKey: `exact-successor:${featureId}:${current.reference.bodyId}:face:${current.reference.faceId}`,
            targets: [successor.reference],
          }],
          unsupportedSourceKeys: [],
        }],
      }],
    } as HistoricalTopologySignatureStep["exactTopologyEvidence"],
  };
}

// Lane: logic. Seam: review establishes identity at the first unique witness,
// then accepts only exact public-id continuity or action-local OCC Modified hops.
test("historical topology selection fails closed for no witness, ambiguous first witness, and missing lineage", () => {
  const lineageA = face("body-a", "face-a");
  const lineageB = face("body-b", "face-b");

  expect(resolve([], [lineageA])).toMatchObject({ kind: "noMatch" });
  expect(resolve([{ orderedActionIndex: 0, signatures: [lineageA, lineageB] }], [lineageA])).toMatchObject({ kind: "ambiguous" });
  expect(resolve([{ orderedActionIndex: 0, signatures: [lineageA] }], [lineageB]))
    .toMatchObject({ kind: "noMatch", detail: expect.stringContaining("occurs 0 times") });
});

test("Cutter prefers action 13's exact Modified successor over the still-present JQi reference", () => {
  const jqi = face("body-apply", "face-jqi");
  const reminted = face("body-apply", "face-reminted");
  const action13 = modifiedFaceStep(13, jqi, reminted);
  action13.signatures = [jqi, reminted];
  const result = resolve([
    { orderedActionIndex: 7, signatures: [jqi] },
    action13,
  ], [reminted]);

  expect(result).toMatchObject({
    kind: "unique",
    reference: reminted.reference,
    selector: {
      witnessActionIndex: 7,
      successorActionIndexes: [13],
      witnessSourceFeatureId: "feature-7",
      successorSourceFeatureIds: ["feature-13"],
    },
  });
});

test("a later same-geometry reminted reference does not conflict when Modified connects it", () => {
  const witness = face("body-apply", "face-old");
  const reminted = face("body-apply", "face-reminted");
  const result = resolve([
    { orderedActionIndex: 7, signatures: [witness] },
    modifiedFaceStep(13, witness, reminted),
  ], [reminted]);

  expect(result).toMatchObject({ kind: "unique", reference: reminted.reference });
});

test("a failed first witness lineage does not fall through to a later geometric witness", () => {
  const witness = face("body-apply", "face-old");
  const reminted = face("body-apply", "face-reminted");
  const result = resolve([
    { orderedActionIndex: 7, signatures: [witness] },
    { orderedActionIndex: 8, signatures: [] },
    modifiedFaceStep(13, witness, reminted),
  ], [reminted]);

  expect(result).toMatchObject({ kind: "noMatch", detail: expect.stringContaining("occurs 0 times after ordered action 8") });
});

test("Extrude 3 uses unique public-id continuity when action 13 has no exact successor claim", () => {
  const beforeShell = face("body-before-shell", "face-other", 1);
  const gcab = face("body-shell", "face-gcab");
  const result = resolve([
    { orderedActionIndex: 7, signatures: [beforeShell] },
    { orderedActionIndex: 11, signatures: [gcab] },
    { orderedActionIndex: 13, signatures: [gcab] },
  ], [gcab]);

  expect(result).toMatchObject({
    kind: "unique",
    reference: gcab.reference,
    selector: {
      witnessActionIndex: 11,
      successorActionIndexes: [],
      witnessSourceFeatureId: "feature-11",
      successorSourceFeatureIds: [],
    },
  });
});

test("historical topology selector rejects zero or many exact successors", () => {
  const witness = face("body-apply", "face-old");
  const reminted = face("body-apply", "face-reminted");
  const noSuccessor = modifiedFaceStep(13, witness, reminted);
  noSuccessor.exactTopologyEvidence = {
    ...noSuccessor.exactTopologyEvidence!,
    topologyLineage: [],
  };
  expect(resolve([{ orderedActionIndex: 7, signatures: [witness] }, noSuccessor], [reminted]))
    .toMatchObject({ kind: "noMatch" });

  const manySuccessors = modifiedFaceStep(13, witness, reminted);
  manySuccessors.signatures = [witness];
  manySuccessors.exactTopologyEvidence = {
    ...manySuccessors.exactTopologyEvidence!,
    topologyLineage: manySuccessors.exactTopologyEvidence!.topologyLineage.map((lineage) => ({
      ...lineage,
      outputs: lineage.outputs.map((output) => ({
        ...output,
        sourceTargets: output.sourceTargets.map((sourceTarget) => ({
          ...sourceTarget,
          targets: [reminted.reference, face("body-apply", "face-other").reference],
        })),
      })),
    })),
  };
  expect(resolve([{ orderedActionIndex: 7, signatures: [witness] }, manySuccessors], [witness]))
    .toMatchObject({ kind: "ambiguous" });
});

test("historical topology selection emits an ID-free action-relative selector", () => {
  const lineage = face("sandbox-body", "sandbox-face");
  const result = resolve([{ orderedActionIndex: 4, signatures: [lineage] }], [lineage]);
  expect(result).toMatchObject({
    kind: "unique",
    reference: lineage.reference,
    selector: {
      kind: "historicalTopologyOf",
      expectedKind: "face",
      witnessActionIndex: 4,
      successorActionIndexes: [],
      capturedSignature: captured,
      witnessSourceFeatureId: "feature-4",
      successorSourceFeatureIds: [],
      source,
    },
  });
  if (result.kind === "unique") {
    expect(JSON.stringify(result.selector)).not.toContain("sandbox-body");
    expect(JSON.stringify(result.selector)).not.toContain("sandbox-face");
  }
});
