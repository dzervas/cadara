import { beforeAll, describe, expect, test } from "vitest";

import type { ExportCapabilities } from "@/contracts/export/capabilities";
import type { SketchVectorExportModel } from "@/contracts/export/sketch-vector";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import type { NeutralCurveQueryCapability } from "@/contracts/modeling/neutral-curve-query";
import { createSketchArrangementDeriver } from "@/contracts/sketch/region-extraction";
import {
  makeSketchFixture,
  type SketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import type {
  RegionBoundarySegmentRecord,
  RegionRecord,
} from "@/contracts/sketch/schema";
import type {
  SplinePoles,
  SplineVector,
} from "@/contracts/sketch/spline-geometry";
import { dxfSketchExportProvider } from "@/domain/export/providers/dxf-sketch-export-provider";
import { svgSketchExportProvider } from "@/domain/export/providers/svg-sketch-export-provider";
import { buildSketchVectorExportModel } from "@/domain/export/sketch-vector-export-model";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";

let capability: NeutralCurveQueryCapability;
beforeAll(async () => {
  capability = await createCertifiedNeutralCurveQueryCapabilityForTest();
});

async function committed(build: (sketch: SketchFixture) => void) {
  const sketch = makeSketchFixture();
  build(sketch);
  const input = sketch.build();
  const { regions } =
    await createSketchArrangementDeriver(capability).derive(input);
  return sketchSnapshotRecordForTest(
    input,
    regions,
    createStandardPlaneDefinition("xy"),
  );
}

function modelOf(record: SketchSnapshotRecord): SketchVectorExportModel {
  const model = buildSketchVectorExportModel({
    documentId: "doc_arrangement" as never,
    revisionId: "rev_arrangement" as never,
    sketches: [record],
    target: { kind: "sketch", sketchId: record.sketchId },
  });
  if ("diagnostic" in model) throw new Error(model.diagnostic.message);
  return model;
}

const capabilitiesOf = (model: SketchVectorExportModel) =>
  ({
    sketchVector: { resolveSketchVectorModel: async () => model },
  }) as unknown as ExportCapabilities;

async function svgRegionPaths(record: SketchSnapshotRecord) {
  const result = await svgSketchExportProvider.export({
    target: { kind: "sketch", sketchId: record.sketchId },
    targetLabel: "Sketch",
    options: {},
    capabilities: capabilitiesOf(modelOf(record)),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const svg = result.payload as string;
  return new Map(
    [...svg.matchAll(/<path d="([^"]*)" data-region-id="([^"]*)"/g)].map(
      (match) => [match[2]!, parsePath(match[1]!)] as const,
    ),
  );
}

type Command = { letter: string; values: number[] };

function parsePath(d: string): Command[] {
  const arity: Record<string, number> = { M: 2, L: 2, C: 6, A: 7, Z: 0 };
  const tokens = d.trim().split(/\s+/);
  const commands: Command[] = [];
  for (let index = 0; index < tokens.length; ) {
    const letter = tokens[index]!;
    const count = arity[letter];
    if (count === undefined) throw new Error(`unexpected token ${letter}`);
    commands.push({
      letter,
      values: tokens.slice(index + 1, index + 1 + count).map(Number),
    });
    index += 1 + count;
  }
  return commands;
}

/**
 * Independent sub-poles of a cubic on local [u0, u1]: the blossom values
 * b(u0,u0,u0), b(u0,u0,u1), b(u0,u1,u1), b(u1,u1,u1).
 */
function blossomSubPoles(
  poles: SplinePoles,
  u0: number,
  u1: number,
): SplineVector[] {
  const lerp = (a: SplineVector, b: SplineVector, t: number): SplineVector => [
    (1 - t) * a[0] + t * b[0],
    (1 - t) * a[1] + t * b[1],
  ];
  const blossom = (t1: number, t2: number, t3: number) => {
    const level1 = [0, 1, 2].map((i) => lerp(poles[i]!, poles[i + 1]!, t1));
    const level2 = [0, 1].map((i) => lerp(level1[i]!, level1[i + 1]!, t2));
    return lerp(level2[0]!, level2[1]!, t3);
  };
  return [
    blossom(u0, u0, u0),
    blossom(u0, u0, u1),
    blossom(u0, u1, u1),
    blossom(u1, u1, u1),
  ];
}

/** The written cubic poles of one exported loop, in traversal order. */
function writtenCubics(commands: readonly Command[]): SplineVector[][] {
  const cubics: SplineVector[][] = [];
  let current: SplineVector = [0, 0];
  for (const { letter, values } of commands) {
    if (letter === "C") {
      const [x1, y1, x2, y2, x3, y3] = values as [number, ...number[]];
      cubics.push([current, [x1, y1!], [x2!, y2!], [x3!, y3!]]);
      current = [x3!, y3!];
    } else if (letter === "M" || letter === "L" || letter === "A")
      current = [values.at(-2)!, values.at(-1)!];
  }
  return cubics;
}

/** The record's own sub-poles: its span, its interval, its traversal. */
function oracleCubic(
  record: SketchSnapshotRecord,
  segment: RegionBoundarySegmentRecord,
): SplineVector[] {
  const spline = record.sketch.solvedSnapshot.solvedEntities.find(
    (entity) => entity.kind === "spline",
  );
  if (spline?.kind !== "spline") throw new Error("fixture spline missing");
  const span = spline.reconstruction.spans.find(
    (entry) =>
      `${entry.source.startOccurrenceId}>${entry.source.endOccurrenceId}` ===
      segment.branch.spanId,
  )!;
  const [s0, s1] = span.interval;
  const local = (t: number) =>
    t === s0 ? 0 : t === s1 ? 1 : (t - s0) / (s1 - s0);
  const [a, b] = segment.sourceParameterInterval;
  const poles = blossomSubPoles(span.poles, local(a), local(b));
  return segment.traversalDirection === "forward" ? poles : poles.reverse();
}

/** Compares in a frame anchored at each side's first point (the SVG is translated). */
function expectSamePoles(
  written: readonly SplineVector[][],
  oracle: readonly SplineVector[][],
  label: string,
) {
  expect(written.length, label).toBe(oracle.length);
  const [wx, wy] = written[0]![0]!;
  const [ox, oy] = oracle[0]![0]!;
  written.forEach((poles, index) =>
    poles.forEach(([x, y], pole) => {
      const [ex, ey] = oracle[index]![pole]!;
      // 6-decimal SVG numbers (`formatNumber`): two roundings of 5e-7.
      expect(
        Math.hypot(x - wx - (ex - ox), y - wy - (ey - oy)),
        `${label}: cubic ${index} pole ${pole}`,
      ).toBeLessThanOrEqual(1.5e-6);
    }),
  );
}

function lemniscate(sketch: SketchFixture) {
  const names = [...Array(8).keys()].map((k) => {
    const t = Math.PI / 8 + (k * Math.PI) / 4;
    sketch.point(
      `p${k}`,
      Math.round(6 * Math.cos(t) * 1000) / 1000,
      Math.round(6 * Math.sin(t) * Math.cos(t) * 1000) / 1000,
    );
    return `p${k}`;
  });
  sketch.spline("fig", names, "smooth");
}

function splineWithCircleHole(sketch: SketchFixture) {
  [
    [6, 0],
    [0, 5],
    [-6, 0],
    [0, -5],
  ].forEach(([x, y], index) => sketch.point(`s${index}`, x!, y!));
  sketch.spline("outer", ["s0", "s1", "s2", "s3"], "smooth");
  sketch.point("c", 0, 0);
  sketch.circle("hole", "c", 2);
}

describe("vector export: region paths are the exact resolved segments (T10e, B5)", () => {
  test("figure-eight lobes: one C per segment with the de Casteljau sub-poles at the kernel interval", async () => {
    const record = await committed(lemniscate);
    expect(record.sketch.regions).toHaveLength(2);
    const paths = await svgRegionPaths(record);
    for (const region of record.sketch.regions) {
      const loop = region.loops[0]!;
      // Lobes are closed by verified crossings: some ends are interior.
      expect(
        loop.segments.some(
          (segment) => segment.start?.kind === "verifiedIntersection",
        ),
      ).toBe(true);
      const commands = paths.get(region.regionId)!;
      expect(commands[0]!.letter).toBe("M");
      expect(commands.at(-1)!.letter).toBe("Z");
      expect(
        commands.filter((command) => command.letter === "C"),
        "one cubic command per segment",
      ).toHaveLength(loop.segments.length);
      expectSamePoles(
        writtenCubics(commands),
        loop.segments.map((segment) => oracleCubic(record, segment)),
        region.label,
      );
    }
  }, 60_000);

  test("annulus: spline spans as exact cubics, the circle hole as exact arcs of its own radius", async () => {
    const record = await committed(splineWithCircleHole);
    const annulus = record.sketch.regions.find(
      (region: RegionRecord) => region.loops.length === 2,
    )!;
    const commands = (await svgRegionPaths(record)).get(annulus.regionId)!;
    const [outer, hole] = annulus.loops;
    const split = commands.findIndex(
      (command, index) => index > 0 && command.letter === "M",
    );
    const outerCommands = commands.slice(0, split);
    const holeCommands = commands.slice(split);
    expectSamePoles(
      writtenCubics(outerCommands),
      outer!.segments.map((segment) => oracleCubic(record, segment)),
      "outer",
    );
    // An unsplit circle: one segment, a full turn written as two half arcs
    // of radius 2, clockwise (sweep 0) for the hole, back to its start.
    expect(hole!.segments).toHaveLength(1);
    expect(holeCommands.map((command) => command.letter)).toEqual([
      "M",
      "A",
      "A",
      "Z",
    ]);
    for (const arc of holeCommands.filter((command) => command.letter === "A"))
      expect(arc.values.slice(0, 5)).toEqual([2, 2, 0, 0, 0]);
    expect(holeCommands[2]!.values.slice(5)).toEqual(holeCommands[0]!.values);
  }, 60_000);

  test("review R-1: a circle closed by one crossing writes its wrap edge as two antipodal half arcs", async () => {
    // At this angle the wrap edge [a, a + 2π] sweeps an ulp under 2π in
    // binary64; one `A` would end where it starts and SVG would draw nothing.
    const phi = -Math.PI + 0.1 + 14 * 0.15; // φ ≈ −0.942
    const record = await committed((sketch) => {
      sketch.point("o", 0, 0);
      sketch.point("p", 5 * Math.cos(phi), 5 * Math.sin(phi));
      sketch.circle("c", "o", 3);
      sketch.line("l", "o", "p");
    });
    const disc = record.sketch.regions.find(
      (region) =>
        region.loops.length === 1 && region.loops[0]!.segments.length === 1,
    )!;
    const [a, b] = disc.loops[0]!.segments[0]!.sourceParameterInterval;
    expect(b - a, "premise: the binary64 sweep is short of 2π").toBeLessThan(
      2 * Math.PI,
    );
    const commands = (await svgRegionPaths(record)).get(disc.regionId)!;
    expect(commands.map((command) => command.letter)).toEqual([
      "M",
      "A",
      "A",
      "Z",
    ]);
    const start = commands[0]!.values;
    const middle = commands[1]!.values.slice(5);
    expect(
      Math.hypot(middle[0]! - start[0]!, middle[1]! - start[1]!),
      "the first half arc ends antipodal to the start (diameter 6)",
    ).toBeCloseTo(6, 5);
    expect(commands[2]!.values.slice(5)).toEqual(start);
  }, 60_000);

  test("a region that does not resolve against the record's pair is left out with a diagnostic", async () => {
    const record = await committed(lemniscate);
    const forged = {
      ...record,
      sketch: {
        ...record.sketch,
        solvedSnapshot: { ...record.sketch.solvedSnapshot, solvedEntities: [] },
      },
    };
    const model = modelOf(forged);
    expect(model.regions).toEqual([]);
    expect(
      model.diagnostics.filter(
        (diagnostic) => diagnostic.code === "sketch-vector-region-unresolved",
      ),
    ).toHaveLength(2);
  }, 60_000);

  test("DXF writes splines through the owner tessellator: every vertex lies on its span", async () => {
    const record = await committed(lemniscate);
    const model = modelOf(record);
    const result = await dxfSketchExportProvider.export({
      target: { kind: "sketch", sketchId: record.sketchId },
      targetLabel: "Sketch",
      options: {},
      capabilities: capabilitiesOf(model),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const lines = (result.payload as string).split("\n");
    const vertices: SplineVector[] = [];
    for (let index = 0; index + 3 < lines.length; index += 2)
      if (lines[index] === "10" && lines[index + 2] === "20")
        vertices.push([Number(lines[index + 1]), Number(lines[index + 3])]);
    const spline = model.entities.find((entity) => entity.kind === "spline");
    if (spline?.kind !== "spline") throw new Error("spline not exported");
    const steps = 24;
    expect(vertices).toHaveLength(spline.spans.length * steps + 1);
    vertices.forEach(([x, y], index) => {
      const span = Math.min(Math.floor(index / steps), spline.spans.length - 1);
      const u = (index - span * steps) / steps;
      const [p0, p1, p2, p3] = spline.spans[span]!;
      const v = 1 - u;
      const b = [v * v * v, 3 * u * v * v, 3 * u * u * v, u * u * u];
      const ex = b[0]! * p0[0] + b[1]! * p1[0] + b[2]! * p2[0] + b[3]! * p3[0];
      const ey = b[0]! * p0[1] + b[1]! * p1[1] + b[2]! * p2[1] + b[3]! * p3[1];
      expect(Math.hypot(x - ex, y - ey), `vertex ${index}`).toBeLessThan(1e-12);
    });
  }, 60_000);
});
