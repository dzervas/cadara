import { expect, test } from "vitest";
import { readFileSync } from "node:fs";

import { readSplitInterfaceFaceQuery } from "@/domain/import/onshape/split-interface-face-query-reader";

const fixture = JSON.parse(readFileSync(
  "test/fixtures/onshape-captures/9841e486906fa2ce62d74d8e.onshape-capture.json",
  "utf8",
));

function featureNamed(label: string) {
  return fixture.partStudios[0].features.features.find(
    (candidate: { name: string }) => candidate.name === label,
  );
}

function sketchPlaneQuery(label: string) {
  return featureNamed(label).parameters.find(
    (parameter: { parameterId: string }) => parameter.parameterId === "sketchPlane",
  ).queries[0].queryString as string;
}

// Lane: logic. Seam: the reader returns the source-authored sketch entity id
// the query names, never a positional or inverted label.
test("decodes 9841's exact split-interface supports to their authored Cutter entities", () => {
  const cutter = featureNamed("Cutter");
  const cutterEntityIds = (cutter.entities as { entityId: string }[]).map(
    (entity) => entity.entityId,
  );
  const sketch3 = readSplitInterfaceFaceQuery(sketchPlaneQuery("Sketch 3"));
  const sketch4 = readSplitInterfaceFaceQuery(sketchPlaneQuery("Sketch 4"));
  expect(sketch3).toEqual({
    profileSketchFeatureId: cutter.featureId,
    profileSourceEntityId: "ZFNETMCD9zyJ.0",
    toolExtrudeFeatureId: featureNamed("Extrude 4").featureId,
    splitFeatureId: featureNamed("Split 1").featureId,
  });
  expect(sketch4).toEqual({ ...sketch3, profileSourceEntityId: "ZFNETMCD9zyJ.1" });
  expect(cutterEntityIds, "Both decoded ids must name entities Cutter actually authors.").toEqual(
    expect.arrayContaining([sketch3!.profileSourceEntityId, sketch4!.profileSourceEntityId]),
  );
});

test("rejects malformed or incomplete split-interface query forms", () => {
  const query = sketchPlaneQuery("Sketch 3");
  expect(readSplitInterfaceFaceQuery(query.replace("SWEPT_FACE", "CAP_FACE"))).toBeNull();
  expect(readSplitInterfaceFaceQuery(query.replace("SPLIT_SURFACE_INTERSECT", "SPLIT"))).toBeNull();
  expect(readSplitInterfaceFaceQuery(query.replace("isFromBackBodyT", "isFromBackBodyF"))).toBeNull();
  expect(readSplitInterfaceFaceQuery(query.replace("wireOpS9", "wireXpS9"))).toBeNull();
});
