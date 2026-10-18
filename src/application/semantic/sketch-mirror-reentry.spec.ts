import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { SemanticResult } from "@/contracts/semantic/schema";

// Lane: logic (docs/testing.md). Seam: the in-process semantic session.
// Migrated from the e2e row "T15e: Finish → re-enter keeps the mirrored sketch
// identical": a line, circle, 3-point arc and 3-point spline mirrored about a
// construction line, one copy-side point edit, then Finish (publish) and
// re-entry (open) must reproduce the edited sketch exactly.

type Vec = readonly [number, number];
type Sketch = NonNullable<NonNullable<SemanticResult["discovery"]>["sketch"]>;

function reflect(point: Vec, [a, b]: readonly [Vec, Vec]): Vec {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as const;
  const along = (point[0] - a[0]) * u[0] + (point[1] - a[1]) * u[1];
  return [
    2 * (a[0] + along * u[0]) - point[0],
    2 * (a[1] + along * u[1]) - point[1],
  ];
}

function reflectVector(vector: Vec, [a, b]: readonly [Vec, Vec]): Vec {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as const;
  const along = vector[0] * u[0] + vector[1] * u[1];
  return [2 * along * u[0] - vector[0], 2 * along * u[1] - vector[1]];
}

const positionOf = (sketch: Sketch, pointId: string) =>
  sketch.points.find((p) => p.pointId === pointId)!.position as Vec;
const entityOf = (sketch: Sketch, entityId: string) =>
  sketch.entities.find((e) => e.entityId === entityId)!;

/**
 * Complete-shape check: every solved copy point is its seed point's
 * reflection about the axis line's solved ends, copy radii equal the seeds'
 * and copy tangent vectors are the reflected seed vectors.
 */
function expectMirrorImage(sketch: Sketch, context: string) {
  expect(sketch.mirrors, `${context}: one mirror`).toHaveLength(1);
  const mirror = sketch.mirrors[0]!;
  if (mirror.axis.kind !== "lineEntity")
    throw new Error(`${context}: expected a line axis`);
  const [start, end] = entityOf(sketch, mirror.axis.entityId).pointIds;
  const axis = [positionOf(sketch, start!), positionOf(sketch, end!)] as const;
  expect(mirror.currentGeometry, `${context}: solved copies`).toHaveLength(4);
  mirror.seedEntityIds.forEach((seedId, index) => {
    const seed = entityOf(sketch, seedId);
    const copy = mirror.currentGeometry![index]!;
    expect(copy.entityId).toBe(mirror.outputEntityIds[index]);
    expect(copy.kind, `${context}: the copy keeps the seed's kind`).toBe(
      seed.kind,
    );
    expect(copy.points).toHaveLength(seed.pointIds.length);
    seed.pointIds.forEach((pointId, at) => {
      const image = reflect(positionOf(sketch, pointId), axis);
      const actual = copy.points[at]!.position;
      expect(
        Math.hypot(actual[0] - image[0], actual[1] - image[1]),
        `${context}: copy point ${at} of ${seed.kind} is the seed's mirror image`,
      ).toBeLessThan(1e-6);
    });
    if (seed.radius !== undefined)
      expect(
        Math.abs(copy.radius! - seed.radius),
        `${context}: the copy's radius is the seed's`,
      ).toBeLessThan(1e-9);
    seed.tangents?.forEach((tangent, at) => {
      const copied = entityOf(sketch, copy.entityId).tangents![at]!;
      if (!tangent.vector) {
        expect(copied.vector, `${context}: automatic stays automatic`).toBe(
          null,
        );
        return;
      }
      const image = reflectVector(tangent.vector, axis);
      expect(
        Math.hypot(copied.vector![0] - image[0], copied.vector![1] - image[1]),
        `${context}: copy tangent ${at} is the reflected seed vector`,
      ).toBeLessThan(1e-6);
    });
  });
}

/** Points, entities and mirror relationships: the whole re-entered sketch. */
const geometryOf = (sketch: Sketch) => ({
  points: sketch.points,
  entities: sketch.entities,
  mirrors: sketch.mirrors,
  constraints: sketch.constraints,
});

test("Finish → re-enter keeps the mirrored sketch identical after a copy edit", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.author({ kind: "line", start: [-10, 6], end: [-6, 9] });
    await w.author({ kind: "circle", center: [-3, 7], radius: 1.5 });
    await w.author({
      kind: "threePointArc",
      points: [
        [0, 5],
        [2, 8],
        [4, 5],
      ],
    });
    await w.author({
      kind: "spline",
      fitPoints: [
        [6, 5],
        [8, 9],
        [11, 5],
      ],
    });
    const drawn = await w.author(
      {
        kind: "line",
        start: [-14, 2],
        end: [14, 2],
      },
      true,
    );
    const entities = drawn
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .map((r) => r.target);
    expect(entities, "premise: four seeds and the axis").toHaveLength(5);
    const mirrored = await w.execute({
      operation: "sketch.mirror.create",
      draft: drawn.discovery!.state.draft,
      targets: entities.slice(0, 4),
      axis: entities[4],
      intent: "fulfill",
    });
    const created = mirrored.discovery!.sketch!;
    expect(created.entities, "premise: four copies").toHaveLength(9);
    expectMirrorImage(created, "premise");

    // One copy edit first, so the state is not just the creation result:
    // the mirrored line's start goes from (-10, -2) to (-11, -4).
    const copyLine = entityOf(created, created.mirrors[0]!.outputEntityIds[0]!);
    const seedStart = entityOf(created, created.mirrors[0]!.seedEntityIds[0]!)
      .pointIds[0]!;
    expect(positionOf(created, copyLine.pointIds[0]!)).toEqual([-10, -2]);
    const copyStart = w.ref(copyLine.pointIds[0]!);
    const edited = await w.execute({
      operation: "sketch.geometry.update",
      draft: mirrored.discovery!.state.draft,
      edit: { kind: "point", target: copyStart, position: [-11, -4] },
      intent: "fulfill",
    });
    const dragged = edited.discovery!.sketch!;
    const [x0, y0] = positionOf(created, seedStart);
    const [x1, y1] = positionOf(dragged, seedStart);
    expect(
      Math.hypot(x1 - x0, y1 - y0),
      "the seed followed its copy",
    ).toBeGreaterThan(0.5);
    expectMirrorImage(dragged, "after the copy edit");

    const published = await w.execute({
      operation: "sketch.publish",
      draft: edited.discovery!.state.draft,
      requireProfiles: false,
    });
    const reopened = await w.execute({
      operation: "sketch.open",
      sketchId: published.discovery!.sketch!.sketchId,
    });
    const reentered = reopened.discovery!.sketch!;
    expect(reentered.entities).toHaveLength(9);
    expect(geometryOf(reentered), "re-entry shows the finished sketch").toEqual(
      geometryOf(dragged),
    );
    expectMirrorImage(reentered, "after re-entry");
  } finally {
    await w.close();
  }
}, 60_000);
