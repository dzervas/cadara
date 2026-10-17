import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("retains requirement identities through private removal undo, publication, native file open and sketch reopen", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-requirements-"));
  const f = await createSketchWorkflow();
  try {
    const created = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 5 },
      construction: false,
      intent: "fulfill",
    });
    const target = created.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const fixed = await f.execute({
      operation: "sketch.requirement.add",
      draft: created.discovery!.state.draft,
      tool: "constraintFix",
      targets: [target],
      mode: "driving",
      value: null,
      intent: "fulfill",
    });
    const measured = await f.execute({
      operation: "sketch.requirement.add",
      draft: fixed.discovery!.state.draft,
      tool: "dimensionRadius",
      targets: [target],
      mode: "reference",
      value: null,
      intent: "fulfill",
    });
    const refs = measured.discovery!.references.filter(
      (r) => r.target.kind === "dimension" || r.target.kind === "constraint",
    );
    const removed = await f.execute({
      operation: "sketch.requirement.remove",
      draft: measured.discovery!.state.draft,
      targets: refs.map((r) => r.target),
      intent: "fulfill",
    });
    expect(removed.discovery!.sketch!.constraints).toEqual([]);
    expect(removed.discovery!.sketch!.requirements).toEqual([]);
    expect(removed.discovery!.sketch!.measurements).toEqual([]);
    const restored = await f.execute({
      operation: "history.undo",
      draft: removed.discovery!.state.draft,
    });
    expect(restored.discovery!.references).toEqual(
      expect.arrayContaining(refs),
    );
    const published = await f.execute({
      operation: "sketch.publish",
      draft: restored.discovery!.state.draft,
      requireProfiles: true,
    });
    const sketchId = published.discovery!.sketch!.sketchId;
    expect(sketchId).not.toBeNull();
    // Publication changes the private owner to the committed sketch identity; requirement IDs survive that ownership transition.
    const publishedRefs = refs.map((r) => ({
      ...r,
      target: { ...r.target, sketchId },
    }));
    // Published discovery retains requirement IDs in its sketch data; scoped annotation references are discovered again when reopened.
    expect(published.discovery!.sketch!.constraints).toEqual(
      measured.discovery!.sketch!.constraints,
    );
    expect(published.discovery!.sketch!.requirements).toEqual(
      measured.discovery!.sketch!.requirements,
    );
    expect(published.discovery!.sketch!.measurements).toEqual(
      measured.discovery!.sketch!.measurements,
    );
    const path = resolve(directory, "requirements.cadara");
    const saved = await f.execute({ operation: "document.save", path });
    expect(saved.completion.file.kind).toBe("written");
    await f.execute({ operation: "document.open", basis: null, path });
    const reopened = await f.execute({ operation: "sketch.open", sketchId });
    expect(reopened.discovery!.references).toEqual(
      expect.arrayContaining(publishedRefs),
    );
    expect(reopened.discovery!.sketch!.constraints).toEqual(
      measured.discovery!.sketch!.constraints,
    );
    expect(reopened.discovery!.sketch!.requirements).toEqual(
      measured.discovery!.sketch!.requirements,
    );
    expect(reopened.discovery!.sketch!.measurements).toEqual(
      measured.discovery!.sketch!.measurements,
    );
    expect(reopened.discovery!.sketch!.entities[0]!.radius).toBeCloseTo(5, 6);
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
