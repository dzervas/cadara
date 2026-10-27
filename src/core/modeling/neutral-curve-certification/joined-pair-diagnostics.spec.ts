import { expect, test } from "vitest";
import type {
  NeutralCurve,
  NeutralCurveJoinLocation,
} from "@/contracts/modeling/neutral-curve-query";
import { createCertifiedNeutralCurveQuery } from "./query";

// Logic lane: the real certified owner reports the failing side/location,
// including both cubic ends and both request orders, without partial witnesses.
test.each(["start", "end"] as const)(
  "zero %s tangent retains culprit context in either pair order",
  (location) => {
    const cubic: NeutralCurve = {
      curveId: "cubic",
      kind: "cubicBezier",
      sourceDomain: [0, 1],
      provenance: { sourceEntityId: "spline", sourceSpanId: "span" },
      poles:
        location === "start"
          ? [[0, 0], [0, 0], [1, 1], [2, 0]]
          : [[0, 0], [1, 1], [2, 0], [2, 0]],
    };
    const line: NeutralCurve = {
      curveId: "line",
      kind: "line",
      form: "endpointSegment",
      sourceDomain: [0, 1],
      provenance: { sourceEntityId: "line", sourceSpanId: "whole" },
      start: location === "start" ? [0, 0] : [2, 0],
      end: [3, 1],
    };
    const query = createCertifiedNeutralCurveQuery();
    for (const swapped of [false, true]) {
      const first: NeutralCurveJoinLocation = swapped ? "start" : location;
      const second: NeutralCurveJoinLocation = swapped ? location : "start";
      expect(
        query.queryJoin({
          modelingTolerance: 0.001,
          first: swapped ? line : cubic,
          second: swapped ? cubic : line,
          joins: [{ first, second }],
        }),
      ).toEqual({
        kind: "uncertain",
        code: "join-zero-end-tangent",
        message: "A cubic has a zero tangent at a declared join location.",
        culprit: { side: swapped ? "second" : "first", location },
      });
    }
  },
);
