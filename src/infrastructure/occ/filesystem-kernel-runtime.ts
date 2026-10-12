import { readFile } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  createProductionOpenCascadeInitializerFromMainJS,
  type OpenCascadeInitializer,
} from "@/domain/modeling/occ/runtime";

/** Loads the same generated artifacts as the browser, without a web server. */
export async function loadFilesystemOpenCascadeFactory(
  assetDirectory = fileURLToPath(new URL("../../../public/", import.meta.url)),
): Promise<OpenCascadeInitializer> {
  const mainJSPath = resolve(assetDirectory, "cadara-occ.js");
  const mainWasmPath = resolve(assetDirectory, "cadara-occ.wasm");
  const mainJSUrl = pathToFileURL(mainJSPath).href;
  const [{ default: mainJS }, wasmBinary] = await Promise.all([
    import(/* @vite-ignore */ mainJSUrl),
    readFile(mainWasmPath),
  ]);
  if (typeof mainJS !== "function") {
    throw new Error(
      "Custom OpenCascade build did not expose a default initializer module.",
    );
  }
  const initialize = createProductionOpenCascadeInitializerFromMainJS(
    mainJS,
    () => mainWasmPath,
  );
  return (settings = {}) =>
    initialize({
      ...settings,
      module: { wasmBinary, ...settings.module },
    });
}
