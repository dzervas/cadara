// E2E lane: dashboard navigation, real IndexedDB catalog, filter controls,
// account organization selection, offline state and editor handoff.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { makeAccount } from "../test/helpers/account-fixtures";
import {
  createProject,
  documentTabs,
  openWorkbench,
  signIn,
  mailerLog,
  openCadaraMenuItem,
} from "./helpers/project-sync";

test.setTimeout(180_000);

/** Answers the account API as `account`, signed in, with `projectsOf` per organization. */
async function routeSignedInAccount(
  page: Page,
  account: ReturnType<typeof makeAccount>,
  projectsOf: (organizationId: string) => unknown[],
) {
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({
      json: {
        user: {
          ...account.user,
          emailVerified: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        session: {
          id: "session",
          userId: account.user.id,
          token: "test-token",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    }),
  );
  await page.route("**/me", (route) => route.fulfill({ json: account.me }));
  await page.route("**/orgs", (route) =>
    route.fulfill({ json: account.organizations }),
  );
  await page.route("**/orgs/*/projects", (route) =>
    route.fulfill({
      json: projectsOf(new URL(route.request().url()).pathname.split("/")[2]!),
    }),
  );
}

test("guest dashboard stays kernel-free, prompts sign-in, and remembers dashboard", async ({
  page,
  context,
}) => {
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({ json: null }),
  );
  const resources: string[] = [];
  page.on("request", (request) => resources.push(request.url()));
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "On this device" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Switch organization/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Members", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Email", exact: true }),
  ).toBeVisible();
  expect(
    resources.filter((url) =>
      /cadara-occ|\/occ\/|\/viewport\/|\/worker-startup|\/worker\.ts|document-sync\.worker/.test(
        url,
      ),
    ),
  ).toEqual([]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await context.setOffline(true);
  await expect(
    page.getByRole("heading", { name: "You're offline" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open editor", exact: true }),
  ).toHaveAttribute("href", "/app");
});

test("New project hands off to the editor, and tiles open the same IndexedDB local project", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New project", exact: true });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  expect(new URL(page.url()).searchParams.has("newProject")).toBe(false);
  await dialog
    .getByRole("textbox", { name: "Project name" })
    .fill("Dashboard bracket");
  await dialog.getByRole("radio", { name: /^Local/ }).check();
  await dialog
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue("Dashboard bracket", { timeout: 60_000 });
  await expect(documentTabs(page)).toHaveCount(1);
  const part = await documentTabs(page)
    .first()
    .getAttribute("data-document-id");
  await createProject(page, "Other project");
  await page.goto("/dashboard");
  await expect(
    page.getByRole("link", { name: "Open Dashboard bracket", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search projects" })
    .fill("Dashboard bracket");
  await expect(
    page.getByRole("link", { name: "Open Other project", exact: true }),
  ).toHaveCount(0);
  const tile = page.getByRole("link", {
    name: "Open Dashboard bracket",
    exact: true,
  });
  await expect(tile).toHaveAttribute("href", /\/app\/local\//);
  const bracketAddress = await tile.getAttribute("href");
  await tile.press("Enter");
  const projectPicker = page.getByRole("combobox", {
    name: "Project",
    exact: true,
  });
  await expect(projectPicker).toHaveValue("Dashboard bracket", {
    timeout: 60_000,
  });
  // The last-open project ("Other project") must not lend its part to this one.
  await expect(documentTabs(page)).toHaveCount(1);
  await expect(
    page.locator('[data-document-tab-slot][data-active="true"]'),
  ).toContainText("Workspace");
  await expect(documentTabs(page).first()).toHaveAttribute(
    "data-document-id",
    part!,
  );
  await page.goto("/dashboard");
  await expect(
    page
      .getByRole("region", { name: "On this device" })
      .locator("article")
      .filter({ hasText: "Dashboard bracket" })
      .getByText("1 document", { exact: true }),
  ).toBeVisible();
  await page.goto(bracketAddress!);
  await expect(projectPicker).toHaveValue("Dashboard bracket", {
    timeout: 60_000,
  });
  // Switching projects in the editor moves the address along, so a reload
  // and "/" reopen the project now open.
  await projectPicker.click();
  await page
    .getByRole("option", { name: "Other project", exact: true })
    .click();
  await expect(projectPicker).toHaveValue("Other project", { timeout: 60_000 });
  const bracketPath = new URL(bracketAddress!, page.url()).pathname;
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toMatch(/^\/app\/local\/[^/]+$/);
  await expect.poll(() => new URL(page.url()).pathname).not.toBe(bracketPath);
  await page.reload();
  await expect(projectPicker).toHaveValue("Other project", { timeout: 60_000 });
  await expect(documentTabs(page)).toHaveCount(1);
  const otherAddress = new URL(page.url()).pathname;
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`${otherAddress}$`));
  await expect(projectPicker).toHaveValue("Other project", { timeout: 60_000 });
});

test("dashboard account-project tile opens through its remote URL", async ({
  page,
}, testInfo) => {
  test.skip(!mailerLog, "Set CADARA_AUTH_MAILER_LOG to local wrangler stdout.");
  await openWorkbench(
    page,
    new URL("/app?cadTestMode=1", testInfo.project.use.baseURL!).href,
  );
  await signIn(page, `dashboard-${Date.now()}@example.test`);
  await openCadaraMenuItem(page, "Upload to CADara…");
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Dashboard cloud project");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.locator("[data-project-presence-row]")).toHaveAttribute(
    "data-project-sync-state",
    "synced",
    { timeout: 60_000 },
  );
  const remotePart = await documentTabs(page)
    .first()
    .getAttribute("data-document-id");
  await createProject(page, "Unrelated local project");
  await page.goto("/dashboard");
  const tile = page.getByRole("link", {
    name: "Open Dashboard cloud project",
    exact: true,
  });
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute("href", /\/app\/p\//);
  await tile.click();
  // cadara-e6o8 tracks the baseline reload sync issue; this row proves navigation and identity.
  await expect(page).toHaveURL(/\/app\/p\/[^/]+$/);

  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue("My project", { timeout: 60_000 });
  await expect(documentTabs(page).first()).toHaveAttribute(
    "data-document-id",
    remotePart!,
  );
});

test("team selection changes usage and owner tiles while shared projects stay grouped separately", async ({
  page,
}) => {
  const account = makeAccount();
  account.me.organizations[0].usage = {
    storage_bytes: 100,
    private_projects: 1,
  };
  account.me.organizations.push({
    organizationId: "team",
    entitlements: {
      tier: "team",
      storage_limit_bytes: 10000,
      private_project_limit: 20,
      project_editor_limit: 5,
      seat_count: 2,
    },
    usage: { storage_bytes: 5000, private_projects: 7 },
  });
  account.organizations.push(
    { id: "team", name: "Workshop team", personal: false },
    { id: "shared-org", name: "Alex's workshop", personal: true },
  );
  account.me.actor.memberships.push(
    {
      id: "team-membership",
      userId: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      organizationId: "team",
      role: "member",
      defaultProjectRole: "editor",
    },
    {
      id: "collaborator",
      userId: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      organizationId: "shared-org",
      role: "collaborator",
      defaultProjectRole: null,
    },
  );
  await routeSignedInAccount(page, account, (org) => [
    {
      id: `${org}-project`,
      organization_id: org,
      slug: "fixture",
      name: org === "shared-org" ? "Shared bracket" : `${org} bracket`,
      visibility: "private",
      manifest_doc_id: null,
    },
  ]);
  await page.goto("/dashboard");
  await expect(page.getByText("100 B of 1 KB", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Shared with me" }),
  ).toContainText("Alex's workshop");
  await page.getByRole("button", { name: /^Switch organization/ }).click();
  await page
    .getByRole("menuitem", { name: "Workshop team", exact: true })
    .click();
  await expect(page.getByText("5 KB of 10 KB", { exact: true })).toBeVisible();
  await expect(
    page.getByText("7 of 20 private projects", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Workshop team" }),
  ).toContainText("team bracket");
  await expect(
    page.getByRole("link", { name: "Members", exact: true }),
  ).toBeVisible();
  await page
    .locator("label")
    .filter({ hasText: /^Shared with me$/ })
    .click();
  await expect(page.getByRole("region", { name: "Workshop team" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: "Open Shared bracket", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Actions for Shared bracket" })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Open", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Project page", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Share…", exact: true }),
  ).toBeEnabled();
});

test("an unknown local project uses the visible project-open failure path", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto("/app/local/missing-project?cadTestMode=1");
  await expect(
    page
      .getByText("The project could not be opened on this device.", {
        exact: true,
      })
      .first(),
  ).toBeVisible({ timeout: 60_000 });
});

test("an account-project address offers sign-in when signed out and reports an unknown project", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto("/app/p/unknown-project?cadTestMode=1");
  const notice = page.getByText("Project could not be opened", { exact: true });
  await expect(notice.first()).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText("Sign in to open this project, then reload the page.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Email", exact: true }),
  ).toBeVisible();
  // The startup project stands in; the address keeps naming the asked-for project.
  expect(new URL(page.url()).pathname).toBe("/app/p/unknown-project");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const account = makeAccount();
  await routeSignedInAccount(page, account, () => []);
  await page.reload();
  await expect(
    page.getByText(
      "This project does not exist or your account cannot open it.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 60_000 });
  await expect(notice.first()).toBeVisible();
});
