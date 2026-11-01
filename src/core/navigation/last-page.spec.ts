// Logic lane: which pages "/" may restore.
import { expect, test } from "vitest";
import { isRememberedPage, rememberPage, resolveLastPage } from "./last-page";

test("root restores dashboard or project and sends an offline dashboard visit to the editor", () => {
  for (const path of [
    "/dashboard",
    "/dashboard/plan",
    "/app/p/remote-id",
    "/app/local/local-id",
    "/app",
  ]) {
    expect(resolveLastPage(path, true, false)).toBe(path);
  }
  expect(resolveLastPage("/dashboard/settings", false, true)).toBe("/app");
  expect(resolveLastPage("/app/local/id", false, false)).toBe("/app/local/id");
  expect(resolveLastPage(null, true, false)).toBeNull();
  expect(resolveLastPage(null, true, true)).toBe("/dashboard");
  expect(resolveLastPage(null, false, true)).toBe("/app");
});

test("page memory accepts only application pages, not external or arbitrary destinations", () => {
  const writes: string[] = [];
  const storage = {
    setItem: (_key: string, value: string) => writes.push(value),
  };
  for (const path of [
    "https://evil.test",
    "//evil.test",
    "/dashboard-other",
    "/unknown",
    "/app/p/id/other",
    // A query (another repository database, diagnostics) never outlives its visit.
    "/app?cadRepositoryDbName=other",
    "/dashboard?cadEnableSentry=1",
  ]) {
    expect(isRememberedPage(path)).toBe(false);
    rememberPage(storage, path);
    expect(resolveLastPage(path, true, false)).toBeNull();
  }
  rememberPage(storage, "/dashboard");
  expect(writes).toEqual(["/dashboard"]);
});
