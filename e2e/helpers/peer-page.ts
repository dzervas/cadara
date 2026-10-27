import type { Page } from "@playwright/test";

export async function foregroundPeerPage(page: Page) {
  // Full Chromium can throttle background-tab compositing and actionability frames.
  if (page.context().pages().length > 1) await page.bringToFront();
}
