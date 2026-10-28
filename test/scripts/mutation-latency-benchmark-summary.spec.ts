import { describe, expect, it } from "vitest";

import {
  attributeFrames,
  attributeProfileBusy,
  attributeSpans,
  parseSentryEnvelopeSpans,
  rankRowCosts,
  summarizeLatencies,
  summarizeMetrics,
  summarizeSpanPhases,
  type BenchmarkSpan,
  type CpuProfile,
} from "../../scripts/mutation-latency-benchmark-summary.ts";

const ENVELOPE_HEADER = JSON.stringify({
  event_id: "e",
  sent_at: "2026-10-24T00:00:00.000Z",
});

function envelope(...items: [object, object][]) {
  return new TextEncoder().encode(
    [
      ENVELOPE_HEADER,
      ...items.flatMap(([header, payload]) => [
        JSON.stringify(header),
        JSON.stringify(payload),
      ]),
    ].join("\n"),
  );
}

const TRANSACTION = {
  transaction: "OCC worker renameBody",
  start_timestamp: 1000.5,
  timestamp: 1000.75,
  contexts: { trace: { op: "cad.occ.worker" } },
};

describe("bench:mutation result shaping", () => {
  it("reads every transaction span of a Sentry envelope in epoch milliseconds", () => {
    const body = envelope(
      [{ type: "client_report" }, { discarded_events: [] }],
      [
        { type: "transaction" },
        {
          transaction: "OCC worker renameBody",
          start_timestamp: 1000.5,
          timestamp: 1000.75,
          contexts: { trace: { op: "cad.occ.worker" } },
          spans: [
            {
              description: "child",
              op: "x",
              start_timestamp: 1000.6,
              timestamp: 1000.7,
            },
          ],
        },
      ],
    );

    expect(parseSentryEnvelopeSpans(body)).toEqual([
      {
        name: "OCC worker renameBody",
        op: "cad.occ.worker",
        startMs: 1_000_500,
        endMs: 1_000_750,
      },
      { name: "child", op: "x", startMs: 1_000_600, endMs: 1_000_700 },
    ]);
  });

  it("skips length-delimited binary items holding newlines and reads the transactions around them", () => {
    const encoder = new TextEncoder();
    // A replay recording: a JSON line, then zlib data (starts with "x").
    const recording = new Uint8Array([
      ...encoder.encode('{"segment_id":0}\n'),
      0x78,
      0x9c,
      0x0a,
      0xff,
      0x00,
      0x0a,
      0x7b,
    ]);
    const body = new Uint8Array([
      ...encoder.encode(`${ENVELOPE_HEADER}\n`),
      ...encoder.encode(`${JSON.stringify({ type: "replay_event" })}\n`),
      ...encoder.encode(`${JSON.stringify({ replay_id: "r" })}\n`),
      ...encoder.encode(
        `${JSON.stringify({ type: "replay_recording", length: recording.length })}\n`,
      ),
      ...recording,
      ...encoder.encode("\n"),
      ...encoder.encode(`${JSON.stringify({ type: "transaction" })}\n`),
      ...encoder.encode(JSON.stringify(TRANSACTION)),
    ]);

    expect(parseSentryEnvelopeSpans(body)).toEqual([
      {
        name: "OCC worker renameBody",
        op: "cad.occ.worker",
        startMs: 1_000_500,
        endMs: 1_000_750,
      },
    ]);
  });

  it("reads a length-delimited transaction payload", () => {
    const payload = new TextEncoder().encode(JSON.stringify(TRANSACTION));
    const body = new TextEncoder().encode(
      `${ENVELOPE_HEADER}\n${JSON.stringify({ type: "transaction", length: payload.length })}\n${JSON.stringify(TRANSACTION)}`,
    );

    expect(parseSentryEnvelopeSpans(body)).toHaveLength(1);
  });

  it("attributes the spans overlapping a sample window, clipped to it and grouped by name", () => {
    const spans: BenchmarkSpan[] = [
      { name: "OCC worker evaluatePreview", op: "w", startMs: 10, endMs: 90 },
      { name: "Document repository mutate", op: "r", startMs: 40, endMs: 400 },
      { name: "OCC worker renameBody", op: "w", startMs: 100, endMs: 150 },
      { name: "OCC worker renameBody", op: "w", startMs: 250, endMs: 380 },
      { name: "OCC worker renameBody", op: "w", startMs: 301, endMs: 900 },
    ];

    expect(attributeSpans(spans, { startMs: 100, endMs: 300 })).toEqual({
      "Document repository mutate": {
        count: 1,
        totalMs: 200,
        maxMs: 200,
        carriedInMs: 200,
      },
      "OCC worker renameBody": {
        count: 2,
        totalMs: 100,
        maxMs: 50,
        carriedInMs: 0,
      },
    });
  });

  // cadara-lx4z: an OCC worker client span is the main-thread request ->
  // reply round trip, which also waits for the main thread while the worker
  // is idle, so its phase must not read as worker work.
  const roundTripSpans: BenchmarkSpan[] = [
    {
      name: "OCC worker renameBody",
      op: "cad.occ.worker",
      startMs: 100,
      endMs: 110,
    },
    {
      name: "OCC worker exportAuthoredModelDocument",
      op: "cad.occ.worker",
      startMs: 112,
      endMs: 350,
    },
    {
      name: "Modeling service renameBody",
      op: "cad.modeling",
      startMs: 90,
      endMs: 360,
    },
  ];

  it("names OCC worker client spans as round trips including main-thread delivery", () => {
    expect(
      attributeSpans(roundTripSpans, { startMs: 100, endMs: 340 }),
    ).toEqual({
      "OCC worker round trip (incl. main-thread delivery) renameBody": {
        count: 1,
        totalMs: 10,
        maxMs: 10,
        carriedInMs: 0,
      },
      "OCC worker round trip (incl. main-thread delivery) exportAuthoredModelDocument":
        {
          count: 1,
          totalMs: 228,
          maxMs: 228,
          carriedInMs: 0,
        },
      "Modeling service renameBody": {
        count: 1,
        totalMs: 240,
        maxMs: 240,
        carriedInMs: 240,
      },
    });
  });

  it("attributes a profiled thread's non-idle CPU time to the phases, clipping each sample's interval to the spans", () => {
    // Profile ticks start at 5000 us; the offset maps them to epoch ms as
    // us / 1000 - 5. A sample covers the interval since the previous one:
    // samples at 100, 110, ..., 350 ms, every 10 ms after a first 100 ms gap
    // (a starved sampler). Busy: 100 (covers 0..100, before every span),
    // 110 (100..110, renameBody) and 250..350 (240..350; 340..350 is past
    // the window end).
    const busy = 1;
    const idle = 2;
    const sampleTimesMs = Array.from({ length: 26 }, (_, i) => 100 + i * 10);
    const profile: CpuProfile = {
      nodes: [
        {
          id: busy,
          callFrame: { functionName: "(program)", url: "", lineNumber: -1 },
        },
        {
          id: idle,
          callFrame: { functionName: "(idle)", url: "", lineNumber: -1 },
        },
      ],
      startTime: 5000,
      samples: sampleTimesMs.map((atMs) =>
        atMs <= 110 || atMs >= 250 ? busy : idle,
      ),
      timeDeltas: sampleTimesMs.map((_, i) => (i === 0 ? 100_000 : 10_000)),
    };

    expect(
      attributeProfileBusy(
        roundTripSpans,
        { startMs: 100, endMs: 340 },
        profile,
        -5,
      ),
    ).toEqual({
      "OCC worker round trip (incl. main-thread delivery) renameBody": 10,
      "OCC worker round trip (incl. main-thread delivery) exportAuthoredModelDocument": 100,
      "Modeling service renameBody": 110,
    });
  });

  it("sums long animation frames inside the window and ranks their scripts", () => {
    const frame = (startMs: number, scripts: [string, number][]) => ({
      startMs,
      durationMs: 100,
      blockingMs: 50,
      renderMs: 20,
      scriptMs: scripts.reduce((total, [, ms]) => total + ms, 0),
      scripts: scripts.map(([name, durationMs]) => ({ name, durationMs })),
    });

    expect(
      attributeFrames(
        [
          frame(0, [["early", 90]]),
          frame(10, [
            ["a", 30],
            ["b", 60],
          ]),
          frame(20, [["a", 40]]),
        ],
        { startMs: 5, endMs: 50 },
        1,
      ),
    ).toEqual({
      count: 2,
      totalMs: 200,
      blockingMs: 100,
      renderMs: 40,
      scriptMs: 130,
      topScripts: [{ name: "a", durationMs: 70 }],
    });
  });

  it("reports the median and the nearest-rank p95", () => {
    expect(summarizeLatencies([])).toBeNull();
    expect(summarizeLatencies([30, 10, 20])).toEqual({
      n: 3,
      median: 20,
      p95: 30,
      min: 10,
      max: 30,
    });
    const twenty = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(summarizeLatencies(twenty)).toEqual({
      n: 20,
      median: 10.5,
      p95: 19,
      min: 1,
      max: 20,
    });
  });

  it("counts a phase missing from a sample as 0 ms so phase medians stay comparable", () => {
    expect(
      summarizeSpanPhases([
        {
          "OCC worker renameBody": {
            count: 1,
            totalMs: 40,
            maxMs: 40,
            carriedInMs: 0,
          },
        },
        {},
        {
          "OCC worker renameBody": {
            count: 1,
            totalMs: 60,
            maxMs: 60,
            carriedInMs: 0,
          },
        },
      ]),
    ).toEqual({
      "OCC worker renameBody": { n: 3, median: 40, p95: 60, min: 0, max: 60 },
    });
  });

  it("summarizes each row metric over the samples that measured it", () => {
    expect(
      summarizeMetrics([
        { measureReadoutMs: 30, hoverStepMedianMs: null },
        undefined,
        { measureReadoutMs: 10 },
      ]),
    ).toEqual({
      measureReadoutMs: { n: 2, median: 20, p95: 30, min: 10, max: 30 },
    });
  });

  it("ranks rows by the steady median of their latest signal, with the dominant phase", () => {
    const stats = (median: number) => ({
      n: 1,
      median,
      p95: median,
      min: median,
      max: median,
    });
    expect(
      rankRowCosts([
        {
          fixture: "bracket",
          mutation: "rename",
          steady: [
            { reflectedMs: 50, persistedMs: 80, settledMs: null },
            { reflectedMs: 60, persistedMs: 70, settledMs: 120 },
          ],
          stats: {
            spans: { "a small phase": stats(5), "a big phase": stats(40) },
          },
        },
        {
          fixture: "bracket",
          mutation: "reload",
          steady: [{ reflectedMs: 900, persistedMs: null }],
          stats: { spans: {} },
        },
        {
          fixture: "bracket",
          mutation: "skipped",
          steady: [],
          stats: { spans: {} },
        },
      ]),
    ).toEqual([
      {
        fixture: "bracket",
        mutation: "reload",
        steadyMedianMs: 900,
        samples: 1,
        dominantPhase: null,
      },
      {
        fixture: "bracket",
        mutation: "rename",
        steadyMedianMs: 100,
        samples: 2,
        dominantPhase: { name: "a big phase", medianMs: 40 },
      },
    ]);
  });
});
