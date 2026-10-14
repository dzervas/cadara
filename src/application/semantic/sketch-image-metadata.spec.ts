import { expect, test } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

// Metadata fixtures, not pixel-decode certificates. Production readers only
// inspect raster headers; no new decoder or file-integrity guarantee is implied.
const headers = [
  ["png", "image/png", "89504e470d0a1a0a0000000d494844520000000200000003"],
  ["jpg", "image/jpeg", "ffd8ffc00011080003000203011100021100031100ffd9"],
  ["jpeg", "image/jpeg", "ffd8ffc00011080003000203011100021100031100ffd9"],
  ["bmp", "image/bmp", "424d0000000000000000000000000000000002000000fdffffff"],
  [
    "webp",
    "image/webp",
    "524946461600000057454250565038580a00000000000000010000020000",
  ],
  [
    "tiff",
    "image/tiff",
    "49492a0008000000020000010300010000000200000001010300010000000300000000000000",
  ],
] as const;

test("existing PNG/JPEG/BMP/WebP/TIFF metadata readers retain dimensions, aspect placement and supplied bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-image-metadata-"));
  const w = await createSketchWorkflow();
  try {
    for (const [extension, mediaType, hex] of headers) {
      const path = join(directory, `metadata.${extension}`);
      await writeFile(path, Buffer.from(hex, "hex"));
      const added = await w.execute({
        operation: "sketch.image.add",
        draft: w.current().discovery!.state.draft,
        path,
        intent: "fulfill",
      });
      const image =
        added.discovery!.sketch!.referenceImages!.at(-1)!.ownedState;
      expect(image.image.mediaType).toBe(mediaType);
      expect(image.image.pixelWidth).toBe(2);
      expect(image.image.pixelHeight).toBe(3);
      expect(
        Buffer.from(image.image.base64Data, "base64").toString("hex"),
      ).toBe(hex);
      expect(image.placement.center).toEqual([0, 0]);
      expect(image.placement.width).toBeCloseTo(400 / 3, 10);
      expect(image.placement.height).toBe(200);
      expect(added.discovery!.sketch!.profiles).toHaveLength(0);
    }
    expect(w.current().discovery!.history!.undoEntries!).toHaveLength(6);
  } finally {
    await w.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
