import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

type Example = "bracket" | "wheel" | "enclosure";
type Manifest = { parts: { file: string; label: string; finish: string }[] };
const counts = { bracket: [1, 0], wheel: [5, 3], enclosure: [6, 4] } as const;
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

// Recipes, receipts, and staged native saves stay outside the served examples.
// Failed workspaces are intentionally retained for diagnosis.
export async function buildExample(
  id: Example,
  authorAndValidate: (dir: string, repoRoot: string) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), `cadara-${id}-`));
  try {
    await authorAndValidate(dir, repoRoot);
    const manifest = JSON.parse(
      await readFile(join(dir, `${id}.model.json`), "utf8"),
    ) as Manifest;
    const [bodyCount, screwCount] = counts[id];
    if (
      manifest.parts.length !== bodyCount ||
      manifest.parts.filter((part) => part.finish === "black").length !==
        screwCount ||
      new Set(manifest.parts.map((part) => part.file)).size !== bodyCount ||
      manifest.parts.some(
        (part) =>
          basename(part.file) !== part.file || !part.file.endsWith(".stl"),
      )
    ) {
      throw new Error("Unexpected final example manifest");
    }
    const files = [
      [`${id}.cadara`, "model.cadara"],
      [`${id}.model.json`, "model.json"],
      ...manifest.parts.map((part) => [part.file, part.file]),
    ];
    // Read every validated output before publishing any of them.
    const outputs = await Promise.all(
      files.map(async ([source, destination]) => ({
        source: join(dir, source),
        destination,
        hash: digest(await readFile(join(dir, source))),
      })),
    );
    const destination = join(repoRoot, "landing", "examples", id);
    await mkdir(destination, { recursive: true });
    for (const output of outputs) {
      const target = join(destination, output.destination);
      await copyFile(output.source, target);
      if (digest(await readFile(target)) !== output.hash) {
        throw new Error(`Copy integrity failure: ${target}`);
      }
    }
    await rm(dir, { recursive: true });
    console.log(`Published ${id}: ${bodyCount} parts to ${destination}`);
  } catch (cause) {
    throw new Error(`Example build failed; retained workspace: ${dir}`, {
      cause,
    });
  }
}
