// Lane: e2e. Seams: the logo (File) menu's project entries wired through the
// workbench shell: the recent-projects submenu switching projects in place,
// All projects… and New project…, and Share… (sign-in, New project with Local
// disabled, the part's move through the document sync worker, the Share
// dialog against the live service). Only the browser has the menu, the page
// lifetime a switch must keep, the sign-in tab and the worker.
import { expect, test, type Page } from "@playwright/test";
import {
  createProject,
  documentTabs,
  mailerLog,
  openWorkbench,
  signIn,
} from "./helpers/project-sync";

test.setTimeout(240_000);
test.use({ viewport: { width: 1440, height: 960 } });

function projectSelect(page: Page) {
  return page.getByRole("combobox", { name: "Project", exact: true });
}

async function openLogoMenu(page: Page) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  const menu = page.getByRole("menu", { name: "File", exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens the logo menu's project submenu from the current project's item. */
async function openProjectsSubmenu(page: Page, currentProject: string) {
  const menu = await openLogoMenu(page);
  await menu
    .getByRole("menuitem", { name: currentProject, exact: true })
    .hover();
  // The submenu is labelled by the item that opens it.
  const projects = menu.getByRole("menu", {
    name: currentProject,
    exact: true,
  });
  await expect(projects).toBeVisible();
  return projects;
}

test("the logo menu switches between recent projects without reloading the page, and keeps New, Open and Save As", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({ json: null }),
  );
  await openWorkbench(page, "/app?cadTestMode=1");
  await expect(
    page.getByRole("button", { name: "New project", exact: true }),
  ).toBeEnabled({ timeout: 30_000 });
  await createProject(page, "Alpha bracket");
  await createProject(page, "Beta hinge");

  let loads = 0;
  page.on("load", () => (loads += 1));
  await page.evaluate(() => {
    (window as unknown as { __pageLifetime: string }).__pageLifetime = "kept";
  });

  const menu = await openLogoMenu(page);
  for (const item of ["New", "Open...", "Save As", "Share…"])
    await expect(
      menu.getByRole("menuitem", { name: item, exact: true }),
    ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  let projects = await openProjectsSubmenu(page, "Beta hinge");
  await expect(
    projects.getByRole("menuitem").first(),
    "the project opened last leads the recents",
  ).toHaveText("Alpha bracket");
  await expect(
    projects.getByRole("menuitem", { name: "Beta hinge", exact: true }),
    "the open project is the menu's own item, not a recent",
  ).toHaveCount(0);
  await expect(
    projects.getByRole("menuitem", { name: "All projects…" }),
  ).toHaveAttribute("href", "/dashboard?cadTestMode=1");
  await projects
    .getByRole("menuitem", { name: "Alpha bracket", exact: true })
    .click();
  await expect(projectSelect(page)).toHaveValue("Alpha bracket", {
    timeout: 30_000,
  });

  projects = await openProjectsSubmenu(page, "Alpha bracket");
  await expect(projects.getByRole("menuitem").first()).toHaveText("Beta hinge");
  await projects
    .getByRole("menuitem", { name: "Beta hinge", exact: true })
    .click();
  await expect(projectSelect(page)).toHaveValue("Beta hinge", {
    timeout: 30_000,
  });

  expect(loads, "switching projects never loads the page again").toBe(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __pageLifetime?: string }).__pageLifetime,
    ),
    "the page that switched is the page that was loaded",
  ).toBe("kept");

  projects = await openProjectsSubmenu(page, "Beta hinge");
  await projects.getByRole("menuitem", { name: "New project…" }).click();
  await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
});

test("Share on a local part signs in, creates an account project named after the part, moves the part and opens its Share dialog; a collaborator leaving from it lands on a local project", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(!mailerLog, "Set CADARA_AUTH_MAILER_LOG to local wrangler stdout.");
  const stamp = Date.now();
  const email = `logo-share-${stamp}@example.test`;
  const viewerEmail = `logo-share-viewer-${stamp}@example.test`;
  const partName = `Share bracket ${stamp}`;
  await openWorkbench(page, "/app?cadTestMode=1");
  await expect(
    page.getByRole("button", { name: "New project", exact: true }),
  ).toBeEnabled({ timeout: 30_000 });
  await createProject(page, `Local shelf ${stamp}`);
  // Name the part so the prefill comes from the document, not a default.
  await documentTabs(page)
    .first()
    .locator("[data-document-tab-title]")
    .dblclick();
  const rename = page.getByRole("textbox", {
    name: "Rename document",
    exact: true,
  });
  await expect(rename).toBeFocused();
  await rename.fill(partName);
  await rename.press("Enter");
  await expect(
    documentTabs(page).first().locator("[data-document-tab-title]"),
  ).toHaveText(partName);

  await (await openLogoMenu(page))
    .getByRole("menuitem", { name: "Share…" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Sign in to CADara" }),
  ).toBeVisible();
  const apiOrigin = await signIn(page, email, true);

  const newProject = page.getByRole("dialog", { name: "New project" });
  await expect(newProject).toBeVisible({ timeout: 30_000 });
  await expect(
    newProject.getByRole("textbox", { name: "Project name" }),
  ).toHaveValue(partName);
  await expect(
    newProject.getByRole("radio", { name: /^Local/ }),
  ).toBeDisabled();
  await expect(
    newProject.getByText("Sharing needs an account project.", { exact: true }),
  ).toBeVisible();
  await expect(
    newProject.getByRole("radio", { name: /^Private/ }),
  ).toBeChecked();
  await newProject
    .getByRole("button", { name: "Create project", exact: true })
    .click();

  const share = page.getByRole("dialog", { name: `Share ${partName}` });
  await expect(share).toBeVisible({ timeout: 60_000 });
  await expect(
    share.getByRole("region", { name: "People" }).getByText(email),
  ).toBeVisible({ timeout: 30_000 });
  await expect(projectSelect(page)).toHaveValue(partName);
  await expect(
    documentTabs(page),
    "the new account project holds only the moved part",
  ).toHaveCount(1);
  await expect(documentTabs(page).first()).toContainText(partName);

  // On an account project, Share opens the dialog directly.
  await page.keyboard.press("Escape");
  await expect(share).toHaveCount(0);
  await (await openLogoMenu(page))
    .getByRole("menuitem", { name: "Share…" })
    .click();
  await expect(share).toBeVisible();

  // A collaborator who leaves from the editor's Share dialog is moved off
  // the project they no longer have access to.
  const viewerContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 1440, height: 960 },
  });
  const viewer = await viewerContext.newPage();
  await openWorkbench(viewer, "/app?cadTestMode=1");
  await signIn(viewer, viewerEmail);
  await page.bringToFront();
  const people = share.getByRole("region", { name: "People" });
  await people
    .getByRole("textbox", { name: "Invite by email" })
    .fill(viewerEmail);
  await people
    .getByRole("combobox", { name: "Role for the invite" })
    .selectOption({ label: "Viewer" });
  await people.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(
    people.getByRole("button", { name: `Role of ${viewerEmail}: Viewer` }),
  ).toBeVisible();
  const projectId = await sharedProjectId(page, apiOrigin, partName);

  await openWorkbench(viewer, `/app/p/${projectId}?cadTestMode=1`);
  await expect(projectSelect(viewer)).toHaveValue(partName, {
    timeout: 60_000,
  });
  await (await openLogoMenu(viewer))
    .getByRole("menuitem", { name: "Share…" })
    .click();
  const viewerShare = viewer.getByRole("dialog", { name: `Share ${partName}` });
  await viewerShare.getByRole("button", { name: "Leave project" }).click();
  await expect(viewerShare).toHaveCount(0);
  await expect(projectSelect(viewer)).not.toHaveValue(partName, {
    timeout: 30_000,
  });
  await expect(
    viewer.getByRole("button", { name: "New project", exact: true }),
  ).toBeEnabled({ timeout: 30_000 });
  await viewerContext.close();
});

/** The id of the signed-in user's account project named `name`. */
async function sharedProjectId(page: Page, apiOrigin: string, name: string) {
  const get = async <T>(path: string) => {
    const response = await page.request.get(`${apiOrigin}${path}`, {
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(response.ok(), `GET ${path}: ${response.status()}`).toBe(true);
    return (await response.json()) as T;
  };
  for (const org of await get<{ id: string }[]>("/orgs")) {
    const found = (
      await get<{ id: string; name: string }[]>(`/orgs/${org.id}/projects`)
    ).find((project) => project.name === name);
    if (found) return found.id;
  }
  throw new Error(`No account project named ${name}.`);
}
