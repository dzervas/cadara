import { defineConfig } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const shouldStartWebServer = (process.env.PLAYWRIGHT_WEB_SERVER ?? "1") !== "0";

function findFontconfigFile() {
  if (process.env.FONTCONFIG_FILE) return process.env.FONTCONFIG_FILE;
  const systemConfig = "/etc/fonts/fonts.conf";
  if (existsSync(systemConfig)) return systemConfig;

  const nixStore = "/nix/store";
  if (!existsSync(nixStore)) return null;
  for (const entry of readdirSync(nixStore)) {
    if (!entry.includes("-fontconfig-")) continue;
    const candidate = join(nixStore, entry, "etc/fonts/fonts.conf");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const fontconfigFile = findFontconfigFile();
if (fontconfigFile) process.env.FONTCONFIG_FILE = fontconfigFile;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 1_000,
  },
  fullyParallel: true,
  // The real-capture import specs each drive a full real-OCC review in their own
  // browser worker. Four of those at once starves them of CPU, which shows up as
  // review wait-cap timeouts rather than as real failures.
  workers: 2,
  retries: 0,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: shouldStartWebServer
    ? {
        command: "bun run dev",
        url: baseURL,
        reuseExistingServer: true,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 120_000,
      }
    : undefined,
});
