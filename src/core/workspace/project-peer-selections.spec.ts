import { expect, test } from "vitest";
import type { ProjectPresencePeer } from "@/contracts/project-sync/project-service";
import type { DurableRef } from "@/contracts/shared/references";
import {
  limitPresenceSelection,
  otherProjectPeers,
  PROJECT_PRESENCE_SELECTION_LIMIT,
  resolveProjectPeerSelections,
} from "./project-peer-selections";
import type { ViewportRenderableRecord } from "./viewport-renderables";

const face: ViewportRenderableRecord = {
  origin: "document",
  renderable: {
    id: "renderable_face",
    label: "Face",
    ownerBodyId: "body_part",
    ownerFeatureId: null,
    geometry: {
      kind: "mesh",
      vertexPositions: new Float32Array(),
      triangleIndices: new Uint32Array(),
      vertexNormals: null,
    },
    binding: {
      pickId: "pick_face",
      pickPriority: 1,
      target: { kind: "face", bodyId: "body_part", faceId: "face_top" },
      topology: "face",
      semanticClass: "bodyFace",
    },
  },
};
const peer: ProjectPresencePeer = {
  peerId: "socket-1",
  userId: "account-1",
  name: "Peer",
  role: "editor",
  activeDocumentId: "doc_part",
  selection: [{ kind: "face", bodyId: "body_part", faceId: "face_top" }],
};

test("resolved face and body overlays use the peer identity for avatar colour matching", () => {
  for (const selection of [
    peer.selection,
    [{ kind: "body", bodyId: "body_part" }] as const,
  ]) {
    const result = resolveProjectPeerSelections(
      [{ ...peer, selection: [...selection!] }],
      "doc_part",
      [face],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.userId).toBe(peer.userId);
    expect(result[0]?.renderable).toBe(face.renderable);
  }
});

test("other documents, previews, missing entities and cleared/disconnected peers have no overlays", () => {
  expect(resolveProjectPeerSelections([peer], "doc_other", [face])).toEqual([]);
  expect(
    resolveProjectPeerSelections([peer], "doc_part", [
      { ...face, origin: "preview" },
    ]),
  ).toEqual([]);
  expect(
    resolveProjectPeerSelections(
      [{ ...peer, selection: [{ kind: "body", bodyId: "body_missing" }] }],
      "doc_part",
      [face],
    ),
  ).toEqual([]);
  expect(
    resolveProjectPeerSelections([{ ...peer, selection: [] }], "doc_part", [
      face,
    ]),
  ).toEqual([]);
  expect(resolveProjectPeerSelections([], "doc_part", [face])).toEqual([]);
});

const sketchCurve: ViewportRenderableRecord = {
  origin: "document",
  renderable: {
    id: "renderable_curve",
    label: "Line",
    ownerBodyId: null,
    ownerFeatureId: "feature_extrude",
    geometry: {
      kind: "polyline",
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      isClosed: false,
    },
    binding: {
      pickId: "pick_curve",
      pickPriority: 1,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_1",
        entityId: "sketch_entity_line_1",
      },
      topology: null,
      semanticClass: "sketchCurve",
    },
  },
};

test.each([
  ["a whole sketch", { kind: "sketch", sketchId: "sketch_1" }],
  ["the owning feature", { kind: "feature", featureId: "feature_extrude" }],
] as const)("selecting %s highlights its renderables", (_, target) => {
  const highlights = resolveProjectPeerSelections(
    [{ ...peer, selection: [target] }],
    "doc_part",
    [face, sketchCurve],
  );
  expect(highlights.map(({ renderable }) => renderable.id)).toEqual([
    "renderable_curve",
  ]);
});

test("a large selection publishes only a bounded prefix", () => {
  const selection: DurableRef[] = Array.from({ length: 500 }, (_, i) => ({
    kind: "sketchPoint",
    sketchId: "sketch_1",
    pointId: `sketch_point_${i}`,
  }));
  const published = limitPresenceSelection(selection);
  expect(published).toHaveLength(PROJECT_PRESENCE_SELECTION_LIMIT);
  expect(published[0]).toEqual(selection[0]);
  const small = selection.slice(0, 3);
  expect(limitPresenceSelection(small)).toEqual(small);
});

test("every session of your own account is left out of the peers", () => {
  const self = { ...peer, peerId: "socket-self", userId: "account-self" };
  expect(
    otherProjectPeers(
      [self, peer, { ...self, peerId: "socket-self-2" }],
      "account-self",
    ),
  ).toEqual([peer]);
});
