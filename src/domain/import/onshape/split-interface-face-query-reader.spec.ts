import { expect, test } from "vitest";
import { readFileSync } from "node:fs";

import { readSplitInterfaceFaceQuery } from "@/domain/import/onshape/split-interface-face-query-reader";

const fixture = JSON.parse(readFileSync(
  "test/fixtures/onshape-captures/9841e486906fa2ce62d74d8e.onshape-capture.json",
  "utf8",
));

function sketchPlaneQuery(label: string) {
  const feature = fixture.partStudios[0].features.features.find(
    (candidate: { name: string }) => candidate.name === label,
  );
  return feature.parameters.find(
    (parameter: { parameterId: string }) => parameter.parameterId === "sketchPlane",
  ).queries[0].queryString as string;
}

test("decodes 9841's exact split-interface supports for both Cutter entities", () => {
  expect(readSplitInterfaceFaceQuery(sketchPlaneQuery("Sketch 3"))).toMatchObject({
    profileEntityId: "c.1",
    endRole: "one-side-end",
  });
  expect(readSplitInterfaceFaceQuery(sketchPlaneQuery("Sketch 4"))).toMatchObject({
    profileEntityId: "c.0",
    endRole: "one-side-end",
  });
});

test("rejects malformed or incomplete split-interface query forms", () => {
  const query = sketchPlaneQuery("Sketch 3");
  expect(readSplitInterfaceFaceQuery(query.replace("SWEPT_FACE", "CAP_FACE"))).toBeNull();
  expect(readSplitInterfaceFaceQuery(query.replace("SPLIT_SURFACE_INTERSECT", "SPLIT"))).toBeNull();
  expect(readSplitInterfaceFaceQuery(query.replace("isFromBackBodyT", "isFromBackBodyF"))).toBeNull();
});
