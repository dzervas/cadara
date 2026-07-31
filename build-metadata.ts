import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

interface PackageMetadata {
  name?: unknown;
  version?: unknown;
}

function readPackageMetadata(rootDir: string) {
  return JSON.parse(
    readFileSync(path.join(rootDir, "package.json"), "utf8"),
  ) as PackageMetadata;
}

function readGitCommit(rootDir: string, length: "short" | "full") {
  try {
    return execFileSync(
      "git",
      ["rev-parse", length === "short" ? "--short" : "HEAD"],
      {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return "unknown";
  }
}

export interface BuildMetadata {
  appVersion: string;
  gitCommit: string;
  sentryRelease: string | null;
  sentryDist: string | null;
  sentryEnvironment: string;
}

export function readBuildMetadata(rootDir: string): BuildMetadata {
  const packageJson = readPackageMetadata(rootDir);
  const packageName =
    typeof packageJson.name === "string" ? packageJson.name : "app";
  const releaseCommit =
    process.env.CF_PAGES_COMMIT_SHA ?? readGitCommit(rootDir, "full");

  return {
    appVersion:
      typeof packageJson.version === "string" ? packageJson.version : "0.0.0",
    gitCommit: readGitCommit(rootDir, "short"),
    sentryRelease:
      process.env.SENTRY_RELEASE ??
      (releaseCommit === "unknown" ? null : `${packageName}@${releaseCommit}`),
    sentryDist: process.env.SENTRY_DIST ?? process.env.CF_PAGES_BRANCH ?? null,
    sentryEnvironment: process.env.SENTRY_ENVIRONMENT ?? "production",
  };
}

export function createBuildMetadataDefines(metadata: BuildMetadata) {
  return {
    __CADARA_APP_VERSION__: JSON.stringify(metadata.appVersion),
    __CADARA_GIT_COMMIT__: JSON.stringify(metadata.gitCommit),
    __CADARA_SENTRY_RELEASE__: JSON.stringify(metadata.sentryRelease),
    __CADARA_SENTRY_DIST__: JSON.stringify(metadata.sentryDist),
  };
}
