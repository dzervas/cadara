import { expect, test } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

// Complete 1x1 PNG; acceptance uses existing metadata readers, not pixel decoding.
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=";

test("local raster bytes become one authored reference image and survive publication and native save/open", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-images-"));
  const path = join(directory, "reference.png");
  await writeFile(path, Buffer.from(png, "base64"));
  const w = await createSketchWorkflow();
  try {
    const before = w.current().discovery!;
    const added = await w.execute({
      operation: "sketch.image.add",
      draft: before.state.draft,
      path,
      intent: "fulfill",
    });
    const image = added.discovery!.sketch!.referenceImages![0]!;
    expect(image.ownedState.image).toEqual({
      mediaType: "image/png",
      fileName: "reference.png",
      pixelWidth: 1,
      pixelHeight: 1,
      base64Data: png,
    });
    expect(image.ownedState.placement).toEqual({
      center: [0, 0],
      width: 200,
      height: 200,
      rotationRadians: 0,
    });
    expect(added.discovery!.sketch!.entities).toHaveLength(0);
    expect(added.discovery!.sketch!.profiles).toHaveLength(0);
    expect(added.discovery!.history!.undoEntries!).toHaveLength(1);
    expect(added.discovery!.history!.undoEntries![0]!.label).toBe(
      "Import Image",
    );
    const undone = await w.execute({
      operation: "history.undo",
      draft: added.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.referenceImages).toEqual([]);
    const redone = await w.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(redone.discovery!.sketch!.referenceImages![0]).toEqual(image);
    const published = await w.execute({
      operation: "sketch.publish",
      draft: redone.discovery!.state.draft,
      requireProfiles: false,
    });
    expect(published.discovery!.sketch!.referenceImages![0]).toEqual(image);
    expect(published.discovery!.sketch!.solveStatus.solveState).toBe(
      "notEvaluated",
    );
    expect(published.discovery!.sketch!.profiles).toHaveLength(0);
    const sketchId = published.discovery!.sketch!.sketchId;
    const native = join(directory, "image.cadara.json");
    const saved = await w.execute({ operation: "document.save", path: native });
    expect(saved.completion.file.kind).toBe("written");
    await w.execute({ operation: "document.open", basis: null, path: native });
    const reopened = await w.execute({ operation: "sketch.open", sketchId });
    expect(reopened.discovery!.sketch!.referenceImages![0]).toEqual(image);
    expect(reopened.discovery!.sketch!.profiles).toHaveLength(0);
  } finally {
    await w.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

test("reference image placement, calibration settings, replacement and removal use owned undoable image intents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-image-edits-"));
  const path = join(directory, "first.png");
  const replacement = join(directory, "second.png");
  await writeFile(path, Buffer.from(png, "base64"));
  await writeFile(replacement, Buffer.from(png, "base64"));
  const w = await createSketchWorkflow();
  try {
    const added = await w.execute({
      operation: "sketch.image.add",
      draft: w.current().discovery!.state.draft,
      path,
      intent: "fulfill",
    });
    const original = added.discovery!.sketch!.referenceImages![0]!;
    const target = added.discovery!.references.find(
      (r) => r.target.kind === "sketchOperation",
    )!.target;
    const placement = {
      center: [10, 20],
      width: 80,
      height: 40,
      rotationRadians: Math.PI / 2,
    };
    const placed = await w.execute({
      operation: "sketch.image.update",
      draft: added.discovery!.state.draft,
      target,
      edit: { kind: "placement", placement },
      intent: "fulfill",
    });
    expect(
      placed.discovery!.sketch!.referenceImages![0]!.ownedState.placement,
    ).toEqual(placement);
    expect(placed.discovery!.history!.undoEntries!).toHaveLength(2);
    const settings = await w.execute({
      operation: "sketch.image.update",
      draft: placed.discovery!.state.draft,
      target,
      edit: {
        kind: "settings",
        scaleMode: "independent",
        showExportedAnchorsInSketch: false,
      },
      intent: "fulfill",
    });
    expect(
      settings.discovery!.sketch!.referenceImages![0]!.ownedState.calibration,
    ).toEqual({
      scaleMode: "independent",
      showExportedAnchorsInSketch: false,
      anchors: [],
    });
    const same = await w.execute({
      operation: "sketch.image.update",
      draft: settings.discovery!.state.draft,
      target,
      edit: { kind: "placement", placement },
      intent: "fulfill",
    });
    expect(same.outcome).toEqual({ kind: "completed", change: "unchanged" });
    expect(same.completion.live.kind).toBe("unchanged");
    expect(same.discovery!.history).toEqual(settings.discovery!.history);
    const replaced = await w.execute({
      operation: "sketch.image.replace",
      draft: same.discovery!.state.draft,
      target,
      path: replacement,
      intent: "fulfill",
    });
    expect(replaced.discovery!.sketch!.referenceImages![0]!.operationId).toBe(
      original.operationId,
    );
    expect(
      replaced.discovery!.sketch!.referenceImages![0]!.ownedState.image
        .fileName,
    ).toBe("second.png");
    expect(
      replaced.discovery!.sketch!.referenceImages![0]!.ownedState.placement,
    ).toEqual(placement);
    expect(
      replaced.discovery!.sketch!.referenceImages![0]!.ownedState.calibration,
    ).toEqual(
      settings.discovery!.sketch!.referenceImages![0]!.ownedState.calibration,
    );
    const removed = await w.execute({
      operation: "sketch.image.remove",
      draft: replaced.discovery!.state.draft,
      target,
      intent: "fulfill",
    });
    expect(removed.discovery!.sketch!.referenceImages).toEqual([]);
    expect(
      removed.discovery!.references.some(
        (r) => r.target.kind === "sketchOperation",
      ),
    ).toBe(false);
    const undone = await w.execute({
      operation: "history.undo",
      draft: removed.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.referenceImages).toEqual(
      replaced.discovery!.sketch!.referenceImages,
    );
    const undoReplacement = await w.execute({
      operation: "history.undo",
      draft: undone.discovery!.state.draft,
    });
    expect(
      undoReplacement.discovery!.sketch!.referenceImages![0]!.ownedState.image,
    ).toEqual(original.ownedState.image);
  } finally {
    await w.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
