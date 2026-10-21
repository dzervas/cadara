// Logic lane; seam: the in-process semantic session (real OCC kernel, memory
// repository, native save/open). Body colours are persisted authored data: a
// body gets its auto palette slot when a feature first creates it, the slot
// survives save/reopen and never moves when other bodies go away, derived
// bodies with new ids get fresh slots, and opening a document saved before
// body colours neither rewrites it nor records an undo entry.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";

type Workflow = Awaited<ReturnType<typeof createSketchWorkflow>>;

/** A 10×10×10 box extruded from a rectangle at x = `start`; the sketch begins first unless `begin` is false. */
async function box(w: Workflow, start: number, begin = true) {
  if (begin) await w.execute({ operation: "sketch.begin", plane: "xy" });
  await w.author({
    kind: "rectangle",
    start: [start, 0],
    end: [start + 10, 10],
  });
  const sketch = (
    await w.execute({
      operation: "sketch.publish",
      draft: w.draft(),
      requireProfiles: true,
    })
  ).discovery!.sketch!;
  const result = await w.execute({
    operation: "extrude.create",
    profile: {
      kind: "region",
      sketchId: sketch.sketchId,
      regionId: sketch.profiles[0]!.regionId,
    },
    depth: 10,
    intent: "fulfill",
  });
  const target = result.discovery!.model!.features.at(-1)!.producedTargets[0]!;
  if (target.kind !== "body")
    throw new Error("Extrusion did not produce a body");
  return target;
}

const slots = (document: AuthoredModelDocument) =>
  Object.fromEntries(
    (document.bodyAppearances ?? []).map(({ bodyId, appearance }) => [
      bodyId,
      appearance.kind === "palette" ? appearance.slot : appearance.hex,
    ]),
  );

async function withScratch<T>(run: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-body-colors-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("new bodies take palette slots 0, 1, 2… that survive save, reopen and deleting an earlier body", async () => {
  const w = await createSketchWorkflow();
  try {
    const a = await box(w, 0, false);
    const b = await box(w, 20);
    expect(slots(await w.saveAndRead())).toEqual({
      [a.bodyId]: 0,
      [b.bodyId]: 1,
    });

    await w.execute({
      operation: "target.delete",
      target: a,
      intent: "fulfill",
    });
    const c = await box(w, 40);
    const saved = await w.saveAndRead();
    expect(
      slots(saved),
      "a deleted body keeps its record, so neither the survivor nor the next body is reshuffled",
    ).toEqual({ [a.bodyId]: 0, [b.bodyId]: 1, [c.bodyId]: 2 });

    await withScratch(async (directory) => {
      const path = resolve(directory, "colors.cadara");
      await writeFile(path, JSON.stringify(saved));
      await w.execute({ operation: "document.open", basis: null, path });
    });
    expect(slots(await w.saveAndRead()), "reopened").toEqual(slots(saved));
    const d = await box(w, 60);
    expect(slots(await w.saveAndRead())).toEqual({
      ...slots(saved),
      [d.bodyId]: 3,
    });
  } finally {
    await w.close();
  }
}, 180_000);

test("split pieces and pattern copies get fresh slots; the split target and pattern seed keep theirs", async () => {
  const w = await createSketchWorkflow();
  try {
    const a = await box(w, 0, false);
    const b = await box(w, 5);
    const split = await w.execute({
      operation: "split.create",
      parameters: {
        participants: [
          { role: "targetBody", targets: [a] },
          { role: "toolBody", targets: [b] },
        ],
      },
      intent: "fulfill",
    });
    const pieces = split.discovery!.model!.features.at(-1)!.producedTargets;
    expect(pieces, "premise: two new split pieces").toHaveLength(2);
    const pattern = await w.execute({
      operation: "linearPattern.create",
      parameters: {
        participants: [
          { role: "body", targets: [b] },
          {
            role: "direction",
            targets: [
              { kind: "construction", constructionId: "construction_plane-yz" },
            ],
          },
        ],
        options: { instanceCount: 3, spacing: 30, oppositeDirection: false },
      },
      intent: "fulfill",
    });
    const copies = pattern.discovery!.model!.features.at(-1)!.producedTargets;
    expect(copies, "premise: two new pattern copies").toHaveLength(2);
    const ids = [...pieces, ...copies].map((target) =>
      target.kind === "body" ? target.bodyId : "",
    );
    expect(slots(await w.saveAndRead())).toEqual({
      [a.bodyId]: 0,
      [b.bodyId]: 1,
      [ids[0]!]: 2,
      [ids[1]!]: 3,
      [ids[2]!]: 4,
      [ids[3]!]: 5,
    });
  } finally {
    await w.close();
  }
}, 180_000);

test("a document saved before body colours opens without being rewritten or gaining an undo entry; its next action persists slots in body order", async () => {
  const w = await createSketchWorkflow();
  try {
    const a = await box(w, 0, false);
    const b = await box(w, 20);
    const legacy = await w.saveAndRead();
    delete legacy.bodyAppearances;
    // Shuffle the stored body order: auto slots follow the document's bodies.
    legacy.bodyLabels.reverse();

    await withScratch(async (directory) => {
      const path = resolve(directory, "legacy.cadara");
      await writeFile(path, JSON.stringify(legacy));
      const opened = await w.execute({
        operation: "document.open",
        basis: null,
        path,
      });
      expect(opened.discovery!.history!.undoEntries).toEqual([]);
    });
    const reopened = await w.saveAndRead();
    expect(reopened, "opening wrote no appearance records").not.toHaveProperty(
      "bodyAppearances",
    );
    expect(reopened.bodyLabels).toEqual(legacy.bodyLabels);

    const c = await box(w, 40);
    expect(slots(await w.saveAndRead())).toEqual({
      [b.bodyId]: 0,
      [a.bodyId]: 1,
      [c.bodyId]: 2,
    });
  } finally {
    await w.close();
  }
}, 180_000);
