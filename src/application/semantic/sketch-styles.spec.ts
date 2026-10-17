import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("explicit sketch stroke authoring preserves geometry and owns one undoable style action", async () => {
  const w = await createSketchWorkflow();
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const target = circle.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const styled = await w.execute({
      operation: "sketch.style.patch",
      draft: circle.discovery!.state.draft,
      targets: [target],
      patch: { field: "strokeWidth", value: 3 },
      intent: "fulfill",
    });
    expect(styled.discovery!.sketch!.entities[0]!.style).toEqual({
      strokeWidth: 3,
    });
    expect(styled.discovery!.sketch!.points).toEqual(
      circle.discovery!.sketch!.points,
    );
    expect(styled.discovery!.sketch!.profiles).toEqual(
      circle.discovery!.sketch!.profiles,
    );
    expect(styled.discovery!.history!.undoEntries!).toHaveLength(
      circle.discovery!.history!.undoEntries!.length + 1,
    );
    expect(styled.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Stroke",
    );
    const undone = await w.execute({
      operation: "history.undo",
      draft: styled.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.entities[0]!.style).toBeUndefined();
    const redone = await w.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(redone.discovery!.sketch!.entities[0]!.style).toEqual({
      strokeWidth: 3,
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: redone.discovery!.state.draft,
      requireProfiles: true,
    });
    const reopened = await w.execute({
      operation: "sketch.open",
      sketchId: published.discovery!.sketch!.sketchId,
    });
    expect(reopened.discovery!.sketch!.entities[0]!.style).toEqual({
      strokeWidth: 3,
    });
    expect(reopened.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await w.close();
  }
}, 120_000);

test("all production stroke and fill properties retain current native profiles and refuse foreign, missing and wrong-kind targets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-style-retention-"));
  const w = await createSketchWorkflow();
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const entity = circle.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const region = circle.discovery!.references.find(
      (r) => r.target.kind === "region",
    )!.target;
    const stroke = {
      strokeEnabled: true,
      strokeColor: "#123456",
      strokeWidth: 3,
      strokeCap: "square",
      strokeJoin: "miter",
      strokeMiterLimit: 7,
      strokeDashSize: 4,
      strokeGapSize: 2,
    };
    for (const [field, value] of Object.entries(stroke)) {
      await w.execute({
        operation: "sketch.style.patch",
        draft: w.current().discovery!.state.draft,
        targets: [entity],
        patch: { field, value },
        intent: "fulfill",
      });
    }
    expect(w.current().discovery!.sketch!.entities[0]!.style).toEqual(stroke);
    for (const [field, value] of Object.entries({
      fillMode: "solid",
      fillColor: "#abcdef",
    })) {
      await w.execute({
        operation: "sketch.style.patch",
        draft: w.current().discovery!.state.draft,
        targets: [region],
        patch: { field, value },
        intent: "fulfill",
      });
    }
    expect(w.current().discovery!.sketch!.styles![0]!.fill).toEqual({
      kind: "solid",
      color: "#abcdef",
      opacity: 0.42,
    });
    for (const [field, value] of Object.entries({
      fillMode: "gradient",
      gradientStartColor: "#112233",
      gradientEndColor: "#445566",
    })) {
      await w.execute({
        operation: "sketch.style.patch",
        draft: w.current().discovery!.state.draft,
        targets: [region],
        patch: { field, value },
        intent: "fulfill",
      });
    }
    expect(w.current().discovery!.sketch!.styles![0]!.fill).toMatchObject({
      kind: "gradient",
      gradient: { startColor: "#112233", endColor: "#445566" },
    });
    expect(w.current().discovery!.sketch!.profiles).toHaveLength(1);
    for (const [targets, patch] of [
      [[region], { field: "strokeWidth", value: 3 }],
      [[entity], { field: "fillMode", value: "solid" }],
      [
        [{ ...entity, sketchId: "sketch_foreign" }],
        { field: "strokeWidth", value: 3 },
      ],
      [
        [{ ...entity, entityId: "sketch_entity_absent" }],
        { field: "strokeWidth", value: 3 },
      ],
      [[], { field: "strokeWidth", value: 3 }],
      [[entity], { field: "strokeWidth", value: -1 }],
    ] as const) {
      const before = w.current().discovery!;
      const refused = await w.run({
        operation: "sketch.style.patch",
        draft: before.state.draft,
        targets,
        patch,
        intent: "fulfill",
      });
      expect(refused.outcome.kind).toBe("rejected");
      expect(refused.completion.live.kind).toBe("unchanged");
      const inspected = await w.execute({
        operation: "sketch.inspect",
        draft: before.state.draft,
      });
      expect(inspected.discovery!.history).toEqual(before.history);
      expect(inspected.discovery!.sketch!.entities).toEqual(
        before.sketch!.entities,
      );
    }
    const beforeNoop = w.current().discovery!;
    const noop = await w.execute({
      operation: "sketch.style.patch",
      draft: beforeNoop.state.draft,
      targets: [entity],
      patch: { field: "strokeWidth", value: 3 },
      intent: "fulfill",
    });
    expect(noop.outcome).toEqual({ kind: "completed", change: "unchanged" });
    expect(noop.completion.live.kind).toBe("unchanged");
    expect(noop.discovery!.history).toEqual(beforeNoop.history);
    const published = await w.execute({
      operation: "sketch.publish",
      draft: noop.discovery!.state.draft,
      requireProfiles: true,
    });
    const sketchId = published.discovery!.sketch!.sketchId;
    const path = join(directory, "styles.cadara.json");
    const saved = await w.execute({ operation: "document.save", path });
    expect(saved.completion.file.kind).toBe("written");
    await w.execute({ operation: "document.open", basis: null, path });
    const reopened = await w.execute({ operation: "sketch.open", sketchId });
    expect(reopened.discovery!.sketch!.entities[0]!.style).toEqual(stroke);
    expect(reopened.discovery!.sketch!.styles![0]!.fill).toMatchObject({
      kind: "gradient",
      gradient: { startColor: "#112233", endColor: "#445566" },
    });
    expect(reopened.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await w.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
