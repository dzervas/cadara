import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { SemanticSketchPrimitive } from "@/contracts/semantic/schema";

const variants: {
  label: string;
  primitives: SemanticSketchPrimitive[];
  kinds: string[];
  value: number;
  expected: number;
  kind: string;
}[] = [
  {
    label: "diameter",
    primitives: [{ kind: "circle", center: [0, 0], radius: 5 }],
    kinds: ["sketchEntity"],
    value: 16,
    expected: 16,
    kind: "diameter",
  },
  {
    label: "line length",
    primitives: [{ kind: "line", start: [0, 0], end: [10, 0] }],
    kinds: ["sketchEntity"],
    value: 15,
    expected: 15,
    kind: "lineLength",
  },
  {
    label: "parallel line distance",
    primitives: [
      { kind: "line", start: [0, 0], end: [10, 0] },
      { kind: "line", start: [0, 4], end: [10, 4] },
    ],
    kinds: ["sketchEntity", "sketchEntity"],
    value: 7,
    expected: 7,
    kind: "lineDistance",
  },
  {
    label: "line angle in degrees",
    primitives: [
      { kind: "line", start: [0, 0], end: [10, 0] },
      { kind: "line", start: [0, 0], end: [0, 10] },
    ],
    kinds: ["sketchEntity", "sketchEntity"],
    value: 60,
    expected: Math.PI / 3,
    kind: "lineAngle",
  },
  {
    label: "point line distance",
    primitives: [
      { kind: "point", position: [5, 4] },
      { kind: "line", start: [0, 0], end: [10, 0] },
    ],
    kinds: ["sketchPoint", "sketchEntity"],
    value: 6,
    expected: 6,
    kind: "linePointDistance",
  },
  {
    label: "aligned point distance",
    primitives: [
      { kind: "point", position: [0, 0] },
      { kind: "point", position: [3, 4] },
    ],
    kinds: ["sketchPoint", "sketchPoint"],
    value: 10,
    expected: 10,
    kind: "distance",
  },
];

it.each(variants)(
  "authors $label through the existing distance owner and measures it without adding another driver",
  async ({ primitives, kinds, value, expected, kind }) => {
    const f = await createSketchWorkflow();
    try {
      const targets = [];
      for (const [i, primitive] of primitives.entries()) {
        const old = f.current().discovery!.references;
        const created = await f.execute({
          operation: "sketch.author",
          draft: f.current().discovery!.state.draft,
          primitive,
          construction: false,
          intent: "fulfill",
        });
        targets.push(
          created.discovery!.references.find(
            (r) =>
              r.target.kind === kinds[i] &&
              !old.some(
                (p) => JSON.stringify(p.target) === JSON.stringify(r.target),
              ),
          )!.target,
        );
      }
      const added = await f.execute({
        operation: "sketch.requirement.add",
        draft: f.current().discovery!.state.draft,
        tool: "dimensionDistance",
        targets,
        mode: "driving",
        value,
        intent: "fulfill",
      });
      expect(added.discovery!.sketch!.requirements).toMatchObject([
        { kind, value: expected },
      ]);
      expect(
        added.discovery!.sketch!.requirements[0]!.measuredValue,
      ).toBeCloseTo(expected, 5);
      const measured = await f.execute({
        operation: "sketch.requirement.add",
        draft: added.discovery!.state.draft,
        tool: "dimensionDistance",
        targets,
        mode: "reference",
        value: null,
        intent: "fulfill",
      });
      expect(measured.discovery!.sketch!.requirements).toHaveLength(1);
      expect(measured.discovery!.sketch!.measurements[0]).toMatchObject({
        kind,
        mode: "reference",
      });
      expect(
        measured.discovery!.sketch!.measurements[0]!.measuredValue,
      ).toBeCloseTo(expected, 5);
      expect(measured.discovery!.sketch!.points).toEqual(
        added.discovery!.sketch!.points,
      );
      const dimensionId =
        measured.discovery!.sketch!.requirements[0]!.dimensionId;
      const removed = await f.execute({
        operation: "sketch.requirement.remove",
        draft: measured.discovery!.state.draft,
        targets: [
          {
            kind: "dimension",
            sketchId:
              targets[0]!.kind === "sketchPoint" ||
              targets[0]!.kind === "sketchEntity"
                ? targets[0]!.sketchId
                : null,
            dimensionId,
          },
        ],
        intent: "fulfill",
      });
      expect(removed.discovery!.sketch!.requirements).toEqual([]);
      expect(removed.discovery!.sketch!.measurements).toHaveLength(1);
    } finally {
      await f.close();
    }
  },
  60000,
);

it("updates line angles using degree inputs while retaining authored radians", async () => {
  const f = await createSketchWorkflow();
  try {
    for (const end of [
      [10, 0],
      [0, 10],
    ])
      await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: { kind: "line", start: [0, 0], end },
        construction: false,
        intent: "fulfill",
      });
    const targets = f
      .current()
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .map((r) => r.target);
    const added = await f.execute({
      operation: "sketch.requirement.add",
      draft: f.current().discovery!.state.draft,
      tool: "dimensionDistance",
      targets,
      mode: "driving",
      value: 60,
      intent: "fulfill",
    });
    const dimensionId = added.discovery!.sketch!.requirements[0]!.dimensionId;
    const changed = await f.execute({
      operation: "sketch.dimension.update",
      draft: added.discovery!.state.draft,
      dimensionId,
      value: 30,
      intent: "fulfill",
    });
    expect(changed.discovery!.sketch!.requirements[0]).toMatchObject({
      dimensionId,
      kind: "lineAngle",
      value: Math.PI / 6,
    });
    expect(
      changed.discovery!.sketch!.requirements[0]!.measuredValue,
    ).toBeCloseTo(Math.PI / 6, 5);
  } finally {
    await f.close();
  }
}, 60000);

it.each(["dimensionDistance", "dimensionRadius"])(
  "dimensions a production-bound arc with %s while retaining endpoint bindings",
  async (tool) => {
    const f = await createSketchWorkflow();
    try {
      const created = await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: {
          kind: "centerPointArc",
          center: [0, 0],
          start: [5, 0],
          end: [0, 5],
        },
        construction: false,
        intent: "fulfill",
      });
      const target = created.discovery!.references.find(
        (r) => r.target.kind === "sketchEntity",
      )!.target;
      if (tool === "dimensionRadius") {
        // The production circleRadius owner has no arc scalar or measurement; do not expand it or certify an authored-but-unsolved radius.
        const refused = await f.run({
          operation: "sketch.requirement.add",
          draft: created.discovery!.state.draft,
          tool,
          targets: [target],
          mode: "driving",
          value: 8,
          intent: "fulfill",
        });
        expect(refused.outcome.kind).toBe("rejected");
        expect(refused.completion.live.kind).toBe("unchanged");
        expect(
          refused.diagnostics.some((d) => d.message.includes("arc diameter")),
        ).toBe(true);
        const inspected = await f.execute({
          operation: "sketch.inspect",
          draft: created.discovery!.state.draft,
        });
        expect(inspected.discovery!.sketch).toEqual(created.discovery!.sketch);
        return;
      }
      const added = await f.execute({
        operation: "sketch.requirement.add",
        draft: created.discovery!.state.draft,
        tool,
        targets: [target],
        mode: "driving",
        value: 16,
        intent: "fulfill",
      });
      expect(added.discovery!.sketch!.entities[0]!.radius).toBeCloseTo(8, 5);
      expect(
        added.discovery!.sketch!.requirements.map((r) => r.dimensionId),
      ).toEqual(
        expect.arrayContaining(
          created.discovery!.sketch!.requirements.map((r) => r.dimensionId),
        ),
      );
      const numeric = added.discovery!.sketch!.requirements.find(
        (r) => r.kind === "diameter",
      )!;
      expect(numeric.value).toBe(16);
      expect(numeric.measuredValue).toBeCloseTo(numeric.value!, 5);
    } finally {
      await f.close();
    }
  },
  60000,
);
