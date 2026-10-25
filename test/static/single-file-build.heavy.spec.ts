import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { expect, test } from "vitest";

// Static lane, heavy tier (a full app build, about a minute): the
// single-file build (`build:single`, vite.single.config.ts) is a standalone
// HTML file, not the installable PWA, so it ships neither the web app
// manifest nor the service worker, nor any reference to them.
test(
  "the single-file build emits one HTML file without a web app manifest or service worker",
  { timeout: 600_000 },
  async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "cadara-single-"));
    try {
      await build({
        configFile: path.resolve("vite.single.config.ts"),
        logLevel: "silent",
        build: { outDir, emptyOutDir: true },
      });

      expect(await readdir(outDir, { recursive: true })).toEqual([
        "cadara-single.html",
      ]);
      const html = await readFile(
        path.join(outDir, "cadara-single.html"),
        "utf8",
      );
      for (const reference of [
        'rel="manifest"',
        "manifest.webmanifest",
        "service-worker.js",
        "pwa-192x192.png",
      ])
        expect(html, reference).not.toContain(reference);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  },
);
