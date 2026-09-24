// Browser/worker smoke against one explicit staged directory; never serves the full package.
// Usage: node scripts/occ/smoke-custom-build.mjs /absolute/stage [results.json]
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

if (!process.argv[2])
  throw new Error("An explicit staged custom-asset directory is required");
const directory = resolve(process.argv[2]);
const resources = new Map([
  [
    "/cadara-occ.js",
    ["text/javascript", readFileSync(resolve(directory, "cadara-occ.js"))],
  ],
  [
    "/cadara-occ.wasm",
    ["application/wasm", readFileSync(resolve(directory, "cadara-occ.wasm"))],
  ],
  [
    "/conformance.mjs",
    [
      "text/javascript",
      readFileSync(new URL("./neutral-curve-conformance.mjs", import.meta.url)),
    ],
  ],
  [
    "/native-semantic.mjs",
    [
      "text/javascript",
      readFileSync(
        new URL("./native-semantic-conformance.mjs", import.meta.url),
      ),
    ],
  ],
  ["/", ["text/html", "<!doctype html><title>Staged OCC smoke</title>"]],
  [
    "/worker.mjs",
    [
      "text/javascript",
      `
    import init from '/cadara-occ.js';
    import { runNeutralCurveConformance } from '/conformance.mjs';
    import { runNativeSemanticDispatcherConformance } from '/native-semantic.mjs';
    try {
      const oc = await init({locateFile: path => '/' + path});
      postMessage({result: {
        semantic: runNeutralCurveConformance(oc),
        dispatcher: runNativeSemanticDispatcherConformance(oc),
      }});
    } catch (error) { postMessage({error: String(error), stack: error.stack}); }
  `,
    ],
  ],
]);
const server = createServer((request, response) => {
  const entry = resources.get(request.url);
  response.writeHead(entry ? 200 : 404, {
    "Content-Type": entry?.[0] ?? "text/plain",
    "Cache-Control": "no-store",
  });
  response.end(entry?.[1] ?? "Not found");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const { default: init } = await import("/cadara-occ.js");
    const { runNeutralCurveConformance } = await import("/conformance.mjs");
    const { runNativeSemanticDispatcherConformance } =
      await import("/native-semantic.mjs");
    const oc = await init({ locateFile: (path) => "/" + path });
    const main = {
      semantic: runNeutralCurveConformance(oc),
      dispatcher: runNativeSemanticDispatcherConformance(oc),
    };
    const worker = await new Promise((resolve, reject) => {
      const worker = new Worker("/worker.mjs", { type: "module" });
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("Worker smoke timed out"));
      }, 60_000);
      worker.onmessage = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result);
      };
      worker.onerror = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message));
      };
    });
    return { main, worker };
  });
  result.browser = browser.version();
  result.directory = directory;
  if (process.argv[3])
    writeFileSync(
      resolve(process.argv[3]),
      JSON.stringify(result, null, 2) + "\n",
    );
  console.log(JSON.stringify(result));
  if (
    result.main.semantic.summary.error ||
    result.main.dispatcher.summary.error ||
    result.worker.semantic.summary.error ||
    result.worker.dispatcher.summary.error
  ) {
    process.exitCode = 1;
  }
} finally {
  try {
    await browser?.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
