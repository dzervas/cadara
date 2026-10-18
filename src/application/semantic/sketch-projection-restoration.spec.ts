import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createPlateWorkflow } from "../../../test/helpers/semantic-workflow";

// Semantic counterpart of e2e/sketch-reference-projection-regression.spec.ts.
// The browser rows stay: they restore through the browser repository on reload,
// which the semantic session cannot exercise; these rows cover the native file.
//
// The plate fixture is a 20 x 10 rectangle at the XY origin extruded 7 up, so
// its corners sit at known model positions. Each sketch authors a circle off
// the vertex at [3, 4] and requires its center on the projected vertex.
const supports = [
  {
    name: "XY plane",
    begin: () => ({ plane: "xy" }),
    vertex: [20, 10, 7],
    // Projected along +Z onto the XY plane.
    projected: [20, 10],
    expectSupport: (sketch: Sketch) => expect(sketch.plane).toBe("xy"),
  },
  {
    name: "top face",
    begin: (solid: Result) => ({
      support: topologyAt(solid, "face", [10, 5, 7]),
    }),
    vertex: [20, 10, 0],
    // The top-face frame is anchored at the corner above the bottom vertex.
    projected: [0, 0],
    expectSupport: (sketch: Sketch) => {
      expect(sketch.plane).toBeNull();
      expect(sketch.support!.support.kind).toBe("face");
      expect(sketch.support!.frame.origin).toEqual([20, 10, 7]);
      expect(sketch.support!.frame.normal).toEqual([0, 0, 1]);
    },
  },
] as const;

for (const support of supports) {
  it(`reopens and republishes a ${support.name} circle centered on a projected solid vertex, then saves and opens it cleanly`, async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "cadara-vertex-circle-"));
    const w = await createPlateWorkflow();
    try {
      const sketchId = await publishCircleOnProjectedVertex(w, support);
      expectRestoredCircle(w.current(), support);

      const reopened = await w.execute({ operation: "sketch.open", sketchId });
      expectRestoredCircle(reopened, support);
      const finished = await w.execute({
        operation: "sketch.publish",
        draft: reopened.discovery!.state.draft,
        requireProfiles: true,
      });
      expectRestoredCircle(finished, support);

      const path = resolve(directory, "vertex-circle.cadara");
      const saved = await w.execute({ operation: "document.save", path });
      expect(saved.completion.file.kind).toBe("written");
      const opened = await w.execute({
        operation: "document.open",
        basis: null,
        path,
      });
      expect(opened.diagnostics).toEqual([]);
      expect(opened.completion.geometry.kind).toBe("current");
      expect(opened.discovery!.model!.timeline).toContainEqual(
        expect.objectContaining({ target: { kind: "sketch", sketchId } }),
      );
    } finally {
      await w.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  // Known defect cadara-phk: after document.open, sketch.open reports the
  // reference as missingSource (missing-model-vertex-source). Flip to `it`
  // once the bug is fixed; these are the assertions that must hold.
  it.fails(
    `save/open then reopen and republish keeps a ${support.name} circle on its projected solid vertex`,
    async () => {
      const directory = await mkdtemp(
        resolve(tmpdir(), "cadara-vertex-circle-"),
      );
      const w = await createPlateWorkflow();
      try {
        const sketchId = await publishCircleOnProjectedVertex(w, support);
        const path = resolve(directory, "vertex-circle.cadara");
        await w.execute({ operation: "document.save", path });
        await w.execute({ operation: "document.open", basis: null, path });

        const reopened = await w.run({ operation: "sketch.open", sketchId });
        expect(reopened.outcome.kind).toBe("completed");
        expectRestoredCircle(reopened, support);
        const finished = await w.run({
          operation: "sketch.publish",
          draft: reopened.discovery!.state.draft,
          requireProfiles: true,
        });
        expect(finished.outcome.kind).toBe("completed");
        expectRestoredCircle(finished, support);
      } finally {
        await w.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
    60_000,
  );
}

type Workflow = Awaited<ReturnType<typeof createPlateWorkflow>>;
type Result = ReturnType<Workflow["current"]>;
type Sketch = NonNullable<NonNullable<Result["discovery"]>["sketch"]>;
type Support = (typeof supports)[number];

function topologyAt(
  solid: Result,
  entityClass: "vertex" | "face",
  centroid: readonly number[],
) {
  return solid.discovery!.model!.bodies[0]!.topology!.find(
    (entity) =>
      entity.entityClass === entityClass &&
      JSON.stringify(entity.centroid) === JSON.stringify(centroid),
  )!.reference;
}

async function publishCircleOnProjectedVertex(w: Workflow, support: Support) {
  const begun = await w.execute({
    operation: "sketch.begin",
    ...support.begin(w.solid),
  });
  const referenced = await w.execute({
    operation: "sketch.reference.add",
    draft: begun.discovery!.state.draft,
    target: topologyAt(w.solid, "vertex", support.vertex),
    intent: "fulfill",
  });
  const circle = await w.execute({
    operation: "sketch.author",
    draft: referenced.discovery!.state.draft,
    primitive: { kind: "circle", center: [3, 4], radius: 2 },
    construction: false,
    intent: "fulfill",
  });
  const [centerPointId] = circle.discovery!.sketch!.entities[0]!.pointIds;
  const center = circle.discovery!.references.find(
    (r) =>
      r.target.kind === "sketchPoint" && r.target.pointId === centerPointId,
  )!.target;
  const projectedPoint = circle.discovery!.sketch!.operands.find(
    (o) =>
      o.target.kind === "projectedReferenceGeometry" &&
      o.target.geometryKind === "point",
  )!.target;
  const constrained = await w.execute({
    operation: "sketch.requirement.add",
    draft: circle.discovery!.state.draft,
    tool: "constraintCoincident",
    targets: [center, projectedPoint],
    mode: "driving",
    value: null,
    intent: "fulfill",
  });
  const published = await w.execute({
    operation: "sketch.publish",
    draft: constrained.discovery!.state.draft,
    requireProfiles: true,
  });
  return published.discovery!.sketch!.sketchId!;
}

function expectRestoredCircle(result: Result, support: Support) {
  expect(result.diagnostics).toEqual([]);
  expect(result.completion.geometry.kind).toBe("current");
  const sketch = result.discovery!.sketch!;
  support.expectSupport(sketch);
  const [reference] = sketch.references!;
  expect(reference!.projection!.status).toBe("projected");
  const [point] = reference!.projection!.geometry;
  if (point?.kind !== "point") throw new Error(JSON.stringify(point));
  expect(point.position[0]).toBeCloseTo(support.projected[0], 6);
  expect(point.position[1]).toBeCloseTo(support.projected[1], 6);
  expect(sketch.constraints).toMatchObject([
    { kind: "coincidentProjectedPoint", status: "satisfied" },
  ]);
  const [circle] = sketch.entities;
  expect(circle!.radius).toBeCloseTo(2, 6);
  const center = sketch.points.find((p) => p.pointId === circle!.pointIds[0])!;
  expect(center.position[0]).toBeCloseTo(support.projected[0], 6);
  expect(center.position[1]).toBeCloseTo(support.projected[1], 6);
  expect(sketch.profiles).toHaveLength(1);
}
