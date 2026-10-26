import { expect, type Page } from "@playwright/test";

// cadara-3wp6: pointer-following overlays (dimension previews, dragged chips)
// are asserted along the glide, not at its endpoint: a label that jumps on
// intermediate steps but lands right passes an endpoint check. The mouse moves
// one `mouse.move` per path point; after each step the page settles and the
// followed element's bounding box is sampled. Every position the element is
// drawn at in between (each DOM mutation that moves it) is recorded too, with
// the pointer at that moment, so a chip drawn away for a single frame is seen.

export type ViewportPoint = { x: number; y: number };

export interface GlideSample {
  pointer: ViewportPoint;
  /** The followed element's bounding-box centre, null when it is absent. */
  element: ViewportPoint | null;
}

export interface GlideRecording {
  /** One settled sample per path step. */
  steps: GlideSample[];
  /** Every drawn position of the element between the samples. */
  frames: GlideSample[];
}

/** The waypoints joined by straight steps of at most `stepPx`. */
export function glidePath(
  waypoints: readonly ViewportPoint[],
  stepPx = 8,
): ViewportPoint[] {
  const path: ViewportPoint[] = [waypoints[0]!];
  for (let index = 1; index < waypoints.length; index += 1) {
    const from = waypoints[index - 1]!;
    const to = waypoints[index]!;
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / stepPx),
    );
    for (let step = 1; step <= steps; step += 1) {
      path.push({
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
      });
    }
  }
  return path;
}

/** Settle rounds per step before a still-moving element is sampled anyway. */
const MAX_SETTLE_ROUNDS = 6;

type FrameRecorder = {
  frames: GlideSample[];
  stop: () => void;
};

/**
 * Glides the mouse through `path` from where the caller left it. With
 * `press`, the button goes down at `path[0]` once the recorder runs (the
 * caller releases it). After every step it waits for `settle` until the
 * element matching `selector` stops moving (the pointer event reaches the
 * session, then the projection, a frame or two later) and samples it.
 */
export async function glideSamplingElement(
  page: Page,
  selector: string,
  path: readonly ViewportPoint[],
  settle: () => Promise<void>,
  options: { press?: boolean } = {},
): Promise<GlideRecording> {
  await page.mouse.move(path[0]!.x, path[0]!.y);
  await page.evaluate((selector) => {
    const centre = () => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box
        ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        : null;
    };
    const recorder: FrameRecorder & { pointer: ViewportPoint | null } = {
      frames: [],
      pointer: null,
      stop: () => {},
    };
    const onPointer = (event: PointerEvent) => {
      recorder.pointer = { x: event.clientX, y: event.clientY };
    };
    const record = () => {
      const element = centre();
      const last = recorder.frames.at(-1)?.element;
      if (
        recorder.pointer &&
        element &&
        (!last || Math.hypot(element.x - last.x, element.y - last.y) >= 0.5)
      ) {
        recorder.frames.push({ pointer: recorder.pointer, element });
      }
    };
    const observer = new MutationObserver(record);
    window.addEventListener("pointermove", onPointer, { capture: true });
    window.addEventListener("pointerdown", onPointer, { capture: true });
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    recorder.stop = () => {
      observer.disconnect();
      window.removeEventListener("pointermove", onPointer, { capture: true });
      window.removeEventListener("pointerdown", onPointer, { capture: true });
    };
    (window as unknown as { __cadaraGlide: typeof recorder }).__cadaraGlide =
      recorder;
  }, selector);
  if (options.press) await page.mouse.down();

  const read = () =>
    page.evaluate((selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box
        ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        : null;
    }, selector);
  const steps: GlideSample[] = [];
  for (const pointer of path) {
    await page.mouse.move(pointer.x, pointer.y);
    await settle();
    let centre = await read();
    for (let round = 1; round < MAX_SETTLE_ROUNDS; round += 1) {
      await settle();
      const next = await read();
      const still =
        centre && next ? distance(centre, next) < 0.5 : centre === next;
      centre = next;
      if (still) break;
    }
    steps.push({ pointer, element: centre });
  }
  const frames = await page.evaluate(() => {
    const recorder = (window as unknown as { __cadaraGlide: FrameRecorder })
      .__cadaraGlide;
    recorder.stop();
    return recorder.frames;
  });
  return { steps, frames };
}

const distance = (first: ViewportPoint, second: ViewportPoint) =>
  Math.hypot(first.x - second.x, first.y - second.y);

const at = (point: ViewportPoint) =>
  `(${Math.round(point.x)}, ${Math.round(point.y)})`;

/**
 * Asserts every glide step: the element is shown, it never moves more than
 * `speedLimit` · |Δpointer| + `slackPx` (k = 1 by default: a label never
 * outruns the pointer). With `followsPointer` it keeps `expectedOffset` to
 * the pointer (default: the offset at the first sample) within
 * `followTolerancePx` at every settled step, and within `frameTolerancePx`
 * at every drawn frame (one pointer step of lag plus the drag threshold).
 */
export function expectGlideFollowed(
  recording: GlideRecording,
  options: {
    what: string;
    speedLimit?: number;
    slackPx?: number;
    followsPointer?: boolean;
    expectedOffset?: ViewportPoint;
    followTolerancePx?: number;
    frameTolerancePx?: number;
  },
) {
  const {
    what,
    speedLimit = 1,
    slackPx = 2,
    followsPointer = false,
    followTolerancePx = 3,
    frameTolerancePx = 12,
  } = options;
  const { steps, frames } = recording;
  const missing = steps.flatMap((sample, step) =>
    sample.element ? [] : [`step ${step} at ${at(sample.pointer)}`],
  );
  const jumps: string[] = [];
  const drift: string[] = [];
  const first = steps[0]!;
  const offset =
    options.expectedOffset ??
    (first.element && {
      x: first.element.x - first.pointer.x,
      y: first.element.y - first.pointer.y,
    });
  const offPointer = (sample: GlideSample) =>
    offset && sample.element
      ? distance(sample.element, {
          x: sample.pointer.x + offset.x,
          y: sample.pointer.y + offset.y,
        })
      : 0;
  steps.forEach((sample, step) => {
    const previous = steps[step - 1];
    if (!sample.element) return;
    if (previous?.element) {
      const moved = distance(sample.element, previous.element);
      const pointerStep = distance(sample.pointer, previous.pointer);
      if (moved > speedLimit * pointerStep + slackPx) {
        jumps.push(
          `step ${step} at ${at(sample.pointer)}: moved ${moved.toFixed(1)} px for a ${pointerStep.toFixed(1)} px pointer step (${at(previous.element)} -> ${at(sample.element)})`,
        );
      }
    }
    if (followsPointer && offPointer(sample) > followTolerancePx) {
      drift.push(
        `step ${step} at ${at(sample.pointer)}: ${offPointer(sample).toFixed(1)} px off the pointer's grab offset`,
      );
    }
  });
  const flashes = followsPointer
    ? frames.flatMap((frame, index) =>
        offPointer(frame) > frameTolerancePx
          ? [
              `frame ${index} drawn at ${at(frame.element!)} with the pointer at ${at(frame.pointer)}: ${offPointer(frame).toFixed(1)} px off`,
            ]
          : [],
      )
    : [];
  expect.soft(missing, `${what}: shown at every step`).toEqual([]);
  expect
    .soft(
      jumps.slice(0, 4),
      `${what}: never outruns the pointer (k = ${speedLimit})`,
    )
    .toEqual([]);
  if (followsPointer) {
    expect
      .soft(drift.slice(0, 4), `${what}: stays under the pointer`)
      .toEqual([]);
    expect
      .soft(flashes.slice(0, 4), `${what}: never drawn away from the pointer`)
      .toEqual([]);
  }
}
