import { test, expect } from "vitest";

import { createSketchPointerPreviewScheduler } from "@/application/editor/sketch-pointer-preview-scheduler";
import type { EditorEvent } from "@/domain/editor/state-machine";

test("src/application/editor/sketch-pointer-preview-scheduler.spec.ts coalesces pointer previews to the latest frame event", () => {
  const dispatched: EditorEvent[] = [];
  const frameCallbacks = new Map<number, (time: number) => void>();
  let nextFrameId = 1;
  const scheduler = createSketchPointerPreviewScheduler({
    dispatchEvent: (event) => dispatched.push(event),
    requestFrame: (callback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      frameCallbacks.set(frameId, callback);
      return frameId;
    },
    cancelFrame: (frameId) => {
      frameCallbacks.delete(frameId);
    },
  });

  scheduler.dispatch({ type: "sketch.pointerMoved", point: [1, 1] });
  scheduler.dispatch({ type: "sketch.pointerMoved", point: [2, 2] });
  scheduler.dispatch({ type: "sketch.pointerMoved", point: [3, 3] });

  expect(
    dispatched.length,
    "Pointer preview moves should wait for the scheduled animation frame.",
  ).toBe(0);
  expect(
    frameCallbacks.size,
    "Pointer preview moves should share one pending animation frame.",
  ).toBe(1);

  frameCallbacks.get(1)?.(0);

  expect(
    dispatched.length,
    "One coalesced pointer preview should dispatch for the frame.",
  ).toBe(1);
  expect(
    dispatched[0]?.type === "sketch.pointerMoved" &&
      dispatched[0].point[0] === 3 &&
      dispatched[0].point[1] === 3,
    "The coalesced pointer preview should use the latest point.",
  ).toBeTruthy();
});

test("src/application/editor/sketch-pointer-preview-scheduler.spec.ts flushes pending pointer preview before acceptance events", () => {
  const dispatched: EditorEvent[] = [];
  const cancelledFrames: number[] = [];
  const scheduler = createSketchPointerPreviewScheduler({
    dispatchEvent: (event) => dispatched.push(event),
    requestFrame: () => 7,
    cancelFrame: (frameId) => {
      cancelledFrames.push(frameId);
    },
  });

  scheduler.dispatch({ type: "sketch.pointerMoved", point: [4, 5] });
  scheduler.dispatch({ type: "sketch.pointerReleased", point: [6, 7] });

  expect(
    cancelledFrames[0],
    "Flushing should cancel the stale scheduled frame.",
  ).toBe(7);
  expect(
    dispatched.length,
    "Flush should dispatch the pending pointer before the acceptance event.",
  ).toBe(2);
  expect(
    dispatched[0]?.type,
    "The pending pointer preview should dispatch first.",
  ).toBe("sketch.pointerMoved");
  expect(
    dispatched[1]?.type,
    "The acceptance event should dispatch after the flush.",
  ).toBe("sketch.pointerReleased");
});
