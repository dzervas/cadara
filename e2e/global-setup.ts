import { chromium, type FullConfig } from "@playwright/test";

import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

export default async function globalSetup(config: FullConfig) {
  const { baseURL, headless, launchOptions, viewport } = config.projects[0].use;
  const browser = await chromium.launch({ ...launchOptions, headless });

  try {
    const page = await browser.newPage({ baseURL, viewport });
    // A real browser load warms Vite's module/worker graph; an HTTP health
    // check does not. Charge cold transforms to startup, not the first rows'
    // unchanged 30-second interaction budget, using the webServer budget.
    page.setDefaultNavigationTimeout(120_000);
    await new SketchWorkbenchHarness(page).openPreservingStorage();
  } finally {
    await browser.close();
  }
}
