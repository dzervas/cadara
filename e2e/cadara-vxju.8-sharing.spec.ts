// E2E lane, live API: the project page and Share dialog against a local
// service. Proves what only the browser and the real service show together:
// invites (existing account granted at once, unknown email pending until it
// signs in), role changes, removal, read-only lists, leaving, links on/off,
// Shared with me with the owner's name, and the team external-sharing refusal.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { mailerLog, openWorkbench, signIn } from "./helpers/project-sync";

test.setTimeout(300_000);

async function signedInPage(browser: Browser, baseURL: string, email: string) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  await openWorkbench(page, new URL("/app?cadTestMode=1", baseURL).href);
  const apiOrigin = await signIn(page, email);
  return { page, apiOrigin };
}

/** Calls the service with the page's session, as the app would. */
async function api<T>(
  page: Page,
  apiOrigin: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await page.request.fetch(`${apiOrigin}${path}`, {
    method,
    headers: { Origin: new URL(page.url()).origin },
    ...(data === undefined ? {} : { data }),
  });
  expect(
    response.ok(),
    `${method} ${path}: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as T;
}

async function createAccountProject(
  page: Page,
  apiOrigin: string,
  orgId: string,
  name: string,
) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return api<{ id: string }>(
    page,
    apiOrigin,
    "POST",
    `/orgs/${orgId}/projects`,
    {
      name,
      slug,
    },
  );
}

/** Publishes a minimal version: no part documents, one viewable model. */
async function publishVersion(
  page: Page,
  apiOrigin: string,
  projectPath: string,
) {
  const origin = new URL(page.url()).origin;
  const version = await api<{ id: string }>(
    page,
    apiOrigin,
    "POST",
    `${projectPath}/versions`,
    { label: "v1", documents: [], manifestHeads: ["b".repeat(64)] },
  );
  const upload = await page.request.fetch(
    `${apiOrigin}${projectPath}/versions/${version.id}/bundle/mesh.glb`,
    {
      method: "PUT",
      headers: { Origin: origin, "Content-Type": "model/gltf-binary" },
      data: Buffer.from("glTF"),
    },
  );
  expect(upload.status(), await upload.text()).toBe(201);
  await api(
    page,
    apiOrigin,
    "POST",
    `${projectPath}/versions/${version.id}/complete`,
    {},
  );
}

function peopleBox(page: Page, name: "People" | "Pending invites") {
  return page
    .getByRole("region", { name: "People" })
    .getByRole("group", { name, exact: true });
}

async function invite(page: Page, email: string, role: string) {
  const people = page.getByRole("region", { name: "People" });
  await people.getByRole("textbox", { name: "Invite by email" }).fill(email);
  await people
    .getByRole("combobox", { name: "Role for the invite" })
    .selectOption({ label: role });
  await people.getByRole("button", { name: "Invite", exact: true }).click();
}

test("an admin invites, changes roles and removes people; invitees see the list read-only and pending invites activate on sign-in", async ({
  browser,
  playwright,
}, testInfo) => {
  test.skip(!mailerLog, "Set CADARA_AUTH_MAILER_LOG to local wrangler stdout.");
  const baseURL = testInfo.project.use.baseURL!;
  const stamp = Date.now();
  const ownerEmail = `share-owner-${stamp}@example.test`;
  const viewerEmail = `share-viewer-${stamp}@example.test`;
  const pendingEmail = `share-pending-${stamp}@example.test`;
  const revokedEmail = `share-revoked-${stamp}@example.test`;
  const projectName = `Shared bracket ${stamp}`;

  const { page: owner, apiOrigin } = await signedInPage(
    browser,
    baseURL,
    ownerEmail,
  );
  const { page: viewer } = await signedInPage(browser, baseURL, viewerEmail);
  const [personal] = await api<{ id: string }[]>(
    owner,
    apiOrigin,
    "GET",
    "/orgs",
  );
  const project = await createAccountProject(
    owner,
    apiOrigin,
    personal!.id,
    projectName,
  );
  const projectPath = `/orgs/${personal!.id}/projects/${project.id}`;

  // The owner reaches the project page from the tile's ⋯ menu.
  await owner.goto("/dashboard");
  await owner
    .getByRole("button", { name: `Actions for ${projectName}` })
    .click();
  await owner.getByRole("menuitem", { name: "Project page" }).click();
  await expect(owner).toHaveURL(new RegExp(`/dashboard/p/${project.id}$`));
  await expect(
    owner.getByRole("heading", { name: projectName, exact: true }),
  ).toBeVisible();
  await expect(peopleBox(owner, "People")).toContainText("Owner · Admin");

  // An existing account gets access at once.
  await invite(owner, viewerEmail, "Viewer");
  const viewerRole = peopleBox(owner, "People").getByRole("button", {
    name: `Role of ${viewerEmail}: Viewer`,
  });
  await expect(viewerRole).toBeVisible();

  // An unknown email waits as a pending invite, taking the free plan's one editor slot.
  await invite(owner, pendingEmail, "Editor");
  await expect(peopleBox(owner, "Pending invites")).toContainText(
    "Invited as Editor · expires in 14 days",
  );
  await expect(
    owner.getByRole("progressbar", { name: "Editors on this project" }),
  ).toHaveAttribute("aria-valuenow", "100");
  const people = owner.getByRole("region", { name: "People" });
  await people
    .getByRole("combobox", { name: "Role for the invite" })
    .selectOption({ label: "Editor" });
  await expect(people.getByRole("alert")).toContainText(
    "This project has 1 of 1 editors its plan allows.",
  );
  await expect(
    people.getByRole("link", { name: "Change plan" }),
  ).toHaveAttribute("href", "/dashboard/plan");
  await expect(
    people.getByRole("button", { name: "Invite", exact: true }),
  ).toBeDisabled();

  // Resending within minutes is refused inline; revoking drops the invite.
  await invite(owner, revokedEmail, "Viewer");
  const revokedRow = peopleBox(owner, "Pending invites").getByRole("listitem", {
    name: revokedEmail,
  });
  await revokedRow
    .getByRole("button", { name: `Resend invite to ${revokedEmail}` })
    .click();
  await expect(people.getByRole("alert")).toContainText(
    "An invite was sent recently.",
  );
  await revokedRow
    .getByRole("button", { name: `Revoke invite to ${revokedEmail}` })
    .click();
  await expect(revokedRow).toHaveCount(0);

  // Role change through the person's menu.
  await viewerRole.click();
  await owner.getByRole("menuitem", { name: "Commenter" }).click();
  await expect(
    peopleBox(owner, "People").getByRole("button", {
      name: `Role of ${viewerEmail}: Commenter`,
    }),
  ).toBeVisible();

  // The invitee finds the project under Shared with me with the owner's name,
  // and sees who has access without any way to change it.
  await viewer.goto("/dashboard");
  const shared = viewer.getByRole("region", { name: "Shared with me" });
  await expect(shared).toContainText(projectName);
  await expect(shared).toContainText(ownerEmail);
  await viewer.goto(`/dashboard/p/${project.id}`);
  await expect(peopleBox(viewer, "People")).toContainText(
    `${viewerEmail} (you)`,
  );
  await expect(peopleBox(viewer, "People")).toContainText("Owner · Admin");
  await expect(
    viewer.getByRole("textbox", { name: "Invite by email" }),
  ).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: /^Role of / })).toHaveCount(
    0,
  );
  await expect(peopleBox(viewer, "Pending invites")).toHaveCount(0);
  await expect(viewer.getByRole("switch")).toBeDisabled();

  // The pending invite becomes access when that email signs in.
  const { page: pending } = await signedInPage(browser, baseURL, pendingEmail);
  await pending.goto("/dashboard");
  await expect(
    pending.getByRole("region", { name: "Shared with me" }),
  ).toContainText(projectName);
  await owner.reload();
  const pendingRole = peopleBox(owner, "People").getByRole("button", {
    name: `Role of ${pendingEmail}: Editor`,
  });
  await expect(pendingRole).toBeVisible();
  await expect(peopleBox(owner, "Pending invites")).toHaveCount(0);

  // Remove takes the access away.
  await pendingRole.click();
  await owner.getByRole("menuitem", { name: "Remove" }).click();
  await expect(pendingRole).toHaveCount(0);
  expect(
    (
      await pending.request.fetch(`${apiOrigin}${projectPath}`, {
        headers: { Origin: new URL(pending.url()).origin },
      })
    ).status(),
  ).toBe(403);

  // Links: Off by default. On, with nothing published, there is no link yet.
  const links = owner.getByRole("region", { name: "Links" });
  const linkSwitch = links.getByRole("switch", {
    name: "Anyone with the link can view",
  });
  const linksEnabled = async () =>
    (
      await api<{ share_links_enabled: boolean }>(
        owner,
        apiOrigin,
        "GET",
        projectPath,
      )
    ).share_links_enabled;
  await expect(linkSwitch).not.toBeChecked();
  await linkSwitch.click();
  await expect(linkSwitch).toBeChecked();
  expect(await linksEnabled()).toBe(true);
  await expect(links).toContainText("Publish a version to get a link.");
  await expect(links.getByRole("button", { name: "Copy link" })).toHaveCount(0);

  // Once a version is published, Copy link makes a link that opens it.
  await publishVersion(owner, apiOrigin, projectPath);
  await owner.reload();
  await links.getByRole("button", { name: "Copy link" }).click();
  const shareLink = links.getByRole("textbox", { name: "Share link" });
  await expect(shareLink).toHaveValue(/\/share\//);
  const firstLink = await shareLink.inputValue();
  // Anyone: the link is opened without any session.
  const anonymous = await playwright.request.newContext();
  const opens = async (url: string) =>
    (await anonymous.get(url, { maxRedirects: 0 })).status();
  expect(await opens(firstLink)).toBe(200);

  // Rotate replaces the link: the old one stops working, a new one works.
  await links.getByRole("button", { name: "Rotate" }).click();
  await expect(shareLink).toHaveCount(0);
  expect(await opens(firstLink)).toBe(403);
  await links.getByRole("button", { name: "Copy link" }).click();
  await expect(shareLink).not.toHaveValue(firstLink);
  const secondLink = await shareLink.inputValue();
  expect(await opens(secondLink)).toBe(200);

  // Off invalidates every link handed out.
  await linkSwitch.click();
  await expect(linkSwitch).not.toBeChecked();
  await expect(links.getByRole("button", { name: "Rotate" })).toHaveCount(0);
  expect(await linksEnabled()).toBe(false);
  expect(await opens(secondLink)).toBe(403);
  await anonymous.dispose();

  // The Share dialog carries the same People list, opened from the tile.
  await owner.goto("/dashboard");
  await owner
    .getByRole("button", { name: `Actions for ${projectName}` })
    .click();
  await owner.getByRole("menuitem", { name: "Share…" }).click();
  const dialog = owner.getByRole("dialog", { name: `Share ${projectName}` });
  await expect(
    dialog.getByRole("button", { name: `Role of ${viewerEmail}: Commenter` }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Invite by email" }),
  ).toBeVisible();
  await owner.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // The collaborator leaves; the project is gone from their list.
  await viewer.getByRole("button", { name: "Leave project" }).click();
  await expect(viewer).toHaveURL(/\/dashboard$/);
  await expect(
    viewer.getByRole("region", { name: "Shared with me" }),
  ).not.toContainText(projectName);

  // The owner deletes the project from the Danger zone.
  await owner.goto(`/dashboard/p/${project.id}`);
  await owner
    .getByRole("region", { name: "Danger zone" })
    .getByRole("button", { name: "Delete project" })
    .click();
  await owner
    .getByRole("dialog", { name: `Delete ${projectName}?` })
    .getByRole("button", { name: "Delete project" })
    .click();
  await expect(owner).toHaveURL(/\/dashboard$/);
  await expect(
    owner.getByRole("link", { name: `Open ${projectName}`, exact: true }),
  ).toHaveCount(0);
});

test("a team that keeps sharing inside refuses an outside invite inline", async ({
  browser,
}, testInfo) => {
  test.skip(!mailerLog, "Set CADARA_AUTH_MAILER_LOG to local wrangler stdout.");
  const baseURL = testInfo.project.use.baseURL!;
  const stamp = Date.now();
  const { page: owner, apiOrigin } = await signedInPage(
    browser,
    baseURL,
    `team-owner-${stamp}@example.test`,
  );
  const team = await api<{ id: string }>(owner, apiOrigin, "POST", "/orgs", {
    name: `Closed team ${stamp}`,
    slug: `closed-team-${stamp}`,
  });
  await api(owner, apiOrigin, "PATCH", `/orgs/${team.id}`, {
    allowExternalSharing: false,
  });
  const project = await createAccountProject(
    owner,
    apiOrigin,
    team.id,
    `Team bracket ${stamp}`,
  );
  await owner.goto(`/dashboard/p/${project.id}`);
  await expect(
    owner
      .getByRole("region", { name: "People" })
      .getByRole("group", { name: "Team access" }),
  ).toContainText(`Everyone in Closed team ${stamp}`);
  await invite(owner, `outsider-${stamp}@example.test`, "Viewer");
  await expect(
    owner.getByRole("region", { name: "People" }).getByRole("alert"),
  ).toHaveText("This team doesn't allow sharing with people outside it.");
});
