import { expect, test } from "@playwright/test";
import { makeAccount } from "../test/helpers/account-fixtures";

for (const [state, storage] of [
  ["normal", 412_000_000],
  ["warning", 810_000_000],
  ["over", 1_100_000_000],
] as const) {
  test(`account popover explains ${state} quota and links to plan in another tab`, async ({
    page,
  }) => {
    const account = makeAccount();
    account.me.organizations[0]!.entitlements.storage_limit_bytes = 1_000_000_000;
    account.me.organizations[0]!.usage.storage_bytes = storage;
    await page.route("**/api/auth/get-session*", (route) =>
      route.fulfill({
        json: {
          user: account.user,
          session: {
            id: "session",
            userId: account.user.id,
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        },
      }),
    );
    await page.route("**/me", (route) => route.fulfill({ json: account.me }));
    await page.route("**/orgs", (route) =>
      route.fulfill({ json: account.organizations }),
    );
    await page.goto("/app?cadTestMode=1");
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await expect(
      page.getByText(account.user.email, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("0 of 3 private projects", { exact: true }),
    ).toBeVisible();
    const dot = page.getByLabel(
      state === "over" ? "Account over quota" : "Account quota above 80%",
      { exact: true },
    );
    if (state === "normal") {
      await expect(
        page.getByLabel("Account quota above 80%", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByLabel("Account over quota", { exact: true }),
      ).toHaveCount(0);
    } else {
      await expect(dot).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Account", exact: true }),
      ).toHaveAccessibleDescription(
        state === "over" ? "Account over quota" : "Account quota above 80%",
      );
    }
    const blocked = page.getByText(
      "Over quota. New projects, uploads and publishing are blocked. Sync keeps working.",
      { exact: true },
    );
    if (state === "over") await expect(blocked).toBeVisible();
    else await expect(blocked).toHaveCount(0);
    const plan = page.getByRole("link", { name: "Change plan", exact: true });
    await expect(plan).toHaveAttribute("href", "/dashboard/plan");
    await expect(plan).toHaveAttribute("target", "_blank");
    const popupPromise = page.waitForEvent("popup");
    await plan.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/dashboard\/plan$/);
    await popup.close();
  });
}
