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
