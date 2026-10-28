// cadara-se2. Logic lane; seam: the adapter's background LOD refinement
// (`refineSnapshotLod`), over a fake OCC worker client and over shipped OCC
// in-process. While refinement runs, authored operations are not serialized
// behind it and snapshots stay at the displayed tier; an authored revision
// change during refinement is covered before it completes; the displayed tier
// ends at the latest requested one. Red on base: there was no refinement, and
// `setSnapshotLodTier` switched the tier of the very next (mutation) snapshot.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type {
  GetDocumentSnapshotResponse,
  RenameBodyResponse,
} from "@/contracts/modeling/schema";
import {
  FIXTURE_SKETCH_ID,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  CONTRACT_VERSION,
  EXTRUDE_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import type { OccTessellationTierId } from "@/contracts/modeling/tessellation";
import type { OccWorkerSnapshotClient } from "@/infrastructure/occ/worker-client";
import type { OccSnapshotLodRefinementOutcome } from "@/infrastructure/occ/worker-protocol";
import { OpenCascadeKernelAdapter } from "@/infrastructure/occ/opencascade-kernel-adapter";
import { createStandardPlaneDefinition } from "@/core/modeling/opencascade-kernel-seed";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";

const request = {
  contractVersion: CONTRACT_VERSION,
  documentId: "doc_workspace",
} as const;

function createSolverAdapter(
  revisionId: Parameters<
    ConstructorParameters<
      typeof OpenCascadeKernelAdapter
    >[0]["createSolverAdapter"]
  >[0],
) {
  return new SketchConstraintSolverAdapter({
    revisionId,
    neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
  });
}

test("cadara-se2: with a worker, mutations bypass a pending refinement and snapshots switch tier only when the latest refinement completes", async () => {
  const snapshotTiers: (OccTessellationTierId | undefined)[] = [];
  const refinements: {
    tierId: OccTessellationTierId;
    finish: (outcome: OccSnapshotLodRefinementOutcome) => void;
  }[] = [];
  const workerClient = new Proxy({} as OccWorkerSnapshotClient, {
    get(_target, property) {
      switch (property) {
        case "getDocumentSnapshot":
          return async (
            _request: unknown,
            lodTierId?: OccTessellationTierId,
          ) => {
            snapshotTiers.push(lodTierId);
            return {} as GetDocumentSnapshotResponse;
          };
        case "refineSnapshotLod":
          return (_request: unknown, tierId: OccTessellationTierId) =>
            new Promise((finish) => refinements.push({ tierId, finish }));
        case "renameBody":
          return async () =>
            ({ bodyId: "body_1" }) as unknown as RenameBodyResponse;
        default:
          return undefined;
      }
    },
  });
  const adapter = new OpenCascadeKernelAdapter({
    createSolverAdapter,
    workerSnapshotClient: workerClient,
    getOpenCascadeInstance: async () => {
      throw new Error("The worker owns OCC.");
    },
  });

  const normal = adapter.refineSnapshotLod(request, "normal");
  const fine = adapter.refineSnapshotLod(request, "fine");
  await expect(
    adapter.renameBody({
      ...request,
      baseRevisionId: "rev_1",
      bodyId: "body_1",
      bodyLabel: "Renamed",
    }),
    "An authored mutation must not queue behind the pending refinements.",
  ).resolves.toEqual({ bodyId: "body_1" });
  await adapter.getDocumentSnapshot(request);

  // The worker finishes the older refinement after the newer one started.
  refinements[0]!.finish("completed");
  await expect(normal).resolves.toBe(false);
  await adapter.getDocumentSnapshot(request);
  expect(refinements.map((refinement) => refinement.tierId)).toEqual([
    "normal",
    "fine",
  ]);

  refinements[1]!.finish("completed");
  await expect(fine).resolves.toBe(true);
  await adapter.getDocumentSnapshot(request);

  const again = adapter.refineSnapshotLod(request, "fine");
  refinements[2]!.finish("completed");
  await expect(
    again,
    "Refining to the displayed tier needs no refresh.",
  ).resolves.toBe(false);
  const superseded = adapter.refineSnapshotLod(request, "startup");
  refinements[3]!.finish("superseded");
  await expect(superseded).resolves.toBe(false);
  await adapter.getDocumentSnapshot(request);

  expect(
    snapshotTiers,
    "Snapshots stay at the displayed tier until the latest refinement completes.",
  ).toEqual(["startup", "startup", "fine", "fine"]);
});

test("cadara-se2: in-process refinement lets a feature commit run between steps and covers the body it creates", async () => {
  const module = (await import("../../../public/cadara-occ.js")) as unknown as {
    default: new (
      options: Record<string, unknown>,
    ) => Promise<OpenCascadeInstance>;
  };
  const oc = await new module.default({
    wasmBinary: new Uint8Array(
      await readFile(
        new URL("../../../public/cadara-occ.wasm", import.meta.url),
      ),
    ),
  });
  const native = (
    oc as unknown as {
      CadaraBuildNativeTopologyPayload: {
        BuildJson: (...args: unknown[]) => string;
      };
    }
  ).CadaraBuildNativeTopologyPayload;
  const buildJson = native.BuildJson;
  const nativeBuilds: string[] = [];
  native.BuildJson = (...args: unknown[]) => {
    nativeBuilds.push(String(args[1]));
    return buildJson(...args);
  };
  const adapter = new OpenCascadeKernelAdapter({
    getOpenCascadeInstance: async () => oc,
    createSolverAdapter,
  });
  try {
    const fixture = makeSketchFixture();
    fixture.point("center", 0, 0);
    fixture.circle("rim", "center", 10);
    const initial = await adapter.getDocumentSnapshot(request);
    const sketch = await adapter.commitSketch({
      ...request,
      baseRevisionId: initial.snapshot.document.revisionId,
      solverCorrelation: {
        requestId: "request_lod",
        projectionRequestId: "request_lod:project",
        validationRequestId: "request_lod:validate",
        solveRequestId: "request_lod:solve",
        regionRequestId: "request_lod:regions",
      },
      sketchId: FIXTURE_SKETCH_ID,
      restoreRecordedSketchId: true,
      sketchLabel: "Cylinder profile",
      plane: createStandardPlaneDefinition("xy"),
      definition: fixture.build().definition,
    });
    expect(sketch.revisionState.kind).toBe("accepted");
    const published = (await adapter.getDocumentSnapshot(request)).snapshot
      .document;
    const extrude = (baseRevisionId: typeof published.revisionId) =>
      adapter.createFeature({
        ...request,
        baseRevisionId,
        definition: {
          kind: "extrude",
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            resultBodyType: "solid",
            profiles: [
              {
                kind: "region",
                sketchId: published.sketches[0]!.sketchId,
                regionId: published.sketches[0]!.sketch.regions[0]!.regionId,
              },
            ],
            startExtent: { kind: "profilePlane" },
            extent: {
              mode: "oneSide",
              end: {
                kind: "blind",
                direction: "positive",
                distance: { source: "literal", value: 5 },
              },
            },
            operation: { source: "literal", value: "newBody" },
            booleanScope: { kind: "standalone" },
          },
        },
      });
    const first = await extrude(published.revisionId);
    expect(first.revisionState.kind).toBe("accepted");
    const displayedTier = async () => {
      const result = await adapter.buildNativeTopologySnapshot(request);
      if (result.kind !== "nativeTopologyPayload")
        throw new Error(JSON.stringify(result));
      return result.payload.lodTierId;
    };
    expect(await displayedTier()).toBe("startup");

    const order: string[] = [];
    const refinement = adapter
      .refineSnapshotLod(request, "fine")
      .then((refined) => {
        order.push("refined");
        return refined;
      });
    // Issued after refinement started: it runs after the first step, and
    // its new body is a revision change the refinement must still cover.
    const second = await extrude(first.revisionId);
    order.push("committed");
    expect(second.revisionState.kind).toBe("accepted");
    expect(
      await displayedTier(),
      "Snapshots stay at the displayed tier while refinement runs.",
    ).toBe("startup");

    await expect(refinement).resolves.toBe(true);
    expect(order, "The commit does not wait for the refinement.").toEqual([
      "committed",
      "refined",
    ]);

    nativeBuilds.length = 0;
    expect(await displayedTier()).toBe("fine");
    const bodies = (await adapter.getDocumentSnapshot(request)).snapshot
      .document.bodies;
    expect(bodies).toHaveLength(2);
    expect(
      nativeBuilds,
      "Every body of the final revision, including the one committed mid-refinement, is already meshed at the refined tier.",
    ).toEqual([]);
  } finally {
    native.BuildJson = buildJson;
    adapter.dispose();
  }
});
