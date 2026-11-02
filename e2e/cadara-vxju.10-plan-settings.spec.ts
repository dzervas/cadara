// E2E lane (live account API): the Usage & plan page follows hosted billing
// pages, and Settings edits the profile, passkeys and API keys, exports the
// account archive and deletes the account. Only the browser proves page
// navigation to the returned hosted URL, WebAuthn registration and downloads.
//
// Run against `wrangler dev --var BILLING:memory` (the memory billing adapter
// returns https://billing.example.test/{checkout,portal}) with one worker; see
// e2e/helpers/project-sync.ts for the mailer log.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { planOffers } from "../src/dashboard/plan/plan-offers";
import { mailerLog, openWorkbench, signIn } from "./helpers/project-sync";

test.setTimeout(180_000);

const hostedBilling = "https://billing.example.test";

async function signInFresh(page: Page, label: string, baseURL: string) {
  await openWorkbench(page, new URL("/app?cadTestMode=1", baseURL).href);
  const email = `${label}-${Date.now()}@example.test`;
  const apiOrigin = await signIn(page, email);
  return { email, apiOrigin };
}

test.beforeEach(() => {
  test.skip(!mailerLog, "Set CADARA_AUTH_MAILER_LOG to local wrangler stdout.");
});

test("Usage & plan shows the sidebar's usage bars and opens hosted checkout and the billing portal", async ({
  page,
}, testInfo) => {
  const { apiOrigin } = await signInFresh(
    page,
    "plan",
    testInfo.project.use.baseURL!,
  );
  // The hosted provider is the only thing not served locally.
  await page.route(`${hostedBilling}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Hosted billing</title>",
    }),
  );
  await page.goto("/dashboard/plan");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "Usage & plan", exact: true }),
  ).toBeVisible();
  // An empty bar has no visible fill, so presence is asserted, not visibility.
  for (const bar of ["storage", "private projects"])
    await expect(
      main.getByRole("progressbar", { name: `Personal ${bar} usage` }),
    ).toHaveAttribute("aria-valuenow", "0");
  await expect(main.getByText("0 of 3 private projects")).toBeVisible();
  const card = (tier: keyof typeof planOffers) =>
    main.getByRole("article", { name: `${planOffers[tier].label} plan` });
  await expect(card("free").getByText("Current plan")).toBeVisible();
  // A personal workspace never buys Team; its Team card creates a team.
  await expect(card("team").getByRole("button")).toHaveCount(1);
  await card("team")
    .getByRole("button", { name: "Create team", exact: true })
    .click();
  const createTeam = page.getByRole("dialog", { name: "Create team" });
  await expect(createTeam).toBeVisible();
  await createTeam.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(createTeam).toHaveCount(0);
  await expect(
    main.getByRole("button", { name: "Manage billing" }),
  ).toHaveCount(0);

  const checkout = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().startsWith(apiOrigin) &&
      request.url().endsWith("/billing/checkout"),
  );
  await card("individual")
    .getByRole("button", {
      name: `Upgrade to ${planOffers.individual.label}`,
    })
    .click();
  expect((await checkout).postDataJSON()).toEqual({ tier: "individual" });
  await expect(page).toHaveURL(`${hostedBilling}/checkout`);

  // Local billing has no webhook to activate the subscription; present the
  // workspace as paid so the page offers the portal, which stays live.
  await page.route(`${apiOrigin}/me`, async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as {
      organizations: { entitlements: { tier: string } }[];
    };
    me.organizations[0]!.entitlements.tier = "individual";
    await route.fulfill({ response, json: me });
  });
  await page.goto("/dashboard/plan");
  await expect(card("individual").getByText("Current plan")).toBeVisible();
  await expect(main.getByRole("button", { name: /^Upgrade to/ })).toHaveCount(
    0,
  );
  const portal = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().startsWith(apiOrigin) &&
      response.url().endsWith("/billing/portal"),
  );
  await main.getByRole("button", { name: "Manage billing" }).click();
  expect((await portal).status()).toBe(200);
  await expect(page).toHaveURL(`${hostedBilling}/portal`);
});

test("Settings edits the profile, registers and removes a passkey, manages API keys and exports the account", async ({
  page,
}, testInfo) => {
  const { apiOrigin } = await signInFresh(
    page,
    "settings",
    testInfo.project.use.baseURL!,
  );
  // While the account loads, a signed-in visitor sees a loader, never the
  // guest sign-in prompt.
  await page.route(`${apiOrigin}/me`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto("/dashboard/settings");
  await expect(page.getByLabel("Loading Settings")).toBeVisible();
  await expect(page.getByText("Sign in to access this page.")).toHaveCount(0);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  // Let delayed account refreshes finish before routing stops.
  await page.unrouteAll({ behavior: "wait" });

  const profile = main.getByRole("region", { name: "Profile" });
  await profile.getByRole("textbox", { name: "Name" }).fill("Plan Tester");
  await profile.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByRole("complementary").getByText("Plan Tester", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(profile.getByRole("textbox", { name: "Name" })).toHaveValue(
    "Plan Tester",
  );

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const passkeys = main.getByRole("region", { name: "Passkeys" });
  await expect(passkeys.getByText("No passkeys yet.")).toBeVisible();
  await passkeys.getByRole("button", { name: "Add passkey" }).click();
  await expect(passkeys.getByText(/^Added /)).toHaveCount(1);
  await passkeys.getByRole("button", { name: /^Remove passkey/ }).click();
  await expect(passkeys.getByText("No passkeys yet.")).toBeVisible();

  const keys = main.getByRole("region", { name: "API keys" });
  await expect(keys.getByText("No API keys.")).toBeVisible();
  await keys.getByRole("textbox", { name: "Key name" }).fill("CI");
  await keys.getByText("Read & write", { exact: true }).click();
  await keys.getByRole("button", { name: "Create key" }).click();
  const secret = keys.getByLabel("API key CI");
  await expect(secret).toHaveText(/^cad_/);
  const key = (await secret.textContent())!;
  await expect(keys.getByText(/Read & write · Created/)).toBeVisible();
  // The shown key is a real credential for this account.
  const asKey = { headers: { authorization: `Bearer ${key}` } };
  expect((await page.request.get(`${apiOrigin}/me`, asKey)).status()).toBe(200);
  await keys.getByRole("button", { name: "Dismiss key" }).click();
  await expect(keys.getByLabel("API key CI")).toHaveCount(0);
  // A failed revoke closes the confirmation so its error is not hidden behind it.
  await page.route(`${apiOrigin}/orgs/*/api-keys/*`, (route) =>
    route.fulfill({ status: 500, json: { error: "Internal failure detail" } }),
  );
  await keys.getByRole("button", { name: "Revoke CI" }).click();
  const revoke = page.getByRole("dialog", { name: "Revoke API key" });
  await revoke.getByRole("button", { name: "Revoke key" }).click();
  await expect(revoke).toHaveCount(0);
  await expect(keys.getByRole("alert")).toHaveText(
    "Unable to revoke the API key.",
  );
  await page.unroute(`${apiOrigin}/orgs/*/api-keys/*`);
  await keys.getByRole("button", { name: "Revoke CI" }).click();
  await revoke.getByRole("button", { name: "Revoke key" }).click();
  // A successful retry clears the earlier failure.
  await expect(keys.getByRole("alert")).toHaveCount(0);
  await expect(keys.getByText("No API keys.")).toBeVisible();
  expect((await page.request.get(`${apiOrigin}/me`, asKey)).status()).toBe(401);

  const download = page.waitForEvent("download");
  await main
    .getByRole("region", { name: "Your data" })
    .getByRole("button", { name: "Export all data" })
    .click();
  const archive = await download;
  expect(archive.suggestedFilename()).toBe("cadara-account.zip");
  // A zip archive starts with the local file header signature "PK".
  expect(
    readFileSync((await archive.path())!)
      .subarray(0, 2)
      .toString(),
  ).toBe("PK");
});

test("Deleting the account is blocked by an owned team, then signs out once allowed", async ({
  page,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const { email, apiOrigin } = await signInFresh(page, "delete", baseURL);
  // The API refuses writes without a JSON content type, DELETE included.
  const origin = {
    origin: new URL(baseURL).origin,
    "content-type": "application/json",
  };
  const created = await page.request.post(`${apiOrigin}/orgs`, {
    headers: origin,
    data: { name: "Blocking team", slug: `blocking-${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const team = (await created.json()) as { id: string };

  await page.goto("/dashboard/settings");
  const danger = page.getByRole("main").getByRole("region", {
    name: "Delete account",
  });
  const confirmDeletion = async () => {
    await danger.getByRole("button", { name: "Delete account…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete account" });
    const submit = dialog.getByRole("button", { name: "Delete account" });
    await expect(submit).toBeDisabled();
    await dialog.getByRole("textbox").fill(email);
    await submit.click();
  };
  await confirmDeletion();
  await expect(danger.getByRole("alert")).toHaveText(
    "Transfer or delete these teams first: Blocking team.",
  );
  expect((await page.request.get(`${apiOrigin}/me`)).status()).toBe(200);

  const removed = await page.request.delete(`${apiOrigin}/orgs/${team.id}`, {
    headers: origin,
  });
  expect(removed.ok()).toBe(true);
  await confirmDeletion();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Sign in to CADara")).toBeVisible();
  expect((await page.request.get(`${apiOrigin}/me`)).status()).toBe(401);
});
