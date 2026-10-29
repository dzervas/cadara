// Logic lane, heavy tier (docs/testing.md): the production OCC adapter
// (`public/cadara-occ`) restoring an enclosure document whose face sketch's
// supporting face no longer resolves. The fixture is a saved user document:
// Chamfer 3, inserted mid-history on an edge of the lid, trims the face a later
// face sketch sits on, and the naming layer gives the trimmed face a new id.
// A restore must not throw for that (it used to, and the model was lost):
// the sketch keeps its authored definition and frame with a repairable
// sketch diagnostic, its consumer waits for it, every other body is
// evaluated exactly as a cold open of the document without the sketch and
// its consumer evaluates it, and Change Sketch Plane (a commit of the sketch
// on another plane) repairs it.
//
// The second document removes Chamfer 3 and points the sketch at a face id
// that resolves nowhere, so the degradation stays covered whatever naming
// does for chamfered faces.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import type { FeatureId, SketchId } from "@/contracts/shared/ids";
import { SKETCH_SUPPORT_UNRESOLVED_CODE } from "@/contracts/sketch/derived-validity";
import { PROFILE_REGION_SKETCH_NOT_CURRENT_CODE } from "@/core/modeling/feature-diagnostic-mapping";
import { normalizeWorkspaceSnapshot } from "@/core/modeling/modeling-service/normalization";

import {
  evaluatedModel,
  expectColdEquivalent,
  open,
  type Session,
} from "../../../test/helpers/occ-history-prefix-reuse-session";

const ORPHANED_SKETCH =
  "sketch_0ea9f583-56d5-4234-94db-32c276b396f5" as SketchId;
const CONSUMER = "feature_extrude-24" as FeatureId;
const CHAMFER = "feature_chamfer-3" as FeatureId;
const end = { kind: "feature", featureId: CONSUMER } as const;

const saved = async () =>
  JSON.parse(
    await readFile(
      new URL(
        "../../../test/fixtures/documents/enclosure-chamfer-orphans-face-sketch.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;

const withoutFeature = (
  document: AuthoredModelDocument,
  featureId: FeatureId,
): AuthoredModelDocument => ({
  ...document,
  features: document.features.filter((entry) => entry.featureId !== featureId),
  featureOrder: document.featureOrder.filter((entry) => entry !== featureId),
  historyOrder: document.historyOrder.filter(
    (entry) => entry.kind !== "feature" || entry.featureId !== featureId,
  ),
  topologyLineage: document.topologyLineage?.filter(
    (record) => record.featureId !== featureId,
  ),
});

/** The unaffected document: without the orphaned sketch and its consumer. */
const unaffectedPrefix = (document: AuthoredModelDocument) => {
  const withoutConsumer = withoutFeature(document, CONSUMER);
  return {
    ...withoutConsumer,
    sketches: withoutConsumer.sketches.filter(
      (sketch) => sketch.sketchId !== ORPHANED_SKETCH,
    ),
    historyOrder: withoutConsumer.historyOrder.filter(
      (entry) => entry.kind !== "sketch" || entry.sketchId !== ORPHANED_SKETCH,
    ),
    cursor:
      document.cursor.kind === "feature" &&
      document.cursor.featureId === CONSUMER
        ? ({ kind: "feature", featureId: "feature_extrude-23" } as const)
        : document.cursor,
  } as AuthoredModelDocument;
};

/** Everything but the orphaned sketch's own records (its authored curves are
 * still drawn on its authored frame): bodies, topology, references, meshes. */
const unaffectedModel = (snapshot: WorkspaceSnapshot) => {
  const { bodies, entities, references, geometry } = evaluatedModel(
    snapshot,
    "exact",
  );
  const unaffected = (records: string[]) =>
    records.filter(
      (record) =>
        !record.includes(ORPHANED_SKETCH) &&
        !record.includes(ORPHANED_SKETCH.replaceAll("-", "_")),
    );
  return {
    bodies,
    entities: unaffected(entities),
    references: unaffected(references),
    geometry: unaffected(geometry),
  };
};

const orphanedSketch = (snapshot: WorkspaceSnapshot) =>
  snapshot.document.sketches.find(
    (sketch) => sketch.sketchId === ORPHANED_SKETCH,
  )!;

async function expectDegradedRestore(
  document: AuthoredModelDocument,
  step: string,
) {
  // Used to throw "Face … does not resolve on body …" out of the restore.
  const session = await open(document);
  try {
    const snapshot = await session.snapshot();
    // The modeling service refused the chamfered lid's zero-length edge
    // ("Document refresh failed").
    expect(
      () => normalizeWorkspaceSnapshot(snapshot),
      `${step}: the modeling service accepts the snapshot`,
    ).not.toThrow();
    const sketch = orphanedSketch(snapshot);
    expect(
      sketch.sketch.derivedValidity.state,
      `${step}: the unplaced sketch is invalid`,
    ).toBe("invalid");
    expect(
      sketch.sketch.solvedSnapshot.diagnostics.map(({ code }) => code),
      `${step}: and says why`,
    ).toEqual([SKETCH_SUPPORT_UNRESOLVED_CODE]);
    const authored = document.sketches.find(
      (entry) => entry.sketchId === ORPHANED_SKETCH,
    )!;
    expect(sketch.plane, `${step}: it keeps its authored placement`).toEqual(
      authored.plane,
    );
    expect(
      (await session.exported()).sketches.find(
        (entry) => entry.sketchId === ORPHANED_SKETCH,
      ),
      `${step}: and exports the authored sketch unchanged`,
    ).toEqual(authored);
    const sketchDiagnostics = snapshot.document.diagnostics.filter(
      (diagnostic) => diagnostic.target?.kind === "sketch",
    );
    expect(
      sketchDiagnostics,
      `${step}: one repairable document diagnostic on the sketch`,
    ).toEqual([
      expect.objectContaining({
        code: SKETCH_SUPPORT_UNRESOLVED_CODE,
        severity: "error",
        target: { kind: "sketch", sketchId: ORPHANED_SKETCH },
        repairGuidance: expect.stringContaining("Change Sketch Plane"),
      }),
    ]);

    const cold = await open(unaffectedPrefix(document));
    try {
      expect(
        unaffectedModel(snapshot),
        `${step}: every other body equals a cold open without the sketch and its consumer`,
      ).toEqual(unaffectedModel(await cold.snapshot()));
    } finally {
      cold.adapter.dispose();
    }
    return { session, snapshot };
  } catch (error) {
    session.adapter.dispose();
    throw error;
  }
}

async function expectConsumerWaits(snapshot: WorkspaceSnapshot, step: string) {
  expect(
    snapshot.document.diagnostics
      .filter((diagnostic) => diagnostic.featureId === CONSUMER)
      .map(({ code }) => code),
    `${step}: the consumer waits for the sketch`,
  ).toEqual([PROFILE_REGION_SKETCH_NOT_CURRENT_CODE]);
  expect(
    snapshot.document.bodies.map((body) => body.bodyId),
    `${step}: and produces no body`,
  ).not.toContain("body_feature_extrude-24");
}

/** Change Sketch Plane: the sketch committed again on the XY plane. */
async function expectChangeSketchPlaneRepairs(
  session: Session,
  document: AuthoredModelDocument,
) {
  const sketch = orphanedSketch(await session.snapshot());
  const xyPlane = document.sketches.find(
    (entry) =>
      entry.plane.support.kind === "construction" &&
      entry.plane.support.constructionId === "construction_plane-xy",
  )!.plane;
  const response = await session.adapter.commitSketch({
    contractVersion: CONTRACT_VERSION,
    documentId: document.documentId,
    baseRevisionId: (await session.snapshot()).document.revisionId,
    solverCorrelation: null,
    sketchId: ORPHANED_SKETCH,
    sketchLabel: sketch.label,
    plane: structuredClone(xyPlane),
    definition: structuredClone(sketch.sketch.definition),
  });
  expect(response.revisionState.kind, "the repair is accepted").toBe(
    "accepted",
  );
  const repaired = await session.snapshot();
  expect(
    orphanedSketch(repaired).sketch.derivedValidity.state,
    "the repaired sketch is current",
  ).toBe("current");
  expect(
    repaired.document.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === SKETCH_SUPPORT_UNRESOLVED_CODE ||
        diagnostic.featureId === CONSUMER,
    ),
    "and neither it nor its consumer carries a diagnostic",
  ).toEqual([]);
  expect(
    repaired.document.bodies.map((body) => body.bodyId),
    "the consumer builds its body again",
  ).toContain("body_feature_extrude-24");
  await expectColdEquivalent(session, await session.exported(), "repair");
}

test("the saved enclosure document with Chamfer 3 inserted restores with the orphaned face sketch as a sketch diagnostic", async () => {
  const document = await saved();
  expect(document.cursor, "premise: saved at the inserted chamfer").toEqual({
    kind: "feature",
    featureId: CHAMFER,
  });
  const atChamfer = await expectDegradedRestore(document, "at the chamfer");
  atChamfer.session.adapter.dispose();

  const { session, snapshot } = await expectDegradedRestore(
    { ...document, cursor: end },
    "rolled to the end",
  );
  try {
    await expectConsumerWaits(snapshot, "rolled to the end");
    await expectChangeSketchPlaneRepairs(session, document);
  } finally {
    session.adapter.dispose();
  }
}, 900_000);

test("a face sketch whose face id resolves nowhere restores as a sketch diagnostic and Change Sketch Plane repairs it", async () => {
  const source = withoutFeature(await saved(), CHAMFER);
  const document: AuthoredModelDocument = {
    ...source,
    cursor: end,
    sketches: source.sketches.map((sketch) =>
      sketch.sketchId === ORPHANED_SKETCH &&
      sketch.plane.support.kind === "face"
        ? {
            ...sketch,
            plane: {
              ...sketch.plane,
              support: {
                ...sketch.plane.support,
                faceId: "face_body_feature_extrude-7_g0000000000000000",
              },
            },
          }
        : sketch,
    ),
  };
  const { session, snapshot } = await expectDegradedRestore(
    document,
    "unknown face id",
  );
  try {
    await expectConsumerWaits(snapshot, "unknown face id");
    await expectChangeSketchPlaneRepairs(session, document);
  } finally {
    session.adapter.dispose();
  }
}, 900_000);
