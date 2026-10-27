// cadara-49h. Logic lane, heavy tier (docs/testing.md): the production OCC
// adapter's body rename on the shipped kernel build. A rename is label-only:
// no feature runs again (it re-ran every feature, ~10 s on the landing wheel),
// topology ids and keyed lineage stay byte-identical, and the result equals
// what a full rebuild and a save -> reopen produce.
//
// Rebuilds are not a fixed point on their own: every one re-mints fallback
// topology tokens (`…_t0019_1` -> `…_t0020_1`, see native-save-certification)
// and stamps its revision on every record, and the invalidated references it
// keeps depend on the session's history (a first open and a reopen of the
// same file already differ there). Comparisons therefore normalize revision
// ids and topology tokens and compare the evaluated model with its live
// references; invalidated references are checked for the body's name only.
// A rebuild also re-mints the native hash ids a restore keeps for an output it
// reproduces (cadara-phi0), so the rebuild comparison first renames its ids
// to the reopened model's through a positional correspondence.
import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";

// Counts feature executions without retaining their (large) arguments.
const featureRuns = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/domain/modeling/occ/features", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/domain/modeling/occ/features")>();
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

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import {
  createTopologyIdCorrespondence,
  renameTopologyIds,
} from "../../../test/helpers/topology-id-correspondence";

let occ: Promise<OpenCascadeInstance> | null = null;
/** A production OCC adapter (`public/cadara-occ`) holding `document`. */
async function open(document: AuthoredModelDocument) {
  occ ??= (async () => {
    const module =
      (await import("../../../public/cadara-occ.js")) as unknown as {
        default: new (
          module: Record<string, unknown>,
        ) => Promise<OpenCascadeInstance>;
      };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );
    return new module.default({ wasmBinary });
  })();
  const instance = occ;
  const adapter = new OpenCascadeKernelAdapter({
    documentId: document.documentId,
    getOpenCascadeInstance: () => instance,
    createSolverAdapter: (revisionId) =>
      new SketchConstraintSolverAdapter({
        revisionId,
        documentId: document.documentId,
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
      }),
  });
  await adapter.restoreAuthoredModelDocument(document);
  const request = {
    contractVersion: CONTRACT_VERSION,
    documentId: document.documentId,
  } as const;
  const snapshot = async () =>
    (await adapter.getDocumentSnapshot(request)).snapshot;
  return {
    adapter,
    snapshot,
    exported: () => adapter.exportAuthoredModelDocument(document.documentId),
    async rename(bodyId: BodyId, bodyLabel: string) {
      const response = await adapter.renameBody({
        ...request,
        baseRevisionId: (await snapshot()).document.revisionId,
        bodyId,
        bodyLabel,
      });
      expect(response.revisionState.kind, "rename accepted").toBe("accepted");
      expect(response.changedTargets).toEqual([{ kind: "body", bodyId }]);
      return response;
    },
    /** Sets the cursor; the current cursor again is a full in-session rebuild. */
    async setCursor(cursor?: AuthoredModelDocument["cursor"]) {
      const current = await snapshot();
      const response = await adapter.setFeatureCursor({
        ...request,
        baseRevisionId: current.document.revisionId,
        cursor: cursor ?? current.document.cursor,
      });
      expect(response.revisionState.kind, "cursor set").toBe("accepted");
    },
  };
}

const sorted = (values: readonly unknown[]) =>
  values.map((value) => JSON.stringify(value)).sort();

/** The snapshot without render meshes, revision stamps or topology tokens;
 * `rename` maps topology ids first. */
function normalized(
  snapshot: WorkspaceSnapshot,
  rename: (text: string) => string = (text) => text,
) {
  const text = rename(
    JSON.stringify({
      ...snapshot,
      document: { ...snapshot.document, render: null },
    }),
  )
    .replace(/rev_\d+/g, "rev")
    .replace(/_t\d+_(\d+)/g, "_t_$1")
    .replace(/"t\d+"/g, '"t"');
  const value = JSON.parse(text) as WorkspaceSnapshot;
  return {
    ...value,
    document: {
      ...value.document,
      entities: sorted(value.document.entities),
      references: sorted(value.document.references),
    },
    presentation: {
      ...value.presentation,
      entities: sorted(value.presentation.entities),
    },
  };
}

/** The evaluated model: bodies, objects, features, entities, live references. */
function liveModel(
  snapshot: WorkspaceSnapshot,
  rename?: (text: string) => string,
) {
  const value = normalized(snapshot, rename);
  return {
    bodies: value.document.bodies,
    objects: value.presentation.objects,
    featureTree: value.presentation.featureTree,
    features: value.document.features,
    entities: value.document.entities,
    references: value.document.references.filter((reference) =>
      reference.includes('"invalidation":null'),
    ),
    diagnostics: value.document.diagnostics,
  };
}

/** Body labels as the Parts & Objects list and the snapshot bodies show them. */
const bodyLabels = (snapshot: WorkspaceSnapshot) =>
  snapshot.document.bodies.map((body) => [body.bodyId, body.label]);

/** Labels of live or invalidated references to `bodyId` or its topology that
 * do not carry `label`. */
const staleReferenceLabels = (
  snapshot: WorkspaceSnapshot,
  bodyId: BodyId,
  label: string,
) =>
  snapshot.document.references
    .filter(
      (reference) =>
        "bodyId" in reference.target &&
        reference.target.bodyId === bodyId &&
        reference.label !== label &&
        !reference.label.startsWith(`${label} `),
    )
    .map((reference) => reference.label);

/** Asserts the fast-path rename of `bodyId` to `label` equals a save ->
 * reopen and a full rebuild of the renamed document. */
async function expectRebuildAndReopenEquivalent(
  session: Awaited<ReturnType<typeof open>>,
  bodyId: BodyId,
  label: string,
) {
  const renamed = await session.snapshot();
  expect(staleReferenceLabels(renamed, bodyId, label)).toEqual([]);
  const document = await session.exported();
  const reopened = await open(document);
  const reopenedSnapshot = await reopened.snapshot();
  expect(
    liveModel(reopenedSnapshot),
    "save -> reopen of the renamed document reproduces the live model",
  ).toEqual(liveModel(renamed));
  expect(staleReferenceLabels(reopenedSnapshot, bodyId, label)).toEqual([]);
  expect(
    JSON.stringify({ ...(await reopened.exported()), topologyLineage: null }),
    "and re-exports the same authored document",
  ).toBe(JSON.stringify({ ...document, topologyLineage: null }));
  reopened.adapter.dispose();

  await session.setCursor();
  const rebuilt = await session.snapshot();
  const correspondence = createTopologyIdCorrespondence(
    { snapshot: rebuilt, document: await session.exported() },
    { snapshot: renamed, document },
  );
  expect(
    liveModel(rebuilt, (text) => renameTopologyIds(text, correspondence)),
    "a full rebuild of the renamed document evaluates the same model",
  ).toEqual(liveModel(renamed));
  expect(staleReferenceLabels(rebuilt, bodyId, label)).toEqual([]);
}

test("renaming a body on the landing wheel runs no feature, keeps topology and lineage, and equals a rebuild and a reopen", async () => {
  const source = JSON.parse(
    await readFile(
      new URL("../../../landing/examples/wheel/model.cadara", import.meta.url),
      "utf8",
    ),
  ) as AuthoredModelDocument;
  featureRuns.count = 0;
  const wheel = await open(source);
  expect(featureRuns.count, "premise: opening runs features").toBeGreaterThan(
    0,
  );
  const before = await wheel.snapshot();
  const exportedBefore = await wheel.exported();
  const bodyId = "body_feature_extrude-1" as BodyId;
  expect(bodyLabels(before)[0], "premise").toEqual([bodyId, "Wheel"]);

  featureRuns.count = 0;
  await wheel.rename(bodyId, "Rim");
  expect(featureRuns.count, "a rename re-runs no feature").toBe(0);

  const after = await wheel.snapshot();
  expect(bodyLabels(after)).toEqual([
    [bodyId, "Rim"],
    ...bodyLabels(before).slice(1),
  ]);
  expect(
    after.document.bodies.map((body) => body.topology),
    "topology ids are unchanged",
  ).toEqual(before.document.bodies.map((body) => body.topology));
  const ofBody = (snapshot: WorkspaceSnapshot) =>
    snapshot.document.references.filter(
      (reference) =>
        "bodyId" in reference.target && reference.target.bodyId === bodyId,
    );
  expect(ofBody(after).map((reference) => reference.target)).toEqual(
    ofBody(before).map((reference) => reference.target),
  );

  const exportedAfter = await wheel.exported();
  expect(exportedAfter.bodyLabels).toEqual(
    exportedBefore.bodyLabels.map((entry) =>
      entry.bodyId === bodyId ? { bodyId, label: "Rim" } : entry,
    ),
  );
  expect(
    JSON.stringify({ ...exportedAfter, revisionId: null, bodyLabels: null }),
    "the rename changes no other authored field; keyed lineage is byte-identical",
  ).toBe(
    JSON.stringify({ ...exportedBefore, revisionId: null, bodyLabels: null }),
  );

  await expectRebuildAndReopenEquivalent(wheel, bodyId, "Rim");
  wheel.adapter.dispose();
}, 900_000);

/** A bar (`Bar`) that a later cut severs into `Bar_1` and `Bar_2`. */
async function severedBar() {
  const w = await createSketchWorkflow();
  try {
    await w.author({ kind: "rectangle", start: [-6, 0], end: [6, 3] });
    const bar = (
      await w.execute({
        operation: "sketch.publish",
        draft: w.draft(),
        requireProfiles: true,
      })
    ).discovery!.sketch!;
    const solid = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: bar.sketchId,
        regionId: bar.profiles[0]!.regionId,
      },
      depth: 3,
      intent: "fulfill",
    });
    const bodyId = solid.discovery!.model!.bodies[0]!.bodyId;
    await w.execute({
      operation: "body.rename",
      bodyId,
      label: "Bar",
      intent: "fulfill",
    });
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    await w.author({ kind: "rectangle", start: [-1, -1], end: [1, 5] });
    const slot = (
      await w.execute({
        operation: "sketch.publish",
        draft: w.draft(),
        requireProfiles: true,
      })
    ).discovery!.sketch!;
    await w.execute({
      operation: "extrude.create",
      parameters: {
        resultBodyType: "solid",
        profiles: [
          {
            kind: "region",
            sketchId: slot.sketchId,
            regionId: slot.profiles[0]!.regionId,
          },
        ],
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: {
            kind: "blind",
            direction: "positive",
            distance: { source: "literal", value: 6 },
          },
        },
        operation: { source: "literal", value: "cut" },
        booleanScope: { kind: "targetBody", bodyId },
      },
      intent: "fulfill",
    });
    return await w.saveAndRead();
  } finally {
    await w.close();
  }
}

test("a severed piece is renamed in place; pieces named after a renamed source keep or derive their names as a rebuild and a reopen do", async () => {
  const document = await severedBar();
  const bar = "body_feature_extrude-1" as BodyId;
  const pieces = [
    "body_feature_extrude-2_split_1",
    "body_feature_extrude-2_split_2",
  ] as BodyId[];
  const barOnly = {
    kind: "feature",
    featureId: "feature_extrude-1" as FeatureId,
  } as const;
  expect(
    document.bodyLabels,
    "premise: the cut named its pieces after the bar",
  ).toEqual([
    { bodyId: bar, label: "Bar" },
    { bodyId: pieces[0], label: "Bar_1" },
    { bodyId: pieces[1], label: "Bar_2" },
  ]);

  // A piece itself.
  const split = await open(document);
  featureRuns.count = 0;
  await split.rename(pieces[0]!, "Left");
  expect(featureRuns.count, "a rename re-runs no feature").toBe(0);
  expect(bodyLabels(await split.snapshot())).toEqual([
    [pieces[0], "Left"],
    [pieces[1], "Bar_2"],
  ]);
  await expectRebuildAndReopenEquivalent(split, pieces[0]!, "Left");
  split.adapter.dispose();

  // The source, with the cursor before the cut. The pieces' derived names
  // were recorded when the cut first ran, so rolling forward keeps them,
  // live and after save -> reopen alike.
  const rolledBack = await open({ ...document, cursor: barOnly });
  featureRuns.count = 0;
  await rolledBack.rename(bar, "Beam");
  expect(featureRuns.count, "a rename re-runs no feature").toBe(0);
  expect(bodyLabels(await rolledBack.snapshot())).toEqual([[bar, "Beam"]]);
  await expectRebuildAndReopenEquivalent(rolledBack, bar, "Beam");
  const reopenedRolledBack = await open(await rolledBack.exported());
  for (const session of [rolledBack, reopenedRolledBack]) {
    await session.setCursor({
      kind: "feature",
      featureId: "feature_extrude-2" as FeatureId,
    });
    expect(bodyLabels(await session.snapshot())).toEqual([
      [pieces[0], "Bar_1"],
      [pieces[1], "Bar_2"],
    ]);
  }
  rolledBack.adapter.dispose();
  reopenedRolledBack.adapter.dispose();

  // A document that never evaluated the cut has no recorded piece names: the
  // cut derives them from the source's current name when it runs.
  const unevaluated = await open({
    ...document,
    cursor: barOnly,
    bodyLabels: [{ bodyId: bar, label: "Bar" }],
  });
  await unevaluated.rename(bar, "Beam");
  const reopenedUnevaluated = await open(await unevaluated.exported());
  for (const session of [unevaluated, reopenedUnevaluated]) {
    await session.setCursor({
      kind: "feature",
      featureId: "feature_extrude-2" as FeatureId,
    });
    expect(bodyLabels(await session.snapshot())).toEqual([
      [pieces[0], "Beam_1"],
      [pieces[1], "Beam_2"],
    ]);
    session.adapter.dispose();
  }
}, 900_000);
