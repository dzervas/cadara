import { expect, test, type Page } from "@playwright/test";
import {
  addVariable,
  createProject,
  mailerLog,
  openCadaraMenuItem,
  openVariables,
  openWorkbench,
  signIn,
  syncStatus,
  variableRow,
} from "./helpers/project-sync";
import { expectStaged, openTopSketch } from "./helpers/mirror-workbench";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";

test.setTimeout(300_000);

const READ_ONLY_MESSAGE = "This project is read-only for your role.";

function machineState(page: Page) {
  return page.evaluate(() => window.__cadaraDebug?.getState()?.machineState);
}

/**
 * A refused action shows exactly one read-only notice and no red error;
 * waits for it to dismiss itself so the next refusal shows a fresh one.
 */
async function expectOneReadOnlyNotice(page: Page) {
  const notices = page
    .getByRole("status")
    .filter({ hasText: READ_ONLY_MESSAGE });
  await expect(notices).toHaveCount(1);
  await expect(page.getByText("Workbench action failed")).toHaveCount(0);
  await expect(notices).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Every connection state the sync badge shows during `durationMs`. A write
 * the room refuses drops the socket, which the badge shows as Connecting or
 * Offline before it reconnects.
 */
async function observedConnections(page: Page, durationMs: number) {
  return page.evaluate(async (duration) => {
    const seen = new Set<string>();
    const sample = () => {
      for (const badge of document.querySelectorAll(
        "[data-project-sync-connection]",
      ))
        seen.add(badge.getAttribute("data-project-sync-connection") ?? "");
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-project-sync-connection"],
    });
    sample();
    await new Promise((resolve) => setTimeout(resolve, duration));
    observer.disconnect();
    sample();
    return [...seen].sort();
  }, durationMs);
}

test("an invited viewer opens a synced project read only: shortcuts, undo, tab changes, reopening and variable edits are each refused with one notice and the connection stays synced", async ({
  browser,
}, testInfo) => {
  test.skip(!mailerLog, "Set CADARA_AUTH_MAILER_LOG to local wrangler stdout.");
  const baseURL = testInfo.project.use.baseURL!;
  const appUrl = new URL("/app?cadTestMode=1", baseURL).href;
  const appOrigin = new URL(baseURL).origin;
  const stamp = Date.now();
  const ownerEmail = `cadara-owner-${stamp}@example.test`;
  const viewerEmail = `cadara-viewer-${stamp}@example.test`;
  const projectName = `Viewed bracket ${stamp}`;
  const viewport = { width: 1440, height: 960 };
  const ownerContext = await browser.newContext({ baseURL, viewport });
  const viewerContext = await browser.newContext({ baseURL, viewport });
  const owner = await ownerContext.newPage();
  const viewer = await viewerContext.newPage();
  try {
    await openWorkbench(owner, appUrl);
    const apiOrigin = await signIn(owner, ownerEmail);
    await openWorkbench(viewer, appUrl);
    await signIn(viewer, viewerEmail);

    // The owner uploads a project holding one variable and one sketch.
    await createProject(owner, projectName);
    await openVariables(owner);
    await addVariable(owner, "variable_1");
    await expect(variableRow(owner, "variable_1")).toContainText("var1");
    const sketching = new SketchWorkbenchHarness(owner);
    await openTopSketch(sketching);
    await sketching.activateTool("Create circular geometry.");
    await sketching.clickViewportAt({ x: 600, y: 400 });
    await sketching.clickViewportAt({ x: 660, y: 400 });
    await expectStaged(sketching, 1);
    await owner.locator('button[data-tool-id="finishSketch"]').click();
    await expect.poll(() => machineState(owner)).toBe("idle");
    await openCadaraMenuItem(owner, "Upload to CADara…");
    await owner.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(syncStatus(owner, "Synced")).toBeVisible({ timeout: 30_000 });

    // The owner invites the second account and grants it the viewer role.
    const api = async <T>(
      page: Page,
      method: "GET" | "POST" | "PUT" | "PATCH",
      path: string,
      data?: unknown,
    ): Promise<T> => {
      const response = await page.request.fetch(`${apiOrigin}${path}`, {
        method,
        headers: { Origin: appOrigin },
        ...(data === undefined ? {} : { data }),
      });
      expect(
        response.ok(),
        `${method} ${path}: ${response.status()} ${await response.text()}`,
      ).toBe(true);
      return (await response.json()) as T;
    };
    let orgId = "";
    let projectId = "";
    for (const org of await api<{ id: string }[]>(owner, "GET", "/orgs")) {
      const remote = (
        await api<{ id: string; name: string }[]>(
          owner,
          "GET",
          `/orgs/${org.id}/projects`,
        )
      ).find((project) => project.name === projectName);
      if (remote) {
        orgId = org.id;
        projectId = remote.id;
      }
    }
    expect(projectId, "the uploaded project is listed").not.toBe("");
    const orgName = `Workshop ${stamp}`;
    await api(owner, "PATCH", `/orgs/${orgId}`, { name: orgName });
    const invitation = await api<{ id: string }>(
      owner,
      "POST",
      `/orgs/${orgId}/invitations`,
      { email: viewerEmail, role: "member" },
    );
    const accepted = await api<{ member: { userId: string } }>(
      viewer,
      "POST",
      `/invitations/${invitation.id}/accept`,
      {},
    );
    await api(
      owner,
      "PUT",
      `/orgs/${orgId}/projects/${projectId}/grants/${accepted.member.userId}`,
      { role: "viewer" },
    );

    // The viewer opens it from the service.
    await openCadaraMenuItem(viewer, "Open from CADara…");
    await viewer.getByRole("combobox", { name: "Organization" }).click();
    await viewer.getByRole("option", { name: orgName }).click();
    await viewer
      .getByRole("list", { name: "CADara projects" })
      .getByRole("listitem")
      .filter({ hasText: projectName })
      .click();
    await expect(
      viewer.getByRole("combobox", { name: "Project", exact: true }),
    ).toHaveValue(projectName, { timeout: 60_000 });
    await expect(syncStatus(viewer, "Synced")).toBeVisible({ timeout: 30_000 });
    await expect(
      viewer.getByRole("status", { name: "Read only · Viewer" }),
    ).toBeVisible({ timeout: 30_000 });
    // Opening the part writes nothing the room would refuse.
    expect(await observedConnections(viewer, 10_000)).toEqual(["synced"]);

    // Every refusal is a user-facing notice, never a reported error.
    const reportedErrors: string[] = [];
    viewer.on("console", (message) => {
      if (message.text().includes("[app-error]"))
        reportedErrors.push(message.text());
    });
    await viewer.bringToFront();
    await viewer
      .locator("canvas")
      .first()
      .click({ position: { x: 5, y: 5 } });

    // A tool shortcut.
    await viewer.keyboard.press("e");
    await expectOneReadOnlyNotice(viewer);
    expect(await machineState(viewer)).toBe("idle");

    // Document Undo.
    await viewer.keyboard.press("ControlOrMeta+z");
    await expectOneReadOnlyNotice(viewer);

    // Renaming, adding and closing parts.
    const activeTab = viewer.locator(
      '[data-document-tab][aria-selected="true"]',
    );
    const title = await activeTab
      .locator("[data-document-tab-title]")
      .textContent();
    await activeTab.locator("[data-document-tab-title]").dblclick();
    const rename = viewer.getByRole("textbox", {
      name: "Rename document",
      exact: true,
    });
    await rename.fill("Viewer title");
    await rename.press("Enter");
    await expectOneReadOnlyNotice(viewer);
    await expect(activeTab.locator("[data-document-tab-title]")).toHaveText(
      title!,
    );
    await viewer.getByRole("button", { name: "File", exact: true }).click();
    await viewer.getByRole("menuitem", { name: "New", exact: true }).click();
    await expectOneReadOnlyNotice(viewer);
    await expect(viewer.locator("[data-document-tab]")).toHaveCount(1);

    // Reopening the sketch for editing.
    await viewer
      .getByRole("button", { name: /^Select .+\. Double-click to reopen\.$/ })
      .first()
      .dblclick();
    await expectOneReadOnlyNotice(viewer);
    expect(await machineState(viewer)).toBe("idle");

    // A variable edit; the variable keeps its name.
    await openVariables(viewer);
    await variableRow(viewer, "variable_1").dblclick();
    await viewer
      .getByRole("textbox", { name: "Variable name variable_1" })
      .fill("width");
    await viewer.keyboard.press("Enter");
    await expectOneReadOnlyNotice(viewer);
    await expect(variableRow(viewer, "variable_1")).toContainText("var1");
    expect(reportedErrors).toEqual([]);

    // Nothing was written: the room never drops the viewer's connection.
    expect(await observedConnections(viewer, 30_000)).toEqual(["synced"]);
    await expect(variableRow(owner, "variable_1")).toContainText("var1");
  } finally {
    await ownerContext.close();
    await viewerContext.close();
  }
});
