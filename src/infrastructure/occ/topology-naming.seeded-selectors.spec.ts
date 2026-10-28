// Logic lane (docs/testing.md), real OCC. Seam: reconcileReplacementSolidBody
// on a body that carries no OCAF naming (every restored or rebuilt body), so
// the reconciliation seeds naming itself. Seeding a selector is a context
// selection per subshape; it is only worth doing when history leaves some
// previous subshape to the selector fallback. Either way the reconciliation
// must equal one from the same body with eagerly seeded stored naming.
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

const ownerFeatureId = "feature_seeded_selectors" as FeatureId;

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

async function reconcileCut(
  toolCorner: readonly [number, number, number],
  toolSize: readonly [number, number, number],
) {
  const oc = await getDefaultOpenCascadeInstance();
  const block = makeBox(oc, [0, 0, 0], [10, 8, 6]);
  const tool = makeBox(oc, toolCorner, toolSize);
  const track = (bodyId: string, seedNaming: boolean) =>
    trackNewSolidBody(oc, {
      bodyId: bodyId as BodyId,
      label: bodyId,
      ownerFeatureId,
      shape: block,
      seedNaming,
    });
  const bare = track("body_seeded_selectors", false);
  const stored = track("body_seeded_selectors", true);
  const cut = runBoolean(oc, "cut", block, tool);
  const reconcile = (previous: typeof bare) =>
    countSelectorCalls(oc, () =>
      reconcileReplacementSolidBody(oc, {
        previous,
        ownerFeatureId,
        shape: cut.shape,
        historySources: cut.historySources,
      }),
    );
  try {
    const seeded = reconcile(bare);
    const borrowed = reconcile(stored);
    const previousSubshapes =
      bare.topology.faceIds.length +
      bare.topology.edgeIds.length +
      bare.topology.vertexIds.length;
    const outcomes = {
      seeded: reconciliationOutcome(seeded.value),
      borrowed: reconciliationOutcome(borrowed.value),
    };
    releaseDiscardedOccAuthoringStateObjects(
      { bodies: [seeded.value.body, borrowed.value.body] },
      [{ bodies: [bare, stored] }],
    );
    return {
      outcomes,
      seeded: seeded.counts,
      borrowed: borrowed.counts,
      previousSubshapes,
    };
  } finally {
    cut.dispose();
  }
}

test("a reconciliation that history settles seeds no selector for the previous subshapes and equals one with stored naming", async () => {
  // A rectangular through hole: the top and bottom faces are modified, every
  // other subshape is kept; nothing is deleted.
  const result = await reconcileCut([3, 3, -1], [4, 2, 8]);

  expect(
    result.seeded.Solve,
    "premise: history settles every previous subshape",
  ).toBe(0);
  expect(
    result.outcomes.seeded,
    "ids, contributors and invalidations equal the stored-naming reconciliation",
  ).toEqual(result.outcomes.borrowed);
  expect(
    result.seeded.Select_1,
    "only the fresh result subshapes are selected in context, as with stored naming",
  ).toBe(result.borrowed.Select_1);
});

test("a reconciliation that consults the selector fallback seeds every selector and equals one with stored naming", async () => {
  // A corner notch deletes the vertical corner edge and its vertices, so
  // their selectors are consulted.
  const result = await reconcileCut([-1, -1, -1], [3, 3, 8]);

  expect(
    result.seeded.Solve,
    "premise: the selector fallback is consulted",
  ).toBeGreaterThan(0);
  expect(
    result.outcomes.seeded,
    "ids, contributors and invalidations equal the stored-naming reconciliation",
  ).toEqual(result.outcomes.borrowed);
  expect(
    result.seeded.Select_1,
    "the seed selects every previous subshape in context before reconciling",
  ).toBe(result.borrowed.Select_1 + result.previousSubshapes);
});
