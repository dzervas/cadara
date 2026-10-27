import { expect, test } from "vitest";
import type { NeutralCurveQueryCapability } from "@/contracts/modeling/neutral-curve-query";
import {
  addRectangle,
  makeSketchFixture,
  neutralSpan,
  projectedSpline,
} from "@/contracts/sketch/region-extraction.fixtures";
import { createSketchArrangementDeriver } from "@/contracts/sketch/region-extraction";
import type { SplinePoles } from "@/contracts/sketch/spline-geometry";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";

// Verbatim solved poles of Spline 5 and Spline 10 from the read-only T18
// t18-regions-blocked-fixed.cadara capture. Project them without reconstructing
// handles so every binary64 coordinate of the expensive crossing pairs survives.
const T18_SPLINE_POLES: readonly (readonly SplinePoles[])[] = [
  [
    [
      [-1.1586143890831397, 4.240457459207461],
      [-0.1958133012820512, 4.754342301217302],
      [0.8599426531862058, 5.65983755871892],
      [1.7297888743201257, 5.782111985236986],
    ],
    [
      [1.7297888743201257, 5.782111985236986],
      [2.3819920615365238, 5.873792294644069],
      [2.9296791960205892, 5.525155961108503],
      [3.529624356870821, 5.396677949044261],
    ],
  ],
  [
    [
      [-1.414654970491223, 5.911837400051921],
      [-0.5552046039617708, 4.717479807512855],
      [0.21213513917519478, 3.050313744604548],
      [1.163696129097134, 2.3287646224347234],
    ],
    [
      [1.163696129097134, 2.3287646224347234],
      [1.8656844084552964, 1.796461352219811],
      [2.8086826646225367, 1.3569616133576066],
      [3.420050440877218, 1.503811556881109],
    ],
    [
      [3.420050440877218, 1.503811556881109],
      [3.9649699870223705, 1.6347007003464218],
      [4.753490923002855, 2.4390745509793876],
      [4.719357104408157, 2.9018418231904386],
    ],
    [
      [4.719357104408157, 2.9018418231904386],
      [4.679932505194401, 3.4363385477672224],
      [2.8266147483300994, 3.942974392876047],
      [2.7311659583020464, 4.492353976338275],
    ],
    [
      [2.7311659583020464, 4.492353976338275],
      [2.656620344172974, 4.921420059073629],
      [3.6698690565482526, 5.393468138668894],
      [3.545591096294609, 5.81470230432549],
    ],
    [
      [3.545591096294609, 5.81470230432549],
      [3.329606840879095, 6.546770544255008],
      [0.7230046576032071, 7.160751852175596],
      [-0.6882885617424944, 7.833776626100649],
    ],
  ],
];

test("an unrelated rectangle edit reuses T18 spline pair proofs and preserves complete region results", async () => {
  const sketch = makeSketchFixture();
  T18_SPLINE_POLES.forEach((spans, spline) => {
    sketch.project(`t18_${spline}`, [
      projectedSpline(
        `projected_geometry_t18_${spline}`,
        spans.map((poles, index) =>
          neutralSpan([...poles], index, [`k${index}`, `k${index + 1}`], index),
        ),
      ),
    ]);
  });
  addRectangle(sketch, "unrelated", [50, 50, 60, 60]);
  const base = createCertifiedNeutralCurveQueryCapabilityForTest();
  let cubicPairs = 0;
  const queries: NeutralCurveQueryCapability = {
    ...base,
    queryNeutralCurves: (request) => {
      if (
        request.first.kind === "cubicBezier" &&
        request.second.kind === "cubicBezier"
      )
        cubicPairs += 1;
      return base.queryNeutralCurves(request);
    },
  };
  const deriver = createSketchArrangementDeriver(queries);
  const cold = await deriver.derive(sketch.build());
  expect(
    cubicPairs,
    "the real T18 crossing geometry must exercise cubic pair certification",
  ).toBe(4);
  expect(
    cold.regions.length,
    "a spline region and the unrelated rectangle exist",
  ).toBeGreaterThan(1);

  cubicPairs = 0;
  sketch.move("unrelated0", 49, 49);
  const repeated = await deriver.derive(sketch.build());
  expect(
    cubicPairs,
    "an unrelated edit must not recertify unchanged cubic pairs",
  ).toBe(0);
  expect(repeated).toEqual(
    await createSketchArrangementDeriver(base).derive(sketch.build()),
  );
});
