import { beforeAll, describe, expect, test } from "vitest";

import type { NeutralCurveQueryCapability } from "@/contracts/modeling/neutral-curve-query";
import { createSketchArrangementDeriver } from "@/contracts/sketch/region-extraction";
import {
  makeSketchFixture,
  type SketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  addRoundedRectangleForTest,
  addSplineLobeForTest,
  ROUNDED_RECTANGLE_FOR_TEST,
  sketchSnapshotRecordForTest,
} from "@/contracts/sketch/region-record.fixtures";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SplinePoles } from "@/contracts/sketch/spline-geometry";
import { createRegionBoundaryBasis } from "@/contracts/sketch/region-boundary-curves";
import {
  createSketchSessionFromSnapshot,
  failSketchLiveRegions,
  getSketchSessionDerivedValidity,
  getSketchSessionDisplayRenderables,
  getSketchSessionLiveRegionBasis,
  publishSketchLiveRegions,
  withLiveSolveBasis,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { measureSketchRegion } from "@/domain/measure/measurement";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";

let capability: NeutralCurveQueryCapability;
beforeAll(async () => {
  capability = await createCertifiedNeutralCurveQueryCapabilityForTest();
});

/** Samples per boundary curve of the in-sketch fill (display.ts). */
const FILL_SAMPLES = 48;

async function sessionOf(build: (sketch: SketchFixture) => void) {
  const sketch = makeSketchFixture();
  build(sketch);
  const input = sketch.build();
  const { regions } =
    await createSketchArrangementDeriver(capability).derive(input);
  const record = sketchSnapshotRecordForTest(
    input,
    regions,
    createStandardPlaneDefinition("xy"),
  );
  return {
    input,
    record,
    session: createSketchSessionFromSnapshot(record, OCC_KERNEL_SETTINGS),
  };
}

function regionFill(session: SketchSessionState) {
  const fills = getSketchSessionDisplayRenderables(session).filter(
    (renderable) => renderable.semanticClass === "region",
  );
  expect(fills, "One region fill renderable.").toHaveLength(1);
  const geometry = fills[0]!.geometry;
  if (geometry.kind !== "mesh") throw new Error("region fill is not a mesh");
  return { renderable: fills[0]!, geometry };
}

/** Σ triangle areas of the fill mesh (xy sketch plane: z = 0). */
function meshArea(geometry: ReturnType<typeof regionFill>["geometry"]) {
  return geometry.triangleIndices.reduce((sum, [i, j, k]) => {
    const [a, b, c] = [i, j, k].map(
      (index) => geometry.vertexPositions[index]!,
    );
    return (
      sum +
      Math.abs(
        (b![0] - a![0]) * (c![1] - a![1]) - (c![0] - a![0]) * (b![1] - a![1]),
      ) /
        2
    );
  }, 0);
}

/**
 * Chord bound of one cubic span tessellated with n uniform steps in u: the
 * sagitta is ≤ max|B″|/(8n²) with max|B″| ≤ 6·max|Δ²P|, over a curve no
 * longer than its control polygon.
 */
function cubicFillBound([p0, p1, p2, p3]: SplinePoles, n: number) {
  const second = (a: SplinePoles[0], b: SplinePoles[0], c: SplinePoles[0]) =>
    Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1]);
  const sag =
    (6 * Math.max(second(p0, p1, p2), second(p1, p2, p3))) / (8 * n * n);
  const polygon =
    Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) +
    Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
    Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  return sag * polygon;
}

describe("in-sketch region fill: the owner's tessellation of the exact boundary (T10e)", () => {
  test("rounded rectangle: the fill area is the exact area minus the arc chord segments", async () => {
    const { record, session } = await sessionOf(addRoundedRectangleForTest);
    const { w, h, r } = ROUNDED_RECTANGLE_FOR_TEST;
    const exact = w * h - (4 - Math.PI) * r * r;
    const measured = measureSketchRegion(record, record.sketch.regions[0]!);
    if (measured.kind === "failed") throw new Error(measured.message);
    expect(Math.abs(measured.area - exact)).toBeLessThan(1e-12);
    // Four quarter arcs, each an n-chord polygon: deficit r²/2 (Δ − n sin(Δ/n)).
    const quarter = Math.PI / 2;
    const deficit =
      4 *
      ((r * r) / 2) *
      (quarter - FILL_SAMPLES * Math.sin(quarter / FILL_SAMPLES));
    const area = meshArea(regionFill(session).geometry);
    expect(
      Math.abs(area - (exact - deficit)),
      "The fill is exactly the inscribed chord polygon of the exact arcs.",
    ).toBeLessThan(1e-12);
    expect(exact - area).toBeGreaterThan(0);
    expect(exact - area).toBeLessThanOrEqual(deficit * (1 + 1e-9));
  }, 60_000);

  test("spline lobe: the fill covers the exact area within the chord bound", async () => {
    const { input, record, session } = await sessionOf(addSplineLobeForTest);
    const measured = measureSketchRegion(record, record.sketch.regions[0]!);
    if (measured.kind === "failed") throw new Error(measured.message);
    const spline = input.solvedSnapshot.solvedEntities.find(
      (entity) => entity.kind === "spline",
    );
    if (spline?.kind !== "spline") throw new Error("fixture spline missing");
    const bound = spline.reconstruction.spans.reduce(
      (sum, span) => sum + cubicFillBound(span.poles, FILL_SAMPLES),
      0,
    );
    const area = meshArea(regionFill(session).geometry);
    expect(bound).toBeLessThan(0.05);
    expect(
      Math.abs(area - measured.area),
      `fill ${area} vs exact ${measured.area} within ${bound}`,
    ).toBeLessThanOrEqual(bound);
  }, 60_000);

  test("stale regions keep filling against the pair that produced them; publishing moves the fill", async () => {
    const { session } = await sessionOf(addSplineLobeForTest);
    const before = regionFill(session);
    expect(before.renderable.regionValidity).toBe("current");

    // Edit the arch's apex: a new live solve leaves the regions pending.
    const moved: SketchDefinition = {
      ...session.definition,
      points: session.definition.points.map((point) =>
        point.label === "M" ? { ...point, position: [3, 5] } : point,
      ),
    };
    const pending = withLiveSolveBasis(
      { ...session, definition: moved },
      moved,
    );
    expect(pending.liveRegions.status).toBe("pending");
    const stale = regionFill(pending);
    expect(stale.renderable.regionValidity).toBe("stale");
    expect(
      stale.geometry.vertexPositions,
      "A stale fill is the published region on its own pair, unchanged by the moving definition (R2).",
    ).toEqual(before.geometry.vertexPositions);

    const basis = getSketchSessionLiveRegionBasis(pending)!;
    const derived = await createSketchArrangementDeriver(capability).derive({
      documentId: "doc_fill",
      revisionId: "rev_fill",
      sketchId: basis.sketchId,
      definition: basis.definition,
      solvedSnapshot: basis.solvedSnapshot,
      projectedReferences: basis.projectedReferences,
      modelingTolerance: basis.modelingTolerance,
    });
    const published = publishSketchLiveRegions(
      pending,
      derived.regions,
      derived.diagnostics,
    );
    const current = regionFill(published);
    expect(current.renderable.regionValidity).toBe("current");
    const top = (geometry: typeof current.geometry) =>
      Math.max(...geometry.vertexPositions.map((point) => point[1]));
    expect(
      top(current.geometry),
      "The republished fill follows the edited arch.",
    ).toBeGreaterThan(top(before.geometry) + 0.5);
  }, 60_000);

  test("review R-2: a failed derivation keeps the last regions filled, invalid, at their own pair", async () => {
    const { session } = await sessionOf(addSplineLobeForTest);
    const before = regionFill(session);
    const moved: SketchDefinition = {
      ...session.definition,
      points: session.definition.points.map((point) =>
        point.label === "M" ? { ...point, position: [3, 5] } : point,
      ),
    };
    const failed = failSketchLiveRegions(
      withLiveSolveBasis({ ...session, definition: moved }, moved),
      "derivation worker failed",
    );
    expect(failed.liveRegions.status).toBe("failed");
    const kept = regionFill(failed);
    expect(kept.renderable.regionValidity).toBe("invalid");
    expect(kept.renderable.target, "invalid regions are not selectable").toBe(
      null,
    );
    expect(kept.geometry.vertexPositions).toEqual(
      before.geometry.vertexPositions,
    );
  }, 60_000);

  test("review R-3: a region that cannot resolve against its basis is reported, not silently unfilled", async () => {
    const { record, session } = await sessionOf(addSplineLobeForTest);
    const region = session.liveRegions.regions[0]!;
    const unresolved = (candidate: SketchSessionState) =>
      getSketchSessionDerivedValidity(candidate).diagnostics.filter(
        (diagnostic) => diagnostic.code === "profile-boundary-unresolved",
      );
    expect(unresolved(session)).toEqual([]);

    // A basis bound to other records (a structurally equal clone).
    const mispaired: SketchSessionState = {
      ...session,
      liveRegions: {
        ...session.liveRegions,
        boundaryBasis: createRegionBoundaryBasis(
          {
            definition: record.sketch.definition,
            solvedSnapshot: record.sketch.solvedSnapshot,
            projectedReferences: [],
          },
          structuredClone(record.sketch.regions),
        ),
      },
    };
    // No basis at all.
    const missing: SketchSessionState = {
      ...session,
      liveRegions: { ...session.liveRegions, boundaryBasis: null },
    };
    for (const [label, candidate] of [
      ["mispaired", mispaired],
      ["missing", missing],
    ] as const) {
      expect(
        getSketchSessionDisplayRenderables(candidate).filter(
          (renderable) => renderable.semanticClass === "region",
        ),
        `${label}: no fill is guessed`,
      ).toEqual([]);
      expect(unresolved(candidate), label).toMatchObject([
        {
          severity: "error",
          target: { kind: "region", regionId: region.regionId },
        },
      ]);
      expect(getSketchSessionDerivedValidity(candidate).state, label).toBe(
        "invalid",
      );
    }
    expect(unresolved(mispaired)[0]!.message).toContain(
      "is not a record of this basis",
    );
  }, 60_000);
});
