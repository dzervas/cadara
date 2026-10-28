import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";

import {
  createBuildMetadataDefines,
  readBuildMetadata,
} from "../build-metadata";

let rootDir: string;
let fullCommit: string;

function git(args: string[], input?: string) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

beforeAll(() => {
  rootDir = mkdtempSync(path.join(os.tmpdir(), "cadara-build-metadata-"));
  writeFileSync(
    path.join(rootDir, "package.json"),
    JSON.stringify({ name: "cadara", version: "0.0.1" }),
  );
  git(["init", "--quiet"]);
  const tree = git(["hash-object", "-t", "tree", "-w", "--stdin"], "");
  fullCommit = git(
    ["hash-object", "-t", "commit", "-w", "--stdin"],
    `tree ${tree}\nauthor Build Fixture <fixture@example.test> 0 +0000\ncommitter Build Fixture <fixture@example.test> 0 +0000\n\nBuild metadata fixture\n`,
  );
  git(["update-ref", "HEAD", fullCommit]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

test("build metadata injects the package version and short HEAD while preserving the full release hash", () => {
  vi.stubEnv("CF_PAGES_COMMIT_SHA", undefined);
  vi.stubEnv("SENTRY_RELEASE", undefined);

  const metadata = readBuildMetadata(rootDir);

  expect(metadata.gitCommit).toBe(git(["rev-parse", "--short", "HEAD"]));
  expect(metadata.sentryRelease).toBe(`cadara@${fullCommit}`);
  expect(metadata.appVersion).toBe("0.0.1");
  expect(createBuildMetadataDefines(metadata)).toMatchObject({
    __CADARA_APP_VERSION__: '"0.0.1"',
    __CADARA_GIT_COMMIT__: JSON.stringify(metadata.gitCommit),
    __CADARA_SENTRY_RELEASE__: JSON.stringify(`cadara@${fullCommit}`),
  });
});

test("build metadata injects SENTRY_DSN only when the build environment sets it", () => {
  vi.stubEnv("SENTRY_DSN", "https://key@example.ingest.sentry.io/1");
  expect(
    createBuildMetadataDefines(readBuildMetadata(rootDir))
      .__CADARA_SENTRY_DSN__,
  ).toBe(JSON.stringify("https://key@example.ingest.sentry.io/1"));

  // Cloudflare Pages and shells can export an empty variable.
  vi.stubEnv("SENTRY_DSN", "");
  expect(
    createBuildMetadataDefines(readBuildMetadata(rootDir))
      .__CADARA_SENTRY_DSN__,
  ).toBe("null");
});

test("build metadata uses unknown for a source archive without Git metadata", () => {
  vi.stubEnv("CF_PAGES_COMMIT_SHA", undefined);
  vi.stubEnv("SENTRY_RELEASE", undefined);
  const archiveDir = mkdtempSync(
    path.join(os.tmpdir(), "cadara-build-archive-"),
  );
  try {
    writeFileSync(
      path.join(archiveDir, "package.json"),
      JSON.stringify({ name: "cadara", version: "0.0.1" }),
    );

    const metadata = readBuildMetadata(archiveDir);

    expect(metadata.gitCommit).toBe("unknown");
    expect(metadata.sentryRelease).toBeNull();
    expect(metadata.appVersion).toBe("0.0.1");
  } finally {
    rmSync(archiveDir, { recursive: true, force: true });
  }
});
