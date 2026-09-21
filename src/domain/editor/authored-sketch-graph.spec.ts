import { expect, test } from "vitest";
import {
  acceptSketchDraw,
  beginSketchAnnotationEdit,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deleteSelectedSketchAnnotation,
  deleteSelectedSketchGeometry,
  deriveSketchDisplayEntities,
  patchSketchConstraintValue,
  selectSketchAnnotation,
  selectSketchConstraintTarget,
  startSketchDraw,
} from "@/domain/editor/sketch-session";

function rectangle() {
  const session = createNewSketchSessionFromSupport({
    kind: "construction",
    constructionId: "construction_plane-xy",
  });
  return acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [0, 0]),
    [4, 2],
  );
}

test("rectangle candidates retain only their authored graph and deletion updates commit/display", () => {
  const source = rectangle();
  expect(source.definition.entities).toHaveLength(4);
  expect(source.definition.constraints).toHaveLength(4);
  expect(source.definition.dimensions).toHaveLength(2);
  expect(source.definition).not.toHaveProperty("authoringOperations");
  const entityId = source.definition.entityIds[0]!;
  const deleted = deleteSelectedSketchGeometry(source, [
    { kind: "sketchEntity", sketchId: "sketch_draft", entityId },
  ]);
  expect(deleted.definition.entities).toHaveLength(3);
  expect(deleted.definition.entityIds).not.toContain(entityId);
  expect(deleted.commitRequest?.definition.entityIds).not.toContain(entityId);
  expect(
    deriveSketchDisplayEntities(deleted).some(
      (entity) => entity.entityId === entityId,
    ),
  ).toBe(false);
  expect(source.definition.entities).toHaveLength(4);
});

test("numeric edits update the current authored value rather than reconstruction metadata", () => {
  const source = rectangle();
  const dimension = source.definition.dimensions.find((d) =>
    d.label.includes("width"),
  )!;
  let edited = beginSketchAnnotationEdit(source, {
    kind: "dimension",
    sketchId: "sketch_draft",
    dimensionId: dimension.dimensionId,
  });
  edited = patchSketchConstraintValue(edited, { value: 6 });
  edited = patchSketchConstraintValue(edited, {
    intent: "commitAnnotationValue",
  });
  expect(
    edited.definition.dimensions.find(
      (d) => d.dimensionId === dimension.dimensionId,
    )?.value,
  ).toEqual({ source: "literal", value: 6 });
  expect(
    edited.commitRequest?.definition.dimensions.find(
      (d) => d.dimensionId === dimension.dimensionId,
    )?.value,
  ).toEqual({ source: "literal", value: 6 });
  expect(edited.definition).not.toHaveProperty("authoringOperations");
});

test("constraint add/delete/add uses fresh identity without resurrecting a deleted record", () => {
  let session = rectangle();
  const [first, , opposite] = session.definition.entityIds;
  function add() {
    session = beginSketchTool(session, "constraintEqual");
    for (const entityId of [first!, opposite!])
      session = selectSketchConstraintTarget(session, {
        kind: "sketchEntity",
        sketchId: "sketch_draft",
        entityId,
      });
  }
  add();
  const original = session.definition.constraints.find(
    (c) => c.kind === "equalLength",
  )!;
  expect(original).toBeDefined();
  session = selectSketchAnnotation(session, {
    kind: "constraint",
    sketchId: "sketch_draft",
    constraintId: original.constraintId,
  });
  session = deleteSelectedSketchAnnotation(session);
  expect(session.definition.constraintIds).not.toContain(original.constraintId);
  add();
  const recreated = session.definition.constraints.filter(
    (c) => c.kind === "equalLength",
  );
  expect(recreated).toHaveLength(1);
  expect(recreated[0]!.constraintId).not.toBe(original.constraintId);
});

test("geometry delete/recreate allocates fresh authored identities", () => {
  const source = rectangle();
  let session = deleteSelectedSketchGeometry(
    source,
    source.definition.entityIds.map((entityId) => ({
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId,
    })),
  );
  expect(session.definition.entities).toHaveLength(0);
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [6, 0]),
    [9, 3],
  );
  expect(session.definition.entities).toHaveLength(4);
  expect(
    session.definition.entityIds.some((id) =>
      source.definition.entityIds.includes(id),
    ),
  ).toBe(false);
});
