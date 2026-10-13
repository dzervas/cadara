import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("refuses extra, duplicate, foreign and unsupported requirement operands and invalid modes without changing the draft", async () => {
  const f = await createSketchWorkflow();
  try {
    const created = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 5 },
      construction: false,
      intent: "fulfill",
    });
    const circle = created.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const center = created.discovery!.references.find(
      (r) => r.target.kind === "sketchPoint",
    )!.target;
    const cases = [
      {
        tool: "dimensionRadius",
        targets: [circle, center],
        mode: "driving",
        value: 8,
      },
      {
        tool: "dimensionDistance",
        targets: [circle, center],
        mode: "driving",
        value: 8,
      },
      {
        tool: "constraintConcentric",
        targets: [circle, circle],
        mode: "driving",
        value: null,
      },
      {
        tool: "constraintEqual",
        targets: [circle, center],
        mode: "driving",
        value: null,
      },
      {
        tool: "constraintHorizontal",
        targets: [circle],
        mode: "driving",
        value: null,
      },
      {
        tool: "constraintFix",
        targets: [center],
        mode: "reference",
        value: null,
      },
      { tool: "constraintFix", targets: [center], mode: "driving", value: 5 },
      {
        tool: "dimensionRadius",
        targets: [circle],
        mode: "reference",
        value: 5,
      },
      { tool: "dimensionRadius", targets: [], mode: "driving", value: 8 },
      {
        tool: "dimensionRadius",
        targets: [{ ...circle, sketchId: "sketch_foreign" }],
        mode: "driving",
        value: 8,
      },
      {
        tool: "dimensionDistance",
        targets: [
          center,
          {
            kind: "sketchDatumReference",
            sketchId: "sketch_foreign",
            datumId: "origin",
            geometryKind: "point",
          },
        ],
        mode: "driving",
        value: 8,
      },
      {
        tool: "dimensionDistance",
        targets: [
          center,
          {
            kind: "sketchDatumReference",
            sketchId: "sketch_foreign",
            datumId: "origin",
            geometryKind: "lineSegment",
          },
        ],
        mode: "driving",
        value: 8,
      },
      { tool: "dimensionRadius", targets: [circle], mode: "driving", value: 0 },
    ];
    for (const input of cases) {
      const refused = await f.run({
        operation: "sketch.requirement.add",
        draft: created.discovery!.state.draft,
        ...input,
        intent: "author-invalid",
      });
      expect(refused.outcome.kind, JSON.stringify({ input, refused })).toBe(
        "rejected",
      );
      expect(refused.completion.live.kind).toBe("unchanged");
      const inspected = await f.execute({
        operation: "sketch.inspect",
        draft: created.discovery!.state.draft,
      });
      expect(inspected.discovery!.sketch).toEqual(created.discovery!.sketch);
      expect(inspected.discovery!.history).toEqual(created.discovery!.history);
    }
  } finally {
    await f.close();
  }
}, 60000);

it.each(["fulfill", "author-invalid"])(
  "correlates a real fixed-point dimension conflict requested as %s and permits requirement removal to repair it",
  async (intent) => {
    const f = await createSketchWorkflow();
    try {
      const created = await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: { kind: "circle", center: [0, 0], radius: 5 },
        construction: false,
        intent: "fulfill",
      });
      const circle = created.discovery!.references.find(
        (r) => r.target.kind === "sketchEntity",
      )!.target;
      const fixed = await f.execute({
        operation: "sketch.requirement.add",
        draft: created.discovery!.state.draft,
        tool: "constraintFix",
        targets: [circle],
        mode: "driving",
        value: null,
        intent: "fulfill",
      });
      expect(fixed.discovery!.sketch!.constraints).toMatchObject([
        { kind: "fixPoint", status: "satisfied" },
      ]);
      expect(fixed.discovery!.sketch!.requirements).toMatchObject([
        { kind: "diameter", value: 10 },
      ]);
      const conflict = await f.run({
        operation: "sketch.requirement.add",
        draft: fixed.discovery!.state.draft,
        tool: "dimensionRadius",
        targets: [circle],
        mode: "driving",
        value: 8,
        intent,
      });
      expect(conflict.outcome.kind).toBe(
        intent === "author-invalid" ? "accepted-invalid" : "failed",
      );
      expect(conflict.completion.live.kind).toBe("applied");
      expect(conflict.completion.geometry.kind).toBe("invalid-editable");
      expect(
        conflict.completion.geometry.kind !== "not-required" &&
          conflict.completion.geometry.sketchBasis,
      ).toEqual(conflict.discovery!.state.draft);
      expect(conflict.diagnostics.length).toBeGreaterThan(0);
      expect(conflict.discovery!.sketch!.profiles).toEqual([]);
      const requirement = conflict.discovery!.references.find(
        (r) => r.target.kind === "dimension" && r.label.startsWith("Radius"),
      )!.target;
      const repaired = await f.execute({
        operation: "sketch.requirement.remove",
        draft: conflict.discovery!.state.draft,
        targets: [requirement],
        intent: "fulfill",
      });
      expect(repaired.completion.geometry.kind).toBe("current");
      expect(repaired.discovery!.sketch!.entities[0]!.radius).toBeCloseTo(5, 6);
    } finally {
      await f.close();
    }
  },
  60000,
);
