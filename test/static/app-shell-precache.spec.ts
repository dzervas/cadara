import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { expect, test } from "vitest";

import { createAppShellCachePlugin } from "../../app-shell-cache-plugin";

// Static lane: the emitted service worker must cover the Vite build output,
// not a hand-maintained list of entry hashes. A tiny real build keeps this fast.
test("app-shell precache contains HTML, every entry/chunk, icons and fonts, with a build-specific version", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cadara-shell-"));
  try {
    await mkdir(path.join(root, "public/icons"), { recursive: true });
    await writeFile(
      path.join(root, "public/occ-asset-cache-sw.js"),
      await readFile("public/occ-asset-cache-sw.js"),
    );
    await writeFile(path.join(root, "public/icons/tool.svg"), "<svg/>");
    await writeFile(path.join(root, "font.woff2"), "fixture font");
    await writeFile(
      path.join(root, "main.css"),
      '@font-face { font-family: fixture; src: url("./font.woff2"); }',
    );
    await writeFile(
      path.join(root, "main.js"),
      'import "./main.css"; import("./lazy.js");',
    );
    await writeFile(path.join(root, "lazy.js"), 'console.log("lazy");');
    for (const name of ["index.html", "app.html"]) {
      await writeFile(
        path.join(root, name),
        '<script type="module" src="/main.js"></script>',
      );
    }
    const runBuild = async () => {
      await build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [createAppShellCachePlugin()],
        build: {
          assetsInlineLimit: 0,
          rollupOptions: {
            input: [path.join(root, "index.html"), path.join(root, "app.html")],
          },
        },
      });
      const source = await readFile(
        path.join(root, "dist/occ-asset-cache-sw.js"),
        "utf8",
      );
      const precache = source.match(/const APP_SHELL_PRECACHE = (.+);/);
      expect(
        precache,
        "the build must inject its app-shell precache list",
      ).not.toBeNull();
      return JSON.parse(precache![1]!) as { paths: string[]; version: string };
    };
    const first = await runBuild();
    expect(first.paths).toEqual(
      expect.arrayContaining(["/index.html", "/app.html", "/icons/tool.svg"]),
    );
    const assets = await readdir(path.join(root, "dist/assets"));
    expect(assets.some((file) => file.endsWith(".woff2"))).toBe(true);
    for (const file of assets) expect(first.paths).toContain(`/assets/${file}`);
    await writeFile(path.join(root, "lazy.js"), 'console.log("new build");');
    expect((await runBuild()).version).not.toBe(first.version);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
