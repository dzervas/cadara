import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

// Migrated from e2e/acceptance-history.spec.ts ("§5 E2E-5 invalid by
// deletion"): deleting an offset's seed and a mirror's original leaves both
// relationships broken, not removed, through publication, re-entry and native
// save/open. Panel and status-line wording stays with the editor/domain specs.
it("an offset's seed and a mirror's original deleted (one action each) leave both relationships broken, not removed; publication, re-entry and save → open keep the same diagnostics and validity", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "cadara-deletion-invalid-"),
  );
  const f = await createSketchWorkflow();
  const draft = () => f.current().discovery!.state.draft;
  const ref = (kind: "sketchPoint" | "sketchEntity", id: string) =>
    f
      .current()
      .discovery!.references.find(
        ({ target }) =>
          target.kind === kind &&
          (kind === "sketchPoint"
            ? "pointId" in target && target.pointId === id
            : "entityId" in target && target.entityId === id),
      )!.target;
  /** The authored relationships as discovery reports them. */
  const relationships = () => {
    const sketch = f.current().discovery!.sketch!;
    return {
      offsets: sketch.offsets.map(
        ({ derivationId, label, seedEntityIds, outputEntityIds }) => ({
          derivationId,
          label,
          seedEntityIds,
          outputEntityIds,
        }),
      ),
      mirrors: sketch.mirrors.map(
        ({ derivationId, label, seedEntityIds, outputEntityIds, axis }) => ({
          derivationId,
          label,
          seedEntityIds,
          outputEntityIds,
          axis,
        }),
      ),
    };
  };
  /** Relationship health, validity and consumable profiles. */
  const diagnostics = () => {
    const sketch = f.current().discovery!.sketch!;
    return {
      offsets: sketch.offsets.map(({ health, currentGeometry }) => ({
        health,
        currentGeometry,
      })),
      mirrors: sketch.mirrors.map(({ brokenReason, currentGeometry }) => ({
        brokenReason,
        currentGeometry,
      })),
      validity: sketch.validity,
      profiles: sketch.profiles,
    };
  };
  try {
    // A two-line chain sharing its corner: the offset's seeds.
    for (const [start, end] of [
      [
        [-16, -8],
        [12, -8],
      ],
      [
        [12, -8],
        [12, 14],
      ],
    ])
      await f.execute({
        operation: "sketch.author",
        draft: draft(),
        primitive: { kind: "line", start, end },
        construction: false,
        intent: "fulfill",
      });
    const [seed, corner] = f.current().discovery!.sketch!.entities;
    await f.execute({
      operation: "sketch.geometry.update",
      draft: draft(),
      edit: {
        kind: "mergePoints",
        target: ref("sketchPoint", corner!.pointIds[0]!),
        destination: ref("sketchPoint", seed!.pointIds[1]!),
      },
      intent: "fulfill",
    });
    await f.execute({
      operation: "sketch.offset.create",
      draft: draft(),
      targets: [
        ref("sketchEntity", corner!.entityId),
        ref("sketchEntity", seed!.entityId),
      ],
      distance: 0.5,
      side: "right",
      intent: "fulfill",
    });
    // A circle left of the sketch Y axis, mirrored about it.
    await f.execute({
      operation: "sketch.author",
      draft: draft(),
      primitive: { kind: "circle", center: [-20, 10], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const original = f.current().discovery!.sketch!.entities.at(-1)!;
    expect(original.kind).toBe("circle");
    const mirrored = await f.execute({
      operation: "sketch.mirror.create",
      draft: draft(),
      targets: [ref("sketchEntity", original.entityId)],
      axis: f
        .current()
        .discovery!.sketch!.operands.find((r) => r.label === "Sketch Y axis")!
        .target,
      intent: "fulfill",
    });
    const built = relationships();
    expect(built.offsets[0]!.seedEntityIds).toEqual([
      seed!.entityId,
      corner!.entityId,
    ]);
    expect(built.mirrors[0]!.seedEntityIds).toEqual([original.entityId]);
    expect(
      mirrored.discovery!.sketch!.offsets[0]!.health,
      "premise: a healthy offset",
    ).toEqual({ kind: "healthy" });
    expect(
      mirrored.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points[0]!
        .position,
      "premise: the copy is reflected about the Y axis",
    ).toEqual([20, 10]);
    expect(
      mirrored.discovery!.sketch!.profiles,
      "the circle and its mirror copy are the only closed regions",
    ).toHaveLength(2);

    // Delete the offset's horizontal seed, then the mirror's original: one
    // action each; both relationships stay, broken.
    const seedDeleted = await f.run({
      operation: "sketch.geometry.delete",
      draft: draft(),
      targets: [ref("sketchEntity", seed!.entityId)],
      intent: "author-invalid",
    });
    expect(seedDeleted.outcome.kind).toBe("completed");
    expect(
      seedDeleted.discovery!.sketch!.profiles,
      "the circles do not depend on the offset",
    ).toHaveLength(2);
    const deleted = await f.run({
      operation: "sketch.geometry.delete",
      draft: draft(),
      targets: [ref("sketchEntity", original.entityId)],
      intent: "author-invalid",
    });
    expect(deleted.outcome).toEqual({ kind: "accepted-invalid" });
    expect(
      deleted
        .discovery!.history!.undoEntries!.slice(-2)
        .map((entry) => entry.label),
    ).toEqual(["Delete Sketch Geometry", "Delete Sketch Geometry"]);
    const entityIds = deleted.discovery!.sketch!.entities.map(
      (e) => e.entityId,
    );
    expect(entityIds).not.toContain(seed!.entityId);
    expect(entityIds).not.toContain(original.entityId);
    expect(relationships(), "both relationships stay as authored").toEqual(
      built,
    );
    const broken = diagnostics();
    expect(broken.offsets).toEqual([
      {
        health: {
          kind: "broken",
          reason: "an original was deleted or can't be offset",
        },
        currentGeometry: null,
      },
    ]);
    expect(broken.mirrors).toEqual([
      { brokenReason: "original deleted", currentGeometry: null },
    ]);
    expect(broken.profiles).toEqual([]);
    expect(broken.validity.state).toBe("invalid");
    expect(
      broken.validity.diagnostics.find(
        (d) => d.code === "derived-mirror-map-stale",
      )?.message,
    ).toBe(
      // Labels number the authored actions: Line 1, Line 2, the corner merge,
      // offset 4, Circle 5, mirror 6.
      "Mirror ‘mirror 6’ is broken: the original of ‘Circle 5 mirror’ was deleted. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, replace the original, or remove the mirror from the Mirror panel.",
    );

    // Finish; re-entry; save → open (fresh history); re-entry: the same
    // diagnostics and validity each time; the file keeps both relationships.
    const finished = await f.run({
      operation: "sketch.publish",
      draft: draft(),
      requireProfiles: false,
    });
    expect(finished.outcome).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(finished.completion.live.kind).toBe("applied");
    const sketchId = finished.discovery!.sketch!.sketchId!;
    expect(finished.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Publish Sketch",
    );
    await f.run({ operation: "sketch.open", sketchId });
    expect(relationships()).toEqual(built);
    expect(diagnostics(), "re-entry").toEqual(broken);
    await f.execute({ operation: "sketch.discard", draft: draft() });
    const path = resolve(directory, "deletion-invalid.cadara");
    await f.execute({ operation: "document.save", path });
    const file: AuthoredModelDocument = JSON.parse(
      await readFile(path, "utf8"),
    );
    expect(
      file.sketches[0]!.definition.derivedRelationships!.map((r) => ({
        kind: r.kind,
        derivationId: r.derivationId,
        label: r.label,
        seedEntityIds: r.seedEntityIds,
        outputEntityIds: [
          ...r.outputs,
          ...(r.kind === "offset" ? r.jointOutputs : []),
        ].map((o) => o.outputEntityId),
        ...(r.kind === "mirror" ? { axis: r.mirrorReference } : {}),
      })),
      "the file keeps both broken relationships",
    ).toEqual([
      { kind: "offset", ...built.offsets[0]! },
      { kind: "mirror", ...built.mirrors[0]! },
    ]);
    const reopened = await f.execute({
      operation: "document.open",
      basis: null,
      path,
    });
    expect(reopened.discovery!.history).toMatchObject({
      undoEntries: [],
      redoEntries: [],
    });
    await f.run({ operation: "sketch.open", sketchId });
    expect(relationships()).toEqual(built);
    expect(diagnostics(), "reopened and re-entered").toEqual(broken);
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
