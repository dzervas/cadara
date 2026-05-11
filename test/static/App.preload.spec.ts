import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
test("test/static/App.preload.spec.ts", () => {
  const appSource = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
  const bootstrapSource = readFileSync(
    join(process.cwd(), "src/bootstrap.tsx"),
    "utf8",
  );
  const runtimeSource = readFileSync(
    join(process.cwd(), "src/infrastructure/occ/browser-kernel-runtime.ts"),
    "utf8",
  );
  expectTrue(
    runtimeSource.includes("createOccPreloadController") &&
      runtimeSource.includes(
        "getBrowserOccKernelAdapter(performanceTelemetry).preloadRuntime()",
      ),
    "Bootstrap warmup should preload the shared browser OCC runtime owner.",
  );
  expectTrue(
    appSource.includes("errorReporter.report") &&
      /source:\s*['"]occ-preload['"]/.test(appSource),
    "OCC warmup failures should use the existing reported error path.",
  );
  expectTrue(
    appSource.includes("OccWarmupErrorEffect") &&
      !appSource.includes("OccPreloadEffect"),
    "App should observe bootstrap warmup failures without owning the startup trigger.",
  );
});
