import { test, expect } from "vitest";

import { readSketchEntityVertexQuery } from "@/domain/import/onshape/sketch-point-query-reader";

/**
 * Exact captured 9841 `Extrude 1` bound query: an UP_TO_VERTEX terminator that
 * names the START vertex of sketch entity `QXXzcFIdjHpM.top` in the
 * `Screen Outline` sketch.
 */
const CAPTURED_9841_EXTRUDE_1_BOUND =
  'query=qCompressed(1.0,"%B5$QueryM5Sa$entityTypeBa$EntityTypeS6$VERTEXSb$historyTypeS8$CREATIONSb$operationIdB2$IdA1S11.6$FNWh4UXQeC9pSkq_0wireOpS9$queryTypeSd$SKETCH_ENTITYSe$sketchEntityIdSc.3.5$QXXzcFIdjHpMtopstart",id);';

test("reads the exact sketch feature, entity, and endpoint role from a captured vertex query", () => {
  expect(readSketchEntityVertexQuery(CAPTURED_9841_EXTRUDE_1_BOUND)).toEqual({
    sketchFeatureId: "FNWh4UXQeC9pSkq_0",
    sketchEntityId: "QXXzcFIdjHpM.top",
    role: "start",
  });
});

test("rejects every query that is not an exact sketch-entity vertex reference", () => {
  const notCompressed = 'query = qCreatedBy(id + "FOO", EntityType.VERTEX);';
  const notAVertex = CAPTURED_9841_EXTRUDE_1_BOUND.replace("S6$VERTEX", "S4$FACE");
  const notASketchEntity = CAPTURED_9841_EXTRUDE_1_BOUND.replace(
    "Sd$SKETCH_ENTITY",
    "Sb$BODY_LINEAGE",
  );
  const truncatedPayload = CAPTURED_9841_EXTRUDE_1_BOUND.replace(
    "Sc.3.5$QXXzcFIdjHpMtopstart",
    "Sc.3.5$QXX",
  );

  for (const query of [
    null,
    undefined,
    "",
    notCompressed,
    notAVertex,
    notASketchEntity,
    truncatedPayload,
  ]) {
    expect(
      readSketchEntityVertexQuery(query),
      `Only an exact sketch-entity vertex query may resolve; got a result for ${String(query)}.`,
    ).toBeNull();
  }
});
