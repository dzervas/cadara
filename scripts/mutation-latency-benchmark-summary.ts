// Pure result-shaping for `bun run bench:mutation`
// (scripts/mutation-latency-benchmark.ts): Sentry envelope parsing, phase
// attribution by time window, and nearest-rank latency statistics. Kept
// browser- and Playwright-free so test/scripts can guard the JSON shape.

/** Span op of the OCC worker client's per-request spans (instrumented-worker-client.ts). */
const OCC_WORKER_SPAN_OP = "cad.occ.worker";
/** Phase name prefix of those spans (spanPhaseName). */
const OCC_ROUND_TRIP_PHASE_PREFIX =
  "OCC worker round trip (incl. main-thread delivery) ";

/** One finished performance span, in epoch milliseconds. */
export interface BenchmarkSpan {
  name: string;
  op: string;
  startMs: number;
  endMs: number;
}

/** One long animation frame (LoAF) entry, in epoch milliseconds. */
export interface BenchmarkFrame {
  startMs: number;
  durationMs: number;
  blockingMs: number;
  /** Rendering part of the frame: style, layout, paint and WebGL commit. */
  renderMs: number;
  scriptMs: number;
  /** Script attribution: `invoker` or `sourceFunctionName`, with duration. */
  scripts: { name: string; durationMs: number }[];
}

export interface LatencyStats {
  n: number;
  median: number;
  p95: number;
  min: number;
  max: number;
}

export interface SpanPhase {
  count: number;
  /** Span time inside the sample window (spans are clipped to it). */
  totalMs: number;
  maxMs: number;
  /** Part of `totalMs` from spans already running when the window opened. */
  carriedInMs: number;
}

export interface FramePhase {
  count: number;
  totalMs: number;
  blockingMs: number;
  renderMs: number;
  scriptMs: number;
  topScripts: { name: string; durationMs: number }[];
}

export interface SampleWindow {
  startMs: number;
  endMs: number;
}

/** A V8 CPU profile (CDP Profiler.stop); `startTime` and `timeDeltas` in microseconds. */
export interface CpuProfile {
  nodes: {
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number };
  }[];
  startTime: number;
  samples: number[];
  timeDeltas: number[];
}

/**
 * The spans of every `transaction` item in a Sentry envelope body. The
 * product's performance telemetry starts inactive root spans, so each one
 * arrives as its own transaction (child spans are flattened in as well).
 * Items are walked by their headers: an item header with `length` is
 * followed by exactly that many payload bytes, which may be binary or hold
 * newlines (a replay recording is a JSON line plus zlib data), so the body
 * is read as bytes and only transaction payloads are parsed.
 */
export function parseSentryEnvelopeSpans(body: Uint8Array): BenchmarkSpan[] {
  const decoder = new TextDecoder();
  let offset = 0;
  const readLine = () => {
    const end = body.indexOf(0x0a, offset);
    const line = body.subarray(offset, end === -1 ? body.length : end);
    offset = end === -1 ? body.length : end + 1;
    return line;
  };
  // The envelope header.
  readLine();
  const spans: BenchmarkSpan[] = [];
  while (offset < body.length) {
    const headerLine = decoder.decode(readLine());
    if (headerLine.trim() === "") continue;
    const header = JSON.parse(headerLine) as { type?: string; length?: number };
    let payload: Uint8Array;
    if (header.length === undefined) {
      payload = readLine();
    } else {
      payload = body.subarray(offset, offset + header.length);
      offset += header.length;
      // The newline after a length-delimited payload is optional.
      if (body[offset] === 0x0a) offset += 1;
    }
    if (header.type !== "transaction") continue;
    const event = JSON.parse(decoder.decode(payload)) as SentryTransactionEvent;
    spans.push({
      name: event.transaction ?? "(unnamed)",
      op: event.contexts?.trace?.op ?? "",
      startMs: event.start_timestamp * 1000,
      endMs: event.timestamp * 1000,
    });
    for (const child of event.spans ?? []) {
      spans.push({
        name: child.description ?? "(unnamed)",
        op: child.op ?? "",
        startMs: child.start_timestamp * 1000,
        endMs: child.timestamp * 1000,
      });
    }
  }
  return spans;
}

interface SentryTransactionEvent {
  transaction?: string;
  start_timestamp: number;
  timestamp: number;
  contexts?: { trace?: { op?: string } };
  spans?: {
    description?: string;
    op?: string;
    start_timestamp: number;
    timestamp: number;
  }[];
}

/**
 * Phase name of a span. The OCC worker client's spans time the main-thread
 * request -> reply round trip, so they include the time the reply waits for
 * the main thread: on the wheel rename the OCC worker was idle for ~1590 of
 * 1640 ms while one ~250 ms round trip per sample moved between request kinds
 * (cadara-lx4z). They are therefore not named as worker work; per-thread CPU
 * time inside each phase comes from the profiles (attributeProfileBusy).
 */
function spanPhaseName(span: BenchmarkSpan) {
  return span.op === OCC_WORKER_SPAN_OP
    ? span.name.replace(/^OCC worker /, OCC_ROUND_TRIP_PHASE_PREFIX)
    : span.name;
}

/** The spans overlapping the sample window, clipped to it, with their phase names. */
function clipSpans(spans: readonly BenchmarkSpan[], window: SampleWindow) {
  return spans
    .filter(
      (span) => span.endMs >= window.startMs && span.startMs <= window.endMs,
    )
    .map((span) => ({
      phase: spanPhaseName(span),
      startMs: Math.max(span.startMs, window.startMs),
      endMs: Math.min(span.endMs, window.endMs),
      carriedIn: span.startMs < window.startMs,
    }));
}

/**
 * Spans overlapping the sample window, clipped to it and grouped by phase
 * name (spanPhaseName); time of spans that started before the window is also
 * reported as `carriedInMs`.
 */
export function attributeSpans(
  spans: readonly BenchmarkSpan[],
  window: SampleWindow,
): Record<string, SpanPhase> {
  const phases: Record<string, SpanPhase> = {};
  for (const span of clipSpans(spans, window)) {
    const duration = round(span.endMs - span.startMs);
    const phase = (phases[span.phase] ??= {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      carriedInMs: 0,
    });
    phase.count += 1;
    phase.totalMs = round(phase.totalMs + duration);
    phase.maxMs = Math.max(phase.maxMs, duration);
    if (span.carriedIn) {
      phase.carriedInMs = round(phase.carriedInMs + duration);
    }
  }
  return phases;
}

/**
 * CPU time (non-idle samples) of one profiled thread inside each phase's
 * spans, clipped to the sample window like attributeSpans. A sample covers
 * the interval since the previous one (its time delta), clipped to each
 * span: a starved sampler's long delta must not land whole in a short span.
 * That delta is still credited as busy when its closing sample is non-idle,
 * although the profile never observed the gap: under host load, busy time
 * close to a span's duration may be partly sampler starvation.
 * `epochOffsetMs` maps the profile's microseconds to the spans' epoch
 * milliseconds: epochMs = us / 1000 + epochOffsetMs.
 */
export function attributeProfileBusy(
  spans: readonly BenchmarkSpan[],
  window: SampleWindow,
  profile: CpuProfile,
  epochOffsetMs: number,
): Record<string, number> {
  const idleNodes = new Set(
    profile.nodes
      .filter((node) => node.callFrame.functionName === "(idle)")
      .map((node) => node.id),
  );
  const busyIntervals: { fromMs: number; toMs: number }[] = [];
  let tickUs = profile.startTime;
  profile.samples.forEach((nodeId, index) => {
    const fromMs = tickUs / 1000 + epochOffsetMs;
    tickUs += profile.timeDeltas[index] ?? 0;
    if (idleNodes.has(nodeId)) return;
    busyIntervals.push({ fromMs, toMs: tickUs / 1000 + epochOffsetMs });
  });
  const busy: Record<string, number> = {};
  for (const span of clipSpans(spans, window)) {
    const inside = busyIntervals.reduce(
      (total, interval) =>
        total +
        Math.max(
          0,
          Math.min(interval.toMs, span.endMs) -
            Math.max(interval.fromMs, span.startMs),
        ),
      0,
    );
    busy[span.phase] = round((busy[span.phase] ?? 0) + inside);
  }
  return busy;
}

/** Long animation frames that started inside the sample window. */
export function attributeFrames(
  frames: readonly BenchmarkFrame[],
  window: SampleWindow,
  topScriptCount = 5,
): FramePhase {
  const inside = frames.filter(
    (frame) => frame.startMs >= window.startMs && frame.startMs <= window.endMs,
  );
  const scripts = new Map<string, number>();
  for (const frame of inside) {
    for (const script of frame.scripts) {
      scripts.set(
        script.name,
        (scripts.get(script.name) ?? 0) + script.durationMs,
      );
    }
  }
  const sum = (pick: (frame: BenchmarkFrame) => number) =>
    round(inside.reduce((total, frame) => total + pick(frame), 0));
  return {
    count: inside.length,
    totalMs: sum((frame) => frame.durationMs),
    blockingMs: sum((frame) => frame.blockingMs),
    renderMs: sum((frame) => frame.renderMs),
    scriptMs: sum((frame) => frame.scriptMs),
    topScripts: [...scripts]
      .sort((left, right) => right[1] - left[1])
      .slice(0, topScriptCount)
      .map(([name, durationMs]) => ({ name, durationMs: round(durationMs) })),
  };
}

/** Median and nearest-rank p95 of `values`; null when there are none. */
export function summarizeLatencies(
  values: readonly number[],
): LatencyStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return {
    n: sorted.length,
    median: round(median),
    p95: round(sorted[Math.ceil(0.95 * sorted.length) - 1]!),
    min: round(sorted[0]!),
    max: round(sorted.at(-1)!),
  };
}

/**
 * Per-phase median of `totalMs` across samples (a phase missing from a
 * sample counts as 0 ms there), so rows stay comparable across runs.
 */
export function summarizeSpanPhases(
  samples: readonly Record<string, SpanPhase>[],
): Record<string, LatencyStats> {
  const names = new Set(samples.flatMap((sample) => Object.keys(sample)));
  return Object.fromEntries(
    [...names]
      .sort()
      .map((name) => [
        name,
        summarizeLatencies(
          samples.map((sample) => sample[name]?.totalMs ?? 0),
        )!,
      ]),
  );
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

/**
 * Per-metric median of the samples' row-specific `metrics` (a sample
 * without a value for a metric, or with null, is left out of that metric).
 */
export function summarizeMetrics(
  samples: readonly (Record<string, number | null> | undefined)[],
): Record<string, LatencyStats> {
  const values = new Map<string, number[]>();
  for (const metrics of samples) {
    for (const [name, value] of Object.entries(metrics ?? {})) {
      if (value === null) continue;
      values.set(name, [...(values.get(name) ?? []), value]);
    }
  }
  return Object.fromEntries(
    [...values]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, list]) => [name, summarizeLatencies(list)!]),
  );
}

export interface RankedRowCost {
  fixture: string;
  mutation: string;
  /** Steady median of each sample's max(reflected, persisted, settled). */
  steadyMedianMs: number;
  samples: number;
  /** The span phase with the largest steady median, null without spans. */
  dominantPhase: { name: string; medianMs: number } | null;
}

interface RankableRow {
  fixture: string;
  mutation: string;
  steady: readonly {
    reflectedMs: number | null;
    persistedMs: number | null;
    settledMs?: number | null;
  }[];
  stats: { spans: Record<string, LatencyStats> };
}

/**
 * Rows with steady samples, costliest first: each sample costs the latest
 * of its reflected, persisted and settled signals; a row costs the median.
 */
export function rankRowCosts(rows: readonly RankableRow[]): RankedRowCost[] {
  return rows
    .filter((row) => row.steady.length > 0)
    .map((row) => {
      const [name, phase] =
        Object.entries(row.stats.spans).sort(
          ([, left], [, right]) => right.median - left.median,
        )[0] ?? [];
      return {
        fixture: row.fixture,
        mutation: row.mutation,
        steadyMedianMs: summarizeLatencies(
          row.steady.map((sample) =>
            Math.max(
              sample.reflectedMs ?? 0,
              sample.persistedMs ?? 0,
              sample.settledMs ?? 0,
            ),
          ),
        )!.median,
        samples: row.steady.length,
        dominantPhase: name && phase ? { name, medianMs: phase.median } : null,
      };
    })
    .sort((left, right) => right.steadyMedianMs - left.steadyMedianMs);
}
