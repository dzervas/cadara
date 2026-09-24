import { expect, test } from "vitest";

import { getSurfaceExtrudeGeneratedSideFaceEndRole } from "@/contracts/modeling/feature-extents";

// Lane: logic. Seam: authored surface-extrude extent maps to the native side-face provenance role.
test("maps surface extrude extent modes to generated-side-face roles", () => {
  expect(
    getSurfaceExtrudeGeneratedSideFaceEndRole({
      resultBodyType: "surface",
      extent: { mode: "oneSide" },
    }),
  ).toBe("one-side-end");
  expect(
    getSurfaceExtrudeGeneratedSideFaceEndRole({
      resultBodyType: "surface",
      extent: { mode: "symmetric" },
    }),
  ).toBe("combined-ends");
  expect(
    getSurfaceExtrudeGeneratedSideFaceEndRole({
      resultBodyType: "surface",
      extent: { mode: "twoSide" },
    }),
  ).toBe("combined-ends");
  expect(
    getSurfaceExtrudeGeneratedSideFaceEndRole({
      resultBodyType: "solid",
      extent: { mode: "oneSide" },
    }),
  ).toBeNull();
});
