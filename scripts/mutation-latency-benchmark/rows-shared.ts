// Shared row plumbing of `bun run bench:mutation`
// (scripts/mutation-latency-benchmark.ts): the per-row session, the timed
// sample, page predicates and the UI gestures every row family uses. The
// gestures copy the selectors of e2e/helpers/ (this script runs under bun,
// outside Playwright test, so it cannot import them).
import type { Locator, Page } from "@playwright/test";

export const SAMPLE_TIMEOUT_MS = 120_000;
export const OPEN_TIMEOUT_MS = 300_000;
export const OCC_QUIET_MS = 300;

export const now = () => performance.timeOrigin + performance.now();

export function round(value: number) {
  return Math.round(value * 10) / 10;
}

export interface BenchmarkFixture {
  name: string;
  /** The document variable `variableEdit` changes, when the fixture has one. */
  variable: string | null;
  source: string;
}

/** One profiled thread of a sample (CDP target), or why it has no profile. */
export type ProfiledTarget =
  | { type: string; url: string; error: string }
  | {
      type: string;
      url: string;
      file: string;
      /**
       * Maps profile timestamps to epoch: epochMs = us / 1000 + offsetMs. A
       * profile starts while its Profiler.start call is in flight, so the
       * offset is known to +-uncertaintyMs (half the call's round trip). All
       * targets share the host's monotonic clock, so a sample uses its
       * narrowest target bracket.
       */
      clock: { offsetMs: number; uncertaintyMs: number };
      busyMs: number;
      topSelf: { name: string; ms: number }[];
      /** Set once the sample's spans arrived (runRow). */
      phaseBusyMs?: Record<string, number>;
    };

export interface SampleProfiler {
  start(): Promise<void>;
  stop(tag: string, directory: string): Promise<ProfiledTarget[]>;
}

export interface Session {
  page: Page;
  baseUrl: string;
  fixture: BenchmarkFixture;
  document: Buffer;
  /** Set by runRow for samples that are CPU-profiled (act -> persisted). */
  profiling: {
    profiler: SampleProfiler;
    tag: string;
    directory: string;
  } | null;
}

export interface SampleTiming {
  startMs: number;
  endMs: number;
  /** How long the pre-sample idle gate waited for setup work to drain. */
  idleWaitMs: number;
  actMs: number;
  /** Null for kinds without a DOM signal of the applied result (colour). */
  reflectedMs: number | null;
  /** Null for kinds that are not undoable actions (timeline cursor moves). */
  persistedMs: number | null;
  /** Viewport render-idle again; null when the viewport never left idle. */
  settledMs?: number | null;
  /**
   * Row-specific measurements of the sample, named with their unit (e.g.
   * the Measure readout after a selection, per-step hover latency, frame
   * intervals of a drag); null when the sample could not measure it.
   */
  metrics?: Record<string, number | null>;
  /** CPU profiles of this sample, taken from `startMs` to `profileEndMs`. */
  profile?: { profileEndMs: number; targets: ProfiledTarget[] };
}

// One sample per call; `index` 0 is the first mutation after opening.
export type SampleRunner = (
  session: Session,
  index: number,
) => Promise<SampleTiming>;

/** A row's per-sample runner, or a skip reason when the fixture cannot express the kind. */
export type RowPreparation = SampleRunner | string;

// ------------------------------------------------------------ page probes

export function historySignature(page: Page) {
  return page.evaluate(() => {
    const history = (
      window as unknown as { __benchHistory: { signature: string }[] }
    ).__benchHistory;
    return history.at(-1)?.signature ?? "";
  });
}

/** Epoch ms of the first history-strip change after `sinceMs` away from `before`. */
export async function waitForHistoryChange(
  page: Page,
  before: string,
  sinceMs: number,
) {
  const handle = await page
    .waitForFunction(
      ({ before, sinceMs }) => {
        const history = (
          window as unknown as {
            __benchHistory: { atMs: number; signature: string }[];
          }
        ).__benchHistory;
        return (
          history.find(
            (entry) => entry.atMs >= sinceMs && entry.signature !== before,
          )?.atMs ?? false
        );
      },
      { before, sinceMs },
      { polling: 50, timeout: SAMPLE_TIMEOUT_MS },
    )
    .catch((error: unknown) => {
      throw new Error(`the undo strip never changed from "${before}"`, {
        cause: error,
      });
    });
  return (await handle.jsonValue()) as number;
}

/** Epoch ms when `predicate(arg)` first held, polled every 10 ms in the page. */
export async function waitInPage<Arg>(
  page: Page,
  predicate: (arg: Arg) => boolean,
  arg: Arg,
) {
  const source = predicate.toString();
  const handle = await page
    .waitForFunction(
      ({ source, arg }) => {
        const check = new Function(`return (${source})`)() as (
          value: unknown,
        ) => boolean;
        return check(arg) ? performance.timeOrigin + performance.now() : false;
      },
      { source, arg },
      { polling: 10, timeout: SAMPLE_TIMEOUT_MS },
    )
    .catch((error: unknown) => {
      throw new Error(
        `never held: ${source.replace(/\s+/g, " ").slice(0, 160)} (arg ${JSON.stringify(arg)})`,
        { cause: error },
      );
    });
  return (await handle.jsonValue()) as number;
}

/**
 * Starts recording in the page the epoch ms when `predicate(arg)` first
 * holds (checked on every DOM mutation and every 10 ms), for a second
 * signal of one sample that `waitInPage` would only see after the first.
 * The caller makes sure it does not already hold.
 */
export async function startWatch<Arg>(
  page: Page,
  name: string,
  predicate: (arg: Arg) => boolean,
  arg: Arg,
) {
  await page.evaluate(
    ({ name, source, arg }) => {
      const check = new Function(`return (${source})`)() as (
        value: unknown,
      ) => boolean;
      const target = window as unknown as {
        __benchWatches?: Record<string, number | null>;
      };
      const watches = (target.__benchWatches ??= {});
      watches[name] = null;
      const observer = new MutationObserver(() => test());
      const interval = setInterval(() => test(), 10);
      const test = () => {
        if (watches[name] !== null || !check(arg)) return;
        watches[name] = performance.timeOrigin + performance.now();
        observer.disconnect();
        clearInterval(interval);
      };
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      test();
    },
    { name, source: predicate.toString(), arg },
  );
}

/** Epoch ms recorded by `startWatch(name)`, once it held. */
export async function waitForWatch(page: Page, name: string) {
  const handle = await page.waitForFunction(
    (name) =>
      (
        window as unknown as {
          __benchWatches?: Record<string, number | null>;
        }
      ).__benchWatches?.[name] ?? false,
    name,
    { polling: 50, timeout: SAMPLE_TIMEOUT_MS },
  );
  return (await handle.jsonValue()) as number;
}

/**
 * Records `probe()` once per animation frame from now until
 * `stopFrameProbe`: the frame timestamps, and every change of the probed
 * value with its time since the latest pointer move (null before the first
 * move). Measures pointer-driven gestures (hover, drags, orbit) per step.
 */
export async function startFrameProbe(page: Page, probe: () => string) {
  await page.evaluate((source) => {
    const read = new Function(`return (${source})`)() as () => string;
    const recorder = {
      running: true,
      frames: [] as number[],
      changes: [] as { atMs: number; sinceMoveMs: number | null }[],
      lastMoveMs: null as number | null,
      last: read(),
      stop: () => {},
    };
    const onMove = (event: PointerEvent) => {
      recorder.lastMoveMs = performance.timeOrigin + event.timeStamp;
    };
    window.addEventListener("pointermove", onMove, { capture: true });
    const frame = (timestamp: number) => {
      if (!recorder.running) return;
      recorder.frames.push(performance.timeOrigin + timestamp);
      const value = read();
      if (value !== recorder.last) {
        recorder.last = value;
        const atMs = performance.timeOrigin + performance.now();
        recorder.changes.push({
          atMs,
          sinceMoveMs:
            recorder.lastMoveMs === null ? null : atMs - recorder.lastMoveMs,
        });
      }
      requestAnimationFrame(frame);
    };
    recorder.stop = () => {
      recorder.running = false;
      window.removeEventListener("pointermove", onMove, { capture: true });
    };
    (
      window as unknown as { __benchFrameProbe: typeof recorder }
    ).__benchFrameProbe = recorder;
    requestAnimationFrame(frame);
  }, probe.toString());
}

export interface FrameProbeRecord {
  frames: number[];
  changes: { atMs: number; sinceMoveMs: number | null }[];
}

export function stopFrameProbe(page: Page): Promise<FrameProbeRecord> {
  return page.evaluate(() => {
    const recorder = (
      window as unknown as {
        __benchFrameProbe: FrameProbeRecord & { stop(): void };
      }
    ).__benchFrameProbe;
    recorder.stop();
    return { frames: recorder.frames, changes: recorder.changes };
  });
}

/** Median and nearest-rank p95 of `values` (null each when empty). */
export function medianAndP95(values: readonly number[]) {
  if (values.length === 0) return { median: null, p95: null };
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: round(
      sorted.length % 2 === 1
        ? sorted[middle]!
        : (sorted[middle - 1]! + sorted[middle]!) / 2,
    ),
    p95: round(sorted[Math.ceil(0.95 * sorted.length) - 1]!),
  };
}

/** Waits until no OCC worker request has been in flight for OCC_QUIET_MS. */
export async function waitForOccQuiet(page: Page) {
  await page.waitForFunction(
    (quietMs) => {
      const occ = (
        window as unknown as {
          __benchOcc: { inFlight: Set<string>; changedAtMs: number };
        }
      ).__benchOcc;
      return (
        occ.inFlight.size === 0 &&
        performance.timeOrigin + performance.now() - occ.changedAtMs >= quietMs
      );
    },
    OCC_QUIET_MS,
    { polling: 20, timeout: SAMPLE_TIMEOUT_MS },
  );
}

/**
 * One timed mutation: `act` is the user's committing gesture; `reflected`
 * resolves (epoch ms) when the UI shows the result (null: no such signal);
 * persisted is the undo strip listing the action (`persisted` for
 * downloads, "none" for kinds outside undo history). The clock starts only
 * after setup work (previews, reopen, background refinement) has drained.
 */
export async function timedSample(
  session: Session,
  act: () => Promise<void>,
  reflected: (() => Promise<number>) | null,
  persisted: (() => Promise<number>) | "history" | "none" = "history",
): Promise<SampleTiming> {
  const { page, profiling } = session;
  const gateStart = now();
  await waitForOccQuiet(page);
  const before = await historySignature(page);
  if (profiling) await profiling.profiler.start();
  const startMs = now();
  await act();
  const actedAt = now();
  const reflectedAt = reflected ? await reflected() : null;
  const persistedAt =
    persisted === "history"
      ? await waitForHistoryChange(page, before, startMs)
      : persisted === "none"
        ? null
        : await persisted();
  const timing: SampleTiming = {
    startMs,
    endMs: Math.max(reflectedAt ?? startMs, persistedAt ?? startMs),
    idleWaitMs: round(startMs - gateStart),
    actMs: round(actedAt - startMs),
    reflectedMs: reflectedAt === null ? null : round(reflectedAt - startMs),
    persistedMs: persistedAt === null ? null : round(persistedAt - startMs),
  };
  if (profiling) {
    timing.profile = {
      profileEndMs: now(),
      targets: await profiling.profiler.stop(
        profiling.tag,
        profiling.directory,
      ),
    };
  }
  return timing;
}

/**
 * Epoch ms when the viewport last became render-idle after `sinceMs`, once
 * it is idle; null when it never left idle (no viewport work).
 */
export async function waitForRenderSettled(page: Page, sinceMs: number) {
  const handle = await page.waitForFunction(
    (sinceMs) => {
      const transitions = (
        window as unknown as {
          __benchRenderIdle: { atMs: number; idle: boolean }[];
        }
      ).__benchRenderIdle;
      const lastTransition = transitions.at(-1);
      if (!lastTransition?.idle) return false;
      return {
        at: lastTransition.atMs >= sinceMs ? lastTransition.atMs : null,
      };
    },
    sinceMs,
    { polling: 50, timeout: SAMPLE_TIMEOUT_MS },
  );
  return ((await handle.jsonValue()) as { at: number | null }).at;
}

/**
 * Records the sample's settled signal before the row's untimed cleanup
 * (runRow's own wait would include the cleanup). `editorIdle` false: the
 * act leaves an open sketch or feature dialog, where the viewport never
 * reports render-idle (it needs an idle editor), so settled is null.
 */
export async function settleBeforeCleanup(
  page: Page,
  timing: SampleTiming,
  editorIdle = true,
) {
  if (!editorIdle) {
    timing.settledMs = null;
    return;
  }
  const settledAt = await waitForRenderSettled(page, timing.startMs);
  timing.settledMs =
    settledAt === null ? null : round(settledAt - timing.startMs);
}

/** Untimed setup action that is undoable: runs it and waits for the undo strip. */
export async function untimedHistoryAction(
  page: Page,
  act: () => Promise<unknown>,
) {
  const before = await historySignature(page);
  const since = now();
  await act();
  await waitForHistoryChange(page, before, since);
}

// -------------------------------------------------------- debug platform

/** `window.__cadaraDebug.getState()[field]` contains `text` (TEST builds only). */
export const debugStateContains = ({
  field,
  text,
}: {
  field: string;
  text: string;
}) =>
  String(
    ((
      window as unknown as {
        __cadaraDebug?: { getState(): Record<string, unknown> | null };
      }
    ).__cadaraDebug?.getState() ?? {})[field] ?? "",
  ).includes(text);

/** One string field of `window.__cadaraDebug.getState()`. */
export function debugStateField(page: Page, field: string) {
  return page.evaluate(
    (field) =>
      String(
        ((
          window as unknown as {
            __cadaraDebug?: { getState(): Record<string, unknown> | null };
          }
        ).__cadaraDebug?.getState() ?? {})[field] ?? "",
      ),
    field,
  );
}

export function waitForMachine(page: Page, text: string) {
  return waitInPage(page, debugStateContains, { field: "machineState", text });
}

/** Clears the editor selection (debug platform) and waits for its readout to go. */
export async function clearSelection(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { __cadaraDebug: { clearSelection(): void } }
    ).__cadaraDebug.clearSelection(),
  );
  await waitInPage(page, debugStateContains, {
    field: "selectionTargets",
    text: "Nothing selected",
  });
  await waitInPage(
    page,
    () => !document.querySelector("[data-measurement-panel]"),
    null,
  );
}

export async function hasDebugBridge(page: Page) {
  return page.evaluate(
    () =>
      typeof (window as unknown as { __cadaraDebug?: unknown })
        .__cadaraDebug !== "undefined",
  );
}

export async function selectableTargets(page: Page, pattern: RegExp) {
  return page.evaluate(
    ({ source, flags }) => {
      const matcher = new RegExp(source, flags);
      const targets =
        (
          window as unknown as {
            __cadaraDebug?: {
              getState(): { selectableTargets?: string[] } | null;
            };
          }
        ).__cadaraDebug?.getState()?.selectableTargets ?? [];
      return targets.filter((target) => matcher.test(target));
    },
    { source: pattern.source, flags: pattern.flags },
  );
}

/** Debug-platform selection of `id` (the feature E2E helpers' first path). */
export function selectTarget(page: Page, id: string) {
  return page.evaluate(
    (id) =>
      (
        window as unknown as {
          __cadaraDebug: { selectTarget(id: string): boolean };
        }
      ).__cadaraDebug.selectTarget(id),
    id,
  );
}

export function previewDiagnostics(page: Page) {
  return debugStateField(page, "previewDiagnostics");
}

/** The open sketch's staged entity count (0 without a commit request). */
export async function stagedEntityCount(page: Page) {
  const session = await debugStateField(page, "sketchSession");
  return Number(/(\d+) entities staged/.exec(session)?.[1] ?? 0);
}

// ------------------------------------------------------------- workbench UI

export const partsTree = (page: Page) =>
  page.getByRole("complementary", { name: "Parts and objects" });

export const timelineItems = (page: Page) =>
  page.locator(
    "button[data-history-feature-id], button[data-history-sketch-id]",
  );

export const timelineCount = () =>
  document.querySelectorAll(
    "button[data-history-feature-id], button[data-history-sketch-id]",
  ).length;

/** Reflected predicate: the timeline lists more (`grew`) or fewer items than `count`. */
export const timelineCountChanged = ({
  count,
  grew,
}: {
  count: number;
  grew: boolean;
}) => {
  const current = document.querySelectorAll(
    "button[data-history-feature-id], button[data-history-sketch-id]",
  ).length;
  return grew ? current > count : current < count;
};

export const undoButton = (page: Page) =>
  page.locator('button[data-tool-id="undo"]');
export const redoButton = (page: Page) =>
  page.locator('button[data-tool-id="redo"]');

/** One untimed Undo of the newest action (the undo strip changes). */
export function undoUntimed(page: Page) {
  return untimedHistoryAction(page, () => undoButton(page).click());
}

const toolbarButton = (page: Page, tooltip: string) =>
  page.locator(
    `button[aria-label="${tooltip}"], button[data-tool-tooltip="${tooltip}"]`,
  );

/**
 * Presses a tool by tooltip: its own button, or (narrow toolbars collapse
 * whole islands into one dropdown) the island that hides it, then its menu
 * item; a tool family's dropdown trigger, then its primary variant.
 */
export async function activateTool(page: Page, tooltip: string) {
  const direct = toolbarButton(page, tooltip);
  const island = page.locator(
    `button[data-toolbar-group-tools*="|${tooltip}|"]`,
  );
  await direct.or(island).first().waitFor({ timeout: SAMPLE_TIMEOUT_MS });
  if ((await direct.count()) > 0) {
    await direct.first().click();
  } else {
    await island.click();
    await page
      .locator(`[role="menuitem"][data-tool-tooltip="${tooltip}"]`)
      .click();
  }
  // A family trigger opens its variant menu: pick the variant with this tooltip.
  const variant = page.locator(
    `[role="menuitem"][data-tool-tooltip="${tooltip}"]`,
  );
  if (await variant.isVisible().catch(() => false)) await variant.click();
}

export async function openFixture(
  page: Page,
  baseUrl: string,
  name: string,
  document: Buffer,
  path = "/app",
) {
  await page.goto(`${baseUrl}${path}`);
  await page
    .getByRole("button", { name: "File", exact: true })
    .waitFor({ timeout: OPEN_TIMEOUT_MS });
  return openDocumentCopy(page, name, document);
}

/** File → Open... → "Open a copy" of `document` in the loaded app; its ms. */
export async function openDocumentCopy(
  page: Page,
  name: string,
  document: Buffer,
) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Open..." }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open a copy" }).click();
  const chooser = await chooserPromise;
  const start = now();
  await chooser.setFiles({
    name: `${name}.cadara`,
    mimeType: "application/vnd.cadara+json",
    buffer: document,
  });
  await page
    .getByRole("status")
    .filter({ hasText: `Opened ${name}.cadara.` })
    .last()
    .waitFor({ timeout: OPEN_TIMEOUT_MS });
  await page
    .getByRole("status", { name: "Initial model render pending" })
    .waitFor({ state: "detached", timeout: OPEN_TIMEOUT_MS });
  return now() - start;
}

export async function firstBodyRow(page: Page) {
  const row = partsTree(page)
    .locator('[role="treeitem"][data-parts-tree-target^="body:"]')
    .first();
  const target = await row.getAttribute("data-parts-tree-target");
  return { target: target!, label: (await row.innerText()).trim() };
}

/** Hides a body with its Parts & Objects eye toggle (shown on row hover). */
export async function hideBody(page: Page, bodyId: string) {
  const row = partsTree(page).locator(
    `[data-parts-tree-target="body:${bodyId}"]`,
  );
  const label = (await row.innerText()).trim();
  await glideOnto(page, row);
  await row.getByRole("button", { name: `Hide ${label}`, exact: true }).click();
  await waitInPage(
    page,
    (target: string) =>
      document
        .querySelector(`[data-parts-tree-target="${target}"]`)
        ?.getAttribute("data-hidden") === "true",
    `body:${bodyId}`,
  );
  await waitForOccQuiet(page);
}

export async function renameBody(page: Page, target: string, next: string) {
  const row = partsTree(page).locator(`[data-parts-tree-target="${target}"]`);
  const current = (await row.innerText()).trim();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = row.getByRole("textbox", { name: `Rename ${current}` });
  await input.waitFor();
  await input.fill(next);
  return input;
}

const rowLabelIs = ({ target, label }: { target: string; label: string }) =>
  document
    .querySelector(`[data-parts-tree-target="${target}"]`)
    ?.textContent?.trim() === label;

export async function waitForRowLabel(
  page: Page,
  target: string,
  label: string,
) {
  return waitInPage(page, rowLabelIs, { target, label });
}

// ------------------------------------------------------------ pointer glides

export async function animationFrames(page: Page, count = 2) {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let remaining = count;
        const advance = () => {
          remaining -= 1;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(advance);
        };
        requestAnimationFrame(advance);
      }),
    count,
  );
}

/** A canvas point (main canvas coordinates) in page coordinates. */
export async function canvasPoint(page: Page, point: { x: number; y: number }) {
  const canvas = (await page.locator("main canvas").first().boundingBox())!;
  return { x: canvas.x + point.x, y: canvas.y + point.y };
}

/** The viewport surface (`__cadProjectToScreen` coordinates) box. */
export async function viewportSurface(page: Page) {
  const box = await page.getByTestId("cad-viewport").boundingBox();
  if (!box) throw new Error("Viewport surface is not visible.");
  return box;
}

export async function glideClickCanvas(
  page: Page,
  point: { x: number; y: number },
) {
  const at = await canvasPoint(page, point);
  await page.mouse.move(at.x, at.y, { steps: 8 });
  await animationFrames(page);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Glides the pointer onto a DOM control's centre once it is stable (the
 * untimed part of a gliding press; the caller's click is the gesture).
 */
export async function glideOnto(page: Page, control: Locator) {
  await control.waitFor({ timeout: SAMPLE_TIMEOUT_MS });
  await control.hover({ trial: true });
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 10,
  });
}

/** A gliding press on a DOM control (mirror-workbench.ts glidePress). */
export async function glidePress(page: Page, control: Locator) {
  await glideOnto(page, control);
  await control.click();
}

/**
 * The hover-search candidates around a target's projected point
 * (acceptance.ts regionSearchOffsets, rings only): the point itself, then
 * rings of 8…106 px, nearest first.
 */
function hoverSearchOffsets() {
  const offsets: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  [8, 16, 26, 38, 52, 68, 86, 106].forEach((radius, ring) => {
    const count = Math.max(8, Math.round((2 * Math.PI * radius) / 14));
    for (let k = 0; k < count; k += 1) {
      const angle = (2 * Math.PI * k) / count + ring * 0.37;
      offsets.push({
        x: Math.round(radius * Math.cos(angle)),
        y: Math.round(radius * Math.sin(angle)),
      });
    }
  });
  return offsets;
}
const HOVER_SEARCH_OFFSETS = hoverSearchOffsets();

export function hoverTarget(page: Page) {
  return debugStateField(page, "hoverTarget");
}

/**
 * Finds a viewport point (surface coordinates) where the hover target
 * satisfies `accept`, gliding over candidates around each of `ids`'
 * projected points (`__cadProjectToScreen`), as a user aims before a press.
 * Null when none of them is hoverable within `maxOffsets` candidates;
 * `seen` then counts the hover targets met on the way.
 */
export async function findHoverPoint(
  page: Page,
  ids: readonly string[],
  accept: (hovered: string, id: string) => boolean,
  maxOffsets = HOVER_SEARCH_OFFSETS.length,
  seen = new Map<string, number>(),
) {
  const surface = await viewportSurface(page);
  for (const id of ids) {
    const start = await page.evaluate(
      (id) =>
        (
          window as unknown as {
            __cadProjectToScreen?: (
              id: string,
            ) => { x: number; y: number } | null;
          }
        ).__cadProjectToScreen?.(id) ?? null,
      id,
    );
    if (!start) continue;
    for (const offset of HOVER_SEARCH_OFFSETS.slice(0, maxOffsets)) {
      const at = { x: start.x + offset.x, y: start.y + offset.y };
      if (
        at.x < 2 ||
        at.y < 2 ||
        at.x > surface.width - 2 ||
        at.y > surface.height - 2
      )
        continue;
      await page.mouse.move(surface.x + at.x, surface.y + at.y, { steps: 3 });
      await animationFrames(page);
      const hovered = await hoverTarget(page);
      seen.set(hovered, (seen.get(hovered) ?? 0) + 1);
      if (accept(hovered, id)) return { at, hovered };
    }
  }
  return null;
}

/** Glides onto a surface point and waits until the hover target is `expected`. */
export async function glideToHover(
  page: Page,
  at: { x: number; y: number },
  expected: string,
) {
  const surface = await viewportSurface(page);
  await page.mouse.move(surface.x + at.x, surface.y + at.y, { steps: 8 });
  await animationFrames(page);
  await waitInPage(page, debugStateContains, {
    field: "hoverTarget",
    text: expected,
  });
}

// ------------------------------------------------------------- timeline

/** The timeline button that double-click reopens, by its aria label. */
export const timelineEntry = (page: Page, ariaLabel: string) =>
  page.locator(`button[aria-label="${ariaLabel}"]`);

/** Deletes the last timeline items until only `count` remain (untimed). */
export async function deleteTimelineItemsAfter(page: Page, count: number) {
  while ((await page.evaluate(timelineCount)) > count) {
    const current = await page.evaluate(timelineCount);
    await timelineItems(page).last().click({ button: "right", force: true });
    const remove = page.getByRole("menuitem", { name: "Delete", exact: true });
    await remove.waitFor();
    await untimedHistoryAction(page, () => remove.click());
    await waitInPage(page, timelineCountChanged, {
      count: current,
      grew: false,
    });
    await waitForOccQuiet(page);
  }
}
