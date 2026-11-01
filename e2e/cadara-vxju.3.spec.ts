import { readFileSync, statSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openWorkbench, mailerLog } from "./helpers/project-sync";
import { SIGN_IN_OFFER_KEY } from "../src/application/account/sign-in-offer";

// The offer polls every 500 ms on the page clock. Rows that steer it install
// the clock before the page loads, so fastForward runs the polls, and give
// React a real moment to render whatever a poll opened before asserting.
async function advance(page: Page, ms: number) {
  await page.clock.fastForward(ms);
  await page.waitForTimeout(300);
}

// A signed-out guest whose account check answered, without a live API.
async function asGuest(page: Page) {
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({ json: null }),
  );
}

// Clears the suite-wide "already offered" seed once per tab, so a value the
// page writes itself survives a reload.
async function clearOfferSeedOnce(page: Page) {
  await page.addInitScript((key) => {
    if (sessionStorage.getItem("e2e-offer-seed-cleared")) return;
    sessionStorage.setItem("e2e-offer-seed-cleared", "1");
    localStorage.removeItem(key);
  }, SIGN_IN_OFFER_KEY);
}

test("guest dismissal absorbs the outside click and stays dismissed across reloads", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await asGuest(page);
  await clearOfferSeedOnce(page);
  await openWorkbench(page, "/app?cadTestMode=1", true);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Sign in to CADara" });
  await expect(modal).toBeVisible();
  await expect(
    modal.getByText("Sync, share and collaborate", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    canvas.dataset.outsideClickCount = "0";
    new MutationObserver(() => {
      if (document.body.textContent?.includes("Continuing as guest"))
        canvas.dataset.guestAnimation = "seen";
    }).observe(document.body, { childList: true, subtree: true });
    canvas.addEventListener("pointerdown", () => {
      canvas.dataset.outsideClickCount = "1";
    });
  });
  await page
    .locator("[data-sign-in-backdrop]")
    .click({ position: { x: 5, y: 200 } });
  await expect(page.locator("canvas").first()).toHaveAttribute(
    "data-guest-animation",
    "seen",
  );
  await expect(modal).toHaveCount(0);
  expect(
    await page
      .locator("canvas")
      .first()
      .getAttribute("data-outside-click-count"),
  ).toBe("0");
  await page.clock.install();
  await page.reload();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await advance(page, 30_000);
  await expect(modal).toHaveCount(0);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.keyboard.press("Escape");
  await advance(page, 5000);
  await expect(modal).toHaveCount(0);
});

test("automatic offer waits for online idle and a released pointer", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await asGuest(page);
  await clearOfferSeedOnce(page);
  await page.clock.install();
  await openWorkbench(page, "/app?cadTestMode=1", true);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const modal = page.getByRole("dialog", { name: "Sign in to CADara" });
  await advance(page, 15_000);
  await expect(modal).toHaveCount(0);
  await context.setOffline(true);
  await advance(page, 10_000);
  await expect(modal).toHaveCount(0);
  await page.mouse.move(650, 400);
  await page.mouse.down();
  await context.setOffline(false);
  await advance(page, 4000);
  await expect(modal).toHaveCount(0);
  await page.mouse.up();
  await advance(page, 2000);
  await expect(modal).toHaveCount(0);
  await advance(page, 2000);
  await expect(modal).toBeVisible();
});

test("email code signs in in place; wrong code is visible and retry succeeds", async ({
  page,
}) => {
  test.skip(!mailerLog, "Requires local memory mailer");
  test.setTimeout(90_000);
  await openWorkbench(page, "/app?cadTestMode=1");
  const email = `code-${Date.now()}@example.test`;
  const offset = statSync(mailerLog!).size;
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Email sent to" }),
  ).toContainText(email);
  let code = "";
  await expect
    .poll(() => {
      const line = readFileSync(mailerLog!)
        .subarray(offset)
        .toString("utf8")
        .split("\n")
        .find((entry) => entry.includes(`Sign-in code for ${email}:`));
      code = line?.match(/: (\d{6})/)?.[1] ?? "";
      return code.length;
    })
    .toBe(6);
  const url = page.url();
  await page
    .getByRole("textbox", { name: "Sign-in code" })
    .fill(code === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("textbox", { name: "Sign-in code" }).fill(code);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(
    page.getByRole("dialog", { name: "Sign in to CADara" }),
  ).toHaveCount(0);
  expect(page.url()).toBe(url);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
});

test("an active tool defers the automatic offer; unsupported passkey autofill stays hidden", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await asGuest(page);
  await clearOfferSeedOnce(page);
  await page.addInitScript(() => {
    Object.defineProperty(
      PublicKeyCredential,
      "isConditionalMediationAvailable",
      { value: async () => false },
    );
  });
  await page.clock.install();
  await openWorkbench(page, "/app?cadTestMode=1", true);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("button", { name: "Sketch", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Sign in to CADara" });
  await advance(page, 30_000);
  await expect(modal).toHaveCount(0);
  // Ending the tool lets the offer through once the pointer has rested.
  // Escape reaches the editor once the toolbar button lets go of focus; an
  // open toolbar tooltip takes the first one.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByText("part / idle / none")).toBeVisible({
      timeout: 500,
    });
  }).toPass();
  await advance(page, 4000);
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Sign in with passkey" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  // An explicit account request is immediate even while a tool is selected.
  await page.getByRole("button", { name: "Sketch", exact: true }).click();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(modal).toBeVisible();
});

test("an account check that fails while the browser is online never offers sign-in automatically", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // A signed-in user whose account service is down is not a guest.
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({ status: 503, body: "" }),
  );
  await clearOfferSeedOnce(page);
  await page.clock.install();
  await openWorkbench(page, "/app?cadTestMode=1", true);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await advance(page, 40_000);
  await expect(
    page.getByRole("dialog", { name: "Sign in to CADara" }),
  ).toHaveCount(0);
});
