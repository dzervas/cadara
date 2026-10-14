import { expect, test } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=";

test("invalid raster files and refused image edits leave the owned draft and history unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-image-refusals-"));
  const good = join(directory, "good.png");
  await writeFile(good, Buffer.from(png, "base64"));
  await writeFile(join(directory, "broken.png"), "not an image");
  await writeFile(join(directory, "vector.svg"), "<svg/>");
  await writeFile(join(directory, "unknown.data"), Buffer.from(png, "base64"));
  const zero = Buffer.from(png, "base64");
  zero.writeUInt32BE(0, 16);
  await writeFile(join(directory, "zero.png"), zero);
  const w = await createSketchWorkflow();
  try {
    const added = await w.execute({
      operation: "sketch.image.add",
      draft: w.current().discovery!.state.draft,
      path: good,
      intent: "fulfill",
    });
    const target = added.discovery!.references.find(
      (r) => r.target.kind === "sketchOperation",
    )!.target;
    for (const name of [
      "missing.png",
      "broken.png",
      "vector.svg",
      "unknown.data",
      "zero.png",
    ]) {
      for (const operation of ["sketch.image.add", "sketch.image.replace"]) {
        const before = w.current().discovery!;
        const failed = await w.run({
          operation,
          draft: before.state.draft,
          ...(operation === "sketch.image.replace" ? { target } : {}),
          path: join(directory, name),
          intent: "fulfill",
        });
        expect(failed.outcome.kind).toBe("failed");
        expect(failed.completion.live.kind).toBe("unchanged");
        expect(failed.diagnostics.length).toBeGreaterThan(0);
        const inspected = await w.execute({
          operation: "sketch.inspect",
          draft: before.state.draft,
        });
        expect(inspected.discovery!.sketch!.referenceImages).toEqual(
          before.sketch!.referenceImages,
        );
        expect(inspected.discovery!.history).toEqual(before.history);
      }
    }
    for (const command of [
      {
        operation: "sketch.image.update",
        target,
        edit: {
          kind: "placement",
          placement: {
            center: [0, 0],
            width: 0,
            height: 20,
            rotationRadians: 0,
          },
        },
      },
      {
        operation: "sketch.image.remove",
        target: { ...target, sketchId: "sketch_foreign" },
      },
      {
        operation: "sketch.image.remove",
        target: { ...target, operationId: "sketch_operation_absent" },
      },
    ]) {
      const before = w.current().discovery!;
      const rejected = await w.run({
        ...command,
        draft: before.state.draft,
        intent: "fulfill",
      });
      expect(rejected.outcome.kind).toBe("rejected");
      expect(rejected.completion.live.kind).toBe("unchanged");
      const inspected = await w.execute({
        operation: "sketch.inspect",
        draft: before.state.draft,
      });
      expect(inspected.discovery!.sketch!.referenceImages).toEqual(
        before.sketch!.referenceImages,
      );
      expect(inspected.discovery!.history).toEqual(before.history);
    }
    const before = w.current().discovery!;
    const stale = await w.run({
      operation: "sketch.image.remove",
      draft: { ...before.state.draft, generation: -1 },
      target,
      intent: "fulfill",
    });
    expect(stale.outcome.kind).toBe("conflicted");
    expect(stale.completion.live.kind).toBe("unchanged");
  } finally {
    await w.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
