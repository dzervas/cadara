import { test, expect } from "vitest";

import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  acceptSketchDraw,
  beginSketchAnnotationEdit,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  deleteSelectedSketchAnnotation,
  deleteSelectedSketchGeometry,
  deriveSketchDisplayEntities,
  getSketchHistoryItems,
  moveSketchHistoryCursor,
  patchSketchConstraintValue,
  selectSketchAnnotation,
  selectSketchConstraintTarget,
  startSketchDraw,
} from "@/domain/editor/sketch-session";

test("src/domain/editor/durable-sketch-authoring-operations.spec.ts", () => {
  function createRectangleSession() {
    let session = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });
    session = beginSketchTool(session, "rectangle");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 2]);
    return session;
  }

  const rectangle = createRectangleSession();
  const rectangleOperation = rectangle.fullDefinition.authoringOperations?.[0];
  expect(
    rectangleOperation?.kind,
    "Rectangle creation should append one rectangle operation.",
  ).toBe("rectangle");
  expect(
    rectangle.fullDefinition.authoringOperations?.length,
    "One accepted rectangle action should create one operation row.",
  ).toBe(1);
  expect(
    rectangleOperation.targets.created?.filter(
      (target) => target.kind === "entity",
    ).length,
    "Rectangle operation should reference created line entities.",
  ).toBe(4);
  expect(
    rectangleOperation.targets.created?.filter(
      (target) => target.kind === "constraint",
    ).length,
    "Rectangle operation should include constructor constraints.",
  ).toBe(4);
  expect(
    rectangleOperation.targets.created?.filter(
      (target) => target.kind === "dimension",
    ).length,
    "Rectangle operation should include constructor dimensions.",
  ).toBe(2);
  expect(
    getSketchHistoryItems(rectangle.fullDefinition).length,
    "Sketch history should show one rectangle operation row.",
  ).toBe(1);

  const edgeId = rectangle.definition.entityIds[0];
  expect(edgeId, "Rectangle should create an edge to delete.").toBeTruthy();
  const deleted = deleteSelectedSketchGeometry(rectangle, [
    { kind: "sketchEntity", sketchId: "sketch_draft", entityId: edgeId },
  ]);
  const deleteOperation = deleted.fullDefinition.authoringOperations?.[1];
  expect(
    deleteOperation?.kind,
    "Deleting rectangle geometry should append a delete operation.",
  ).toBe("delete");
  expect(
    deleted.definition.entityIds.length,
    "Deleted geometry should be removed from the live flat graph.",
  ).toBe(3);
  expect(
    deleted.definition.entityIds.includes(edgeId),
    "Deleted edge should be absent from the current definition.",
  ).toBeFalsy();
  expect(
    deleted.commitRequest?.definition.entityIds.includes(edgeId),
    "Deleted edge should be absent from commit payloads.",
  ).toBeFalsy();
  expect(
    deriveSketchDisplayEntities(deleted).some(
      (entity) => entity.entityId === edgeId,
    ),
    "Deleted edge should be absent from renderable sketch display output.",
  ).toBeFalsy();

  const rolledBack = moveSketchHistoryCursor(deleted, {
    kind: "item",
    itemId: rectangleOperation.operationId,
  });
  expect(
    rolledBack.definition.entityIds.length,
    "Cursor rollback before delete should rebuild the rectangle graph.",
  ).toBe(4);
  const rolledForward = moveSketchHistoryCursor(deleted, {
    kind: "item",
    itemId: deleteOperation.operationId,
  });
  expect(
    rolledForward.definition.entityIds.length,
    "Cursor at delete operation should keep deleted members absent.",
  ).toBe(3);

  const widthDimension = rectangle.definition.dimensions.find((dimension) =>
    dimension.label.includes("width"),
  );
  expect(
    widthDimension,
    "Rectangle should create an editable width dimension.",
  ).toBeTruthy();
  let edited = beginSketchAnnotationEdit(rectangle, {
    kind: "dimension",
    sketchId: "sketch_draft",
    dimensionId: widthDimension.dimensionId,
  });
  edited = patchSketchConstraintValue(edited, { value: 6 });
  edited = patchSketchConstraintValue(edited, {
    intent: "commitAnnotationValue",
  });
  expect(
    edited.fullDefinition.authoringOperations?.length,
    "Explicit dimension edit should not append delete/add operations.",
  ).toBe(1);
  expect(
    edited.definition.dimensions.find(
      (dimension) => dimension.dimensionId === widthDimension.dimensionId,
    )?.value,
    "Explicit dimension edit should update the live graph value.",
  ).toEqual({ source: "literal", value: 6 });
  expect(
    edited.fullDefinition.authoringOperations?.[0]?.createdGraph?.dimensions?.find(
      (dimension) => dimension.dimensionId === widthDimension.dimensionId,
    )?.value,
    "Explicit dimension edit should update the original operation metadata.",
  ).toEqual({ source: "literal", value: 6 });

  const graphWithMetadata = rectangle.fullDefinition;
  const graphWithDifferentMetadata = {
    ...graphWithMetadata,
    authoringOperations: [
      {
        operationId: "sketch_operation_999_metadata_only",
        label: "Different metadata",
        kind: "operation",
        targets: { removed: [{ kind: "entity", entityId: edgeId }] },
      },
    ],
  };
  const firstSolve = solveSketchDefinitionCore({
    definition: graphWithMetadata,
    projectedReferences: [],
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: "bestEffort",
  });
  const secondSolve = solveSketchDefinitionCore({
    definition: graphWithDifferentMetadata,
    projectedReferences: [],
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: "bestEffort",
  });
  expect(
    JSON.stringify(firstSolve.solvedSnapshot.solvedEntities),
    "Different operation metadata over the same flat graph should not change solved output.",
  ).toBe(JSON.stringify(secondSolve.solvedSnapshot.solvedEntities));

  let constraintSession = createRectangleSession();
  const firstEdge = constraintSession.definition.entityIds[0];
  const oppositeEdge = constraintSession.definition.entityIds[2];
  expect(
    firstEdge && oppositeEdge,
    "Rectangle should create two edges for manual constraint testing.",
  ).toBeTruthy();
  constraintSession = beginSketchTool(constraintSession, "constraintEqual");
  constraintSession = selectSketchConstraintTarget(constraintSession, {
    kind: "sketchEntity",
    sketchId: "sketch_draft",
    entityId: firstEdge,
  });
  constraintSession = selectSketchConstraintTarget(constraintSession, {
    kind: "sketchEntity",
    sketchId: "sketch_draft",
    entityId: oppositeEdge,
  });
  const firstManualConstraint = constraintSession.definition.constraints.find(
    (constraint) => constraint.kind === "equalLength",
  );
  expect(
    firstManualConstraint,
    "Manual constraint authoring should add a live constraint.",
  ).toBeTruthy();
  expect(
    constraintSession.fullDefinition.authoringOperations?.at(-1)?.kind,
    "Manual constraint authoring should append its own operation.",
  ).toBe("constraint");

  constraintSession = selectSketchAnnotation(constraintSession, {
    kind: "constraint",
    sketchId: "sketch_draft",
    constraintId: firstManualConstraint.constraintId,
  });
  constraintSession = deleteSelectedSketchAnnotation(constraintSession);
  expect(
    constraintSession.definition.constraintIds.includes(
      firstManualConstraint.constraintId,
    ),
    "Deleted manual constraint should be absent from the live graph.",
  ).toBeFalsy();
  expect(
    constraintSession.fullDefinition.authoringOperations?.at(-1)?.kind,
    "Manual constraint deletion should append a delete operation.",
  ).toBe("delete");

  constraintSession = beginSketchTool(constraintSession, "constraintEqual");
  constraintSession = selectSketchConstraintTarget(constraintSession, {
    kind: "sketchEntity",
    sketchId: "sketch_draft",
    entityId: firstEdge,
  });
  constraintSession = selectSketchConstraintTarget(constraintSession, {
    kind: "sketchEntity",
    sketchId: "sketch_draft",
    entityId: oppositeEdge,
  });
  const liveEqualLengthConstraints =
    constraintSession.definition.constraints.filter(
      (constraint) => constraint.kind === "equalLength",
    );
  expect(
    liveEqualLengthConstraints.length,
    "Add/delete/add constraint flow should leave only the newly added live constraint.",
  ).toBe(1);
  expect(
    liveEqualLengthConstraints[0]?.constraintId,
    "Recreated constraint should have a new durable constraint id.",
  ).not.toBe(firstManualConstraint.constraintId);
  expect(
    constraintSession.fullDefinition.authoringOperations
      ?.map((operation) => operation.kind)
      .slice(-3)
      .join(","),
    "Durable operation history should preserve add/delete/add constraint operations in order.",
  ).toBe("constraint,delete,constraint");

  const recreatedSource = createRectangleSession();
  const firstRectangleEntityIds = [...recreatedSource.definition.entityIds];
  let recreated = deleteSelectedSketchGeometry(
    recreatedSource,
    firstRectangleEntityIds.map((entityId) => ({
      kind: "sketchEntity" as const,
      sketchId: "sketch_draft" as const,
      entityId,
    })),
  );
  expect(
    recreated.definition.entityIds.length,
    "Deleting all rectangle geometry should clear the live flat graph.",
  ).toBe(0);
  recreated = beginSketchTool(recreated, "rectangle");
  recreated = startSketchDraw(recreated, [6, 0]);
  recreated = acceptSketchDraw(recreated, [9, 3]);
  expect(
    recreated.definition.entityIds.every(
      (entityId) => !firstRectangleEntityIds.includes(entityId),
    ),
    "Rectangle delete/recreate should leave only the recreated rectangle geometry live.",
  ).toBeTruthy();
  expect(
    recreated.fullDefinition.authoringOperations
      ?.map((operation) => operation.kind)
      .join(","),
    "Durable operation history should preserve original rectangle, delete, and recreated rectangle operations.",
  ).toBe("rectangle,delete,rectangle");
});
