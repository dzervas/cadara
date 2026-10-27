import { expect, test } from "vitest";

import type { NeutralCurve } from "@/contracts/modeling/neutral-curve-query";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { OpenCascadeKernelAdapter } from "./opencascade-kernel-adapter";
import { OccWorkerClient } from "../../infrastructure/occ/worker-client";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
} from "../../core/modeling/opencascade-kernel-seed";

const documentId = OCC_KERNEL_DOCUMENT_ID;
const revisionId = OCC_KERNEL_INITIAL_REVISION_ID;
const request = { contractVersion: CONTRACT_VERSION, documentId };
const target = { kind: "body", bodyId: "body_part-1" } as const;
const curve: NeutralCurve = {
  kind: "line",
  curveId: "line",
  provenance: { sourceEntityId: "line", sourceSpanId: "line" },
  origin: [0, 0],
  direction: [1, 0],
  sourceDomain: [0, 1],
};
const pair = { modelingTolerance: 0.001, first: curve, second: curve };

const reads: Array<{
  name: string;
  invoke: (adapter: OpenCascadeKernelAdapter) => unknown;
}> = [
  {
    name: "snapshot",
    invoke: (adapter) => adapter.getDocumentSnapshot(request),
  },
  {
    name: "authored export",
    invoke: (adapter) => adapter.exportAuthoredModelDocument(documentId),
  },
  {
    name: "native topology",
    invoke: (adapter) => adapter.buildNativeTopologySnapshot(request),
  },
  {
    name: "native boolean payload",
    invoke: (adapter) =>
      adapter.buildNativeBooleanFeatureTransactionPayload(
        documentId,
        revisionId,
        "body_part-1",
        "body_part-2",
        "join",
      ),
  },
  {
    name: "native mesh export",
    invoke: (adapter) =>
      adapter.buildNativeMeshExportPayload(documentId, revisionId, target, {
        chordTolerance: 0.1,
        angleToleranceRadians: 0.1,
      }),
  },
  {
    name: "native exact B-rep",
    invoke: (adapter) =>
      adapter.buildNativeExactBrepPayload(documentId, revisionId, target),
  },
  {
    name: "reference projection",
    invoke: (adapter) =>
      adapter.projectSketchExternalReferences({
        ...request,
        solverSchemaVersion: SOLVER_SCHEMA_VERSION,
        requestId: "request_disposed_projection",
        revisionId,
        sketchId: "sketch_1",
        plane: createStandardPlaneDefinition("xy").frame,
        tolerances: {
          coincidence: 0.001,
          angleRadians: 0.01,
          minimumSegmentLength: 0.001,
        },
        references: [],
      }),
  },
  {
    name: "export capabilities",
    invoke: (adapter) => adapter.getExportCapabilities(revisionId),
  },
  {
    name: "reference resolution",
    invoke: (adapter) => adapter.resolveReference({ ...request, target }),
  },
  { name: "curve pair", invoke: (adapter) => adapter.queryNeutralCurves(pair) },
  {
    name: "curve self intersection",
    invoke: (adapter) =>
      adapter.queryNeutralCurveSelfIntersections({
        modelingTolerance: 0.001,
        curve,
      }),
  },
  {
    name: "curve join",
    invoke: (adapter) => adapter.queryNeutralCurveJoin({ ...pair, joins: [] }),
  },
];

test.each(reads)(
  "disposed facade rejects $name without resurrecting worker document state",
  async ({ invoke }) => {
    let workerRequests = 0;
    const client = new OccWorkerClient({
      worker: {
        postMessage() {
          workerRequests += 1;
          throw new Error("Unexpected worker request");
        },
        addEventListener() {},
        removeEventListener() {},
      },
    });
    const adapter = new OpenCascadeKernelAdapter({
      documentId,
      workerSnapshotClient: client,
      createSolverAdapter: () => {
        throw new Error("Unexpected solver initialization");
      },
      getOpenCascadeInstance: async () => {
        throw new Error("Unexpected native initialization");
      },
    });
    try {
      adapter.dispose();
      await expect(
        Promise.resolve().then(() => invoke(adapter)),
      ).rejects.toThrow("OpenCascade kernel adapter has been disposed.");
      expect(workerRequests).toBe(0);
    } finally {
      client.dispose();
    }
  },
);
