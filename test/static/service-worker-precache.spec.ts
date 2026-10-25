import {
  copyFile,
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
import { afterAll, beforeAll, expect, test } from "vitest";

import { createServiceWorkerPlugin } from "../../service-worker-plugin";
import { OCC_ASSET_BASE_PATH } from "../../src/infrastructure/occ/asset-version";
import { workbenchColors } from "../../src/theme/workbench-theme";

// Static lane (cadara-vk96): the shipped service worker's precache manifest,
// built by the production plugin (`service-worker-plugin.ts`) from the real
// `src/service-worker.ts`, must cover the whole offline app shell (HTML, every
// chunk including dedicated worker bundles, icons, fonts) and list the OCC
// kernel only under the exact versioned URLs the app requests. A tiny real
// build keeps this fast; the offline E2E lane (`test:e2e:offline`, outside
// `test:all`) proves the same worker in a browser. The same plugin emits the
// web app manifest and the icons it generates from public/favicon.svg.
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cadara-sw-"));
  await mkdir(path.join(root, "public/icons"), { recursive: true });
  await writeFile(path.join(root, "public/icons/tool.svg"), "<svg/>");
  await copyFile("public/favicon.svg", path.join(root, "public/favicon.svg"));
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
      '<html><head></head><body><script type="module" src="/main.js"></script></body></html>',
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
}, 120_000);

afterAll(() => rm(root, { recursive: true, force: true }));

test("the built service worker precaches the app shell and the kernel at its versioned URLs only", async () => {
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
  expect(urls, "the installable app's manifest and icons work offline").toEqual(
    expect.arrayContaining([
      "manifest.webmanifest",
      "pwa-192x192.png",
      "pwa-512x512.png",
      "maskable-icon-512x512.png",
      "apple-touch-icon-180x180.png",
      "favicon.ico",
    ]),
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
});

test("the web app manifest installs /app over scope / with the shell colours, generated icons and the .cadara file handler only", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(root, "dist/manifest.webmanifest"), "utf8"),
  ) as Record<string, unknown>;
  expect(manifest).toMatchObject({
    id: "/app",
    name: "CADara",
    short_name: "CADara",
    scope: "/",
    start_url: "/app",
    display: "standalone",
    theme_color: workbenchColors[9],
    background_color: workbenchColors[9],
    file_handlers: [
      {
        action: "/app",
        accept: { "application/vnd.cadara+json": [".cadara"] },
      },
    ],
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: "pwa-192x192.png", sizes: "192x192" }),
      expect.objectContaining({ src: "pwa-512x512.png", sizes: "512x512" }),
      expect.objectContaining({
        src: "maskable-icon-512x512.png",
        purpose: "maskable",
      }),
    ]),
  );
  for (const name of ["index.html", "app.html"]) {
    const html = await readFile(path.join(root, "dist", name), "utf8");
    expect(html, name).toContain(
      '<link rel="manifest" href="/manifest.webmanifest">',
    );
    expect(html, name).toContain(
      `<meta name="theme-color" content="${workbenchColors[9]}">`,
    );
    expect(html, name).toContain('rel="apple-touch-icon"');
  }
});

// Runs last: it adds files to the shared fixture and rebuilds it.
test("the build fails when the sequential offline install would exceed its request budget", async () => {
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
});
