import { readFileSync, statSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Opt-in: this row needs a local API with the memory mailer and its stdout file.
const mailerLog = process.env.CADARA_AUTH_MAILER_LOG;

test("magic link creates a persistent API session; sign out clears it without affecting local projects", async ({
  page,
}) => {
  test.skip(!mailerLog, "Set CADARA_AUTH_MAILER_LOG to local wrangler stdout.");
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

test("rejected magic-link requests show inline feedback and a workbench notification", async ({
  page,
}) => {
  await page.route("**/api/auth/sign-in/magic-link", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Unable to send the sign-in link.",
        code: "INVALID_EMAIL",
      }),
    }),
  );
  await page.goto("/app?cadTestMode=1");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("maker@example.test");
  await page
    .getByRole("button", { name: "Email sign-in link", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Unable to send the sign-in link." }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Workbench action failed" }),
  ).toContainText("Unable to send the sign-in link.");
  await expect(
    page.getByText("Workbench action failed", { exact: true }),
  ).toBeVisible();
});
