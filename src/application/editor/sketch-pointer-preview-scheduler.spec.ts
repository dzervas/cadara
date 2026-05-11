import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
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

  expectTrue(
    dispatched.length === 0,
    "Pointer preview moves should wait for the scheduled animation frame.",
  );
  expectTrue(
    frameCallbacks.size === 1,
    "Pointer preview moves should share one pending animation frame.",
  );

  frameCallbacks.get(1)?.(0);

  expectTrue(
    dispatched.length === 1,
    "One coalesced pointer preview should dispatch for the frame.",
  );
  expectTrue(
    dispatched[0]?.type === "sketch.pointerMoved" &&
      dispatched[0].point[0] === 3 &&
      dispatched[0].point[1] === 3,
    "The coalesced pointer preview should use the latest point.",
  );
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

  expectTrue(
    cancelledFrames[0] === 7,
    "Flushing should cancel the stale scheduled frame.",
  );
  expectTrue(
    dispatched.length === 2,
    "Flush should dispatch the pending pointer before the acceptance event.",
  );
  expectTrue(
    dispatched[0]?.type === "sketch.pointerMoved",
    "The pending pointer preview should dispatch first.",
  );
  expectTrue(
    dispatched[1]?.type === "sketch.pointerReleased",
    "The acceptance event should dispatch after the flush.",
  );
});
