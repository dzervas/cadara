import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("production custom OCC preserves neutral curve parameters, contacts and exact trimmed solids", () => {
  // Run in isolation: Emscripten owns process globals; never substitute the installed full build.
  const probe = spawnSync(
    process.execPath.endsWith("bun") ? "node" : process.execPath,
    [
      fileURLToPath(
        new URL("../../../scripts/occ/probe-custom-build.mjs", import.meta.url),
      ),
    ],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (probe.error) throw probe.error;
  const result = JSON.parse(probe.stdout.trim());
  const failures = result.cases.filter(
    (entry: { status: string }) => entry.status !== "pass",
  );
  expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  expect(result.summary).toEqual({ pass: 13, error: 0 });
  expect(probe.status, probe.stderr).toBe(0);
}, 65_000);
