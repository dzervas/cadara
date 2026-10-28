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
  // The probe's exit status also covers the mesh budget
  // (scripts/occ/topology-mesh-budget-conformance.mjs) and the mesh-buffer
  // builder (scripts/occ/topology-mesh-buffers-conformance.mjs); their own
  // messages say when the assets predate the shim.
  for (const conformance of [
    result.topologyMeshBudget,
    result.topologyMeshBuffers,
  ]) {
    expect(
      conformance.cases
        .filter((entry: { status: string }) => entry.status !== "pass")
        .map((entry: { error: string }) => entry.error.split("\n")[0]),
    ).toEqual([]);
  }
  expect(probe.status, probe.stderr).toBe(0);
}, 65_000);
