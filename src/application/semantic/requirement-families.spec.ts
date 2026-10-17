import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { SemanticSketchPrimitive } from "@/contracts/semantic/schema";

const line = (
  start: readonly [number, number],
  end: readonly [number, number],
): SemanticSketchPrimitive => ({ kind: "line", start, end });
const point = (
  position: readonly [number, number],
): SemanticSketchPrimitive => ({ kind: "point", position });
const circle = (
  center: readonly [number, number],
  radius: number,
): SemanticSketchPrimitive => ({ kind: "circle", center, radius });

const families = [
  {
    tool: "constraintCoincident",
    primitives: [point([0, 0]), point([1, 0])],
    operands: ["point", "point"],
    kind: "coincident",
  },
  {
    tool: "constraintCollinear",
    primitives: [line([0, 0], [10, 0]), line([2, 0], [8, 0])],
    operands: ["entity", "entity"],
    kind: "collinear",
  },
  {
    tool: "constraintParallel",
    primitives: [line([0, 0], [10, 0]), line([0, 4], [10, 4])],
    operands: ["entity", "entity"],
    kind: "parallel",
  },
  {
    tool: "constraintPerpendicular",
    primitives: [line([0, 0], [10, 0]), line([4, 0], [4, 10])],
    operands: ["entity", "entity"],
    kind: "perpendicular",
  },
  {
    tool: "constraintTangent",
    primitives: [line([-10, 5], [10, 5]), circle([0, 0], 5)],
    operands: ["entity", "entity"],
    kind: "tangent",
  },
  {
    tool: "constraintEqual",
    primitives: [line([0, 0], [10, 0]), line([0, 4], [10, 4])],
    operands: ["entity", "entity"],
    kind: "equalLength",
  },
  {
    tool: "constraintVertical",
    primitives: [line([0, 0], [2, 10])],
    operands: ["entity"],
    kind: "vertical",
  },
  {
    tool: "constraintConcentric",
    primitives: [circle([0, 0], 5), circle([0, 0], 3)],
    operands: ["entity", "entity"],
    kind: "concentric",
  },
  {
    tool: "constraintMidpoint",
    primitives: [point([5, 0]), line([0, 0], [10, 0])],
    operands: ["point", "entity"],
    kind: "midpoint",
  },
  {
    tool: "constraintNormal",
    primitives: [line([5, 0], [10, 0]), circle([0, 0], 5), point([5, 0])],
    operands: ["entity", "entity", "point"],
    kind: "normal",
  },
  {
    tool: "constraintPierce",
    primitives: [point([5, 0]), circle([0, 0], 5)],
    operands: ["point", "entity"],
    kind: "pointOnCurve",
  },
  {
    tool: "constraintSymmetric",
    primitives: [point([-2, 3]), point([2, 3]), line([0, -10], [0, 10])],
    operands: ["point", "point", "entity"],
    kind: "symmetric",
  },
  {
    tool: "constraintFix",
    primitives: [point([2, 3])],
    operands: ["point"],
    kind: "fixPoint",
  },
];

it.each(families)(
  "authors $tool on explicit production-supported operands without creating mirror copies",
  async ({ tool, primitives, operands, kind }) => {
    const f = await createSketchWorkflow();
    try {
      const targets = [];
      for (const [index, primitive] of primitives.entries()) {
        const before = f.current().discovery!.references;
        const result = await f.execute({
          operation: "sketch.author",
          draft: f.current().discovery!.state.draft,
          primitive,
          construction: false,
          intent: "fulfill",
        });
        const targetKind =
          operands[index] === "point" ? "sketchPoint" : "sketchEntity";
        targets.push(
          result.discovery!.references.find(
            (r) =>
              r.target.kind === targetKind &&
              !before.some(
                (b) => JSON.stringify(b.target) === JSON.stringify(r.target),
              ),
          )!.target,
        );
      }
      const before = f.current();
      const added = await f.execute({
        operation: "sketch.requirement.add",
        draft: before.discovery!.state.draft,
        tool,
        targets,
        mode: "driving",
        value: null,
        intent: "fulfill",
      });
      const requirement = added.discovery!.sketch!.constraints.find(
        (c) => c.kind === kind,
      );
      expect(requirement).toMatchObject({ kind, status: "satisfied" });
      expect(added.discovery!.references).toContainEqual({
        label: requirement!.label,
        target: {
          kind: "constraint",
          sketchId:
            added.discovery!.state.editingContext.kind === "sketch"
              ? added.discovery!.state.editingContext.sketchId
              : null,
          constraintId: requirement!.constraintId,
        },
      });
      expect(added.discovery!.sketch!.entities.map((e) => e.entityId)).toEqual(
        before.discovery!.sketch!.entities.map((e) => e.entityId),
      );
      expect(added.completion.geometry.kind).toBe("current");
    } finally {
      await f.close();
    }
  },
  60000,
);
