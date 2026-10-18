import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { SemanticResult } from "@/contracts/semantic/schema";

type Workflow = Awaited<ReturnType<typeof createSketchWorkflow>>;

/** Adds a driving dimension, then edits it the way an annotation Save does. */
async function addThenEdit(
  f: Workflow,
  tool: "dimensionDistance" | "dimensionRadius",
  entityId: string,
  initial: number,
  edited: number,
) {
  const target = f.ref(entityId);
  const added = await f.execute({
    operation: "sketch.requirement.add",
    draft: f.draft(),
    tool,
    targets: [target],
    mode: "driving",
    value: initial,
    intent: "fulfill",
  });
  const [dimension] = added.discovery!.sketch!.requirements;
  expect(
    dimension!.value,
    "premise: the dimension authors its initial value",
  ).toBe(initial);
  return f.execute({
    operation: "sketch.dimension.update",
    draft: added.discovery!.state.draft,
    dimensionId: dimension!.dimensionId,
    value: edited,
    intent: "fulfill",
  });
}

/** Finishes the sketch and returns its committed native definition. */
async function publishAndSave(f: Workflow) {
  const published = await f.execute({
    operation: "sketch.publish",
    draft: f.draft(),
    requireProfiles: true,
  });
  const document = await f.saveAndRead();
  return document.sketches.find(
    (s) => s.sketchId === published.discovery!.sketch!.sketchId,
  )!.definition;
}

function sideLength(result: SemanticResult, entityId: string) {
  const sketch = result.discovery!.sketch!;
  const [a, b] = sketch.entities
    .find((e) => e.entityId === entityId)!
    .pointIds.map(
      (id) => sketch.points.find((p) => p.pointId === id)!.position,
    );
  return Math.hypot(b![0] - a![0], b![1] - a![1]);
}

/** Rectangle 20 x 10; picks the side whose endpoints share the given coordinate. */
async function rectangleSide(f: Workflow, axis: 0 | 1, at: number) {
  const created = await f.author({
    kind: "rectangle",
    start: [0, 0],
    end: [20, 10],
  });
  const sketch = created.discovery!.sketch!;
  expect(
    sketch.requirements,
    "the Rectangle tool authors no width/height",
  ).toEqual([]);
  return sketch.entities.find((e) =>
    e.pointIds.every(
      (id) =>
        sketch.points.find((p) => p.pointId === id)!.position[axis] === at,
    ),
  )!.entityId;
}

for (const row of [
  { label: "width (bottom side)", axis: 1, at: 0, initial: 4.8, edited: 31 },
  { label: "height (right side)", axis: 0, at: 20, initial: 3.6, edited: 29 },
] as const)
  it(`edited rectangle ${row.label} length solves, finishes the sketch and saves the edited lineLength`, async () => {
    const f = await createSketchWorkflow();
    try {
      const side = await rectangleSide(f, row.axis, row.at);
      const edited = await addThenEdit(
        f,
        "dimensionDistance",
        side,
        row.initial,
        row.edited,
      );
      expect(edited.discovery!.sketch!.requirements).toMatchObject([
        { kind: "lineLength", value: row.edited },
      ]);
      expect(sideLength(edited, side), "solved side length").toBeCloseTo(
        row.edited,
        6,
      );
      expect(edited.discovery!.sketch!.profiles).toHaveLength(1);

      const definition = await publishAndSave(f);
      expect(
        definition.dimensions.map((d) => [
          d.kind,
          "entityId" in d ? d.entityId : null,
          "value" in d && d.value?.source === "literal" ? d.value.value : null,
        ]),
      ).toEqual([["lineLength", side, row.edited]]);
      const line = definition.entities.find((e) => e.entityId === side)!;
      if (line.kind !== "lineSegment")
        throw new Error("Expected the rectangle side line");
      const [start, end] = [line.startPointId, line.endPointId].map(
        (id) => definition.points.find((p) => p.pointId === id)!.position,
      );
      expect(
        Math.hypot(end![0] - start![0], end![1] - start![1]),
        "the saved points carry the solved length",
      ).toBeCloseTo(row.edited, 6);
    } finally {
      await f.close();
    }
  }, 60000);

for (const row of [
  { tool: "dimensionRadius", kind: "circleRadius", initial: 1.7, radius: 18 },
  { tool: "dimensionDistance", kind: "diameter", initial: 3.4, radius: 9 },
] as const)
  it(`edited circle ${row.kind} (${row.tool}) solves, finishes the sketch and saves the edited value and radius`, async () => {
    const f = await createSketchWorkflow();
    try {
      const created = await f.author({
        kind: "circle",
        center: [0, 0],
        radius: 5,
      });
      expect(
        created.discovery!.sketch!.requirements,
        "the Circle tool authors no size",
      ).toEqual([]);
      const circle = created.discovery!.sketch!.entities[0]!.entityId;
      const edited = await addThenEdit(f, row.tool, circle, row.initial, 18);
      expect(edited.discovery!.sketch!.requirements).toMatchObject([
        { kind: row.kind, value: 18 },
      ]);
      expect(
        edited.discovery!.sketch!.entities[0]!.radius,
        "solved radius",
      ).toBeCloseTo(row.radius, 6);
      expect(edited.discovery!.sketch!.profiles).toHaveLength(1);

      const definition = await publishAndSave(f);
      expect(
        definition.dimensions.map((d) => [
          d.kind,
          "entityId" in d ? d.entityId : null,
          "value" in d && d.value?.source === "literal" ? d.value.value : null,
        ]),
      ).toEqual([[row.kind, circle, 18]]);
      const saved = definition.entities.find((e) => e.entityId === circle)!;
      if (saved.kind !== "circle") throw new Error("Expected the circle");
      expect(
        saved.radius,
        "the saved circle carries the solved radius",
      ).toBeCloseTo(row.radius, 6);
    } finally {
      await f.close();
    }
  }, 60000);
