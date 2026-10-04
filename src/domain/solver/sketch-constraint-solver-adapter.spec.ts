import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

import type { NeutralCurveQueryCapability } from "@/contracts/modeling/neutral-curve-query";
import type {
  DocumentId,
  RequestId,
  SketchEntityId,
} from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import {
  makeSketchFixture,
  type SketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  SOLVER_SCHEMA_VERSION,
  type QuerySketchEditIntersectionsRequest,
} from "@/contracts/solver/schema";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { createOpenCascadeNeutralCurveQueryCapability } from "@/domain/modeling/occ/neutral-curve-query";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  DEFAULT_MOCK_SKETCH_PLANE_FRAME,
  MockSketchSolverAdapter,
} from "@/domain/solver/mock-sketch-solver-adapter";
import type { DimensionId } from "@/contracts/shared/ids";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

// Adapter conformance (logic lane): `querySketchEditIntersections` on the
// real adapter (in-thread, no worker) and the mock adapter, which both run
// the one contract function (T10g-1).

const DOCUMENT = "doc_trim" as DocumentId;

function request(
  sketch: SketchFixture,
  target: string,
): QuerySketchEditIntersectionsRequest {
  const input = sketch.build();
  return {
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: "request_trim" as RequestId,
    documentId: DOCUMENT,
    revisionId: "rev_trim" as QuerySketchEditIntersectionsRequest["revisionId"],
    sketchId: input.sketchId as QuerySketchEditIntersectionsRequest["sketchId"],
    definition: input.definition,
    solvedSnapshot: input.solvedSnapshot,
    projectedReferences: [],
    modelingTolerance: input.modelingTolerance,
    operation: {
      kind: "trim",
      targetEntityId: `sketch_entity_${target}` as SketchEntityId,
    },
  };
}

const real = (queries: NeutralCurveQueryCapability) =>
  new SketchConstraintSolverAdapter({
    documentId: DOCUMENT,
    revisionId: null,
    neutralCurveQueries: queries,
  });

describe("querySketchEditIntersections adapters (T10g-1)", () => {
  test("mock parity: the mock adapter returns the real adapter's result on a shared fixture (every cutter kind, construction included)", async () => {
    const sketch = makeSketchFixture();
    sketch.point("t0", -10, 0);
    sketch.point("t1", 10, 0);
    sketch.line("target", "t0", "t1");
    sketch.point("l0", -8, -1, true);
    sketch.point("l1", -8, 1, true);
    sketch.line("construction", "l0", "l1", true);
    sketch.point("ac", -5, 0);
    sketch.point("as", -4, -1);
    sketch.point("ae", -4, 1);
    sketch.arc("arc", "ac", "as", "ae");
    sketch.point("cc", 0, 0);
    sketch.circle("circle", "cc", 1);
    sketch.point("s0", 4, -1);
    sketch.point("s1", 5, 1);
    sketch.point("s2", 6, 2);
    sketch.spline("spline", ["s0", "s1", "s2"], "open");
    const shared = request(sketch, "target");
    const queries = createCertifiedNeutralCurveQueryCapabilityForTest();
    const fromReal = await real(queries).querySketchEditIntersections(shared);
    const fromMock = await new MockSketchSolverAdapter({
      documentId: DOCUMENT,
      revisionId: "rev_trim",
      neutralCurveQueries: queries,
    }).querySketchEditIntersections(shared);
    expect(fromReal.result.kind).toBe("verified");
    expect(
      fromReal.result.kind === "verified" && fromReal.result.cuts,
    ).toHaveLength(5);
    expect(fromMock).toEqual(fromReal);
  });

  test("diameter parity (orchestrator 2026-10-04): a `diameter` on an arc (what a trimmed circle's radius becomes) drives in the core and the mock alike", async () => {
    const sketch = makeSketchFixture();
    sketch.point("o", 0, 0);
    sketch.point("a", 2, 0);
    sketch.point("b", -2, 0);
    sketch.arc("arc", "o", "a", "b");
    const definition = sketch.definition();
    const withDiameter = {
      ...definition,
      dimensionIds: ["dimension_diameter" as DimensionId],
      dimensions: [
        {
          dimensionId: "dimension_diameter" as DimensionId,
          kind: "diameter" as const,
          label: "Diameter",
          entityId: "sketch_entity_arc" as SketchEntityId,
          value: 4,
        },
      ],
    };
    const solve = {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: "request_solve" as RequestId,
      documentId: DOCUMENT,
      revisionId:
        "rev_trim" as QuerySketchEditIntersectionsRequest["revisionId"],
      sketchId:
        "sketch_arrangement" as QuerySketchEditIntersectionsRequest["sketchId"],
      plane: DEFAULT_MOCK_SKETCH_PLANE_FRAME,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort" as const,
      definition: withDiameter,
      projectedReferences: [],
    };
    const core = await real(
      createCertifiedNeutralCurveQueryCapabilityForTest(),
    ).solveSketch(solve);
    const mock = await new MockSketchSolverAdapter({
      documentId: DOCUMENT,
      revisionId: "rev_trim",
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
    }).solveSketch(solve);
    for (const response of [core, mock]) {
      expect(response.status.solveState).toBe("solved");
      expect(response.solvedSnapshot.dimensionStatuses).toEqual([
        {
          dimensionId: "dimension_diameter",
          status: core.solvedSnapshot.dimensionStatuses[0]!.status,
          solvedValue: expect.closeTo(4, 9),
        },
      ]);
    }
    expect(core.solvedSnapshot.dimensionStatuses[0]!.status).not.toBe(
      "unsatisfied",
    );
  });

  test("a request for another document is rejected before any query", async () => {
    const sketch = makeSketchFixture();
    sketch.point("t0", 0, 0);
    sketch.point("t1", 1, 0);
    sketch.line("target", "t0", "t1");
    await expect(
      real(
        createCertifiedNeutralCurveQueryCapabilityForTest(),
      ).querySketchEditIntersections({
        ...request(sketch, "target"),
        documentId: "doc_other" as DocumentId,
      }),
    ).rejects.toThrow("runtime is configured for doc_trim");
  });
});

// Review R-7c: an edit query that reaches OCC (a whole circle cut by a whole
// circle: the full-turn pair goes to the kernel) on the SHIPPED
// `public/cadara-occ` build, not only the stock Node package (open problem 8).
type CustomOpenCascadeMainJS = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

let productionRuntime: Promise<OpenCascadeInstance> | null = null;
function loadProductionOcc() {
  productionRuntime ??= (async () => {
    const module = (await import("../../../public/cadara-occ.js")) as {
      default: CustomOpenCascadeMainJS;
    };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );
    return new module.default({ wasmBinary });
  })();
  return productionRuntime;
}

// (The stock package answers this pair `occ-neutral-curve-query-bindings-
// unavailable`, so only the shipped build runs here.)
describe("R-7c: Trim of a whole circle by a whole circle through OCC", () => {
  for (const [runtime, load] of [
    ["production public/cadara-occ", loadProductionOcc],
  ] as const)
    test(
      runtime,
      async () => {
        const sketch = makeSketchFixture();
        sketch.point("a", 0, 0);
        sketch.circle("target", "a", 2);
        sketch.point("b", 2, 0);
        sketch.circle("cutter", "b", 2);
        let reachedKernel = false;
        const occ = createOpenCascadeNeutralCurveQueryCapability(() => {
          reachedKernel = true;
          return load();
        });
        const { result } = await real(occ).querySketchEditIntersections(
          request(sketch, "target"),
        );
        expect(reachedKernel, "the full-turn circle pair reaches OCC").toBe(
          true,
        );
        if (result.kind !== "verified") throw new Error(result.message);
        expect(result.cuts.map((cut) => cut.cutters)).toEqual([
          [{ entityId: "sketch_entity_cutter", tie: { kind: "pointOnCurve" } }],
          [{ entityId: "sketch_entity_cutter", tie: { kind: "pointOnCurve" } }],
        ]);
        const [first, last] = result.cuts;
        expect(first!.representative).toBeCloseTo(Math.PI / 3, 12);
        expect(last!.representative).toBeCloseTo((5 * Math.PI) / 3, 12);
        expect(first!.position[0]).toBeCloseTo(1, 12);
        expect(first!.position[1]).toBeCloseTo(Math.sqrt(3), 12);
        expect(last!.position[1]).toBeCloseTo(-Math.sqrt(3), 12);
      },
      120_000,
    );
});
