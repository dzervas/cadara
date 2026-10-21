// T17k2. Logic lane; seam: the production OCC kernel adapter's document
// snapshot (bodies and the object tree the Parts & Objects list renders),
// its export → restore round trip and its rejected-mutation diagnostics.
// - T17h finding: the Parts & Objects body row read "feature_extrude-1". A
//   body a feature creates is named after the feature; a user's name
//   survives save and reopen.
// - T17b0 P-8 / T17e routed: a Finish of a sketch a peer deleted, and edits
//   of a feature or body that no longer exists, said "‹Kind› ‹id› does not
//   resolve in the current OCC authoring state."; they name no id.
// - cadara-01k.1: a body's colour is persisted display data; setting it reuses
//   the evaluated state (no feature rebuild, topology lineage untouched) and
//   survives export → restore.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { BodyId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

const request = {
  contractVersion: CONTRACT_VERSION,
  documentId: "doc_workspace",
} as const;

type OpenCascadeModule = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

let occ: Promise<OpenCascadeInstance> | null = null;
/** The production OCC adapter (`public/cadara-occ`), the instance loaded once. */
function occAdapter() {
  occ ??= (async () => {
    const module =
      (await import("../../../public/cadara-occ.js")) as unknown as {
        default: OpenCascadeModule;
      };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );
    return new module.default({ wasmBinary });
  })();
  const instance = occ;
  return new OpenCascadeKernelAdapter({
    createSolverAdapter: (revisionId) =>
      new SketchConstraintSolverAdapter({
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
        revisionId,
      }),
    getOpenCascadeInstance: () => instance,
  });
}

/** The seed sketch finished into `adapter`, then extruded once (no label given). */
async function extruded(adapter: OpenCascadeKernelAdapter) {
  const mock = (await new MockKernelAdapter().getDocumentSnapshot(request))
    .snapshot.document;
  const seed = mock.sketches[0]!;
  const seedExtrude = mock.features.find(
    (feature) => feature.definition.kind === "extrude",
  )!.definition as Extract<FeatureDefinition, { kind: "extrude" }>;
  const empty = (await adapter.getDocumentSnapshot(request)).snapshot;
  await adapter.commitSketch({
    ...request,
    baseRevisionId: empty.document.revisionId,
    solverCorrelation: {
      requestId: "request_body_labels",
      projectionRequestId: "request_body_labels:project",
      validationRequestId: "request_body_labels:validate",
      solveRequestId: "request_body_labels:solve",
      regionRequestId: "request_body_labels:regions",
    },
    sketchId: seed.sketchId,
    restoreRecordedSketchId: true,
    sketchLabel: seed.label,
    plane: seed.plane,
    definition: seed.sketch.definition,
  });
  const sketched = (await adapter.getDocumentSnapshot(request)).snapshot;
  const sketch = sketched.document.sketches[0]!;
  const created = await adapter.createFeature({
    ...request,
    baseRevisionId: sketched.document.revisionId,
    definition: {
      ...seedExtrude,
      parameters: {
        ...seedExtrude.parameters,
        profiles: [
          {
            kind: "region",
            sketchId: sketch.sketchId,
            regionId: sketch.sketch.regions[0]!.regionId,
          },
        ],
      },
    } as FeatureDefinition,
  });
  expect(created.revisionState.kind, "premise: extruded").toBe("accepted");
  return (await adapter.getDocumentSnapshot(request)).snapshot;
}

const bodyRows = (
  snapshot: Awaited<ReturnType<typeof extruded>>,
): readonly string[] =>
  snapshot.presentation.objects
    .filter((item) => item.target.kind === "body")
    .map((item) => item.label);

test("an extruded body is named after its feature in the snapshot and the Parts & Objects tree; a user's name survives save and reopen", async () => {
  const adapter = occAdapter();
  const snapshot = await extruded(adapter);
  const feature = snapshot.document.features[0]!;
  expect(feature.label, "premise: the feature's own name").toBe("Extrude 1");
  expect(snapshot.document.bodies.map((body) => body.label)).toEqual([
    "Extrude 1",
  ]);
  expect(bodyRows(snapshot)).toEqual(["Extrude 1"]);
  expectNoInternalIds(bodyRows(snapshot));

  const exported = await adapter.exportAuthoredModelDocument("doc_workspace");
  const bodyId = snapshot.document.bodies[0]!.bodyId;
  expect(exported.bodyLabels).toEqual([{ bodyId, label: "Extrude 1" }]);

  // A name the user gave is kept through save and reopen.
  const renamed = await adapter.renameBody({
    ...request,
    baseRevisionId: snapshot.document.revisionId,
    bodyId: bodyId as BodyId,
    bodyLabel: "Boss",
  });
  expect(renamed.revisionState.kind, "premise: renamed").toBe("accepted");
  const reopened = occAdapter();
  await reopened.restoreAuthoredModelDocument(
    await adapter.exportAuthoredModelDocument("doc_workspace"),
  );
  expect(
    bodyRows((await reopened.getDocumentSnapshot(request)).snapshot),
  ).toEqual(["Boss"]);
}, 120_000);

test("a mutation naming a sketch, feature or body that no longer exists is refused without an internal id", async () => {
  const adapter = occAdapter();
  const snapshot = await extruded(adapter);
  const sketch = snapshot.document.sketches[0]!;
  const finish = await adapter.commitSketch({
    ...request,
    baseRevisionId: snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_gone",
      projectionRequestId: "request_gone:project",
      validationRequestId: "request_gone:validate",
      solveRequestId: "request_gone:solve",
      regionRequestId: "request_gone:regions",
    },
    sketchId: "sketch_00000000-0000-4000-8000-000000000000",
    sketchLabel: "Sketch Draft",
    plane: sketch.plane,
    definition: sketch.sketch.definition,
  } as never);
  const feature = await adapter.updateFeature({
    ...request,
    baseRevisionId: snapshot.document.revisionId,
    featureId: "feature_extrude-9",
    definition: snapshot.document.features[0]!.definition,
  } as never);
  const body = await adapter.renameBody({
    ...request,
    baseRevisionId: snapshot.document.revisionId,
    bodyId: "body_feature_extrude-9" as BodyId,
    bodyLabel: "Boss",
  });
  const messages = [finish, feature, body].map((response) => {
    expect(response.revisionState.kind, "premise: refused").not.toBe(
      "accepted",
    );
    return response.diagnostics.map((diagnostic) => diagnostic.message);
  });
  expect(messages).toEqual([
    ["‘Sketch Draft’ no longer exists in this document."],
    ["The feature no longer exists in this document."],
    ["The body no longer exists in this document."],
  ]);
  expectNoInternalIds(messages.flat());
}, 120_000);

test("a body's colour is set without a rebuild, refused when invalid or missing, and survives export and restore", async () => {
  const adapter = occAdapter();
  const snapshot = await extruded(adapter);
  const body = snapshot.document.bodies[0]!;
  expect(body.appearance, "a new document's first body").toEqual({
    kind: "palette",
    slot: 0,
  });
  const before = await adapter.exportAuthoredModelDocument("doc_workspace");
  expect(before.bodyAppearances).toEqual([
    { bodyId: body.bodyId, appearance: { kind: "palette", slot: 0 } },
  ]);

  for (const [bodyId, appearance] of [
    [body.bodyId, { kind: "custom", hex: "#ABCDEF" }],
    [body.bodyId, { kind: "custom", hex: "#abc" }],
    [body.bodyId, { kind: "palette", slot: 6 }],
    ["body_feature_extrude-9", { kind: "palette", slot: 1 }],
  ] as const) {
    const refused = await adapter.setBodyAppearance({
      ...request,
      baseRevisionId: snapshot.document.revisionId,
      bodyId: bodyId as BodyId,
      appearance: appearance as never,
    });
    expect(refused.revisionState.kind, JSON.stringify(appearance)).toBe(
      "rejected",
    );
  }
  expect(
    await adapter.exportAuthoredModelDocument("doc_workspace"),
    "refusals leave the document untouched",
  ).toEqual(before);

  const set = await adapter.setBodyAppearance({
    ...request,
    baseRevisionId: snapshot.document.revisionId,
    bodyId: body.bodyId,
    appearance: { kind: "custom", hex: "#336699" },
  });
  expect(set.revisionState.kind).toBe("accepted");
  expect(set.changedTargets).toEqual([{ kind: "body", bodyId: body.bodyId }]);
  const after = await adapter.exportAuthoredModelDocument("doc_workspace");
  expect(after.revisionId).not.toBe(before.revisionId);
  expect(after.bodyAppearances).toEqual([
    { bodyId: body.bodyId, appearance: { kind: "custom", hex: "#336699" } },
  ]);
  // cadara-3sq.1 rebuilt keyed lineage on a body rename; a colour change must
  // leave every other authored field, lineage order included, byte-identical.
  expect(
    JSON.stringify({ ...after, revisionId: null, bodyAppearances: null }),
  ).toBe(
    JSON.stringify({ ...before, revisionId: null, bodyAppearances: null }),
  );
  const recoloured = (await adapter.getDocumentSnapshot(request)).snapshot;
  expect(recoloured.document.bodies[0]!.appearance).toEqual({
    kind: "custom",
    hex: "#336699",
  });
  expect(recoloured.document.bodies[0]!.topology).toEqual(body.topology);

  const reopened = occAdapter();
  await reopened.restoreAuthoredModelDocument(after);
  expect(
    (await reopened.getDocumentSnapshot(request)).snapshot.document.bodies[0]!
      .appearance,
  ).toEqual({ kind: "custom", hex: "#336699" });
}, 120_000);
