// Logic lane (docs/testing.md), real OCC. Seam: reconcileReplacementSolidBody
// on a body without OCAF naming whose result naming the caller drops
// (resultNamingDiscarded), in a reconciliation that consults the selector
// fallback. Then only the consulted subshapes get a seeded selector and the
// result subshapes get none, which is exact only for the bodies
// admitsConsultedSelectorSeed admits; every other body keeps the eager seed.
// Either way the outcome must equal the eager reconciliation.
import { expect, test } from "vitest";

import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import { runBoolean } from "@/infrastructure/occ/features/boolean-operations";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import { releaseDiscardedOccAuthoringStateObjects } from "@/infrastructure/occ/memory";
import { getDefaultOpenCascadeInstance } from "@/infrastructure/occ/runtime";
import {
  reconcileReplacementSolidBody,
  trackNewSolidBody,
} from "@/infrastructure/occ/topology";

const ownerFeatureId = "feature_consulted_selector_seed" as FeatureId;
const bodyId = "body_consulted_selector_seed" as BodyId;

type OccShape = InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;

function makeBox(
  oc: OpenCascadeInstance,
  corner: readonly [number, number, number],
  size: readonly [number, number, number],
) {
  const origin = new oc.gp_Pnt_3(...corner);
  const builder = new oc.BRepPrimAPI_MakeBox_3(origin, ...size);
  try {
    return builder.Shape();
  } finally {
    builder.delete();
    origin.delete();
  }
}

/**
 * The block's shell added twice to one solid: every face occurs twice. Not a
 * valid solid (tracking it natively is rejected), only a naming context.
 */
function makeSolidWithRepeatedShell(oc: OpenCascadeInstance, block: OccShape) {
  const explorer = new oc.TopExp_Explorer_2(
    block,
    oc.TopAbs_ShapeEnum.TopAbs_SHELL as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
  );
  const builder = new oc.BRep_Builder();
  const solid = new oc.TopoDS_Solid();
  const shell = explorer.Current();
  try {
    builder.MakeSolid(solid);
    builder.Add(solid, shell);
    builder.Add(solid, shell);
    return solid;
  } finally {
    shell.delete();
    builder.delete();
    explorer.delete();
  }
}

/** Counts TNaming_Selector calls while `run` executes. */
function countSelectorCalls<T>(oc: OpenCascadeInstance, run: () => T) {
  const prototype = oc.TNaming_Selector.prototype as unknown as Record<
    "Select_1" | "Solve",
    (...args: unknown[]) => unknown
  >;
  const counts = { Select_1: 0, Solve: 0 };
  const originals = { Select_1: prototype.Select_1, Solve: prototype.Solve };
  for (const method of ["Select_1", "Solve"] as const) {
    prototype[method] = function (this: unknown, ...args: unknown[]) {
      counts[method] += 1;
      return originals[method].apply(this, args);
    };
  }
  try {
    return { value: run(), counts };
  } finally {
    prototype.Select_1 = originals.Select_1;
    prototype.Solve = originals.Solve;
  }
}

function reconciliationOutcome(
  result: ReturnType<typeof reconcileReplacementSolidBody>,
) {
  return {
    topology: result.body.topology,
    contributingFeatureIds: result.body.contributingFeatureIds,
    faces: [...result.body.faceContributingFeatureIdsById],
    edges: [...result.body.edgeContributingFeatureIdsById],
    vertices: [...result.body.vertexContributingFeatureIdsById],
    invalidations: [...result.historyInvalidations],
  };
}

/**
 * Cuts a corner notch out of a 10x8x6 block and reconciles the cut from a
 * body without naming, with the result naming dropped and kept. The notch
 * deletes the vertical corner edge and its vertices, so their selectors are
 * consulted. The history comes from the cut of the block; `contextShape`
 * may replace the block as the context of the body without naming (its
 * tracked subshapes stay the block's).
 */
async function reconcileNotch(
  contextShape?: (oc: OpenCascadeInstance, block: OccShape) => OccShape,
) {
  const oc = await getDefaultOpenCascadeInstance();
  const block = makeBox(oc, [0, 0, 0], [10, 8, 6]);
  const tool = makeBox(oc, [-1, -1, -1], [3, 3, 8]);
  const track = (seedNaming: boolean) =>
    trackNewSolidBody(oc, {
      bodyId,
      label: bodyId,
      ownerFeatureId,
      shape: block,
      seedNaming,
    });
  const tracked = track(false);
  const context = contextShape?.(oc, block);
  const bare = context ? { ...tracked, shape: context } : tracked;
  const stored = track(true);
  const cut = runBoolean(oc, "cut", block, tool);
  const reconcile = (previous: typeof bare, resultNamingDiscarded: boolean) =>
    countSelectorCalls(oc, () =>
      reconcileReplacementSolidBody(oc, {
        previous,
        ownerFeatureId,
        shape: cut.shape,
        historySources: cut.historySources,
        resultNamingDiscarded,
      }),
    );
  try {
    const dropped = reconcile(bare, true);
    const kept = reconcile(bare, false);
    const borrowed = reconcile(stored, false);
    const result = {
      outcomes: {
        dropped: reconciliationOutcome(dropped.value),
        kept: reconciliationOutcome(kept.value),
        borrowed: reconciliationOutcome(borrowed.value),
      },
      droppedNaming: dropped.value.body.naming,
      counts: {
        dropped: dropped.counts,
        kept: kept.counts,
        borrowed: borrowed.counts,
      },
      previousSubshapes:
        bare.topology.faceIds.length +
        bare.topology.edgeIds.length +
        bare.topology.vertexIds.length,
    };
    releaseDiscardedOccAuthoringStateObjects(
      {
        bodies: [dropped.value.body, kept.value.body, borrowed.value.body],
      },
      [{ bodies: [tracked, stored] }],
    );
    return result;
  } finally {
    context?.delete();
    cut.dispose();
  }
}

test("a consulting reconciliation whose result naming is dropped seeds only the consulted selectors and equals the eager one", async () => {
  const result = await reconcileNotch();

  expect(
    result.counts.dropped.Solve,
    "premise: the selector fallback is consulted",
  ).toBeGreaterThan(0);
  expect(
    result.counts.kept.Select_1,
    "premise: the eager seed selects every previous subshape, then the result subshapes",
  ).toBeGreaterThan(result.previousSubshapes);
  expect(
    result.counts.dropped.Select_1,
    "only the consulted previous subshapes are selected in context",
  ).toBe(result.counts.dropped.Solve);
  expect(
    result.counts.dropped.Solve,
    "the same selectors are solved as in the eager reconciliation",
  ).toBe(result.counts.kept.Solve);
  expect(
    result.droppedNaming,
    "the dropped result naming is released, not returned",
  ).toBeUndefined();
  expect(
    result.outcomes.dropped,
    "ids, contributors and invalidations equal the eager seed",
  ).toEqual(result.outcomes.kept);
  expect(
    result.outcomes.dropped,
    "ids, contributors and invalidations equal the stored-naming reconciliation",
  ).toEqual(result.outcomes.borrowed);
});

test("a context whose faces repeat keeps the eager seed even when the result naming is dropped", async () => {
  // Each face occurs twice in the context, so the seed of a face may name it
  // through the general BuildName path, which the partial-seed argument does
  // not cover: the guard must keep every selector.
  const result = await reconcileNotch(makeSolidWithRepeatedShell);

  expect(
    result.counts.dropped.Solve,
    "premise: the selector fallback is consulted",
  ).toBeGreaterThan(0);
  expect(
    result.counts.dropped.Select_1,
    "the guard keeps the eager seed and the result selectors",
  ).toBe(result.counts.kept.Select_1);
  expect(
    result.outcomes.dropped,
    "ids, contributors and invalidations equal the eager seed",
  ).toEqual(result.outcomes.kept);
});

test("a consulted selector that finds its subshape in the result claims it, and the consulted seed equals the eager one", async () => {
  // History that calls one face, one edge and one vertex deleted while the
  // result is the unchanged block: history leaves them unresolved, so their
  // selectors are consulted and each Solve finds the subshape in the result
  // (the face and vertex through an IDENTITY name, the edge, which occurs in
  // two faces, through an ORIENTATION name).
  const oc = await getDefaultOpenCascadeInstance();
  const block = makeBox(oc, [0, 0, 0], [10, 8, 6]);
  const tracked = trackNewSolidBody(oc, {
    bodyId,
    label: bodyId,
    ownerFeatureId,
    shape: block,
    seedNaming: false,
  });
  const deleted = [
    tracked.facesById.values().next().value!,
    tracked.edgesById.values().next().value!,
    tracked.verticesById.values().next().value!,
  ];
  const nothing = new oc.TopTools_ListOfShape_1();
  const history = {
    Modified: () => nothing,
    Generated: () => nothing,
    IsDeleted: (shape: OccShape) =>
      deleted.some((subshape) => subshape.IsSame(shape)),
  };
  const reconcile = (resultNamingDiscarded: boolean) =>
    countSelectorCalls(oc, () =>
      reconcileReplacementSolidBody(oc, {
        previous: tracked,
        ownerFeatureId,
        shape: block,
        historySources: [history],
        resultNamingDiscarded,
      }),
    );
  try {
    const dropped = reconcile(true);
    const kept = reconcile(false);
    const outcomes = {
      dropped: reconciliationOutcome(dropped.value),
      kept: reconciliationOutcome(kept.value),
    };
    releaseDiscardedOccAuthoringStateObjects(
      { bodies: [dropped.value.body, kept.value.body] },
      [{ bodies: [tracked] }],
    );

    expect(
      dropped.counts.Solve,
      "premise: one selector is consulted per subshape history calls deleted",
    ).toBe(deleted.length);
    expect(
      outcomes.dropped.invalidations,
      "premise: every consulted selector found its subshape in the result, so nothing is invalidated",
    ).toEqual([]);
    expect(
      outcomes.dropped.topology,
      "premise: the found subshapes keep their ids",
    ).toEqual(tracked.topology);
    expect(
      dropped.counts.Select_1,
      "only the consulted previous subshapes are selected in context",
    ).toBe(dropped.counts.Solve);
    expect(
      outcomes.dropped,
      "ids, contributors and invalidations equal the eager seed",
    ).toEqual(outcomes.kept);
  } finally {
    nothing.delete();
  }
});
