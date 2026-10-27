// T17d (B5 [TECH] T17-7, B9 F-3; issue 03 "Round trips": restoration
// provides equivalent validity and diagnostics). Logic lane; seam: kernel
// adapter conformance (mock and production OCC, through the shared
// derivation `deriveCommittedSketchValidity`). Each retained invalid sketch
// goes Finish (commit) → export → restore in a NEW adapter → re-entry: the
// definition, the whole derived validity, the stored solved diagnostics and
// the carried failure (ids and reasons) are identical, regions stay
// withheld, and the entered session shows the label-based message the
// author saw before Finish. Red on base: the mock restore dropped
// `sketch-validation-failed` (degenerate line), the OCC rebuild stored the
// solved diagnostics without it, and an unresolved dimension expression got
// it on Finish only.
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

import { createExpressionAuthoredValue } from "@/contracts/modeling/authored-values";
import type { DimensionId } from "@/contracts/shared/ids";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import {
  createSketchSessionFromSnapshot,
  deleteSelectedSketchGeometry,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import { rebuildSessionForDefinition } from "@/core/editor/sketch-session/definition-authoring";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import {
  eid,
  entityRef,
  mirroredSession,
  pid,
} from "@/domain/editor/sketch-mirror.fixtures";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { OCC_KERNEL_SETTINGS } from "@/core/modeling/opencascade-kernel-seed";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";

const request = {
  contractVersion: CONTRACT_VERSION,
  documentId: "doc_workspace",
} as const;

type OpenCascadeModule = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

let occ: Promise<OpenCascadeInstance> | null = null;
/** The production OCC assets (`public/cadara-occ`), loaded once. */
function loadOcc() {
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
  return occ;
}

type KernelAdapter = MockKernelAdapter | OpenCascadeKernelAdapter;

const adapters: Record<"mock" | "OCC", () => Promise<KernelAdapter>> = {
  mock: async () => new MockKernelAdapter(),
  OCC: async () => {
    const oc = await loadOcc();
    return new OpenCascadeKernelAdapter({
      createSolverAdapter: (revisionId) =>
        new SketchConstraintSolverAdapter({
          neutralCurveQueries:
            createCertifiedNeutralCurveQueryCapabilityForTest(),
          revisionId,
        }),
      getOpenCascadeInstance: async () => oc,
    });
  },
};

/** The retained invalid sketches, each with the session its author left. */
function retainedInvalidSketches(): readonly [string, SketchSessionState][] {
  const { session, relationship } = mirroredSession("free");
  const entered = enterSketchSession(session);
  const rebuild = (definition: SketchDefinition) =>
    rebuildSessionForDefinition(entered, { definition });
  const x0 = session.definition.points.find(
    (point) => point.pointId === pid("x0"),
  )!;
  // The mirror line 0.0005 long (below τ = 0.001).
  const shortLine = (definition: SketchDefinition): SketchDefinition => ({
    ...definition,
    points: definition.points.map((point) =>
      point.pointId === pid("x1")
        ? { ...point, position: [x0.position[0] + 0.0005, x0.position[1]] }
        : point,
    ),
  });
  const deleteEntity = (state: SketchSessionState, entityId: string) =>
    deleteSelectedSketchGeometry(state, [entityRef(state, entityId as never)]);
  const originalDeleted = deleteEntity(entered, eid("c"));
  const copy = relationship.outputs.find(
    (output) => output.seedEntityId === eid("c"),
  )!.outputEntityId;
  const unresolved: SketchDefinition = {
    ...session.definition,
    dimensionIds: [
      ...session.definition.dimensionIds,
      "dimension_t17d_unresolved" as DimensionId,
    ],
    dimensions: [
      ...session.definition.dimensions,
      {
        dimensionId: "dimension_t17d_unresolved" as DimensionId,
        kind: "lineLength",
        label: "Length ab",
        entityId: eid("ab"),
        value: createExpressionAuthoredValue("missing + 1"),
      } as SketchDefinition["dimensions"][number],
    ],
  };
  return [
    ["degenerate mirror line", rebuild(shortLine(session.definition))],
    ["original deleted", originalDeleted],
    ["copy deleted", deleteEntity(entered, copy)],
    [
      "mirror line too short and original deleted",
      rebuild(shortLine(originalDeleted.definition)),
    ],
    ["unresolved dimension expression", rebuild(unresolved)],
  ];
}

async function roundTrip(
  kind: keyof typeof adapters,
  label: string,
  definition: SketchDefinition,
) {
  const seed = (await new MockKernelAdapter().getDocumentSnapshot(request))
    .snapshot.document.sketches[0]!;
  const adapter = await adapters[kind]();
  const before = await adapter.getDocumentSnapshot(request);
  const commit = await adapter.commitSketch({
    ...request,
    baseRevisionId: before.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: `request_${label}`,
      projectionRequestId: `request_${label}:project`,
      validationRequestId: `request_${label}:validate`,
      solveRequestId: `request_${label}:solve`,
      regionRequestId: `request_${label}:regions`,
    },
    sketchId: null,
    sketchLabel: "Retained",
    plane: seed.plane,
    definition,
  } as never);
  expect(commit.revisionState.kind, `${kind} ${label}: Finish`).toBe(
    "accepted",
  );
  const recordOf = async (target: KernelAdapter) =>
    (await target.getDocumentSnapshot(request)).snapshot.document.sketches.find(
      (entry) => entry.sketchId === commit.sketchId,
    )!;
  const finished = await recordOf(adapter);
  const exported = await adapter.exportAuthoredModelDocument("doc_workspace");
  if (adapter instanceof OpenCascadeKernelAdapter) adapter.dispose();
  const reopened = await adapters[kind]();
  await reopened.restoreAuthoredModelDocument(exported);
  const restored = await recordOf(reopened);
  if (reopened instanceof OpenCascadeKernelAdapter) reopened.dispose();
  return { finished, restored };
}

describe("T17d B5/B9: Finish → export → restore → re-entry keeps validity and every diagnostic", () => {
  for (const kind of ["mock", "OCC"] as const)
    test(`${kind} adapter: degenerate line, deleted original, deleted copy, both mirror faults, an unresolved expression`, async () => {
      for (const [label, session] of retainedInvalidSketches()) {
        const { finished, restored } = await roundTrip(
          kind,
          label,
          session.definition,
        );
        const name = `${kind} ${label}`;
        expect(restored.sketch.definition, name).toEqual(
          finished.sketch.definition,
        );
        expect(finished.sketch.derivedValidity.state, name).toBe("invalid");
        expect(restored.sketch.derivedValidity, name).toEqual(
          finished.sketch.derivedValidity,
        );
        expect(restored.sketch.solvedSnapshot.diagnostics, name).toEqual(
          finished.sketch.solvedSnapshot.diagnostics,
        );
        expect(
          [
            restored.sketch.solvedSnapshot.failedDerivationIds,
            restored.sketch.solvedSnapshot.failedDerivationReasons,
          ],
          name,
        ).toEqual([
          finished.sketch.solvedSnapshot.failedDerivationIds,
          finished.sketch.solvedSnapshot.failedDerivationReasons,
        ]);
        expect(restored.sketch.regions, name).toEqual([]);
        // Every diagnostic once (code, target, message).
        const keys = restored.sketch.derivedValidity.diagnostics.map((entry) =>
          JSON.stringify([entry.code, entry.target, entry.message]),
        );
        expect(new Set(keys).size, name).toBe(keys.length);
        // Re-entry (the app's entry) shows what the author saw.
        const reentered = enterSketchSession(
          createSketchSessionFromSnapshot(restored, OCC_KERNEL_SETTINGS),
        );
        expect(reentered.validationMessage, name).toBe(
          session.validationMessage,
        );
      }
    }, 240_000);

  test("the carried reasons and sketch-validation-failed are those of the failure (mock adapter)", async () => {
    const expected: Record<string, [string[] | undefined, boolean]> = {
      "degenerate mirror line": [["axisDegenerate"], true],
      "original deleted": [["seedMissing"], false],
      "copy deleted": [["copyMissing"], false],
      "mirror line too short and original deleted": [
        ["axisDegenerate", "seedMissing"],
        true,
      ],
      "unresolved dimension expression": [undefined, false],
    };
    for (const [label, session] of retainedInvalidSketches()) {
      const { restored } = await roundTrip("mock", label, session.definition);
      const snapshot = restored.sketch.solvedSnapshot;
      expect(
        [
          Object.values(snapshot.failedDerivationReasons ?? {})[0],
          restored.sketch.derivedValidity.diagnostics.some(
            (entry) => entry.code === "sketch-validation-failed",
          ),
        ],
        label,
      ).toEqual(expected[label]);
    }
  }, 120_000);
});
