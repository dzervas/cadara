// `bun run bench:mutation`: browser mutation latency on a PRODUCTION build
// (vite build + vite preview), driven through the workbench UI with
// Playwright. For every fixture x mutation kind it opens the fixture in a
// fresh browser context, times the first mutation after opening and then
// `--runs` steady-state repeats, and attributes each sample to phases using
// the product's own performance telemetry (the Sentry spans of the
// instrumented modeling service, OCC worker client and document repository,
// captured by intercepting the Sentry envelope requests so nothing leaves
// the machine) plus Long Animation Frame entries for main-thread rendering.
// The `OCC worker <operation>` spans time main-thread request -> reply round
// trips, not worker work: a reply also waits for the main thread, which in
// headless chromium (SwiftShader) spends ~200 ms blocks in native
// `(program)` time that Long Animation Frames do not report. Their phases
// are named `OCC worker round trip (incl. main-thread delivery) <operation>`.
// The worst rows are re-run with CPU profiles of the main thread and every
// dedicated worker (raw CDP, Target.setAutoAttach flatten); for those
// samples every target reports its CPU busy time inside each phase
// (`phaseBusyMs`), which separates OCC worker work from main-thread time.
// A sampler gap (a long tick delta under host load) counts as busy when its
// closing sample is non-idle, so busy time close to a span's duration may be
// partly starvation rather than observed CPU.
// Output: one results.json (shape in
// scripts/mutation-latency-benchmark-summary.ts), comparable across runs
// with the same schemaVersion (3 renamed the `OCC worker <operation>`
// phases above and added `phaseBusyMs`),
// plus .cpuprofile files; the console prints the latency table, each row's
// phase medians and the profiled samples' per-thread phase busy time.
//
// Run from the workspace root (Playwright's chromium must be installed, see
// README.md):
//   bun run bench:mutation -- --port 3121 --out-dir .scratch/bench-mutation/<run>
// Options: --runs N (steady samples, default 5), --fixtures a,b,
// --mutations a,b, --settle MS (idle wait after opening, default 1500),
// --profile-worst K (default 2, 0 disables), --skip-build, --no-minify
// (readable profiles; still a production-mode build), --dist DIR.
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Download,
  type FileChooser,
  type Page,
} from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
} from "node:fs";
import { cpus, hostname } from "node:os";
import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

import {
  attributeFrames,
  attributeProfileBusy,
  attributeSpans,
  parseSentryEnvelopeSpans,
  summarizeLatencies,
  summarizeSpanPhases,
  type BenchmarkFrame,
  type BenchmarkSpan,
  type CpuProfile,
  type FramePhase,
  type LatencyStats,
  type SpanPhase,
} from "./mutation-latency-benchmark-summary.ts";

const RESULT_SCHEMA_VERSION = 3;
const SAMPLE_TIMEOUT_MS = 120_000;
const OPEN_TIMEOUT_MS = 300_000;
// Past this the capture is too slow to prepare as a benchmark fixture.
const LARGE_IMPORT_TIMEOUT_MS = 600_000;

const MUTATION_KINDS = [
  "rename",
  "colour",
  "extrudeDepth",
  "variableEdit",
  "featureAdd",
  "featureDelete",
  "cursorMove",
  "undo",
  "redo",
  "depthUndo",
  "depthRedo",
  "save",
] as const;
type MutationKind = (typeof MUTATION_KINDS)[number];

interface FixtureDefinition {
  name: string;
  /** The document variable `variableEdit` changes, when the fixture has one. */
  variable: string | null;
  source: string;
  load: (browser: Browser) => Promise<Buffer>;
}

const { values: options } = parseArgs({
  options: {
    port: { type: "string", default: "4174" },
    runs: { type: "string", default: "5" },
    fixtures: { type: "string", default: "bracket,wheel,enclosure,large" },
    mutations: { type: "string", default: MUTATION_KINDS.join(",") },
    settle: { type: "string", default: "1500" },
    "profile-worst": { type: "string", default: "2" },
    "out-dir": { type: "string" },
    dist: { type: "string", default: "dist" },
    "skip-build": { type: "boolean", default: false },
    "no-minify": { type: "boolean", default: false },
  },
  allowPositionals: false,
});

const workspace = process.cwd();
if (!existsSync(resolve(workspace, "package.json"))) {
  throw new Error(
    `Run from the workspace root (${workspace} has no package.json).`,
  );
}

const port = Number(options.port);
const baseUrl = `http://127.0.0.1:${port}`;
const steadyRuns = Number(options.runs);
const settleMs = Number(options.settle);
const profileWorst = Number(options["profile-worst"]);
const distDir = resolve(workspace, options.dist);
const outDir = resolve(
  workspace,
  options["out-dir"] ??
    `.scratch/bench-mutation/${new Date().toISOString().replaceAll(":", "-")}`,
);
const fixtureCacheDir = resolve(workspace, ".scratch/bench-mutation/fixtures");
const selectedMutations = options.mutations.split(",").map((kind) => {
  if (!(MUTATION_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `Unknown mutation kind ${kind}; known: ${MUTATION_KINDS.join(", ")}.`,
    );
  }
  return kind as MutationKind;
});

const FIXTURES: Record<string, FixtureDefinition> = {
  bracket: landingFixture("bracket", null),
  wheel: landingFixture("wheel", null),
  enclosure: landingFixture("enclosure", "lidThickness"),
  // The largest single Part Studio among the tracked Onshape captures (24
  // parametric features, real document variables). There is no tracked
  // .cadara of that size, so it is imported once through the browser and
  // the saved document is cached under .scratch/bench-mutation/fixtures.
  large: {
    name: "large",
    variable: "columnDepth",
    source:
      "test/fixtures/onshape-captures/d3cd9b09c3c36af1dd2efae9.onshape-capture.json#Part Studio 1",
    load: (browser) =>
      loadImportedCaptureFixture(
        browser,
        "test/fixtures/onshape-captures/d3cd9b09c3c36af1dd2efae9.onshape-capture.json",
        "Part Studio 1",
      ),
  },
};

function landingFixture(
  name: string,
  variable: string | null,
): FixtureDefinition {
  const path = `landing/examples/${name}/model.cadara`;
  return {
    name,
    variable,
    source: path,
    load: async () => readFileSync(resolve(workspace, path)),
  };
}

const selectedFixtures = options.fixtures.split(",").map((name) => {
  const fixture = FIXTURES[name];
  if (!fixture) {
    throw new Error(
      `Unknown fixture ${name}; known: ${Object.keys(FIXTURES).join(", ")}.`,
    );
  }
  return fixture;
});

// ---------------------------------------------------------------- host

const now = () => performance.timeOrigin + performance.now();

function loadAverage() {
  return readFileSync("/proc/loadavg", "utf8")
    .split(" ")
    .slice(0, 3)
    .map(Number);
}

function countProcesses(pattern: string) {
  try {
    return Number(
      execFileSync("pgrep", ["-fc", pattern], { encoding: "utf8" }).trim(),
    );
  } catch {
    // pgrep exits 1 when nothing matches.
    return 0;
  }
}

function revision() {
  try {
    return execFileSync(
      "jj",
      [
        "--ignore-working-copy",
        "log",
        "--no-graph",
        "-r",
        "@",
        "-T",
        'change_id.short() ++ " " ++ commit_id.short() ++ " " ++ if(empty, "empty", "dirty")',
      ],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return null;
  }
}

// ------------------------------------------------------- build + preview

function buildProduction() {
  const args = ["vite", "build", "--outDir", distDir, "--emptyOutDir"];
  if (options["no-minify"]) args.push("--minify", "false");
  console.log(`[bench] bunx ${args.join(" ")}`);
  execFileSync("bunx", args, { stdio: ["ignore", "ignore", "inherit"] });
}

function startPreview(): ChildProcess {
  const log = openSync(resolve(outDir, "preview.log"), "w");
  // Own process group so the vite child of bunx is stopped with it.
  return spawn(
    "bunx",
    [
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
      "--outDir",
      distDir,
    ],
    { cwd: workspace, stdio: ["ignore", log, log], detached: true },
  );
}

async function waitForServer(url: string) {
  const deadline = Date.now() + 60_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch (error) {
      // Not listening yet.
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Preview server did not answer at ${url}.`, {
    cause: lastError,
  });
}

function stopPreview(server: ChildProcess) {
  if (server.pid === undefined || server.exitCode !== null) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch (error) {
    // ESRCH: the process group is already gone.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

// ------------------------------------------------------------ page probes

/** Per-context telemetry sink: Sentry spans arrive through the routed envelope requests. */
interface TelemetrySink {
  spans: BenchmarkSpan[];
  release: string | null;
}

async function createInstrumentedContext(browser: Browser): Promise<{
  context: BrowserContext;
  page: Page;
  telemetry: TelemetrySink;
}> {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
  });
  const telemetry: TelemetrySink = { spans: [], release: null };
  await context.route(/sentry\.io\//, async (route) => {
    const body = route.request().postData();
    if (body) {
      telemetry.release ??= /"release":"([^"]+)"/.exec(body)?.[1] ?? null;
      telemetry.spans.push(...parseSentryEnvelopeSpans(body));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await context.addInitScript(() => {
    const target = window as unknown as {
      __benchFrames: unknown[];
      __benchHistory: { atMs: number; signature: string }[];
      __benchRenderIdle: { atMs: number; idle: boolean }[];
      showOpenFilePicker?: unknown;
    };
    // The import flow must use the file chooser Playwright can drive.
    Object.defineProperty(window, "showOpenFilePicker", {
      value: undefined,
      configurable: true,
    });
    target.__benchFrames = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as LongAnimationFrame[]) {
        const scripts = entry.scripts.map((script) => ({
          name:
            script.invoker ||
            script.sourceFunctionName ||
            script.sourceURL ||
            "?",
          durationMs: script.duration,
        }));
        target.__benchFrames.push({
          startMs: performance.timeOrigin + entry.startTime,
          durationMs: entry.duration,
          blockingMs: entry.blockingDuration,
          renderMs:
            entry.renderStart > 0
              ? entry.startTime + entry.duration - entry.renderStart
              : 0,
          scriptMs: scripts.reduce(
            (total, script) => total + script.durationMs,
            0,
          ),
          scripts,
        });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
    interface LongAnimationFrame {
      startTime: number;
      duration: number;
      blockingDuration: number;
      renderStart: number;
      scripts: {
        invoker: string;
        sourceFunctionName: string;
        sourceURL: string;
        duration: number;
      }[];
    }
    // Every change of the undo/redo strip, timestamped when the DOM changed:
    // a mutation is persisted once its undoable action is listed.
    target.__benchHistory = [];
    // Viewport render-idle transitions (RenderIdleSignal: editor idle and
    // three stable frames), the end of geometry/material rebuild and upload.
    target.__benchRenderIdle = [];
    // OCC worker requests in flight (worker-protocol `invoke` until its
    // `invoked`/`failure` reply) and when the count last changed: samples
    // start once it has stayed 0 for a while, so preview/reopen/background
    // work triggered by setup never leaks into the timed window.
    // (`[data-render-idle]` cannot gate this: it needs machine state `idle`,
    // and an open feature inspector is `editingFeature`.)
    const occ = { inFlight: new Set<string>(), changedAtMs: 0 };
    (target as unknown as { __benchOcc: typeof occ }).__benchOcc = occ;
    const touch = () => {
      occ.changedAtMs = performance.timeOrigin + performance.now();
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent) => {
          const data = event.data as { kind?: string; requestId?: string };
          if (
            (data?.kind === "invoked" || data?.kind === "failure") &&
            occ.inFlight.delete(data.requestId!)
          ) {
            touch();
          }
        });
      }
      override postMessage(message: unknown, transfer?: unknown) {
        const data = message as { kind?: string; requestId?: string };
        if (data?.kind === "invoke" && data.requestId) {
          occ.inFlight.add(data.requestId);
          touch();
        }
        super.postMessage(message, transfer as Transferable[]);
      }
    };
    let last: string | null = null;
    let lastIdle: boolean | null = null;
    const record = () => {
      const idle = document.querySelector("[data-render-idle]") !== null;
      if (idle !== lastIdle) {
        lastIdle = idle;
        target.__benchRenderIdle.push({
          atMs: performance.timeOrigin + performance.now(),
          idle,
        });
      }
      const signature = Array.from(
        document.querySelectorAll("[data-history-action-direction]"),
        (entry) =>
          `${entry.getAttribute("data-history-action-direction")}:${entry.getAttribute("data-history-action-sequence")}`,
      ).join(",");
      if (signature === last) return;
      last = signature;
      target.__benchHistory.push({
        atMs: performance.timeOrigin + performance.now(),
        signature,
      });
    };
    document.addEventListener("DOMContentLoaded", () => {
      record();
      new MutationObserver(record).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "data-history-action-sequence",
          "data-history-action-direction",
          "data-render-idle",
        ],
      });
    });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    console.error(`[pageerror] ${error.message}`),
  );
  return { context, page, telemetry };
}

function historySignature(page: Page) {
  return page.evaluate(() => {
    const history = (
      window as unknown as { __benchHistory: { signature: string }[] }
    ).__benchHistory;
    return history.at(-1)?.signature ?? "";
  });
}

/** Epoch ms of the first history-strip change after `sinceMs` away from `before`. */
async function waitForHistoryChange(
  page: Page,
  before: string,
  sinceMs: number,
) {
  const handle = await page.waitForFunction(
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
  );
  return (await handle.jsonValue()) as number;
}

/**
 * Epoch ms when the viewport last became render-idle after `sinceMs`, once
 * it is idle; null when it never left idle (no viewport work).
 */
async function waitForRenderSettled(page: Page, sinceMs: number) {
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

/** Epoch ms when `predicate(arg)` first held, polled every 10 ms in the page. */
async function waitInPage<Arg>(
  page: Page,
  predicate: (arg: Arg) => boolean,
  arg: Arg,
) {
  const handle = await page.waitForFunction(
    ({ source, arg }) => {
      const check = new Function(`return (${source})`)() as (
        value: unknown,
      ) => boolean;
      return check(arg) ? performance.timeOrigin + performance.now() : false;
    },
    { source: predicate.toString(), arg },
    { polling: 10, timeout: SAMPLE_TIMEOUT_MS },
  );
  return (await handle.jsonValue()) as number;
}

// --------------------------------------------------------------- session

interface Session {
  page: Page;
  telemetry: TelemetrySink;
  fixture: FixtureDefinition;
  document: Buffer;
  /** Set by runRow for samples that are CPU-profiled (act -> persisted). */
  profiling: {
    profiler: Profiler;
    tag: string;
    directory: string;
  } | null;
}

interface NativeDocumentFeature {
  label: string;
  definition: {
    kind: string;
    parameters?: { extent?: { end?: { distance?: { source?: string } } } };
  };
}

/**
 * The last extrude whose depth is a literal: expression-bound depths are
 * read-only in the inspector (edited through variables instead).
 */
function lastLiteralDepthExtrude(document: Buffer) {
  const { features } = JSON.parse(document.toString("utf8")) as {
    features: NativeDocumentFeature[];
  };
  return features
    .filter(
      (feature) =>
        feature.definition.kind === "extrude" &&
        feature.definition.parameters?.extent?.end?.distance?.source ===
          "literal",
    )
    .at(-1)?.label;
}

async function openFixture(page: Page, name: string, document: Buffer) {
  await page.goto(`${baseUrl}/app`);
  const fileButton = page.getByRole("button", { name: "File", exact: true });
  await fileButton.waitFor({ timeout: OPEN_TIMEOUT_MS });
  await fileButton.click();
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
    .waitFor({ timeout: OPEN_TIMEOUT_MS });
  await page
    .getByRole("status", { name: "Initial model render pending" })
    .waitFor({ state: "detached", timeout: OPEN_TIMEOUT_MS });
  return now() - start;
}

interface SampleTiming {
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
  /** CPU profiles of this sample, taken from `startMs` to `profileEndMs`. */
  profile?: { profileEndMs: number; targets: ProfiledTarget[] };
}

const OCC_QUIET_MS = 300;

/** Waits until no OCC worker request has been in flight for OCC_QUIET_MS. */
async function waitForOccQuiet(page: Page) {
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
async function timedSample(
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

const partsTree = (page: Page) =>
  page.getByRole("complementary", { name: "Parts and objects" });
const timelineItems = (page: Page) =>
  page.locator(
    "button[data-history-feature-id], button[data-history-sketch-id]",
  );

async function firstBodyRow(page: Page) {
  const row = partsTree(page)
    .locator('[role="treeitem"][data-parts-tree-target^="body:"]')
    .first();
  const target = await row.getAttribute("data-parts-tree-target");
  return { target: target!, label: (await row.innerText()).trim() };
}

async function renameBody(session: Session, target: string, next: string) {
  const { page } = session;
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

async function waitForRowLabel(page: Page, target: string, label: string) {
  return waitInPage(page, rowLabelIs, { target, label });
}

/** Untimed rename used as setup for undo/redo rows. */
async function renameUntimed(session: Session, target: string, next: string) {
  const before = await historySignature(session.page);
  const since = now();
  const input = await renameBody(session, target, next);
  await input.press("Enter");
  await waitForRowLabel(session.page, target, next);
  await waitForHistoryChange(session.page, before, since);
}

const timelineCount = () =>
  document.querySelectorAll(
    "button[data-history-feature-id], button[data-history-sketch-id]",
  ).length;

async function addPlane(session: Session, timed: boolean) {
  const { page } = session;
  await page.locator('button[data-tool-id="plane"]').click();
  await partsTree(page)
    .locator('[data-parts-tree-target="construction:construction_plane-xy"]')
    .click();
  const commit = page.getByRole("button", { name: "Commit", exact: true });
  await commit.waitFor();
  await page.waitForFunction(
    () => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (element) => element.textContent?.trim() === "Commit",
      );
      return (
        button !== undefined &&
        !button.disabled &&
        button.getAttribute("data-disabled") !== "true"
      );
    },
    undefined,
    { polling: 10, timeout: SAMPLE_TIMEOUT_MS },
  );
  const countBefore = await page.evaluate(timelineCount);
  const act = () => commit.click();
  const reflected = () =>
    waitInPage(
      page,
      (count: number) =>
        document.querySelectorAll(
          "button[data-history-feature-id], button[data-history-sketch-id]",
        ).length > count,
      countBefore,
    );
  if (timed) return timedSample(session, act, reflected);
  const before = await historySignature(page);
  const since = now();
  await act();
  await reflected();
  await waitForHistoryChange(page, before, since);
  return null;
}

/**
 * Reopens the last literal-depth extrude and fills a new depth (10% deeper
 * than the opened document's, or that original); resolves to its Commit
 * button.
 */
function prepareDepthEdit(session: Session) {
  const { page } = session;
  const extrude = lastLiteralDepthExtrude(session.document);
  if (!extrude) return "no extrude with a literal depth";
  const label = `Select ${extrude}. Double-click to reopen.`;
  let original: number | null = null;
  return async (deeper: boolean) => {
    await page
      .getByRole("button", { name: label, exact: true })
      .dblclick({ force: true });
    const depth = page.locator("#extrude-depth");
    await depth.waitFor({ timeout: SAMPLE_TIMEOUT_MS });
    original ??= Number(await depth.inputValue());
    const next = deeper ? original * 1.1 : original;
    await depth.fill(String(Number(next.toFixed(4))));
    return page.getByRole("button", { name: "Commit", exact: true });
  };
}

async function waitForInspectorClosed(page: Page, inputId: string) {
  return waitInPage(
    page,
    (id: string) => document.getElementById(id) === null,
    inputId,
  );
}

// One sample per call; `index` 0 is the first mutation after opening.
type SampleRunner = (session: Session, index: number) => Promise<SampleTiming>;

/** Returns the per-sample runner, or a skip reason when the fixture cannot express the kind. */
async function prepareMutation(
  session: Session,
  kind: MutationKind,
): Promise<SampleRunner | string> {
  const { page } = session;
  switch (kind) {
    case "rename": {
      const body = await firstBodyRow(page);
      return async (_session, index) => {
        const next = `${body.label} r${index}`;
        const input = await renameBody(session, body.target, next);
        return timedSample(
          session,
          () => input.press("Enter"),
          () => waitForRowLabel(page, body.target, next),
        );
      };
    }
    case "colour": {
      const body = await firstBodyRow(page);
      const row = partsTree(page).locator(
        `[data-parts-tree-target="${body.target}"]`,
      );
      return async () => {
        await row.click({ button: "right" });
        const group = page.getByRole("group", { name: "Body color" });
        await group.waitFor();
        const swatch = group
          .locator('[role="menuitemradio"]:not([aria-checked="true"])')
          .first();
        const swatchName = (await swatch.getAttribute("aria-label"))!;
        // No DOM signal shows the applied appearance (the menu closes before
        // the mutation is dispatched), so reflected is null; the undo strip
        // still times persistence.
        const timing = await timedSample(session, () => swatch.click(), null);
        // Proof the colour was applied: the reopened menu checks the swatch.
        await row.click({ button: "right" });
        await page
          .getByRole("group", { name: "Body color" })
          .locator(
            `[role="menuitemradio"][aria-label="${swatchName}"][aria-checked="true"]`,
          )
          .waitFor({ timeout: SAMPLE_TIMEOUT_MS });
        await page.keyboard.press("Escape");
        await page
          .getByRole("group", { name: "Body color" })
          .waitFor({ state: "detached" });
        return timing;
      };
    }
    case "extrudeDepth": {
      const editDepth = prepareDepthEdit(session);
      if (typeof editDepth === "string") return editDepth;
      return async (_session, index) => {
        const commit = await editDepth(index % 2 === 0);
        return timedSample(
          session,
          () => commit.click(),
          () => waitForInspectorClosed(page, "extrude-depth"),
        );
      };
    }
    // Undo/Redo of a geometric change: the history restores the document
    // (cadara-jxe3), unlike the body rename that undo/redo time.
    case "depthUndo":
    case "depthRedo": {
      const editDepth = prepareDepthEdit(session);
      if (typeof editDepth === "string") return editDepth;
      const undoButton = page.locator('button[data-tool-id="undo"]');
      const redoButton = page.locator('button[data-tool-id="redo"]');
      const untimed = async (act: () => Promise<void>) => {
        const before = await historySignature(page);
        const since = now();
        await act();
        await waitForHistoryChange(page, before, since);
      };
      return async (_session, index) => {
        // Undo always returns to the original depth, so each edit deepens.
        const commit = await editDepth(kind === "depthUndo" || index % 2 === 0);
        await untimed(async () => {
          await commit.click();
          await waitForInspectorClosed(page, "extrude-depth");
        });
        if (kind === "depthUndo") {
          return timedSample(session, () => undoButton.click(), null);
        }
        await untimed(() => undoButton.click());
        return timedSample(session, () => redoButton.click(), null);
      };
    }
    case "variableEdit": {
      const name = session.fixture.variable!;
      await page.locator("[data-workbench-variables-fab]").click();
      const panel = page.locator("[data-workbench-variables-panel]");
      const editButton = panel.getByRole("button", {
        name: `Edit variable ${name}`,
      });
      await editButton.waitFor({ timeout: SAMPLE_TIMEOUT_MS });
      const variableId = await editButton
        .locator("xpath=ancestor::*[@data-variable-row][1]")
        .getAttribute("data-variable-row");
      const expression = panel.locator(
        `[data-variable-expression="${variableId}"]`,
      );
      const original = Number.parseFloat(await expression.innerText());
      return async (_session, index) => {
        const next = String(
          Number((index % 2 === 0 ? original * 1.1 : original).toFixed(4)),
        );
        await editButton.click();
        await page.keyboard.press("F2");
        const input = panel.getByLabel(`Variable value ${variableId}`);
        await input.evaluate((element, value) => {
          const setValue = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!;
          setValue.call(element, value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
        }, next);
        return timedSample(
          session,
          () => input.press("Enter"),
          () =>
            waitInPage(
              page,
              ({ id, value }: { id: string; value: string }) =>
                document
                  .querySelector(`[data-variable-expression="${id}"]`)
                  ?.textContent?.trim() === value,
              { id: variableId!, value: next },
            ),
        );
      };
    }
    case "featureAdd":
      return async () => (await addPlane(session, true))!;
    case "featureDelete":
      return async () => {
        await addPlane(session, false);
        const last = timelineItems(page).last();
        await last.click({ button: "right", force: true });
        const remove = page.getByRole("menuitem", {
          name: "Delete",
          exact: true,
        });
        await remove.waitFor();
        const countBefore = await page.evaluate(timelineCount);
        return timedSample(
          session,
          () => remove.click(),
          () =>
            waitInPage(
              page,
              (count: number) =>
                document.querySelectorAll(
                  "button[data-history-feature-id], button[data-history-sketch-id]",
                ).length < count,
              countBefore,
            ),
        );
      };
    case "cursorMove": {
      const count = await timelineItems(page).count();
      if (count < 2) return "timeline has fewer than two items";
      const cursor = page.locator('[aria-label^="Timeline cursor "]');
      return async (_session, index) => {
        const rollBack = index % 2 === 0;
        await timelineItems(page)
          .nth(rollBack ? count - 2 : 0)
          .click({ button: "right", force: true });
        const item = page.getByRole("menuitem", {
          name: rollBack ? "Roll History Here" : "Roll To End",
          exact: true,
        });
        await item.waitFor();
        const before = await cursor.getAttribute("aria-label");
        // Cursor moves are not undoable actions: no persisted signal in the UI.
        return timedSample(
          session,
          () => item.click(),
          () =>
            waitInPage(
              page,
              (label: string | null) =>
                document
                  .querySelector('[aria-label^="Timeline cursor "]')
                  ?.getAttribute("aria-label") !== label,
              before,
            ),
          "none",
        );
      };
    }
    case "undo":
    case "redo": {
      const body = await firstBodyRow(page);
      const undoButton = page.locator('button[data-tool-id="undo"]');
      const redoButton = page.locator('button[data-tool-id="redo"]');
      // The undone action is an untimed body rename before every sample.
      return async (_session, index) => {
        const row = partsTree(page).locator(
          `[data-parts-tree-target="${body.target}"]`,
        );
        const original = (await row.innerText()).trim();
        const renamed = `${body.label} u${index}`;
        await renameUntimed(session, body.target, renamed);
        if (kind === "undo") {
          return timedSample(
            session,
            () => undoButton.click(),
            () => waitForRowLabel(page, body.target, original),
          );
        }
        const before = await historySignature(page);
        const since = now();
        await undoButton.click();
        await waitForRowLabel(page, body.target, original);
        await waitForHistoryChange(page, before, since);
        return timedSample(
          session,
          () => redoButton.click(),
          () => waitForRowLabel(page, body.target, renamed),
        );
      };
    }
    case "save":
      return async () => {
        await page.getByRole("button", { name: "File", exact: true }).click();
        await page.getByRole("menuitem", { name: "Save As" }).click();
        const downloadCopy = page.getByRole("button", {
          name: "Download a copy",
        });
        await downloadCopy.waitFor();
        let download: Promise<Download> | null = null;
        let written: Promise<number> | null = null;
        // Reflected: the browser received the download; persisted: its file is written.
        return timedSample(
          session,
          async () => {
            download = page.waitForEvent("download", {
              timeout: SAMPLE_TIMEOUT_MS,
            });
            await downloadCopy.click();
          },
          async () => {
            const file = await download!;
            const receivedAt = now();
            written = file.path().then(() => now());
            return receivedAt;
          },
          () => written!,
        );
      };
  }
}

// ------------------------------------------------------------ CPU profiles

interface CdpTarget {
  type: string;
  url: string;
  /** Set when auto-attach / Profiler.enable failed: never profilable. */
  attachError?: string;
  /** Why the current profile window has no profile for this target. */
  startError?: string;
  /** Epoch ms when Profiler.start was sent and acknowledged. */
  startCall?: { sentMs: number; ackedMs: number };
}

/**
 * Maps profile timestamps to epoch: epochMs = us / 1000 + offsetMs. A profile
 * starts while its Profiler.start call is in flight, so the offset is known
 * to +-uncertaintyMs (half the call's round trip). All targets share the
 * host's monotonic clock, so a sample uses its narrowest target bracket.
 */
interface ProfileClock {
  offsetMs: number;
  uncertaintyMs: number;
}

type ProfiledTarget =
  | { type: string; url: string; error: string }
  | ({
      type: string;
      url: string;
      file: string;
      clock: ProfileClock;
      /** Set once the sample's spans arrived (runRow). */
      phaseBusyMs?: Record<string, number>;
    } & ReturnType<typeof summarizeProfile>);

type Profiler = Awaited<ReturnType<typeof connectProfiler>>;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message.split("\n")[0]! : String(error);

/** Raw CDP connection to the browser that auto-attaches pages and their dedicated workers. */
async function connectProfiler(debugPort: number) {
  const version = (await (
    await fetch(`http://127.0.0.1:${debugPort}/json/version`)
  ).json()) as {
    webSocketDebuggerUrl: string;
  };
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolveOpen) =>
    socket.addEventListener("open", resolveOpen, { once: true }),
  );
  const sessions = new Map<string, CdpTarget>();
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let nextId = 1;
  const send = (method: string, params: object = {}, sessionId?: string) => {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise<unknown>((resolveSend, rejectSend) =>
      pending.set(id, { resolve: resolveSend, reject: rejectSend }),
    );
  };
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      params?: { sessionId: string; targetInfo: CdpTarget & { type: string } };
      result?: unknown;
      error?: { message: string };
    };
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry?.reject(new Error(message.error.message));
      else entry?.resolve(message.result);
      return;
    }
    if (message.method === "Target.attachedToTarget" && message.params) {
      const { sessionId, targetInfo } = message.params;
      if (targetInfo.type !== "page" && targetInfo.type !== "worker") return;
      const target: CdpTarget = {
        type: targetInfo.type,
        url: targetInfo.url,
      };
      sessions.set(sessionId, target);
      void (async () => {
        await send(
          "Target.setAutoAttach",
          { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
          sessionId,
        );
        await send("Profiler.enable", {}, sessionId);
        await send(
          "Profiler.setSamplingInterval",
          { interval: 200 },
          sessionId,
        );
      })().catch((error: unknown) => {
        target.attachError = `attach: ${errorMessage(error)}`;
      });
    }
    if (message.method === "Target.detachedFromTarget" && message.params) {
      sessions.delete(message.params.sessionId);
    }
  });
  await send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  return {
    // Failures are kept per target and reported by stop(), never dropped.
    async start() {
      await Promise.all(
        [...sessions].map(async ([id, target]) => {
          target.startError = target.attachError;
          if (target.startError) return;
          try {
            const sentMs = now();
            await send("Profiler.start", {}, id);
            target.startCall = { sentMs, ackedMs: now() };
          } catch (error) {
            target.startError = `start: ${errorMessage(error)}`;
          }
        }),
      );
    },
    async stop(tag: string, directory: string): Promise<ProfiledTarget[]> {
      return Promise.all(
        [...sessions].map(async ([id, target], index) => {
          const { type, url } = target;
          if (target.startError) return { type, url, error: target.startError };
          let profile: CpuProfile;
          try {
            ({ profile } = (await send("Profiler.stop", {}, id)) as {
              profile: CpuProfile;
            });
          } catch (error) {
            return { type, url, error: `stop: ${errorMessage(error)}` };
          }
          const file = `${tag}-${type}-${index}-${basename(url.split("?")[0]!)
            .replace(/[^\w.-]/g, "_")
            .slice(0, 40)}.cpuprofile`;
          writeFileSync(resolve(directory, file), JSON.stringify(profile));
          const { sentMs, ackedMs } = target.startCall!;
          const clock = {
            offsetMs: (sentMs + ackedMs) / 2 - profile.startTime / 1000,
            uncertaintyMs: round((ackedMs - sentMs) / 2),
          };
          return { type, url, file, clock, ...summarizeProfile(profile) };
        }),
      );
    },
    close() {
      socket.close();
    },
  };
}

function summarizeProfile(profile: CpuProfile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfMs = new Map<string, number>();
  let busyMs = 0;
  profile.samples.forEach((nodeId, index) => {
    const frame = nodes.get(nodeId)!.callFrame;
    if (frame.functionName === "(idle)") return;
    const ms = (profile.timeDeltas[index] ?? 0) / 1000;
    busyMs += ms;
    const key = `${frame.functionName || "(anonymous)"} ${basename(frame.url.split("?")[0]!)}:${frame.lineNumber + 1}`;
    selfMs.set(key, (selfMs.get(key) ?? 0) + ms);
  });
  return {
    busyMs: round(busyMs),
    topSelf: [...selfMs]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 15)
      .map(([name, ms]) => ({ name, ms: round(ms) })),
  };
}

// ----------------------------------------------------------------- fixtures

async function loadImportedCaptureFixture(
  browser: Browser,
  capturePath: string,
  studio: string,
) {
  const captureBytes = readFileSync(resolve(workspace, capturePath));
  const digest = createHash("sha256")
    .update(captureBytes)
    .update(studio)
    .digest("hex")
    .slice(0, 16);
  const cached = resolve(
    fixtureCacheDir,
    `${basename(capturePath, ".onshape-capture.json")}-${digest}.cadara`,
  );
  if (existsSync(cached)) return readFileSync(cached);
  console.log(
    `[bench] importing ${capturePath} (${studio}) once; cached at ${cached}`,
  );
  const bundle = JSON.parse(captureBytes.toString("utf8")) as {
    partStudios: { name: string }[];
  };
  const selected = {
    ...bundle,
    partStudios: bundle.partStudios.filter((entry) => entry.name === studio),
  };
  const { context, page } = await createInstrumentedContext(browser);
  try {
    await page.goto(`${baseUrl}/app`);
    await page
      .getByRole("button", { name: "File", exact: true })
      .waitFor({ timeout: OPEN_TIMEOUT_MS });
    // Import refuses ("The current document is still loading.") until the
    // startup document is ready, which has no other UI signal: retry.
    let chooser: FileChooser | null = null;
    for (let attempt = 0; attempt < 60 && !chooser; attempt += 1) {
      const chooserPromise = page
        .waitForEvent("filechooser", { timeout: 2_000 })
        .catch(() => null);
      await page.locator('button[data-tool-id="import"]').click();
      chooser = await chooserPromise;
    }
    if (!chooser) throw new Error("The import file chooser never opened.");
    await chooser.setFiles({
      name: basename(capturePath),
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(selected)),
    });
    const commit = page.getByRole("button", { name: "Commit", exact: true });
    await commit.waitFor({ timeout: LARGE_IMPORT_TIMEOUT_MS });
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).some(
          (button) =>
            button.textContent?.trim() === "Commit" && !button.disabled,
        ),
      undefined,
      { timeout: LARGE_IMPORT_TIMEOUT_MS, polling: 500 },
    );
    await commit.click();
    await commit.waitFor({
      state: "detached",
      timeout: LARGE_IMPORT_TIMEOUT_MS,
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[data-history-action-direction]").length > 0,
      undefined,
      { timeout: LARGE_IMPORT_TIMEOUT_MS, polling: 500 },
    );
    await page.getByRole("button", { name: "File", exact: true }).click();
    const downloadPromise = page.waitForEvent("download", {
      timeout: OPEN_TIMEOUT_MS,
    });
    await page.getByRole("menuitem", { name: "Save As" }).click();
    await page.getByRole("button", { name: "Download a copy" }).click();
    const download = await downloadPromise;
    const bytes = readFileSync((await download.path())!);
    mkdirSync(fixtureCacheDir, { recursive: true });
    writeFileSync(cached, bytes);
    return bytes;
  } finally {
    await context.close();
  }
}

// --------------------------------------------------------------------- run

interface SampleResult extends SampleTiming {
  load: number[];
  spans: Record<string, SpanPhase>;
  /** Null when the page's frame log could not be read (see row.errors). */
  frames: FramePhase | null;
}

interface RowResult {
  fixture: string;
  mutation: MutationKind;
  skipped: string | null;
  error: string | null;
  /** Measurement failures that did not stop the row. */
  errors: string[];
  openMs: number | null;
  first: SampleResult | null;
  steady: SampleResult[];
  stats: {
    reflectedMs: LatencyStats | null;
    persistedMs: LatencyStats | null;
    settledMs: LatencyStats | null;
    spans: Record<string, LatencyStats>;
  };
  profiles?: SampleProfile[];
}

interface SampleProfile {
  sample: "first" | "steady";
  window: { startMs: number; endMs: number };
  targets: ProfiledTarget[];
  /** Spans clipped to the profile window: the denominator of `phaseBusyMs`. */
  phases?: Record<string, SpanPhase>;
  /** Uncertainty of the profile -> epoch mapping used for `phaseBusyMs`. */
  clockUncertaintyMs?: number;
}

interface RowOptions {
  profiler?: Profiler;
  profileDirectory?: string;
  sampleCount: number;
}

async function runRow(
  browser: Browser,
  fixture: FixtureDefinition,
  document: Buffer,
  kind: MutationKind,
  rowOptions: RowOptions,
): Promise<RowResult> {
  const row: RowResult = {
    fixture: fixture.name,
    mutation: kind,
    skipped: null,
    error: null,
    errors: [],
    openMs: null,
    first: null,
    steady: [],
    stats: { reflectedMs: null, persistedMs: null, settledMs: null, spans: {} },
  };
  if (kind === "variableEdit" && !fixture.variable) {
    row.skipped = "fixture has no benchmark variable";
    return row;
  }
  const { context, page, telemetry } = await createInstrumentedContext(browser);
  const session: Session = {
    page,
    telemetry,
    fixture,
    document,
    profiling: null,
  };
  const timings: (SampleTiming & { load: number[] })[] = [];
  const profiles: SampleProfile[] = [];
  try {
    row.openMs = round(await openFixture(page, fixture.name, document));
    await delay(settleMs);
    const runner = await prepareMutation(session, kind);
    if (typeof runner === "string") {
      row.skipped = runner;
      return row;
    }
    for (let index = 0; index < rowOptions.sampleCount; index += 1) {
      // Profiled re-runs capture the first sample and the last steady one.
      const sample = index === 0 ? "first" : "steady";
      session.profiling =
        rowOptions.profiler &&
        (index === 0 || index === rowOptions.sampleCount - 1)
          ? {
              profiler: rowOptions.profiler,
              tag: `${fixture.name}-${kind}-${sample}`,
              directory: rowOptions.profileDirectory!,
            }
          : null;
      const { profile, ...timing } = await runner(session, index);
      const load = loadAverage();
      // Let late Sentry envelopes, frames and viewport work of this sample arrive.
      await delay(500);
      const settledAt = await waitForRenderSettled(page, timing.startMs);
      if (profile) {
        profiles.push({
          sample,
          window: { startMs: timing.startMs, endMs: profile.profileEndMs },
          targets: profile.targets,
        });
      }
      timings.push({
        ...timing,
        settledMs:
          settledAt === null ? null : round(settledAt - timing.startMs),
        endMs: Math.max(timing.endMs, settledAt ?? 0),
        load,
      });
    }
  } catch (error) {
    row.error = errorMessage(error);
    const screenshot = resolve(outDir, `failure-${fixture.name}-${kind}.png`);
    // Best effort: the row error above is the evidence, the image is a hint.
    await page.screenshot({ path: screenshot }).catch((screenshotError) => {
      console.error(
        `[bench] ${fixture.name} ${kind}: failure screenshot not written: ${errorMessage(screenshotError)}`,
      );
    });
  } finally {
    let frames: BenchmarkFrame[] | null = null;
    try {
      frames = await page.evaluate(
        () =>
          (window as unknown as { __benchFrames: BenchmarkFrame[] })
            .__benchFrames,
      );
    } catch (error) {
      row.errors.push(`frames unavailable: ${errorMessage(error)}`);
    }
    const samples = timings.map((timing) => ({
      ...timing,
      spans: attributeSpans(telemetry.spans, timing),
      frames: frames && attributeFrames(frames, timing),
    }));
    row.first = samples[0] ?? null;
    row.steady = samples.slice(1);
    row.stats = {
      reflectedMs: summarizeLatencies(
        row.steady.flatMap((sample) => sample.reflectedMs ?? []),
      ),
      persistedMs: summarizeLatencies(
        row.steady.flatMap((sample) => sample.persistedMs ?? []),
      ),
      settledMs: summarizeLatencies(
        row.steady.flatMap((sample) => sample.settledMs ?? []),
      ),
      spans: summarizeSpanPhases(row.steady.map((sample) => sample.spans)),
    };
    for (const profile of profiles) {
      profile.phases = attributeSpans(telemetry.spans, profile.window);
      const profiled = profile.targets.flatMap((target) =>
        "file" in target ? [target] : [],
      );
      const clock = profiled
        .map((target) => target.clock)
        .sort((left, right) => left.uncertaintyMs - right.uncertaintyMs)[0];
      if (!clock) continue;
      profile.clockUncertaintyMs = clock.uncertaintyMs;
      for (const target of profiled) {
        const cpuProfile = JSON.parse(
          readFileSync(
            resolve(rowOptions.profileDirectory!, target.file),
            "utf8",
          ),
        ) as CpuProfile;
        target.phaseBusyMs = attributeProfileBusy(
          telemetry.spans,
          profile.window,
          cpuProfile,
          clock.offsetMs,
        );
      }
    }
    if (profiles.length > 0) row.profiles = profiles;
    releaseInfo ??= telemetry.release;
    await context.close();
  }
  return row;
}
let releaseInfo: string | null = null;

function round(value: number) {
  return Math.round(value * 10) / 10;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const loadStart = loadAverage();
  const vitestProcessesAtStart = countProcesses("vitest");
  if (!options["skip-build"]) buildProduction();
  if (!existsSync(resolve(distDir, "app.html"))) {
    throw new Error(
      `${distDir}/app.html is missing: build first or drop --skip-build.`,
    );
  }
  const server = startPreview();
  const debugPort = 9300 + Math.floor(Math.random() * 500);
  let browser: Browser | null = null;
  const rows: RowResult[] = [];
  try {
    await waitForServer(`${baseUrl}/app`);
    // Full chromium (new headless): the headless shell aborts in its font manager on menus.
    browser = await chromium.launch({
      channel: "chromium",
      args: [`--remote-debugging-port=${debugPort}`],
    });
    const documents = new Map<string, Buffer>();
    for (const fixture of selectedFixtures) {
      documents.set(fixture.name, await fixture.load(browser));
      for (const kind of selectedMutations) {
        const row = await runRow(
          browser,
          fixture,
          documents.get(fixture.name)!,
          kind,
          { sampleCount: steadyRuns + 1 },
        );
        rows.push(row);
        console.log(
          `[bench] ${fixture.name} ${kind}: ${row.skipped ? `skipped (${row.skipped})` : row.error ? `error ${row.error}` : `first ${row.first?.reflectedMs}/${row.first?.persistedMs}/${row.first?.settledMs} ms, steady median ${row.stats.reflectedMs?.median}/${row.stats.persistedMs?.median}/${row.stats.settledMs?.median} ms (reflected/persisted/settled)`}`,
        );
      }
    }

    const profiledRows = [];
    if (profileWorst > 0) {
      const profileDirectory = resolve(outDir, "profiles");
      mkdirSync(profileDirectory, { recursive: true });
      const profiler = await connectProfiler(debugPort);
      const worst = rows
        .filter((row) => row.first && !row.error)
        .sort((left, right) => worstLatency(right) - worstLatency(left))
        .slice(0, profileWorst);
      for (const row of worst) {
        const fixture = FIXTURES[row.fixture]!;
        const profiled = await runRow(
          browser,
          fixture,
          documents.get(fixture.name)!,
          row.mutation,
          {
            profiler,
            profileDirectory,
            sampleCount: 3,
          },
        );
        profiledRows.push(profiled);
        console.log(`[bench] profiled ${row.fixture} ${row.mutation}`);
      }
      profiler.close();
    }

    const result = {
      schemaVersion: RESULT_SCHEMA_VERSION,
      tool: "bench:mutation",
      startedAt,
      finishedAt: new Date().toISOString(),
      revision: revision(),
      release: releaseInfo,
      build: {
        dist: distDir,
        minify: !options["no-minify"],
        built: !options["skip-build"],
      },
      browser: { name: "chromium", version: browser.version(), headless: true },
      host: {
        hostname: hostname(),
        cpus: cpus().length,
        loadStart,
        loadEnd: loadAverage(),
        vitestProcessesAtStart,
      },
      config: {
        steadyRuns,
        settleMs,
        fixtures: selectedFixtures.map((fixture) => ({
          name: fixture.name,
          source: fixture.source,
          variable: fixture.variable,
        })),
        mutations: selectedMutations,
        sampleStart: `the clock starts once no OCC worker request has been in flight for ${OCC_QUIET_MS} ms (setup work such as reopen/preview/background refinement drained; idleWaitMs is that wait)`,
        reflected:
          "UI shows the result (per-kind DOM predicate, 10 ms polling); colour: null, no DOM signal shows the applied appearance (the menu closes before the mutation is dispatched), applied colour is checked afterwards by the reopened menu's checked swatch",
        persisted:
          "undo strip lists the action (MutationObserver timestamp); save: download file written; null when not undoable",
        settled:
          "viewport data-render-idle set again (last transition after start); null when it never left idle",
        spans:
          "Sentry performance spans overlapping the sample window, clipped to it, by phase name; carriedInMs is the part from spans that started before the window. OCC worker client spans (op cad.occ.worker) are main-thread request->reply round trips including main-thread delivery delay, so their phase is 'OCC worker round trip (incl. main-thread delivery) <operation>'; per-thread CPU time inside a phase is profiles[].targets[].phaseBusyMs",
        frames:
          "Long Animation Frames (>50 ms) starting in the sample window; null when the frame log could not be read (row.errors)",
        profiles:
          "CPU profiles from the sample start to persisted (window in profiles[].window); per-target error when a target could not be profiled; profiles[].phases are the spans clipped to that window and targets[].phaseBusyMs the target's non-idle sampled CPU ms inside each phase's spans (profile ticks mapped to epoch by the narrowest Profiler.start call bracket, targets[].clock; profiles[].clockUncertaintyMs is that mapping's +- error; a sampler gap is credited as busy when its closing sample is non-idle)",
      },
      rows,
      profiledRows,
    };
    writeFileSync(
      resolve(outDir, "results.json"),
      `${JSON.stringify(result, null, 1)}\n`,
    );
    console.table(
      rows.map((row) => ({
        fixture: row.fixture,
        mutation: row.mutation,
        open: row.openMs,
        first: row.first?.persistedMs ?? row.skipped ?? row.error,
        reflectedMedian: row.stats.reflectedMs?.median,
        persistedMedian: row.stats.persistedMs?.median,
        persistedP95: row.stats.persistedMs?.p95,
        settledMedian: row.stats.settledMs?.median,
      })),
    );
    for (const row of rows) printPhases(row, "");
    for (const row of profiledRows) printPhases(row, "profiled re-run ");
    console.log(`[bench] wrote ${resolve(outDir, "results.json")}`);
  } finally {
    await browser?.close();
    stopPreview(server);
  }
}

/**
 * The row's steady phase medians (span time) and, for profiled samples, each
 * phase's span time beside every profiled thread's CPU busy time inside it.
 */
function printPhases(row: RowResult, label: string) {
  if (Object.keys(row.stats.spans).length > 0) {
    console.log(
      `[bench] ${label}${row.fixture} ${row.mutation} phases (steady median span ms)`,
    );
    console.table(
      Object.fromEntries(
        Object.entries(row.stats.spans).map(([name, stats]) => [
          name,
          stats.median,
        ]),
      ),
    );
  }
  for (const profile of row.profiles ?? []) {
    const targetLabel = (target: ProfiledTarget) =>
      `${target.type === "page" ? "main thread" : basename(target.url.split("?")[0]!)} busy`;
    console.log(
      `[bench] ${label}${row.fixture} ${row.mutation} ${profile.sample} sample (profiled, ${round(profile.window.endMs - profile.window.startMs)} ms window, ms): ${profile.targets
        .map(
          (target) =>
            `${targetLabel(target)} ${"busyMs" in target ? target.busyMs : target.error}`,
        )
        .join(
          "; ",
        )}; profile clock +-${profile.clockUncertaintyMs ?? "n/a"} ms`,
    );
    console.table(
      Object.fromEntries(
        Object.entries(profile.phases ?? {}).map(([name, phase]) => [
          name,
          {
            span: phase.totalMs,
            ...Object.fromEntries(
              profile.targets.map((target) => [
                targetLabel(target),
                "phaseBusyMs" in target
                  ? (target.phaseBusyMs?.[name] ?? 0)
                  : null,
              ]),
            ),
          },
        ]),
      ),
    );
  }
}

function worstLatency(row: RowResult) {
  const sampleEnd = (sample: SampleResult) =>
    Math.max(
      sample.reflectedMs ?? 0,
      sample.persistedMs ?? 0,
      sample.settledMs ?? 0,
    );
  return Math.max(
    row.first ? sampleEnd(row.first) : 0,
    ...row.steady.map(sampleEnd),
  );
}

await main();
