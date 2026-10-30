import { OccKernelVersionRetiredError } from "@/infrastructure/occ/kernel-version-retired";

export interface EngineDownloadProgress {
  completedBytes: number;
  totalBytes: number;
}

/** A download finishing sooner (precache, HTTP cache) reports nothing. */
const FIRST_REPORT_AFTER_MS = 500;
const REPORT_INTERVAL_MS = 100;

/**
 * Emscripten's Module.instantiateWasm hook, counting decoded wasm bytes while
 * keeping streaming compilation (cadara-5hlf). The shipped glue cannot observe
 * an async hook failure, so it rejects `failure` instead; the initializer
 * races its ready promise against it.
 */
export function createEngineDownloadInstantiateWasm({
  url,
  totalBytes,
  onProgress,
}: {
  url: string;
  totalBytes: number;
  onProgress: (progress: EngineDownloadProgress) => void;
}) {
  let rejectFailure!: (error: unknown) => void;
  const failure = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });

  async function instantiate(imports: WebAssembly.Imports) {
    const startedAt = Date.now();
    const response = await fetch(url, { credentials: "same-origin" });
    if (response.status === 404) throw new OccKernelVersionRetiredError();
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download the geometry engine: ${response.status} ${url}`);
    }
    let completedBytes = 0;
    let lastReportAt: number | null = null;
    const counted = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          completedBytes += chunk.byteLength;
          const now = Date.now();
          // Beyond the build-time total the numbers would be invented.
          if (
            completedBytes <= totalBytes &&
            now - startedAt >= FIRST_REPORT_AFTER_MS &&
            (lastReportAt === null || now - lastReportAt >= REPORT_INTERVAL_MS)
          ) {
            lastReportAt = now;
            onProgress({ completedBytes, totalBytes });
          }
          controller.enqueue(chunk);
        },
        flush() {
          if (lastReportAt === null) return;
          onProgress({ completedBytes: Math.min(completedBytes, totalBytes), totalBytes });
        },
      }),
    );
    return WebAssembly.instantiateStreaming(
      new Response(counted, { headers: { "Content-Type": "application/wasm" } }),
      imports,
    );
  }

  return {
    failure,
    instantiateWasm(
      imports: WebAssembly.Imports,
      receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) {
      instantiate(imports)
        .then(({ instance, module }) => receiveInstance(instance, module))
        .catch(rejectFailure);
      return {};
    },
  };
}
