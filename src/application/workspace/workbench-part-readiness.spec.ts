import { expect, test, vi } from "vitest";
import { WorkbenchPartReadiness } from "./workbench-part-readiness";

test("project discovery waits for the shell's current document owner", async () => {
  const readiness = new WorkbenchPartReadiness();
  const ready = readiness.ensure("doc_initial");
  const initial = vi.fn(async () => {});
  const unregister = readiness.register(initial);
  await ready;
  expect(initial).toHaveBeenCalledWith("doc_initial");
  unregister();
  const next = readiness.ensure("doc_next");
  const replacement = vi.fn(async () => {});
  readiness.register(replacement);
  await next;
  expect(initial).toHaveBeenCalledTimes(1);
  expect(replacement).toHaveBeenCalledWith("doc_next");
});

test("cleanup of the previous shell does not unregister a replacement owner", async () => {
  const readiness = new WorkbenchPartReadiness();
  const unregister = readiness.register(async () => {});
  const replacement = vi.fn(async () => {});
  readiness.register(replacement);
  unregister();
  await readiness.ensure("doc_new");
  expect(replacement).toHaveBeenCalledWith("doc_new");
});

test("unmount before owner registration rejects pending and future discovery instead of hanging", async () => {
  const readiness = new WorkbenchPartReadiness();
  const pending = readiness.ensure("doc_initial");
  readiness.dispose();
  await expect(pending).rejects.toThrow("Workbench closed");
  await expect(readiness.ensure("doc_later")).rejects.toThrow(
    "Workbench closed",
  );
});

test("document owner failures propagate to discovery", async () => {
  const readiness = new WorkbenchPartReadiness();
  readiness.register(async () => {
    throw new Error("Worker load failed");
  });
  await expect(readiness.ensure("doc_failed")).rejects.toThrow(
    "Worker load failed",
  );
});
