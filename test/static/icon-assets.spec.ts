import {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { toolIconAssetFileNames } from "@/core/tools/tool-icons";
import { workbenchIconAssetMap } from "@/components/ui/workbench-icon-assets";

const directory = "src/assets/icons";
const files = readdirSync(directory).filter((file) => file.endsWith(".svg"));
const brands = new Set(["discord-logo.svg", "GitHub-logo.svg"]);

// Static lane: asset inventory, authored paint policy and source deduplication.
test("every shipped icon has a consumer and every mapped asset exists", () => {
  const used = new Set([
    ...Object.values(toolIconAssetFileNames),
    ...Object.values(workbenchIconAssetMap),
    "annotation-angle.svg",
    "expression-function.svg",
    "view-cube.svg",
  ]);
  expect(files.sort()).toEqual([...used].sort());
});

test("authored icons use one grid, inherited theme paint and compact source", () => {
  for (const file of files.filter((file) => !brands.has(file))) {
    const source = readFileSync(path.join(directory, file), "utf8");
    expect(source, file).toContain('viewBox="0 0 20 20"');
    expect(source, file).not.toMatch(
      /<(script|image|foreignObject|filter)\b|\son\w+=/,
    );
    for (const [, paint] of source.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)) {
      expect(
        ["none", "currentColor", "var(--cadara-icon-action, currentColor)"],
        file,
      ).toContain(paint);
    }
    expect(Buffer.byteLength(source), file).toBeLessThan(1000);
  }
});

test("identical whole icons are relative symlinks, never synchronized copies", () => {
  const aliases = {
    "shell-ruler.svg": "measure.svg",
    "dimensionDistance.svg": "dimension.svg",
    "shell-check.svg": "finishSketch.svg",
    "shell-import.svg": "import.svg",
    "pattern.svg": "linearPattern.svg",
    "sketchLinearPattern.svg": "linearPattern.svg",
    "sketchCircularPattern.svg": "circularPattern.svg",
    "view-cube.svg": "shell-box.svg",
  };
  for (const [alias, canonical] of Object.entries(aliases)) {
    const filename = path.join(directory, alias);
    expect(lstatSync(filename).isSymbolicLink(), alias).toBe(true);
    expect(readlinkSync(filename), alias).toBe(canonical);
    expect(realpathSync(filename), alias).toBe(
      realpathSync(path.join(directory, canonical)),
    );
  }
  const originals = files.filter(
    (file) => !lstatSync(path.join(directory, file)).isSymbolicLink(),
  );
  const contents = originals.map((file) =>
    readFileSync(path.join(directory, file), "utf8"),
  );
  expect(new Set(contents).size).toBe(originals.length);
});
