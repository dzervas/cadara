import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createEngineDownloadInstantiateWasm,
  type EngineDownloadProgress,
} from "./engine-download";
import { OccKernelVersionRetiredError } from "./kernel-version-retired";

// A valid 100-byte module: the header plus one custom section of padding.
const wasm = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x00, 90, 0x01, 0x78, ...new Array<number>(88).fill(0),
]);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Serves `bytes` in 10-byte chunks, one per `chunkDelayMs`. */
function stubFetch(
  bytes: Uint8Array,
  chunkDelayMs: number,
  { status = 200, failAfterChunks = Infinity } = {},
) {
  let offset = 0;
  let chunks = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
      if (chunks++ >= failAfterChunks) {
        controller.error(new Error("connection reset"));
      } else if (offset >= bytes.length) {
        controller.close();
      } else {
        controller.enqueue(bytes.slice(offset, offset + 10));
        offset += 10;
      }
    },
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
}

async function download(totalBytes = wasm.length) {
  const progress: EngineDownloadProgress[] = [];
  const received: WebAssembly.Instance[] = [];
  const hook = createEngineDownloadInstantiateWasm({
    url: "/cadara-occ.wasm?v=test",
    totalBytes,
    onProgress: (value) => progress.push(value),
  });
  let failure: unknown = null;
  hook.failure.catch((error: unknown) => {
    failure = error;
  });
  expect(hook.instantiateWasm({}, (instance) => received.push(instance))).toEqual({});
  for (let step = 0; step < 100 && received.length === 0 && failure === null; step += 1) {
    await vi.advanceTimersByTimeAsync(10);
  }
  return { progress, received, failure };
}

test("a download finishing within 500 ms reports nothing and instantiates once", async () => {
  stubFetch(wasm, 40);
  const { progress, received, failure } = await download();
  expect(failure).toBeNull();
  expect(received).toHaveLength(1);
  expect(received[0]).toBeInstanceOf(WebAssembly.Instance);
  expect(progress).toEqual([]);
});

test("a slow download reports monotonic bytes at most every 100 ms, then a final message", async () => {
  stubFetch(wasm, 60);
  const { progress, received, failure } = await download();
  expect(failure).toBeNull();
  expect(received).toHaveLength(1);
  // Chunks land every 60 ms: first report at the 9th chunk (540 ms), then
  // every other chunk; the 10th chunk is skipped (60 ms after the last).
  expect(progress).toEqual([
    { completedBytes: 90, totalBytes: 100 },
    { completedBytes: 100, totalBytes: 100 },
  ]);
});

test("bytes beyond the build-time total are not reported", async () => {
  stubFetch(wasm, 60);
  const { progress, received } = await download(95);
  expect(received).toHaveLength(1);
  expect(progress).toEqual([
    { completedBytes: 90, totalBytes: 95 },
    { completedBytes: 95, totalBytes: 95 },
  ]);
});

test("a non-ok response, a stream error and a compile error reject the failure promise", async () => {
  stubFetch(wasm, 10, { status: 503 });
  const unavailable = await download();
  expect(String(unavailable.failure)).toContain("Failed to download the geometry engine: 503");

  stubFetch(wasm, 10, { failAfterChunks: 3 });
  const reset = await download();
  expect(reset.received).toEqual([]);
  expect(reset.failure).toBeTruthy();

  stubFetch(new Uint8Array(100).fill(7), 10);
  const invalid = await download();
  expect(invalid.received).toEqual([]);
  expect(invalid.failure).toBeInstanceOf(WebAssembly.CompileError);
});

// A deploy publishes only its own kernel directory, so a 404 on this tab's
// versioned URL means the tab is out of date, not that the download broke.
test("a 404 on the versioned kernel URL rejects with the retired-kernel error", async () => {
  stubFetch(wasm, 10, { status: 404 });
  const notFound = await download();
  expect(notFound.received).toEqual([]);
  expect(notFound.failure).toBeInstanceOf(OccKernelVersionRetiredError);
});
