import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("a restored native solid accepts a subsequent production feature write without a self-conflicting provenance basis", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "cadara-restored-provenance-"),
  );
  const w = await createSketchWorkflow();
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: circle.discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    const solid = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: sketch.sketchId,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: 3,
      intent: "fulfill",
    });
    const featureId = solid.discovery!.model!.features[0]!.featureId;
    const path = join(directory, "solid.cadara.json");
    await w.execute({ operation: "document.save", path });
    await w.execute({ operation: "document.open", path, basis: null });
    const edited = await w.execute({
      operation: "extrude.update",
      featureId,
      depth: 9,
      intent: "fulfill",
    });
    expect(edited.completion.persistence.kind).toBe("committed");
    expect(edited.discovery!.model!.bodies[0]!.bounds!.max).toEqual([2, 2, 9]);
  } finally {
    await w.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
