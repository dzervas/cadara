import { expect, test } from "vitest";

import type { ModelingKernelAdapter } from "@/contracts/modeling/adapter";
import type {
  CommitSketchRequest,
  CommitSketchResponse,
  CreateFeatureRequest,
  CreateFeatureResponse,
} from "@/contracts/modeling/schema";
import type { ModelingOperationHistoryEntry } from "@/contracts/modeling/operation-history";
import {
  replayHistoryEntry,
  type HistoryReplayCursor,
} from "./operation-history";

const recordedSketchId =
  "sketch_12345678-1234-4234-8234-123456789abc" as const;
const recordedRegionId =
  "region_12345678-1234-4234-8234-123456789abc-profile" as const;

function acceptedResponse(revisionId: `rev_${string}`) {
  return {
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    revisionId,
    revisionState: { kind: "accepted", baseRevisionId: "rev_0001" },
    rebuildResult: {
      kind: "succeeded",
      invalidatedTargets: [],
      diagnostics: [],
    },
    changedTargets: [],
    diagnostics: [],
  } as const;
}

function commitEntry(): Extract<
  ModelingOperationHistoryEntry,
  { kind: "commitSketch" }
> {
  return {
    kind: "commitSketch",
    payload: {
      sketchId: recordedSketchId,
      sketchLabel: "Recorded Sketch",
      plane: {
        key: "xy",
        support: {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        frame: {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
          linearUnit: "documentLength",
          handedness: "rightHanded",
        },
      },
      definition: {
        schemaVersion: "sketch-definition/v1alpha2",
        referenceIds: ["reference_recorded"],
        references: [
          {
            referenceId: "reference_recorded",
            kind: "modelReference",
            label: "Recorded vertex",
            source: {
              kind: "vertex",
              bodyId: "body_recorded",
              vertexId: "vertex_recorded",
            },
            projectionMode: "projectAlongPlaneNormal",
          },
        ],
        pointIds: [],
        points: [],
        entityIds: [],
        entities: [],
        constraintIds: [],
        constraints: [],
        dimensionIds: [],
        dimensions: [],
      },
    },
  };
}

function featureEntry(): Extract<
  ModelingOperationHistoryEntry,
  { kind: "createFeature" }
> {
  return {
    kind: "createFeature",
    payload: {
      definition: {
        kind: "extrude",
        featureTypeVersion: "extrude-feature/v1alpha1",
        parameters: {
          resultBodyType: "solid",
          profiles: [
            {
              kind: "region",
              sketchId: recordedSketchId,
              regionId: recordedRegionId,
            },
          ],
          startExtent: { kind: "profilePlane" },
          extent: {
            mode: "oneSide",
            end: { kind: "blind", direction: "positive", distance: 10 },
          },
          operation: "newBody",
          booleanScope: { kind: "standalone" },
        },
      },
    },
  };
}

test("history replay restores recorded UUID identities without rewriting dependent references", async () => {
  let capturedCommit: CommitSketchRequest | null = null;
  let capturedFeature: CreateFeatureRequest | null = null;
  const adapter = {
    async commitSketch(request: CommitSketchRequest) {
      capturedCommit = structuredClone(request);
      return {
        ...acceptedResponse("rev_0002"),
        sketchId: request.sketchId,
      } as unknown as CommitSketchResponse;
    },
    async createFeature(request: CreateFeatureRequest) {
      capturedFeature = structuredClone(request);
      return acceptedResponse("rev_0003") as unknown as CreateFeatureResponse;
    },
  } as unknown as ModelingKernelAdapter;
  const initialCursor: HistoryReplayCursor = {
    revisionId: "rev_0001",
    sketchIds: new Set(),
  };

  const committed = await replayHistoryEntry({
    adapter,
    documentId: "doc_workspace",
    entry: commitEntry(),
    entryIndex: 0,
    cursor: initialCursor,
  });
  await replayHistoryEntry({
    adapter,
    documentId: "doc_workspace",
    entry: featureEntry(),
    entryIndex: 1,
    cursor: committed.cursor,
  });

  expect(capturedCommit?.sketchId).toBe(recordedSketchId);
  expect(capturedCommit?.restoreRecordedSketchId).toBe(true);
  expect(capturedCommit?.definition.references[0]?.source).toEqual({
    kind: "vertex",
    bodyId: "body_recorded",
    vertexId: "vertex_recorded",
  });
  expect(capturedFeature?.definition).toEqual(featureEntry().payload.definition);
  expect(committed.cursor.sketchIds).toEqual(new Set([recordedSketchId]));
});

test("history replay updates an already restored sketch without restore-create intent", async () => {
  let capturedCommit: CommitSketchRequest | null = null;
  const adapter = {
    async commitSketch(request: CommitSketchRequest) {
      capturedCommit = structuredClone(request);
      return {
        ...acceptedResponse("rev_0002"),
        sketchId: request.sketchId,
      } as unknown as CommitSketchResponse;
    },
  } as unknown as ModelingKernelAdapter;

  await replayHistoryEntry({
    adapter,
    documentId: "doc_workspace",
    entry: commitEntry(),
    entryIndex: 0,
    cursor: {
      revisionId: "rev_0001",
      sketchIds: new Set([recordedSketchId]),
    },
  });

  expect(capturedCommit?.sketchId).toBe(recordedSketchId);
  expect(capturedCommit?.restoreRecordedSketchId).toBe(false);
});
