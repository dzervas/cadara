// Logic lane, heavy tier (docs/testing.md): the production OCC adapter
// (`public/cadara-occ`) on the landing bracket, wheel and enclosure, after a
// forward edit (a feature edit or a sketch commit), which evaluates against
// the session's previous references.
//
// cadara-dx2k.16: Finish Sketch without changes keeps the sketch record the
// session holds, so neither the commit, the publication's restore nor the
// editor's Roll To End reruns the features after the sketch. A restore after
// a forward edit resumes only from checkpoints a cold evaluation made (the
// cold gate of cadara-jxe3), so it reruns the edited suffix once; every
// restore must equal a cold open with exact topology tokens and invalidated
// references. Counting spies follow
// opencascade-kernel-adapter.history-prefix-reuse.heavy.spec.ts.
import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";

// Counts feature executions without retaining their (large) arguments.
const featureRuns = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/infrastructure/occ/features", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/infrastructure/occ/features")>();
  return {
    ...actual,
    executeOccFeature: (
      ...args: Parameters<typeof actual.executeOccFeature>
    ) => {
      featureRuns.count += 1;
      return actual.executeOccFeature(...args);
    },
  };
});
// Counts region profile faces built (snapshot meshing and feature profiles).
const regionFaces = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/infrastructure/occ/sketch-profile", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/infrastructure/occ/sketch-profile")
    >();
  return {
    ...actual,
    buildRegionProfileFace: (
      ...args: Parameters<typeof actual.buildRegionProfileFace>
    ) => {
      regionFaces.count += 1;
      return actual.buildRegionProfileFace(...args);
    },
  };
});

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { FeatureId, SketchId } from "@/contracts/shared/ids";
import { stableJsonValue } from "@/contracts/modeling/authored-document-serialization";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";

import {
  expectColdEquivalent,
  occInstance,
  open,
  type Session,
} from "../../../test/helpers/occ-history-prefix-reuse-session";

const loadLandingModel = async (model: string) =>
  JSON.parse(
    await readFile(
      new URL(
        `../../../landing/examples/${model}/model.cadara`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;

interface ParameterEdit {
  featureId: FeatureId;
  edit: (definition: FeatureDefinition) => FeatureDefinition;
}

/** An extrude depth edit: a literal value, or an expression's text. */
const extrudeDepthEdit = (
  featureId: string,
  depth: { value: number } | { valueText: string },
): ParameterEdit => ({
  featureId: featureId as FeatureId,
  edit: (definition) => {
    const parameters = definition.parameters as unknown as {
      extent: { end: { distance: Record<string, unknown> } };
    };
    Object.assign(parameters.extent.end.distance, depth);
    return definition;
  },
});

/** The last feature of each model (as in the history prefix reuse spec). */
const tailEdits: Record<string, ParameterEdit> = {
  bracket: {
    featureId: "feature_chamfer-1" as FeatureId,
    edit: (definition) => {
      const parameters = definition.parameters as unknown as {
        options: { distance: { value: number } };
      };
      parameters.options.distance.value = 0.5;
      return definition;
    },
  },
  wheel: extrudeDepthEdit("feature_extrude-29", { value: 0.3 }),
  enclosure: extrudeDepthEdit("feature_extrude-21", {
    valueText: "screwHeadHeight + 0.5",
  }),
};
/** A feature before each model's tail. */
const midHistoryEdits: Record<string, ParameterEdit> = {
  bracket: extrudeDepthEdit("feature_extrude-6", { value: 3.5 }),
  wheel: extrudeDepthEdit("feature_extrude-21", { value: 3 }),
  enclosure: extrudeDepthEdit("feature_extrude-19", {
    valueText: "screwLength - 1",
  }),
};

/** `value` with every object's keys in reverse order. */
const withReversedKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withReversedKeys)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([key, entry]) => [key, withReversedKeys(entry)]),
        )
      : value;

/**
 * Updates the feature as `edit` changes it and returns the features it ran.
 * The request orders object keys unlike the stored document does (as the
 * editor's requests do), which no checkpoint comparison may count as an edit.
 */
async function editFeature(
  session: Session,
  { featureId, edit }: ParameterEdit,
) {
  const feature = (await session.exported()).features.find(
    (entry) => entry.featureId === featureId,
  )!;
  featureRuns.count = 0;
  await session.update(
    featureId,
    withReversedKeys(
      edit(structuredClone(feature.definition)),
    ) as FeatureDefinition,
  );
  return featureRuns.count;
}

/** `document` as the repository stores it: object keys sorted. */
const stored = (document: AuthoredModelDocument) =>
  stableJsonValue(document) as AuthoredModelDocument;

/**
 * Restores `document` into the session, then takes a snapshot. Returns the
 * features the restore executed, and the bodies (native topology payloads)
 * and region profile faces the snapshot built.
 */
async function restoreAndSnapshot(
  session: Session,
  document: AuthoredModelDocument,
) {
  const native = (
    (await occInstance()) as unknown as {
      CadaraNativeTopologyMeshBuffers: {
        Build: (...args: unknown[]) => unknown;
      };
    }
  ).CadaraNativeTopologyMeshBuffers;
  featureRuns.count = 0;
  await session.restore(document);
  const runs = featureRuns.count;
  const build = native.Build;
  const bodies: string[] = [];
  native.Build = (...args: unknown[]) => {
    bodies.push(String(args[1]));
    return build(...args);
  };
  regionFaces.count = 0;
  try {
    await session.snapshot();
  } finally {
    native.Build = build;
  }
  return { runs, bodies: bodies.sort(), regionFaces: regionFaces.count };
}

/**
 * Commits `sketchId` as the session's export holds it with `edit` applied to
 * its definition (Finish Sketch; without `edit`, Finish without changes), and
 * returns the features the commit ran.
 */
async function commitExportedSketch(
  session: Session,
  sketchId: SketchId,
  edit: (
    definition: AuthoredModelDocument["sketches"][number]["definition"],
  ) => AuthoredModelDocument["sketches"][number]["definition"] = (definition) =>
    definition,
) {
  const document = await session.exported();
  const sketch = document.sketches.find(
    (entry) => entry.sketchId === sketchId,
  )!;
  const baseRevisionId = (await session.snapshot()).document.revisionId;
  featureRuns.count = 0;
  const response = await session.adapter.commitSketch({
    contractVersion: CONTRACT_VERSION,
    documentId: document.documentId,
    baseRevisionId,
    solverCorrelation: null,
    sketchId,
    sketchLabel: sketch.label,
    plane: structuredClone(sketch.plane),
    definition: edit(structuredClone(sketch.definition)),
  });
  expect(response.revisionState.kind, "sketch committed").toBe("accepted");
  return featureRuns.count;
}

/** The first sketch of `document`'s history. */
const firstSketchOf = (document: AuthoredModelDocument) =>
  (
    document.historyOrder.find((item) => item.kind === "sketch") as {
      sketchId: SketchId;
    }
  ).sketchId;

// A forward edit evaluates against the session's previous references, so a
// restore resumes only from checkpoints a cold evaluation made: the first
// restore after a forward edit (Undo, a write from another tab) reruns the
// edited suffix, and must equal a cold open exactly, including invalidated
// references.
test.each(Object.keys(tailEdits))(
  "restores after a forward edit on the landing %s rerun only the edited suffix and equal a cold open (cadara-dx2k.16)",
  async (model) => {
    const session = await open(await loadLandingModel(model));
    try {
      await session.snapshot();
      const tailRuns = await editFeature(session, tailEdits[model]!);
      const edited = await session.exported();
      expect
        .soft(
          (await restoreAndSnapshot(session, edited)).runs,
          "restoring the session's own export after a tail edit reruns the tail",
        )
        .toBe(tailRuns);
      await expectColdEquivalent(
        session,
        edited,
        "restore of the export",
        "exact",
      );

      // Another tab's write of the same history with one body renamed.
      const midRuns = await editFeature(session, midHistoryEdits[model]!);
      const midEdited = await session.exported();
      const renamed = midEdited.bodyLabels[0]!;
      const peer: AuthoredModelDocument = {
        ...midEdited,
        bodyLabels: midEdited.bodyLabels.map((label) =>
          label.bodyId === renamed.bodyId
            ? { ...label, label: `${label.label} (peer)` }
            : label,
        ),
      };
      expect
        .soft(
          (await restoreAndSnapshot(session, peer)).runs,
          "a peer's body rename after a mid-history edit reruns that edit's suffix",
        )
        .toBe(midRuns);
      await expectColdEquivalent(session, peer, "peer body rename", "exact");
    } finally {
      session.adapter.dispose();
    }
  },
  900_000,
);

// Finish Sketch without changes commits the sketch the session holds. The
// commit keeps that record, so no consumer reruns and the checkpoints stay as
// they were: at the end of the history, and in the editor's flow (reopening
// the first sketch rolls the cursor back before it, Finish publishes it, then
// Roll To End), where the publication's restore keeps the rolled-back tail.
// Before, every Finish replayed the history after the sketch: twice at the
// end (the commit, then the publication's restore), once on Roll To End.
test.each(Object.keys(tailEdits))(
  "finishing an unchanged sketch on the landing %s runs no feature and equals a cold open (cadara-dx2k.16)",
  async (model) => {
    const session = await open(await loadLandingModel(model));
    try {
      await session.snapshot();
      const opened = await session.exported();
      const sketchId = firstSketchOf(opened);
      expect(
        opened.historyOrder[0],
        "premise: the first sketch opens the history",
      ).toEqual({ kind: "sketch", sketchId });
      expect
        .soft(
          {
            commitRuns: await commitExportedSketch(session, sketchId),
            ...(await restoreAndSnapshot(session, await session.exported())),
          },
          "Finish at the end of the history evaluates and meshes nothing",
        )
        .toEqual({ commitRuns: 0, runs: 0, bodies: [], regionFaces: 0 });
      await expectColdEquivalent(session, opened, "Finish at the end", "exact");

      /** Reopen, Finish (publish) and Roll To End; the features each ran. */
      const finishInEditor = async () => {
        const end = (await session.exported()).cursor;
        await session.setCursor({ kind: "empty" });
        const commitRuns = await commitExportedSketch(session, sketchId);
        const published = stored(await session.exported());
        const publishRuns = (await restoreAndSnapshot(session, published)).runs;
        await expectColdEquivalent(
          session,
          published,
          "publication at the rolled-back cursor",
          "exact",
        );
        featureRuns.count = 0;
        await session.setCursor(end);
        return { commitRuns, publishRuns, rollToEndRuns: featureRuns.count };
      };
      const none = { commitRuns: 0, publishRuns: 0, rollToEndRuns: 0 };
      expect
        .soft(
          await finishInEditor(),
          "Finish in the editor's flow runs no feature",
        )
        .toEqual(none);
      await expectColdEquivalent(
        session,
        opened,
        "Finish in the editor",
        "exact",
      );

      // After a forward edit, Roll To End resumes the edit's own (forward)
      // evaluation, so it equals a cold open up to the forward rebuild's
      // tokens and invalidated references; the next restore reruns the edit.
      const reruns = await editFeature(session, tailEdits[model]!);
      const edited = await session.exported();
      expect
        .soft(
          await finishInEditor(),
          "Finish in the editor's flow after a forward edit runs no feature",
        )
        .toEqual(none);
      await expectColdEquivalent(
        session,
        edited,
        "Finish after a forward edit",
      );
      expect
        .soft(
          (await restoreAndSnapshot(session, edited)).runs,
          "a restore after it reruns the forward-evaluated tail",
        )
        .toBe(reruns);
      await expectColdEquivalent(session, edited, "restore", "exact");

      // A changed sketch is a new record: its consumers run again.
      const moved = await commitExportedSketch(
        session,
        sketchId,
        (definition) => ({
          ...definition,
          points: definition.points.map((point) => ({
            ...point,
            position: [point.position[0] + 0.5, point.position[1]],
          })),
        }),
      );
      expect(moved, "a changed sketch reruns its consumers").toBeGreaterThan(0);
    } finally {
      session.adapter.dispose();
    }
  },
  900_000,
);
