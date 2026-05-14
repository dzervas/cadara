import { test, expect } from "vitest";

import { createOccPreloadController } from "@/domain/modeling/occ/preload";

test("src/domain/modeling/occ/preload.spec.ts", async () => {
  async function testPreloadStartsOnceForRepeatedCalls() {
    let preloadCalls = 0;
    const controller = createOccPreloadController({
      preload: async () => {
        preloadCalls += 1;
      },
    });

    await Promise.all([
      controller.preload(),
      controller.preload(),
      controller.preload(),
    ]);

    expect(preloadCalls, "OCC eager preload must not duplicate an in-flight runtime load.").toBe(1);
  }

  async function testPreloadRetriesAfterFailure() {
    let preloadCalls = 0;
    const controller = createOccPreloadController({
      preload: async () => {
        preloadCalls += 1;
        if (preloadCalls === 1) {
          throw new Error("preload failed");
        }
      },
    });

    let failed = false;
    try {
      await controller.preload();
    } catch (error) {
      failed = error instanceof Error && error.message === "preload failed";
    }

    await controller.preload();

    expect(failed, "OCC preload failures must be surfaced to the caller.").toBeTruthy();
    expect(preloadCalls, "OCC preload must retry after a failed load.").toBe(2);
  }

  await testPreloadStartsOnceForRepeatedCalls();
  await testPreloadRetriesAfterFailure();
});
