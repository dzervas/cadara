import { afterEach, expect, test } from "vitest";
import {
  existsSync,
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
import { createHash } from "node:crypto";

const temporaryDirectories: string[] = [];
const repository = fileURLToPath(new URL("../../../", import.meta.url));

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function prepareStage() {
  const directory = mkdtempSync(join(tmpdir(), "cadara-occ-stage-"));
  temporaryDirectories.push(directory);
  const stage = join(directory, "stage");
  const prepare = spawnSync(
    "bash",
    [join(repository, "scripts/stage-occ-build.sh"), stage],
    { encoding: "utf8" },
  );
  expect(prepare.status, prepare.stderr).toBe(0);
  return { directory, stage };
}

interface StagedBuildOptions {
  rootless: boolean;
  preflightFails?: boolean;
  buildSucceeds?: boolean;
  probeStatus?: number;
  lifetimeStatus?: number;
}

function runStagedBuild({
  rootless,
  preflightFails = false,
  buildSucceeds = false,
  probeStatus = 0,
  lifetimeStatus = 0,
}: StagedBuildOptions) {
  const { directory, stage } = prepareStage();
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const callsFile = join(directory, "calls.jsonl");
  writeFileSync(
    join(bin, "docker"),
    // Absolute interpreter: the fake node below shadows node on PATH.
    `#!${process.execPath}
const { appendFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.CALLS, JSON.stringify(["docker", ...args]) + "\\n");
if (args[0] === "info") {
  console.log(process.env.ROOTLESS === "1" ? '["name=rootless"]' : '["name=seccomp,profile=builtin"]');
} else if (args.includes("/bin/sh")) {
  process.exit(process.env.PREFLIGHT_FAILS === "1" ? 73 : 0);
} else if (process.env.BUILD_SUCCEEDS === "1") {
  // Emulate the compiler writing its outputs into the bound stage.
  for (const name of ["cadara-occ.js", "cadara-occ.wasm", "cadara-occ.d.ts"])
    writeFileSync(process.env.STAGE + "/" + name, name);
} else {
  // Stop at the build boundary; never invoke a real compiler.
  process.exit(74);
}
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "node"),
    `#!/usr/bin/env bash
printf '["node","%s"]\\n' "$1" >> "$CALLS"
case $1 in
  probe/probe-custom-build.mjs) exit "$PROBE_STATUS" ;;
  probe/native-lifetime-conformance.mjs) exit "$LIFETIME_STATUS" ;;
esac
exit 99
`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", [join(stage, "build.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CALLS: callsFile,
      STAGE: stage,
      ROOTLESS: rootless ? "1" : "0",
      PREFLIGHT_FAILS: preflightFails ? "1" : "0",
      BUILD_SUCCEEDS: buildSucceeds ? "1" : "0",
      PROBE_STATUS: String(probeStatus),
      LIFETIME_STATUS: String(lifetimeStatus),
    },
  });
  const calls = readFileSync(callsFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  return { result, calls, stage };
}

const image =
  "donalffons/opencascade.js:2.0.0-beta.b5ff984@sha256:3069f4c2e3ab62bb82d81843bad2c0f8552ee92373208f8f655ef9bf71c0524d";

test.each([true, false])(
  "staged OCC build uses matching preflight/build identities and the patched generator (rootless=%s)",
  (rootless) => {
    const { result, calls, stage } = runStagedBuild({ rootless });
    expect(result.status, result.stderr).toBe(74);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual([
      "docker",
      "info",
      "--format",
      "{{json .SecurityOptions}}",
    ]);
    const [preflight, build] = calls.slice(1);
    expect(preflight).toContain("/bin/sh");
    // The shared staged helper patches and regenerates before buildFromYaml.
    expect(build.slice(build.indexOf("--entrypoint"))).toEqual([
      "--entrypoint",
      "/bin/bash",
      image,
      "/src/regen-patched-bindings.sh",
      "opencascade-recipe.yaml",
    ]);
    for (const call of [preflight, build]) {
      expect(call).toContain(`type=bind,source=${stage},target=/src`);
      expect(call).toContain(image);
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
  const { result, calls } = runStagedBuild({
    rootless: true,
    preflightFails: true,
  });
  expect(result.status, result.stderr).toBe(73);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toContain("/bin/sh");
  expect(calls.flat()).not.toContain("opencascade-recipe.yaml");
  expect(calls.flat()).not.toContain("/src/regen-patched-bindings.sh");
});

test("staged build runs the lifetime gate after the existing probe and propagates its failure", () => {
  const passing = runStagedBuild({ rootless: true, buildSucceeds: true });
  expect(passing.result.status, passing.result.stderr).toBe(0);
  expect(passing.calls.slice(3)).toEqual([
    ["node", "probe/probe-custom-build.mjs"],
    ["node", "probe/native-lifetime-conformance.mjs"],
  ]);
  const lifetimeFails = runStagedBuild({
    rootless: true,
    buildSucceeds: true,
    lifetimeStatus: 1,
  });
  expect(lifetimeFails.result.status).toBe(1);
  const probeFails = runStagedBuild({
    rootless: true,
    buildSucceeds: true,
    probeStatus: 1,
  });
  expect(probeFails.result.status).toBe(1);
  expect(probeFails.calls.at(-1)).toEqual([
    "node",
    "probe/probe-custom-build.mjs",
  ]);
});

test("stage pins the generator patch, shared helper and lifetime gate as hashed inputs", () => {
  const { stage } = prepareStage();
  const inputs = new Map(
    readFileSync(join(stage, "inputs.sha256"), "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const [hash, path] = line.split(/\s+/);
        return [path, hash];
      }),
  );
  const sha256 = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  for (const [staged, source] of [
    [
      "occ-binding-patches/opencascade-js-raw-destructor.patch",
      "occ-binding-patches/opencascade-js-raw-destructor.patch",
    ],
    ["regen-patched-bindings.sh", "scripts/occ/regen-patched-bindings.sh"],
    [
      "probe/native-lifetime-conformance.mjs",
      "scripts/occ/native-lifetime-conformance.mjs",
    ],
  ]) {
    expect(inputs.get(staged), staged).toBe(sha256(join(repository, source)));
  }
  // The helper refuses any patch other than the pinned one.
  const helper = readFileSync(join(stage, "regen-patched-bindings.sh"), "utf8");
  expect(helper).toContain(
    `patch_sha256=${inputs.get("occ-binding-patches/opencascade-js-raw-destructor.patch")}`,
  );
});

test("rootfs runner invokes the shared helper, gates on lifetime and refuses stale outputs", () => {
  const { stage, directory } = prepareStage();
  const runner = readFileSync(join(stage, "build-rootfs.sh"), "utf8");
  expect(runner).toContain(
    "/bin/bash /src/regen-patched-bindings.sh opencascade-recipe.yaml",
  );
  expect(runner).not.toMatch(/^\s*\/opencascade\.js\/src\/buildFromYaml\.py/m);
  const probe = runner.indexOf("node probe/probe-custom-build.mjs");
  const lifetime = runner.indexOf("node probe/native-lifetime-conformance.mjs");
  expect(probe).toBeGreaterThan(runner.indexOf("regen-patched-bindings.sh"));
  expect(lifetime).toBeGreaterThan(probe);
  writeFileSync(join(stage, "cadara-occ.js"), "stale");
  const runtime = join(directory, "runtime");
  const stale = spawnSync("bash", [join(stage, "build-rootfs.sh"), runtime], {
    encoding: "utf8",
  });
  expect(stale.status).toBe(2);
  expect(stale.stdout + stale.stderr).toContain("Refusing stale output");
  expect(existsSync(join(runtime, "rootfs"))).toBe(true);
  expect(existsSync(join(stage, "image-manifest.json"))).toBe(false);
});
