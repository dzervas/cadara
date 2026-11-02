import { expect, test, type Page } from "@playwright/test";
import {
  mailerLog,
  openWorkbench,
  signIn,
  createProject,
  openCadaraMenuItem,
} from "./helpers/project-sync";
import {
  openTopSketch,
  expectStaged,
  glideClick,
} from "./helpers/mirror-workbench";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";
import { foregroundPeerPage } from "./helpers/peer-page";

test.use({ viewport: { width: 1440, height: 960 } });
test("two accounts see each other's role and matching selection colour, then clear it on deselect and disconnect", async ({
  browser,
}, testInfo) => {
  test.skip(
    !mailerLog,
    "Set CADARA_AUTH_MAILER_LOG to a private local API's memory mailer log.",
  );
  test.setTimeout(300_000);
  const baseURL = testInfo.project.use.baseURL!;
  const contexts = await Promise.all([
    browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } }),
    browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } }),
  ]);
  const [owner, guest] = (await Promise.all(
    contexts.map((context) => context.newPage()),
  )) as [Page, Page];
  const stamp = Date.now();
  const projectName = `Presence part ${stamp}`;
  const guestEmail = `presence-guest-${stamp}@example.test`;
  try {
    await openWorkbench(owner, "/app?cadTestMode=1");
    const apiOrigin = await signIn(
      owner,
      `presence-owner-${stamp}@example.test`,
    );
    await openWorkbench(guest, "/app?cadTestMode=1");
    await signIn(guest, guestEmail);
    await owner.bringToFront();
    await createProject(owner, projectName);
    const sketch = new SketchWorkbenchHarness(owner);
    await openTopSketch(sketch);
    await sketch.activateTool("Create circular geometry.");
    await sketch.clickViewportAt({ x: 600, y: 400 });
    await sketch.clickViewportAt({ x: 660, y: 400 });
    await expectStaged(sketch, 1);
    await owner.locator('button[data-tool-id="finishSketch"]').click();
    await expect
      .poll(() =>
        owner.evaluate(() => window.__cadaraDebug?.getState()?.machineState),
      )
      .toBe("idle");
    await openCadaraMenuItem(owner, "Upload to CADara…");
    await owner.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(owner.locator("[data-project-presence-row]")).toHaveAttribute(
      "data-project-sync-state",
      "synced",
      { timeout: 30_000 },
    );
    const api = async <T>(
      page: Page,
      method: string,
      path: string,
      data?: unknown,
    ): Promise<T> => {
      const response = await page.request.fetch(`${apiOrigin}${path}`, {
        method,
        headers: { Origin: new URL(baseURL).origin },
        ...(data === undefined ? {} : { data }),
      });
      expect(response.ok(), `${method} ${path}: ${response.status()}`).toBe(
        true,
      );
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
    expect(projectId).not.toBe("");
    const orgName = `Presence workshop ${stamp}`;
    await api(owner, "PATCH", `/orgs/${orgId}`, { name: orgName });
    // A personal organization shares single projects; an invite to an
    // existing verified account grants access at once.
    await api(owner, "POST", `/orgs/${orgId}/projects/${projectId}/invites`, {
      email: guestEmail,
      role: "editor",
    });
    await openCadaraMenuItem(guest, "Open from CADara…");
    await guest.getByRole("combobox", { name: "Owner" }).click();
    await guest.getByRole("option", { name: orgName }).click();
    await guest
      .getByRole("list", { name: "CADara projects" })
      .getByRole("listitem")
      .filter({ hasText: projectName })
      .click();
    for (const page of [owner, guest]) {
      await page.bringToFront();
      await expect(
        page
          .getByRole("list", { name: "People in this project", exact: true })
          .getByRole("listitem"),
      ).toHaveCount(1, { timeout: 30_000 });
      await expect(
        page.getByRole("status", { name: /Sync status:/ }),
      ).toHaveCount(0);
    }
    // Select the committed sketch through its parts-tree row, a durable sketch ref.
    const sketchRow = owner
      .getByRole("complementary", { name: "Parts and objects" })
      .getByRole("button", { name: "Sketch Draft", exact: true });
    await owner.bringToFront();
    await sketchRow.click();
    await guest.bringToFront();
    const readHighlights = () =>
      guest
        .locator("[data-project-peer-highlights]")
        .getAttribute("data-project-peer-highlights")
        .then(
          (value) =>
            JSON.parse(value ?? "[]") as {
              color: string;
              target: { kind: string };
            }[],
        );
    await expect
      .poll(async () => (await readHighlights()).length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    const ring = guest.locator("[data-project-presence-color]").first();
    const color = await ring.getAttribute("data-project-presence-color");
    expect(
      (await readHighlights()).every((highlight) => highlight.color === color),
    ).toBe(true);
    await ring.hover();
    await expect(guest.getByRole("tooltip")).toContainText(
      /admin|editor|owner/,
    );
    await owner.bringToFront();
    await glideClick(sketch, { x: 1100, y: 700 });
    await expect.poll(readHighlights).toEqual([]);
    await sketchRow.click();
    await foregroundPeerPage(guest);
    await expect
      .poll(async () => (await readHighlights()).length)
      .toBeGreaterThan(0);
    await contexts[0]!.close();
    await guest.bringToFront();
    await expect(
      guest.getByRole("list", { name: "People in this project", exact: true }),
    ).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(readHighlights).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
