// Lane: logic (docs/testing.md). Seam: the OCC worker the app entry starts
// before the editor bundle loads (cadara-dx2k.15), adopted by the browser
// worker client. Node has no Worker, so a fake EventTarget stands in.
import { afterEach, expect, test, vi } from "vitest";
import {
  startOccModuleWorker,
  takeStartedOccModuleWorker,
} from "@/infrastructure/occ/occ-module-worker";

class FakeWorker extends EventTarget {
  static created: FakeWorker[] = [];
  constructor() {
    super();
    FakeWorker.created.push(this);
  }
}

afterEach(() => {
  takeStartedOccModuleWorker();
  FakeWorker.created = [];
  vi.unstubAllGlobals();
});

test("the entry's worker is adopted once, and a later take starts none", () => {
  vi.stubGlobal("Worker", FakeWorker);
  startOccModuleWorker();
  startOccModuleWorker();
  expect(FakeWorker.created).toHaveLength(1);
  expect(takeStartedOccModuleWorker()).toBe(FakeWorker.created[0]);
  expect(takeStartedOccModuleWorker()).toBeNull();
});

test("a transport failure before adoption reaches the adopter's listener", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  startOccModuleWorker();
  FakeWorker.created[0]!.dispatchEvent(new Event("error"));
  const worker = takeStartedOccModuleWorker()!;
  const failures: string[] = [];
  worker.addEventListener("error", (event) => failures.push(event.type));
  worker.addEventListener("messageerror", (event) => failures.push(event.type));
  await Promise.resolve();
  expect(failures).toEqual(["error"]);
});

test("an adopted worker without a failure gets no event", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  startOccModuleWorker();
  const worker = takeStartedOccModuleWorker()!;
  const failures: string[] = [];
  worker.addEventListener("error", (event) => failures.push(event.type));
  await Promise.resolve();
  expect(failures).toEqual([]);
});
