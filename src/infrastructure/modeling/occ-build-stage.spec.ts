import { afterEach, expect, test } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runStagedBuild(rootless: boolean, preflightFails = false) {
  const directory = mkdtempSync(join(tmpdir(), "cadara-occ-stage-"));
  temporaryDirectories.push(directory);
  const stage = join(directory, "stage");
  const prepare = spawnSync(
    "bash",
    [
      fileURLToPath(
        new URL("../../../scripts/stage-occ-build.sh", import.meta.url),
      ),
      stage,
    ],
    { encoding: "utf8" },
  );
  expect(prepare.status, prepare.stderr).toBe(0);
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const callsFile = join(directory, "docker-calls.jsonl");
  writeFileSync(
    join(bin, "docker"),
    `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.DOCKER_CALLS, JSON.stringify(args) + "\\n");
if (args[0] === "info") {
  console.log(process.env.ROOTLESS === "1" ? '["name=rootless"]' : '["name=seccomp,profile=builtin"]');
} else if (args.includes("--entrypoint")) {
  process.exit(process.env.PREFLIGHT_FAILS === "1" ? 73 : 0);
} else {
  // Stop at the build boundary; never invoke a real compiler or conformance probe.
  process.exit(74);
}
`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", [join(stage, "build.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DOCKER_CALLS: callsFile,
      ROOTLESS: rootless ? "1" : "0",
      PREFLIGHT_FAILS: preflightFails ? "1" : "0",
    },
  });
  const calls = readFileSync(callsFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  return { result, calls, stage };
}

test.each([true, false])(
  "staged OCC build uses matching preflight/build identities (rootless=%s)",
  (rootless) => {
    const { result, calls, stage } = runStagedBuild(rootless);
    expect(result.status, result.stderr).toBe(74);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual(["info", "--format", "{{json .SecurityOptions}}"]);
    const [preflight, build] = calls.slice(1);
    expect(preflight).toContain("--entrypoint");
    expect(preflight).toContain("/bin/sh");
    expect(build.at(-1)).toBe("opencascade-recipe.yaml");
    for (const call of [preflight, build]) {
      expect(call).toContain(`type=bind,source=${stage},target=/src`);
      expect(call.includes("--user")).toBe(!rootless);
      if (!rootless) {
        expect(call[call.indexOf("--user") + 1]).toBe(
          `${process.getuid!()}:${process.getgid!()}`,
        );
      }
    }
  },
);

test("unwritable staged mount stops before compilation", () => {
  const { result, calls } = runStagedBuild(true, true);
  expect(result.status, result.stderr).toBe(73);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toContain("--entrypoint");
  expect(calls.flat()).not.toContain("opencascade-recipe.yaml");
});
