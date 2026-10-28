import { expect, test } from "vitest";
import { offsetSession } from "@/core/editor/sketch-offset.fixtures";
import {
  beginSketchAnnotationEdit,
  patchSketchAnnotationEditValue,
} from "./annotation-editing";
import { evaluateAuthoredSketchDerivations } from "@/core/modeling/sketch-dimension-expressions";
import { getSketchSessionDerivationSettings } from "./session-definition";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";

test("committed offset distance uses the annotation editor, stages text, cancels without mutation and commits in place", () => {
  const { session, relationship } = offsetSession("circle");
  const target = {
    kind: "offsetDistance" as const,
    derivationId: relationship.derivationId,
  };
  const opened = beginSketchAnnotationEdit(session, target);
  expect(opened.toolPresentation?.floatingInput).toMatchObject({
    label: "Offset distance",
    value: "0.5",
  });
  const typed = patchSketchAnnotationEditValue(opened, { value: "2*depth" });
  expect(typed.toolPresentation?.floatingInput?.value).toBe("2*depth");
  expect(typed.definition).toBe(session.definition);
  const cancelled = patchSketchAnnotationEditValue(typed, {
    intent: "cancelAnnotationValue",
  });
  expect(cancelled.definition).toBe(session.definition);
  expect(cancelled.activeAnnotationEdit).toBeNull();

  const edited = patchSketchAnnotationEditValue(
    patchSketchAnnotationEditValue(opened, { value: 0.25 }),
    { intent: "commitAnnotationValue" },
  );
  expect(edited.activeAnnotationEdit).toBeNull();
  expect(edited.toolPresentation).toBeNull();
  expect(edited.definition.derivedRelationships).toEqual([
    { ...relationship, distance: { source: "literal", value: 0.25 } },
  ]);
  expect(edited.definition.entityIds).toEqual(session.definition.entityIds);
  const output = edited.definition.entities.find(
    (e) => e.entityId === relationship.outputs[0]!.outputEntityId,
  );
  expect(output?.kind === "circle" && output.radius).toBeCloseTo(0.75);
});

for (const [value, code] of [
  ["missingDepth", OFFSET_DIAGNOSTIC_CODES.unresolvedDistance],
  ["2*", OFFSET_DIAGNOSTIC_CODES.unresolvedDistance],
  [2, OFFSET_DIAGNOSTIC_CODES.arcCollapse],
] as const) {
  test(`offset edit ${value} retains the relationship and reports ${code}`, () => {
    const { session, relationship } = offsetSession("circle");
    const opened = beginSketchAnnotationEdit(session, {
      kind: "offsetDistance",
      derivationId: relationship.derivationId,
    });
    const edited = patchSketchAnnotationEditValue(
      patchSketchAnnotationEditValue(opened, { value }),
      { intent: "commitAnnotationValue" },
    );
    const evaluation = evaluateAuthoredSketchDerivations({
      definition: edited.definition,
      ...getSketchSessionDerivationSettings(edited),
    });
    expect(evaluation.offsetFailures.map((f) => f.diagnostic.code)).toContain(
      code,
    );
    expect(edited.definition.derivedRelationships).toHaveLength(1);
    expect(edited.definition.entities).toEqual(session.definition.entities);
    expect(edited.definition.points).toEqual(session.definition.points);
  });
}
