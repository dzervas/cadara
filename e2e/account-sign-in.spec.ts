import { readFileSync, statSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Opt-in: this row needs a local API with the memory mailer and its stdout file.
const mailerLog = process.env.CADARA_AUTH_MAILER_LOG;
test.skip(!mailerLog, "Set CADARA_AUTH_MAILER_LOG to local wrangler stdout.");

test("magic link creates a persistent API session; sign out clears it without affecting local projects", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const logOffset = statSync(mailerLog!).size;
  let sessionRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/get-session")
      sessionRequests += 1;
  });
  await page.goto("/app?cadTestMode=1");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  const email = `cadara-${Date.now()}@example.test`;
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Email sign-in link", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Check your inbox" }),
  ).toContainText(email);
  let link = "";
  await expect
    .poll(
      () => {
        const output = readFileSync(mailerLog!, "utf8").slice(logOffset);
        link = output.match(/Magic link: (http\S+)/)?.[1] ?? "";
        return Boolean(link);
      },
      { message: "Memory mailer emitted a sign-in link" },
    )
    .toBe(true);
  await page.goto(link);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page.getByText(/Personal · owner/)).toBeVisible();
  const settledSessionRequests = sessionRequests;
  await page.evaluate(async () => {
    for (let frame = 0; frame < 20; frame += 1) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
  });
  expect(
    sessionRequests,
    "Rendering the account must not re-fetch the session",
  ).toBe(settledSessionRequests);
  await page.reload();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Email sign-in link", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Email sign-in link", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue("My project");
});
