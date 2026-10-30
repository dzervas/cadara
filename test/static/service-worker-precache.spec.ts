import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { expect, test } from "vitest";

import { createServiceWorkerPlugin } from "../../service-worker-plugin";
import { OCC_ASSET_BASE_PATH } from "../../src/infrastructure/occ/asset-version";

// Static lane (cadara-vk96): the shipped service worker's precache manifest,
// built by the production plugin (`service-worker-plugin.ts`) from the real
// `src/service-worker.ts`, must cover the whole offline app shell (HTML, every
// chunk including dedicated worker bundles, icons, fonts) and list the OCC
// kernel only under the exact versioned URLs the app requests. A tiny real
// build keeps this fast; the offline E2E lane (`test:e2e:offline`, outside
// `test:all`) proves the same worker in a browser.
test("the built service worker precaches the app shell and the kernel at its versioned URLs only", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cadara-sw-"));
  try {
    await mkdir(path.join(root, "public/icons"), { recursive: true });
    await writeFile(path.join(root, "public/icons/tool.svg"), "<svg/>");
    await writeFile(path.join(root, "public/cadara-occ.js"), "// kernel");
    await writeFile(path.join(root, "public/cadara-occ.wasm"), "kernel");
    await writeFile(path.join(root, "font.woff2"), "fixture font");
    await writeFile(
      path.join(root, "main.css"),
      '@font-face { font-family: fixture; src: url("./font.woff2"); }',
    );
    await writeFile(
      path.join(root, "main.js"),
      `import "./main.css";
import("./lazy.js");
new Worker(new URL("./kernel-worker.js", import.meta.url), { type: "module" });`,
    );
    await writeFile(path.join(root, "lazy.js"), 'console.log("lazy");');
    await writeFile(
      path.join(root, "kernel-worker.js"),
      'self.postMessage("worker");',
    );
    for (const name of ["index.html", "app.html"]) {
      await writeFile(
        path.join(root, name),
        '<script type="module" src="/main.js"></script>',
      );
    }
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [createServiceWorkerPlugin(path.resolve("src"))],
      build: {
        assetsInlineLimit: 0,
        rollupOptions: {
          input: [path.join(root, "index.html"), path.join(root, "app.html")],
        },
      },
    });

    const source = await readFile(
      path.join(root, "dist/service-worker.js"),
      "utf8",
    );
    const injected = source.match(/\[\{"(?:url|revision)":.*?\}\]/s);
    expect(injected, "the build injects its precache manifest").not.toBeNull();
    const manifest = JSON.parse(injected![0]) as {
      url: string;
      revision: string | null;
    }[];
    const urls = manifest.map((entry) => entry.url);

    expect(urls).toEqual(
      expect.arrayContaining(["index.html", "app.html", "icons/tool.svg"]),
    );
    const assets = await readdir(path.join(root, "dist/assets"));
    expect(
      assets.some((file) => /^kernel-worker-.*\.js$/.test(file)),
      "premise: the dedicated worker is its own bundle",
    ).toBe(true);
    expect(assets.some((file) => file.endsWith(".woff2"))).toBe(true);
    for (const file of assets) expect(urls).toContain(`assets/${file}`);

    // The app fetches /kernels/<content-version>/cadara-occ.{js,wasm}; only
    // that exact URL may be answered from the precache, so an old worker never
    // hands an old kernel to a newer app.
    expect(
      manifest
        .filter((entry) => entry.url.includes("cadara-occ"))
        .sort((a, b) => a.url.localeCompare(b.url)),
    ).toEqual([
      { url: `${OCC_ASSET_BASE_PATH.slice(1)}/cadara-occ.js`, revision: null },
      {
        url: `${OCC_ASSET_BASE_PATH.slice(1)}/cadara-occ.wasm`,
        revision: null,
      },
    ]);
    expect(manifest.filter((entry) => entry.url.startsWith("assets/"))).toEqual(
      expect.arrayContaining(
        assets.map((file) => ({ url: `assets/${file}`, revision: null })),
      ),
    );
    await expect(
      readFile(path.join(root, "dist/cadara-occ.wasm")),
    ).rejects.toThrow();
    expect(await readdir(path.join(root, "dist/kernels"))).toEqual([
      OCC_ASSET_BASE_PATH.split("/").at(-1),
    ]);

    // Asset growth must not silently return to a five-minute sequential install.
    await Promise.all(
      Array.from({ length: 201 }, (_, i) =>
        writeFile(
          path.join(root, `public/icons/tool-${i}.svg`),
          `<svg>${i}</svg>`,
        ),
      ),
    );
    await expect(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [createServiceWorkerPlugin(path.resolve("src"))],
        build: { rollupOptions: { input: path.join(root, "app.html") } },
      }),
    ).rejects.toThrow(/Offline install has .* requests; budget is 200/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
