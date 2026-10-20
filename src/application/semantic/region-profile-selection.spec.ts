import { expect, test } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSemanticSessionWorkflow } from "../../../test/helpers/semantic-session-workflow";
import { SemanticDocument } from "./sdk";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { extrudeAuthoringDefinition } from "@/core/feature-authoring/features/extrude";

function profile(document: AuthoredModelDocument) {
  const feature = document.features.find(
    (f) => f.definition.kind === "extrude",
  )!;
  if (feature.definition.kind !== "extrude")
    throw new Error("Expected extrude");
  const ref = feature.definition.parameters.profiles[0];
  if (ref.kind !== "region") throw new Error("Expected region");
  return { feature, ref };
}

test("SDK parameter edits preserve enriched native intent; legacy save/open is unchanged until a successful feature edit upgrades it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-region-selector-"));
  const workflow = await createSemanticSessionWorkflow("region-selector");
  const doc = new SemanticDocument(workflow.session);
  const path = join(directory, "region.cadara");
  const saved = async () => {
    await doc.ops.document.save({ path });
    return JSON.parse(await readFile(path, "utf8")) as AuthoredModelDocument;
  };
  try {
    await doc.ops.document.create({ label: "Region intent" });
    const variable = await doc.ops.variable.add({
      name: "radius",
      valueText: "3",
    });
    const variableId = variable.discovery!.variables![0]!.variableId;
    await doc.ops.sketch.begin({ plane: "xy" });
    const authored = await doc.ops.sketch.author({
      primitive: { kind: "circle", center: [0, 0], radius: 3 },
      construction: false,
    });
    const target = authored.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    if (target.kind !== "sketchEntity") throw new Error("Expected curve target");
    const dimension = await doc.ops.sketch.requirement.add({
      tool: "dimensionRadius",
      targets: [target],
      mode: "driving",
      value: 3,
    });
    await doc.ops.sketch.dimension.update({
      dimensionId: dimension.discovery!.sketch!.requirements[0]!.dimensionId!,
      value: "radius",
    });
    const published = await doc.ops.sketch.publish({ requireProfiles: true });
    const sketch = published.discovery!.sketch!;
    const created = await doc.ops.extrude.create({
      profile: {
        kind: "region",
        sketchId: sketch.sketchId!,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: 5,
    });
    const bodyId = created.discovery!.model!.bodies[0]!.bodyId;
    const initial = await saved();
    const { feature, ref } = profile(initial);
    expect(ref.selector).toMatchObject({
      kind: "interiorPoint",
      point: [0, 0],
      expectedBoundaryIdentity: expect.stringMatching(
        /^import-region-boundary\/v1:/,
      ),
    });
    const hydrated = extrudeAuthoringDefinition.hydrateDraft(
      feature.definition as Parameters<
        typeof extrudeAuthoringDefinition.hydrateDraft
      >[0],
    );
    expect(hydrated.profileTargets[0]).toEqual(ref);
    await doc.ops.variable.update({
      variableId,
      name: "radius",
      valueText: "7",
    });
    expect(doc.current!.discovery!.model!.bodies[0]).toMatchObject({
      bodyId,
      bounds: { min: [-7, -7, 0], max: [7, 7, 5] },
    });
    expect(doc.current!.result.completion.geometry.kind).toBe("current");
    expect(profile(await saved()).ref).toEqual(ref); // rebuild must not rewrite history
    await doc.ops.document.open({ path });
    expect(profile(await saved()).ref).toEqual(ref);

    const legacy = await saved();
    delete profile(legacy).ref.selector;
    await writeFile(path, JSON.stringify(legacy));
    await doc.ops.document.open({ path });
    expect(profile(await saved()).ref.selector).toBeUndefined();
    await doc.ops.extrude.update({ featureId: feature.featureId, depth: 8 });
    const upgraded = profile(await saved()).ref;
    expect(upgraded.selector).toBeDefined();
    expect(upgraded.regionId).toBe(ref.regionId);
    await doc.ops.history.undo({});
    expect(profile(await saved()).ref.selector).toBeUndefined();
    await doc.ops.history.redo({});
    expect(profile(await saved()).ref).toEqual(upgraded);
    await doc.ops.document.open({ path });
    expect(profile(await saved()).ref).toEqual(upgraded);
  } finally {
    await doc.close();
    await rm(directory, { recursive: true, force: true });
  }
});
