import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";

import { expect } from "@playwright/test";

/**
 * The offline sub-lane's production server: `vite preview` of the offline
 * build (`vite.offline-test.config.ts`, by default its `.tmp-offline-dist/`)
 * on the base URL's port, in its own process group so a row can stop it to
 * cut the network.
 */
export function startPreview(
  baseURL: string,
  logPath: string,
  outDir?: string,
) {
  const log = openSync(logPath, "a");
  const server = spawn(
    "bunx",
    [
      "vite",
      "preview",
      "--config",
      "vite.offline-test.config.ts",
      ...(outDir ? ["--outDir", outDir] : []),
      "--host",
      "127.0.0.1",
      "--port",
      new URL(baseURL).port,
      "--strictPort",
    ],
    { detached: true, stdio: ["ignore", log, log] },
  );
  closeSync(log);
  return server;
}

export const reachable = (url: string) =>
  fetch(url).then(
    (response) => response.ok,
    () => false,
  );

/** Stops the preview's process group and waits until its port is closed. */
export async function stopPreview(server: ChildProcess, baseURL: string) {
  try {
    process.kill(-server.pid!, "SIGTERM");
  } catch (error) {
    // Already stopped (the row stops it once to cut the network).
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  await expect
    .poll(() => reachable(baseURL), {
      message: "the preview server is gone",
      timeout: 15_000,
    })
    .toBe(false);
}
