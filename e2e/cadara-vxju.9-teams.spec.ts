// E2E lane, live account API: the team surfaces need a real session, real
// organizations and the dashboard's navigation, which only the browser has.
// Proves the no-team invariant (no "team"/"organization" anywhere but the
// "Create team" offer), that creating a team brings the switcher and the
// Members page, Members management against the service, and both outcomes of
// the Create team checkout (followed, or failed with the team kept).
import { expect, test, type Page } from "@playwright/test";
import { mailerLog, openWorkbench, signIn } from "./helpers/project-sync";

test.setTimeout(240_000);

/** Every word the page shows or announces, minus the one allowed offer. */
async function teamWordsOnPage(page: Page) {
  const words = await page.evaluate(() =>
    [
      document.body.innerText,
      ...[...document.querySelectorAll("[aria-label],[title],[placeholder]")]
        .flatMap((element) => [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("placeholder"),
        ])
        .filter(Boolean),
    ].join("\n"),
  );
  // Each finding keeps its surroundings, so a failure names the offending text.
  const found = [
    ...words
      .replaceAll("Create team", "")
      .matchAll(/.{0,40}\b(?:organi[sz]ations?|teams?)\b.{0,40}/gi),
  ].map((match) => match[0]);
  return found.length ? found : null;
}

function api(page: Page, apiOrigin: string) {
  const appOrigin = new URL(page.url()).origin;
  return async <T>(method: "GET" | "POST", path: string): Promise<T> => {
    const response = await page.request.fetch(`${apiOrigin}${path}`, {
      method,
      headers: { Origin: appOrigin },
      ...(method === "POST" ? { data: {} } : {}),
    });
    expect(
      response.ok(),
      `${method} ${path}: ${response.status()} ${await response.text()}`,
    ).toBe(true);
    return (await response.json()) as T;
  };
}

test("an account without a team never sees teams; creating one brings the switcher and a working Members page", async ({
  browser,
}, testInfo) => {
  test.skip(!mailerLog, "Set CADARA_AUTH_MAILER_LOG to local wrangler stdout.");
  const baseURL = testInfo.project.use.baseURL!;
  const appUrl = new URL("/app?cadTestMode=1", baseURL).href;
  const stamp = Date.now();
  const ownerEmail = `crew-owner-${stamp}@example.test`;
  const memberEmail = `crew-member-${stamp}@example.test`;
  const teamName = `Workshop crew ${stamp}`;
  const ownerContext = await browser.newContext({ baseURL });
  const memberContext = await browser.newContext({ baseURL });
  const owner = await ownerContext.newPage();
  const member = await memberContext.newPage();
  try {
    await openWorkbench(owner, appUrl);
    const apiOrigin = await signIn(owner, ownerEmail);
    await openWorkbench(member, appUrl);
    await signIn(member, memberEmail);

    // Editor: the account menu offers a team and names none.
    await owner.getByRole("button", { name: "Account", exact: true }).click();
    await expect(
      owner.getByRole("button", { name: "Create team", exact: true }),
    ).toBeVisible();
    await expect(owner.getByText(ownerEmail, { exact: true })).toBeVisible();
    expect(await teamWordsOnPage(owner)).toBeNull();

    // Dashboard: no switcher, no Members, no words, and no Members page.
    await owner.goto("/dashboard");
    await expect(
      owner.getByRole("heading", { name: "Projects", exact: true }),
    ).toBeVisible();
    await expect(owner.getByText(ownerEmail, { exact: true })).toBeVisible();
    await expect(
      owner.getByRole("button", { name: /^Switch organization/ }),
    ).toHaveCount(0);
    await expect(
      owner.getByRole("link", { name: "Members", exact: true }),
    ).toHaveCount(0);
    expect(await teamWordsOnPage(owner)).toBeNull();
    await owner.goto("/dashboard/members");
    await expect(
      owner.getByRole("heading", { name: "Page not found", exact: true }),
    ).toBeVisible();
    expect(await teamWordsOnPage(owner)).toBeNull();

    // Create a team from the dashboard's account menu. The hosted checkout
    // is a stand-in that returns straight to the dashboard, as after paying.
    let checkoutBody: unknown = null;
    await owner.route("**/orgs/*/billing/checkout", (route) => {
      checkoutBody = route.request().postDataJSON();
      return route.fulfill({
        json: {
          id: "checkout",
          url: new URL("/dashboard/members", baseURL).href,
        },
      });
    });
    await owner.goto("/dashboard");
    await owner.getByRole("button", { name: "Account", exact: true }).click();
    await owner
      .getByRole("button", { name: "Create team", exact: true })
      .click();
    const dialog = owner.getByRole("dialog", { name: "Create team" });
    await dialog.getByRole("textbox", { name: "Team name" }).fill(teamName);
    await expect(dialog.getByRole("textbox", { name: "URL name" })).toHaveValue(
      `workshop-crew-${stamp}`,
    );
    await expect(dialog).toContainText("billed per editor seat");
    await dialog
      .getByRole("button", { name: "Continue to checkout", exact: true })
      .click();
    await expect(owner).toHaveURL(/\/dashboard\/members$/);
    expect(checkoutBody).toEqual({ tier: "team" });
    // Back from checkout, the dashboard opens on the new team.
    await expect(
      owner.getByRole("heading", { level: 1, name: "Members", exact: true }),
    ).toBeVisible();
    const members = owner.getByRole("table", { name: "Members" });
    await expect(
      members.getByRole("row").filter({ hasText: ownerEmail }),
    ).toContainText("Owner");

    // The switcher and the Members link now exist, for this team.
    await expect(
      owner.getByRole("link", { name: "Members", exact: true }),
    ).toBeVisible();
    const switcher = owner.getByRole("button", {
      name: `Switch organization (${teamName})`,
    });
    await expect(switcher).toBeVisible();
    await switcher.click();
    await expect(
      owner.getByRole("menuitem", { name: "Personal", exact: true }),
    ).toBeVisible();
    await expect(
      owner.getByRole("menuitem", { name: "Create team", exact: true }),
    ).toBeVisible();
    await owner
      .getByRole("menuitem", { name: "Personal", exact: true })
      .click();
    // Personal is no team: its Members entry goes away.
    await expect(
      owner.getByRole("link", { name: "Members", exact: true }),
    ).toHaveCount(0);
    await owner.getByRole("button", { name: /^Switch organization/ }).click();
    await owner.getByRole("menuitem", { name: teamName, exact: true }).click();
    await owner.getByRole("link", { name: "Members", exact: true }).click();

    // Invite, then revoke, an admin.
    const invite = owner.getByRole("form", { name: "Invite member" });
    await invite
      .getByRole("textbox", { name: "Invite by email" })
      .fill(`revoked-${stamp}@example.test`);
    await invite.getByRole("combobox", { name: "Role" }).click();
    await owner.getByRole("option", { name: "Admin", exact: true }).click();
    await invite.getByRole("button", { name: "Invite", exact: true }).click();
    const pending = owner.getByRole("table", { name: "Pending invitations" });
    await expect(pending).toContainText(`revoked-${stamp}@example.test`);
    await expect(pending).toContainText("Invited as Admin");
    await owner
      .getByRole("button", {
        name: `Revoke the invitation for revoked-${stamp}@example.test`,
      })
      .click();
    await expect(pending).toHaveCount(0);

    // Invite the second account as a member; it accepts.
    await invite
      .getByRole("textbox", { name: "Invite by email" })
      .fill(memberEmail);
    await invite.getByRole("combobox", { name: "Role" }).click();
    await owner.getByRole("option", { name: "Member", exact: true }).click();
    await invite.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(pending).toContainText(memberEmail);
    const teamId = (
      await api(owner, apiOrigin)<{ id: string; name: string }[]>(
        "GET",
        "/orgs",
      )
    ).find((org) => org.name === teamName)!.id;
    const invitation = (
      await api(owner, apiOrigin)<{ id: string; email: string }[]>(
        "GET",
        `/orgs/${teamId}/invitations`,
      )
    ).find((entry) => entry.email === memberEmail)!;
    await api(member, apiOrigin)(
      "POST",
      `/invitations/${invitation.id}/accept`,
    );
    await owner.reload();
    const memberRow = members.getByRole("row").filter({ hasText: memberEmail });
    await expect(memberRow).toBeVisible();

    // Default project role and team role changes are kept by the service.
    await memberRow
      .getByRole("combobox", { name: /^Default project role of/ })
      .click();
    await owner.getByRole("option", { name: "Viewer", exact: true }).click();
    await owner.reload();
    await expect(
      memberRow.getByRole("combobox", { name: /^Default project role of/ }),
    ).toHaveValue("Viewer");
    await memberRow.getByRole("combobox", { name: /^Role of/ }).click();
    await owner.getByRole("option", { name: "Admin", exact: true }).click();
    await expect(memberRow).toContainText("Admin on every project");
    await owner.reload();
    await expect(
      memberRow.getByRole("combobox", { name: /^Role of/ }),
    ).toHaveValue("Admin");

    // The external sharing policy is the team's and survives a reload.
    const sharing = owner.getByRole("switch", {
      name: "Allow sharing outside the team",
    });
    await expect(sharing).toBeChecked();
    // A real, actionability-checked click: Mantine's switch input spans the control.
    await sharing.click();
    await expect(sharing).not.toBeChecked();
    await owner.reload();
    await expect(sharing).not.toBeChecked();

    // Removal asks once more, then takes the member off the team.
    await memberRow.getByRole("button", { name: /^Remove / }).click();
    await memberRow.getByRole("button", { name: /^Confirm removing / }).click();
    await expect(memberRow).toHaveCount(0);
    await owner.reload();
    await expect(
      members.getByRole("row").filter({ hasText: ownerEmail }),
    ).toBeVisible();
    await expect(memberRow).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
});

test("a team whose checkout fails still exists: its Members page says so and offers checkout again, from the editor and the dashboard", async ({
  page,
}, testInfo) => {
  test.skip(!mailerLog, "Set CADARA_AUTH_MAILER_LOG to local wrangler stdout.");
  const baseURL = testInfo.project.use.baseURL!;
  const stamp = Date.now();
  const payerEmail = `crew-payer-${stamp}@example.test`;
  // The checkout cannot start, whatever billing the local service has.
  await page.route("**/orgs/*/billing/checkout", (route) =>
    route.fulfill({ status: 503, json: { error: "Billing not configured" } }),
  );
  await openWorkbench(page, new URL("/app?cadTestMode=1", baseURL).href);
  await signIn(page, payerEmail);

  const createTeam = async (name: string) => {
    const dialog = page.getByRole("dialog", { name: "Create team" });
    await dialog.getByRole("textbox", { name: "Team name" }).fill(name);
    await dialog
      .getByRole("button", { name: "Continue to checkout", exact: true })
      .click();
    await expect(page).toHaveURL(/\/dashboard\/members\?checkout=failed$/, {
      timeout: 60_000,
    });
    await expect(page.getByRole("alert")).toContainText(
      "Your team was created, but checkout could not start.",
    );
    await expect(
      page.getByRole("link", { name: "Try checkout again", exact: true }),
    ).toHaveAttribute("href", "/dashboard/plan");
    await expect(
      page.getByRole("button", { name: `Switch organization (${name})` }),
    ).toBeVisible();
    await expect(page.getByRole("table", { name: "Members" })).toContainText(
      payerEmail,
    );
  };

  // From the editor: the page leaves for the dashboard on the new team.
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await createTeam(`Unpaid crew ${stamp}`);

  // From the dashboard's switcher: the dashboard moves to the second team.
  await page.getByRole("button", { name: /^Switch organization/ }).click();
  await page
    .getByRole("menuitem", { name: "Create team", exact: true })
    .click();
  await createTeam(`Second crew ${stamp}`);

  // The account menu's team links stay in the dashboard and switch team.
  await page.getByRole("button", { name: "Account", exact: true }).click();
  const firstTeam = page.getByRole("link", {
    name: `Unpaid crew ${stamp} · owner`,
  });
  await expect(firstTeam).not.toHaveAttribute("target", "_blank");
  await firstTeam.click();
  await expect(page).toHaveURL(/\/dashboard\/members$/);
  await expect(
    page.getByRole("button", {
      name: `Switch organization (Unpaid crew ${stamp})`,
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
