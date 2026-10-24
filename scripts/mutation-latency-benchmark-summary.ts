// Pure result-shaping for `bun run bench:mutation`
// (scripts/mutation-latency-benchmark.ts): Sentry envelope parsing, phase
// attribution by time window, and nearest-rank latency statistics. Kept
// browser- and Playwright-free so test/scripts can guard the JSON shape.

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

/**
 * The spans of every `transaction` item in a Sentry envelope body. The
 * product's performance telemetry starts inactive root spans, so each one
 * arrives as its own transaction (child spans are flattened in as well).
 */
export function parseSentryEnvelopeSpans(body: string): BenchmarkSpan[] {
  const lines = body.split("\n").filter((line) => line.trim() !== "");
  const spans: BenchmarkSpan[] = [];
  for (let index = 1; index < lines.length - 1; index += 2) {
    const header = JSON.parse(lines[index]!) as { type?: string };
    if (header.type !== "transaction") continue;
    const event = JSON.parse(lines[index + 1]!) as SentryTransactionEvent;
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
 * Spans overlapping the sample window, clipped to it and grouped by span
 * name; time of spans that started before the window is also reported as
 * `carriedInMs`.
 */
export function attributeSpans(
  spans: readonly BenchmarkSpan[],
  window: SampleWindow,
): Record<string, SpanPhase> {
  const phases: Record<string, SpanPhase> = {};
  for (const span of spans) {
    if (span.endMs < window.startMs || span.startMs > window.endMs) continue;
    const duration = round(
      Math.min(span.endMs, window.endMs) -
        Math.max(span.startMs, window.startMs),
    );
    const phase = (phases[span.name] ??= {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      carriedInMs: 0,
    });
    phase.count += 1;
    phase.totalMs = round(phase.totalMs + duration);
    phase.maxMs = Math.max(phase.maxMs, duration);
    if (span.startMs < window.startMs) {
      phase.carriedInMs = round(phase.carriedInMs + duration);
    }
  }
  return phases;
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
