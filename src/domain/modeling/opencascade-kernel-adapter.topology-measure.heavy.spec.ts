// Logic lane (cadara-h026.5): shipped OCC -> the adapter's on-demand
// `measureTopology` on the landing wheel (history-preserved, so its native
// and durable topology ids differ) -> the measure readout. Oracles: the
// native exact B-rep payload's independent classification (C++ shim), closed
// forms, and the fine mesh.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { TopologyMeasure } from "@/contracts/modeling/topology-measure";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import { deriveMeasurementViewModel } from "@/core/measure/measurement";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import type { OpenCascadeNativeTopologyKernelHost } from "@/domain/modeling/occ/native-topology-payload";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { deriveKernelTopologySignaturesFromExactBrepPayload } from "@/domain/modeling/occ/topology-signatures";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";

async function loadWheel() {
  const module = (await import("../../../public/cadara-occ.js")) as unknown as {
    default: new (
      options: Record<string, unknown>,
    ) => Promise<OpenCascadeInstance & OpenCascadeNativeTopologyKernelHost>;
  };
  const oc = await new module.default({
    wasmBinary: new Uint8Array(
      await readFile(
        new URL("../../../public/cadara-occ.wasm", import.meta.url),
      ),
    ),
  });
  const document = JSON.parse(
    await readFile(
      new URL("../../../landing/examples/wheel/model.cadara", import.meta.url),
      "utf8",
    ),
  ) as AuthoredModelDocument;
  const adapter = new OpenCascadeKernelAdapter({
    documentId: document.documentId,
    getOpenCascadeInstance: async () => oc,
    createSolverAdapter: (revisionId) =>
      new SketchConstraintSolverAdapter({
        revisionId,
        documentId: document.documentId,
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
      }),
  });
  await adapter.restoreAuthoredModelDocument(document);
  adapter.setSnapshotLodTier("fine");
  const request = {
    contractVersion: CONTRACT_VERSION,
    documentId: document.documentId,
  } as const;
  return { adapter, request };
}

test("cadara-h026.5: the wheel's every face and edge measures exactly; circles and cylinders agree with the native B-rep and closed forms, and read out by kind", async () => {
  const { adapter, request } = await loadWheel();
  const snapshot = (await adapter.getDocumentSnapshot(request)).snapshot;
  const body = snapshot.document.bodies.find(
    (entry) => entry.label === "Wheel",
  )!;
  expect(body, "the wheel body").toBeDefined();
  const targets = [
    ...body.topology.faceIds.map((faceId) => ({
      kind: "face" as const,
      bodyId: body.bodyId,
      faceId,
    })),
    ...body.topology.edgeIds.map((edgeId) => ({
      kind: "edge" as const,
      bodyId: body.bodyId,
      edgeId,
    })),
  ];
  const response = await adapter.measureTopology({ ...request, targets });
  expect(response.revisionId).toBe(snapshot.document.revisionId);
  // Snapshot (durable) ids resolve, although the wheel's native ids differ.
  expect(response.measures).toHaveLength(targets.length);

  const exact = await adapter.buildNativeExactBrepPayload(
    snapshot.document.documentId,
    snapshot.document.revisionId,
    { kind: "body", bodyId: body.bodyId },
  );
  if (exact.kind !== "nativeTopologyPayload") throw new Error("premise");
  const signatures = deriveKernelTopologySignaturesFromExactBrepPayload(
    exact.payload,
  );
  if (signatures.status !== "available") throw new Error("premise");
  const native = new Map(
    signatures.signatures.map((signature) => [
      getPrimitiveRefKey(signature.reference),
      signature,
    ]),
  );

  const circles = response.measures.flatMap((measure) =>
    "curve" in measure && measure.curve.kind === "circle" ? [measure] : [],
  );
  const cylinders = response.measures.flatMap((measure) =>
    "surface" in measure && measure.surface.kind === "cylinder"
      ? [measure]
      : [],
  );
  expect(circles.length, "the wheel has circular edges").toBeGreaterThan(0);
  expect(cylinders.length, "the wheel has cylindrical faces").toBeGreaterThan(
    0,
  );

  for (const circle of circles) {
    if (circle.curve.kind !== "circle") continue;
    const shim = native.get(getPrimitiveRefKey(circle.target));
    expect(shim?.geometryType).toBe("circle");
    const radius = (shim?.definingData as { radius: number }).radius;
    expect(Math.abs(circle.curve.radius - radius)).toBeLessThan(1e-6);
    if (circle.curve.isFull)
      expect(
        Math.abs(circle.length - 2 * Math.PI * circle.curve.radius),
      ).toBeLessThan(1e-6);
  }
  for (const cylinder of cylinders) {
    if (cylinder.surface.kind !== "cylinder") continue;
    const shim = native.get(getPrimitiveRefKey(cylinder.target));
    expect(shim?.geometryType).toBe("cylinder");
    const radius = (shim?.definingData as { radius: number }).radius;
    expect(Math.abs(cylinder.surface.radius - radius)).toBeLessThan(1e-6);
  }

  // The readout: kind names, exact rows; the bore (Ø12) among the circles.
  const readout = (measure: TopologyMeasure) =>
    deriveMeasurementViewModel({
      source: "measureTool",
      selection: [measure.target],
      snapshot,
      topologyMeasures: response,
    })!;
  const bore = circles.find(
    (circle) =>
      circle.curve.kind === "circle" &&
      Math.abs(circle.curve.radius - 6) < 1e-9 &&
      circle.curve.isFull,
  );
  expect(bore, "a full Ø12 bore circle").toBeDefined();
  expect(readout(bore!).targetLabels).toEqual(["Circular edge · Wheel"]);
  expect(readout(bore!).rows.slice(0, 3)).toEqual([
    { id: "radius", label: "Radius", value: "6 mm" },
    { id: "diameter", label: "Diameter", value: "12 mm" },
    { id: "circumference", label: "Circumference", value: "37.7 mm" },
  ]);
  const cylinder = cylinders[0]!;
  const faceReadout = readout(cylinder);
  expect(faceReadout.targetLabels).toEqual(["Cylindrical face · Wheel"]);
  if (cylinder.surface.kind !== "cylinder") throw new Error("premise");
  expect(faceReadout.rows[0]).toEqual({
    id: "radius",
    label: "Radius",
    value: `${Number(cylinder.surface.radius.toFixed(2))} mm`,
  });
  // Inscribed facets fall short of the exact area, by under 1%.
  const mesh = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [cylinder.target],
    snapshot,
  })!;
  const meshArea = Number(
    mesh.rows.find((row) => row.id === "area")!.value.replace(/[^\d.]/g, ""),
  );
  expect(meshArea).toBeLessThanOrEqual(cylinder.area + 0.01);
  expect(meshArea).toBeGreaterThan(cylinder.area * 0.99);
  const exactArea = faceReadout.rows.find((row) => row.id === "area")!.value;
  expect(exactArea).toMatch(/^[\d.]+ mm²$/);
  expect(
    Math.abs(Number(exactArea.replace(" mm²", "")) - cylinder.area),
  ).toBeLessThanOrEqual(0.005);
}, 300_000);
