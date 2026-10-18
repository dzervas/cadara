import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

// Migrated from e2e/acceptance-history.spec.ts ("§5 E2E-5 invalid by merge").
// The workbench surface (status line after Escape, problem count, repair
// entry, no internal ids) stays in that file's trimmed "invalid by merge,
// workbench surface" row; this row proves the authored and model contract:
// retained requirements, validity, the waiting downstream extrude and native
// save/open.
it("an endpoint merge retaining two disagreeing Fix requirements blocks the profiles; the published extrude waits; re-entry and save → open keep the same diagnostics; deleting one Fix rebuilds the extrude", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-merge-invalid-"));
  const f = await createSketchWorkflow();
  const draft = () => f.current().discovery!.state.draft;
  const ref = (kind: "sketchPoint" | "constraint", id: string) =>
    f
      .current()
      .discovery!.references.find(
        ({ target }) =>
          target.kind === kind &&
          (kind === "sketchPoint"
            ? "pointId" in target && target.pointId === id
            : "constraintId" in target && target.constraintId === id),
      )!.target;
  const fixes = () =>
    f
      .current()
      .discovery!.sketch!.constraints.filter((c) => c.kind === "fixPoint")
      .map(({ label, status }) => ({ label, status }));
  const documentState = async () => {
    const inspected = await f.execute({ operation: "document.inspect" });
    return {
      producedTargets: inspected.discovery!.model!.features.map(
        (feature) => feature.producedTargets,
      ),
      bodies: inspected.discovery!.model!.bodies.map((body) => body.bounds),
      diagnostics: inspected.diagnostics.map(({ code, message }) => ({
        code,
        message,
      })),
    };
  };
  try {
    await f.execute({
      operation: "sketch.author",
      draft: draft(),
      primitive: { kind: "rectangle", start: [-20, 0], end: [0, 15] },
      construction: false,
      intent: "fulfill",
    });
    // Two lines whose facing ends are a real near gap apart (not shared).
    for (const [start, end] of [
      [
        [25, 10],
        [15, 8],
      ],
      [
        [14.6, 7.6],
        [22, -8],
      ],
    ])
      await f.execute({
        operation: "sketch.author",
        draft: draft(),
        primitive: { kind: "line", start, end },
        construction: false,
        intent: "fulfill",
      });
    const [, , , , gapA, gapB] = f.current().discovery!.sketch!.entities;
    const destination = gapA!.pointIds[1]!;
    const source = gapB!.pointIds[0]!;
    // Each gap end Fixed where it is.
    for (const pointId of [destination, source])
      await f.execute({
        operation: "sketch.requirement.add",
        draft: draft(),
        tool: "constraintFix",
        targets: [ref("sketchPoint", pointId)],
        mode: "driving",
        value: null,
        intent: "fulfill",
      });
    expect(fixes()).toEqual([
      { label: "Fix 4", status: "satisfied" },
      { label: "Fix 5", status: "satisfied" },
    ]);
    const published = await f.execute({
      operation: "sketch.publish",
      draft: draft(),
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    expect(sketch.profiles, "only the rectangle is closed").toHaveLength(1);
    await f.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: sketch.sketchId,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: 5,
      intent: "fulfill",
    });
    const built = {
      producedTargets: [[{ kind: "body", bodyId: "body_feature_extrude-1" }]],
      bodies: [{ min: [-20, 0, 0], max: [0, 15, 5] }],
      diagnostics: [],
    };
    expect(await documentState()).toEqual(built);

    // Re-enter; merge the source into the destination: both Fix
    // requirements are retained and now disagree.
    await f.execute({ operation: "sketch.open", sketchId: sketch.sketchId });
    const merged = await f.run({
      operation: "sketch.geometry.update",
      draft: draft(),
      edit: {
        kind: "mergePoints",
        target: ref("sketchPoint", source),
        destination: ref("sketchPoint", destination),
      },
      intent: "author-invalid",
    });
    expect(merged.outcome).toEqual({ kind: "accepted-invalid" });
    expect(merged.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Merge Points",
    );
    const mergedSketch = merged.discovery!.sketch!;
    expect(mergedSketch.points.map((p) => p.pointId)).toContain(destination);
    expect(mergedSketch.points.map((p) => p.pointId)).not.toContain(source);
    const conflict = {
      validity: mergedSketch.validity,
      fixes: [
        { label: "Fix 4", status: "unsatisfied" },
        { label: "Fix 5", status: "unsatisfied" },
      ],
      profiles: [],
    };
    const sketchState = () => ({
      validity: f.current().discovery!.sketch!.validity,
      fixes: fixes(),
      profiles: f.current().discovery!.sketch!.profiles,
    });
    expect(sketchState(), "the merged sketch").toEqual(conflict);
    expect(
      mergedSketch.validity.state,
      "the sketch is invalid; profiles from it are blocked",
    ).toBe("invalid");
    expect(
      mergedSketch.validity.diagnostics
        .filter((d) => d.code === "solver-requirement-unsatisfied")
        .map((d) => d.message),
    ).toEqual([
      "Fix 4 is not satisfied within its authored tolerance.",
      "Fix 5 is not satisfied within its authored tolerance.",
    ]);

    // Finish: the publication applies, and the extrude waits for its sketch.
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
    const waiting = {
      producedTargets: [[]],
      bodies: [],
      diagnostics: [
        {
          code: "profile-region-sketch-not-current",
          message:
            "Extrude 1 profile region waits for Sketch Draft, whose derived output is invalid.",
        },
      ],
    };
    expect(
      await documentState(),
      "the extrude waits for its invalid sketch",
    ).toEqual(waiting);
    // Re-entered: the same diagnostics (Finish ≡ re-entry).
    await f.run({ operation: "sketch.open", sketchId: sketch.sketchId });
    expect(sketchState()).toEqual(conflict);
    await f.execute({ operation: "sketch.discard", draft: draft() });

    // Save → open: a new history, the same diagnostics and validity in the
    // document and after re-entry.
    const path = resolve(directory, "merge-invalid.cadara");
    await f.execute({ operation: "document.save", path });
    const file: AuthoredModelDocument = JSON.parse(
      await readFile(path, "utf8"),
    );
    expect(
      file.sketches[0]!.definition.constraints.filter(
        (c) => c.kind === "fixPoint",
      ).map((c) => ({ label: c.label, pointId: c.pointId })),
      "the file keeps both requirements, on the destination",
    ).toEqual([
      { label: "Fix 4", pointId: destination },
      { label: "Fix 5", pointId: destination },
    ]);
    const reopened = await f.run({
      operation: "document.open",
      basis: null,
      path,
    });
    expect(reopened.outcome).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(reopened.completion.live.kind).toBe("applied");
    expect(reopened.discovery!.history).toMatchObject({
      undoEntries: [],
      redoEntries: [],
    });
    expect(await documentState()).toEqual(waiting);
    await f.run({ operation: "sketch.open", sketchId: sketch.sketchId });
    expect(sketchState()).toEqual(conflict);

    // Correct the requirement: delete Fix 4 (one action); the profile comes
    // back; Finish → the extrude is built again.
    const fix4 = f
      .current()
      .discovery!.sketch!.constraints.find((c) => c.label === "Fix 4")!;
    const corrected = await f.execute({
      operation: "sketch.requirement.remove",
      draft: draft(),
      targets: [ref("constraint", fix4.constraintId)],
      intent: "fulfill",
    });
    expect(
      corrected.discovery!.history!.undoEntries!.map((entry) => entry.label),
      "one action in the reopened document's fresh history",
    ).toEqual(["Remove Sketch Requirement"]);
    expect(sketchState(), "the conflict is gone").toMatchObject({
      validity: { state: "current" },
      fixes: [{ label: "Fix 5", status: "satisfied" }],
    });
    expect(corrected.discovery!.sketch!.profiles).toHaveLength(1);
    await f.execute({
      operation: "sketch.publish",
      draft: draft(),
      requireProfiles: true,
    });
    expect(await documentState(), "the extrude is current again").toEqual(
      built,
    );
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
