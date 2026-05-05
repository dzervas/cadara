import { defineConfig } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
const shouldStartWebServer = (process.env.PLAYWRIGHT_WEB_SERVER ?? '1') !== '0'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 1_000,
  },
  fullyParallel: true,
  workers: 4,
  retries: 0,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: shouldStartWebServer
    ? {
        command: 'bun run dev',
        url: baseURL,
        reuseExistingServer: true,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 120_000,
      }
    : undefined,
})
