import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import type { ModelingOperationHistoryPayload } from "../../src/contracts/modeling/operation-history";

/** Session messages use the generic notification renderer; inspect its message, not title/actions. */
export function sketchDiagnosticMessage(page: Page): Locator {
  return page.locator("[data-sketch-diagnostic] [data-notification-message]");
}

/**
 * Seeded histories use the legacy fixed first-part id: a stored history under
 * it is legacy state, so the workbench keeps that id for its first part.
 */
const WORKSPACE_DOCUMENT_ID = "doc_workspace";
const MODELING_OPERATION_HISTORY_STORAGE_KEY = `cad.modeling.operationHistory.${WORKSPACE_DOCUMENT_ID}.v1`;
/** The default namespace's Automerge URL store (`document-repository-url-store.ts`). */
const DOCUMENT_REPOSITORY_URL_STORAGE_KEY =
  "cad.documentRepository.automergeUrls.v1";

export class SketchWorkbenchHarness {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async settledCamera() {
    return this.page.evaluate(() => {
      if (!window.__cadFlushCameraDamping?.()) throw new Error("Camera damping was not ready");
      const frame = window.__cadReadCamera?.();
      if (!frame) throw new Error("Camera was not ready");
      // OrbitControls recomputes spherical coordinates even on an idle update.
      const stable = (value: number) => Math.round(value * 1e8) / 1e8;
      return { position: frame.position.map(stable), target: frame.target.map(stable), zoom: stable(frame.zoom) };
    });
  }

  async seedOperationHistory(payload: ModelingOperationHistoryPayload) {
    const serializedPayload = JSON.stringify(payload);

    await this.page.addInitScript(
      ({ storageKey, serialized }) => {
        if (window.localStorage.getItem(storageKey) === null) {
          window.localStorage.setItem(storageKey, serialized);
        }
      },
      {
        storageKey: MODELING_OPERATION_HISTORY_STORAGE_KEY,
        serialized: serializedPayload,
      },
    );
  }

  async openWithOperationHistory(
    payload: ModelingOperationHistoryPayload,
    path = "/app",
  ) {
    await this.seedOperationHistory(payload);
    await this.open(path);
  }

  async open(path = "/app") {
    await this.openPreservingStorage(withDisabledRepository(path));
  }

  async openWithRepository(path = "/app") {
    await this.openPreservingStorage(withTestMode(path));
  }

  /**
   * T17j3: a seeded fixture through the production document repository.
   * The operation history is stored once (not again on a reload) and the
   * app opens with the repository on; an empty repository restores a
   * stored operation history by replaying it, writes the resulting
   * authored document to the repository and removes the stored history
   * (`restoreRepositoryBackedDocument`). Waits until that happened: the
   * history key is gone and the repository holds the workspace document.
   */
  async openWithRepositoryAndOperationHistory(
    payload: ModelingOperationHistoryPayload,
  ) {
    await this.page.addInitScript(
      ({ storageKey, serialized, marker }) => {
        if (window.localStorage.getItem(marker) !== null) return;
        window.localStorage.setItem(marker, "seeded");
        window.localStorage.setItem(storageKey, serialized);
      },
      {
        storageKey: MODELING_OPERATION_HISTORY_STORAGE_KEY,
        serialized: JSON.stringify(payload),
        marker: `${MODELING_OPERATION_HISTORY_STORAGE_KEY}.e2e-seeded`,
      },
    );
    await this.openWithRepository();
    await expect
      .poll(
        async () => ({
          historyStored: await this.page.evaluate(
            (storageKey) => window.localStorage.getItem(storageKey) !== null,
            MODELING_OPERATION_HISTORY_STORAGE_KEY,
          ),
          repository: await this.workspaceRepositoryUrlStored(),
        }),
        {
          message:
            "the seeded history was restored into the document repository",
          timeout: 30_000,
        },
      )
      .toEqual({ historyStored: false, repository: true });
  }

  /**
   * T17j3: the production document repository holds the active part's
   * document (its Automerge URL is stored); never true with the repository
   * disabled.
   */
  async expectWorkspaceInRepository() {
    await expect
      .poll(() => this.workspaceRepositoryUrlStored(), {
        message: "the document repository holds the active part's document",
        timeout: 30_000,
      })
      .toBe(true);
  }

  /** The active document tab's part identity. */
  activeDocumentId() {
    return this.page
      .locator('[data-document-tab][aria-selected="true"]')
      .getAttribute("data-document-id");
  }

  private async workspaceRepositoryUrlStored() {
    const documentId = await this.activeDocumentId();
    return this.page.evaluate(
      ({ urlKey, documentId }) =>
        documentId !== null &&
        ((
          JSON.parse(window.localStorage.getItem(urlKey) ?? "{}") as Record<
            string,
            string
          >
        )[documentId]?.startsWith("automerge:") ??
          false),
      { urlKey: DOCUMENT_REPOSITORY_URL_STORAGE_KEY, documentId },
    );
  }

  async openPreservingStorage(path = "/app") {
    await this.page.goto(path);
    await this.waitForCadStateReady();
    await expect
      .poll(() => this.readMachineLabel(), { timeout: 30_000 })
      .not.toBe("");
    await expect
      .poll(() => this.revisionLabel(), { timeout: 30_000 })
      .not.toBe("loading");
  }

  async reloadPreservingStorage(path?: string) {
    await this.openPreservingStorage(
      withDisabledRepository(path ?? (await this.currentPath())),
    );
  }

  async reloadPreservingRepositoryStorage(path?: string) {
    await this.openPreservingStorage(
      withTestMode(path ?? (await this.currentPath())),
    );
  }

  toolbarButton(name: string): Locator {
    return this.page.locator(
      `button[aria-label="${name}"], button[data-tool-tooltip="${name}"]`,
    );
  }

  viewport(): Locator {
    return this.page.locator("main canvas").first();
  }

  viewportSurface(): Locator {
    return this.page.getByTestId("cad-viewport");
  }

  /**
   * What shows a tool's armed state: its own button, or the collapsed island
   * hiding it (pressed while any of its tools is armed).
   */
  toolbarToolControl(name: string): Locator {
    return this.toolbarButton(name).or(this.toolbarGroupTrigger(name));
  }

  /** The collapsed toolbar island (or merged islands) that hides a tool. */
  toolbarGroupTrigger(name: string): Locator {
    return this.page.locator(`button[data-toolbar-group-tools*="|${name}|"]`);
  }

  /**
   * Narrow toolbars collapse whole islands into one dropdown; a tool that is
   * not on the bar is picked from the menu of the island that hides it.
   */
  async activateTool(
    name: string,
    press: (control: Locator) => Promise<void> = (control) => control.click(),
  ) {
    if (await this.openCollapsedToolbarGroup(name, press)) {
      await press(
        this.page.locator(
          `[role="menuitem"][data-tool-tooltip="${name}"], [role="menuitem"][data-tool-name="${name}"]`,
        ),
      );
      return;
    }
    await press(this.toolbarButton(name));
  }

  /**
   * Opens the menu listing a tool family's variants: the family dropdown when
   * it is on the bar, otherwise the collapsed island that hides it.
   */
  async openToolMenu(name: string) {
    if (
      !(await this.openCollapsedToolbarGroup(name, (control) =>
        control.click(),
      ))
    ) {
      await this.toolbarButton(name).click();
    }
    await expect(this.page.getByRole("menu")).toBeVisible();
  }

  private async openCollapsedToolbarGroup(
    name: string,
    press: (control: Locator) => Promise<void>,
  ) {
    const direct = this.toolbarButton(name);
    const group = this.toolbarGroupTrigger(name);
    await expect(direct.or(group).first()).toBeVisible();
    if ((await direct.count()) > 0) {
      return false;
    }
    await press(group);
    return true;
  }

  async hoverViewportAt(point: { x: number; y: number }) {
    const box = await this.viewport().boundingBox();

    if (!box) {
      throw new Error("Viewport canvas is not visible.");
    }

    await this.page.mouse.move(box.x + point.x, box.y + point.y);
  }

  async hoverViewportAtReal(point: { x: number; y: number }) {
    const box = await this.viewportSurface().boundingBox();

    if (!box) {
      throw new Error("Viewport surface is not visible.");
    }

    const targetX = box.x + point.x;
    const targetY = box.y + point.y;

    await this.page.mouse.move(targetX - 4, targetY - 4);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.page.mouse.move(targetX, targetY);
      if (attempt < 2) {
        await this.page.waitForTimeout(50);
      }
    }
  }

  async clickViewportAt(point: { x: number; y: number }) {
    const box = await this.viewport().boundingBox();

    if (!box) {
      throw new Error("Viewport canvas is not visible.");
    }

    await this.page.mouse.click(box.x + point.x, box.y + point.y);
  }

  async clickViewportAtReal(point: { x: number; y: number }) {
    const box = await this.viewportSurface().boundingBox();

    if (!box) {
      throw new Error("Viewport surface is not visible.");
    }

    await this.page.mouse.click(box.x + point.x, box.y + point.y);
  }

  async currentHoverTarget() {
    return this.evaluateWithNavigationRetry(
      () => window.__cadaraDebug?.getState()?.hoverTarget ?? "none",
    );
  }

  async currentEditorSelection() {
    return this.evaluateWithNavigationRetry(
      () => window.__cadaraDebug?.getState()?.selectionTargets ?? "",
    );
  }

  async currentSketchSession() {
    return this.evaluateWithNavigationRetry(
      () => window.__cadaraDebug?.getState()?.sketchSession ?? "none",
    );
  }

  async currentMachineSelectionCount() {
    return this.evaluateWithNavigationRetry(
      () => window.__cadaraDebug?.getState()?.selectionCount ?? Number.NaN,
    );
  }

  async currentPhase() {
    return this.evaluateWithNavigationRetry(
      () => window.__cadaraDebug?.getState()?.phase ?? "",
    );
  }

  async clearHoverByLeavingViewport() {
    const box = await this.viewportSurface().boundingBox();

    if (!box) {
      throw new Error("Viewport surface is not visible.");
    }

    await this.page.mouse.move(box.x - 24, box.y - 24);
  }

  async viewportCrop(point: { x: number; y: number }, radius = 48) {
    const box = await this.viewportSurface().boundingBox();

    if (!box) {
      throw new Error("Viewport surface is not visible.");
    }

    const size = radius * 2;
    return this.page.screenshot({
      clip: {
        x: Math.round(box.x + point.x - radius),
        y: Math.round(box.y + point.y - radius),
        width: size,
        height: size,
      },
    });
  }

  async waitForAnimationFrames(count = 2) {
    await this.evaluateWithNavigationRetry(
      (frames) =>
        new Promise<void>((resolve) => {
          let remaining = frames;

          const advance = () => {
            remaining -= 1;

            if (remaining <= 0) {
              resolve();
              return;
            }

            window.requestAnimationFrame(advance);
          };

          window.requestAnimationFrame(advance);
        }),
      count,
    );
  }

  async expectSketchPlane(label: string) {
    await expect
      .poll(() =>
        this.evaluateWithNavigationRetry(
          () => window.__cadaraDebug?.getState()?.sketchPlane ?? "none",
        ),
      )
      .toBe(label);
  }

  async expectSketchSessionActive() {
    await this.expectMachine("editingSketch");
    await expect
      .poll(
        () =>
          this.evaluateWithNavigationRetry(
            () => window.__cadaraDebug?.getState()?.sketchPlane ?? "none",
          ),
        { timeout: 10_000 },
      )
      .not.toBe("none");
  }

  async expectMachine(kind: string, timeout = 10_000) {
    await expect
      .poll(() => this.readMachineLabel(), { timeout })
      .toContain(kind);
  }

  protected async evaluateWithNavigationRetry<Result>(
    pageFunction: () => Result,
  ): Promise<Result>;
  protected async evaluateWithNavigationRetry<Arg, Result>(
    pageFunction: (arg: Arg) => Result,
    arg: Arg,
  ): Promise<Result>;
  protected async evaluateWithNavigationRetry<Arg, Result>(
    pageFunction: (arg: unknown) => Result,
    arg?: Arg,
  ): Promise<Result> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.page.evaluate(pageFunction, arg);
      } catch (error) {
        lastError = error;

        if (!isNavigationContextError(error) || attempt === 4) {
          throw error;
        }

        await this.page
          .waitForLoadState("domcontentloaded", { timeout: 5_000 })
          .catch(() => undefined);
        await this.page.waitForTimeout(50 * (attempt + 1));
      }
    }

    throw lastError;
  }

  private async waitForCadStateReady() {
    await this.page.waitForLoadState("domcontentloaded");
    await this.page.waitForFunction(
      () =>
        Boolean(
          window.__cadaraDebug?.getState()?.machineState ||
          window.__cadaraDebug?.getState()?.revision,
        ),
      undefined,
      { timeout: 30_000 },
    );
  }

  protected async revisionLabel() {
    return this.evaluateWithNavigationRetry(
      () => window.__cadaraDebug?.getState()?.revision ?? "loading",
    );
  }

  private async readMachineLabel() {
    return this.evaluateWithNavigationRetry(
      () => window.__cadaraDebug?.getState()?.machineState ?? "",
    );
  }

  private async currentPath() {
    return this.evaluateWithNavigationRetry(
      () =>
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
  }
}

function isNavigationContextError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return [
    "Execution context was destroyed",
    "Cannot find context with specified id",
    "Frame was detached",
  ].some((message) => error.message.includes(message));
}

function withDisabledRepository(path: string) {
  const url = new URL(path, "http://127.0.0.1:3000");
  url.searchParams.set("cadDisableRepository", "1");
  url.searchParams.set("cadTestMode", "1");

  return path.startsWith("http://") || path.startsWith("https://")
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`;
}

function withTestMode(path: string) {
  const url = new URL(path, "http://127.0.0.1:3000");
  url.searchParams.set("cadTestMode", "1");

  return path.startsWith("http://") || path.startsWith("https://")
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`;
}
