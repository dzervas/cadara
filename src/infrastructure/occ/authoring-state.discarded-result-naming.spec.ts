// Logic lane (docs/testing.md), real OCC. Seam: rebuildOccAuthoringState.
// A feature re-run with a previous stage hands its replacement body to the
// stage reconciliation, which re-identifies it and drops its OCAF naming. A
// replacement reconciled from a body without naming (every restored or
// rebuilt body) therefore builds no naming when history settles every
// previous subshape: no seed and no context selection of its fresh
// subshapes. The rebuilt ids, contributors and invalidations must equal a
// rebuild whose naming is built (the body carries stored naming).
import { expect, test } from "vitest";

import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  type AdvancedSolidFeatureDefinition,
} from "@/contracts/modeling/advanced-solid";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import {
  createOccAuthoringState,
  rebuildOccAuthoringState,
  type OccAuthoringFeatureRecord,
} from "@/infrastructure/occ/authoring-state";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import {
  releaseDiscardedOccAuthoringStateObjects,
  releaseOccAuthoringStateObjects,
} from "@/infrastructure/occ/memory";
import { getDefaultOpenCascadeInstance } from "@/infrastructure/occ/runtime";
import { trackNewSolidBody } from "@/infrastructure/occ/topology";

const featureId = "feature_discarded_naming_cut" as FeatureId;
const blockId = "body_discarded_naming_block" as BodyId;

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

/**
 * Subtracts two tool boxes from a block (two tools take the JS boolean path,
 * which reconciles through topology naming), then rebuilds the same feature
 * from the first run's stage. `blockNaming` decides whether the block carries
 * stored OCAF naming or none, as a restored or rebuilt body does.
 */
async function rebuildCut(
  blockNaming: boolean,
  tools: readonly (readonly [
    readonly [number, number, number],
    readonly [number, number, number],
  ])[],
) {
  const oc = await getDefaultOpenCascadeInstance();
  const block = trackNewSolidBody(oc, {
    bodyId: blockId,
    label: blockId,
    ownerFeatureId: "feature_discarded_naming_block" as FeatureId,
    shape: makeBox(oc, [0, 0, 0], [10, 8, 6]),
    seedNaming: blockNaming,
  });
  const toolBodies = tools.map(([corner, size], index) =>
    trackNewSolidBody(oc, {
      bodyId: `body_discarded_naming_tool_${index}` as BodyId,
      label: `tool ${index}`,
      ownerFeatureId: `feature_discarded_naming_tool_${index}` as FeatureId,
      shape: makeBox(oc, corner, size),
      seedNaming: false,
    }),
  );
  const feature: OccAuthoringFeatureRecord = {
    featureId,
    suppressed: false,
    definition: {
      kind: "combine",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: createLiteralAuthoredValue("subtract" as const),
        participants: [
          { role: "targetBody", targets: [{ kind: "body", bodyId: blockId }] },
          {
            role: "toolBody",
            targets: toolBodies.map((tool) => ({
              kind: "body" as const,
              bodyId: tool.bodyId,
            })),
          },
        ],
      },
    } satisfies AdvancedSolidFeatureDefinition & { kind: "combine" },
  };
  const initial = createOccAuthoringState(oc, {
    bodies: [block, ...toolBodies],
  });
  const first = rebuildOccAuthoringState(initial, [feature]);
  const rebuilt = countSelectorCalls(oc, () =>
    rebuildOccAuthoringState(first, [feature]),
  );
  const body = rebuilt.value.bodies.find((entry) => entry.bodyId === blockId)!;
  const outcome = {
    topology: body.topology,
    contributingFeatureIds: body.contributingFeatureIds,
    faces: [...body.faceContributingFeatureIdsById],
    edges: [...body.edgeContributingFeatureIdsById],
    vertices: [...body.vertexContributingFeatureIdsById],
    stage: [
      ...rebuilt.value.featureTopologyStages.get(featureId)!.outputs.values(),
    ].map((output) => ({
      outputSlot: output.outputSlot,
      sourceTargets: [...output.sourceTargets],
    })),
    invalidations: [
      ...rebuilt.value.referenceState.invalidatedReferencesByKey,
    ].sort(([left], [right]) => left.localeCompare(right)),
  };
  releaseDiscardedOccAuthoringStateObjects(rebuilt.value, [first, initial]);
  releaseDiscardedOccAuthoringStateObjects(first, [initial]);
  releaseOccAuthoringStateObjects(initial);
  return { outcome, counts: rebuilt.counts };
}

test("a rebuilt cut that history settles builds no naming for the replacement the stage re-identifies", async () => {
  // Two rectangular through holes: the top and bottom faces are modified,
  // every other subshape is kept; nothing is deleted.
  const tools = [
    [
      [2, 2, -1],
      [2, 2, 8],
    ],
    [
      [6, 4, -1],
      [2, 2, 8],
    ],
  ] as const;
  const unnamed = await rebuildCut(false, tools);
  const named = await rebuildCut(true, tools);

  expect(
    unnamed.counts.Solve,
    "premise: history settles every previous subshape",
  ).toBe(0);
  expect(
    named.counts.Select_1,
    "premise: stored naming still selects the fresh result subshapes in context",
  ).toBeGreaterThan(0);
  expect(
    unnamed.counts.Select_1,
    "no fresh result subshape is selected in context for naming the stage drops",
  ).toBe(0);
  expect(
    unnamed.outcome,
    "ids, contributors, stage claims and invalidations equal the rebuild that builds naming",
  ).toEqual(named.outcome);
});

test("a rebuilt cut that consults the selector fallback still seeds and selects, and equals the rebuild with stored naming", async () => {
  // A corner notch deletes the vertical corner edge and its vertices, so
  // their selectors are consulted.
  const tools = [
    [
      [-1, -1, -1],
      [3, 3, 8],
    ],
    [
      [6, 4, -1],
      [2, 2, 8],
    ],
  ] as const;
  const unnamed = await rebuildCut(false, tools);
  const named = await rebuildCut(true, tools);

  expect(
    unnamed.counts.Solve,
    "premise: the selector fallback is consulted",
  ).toBeGreaterThan(0);
  expect(
    unnamed.counts.Select_1,
    "the seed selects the previous subshapes in context before reconciling",
  ).toBeGreaterThan(named.counts.Select_1);
  expect(
    unnamed.outcome,
    "ids, contributors, stage claims and invalidations equal the rebuild with stored naming",
  ).toEqual(named.outcome);
});
