import { expect, test } from "vitest";
import {
  createLoadingStatus,
  selectInitialLoadingPhase,
} from "./loading-status";

test("loading status replays its latest boundary and stops delivery on unsubscribe/disposal", () => {
  const source = createLoadingStatus("preparing-engine");
  source.set("ready");
  const seen: string[] = [];
  const stop = source.subscribe(() => seen.push(source.getSnapshot()));
  expect(seen).toEqual(["ready"]);
  source.set("failed");
  expect(seen).toEqual(["ready", "failed"]);
  stop();
  source.set("ready");
  expect(seen).toHaveLength(2);
  source.dispose();
  source.set("failed");
  source.subscribe(() => seen.push("disposed"));
  expect(source.getSnapshot()).toBe("ready");
  expect(seen).toHaveLength(2);
});

test("measured progress is retained for late observers, clamped, monotonic, and ended by the next phase", () => {
  const source = createLoadingStatus("preparing-geometry");
  const step = (completed: number, total = 3) => ({
    stage: "rebuilding-features" as const,
    completed,
    total,
    label: `Extrude ${completed + 1}`,
  });
  source.setProgress(step(1));
  const seen: unknown[] = [];
  source.subscribe(() => seen.push(source.getProgress()));
  expect(seen).toEqual([step(1)]);
  source.setProgress(step(0));
  expect(source.getProgress()).toEqual(step(1));
  source.setProgress({ ...step(9), label: null });
  expect(source.getProgress()).toEqual({ ...step(3), label: null });
  source.setProgress(null);
  expect(source.getProgress()).toBeNull();
  source.setProgress(step(2));
  source.set("ready");
  expect(source.getProgress()).toBeNull();
  source.setProgress(step(2));
  expect(source.getProgress()).toBeNull();
  expect(seen).toEqual([step(1), { ...step(3), label: null }, null, step(2), null]);
});

test("engine work precedes document work, but completed or failed documents stay terminal", () => {
  expect(
    selectInitialLoadingPhase("preparing-engine", "opening-document"),
  ).toBe("preparing-engine");
  expect(selectInitialLoadingPhase("ready", "opening-document")).toBe(
    "opening-document",
  );
  expect(selectInitialLoadingPhase("ready", "preparing-geometry")).toBe(
    "preparing-geometry",
  );
  expect(selectInitialLoadingPhase("failed", "preparing-geometry")).toBe(
    "failed",
  );
  expect(selectInitialLoadingPhase("failed", "ready")).toBe("ready");
  expect(selectInitialLoadingPhase("preparing-engine", "failed")).toBe(
    "failed",
  );
});
