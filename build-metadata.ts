import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

const buildMetadataModuleId = "virtual:cadara-build-metadata";
const resolvedBuildMetadataModuleId = `\0${buildMetadataModuleId}`;

interface PackageMetadata {
  name?: unknown;
  version?: unknown;
}

function readPackageMetadata(rootDir: string) {
  return JSON.parse(
    readFileSync(path.join(rootDir, "package.json"), "utf8"),
  ) as PackageMetadata;
}

function readPackageName(rootDir: string) {
  const packageJson = readPackageMetadata(rootDir);

  return typeof packageJson.name === "string" ? packageJson.name : "app";
}

function readPackageVersion(rootDir: string) {
  const packageJson = readPackageMetadata(rootDir);

  return typeof packageJson.version === "string"
    ? packageJson.version
    : "0.0.0";
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

export interface SentryBuildMetadata {
  release: string | null;
  dist: string | null;
  environment: string;
}

export function readSentryBuildMetadata(rootDir: string): SentryBuildMetadata {
  const releaseCommit =
    process.env.CF_PAGES_COMMIT_SHA ?? readGitCommit(rootDir, "full");
  const packageName = readPackageName(rootDir);
  const release =
    process.env.SENTRY_RELEASE ??
    (releaseCommit === "unknown" ? null : `${packageName}@${releaseCommit}`);

  return {
    release,
    dist: process.env.SENTRY_DIST ?? process.env.CF_PAGES_BRANCH ?? null,
    environment: process.env.SENTRY_ENVIRONMENT ?? "production",
  };
}

export function createBuildMetadataPlugin(rootDir: string): Plugin {
  return {
    name: "cadara-build-metadata",
    resolveId(id) {
      return id === buildMetadataModuleId
        ? resolvedBuildMetadataModuleId
        : null;
    },
    load(id) {
      if (id !== resolvedBuildMetadataModuleId) {
        return null;
      }

      const sentryBuildMetadata = readSentryBuildMetadata(rootDir);

      return [
        `export const appVersion = ${JSON.stringify(readPackageVersion(rootDir))};`,
        `export const gitCommit = ${JSON.stringify(readGitCommit(rootDir, "short"))};`,
        `export const sentryRelease = ${JSON.stringify(sentryBuildMetadata.release)};`,
        `export const sentryDist = ${JSON.stringify(sentryBuildMetadata.dist)};`,
      ].join("\n");
    },
  };
}
