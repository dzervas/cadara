import { afterEach, expect, test, vi } from "vitest";
import {
  createDwellHint,
  SKETCH_HINT_DWELL_MS,
  SKETCH_HINT_LINGER_MS,
} from "@/hooks/dwell-hint";

// UI lane: the viewport's shared overlap/near-gap hint-state seam, not picking
// eligibility or the purely presentational chip. Timers model gliding pointers.
afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  let visible: string | null = null;
  const hint = createDwellHint<string>((value) => {
    visible = value;
  });
  return { hint, visible: () => visible };
}

test("a gliding vertex shows nothing until the same stack dwells", () => {
  const { hint, visible } = setup();
  hint.hover("vertex", "Point · Line 1 · Line 2");
  expect(visible()).toBeNull();
  vi.advanceTimersByTime(SKETCH_HINT_DWELL_MS - 1);
  hint.hover("vertex", "Point · Line 1 · Line 2");
  expect(visible()).toBeNull();
  vi.advanceTimersByTime(1);
  expect(visible()).toBe("Point · Line 1 · Line 2");
  hint.dispose();
});

test("leaving the stack or canvas lingers for exactly two seconds, even through empty-space moves", () => {
  const { hint, visible } = setup();
  hint.hover("gap", "Merge…");
  vi.advanceTimersByTime(SKETCH_HINT_DWELL_MS);
  hint.leave();
  vi.advanceTimersByTime(SKETCH_HINT_LINGER_MS - 1);
  hint.leave();
  expect(visible()).toBe("Merge…");
  vi.advanceTimersByTime(1);
  expect(visible()).toBeNull();
});

test("a different stack restarts dwell and replaces a lingering hint only after its own dwell", () => {
  const { hint, visible } = setup();
  hint.hover("a", "A");
  vi.advanceTimersByTime(SKETCH_HINT_DWELL_MS - 1);
  hint.hover("b", "B");
  vi.advanceTimersByTime(1);
  expect(visible()).toBeNull();
  vi.advanceTimersByTime(SKETCH_HINT_DWELL_MS - 1);
  expect(visible()).toBe("B");
  hint.leave();
  hint.hover("c", "C");
  vi.advanceTimersByTime(SKETCH_HINT_DWELL_MS - 1);
  expect(visible()).toBe("B");
  vi.advanceTimersByTime(1);
  expect(visible()).toBe("C");
  hint.dispose();
});

test("click/Escape/tool clear cancels a pending dwell and a visible linger immediately", () => {
  const { hint, visible } = setup();
  hint.hover("a", "A");
  expect(visible()).toBeNull();
  hint.clear();
  vi.advanceTimersByTime(SKETCH_HINT_DWELL_MS);
  expect(visible()).toBeNull();
  hint.hover("b", "B");
  vi.advanceTimersByTime(SKETCH_HINT_DWELL_MS);
  hint.leave();
  hint.clear();
  expect(visible()).toBeNull();
  vi.advanceTimersByTime(SKETCH_HINT_LINGER_MS);
  expect(visible()).toBeNull();
});

test("leaving before dwell cancels it; click-generated overlap hints still show immediately", () => {
  const { hint, visible } = setup();
  hint.hover("a", "A");
  hint.leave();
  vi.advanceTimersByTime(SKETCH_HINT_DWELL_MS);
  expect(visible()).toBeNull();
  hint.hover("b", "Next click: B", true);
  expect(visible()).toBe("Next click: B");
  hint.dispose();
});
