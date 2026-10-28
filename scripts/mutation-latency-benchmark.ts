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
// phases above and added `phaseBusyMs`; 4 added per-sample `metrics`,
// `stats.metrics` and the top-level `rankedCosts`), plus .cpuprofile files;
// the console prints the latency table, the ranked cost table (rows by the
// steady median of max(reflected, persisted, settled), with their dominant
// span phase), each row's phase medians and the profiled samples'
// per-thread phase busy time.
//
// This file is the orchestration (build/preview, context instrumentation,
// runRow, profiler, output); the rows live in
// scripts/mutation-latency-benchmark/rows-{document,feature,sketch,
// viewport}.ts on the shared plumbing of rows-shared.ts. Every row times
// the user's committing gesture (act) after setup work drained; reflected
// is the visible result, persisted the undo strip (or "none"); rows that
// clean up after the act record settled before that cleanup.
//   Document: rename, colour, variableEdit, undo/redo (of a rename), save
//   (download), variableAdd, reload (second open of the stored copy),
//   newDocument (File -> New; reopens the fixture untimed), peerWrite (a
//   second page on a local peer sync channel renames a body; reflected on
//   the first page), exportStep/exportStl (the body export dialog's Export
//   button; the File menu has no export).
//   Feature: extrudeDepth, depthUndo/depthRedo, featureAdd/featureDelete (a
//   plane), cursorMove, chamfer/fillet Preview/Commit (first edge with a
//   clean preview), extrudePreview/extrudeCommit (region of a new rectangle
//   sketch right of the model, picked in the viewport, else through the
//   debug selection: metric viaDebugSelect), shellPreview,
//   featureReopen/featureReopenCancel/featureSuppress/featureUnsuppress/
//   featureDeleteMid (the middle timeline feature), featureEditUndo (undo
//   of a committed literal-depth edit; FaceSketch variant with a face
//   sketch after it).
//   Sketch: sketchCreate/sketchDraw/sketchExit (Top plane),
//   sketchCreateOnFace/sketchExitFace (face picked in the viewport),
//   sketchExitUnchanged (first timeline sketch reopened; Face variant),
//   sketchEditUpstream (Exit after an untimed dimension edit: the publish
//   rebuilds the downstream features; until idle on a new revision) and
//   sketchDimensionEdit (the in-session Enter), both on the first visible
//   dimension chip of the first of 4 timeline sketches that shows one,
//   x1.1 (x0.9 when x1.1 loses bodies) then restored on alternate samples,
//   sketchConstraintAdd (Horizontal on a sloped line), sketchEntityDelete,
//   sketchUndo/sketchRedo (of a rectangle), sketchDragPoint (24-step drag
//   of a rectangle corner; per-move latency in metrics).
//   Viewport: selectBodyTree/selectFaceViewport/selectEdgeViewport (with the
//   Measure readout time in metrics), hoverViewport (30-step glide; per-step
//   hover latency), orbit (300 px right-button drag; frame intervals),
//   visibilityToggle (Parts & Objects eye).
//
// Run from the workspace root (Playwright's chromium must be installed, see
// README.md):
//   bun run bench:mutation -- --port 3121 --out-dir .scratch/bench-mutation/<run>
// Options: --runs N (steady samples, default 5), --fixtures a,b,
// --mutations a,b, --settle MS (idle wait after opening, default 1500),
// --profile-worst K (default 2, 0 disables), --skip-build, --no-minify
// (readable profiles; still a production-mode build), --dist DIR.
// PLAYWRIGHT_GPU=1 renders on the host GPU (Vulkan ANGLE) instead of
// SwiftShader. Every row after `save` in MUTATION_KINDS drives the debug
// platform (`window.__cadaraDebug`), which only a build with
// `import.meta.env.TEST = "true"` exposes; they are skipped otherwise:
//   SENTRY_AUTH_TOKEN= bunx vite build --config vite.offline-test.config.ts \
//     --minify false --outDir .scratch/bench-dist
//   bun run bench:mutation -- --skip-build --dist .scratch/bench-dist ...
import {
  chromium,
  type Browser,
  type BrowserContext,
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
  rankRowCosts,
  summarizeLatencies,
  summarizeMetrics,
  summarizeSpanPhases,
  type BenchmarkFrame,
  type BenchmarkSpan,
  type CpuProfile,
  type FramePhase,
  type LatencyStats,
  type SpanPhase,
} from "./mutation-latency-benchmark-summary.ts";
import {
  DOCUMENT_ROW_KINDS,
  prepareDocumentRow,
  type DocumentRowKind,
} from "./mutation-latency-benchmark/rows-document.ts";
import {
  FEATURE_ROW_KINDS,
  prepareFeatureRow,
  type FeatureRowKind,
} from "./mutation-latency-benchmark/rows-feature.ts";
import {
  hasDebugBridge,
  now,
  openFixture,
  round,
  OCC_QUIET_MS,
  OPEN_TIMEOUT_MS,
  type BenchmarkFixture,
  type ProfiledTarget,
  type RowPreparation,
  type SampleTiming,
  type Session,
  waitForRenderSettled,
} from "./mutation-latency-benchmark/rows-shared.ts";
import {
  SKETCH_ROW_KINDS,
  prepareSketchRow,
  type SketchRowKind,
} from "./mutation-latency-benchmark/rows-sketch.ts";
import {
  VIEWPORT_ROW_KINDS,
  prepareViewportRow,
  type ViewportRowKind,
} from "./mutation-latency-benchmark/rows-viewport.ts";

const RESULT_SCHEMA_VERSION = 4;
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
  // Every kind from here on reads the debug platform
  // (`window.__cadaraDebug`), which only a build with
  // `import.meta.env.TEST = "true"` exposes (vite.offline-test.config.ts).
  "sketchCreate",
  "sketchDraw",
  "sketchExit",
  "chamferPreview",
  "chamferCommit",
  "sketchCreateOnFace",
  "sketchExitFace",
  "sketchExitUnchanged",
  "sketchExitUnchangedFace",
  "sketchEditUpstream",
  "sketchDimensionEdit",
  "sketchConstraintAdd",
  "sketchEntityDelete",
  "sketchUndo",
  "sketchRedo",
  "sketchDragPoint",
  "extrudePreview",
  "extrudeCommit",
  "filletPreview",
  "filletCommit",
  "shellPreview",
  "featureReopen",
  "featureReopenCancel",
  "featureSuppress",
  "featureUnsuppress",
  "featureDeleteMid",
  "featureEditUndo",
  "featureEditUndoFaceSketch",
  "selectBodyTree",
  "selectFaceViewport",
  "selectEdgeViewport",
  "hoverViewport",
  "orbit",
  "visibilityToggle",
  "variableAdd",
  "reload",
  "newDocument",
  "peerWrite",
  "exportStep",
  "exportStl",
] as const satisfies readonly (
  | DocumentRowKind
  | FeatureRowKind
  | SketchRowKind
  | ViewportRowKind
)[];
type MutationKind = (typeof MUTATION_KINDS)[number];

/** The kinds that work without the debug platform (any production build). */
const PLATFORM_FREE_KINDS: ReadonlySet<MutationKind> = new Set([
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
]);
const DEBUG_BRIDGE_KINDS: ReadonlySet<string> = new Set(
  MUTATION_KINDS.filter((kind) => !PLATFORM_FREE_KINDS.has(kind)),
);

interface FixtureDefinition extends BenchmarkFixture {
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

const useGPU = process.env.PLAYWRIGHT_GPU === "1";
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
    // Bytes: length-delimited envelope items can be binary (replay).
    const body = route.request().postDataBuffer();
    if (body) {
      telemetry.release ??=
        /"release":"([^"]+)"/.exec(body.toString("utf8"))?.[1] ?? null;
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

/** Returns the per-sample runner, or a skip reason when the fixture cannot express the kind. */
function prepareMutation(
  session: Session,
  kind: MutationKind,
): Promise<RowPreparation> {
  if (isKindOf(DOCUMENT_ROW_KINDS, kind))
    return prepareDocumentRow(session, kind);
  if (isKindOf(FEATURE_ROW_KINDS, kind))
    return prepareFeatureRow(session, kind);
  if (isKindOf(SKETCH_ROW_KINDS, kind)) return prepareSketchRow(session, kind);
  if (isKindOf(VIEWPORT_ROW_KINDS, kind))
    return prepareViewportRow(session, kind);
  throw new Error(`No row family prepares ${kind}.`);
}

function isKindOf<Kind extends string>(
  kinds: readonly Kind[],
  kind: string,
): kind is Kind {
  return (kinds as readonly string[]).includes(kind);
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
    /** Steady medians of the samples' row-specific `metrics`. */
    metrics: Record<string, LatencyStats>;
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
    stats: {
      reflectedMs: null,
      persistedMs: null,
      settledMs: null,
      spans: {},
      metrics: {},
    },
  };
  if (kind === "variableEdit" && !fixture.variable) {
    row.skipped = "fixture has no benchmark variable";
    return row;
  }
  if (DEBUG_BRIDGE_KINDS.has(kind) && debugBridgeAvailable === false) {
    row.skipped =
      'needs a build with import.meta.env.TEST = "true" (vite.offline-test.config.ts)';
    return row;
  }
  const { context, page, telemetry } = await createInstrumentedContext(browser);
  const session: Session = {
    page,
    baseUrl,
    fixture,
    document,
    profiling: null,
  };
  const timings: (SampleTiming & { load: number[] })[] = [];
  const profiles: SampleProfile[] = [];
  try {
    row.openMs = round(
      await openFixture(page, baseUrl, fixture.name, document),
    );
    debugBridgeAvailable ??= await hasDebugBridge(page);
    if (DEBUG_BRIDGE_KINDS.has(kind) && !debugBridgeAvailable) {
      row.skipped =
        'needs a build with import.meta.env.TEST = "true" (vite.offline-test.config.ts)';
      return row;
    }
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
      // A row that cleans up after its act records settled before that
      // cleanup (settleBeforeCleanup); otherwise it is waited for here.
      const settledAt =
        timing.settledMs !== undefined
          ? timing.settledMs === null
            ? null
            : timing.startMs + timing.settledMs
          : await waitForRenderSettled(page, timing.startMs);
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
      metrics: summarizeMetrics(row.steady.map((sample) => sample.metrics)),
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
/** Whether the served build exposes `window.__cadaraDebug` (read on first open). */
let debugBridgeAvailable: boolean | null = null;

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
    // PLAYWRIGHT_GPU=1: Vulkan ANGLE on the host GPU, as playwright.config.ts.
    browser = await chromium.launch({
      channel: "chromium",
      args: [
        `--remote-debugging-port=${debugPort}`,
        ...(useGPU
          ? [
              "--use-angle=vulkan",
              "--enable-features=Vulkan",
              "--ignore-gpu-blocklist",
            ]
          : []),
      ],
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
      browser: {
        name: "chromium",
        version: browser.version(),
        headless: true,
        gpu: useGPU,
        debugBridge: debugBridgeAvailable,
      },
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
          "viewport data-render-idle set again (last transition after start); null when it never left idle; rows with untimed cleanup after the act record it before that cleanup, null while the act leaves an open sketch or feature dialog (render-idle needs an idle editor)",
        spans:
          "Sentry performance spans overlapping the sample window, clipped to it, by phase name; carriedInMs is the part from spans that started before the window. OCC worker client spans (op cad.occ.worker) are main-thread request->reply round trips including main-thread delivery delay, so their phase is 'OCC worker round trip (incl. main-thread delivery) <operation>'; per-thread CPU time inside a phase is profiles[].targets[].phaseBusyMs",
        frames:
          "Long Animation Frames (>50 ms) starting in the sample window; null when the frame log could not be read (row.errors); a reload sample only has the frames after the reload",
        metrics:
          "row-specific measurements per sample, named with their unit (selections: measureReadoutMs; hoverViewport: per-step hover latency; orbit: rAF frame intervals during the drag; sketchDragPoint: per-move solved-point latency), steady medians in stats.metrics",
        rankedCosts:
          "rows with steady samples, costliest first: steady median of each sample's max(reflected, persisted, settled), with the span phase of the largest steady median",
        profiles:
          "CPU profiles from the sample start to persisted (window in profiles[].window); per-target error when a target could not be profiled; profiles[].phases are the spans clipped to that window and targets[].phaseBusyMs the target's non-idle sampled CPU ms inside each phase's spans (profile ticks mapped to epoch by the narrowest Profiler.start call bracket, targets[].clock; profiles[].clockUncertaintyMs is that mapping's +- error; a sampler gap is credited as busy when its closing sample is non-idle)",
      },
      rankedCosts: rankRowCosts(rows),
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
    console.log(
      "[bench] ranked steady cost (median of max(reflected, persisted, settled))",
    );
    console.table(
      result.rankedCosts.map((cost) => ({
        fixture: cost.fixture,
        mutation: cost.mutation,
        steadyMedianMs: cost.steadyMedianMs,
        dominantPhase: cost.dominantPhase?.name ?? null,
        dominantPhaseMs: cost.dominantPhase?.medianMs ?? null,
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
