import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

/** Run after output is written: this includes HTML, worker chunks and public icons. */
export function createAppShellCachePlugin(): Plugin {
  let root: string;
  return {
    name: "cadara-app-shell-cache",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async writeBundle(options) {
      const directory = path.resolve(root, options.dir!);
      const files = await readdir(directory, {
        recursive: true,
        withFileTypes: true,
      });
      const paths = files
        .filter((entry) => entry.isFile())
        .map((entry) =>
          path.relative(directory, path.join(entry.parentPath, entry.name)),
        )
        .filter(
          (file) =>
            (file.startsWith(`assets${path.sep}`) && !file.endsWith(".map")) ||
            /\.(?:html|svg|png|ico|woff2?|ttf|otf)$/.test(file),
        )
        .sort();
      const hash = createHash("sha256");
      for (const file of paths) {
        hash.update(file);
        hash.update(await readFile(path.join(directory, file)));
      }
      const shell = {
        version: hash.digest("hex"),
        paths: paths.map((file) => `/${file.split(path.sep).join("/")}`),
      };
      const template = await readFile(
        path.join(root, "public/occ-asset-cache-sw.js"),
        "utf8",
      );
      await writeFile(
        path.join(directory, "occ-asset-cache-sw.js"),
        template.replace(
          "/* APP_SHELL_PRECACHE */ null",
          JSON.stringify(shell),
        ),
      );
    },
  };
}
