// Logic lane, fast tier (docs/testing.md). Finish Sketch registers the
// committed sketch's record under its RestoredSketchInputs key, and the
// publish restore reuses that record only when the published document yields
// the same key. The published document is the commit's export after the
// browser repository's round trip: the stable-record codec plus a real
// Automerge document, written the way the repository commits an action
// (AuthoredActionHistory.commit, then applyCollaborativeWrites in one change).
//
// Automerge does not keep the order of map keys: a map created in one change
// materializes in id order, a key added to an existing map is appended, and a
// loaded document is in id order again. The codec rebuilds sketch record
// arrays and their *Ids from that map order, so a new sketch authored out of
// id order publishes reordered and its key misses; records added to an
// existing sketch keep their order in the live document and miss only after
// a reload. The rows marked to fail turn green once the repository persists
// collection order (cadara-yt1); then drop `.fails`.
import { readFile } from "node:fs/promises";
import * as Automerge from "@automerge/automerge";
import { describe, expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { BodyId, FaceId, SketchId } from "@/contracts/shared/ids";
import { AuthoredActionHistory } from "@/core/modeling/authored-action-history";
import {
  applyCollaborativeWrites,
  createCollaborativeDocument,
  documentActionState,
  materializeCollaborativeDocument,
  type CollaborativeDocument,
} from "@/core/modeling/collaborative-document";
import { createRestoredSketchKey } from "@/infrastructure/occ/opencascade-kernel-adapter";

type Sketch = AuthoredModelDocument["sketches"][number];
type Repository = Automerge.Doc<CollaborativeDocument>;

const loadEnclosure = async () =>
  JSON.parse(
    await readFile(
      new URL(
        "../../../landing/examples/enclosure/model.cadara",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;

/** Commits `candidate` over `expected` the way the repository does. */
function publish(
  repository: Repository,
  expected: AuthoredModelDocument,
  candidate: AuthoredModelDocument,
): Repository {
  const current = materializeCollaborativeDocument(repository);
  return Automerge.change(repository, (storage) => {
    const result = new AuthoredActionHistory().commit(
      {
        actorId: Automerge.getActorId(repository),
        documentId: current.documentId,
        context: { kind: "document" },
      },
      documentActionState(current),
      documentActionState(candidate),
      "Finish Sketch",
      documentActionState(expected),
    );
    if (result.status !== "applied")
      throw new Error(`Commit not applied: ${result.status}`);
    applyCollaborativeWrites(storage, result.writes);
  });
}

const keyOf = (document: AuthoredModelDocument, sketchId: SketchId) =>
  createRestoredSketchKey(
    document,
    document.sketches.find((sketch) => sketch.sketchId === sketchId)!,
  );

const faceSketchId = "sketch_on-top-face" as SketchId;

/**
 * The landing enclosure in a repository, and the document Finish Sketch
 * commits after it: a copy of the footprint, whose constraints are authored
 * out of id order, on a face at the history tail. The key does not resolve
 * the face, so its ids need not exist.
 */
async function enclosureWithNewFaceSketch() {
  const base = await loadEnclosure();
  const footprint = base.sketches[0]!;
  const sketch: Sketch = {
    sketchId: faceSketchId,
    label: "On top",
    plane: {
      ...footprint.plane,
      support: {
        kind: "face",
        bodyId: "body_feature_extrude-1" as BodyId,
        faceId: "face_top" as FaceId,
      },
    },
    definition: structuredClone(footprint.definition),
  };
  const committed: AuthoredModelDocument = {
    ...base,
    sketches: [...base.sketches, sketch],
    historyOrder: [
      ...base.historyOrder,
      { kind: "sketch", sketchId: faceSketchId },
    ],
    cursor: { kind: "sketch", sketchId: faceSketchId },
  };
  const repository = Automerge.from(
    createCollaborativeDocument(base) as unknown as Record<string, unknown>,
  ) as unknown as Repository;
  return { base, committed, repository };
}

/**
 * Reopening the published face sketch and adding a point whose id sorts
 * before every existing one; the sketch session appends new records.
 */
function withAddedPoint(
  document: AuthoredModelDocument,
): AuthoredModelDocument {
  return {
    ...document,
    sketches: document.sketches.map((sketch) => {
      if (sketch.sketchId !== faceSketchId) return sketch;
      const point = {
        ...structuredClone(sketch.definition.points[0]!),
        pointId:
          "point_0_added" as (typeof sketch.definition.points)[number]["pointId"],
      };
      return {
        ...sketch,
        definition: {
          ...sketch.definition,
          points: [...sketch.definition.points, point],
          pointIds: [...sketch.definition.pointIds, point.pointId],
        },
      };
    }),
  };
}

describe("RestoredSketchInputs key of a committed face sketch after the Automerge repository round trip", () => {
  test("premise: the footprint's constraints are authored out of id order", async () => {
    const { committed } = await enclosureWithNewFaceSketch();
    const ids = committed.sketches.at(-1)!.definition.constraintIds;
    expect(ids).not.toEqual([...ids].sort());
  });

  // cadara-yt1 (expected to fail until the repository keeps collection order).
  test.fails(
    "a new face sketch publishes with the key its commit registered",
    async () => {
      const { base, committed, repository } =
        await enclosureWithNewFaceSketch();
      const published = materializeCollaborativeDocument(
        publish(repository, base, committed),
      );
      expect(keyOf(published, faceSketchId)).toBe(
        keyOf(committed, faceSketchId),
      );
    },
  );

  test("records added to the published face sketch keep the commit's key in the live document", async () => {
    const { base, committed, repository } = await enclosureWithNewFaceSketch();
    const first = publish(repository, base, committed);
    const reopened = materializeCollaborativeDocument(first);
    const edited = withAddedPoint(reopened);
    const published = materializeCollaborativeDocument(
      publish(first, reopened, edited),
    );
    expect(keyOf(published, faceSketchId)).toBe(keyOf(edited, faceSketchId));
  });

  // cadara-yt1 (expected to fail until the repository keeps collection order).
  test.fails(
    "records added to the published face sketch keep the commit's key after a reload",
    async () => {
      const { base, committed, repository } =
        await enclosureWithNewFaceSketch();
      const first = publish(repository, base, committed);
      const reopened = materializeCollaborativeDocument(first);
      const edited = withAddedPoint(reopened);
      const reloaded = Automerge.load<CollaborativeDocument>(
        Automerge.save(publish(first, reopened, edited)),
      );
      expect(
        keyOf(materializeCollaborativeDocument(reloaded), faceSketchId),
      ).toBe(keyOf(edited, faceSketchId));
    },
  );
});
