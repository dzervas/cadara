import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
registerHooks({
  resolve(s, c, next) {
    if (s.startsWith("@/"))
      return next(
        pathToFileURL(
          root + "src/" + s.slice(2) + (s.endsWith(".ts") ? "" : ".ts"),
        ).href,
        c,
      );
    if (s.startsWith(".") && c.parentURL) {
      const u = new URL(s, c.parentURL);
      if (!existsSync(fileURLToPath(u)) && existsSync(fileURLToPath(u) + ".ts"))
        return next(u.href + ".ts", c);
    }
    return next(s, c);
  },
  load(url, context, next) {
    if (
      process.env.CADARA_PROBE_BASELINE === "1" &&
      url.startsWith(pathToFileURL(root + "src/").href)
    ) {
      const relative = fileURLToPath(url).slice(root.length);
      if (
        [
          "src/domain/modeling/neutral-curve-certification/fixed-degree-primitives.ts",
          "src/domain/modeling/neutral-curve-certification/cubic-pair-exact.ts",
          "src/contracts/sketch/region-extraction.ts",
        ].includes(relative)
      ) {
        const source = execFileSync(
          "git",
          ["show", "2d0ac345b6589c9fa7276aec7619c82b0ae14473:" + relative],
          { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
        );
        return { format: "module-typescript", source, shortCircuit: true };
      }
    }

    if (
      process.env.CADARA_PROBE_HEX === "1" &&
      url.endsWith("/fixed-degree-primitives.ts")
    ) {
      const source = readFileSync(fileURLToPath(url), "utf8").replace(
        "return magnitude === 0n ? 0 : magnitude.toString(2).length;",
        `if (magnitude === 0n) return 0;
  const hex = magnitude.toString(16);
  return (hex.length - 1) * 4 + (32 - Math.clz32(parseInt(hex[0]!, 16)));`,
      );
      return { format: "module-typescript", source, shortCircuit: true };
    }
    return next(url, context);
  },
});
