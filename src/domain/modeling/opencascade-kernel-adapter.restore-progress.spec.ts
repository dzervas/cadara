// cadara-ku5k. Logic lane (docs/testing.md, adapter conformance): the
// production OCC adapter (`public/cadara-occ`) reports its restore's feature
// rebuild through options.onProgress, once before each feature in history
// order and once when all are done, so the loading status can show
// "Rebuilding features i/N" from real kernel boundaries.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { LoadingProgress } from "@/contracts/modeling/loading-status";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

const bracket = JSON.parse(
  await readFile(
    new URL("../../../landing/examples/bracket/model.cadara", import.meta.url),
    "utf8",
  ),
) as AuthoredModelDocument;

function createAdapter(instance: Promise<OpenCascadeInstance>) {
  return new OpenCascadeKernelAdapter({
    documentId: bracket.documentId,
    getOpenCascadeInstance: () => instance,
    createSolverAdapter: (revisionId) =>
      new SketchConstraintSolverAdapter({
        revisionId,
        documentId: bracket.documentId,
        neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
      }),
  });
}

async function loadOcc() {
  const module = (await import("../../../public/cadara-occ.js")) as unknown as {
    default: new (module: Record<string, unknown>) => Promise<OpenCascadeInstance>;
  };
  const wasmBinary = new Uint8Array(
    await readFile(new URL("../../../public/cadara-occ.wasm", import.meta.url)),
  );
  return new module.default({ wasmBinary });
}

test("restore reports each feature of the rebuild before evaluating it, then completion", async () => {
  const adapter = createAdapter(loadOcc());
  const reported: LoadingProgress[] = [];
  try {
    await adapter.restoreAuthoredModelDocument(bracket, [], undefined, {
      onProgress: (progress) => reported.push(progress),
    });
  } finally {
    adapter.dispose();
  }
  const labels = bracket.featureOrder.map(
    (featureId) =>
      bracket.features.find((feature) => feature.featureId === featureId)!.label,
  );
  const total = labels.length;
  expect(total).toBeGreaterThan(1);
  expect(reported).toEqual([
    ...labels.map((label, completed) => ({
      stage: "rebuilding-features",
      completed,
      total,
      label,
    })),
    { stage: "rebuilding-features", completed: total, total, label: null },
  ]);
});

test("a restore with no features to evaluate reports nothing, never a 0/0 count", async () => {
  const sketch = bracket.sketches[0]!;
  const sketchOnly: AuthoredModelDocument = {
    ...bracket,
    features: [],
    featureOrder: [],
    historyOrder: [{ kind: "sketch", sketchId: sketch.sketchId }],
    cursor: { kind: "sketch", sketchId: sketch.sketchId },
    sketches: [sketch],
    bodyLabels: [],
    bodyAppearances: [],
    topologyLineage: [],
  };
  const adapter = createAdapter(loadOcc());
  const reported: LoadingProgress[] = [];
  try {
    await adapter.restoreAuthoredModelDocument(sketchOnly, [], undefined, {
      onProgress: (progress) => reported.push(progress),
    });
  } finally {
    adapter.dispose();
  }
  expect(reported).toEqual([]);
});
