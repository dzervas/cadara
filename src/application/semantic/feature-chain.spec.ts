import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { SemanticResult } from "@/contracts/semantic/schema";

// Lane: logic (docs/testing.md). Seam: the in-process semantic session.
// Migrated from the e2e row "feature chain carries durable context across
// feature steps": the browser's base-extrude fixture (rectangle
// (-15.5, -5)→(-5, 4.5) extruded 10 along +Z), a 0.5 fillet on a discovered
// body edge, then a construction plane coplanar with the Top plane.

const topology = (result: SemanticResult) =>
  result.discovery!.model!.bodies[0]!.topology!;

/** The vertical edge at the (-5, 4.5) corner, discovered from native output. */
function cornerEdge(result: SemanticResult) {
  const edge = topology(result).find(
    (s) =>
      s.entityClass === "edge" &&
      s.boundingBox &&
      [0, 1].every(
        (i) =>
          Math.abs(s.boundingBox!.low[i]! - [-5, 4.5][i]!) < 1e-5 &&
          Math.abs(s.boundingBox!.high[i]! - [-5, 4.5][i]!) < 1e-5,
      ) &&
      s.boundingBox.high[2] - s.boundingBox.low[2] > 9.99,
  )!.reference;
  expect(edge.kind).toBe("edge");
  expect(
    result.discovery!.references.some(
      (r) => JSON.stringify(r.target) === JSON.stringify(edge),
    ),
    "the edge is a current discovered reference",
  ).toBe(true);
  return edge;
}

/** Six planar faces plus one cylinder of radius 0.5 rounding the corner. */
function expectFilletedCorner(result: SemanticResult, context: string) {
  const faces = topology(result).filter((s) => s.entityClass === "face");
  expect(faces, `${context}: the fillet adds one face`).toHaveLength(7);
  const cylinder = faces.find((s) => s.geometryType === "cylinder")!;
  expect(cylinder.definingData!.radius).toBeCloseTo(0.5, 5);
  const origin = cylinder.definingData!.axisOrigin as number[];
  expect(
    origin[0],
    `${context}: the cylinder axis is 0.5 inside x`,
  ).toBeCloseTo(-5.5, 5);
  expect(
    origin[1],
    `${context}: the cylinder axis is 0.5 inside y`,
  ).toBeCloseTo(4, 5);
  const bounds = result.discovery!.model!.bodies[0]!.bounds!;
  [-15.5, -5, 0].forEach((low, i) => expect(bounds.min[i]).toBeCloseTo(low, 5));
  [-5, 4.5, 10].forEach((high, i) =>
    expect(bounds.max[i]).toBeCloseTo(high, 5),
  );
}

test("feature chain carries durable context across extrude, fillet and plane steps", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [-15.5, -5], end: [-5, 4.5] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    const extruded = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: sketch.sketchId!,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: 10,
      intent: "fulfill",
    });
    const [body] = extruded.discovery!.model!.bodies;
    expect(
      topology(extruded).filter((s) => s.entityClass === "face"),
    ).toHaveLength(6);

    const filleted = await w.execute({
      operation: "fillet.create",
      parameters: {
        edgeTargets: [cornerEdge(extruded)],
        radius: { source: "literal", value: 0.5 },
      },
      intent: "fulfill",
    });
    expectFilletedCorner(filleted, "after the fillet");
    expect(filleted.discovery!.model!.bodies.map((b) => b.bodyId)).toEqual([
      body!.bodyId,
    ]);
    expect(filleted.completion.geometry.kind).toBe("current");
    expect(filleted.completion.persistence.kind).toBe("committed");

    const topPlane = filleted.discovery!.references.find(
      (r) =>
        r.target.kind === "construction" &&
        r.target.constructionId === "construction_plane-xy",
    )!.target;
    const planed = await w.execute({
      operation: "plane.create",
      parameters: { mode: "coplanar", reference: { target: topPlane } },
      intent: "fulfill",
    });
    const features = planed.discovery!.model!.features;
    expect(
      features.map((f) => [f.kind, f.suppressed]),
      "each step is a live feature, in order",
    ).toEqual([
      ["extrude", false],
      ["fillet", false],
      ["plane", false],
    ]);
    const plane = planed.discovery!.model!.constructions!.find(
      (c) => c.ownerFeatureId === features[2]!.featureId,
    )!;
    expect(plane.frame, "the plane is coplanar with Top").toEqual({
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
      linearUnit: "documentLength",
      handedness: "rightHanded",
    });
    expect(features[2]!.producedTargets).toEqual([
      { kind: "construction", constructionId: plane.constructionId },
    ]);
    // The plane leaves the filleted body as it was.
    expectFilletedCorner(planed, "after the plane");
    expect(planed.discovery!.model!.bodies.map((b) => b.bodyId)).toEqual([
      body!.bodyId,
    ]);
    expect(planed.completion.geometry.kind).toBe("current");
    expect(planed.completion.persistence.kind).toBe("committed");
  } finally {
    await w.close();
  }
}, 60_000);
