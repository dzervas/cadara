import { expect, test } from "vitest";

import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import type {
  CommitSketchRequest,
  CommitSketchResponse,
  CreateFeatureRequest,
  CreateFeatureResponse,
  ModelingOperationResult,
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

function acceptedResponse(revisionId: `rev_${string}`): ModelingOperationResult {
  return {
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    revisionId,
    revisionState: { kind: "accepted", baseRevisionId: "rev_0001" },
    rebuildResult: {
      kind: "rebuilt",
      revisionId,
      invalidatedTargets: [],
      diagnostics: [],
    },
    changedTargets: [],
    diagnostics: [],
  };
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
        referenceIds: ["ref_recorded"],
        references: [
          {
            referenceId: "ref_recorded",
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
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
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
            end: {
              kind: "blind",
              direction: "positive",
              distance: { source: "literal", value: 10 },
            },
          },
          operation: { source: "literal", value: "newBody" },
          booleanScope: { kind: "standalone" },
        },
      },
    },
  };
}

test("history replay restores recorded UUID identities without rewriting dependent references", async () => {
  const captured: {
    commit?: CommitSketchRequest;
    feature?: CreateFeatureRequest;
  } = {};
  class RecordingAdapter extends MockKernelAdapter {
    override async commitSketch(
      request: CommitSketchRequest,
    ): Promise<CommitSketchResponse> {
      captured.commit = structuredClone(request);
      if (!request.sketchId) {
        throw new Error("Replay must provide a recorded sketch ID.");
      }
      return {
        ...acceptedResponse("rev_0002"),
        sketchId: request.sketchId,
      };
    }
    override async createFeature(
      request: CreateFeatureRequest,
    ): Promise<CreateFeatureResponse> {
      captured.feature = structuredClone(request);
      return { ...acceptedResponse("rev_0003"), featureId: "feature_recorded" };
    }
  }
  const adapter = new RecordingAdapter();
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

  expect(captured.commit?.sketchId).toBe(recordedSketchId);
  expect(captured.commit?.restoreRecordedSketchId).toBe(true);
  expect(captured.commit?.definition.references[0]?.source).toEqual({
    kind: "vertex",
    bodyId: "body_recorded",
    vertexId: "vertex_recorded",
  });
  expect(captured.feature?.definition).toEqual(
    featureEntry().payload.definition,
  );
  expect(committed.cursor.sketchIds).toEqual(new Set([recordedSketchId]));
});

test("history replay updates an already restored sketch without restore-create intent", async () => {
  const captured: { commit?: CommitSketchRequest } = {};
  class RecordingAdapter extends MockKernelAdapter {
    override async commitSketch(
      request: CommitSketchRequest,
    ): Promise<CommitSketchResponse> {
      captured.commit = structuredClone(request);
      if (!request.sketchId) {
        throw new Error("Replay must provide a recorded sketch ID.");
      }
      return {
        ...acceptedResponse("rev_0002"),
        sketchId: request.sketchId,
      };
    }
  }
  const adapter = new RecordingAdapter();

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

  expect(captured.commit?.sketchId).toBe(recordedSketchId);
  expect(captured.commit?.restoreRecordedSketchId).toBe(false);
});
