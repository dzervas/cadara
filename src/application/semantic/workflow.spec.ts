import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHeadlessSessionFactory } from "@/composition/headless";
import {
  validateSemanticCommand,
  validateSemanticResult,
} from "@/contracts/semantic/runtime-schema";
import type {
  SemanticCommand,
  SemanticResult,
} from "@/contracts/semantic/schema";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { createPlateWorkflow } from "../../../test/helpers/semantic-workflow";

function expectSize(result: SemanticResult, width: number) {
  expect(result.discovery!.model!.bodies).toHaveLength(1);
  const body = result.discovery!.model!.bodies[0]!;
  expect(body.kind).toBe("solid");
  for (const [axis, size] of [width, 10, 7].entries())
    expect(body.bounds!.max[axis]! - body.bounds!.min[axis]!).toBeCloseTo(
      size,
      5,
    );
}

it("creates, drives, publishes, rebuilds, compensates, saves and freshly reopens the same plate before STEP export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-workflow-"));
  const fixture = await createPlateWorkflow();
  let fresh:
    | Awaited<
        ReturnType<ReturnType<typeof createHeadlessSessionFactory>["open"]>
      >
    | undefined;
  try {
    expect(fixture.solid.discovery!.document!.label).toBe("Workflow plate");
    expect(fixture.published.discovery!.sketch!.profiles).toHaveLength(1);
    expect(fixture.solid.completion.geometry.kind).toBe("current");
    expectSize(fixture.solid, 20);
    const sketch = fixture.published.discovery!.sketch!;
    const width = sketch.requirements.find(
      (requirement) => requirement.value === 20,
    )!;
    const references = fixture.solid.discovery!.references;
    const feature = fixture.solid.discovery!.model!.features[0]!;
    const body = fixture.solid.discovery!.model!.bodies[0]!;
    await fixture.execute({
      operation: "sketch.open",
      sketchId: sketch.sketchId,
    });
    await fixture.execute({
      operation: "sketch.dimension.update",
      draft: fixture.current().discovery!.state.draft,
      dimensionId: width.dimensionId,
      value: 35,
      intent: "fulfill",
    });
    const changed = await fixture.execute({
      operation: "sketch.publish",
      draft: fixture.current().discovery!.state.draft,
      requireProfiles: true,
    });
    expect(changed.completion.geometry.kind).toBe("current");
    expectSize(changed, 35);
    expect(
      changed.discovery!.sketch!.requirements.map(
        (requirement) => requirement.dimensionId,
      ),
    ).toEqual(
      sketch.requirements.map((requirement) => requirement.dimensionId),
    );
    expect(changed.discovery!.model!.features[0]!.featureId).toBe(
      feature.featureId,
    );
    expect(changed.discovery!.model!.features[0]!.producedTargets).toEqual(
      feature.producedTargets,
    );
    expect(changed.discovery!.model!.bodies[0]!.bodyId).toBe(body.bodyId);
    // Authored targets survive; derived subtopology is geometry-dependent, not
    // promised stable after a driving edit. Always discover it at the new basis.
    const authoredReferences = (result: SemanticResult) =>
      result.discovery!.references.filter(
        (reference) =>
          !["face", "edge", "vertex"].includes(reference.target.kind),
      );
    expect(authoredReferences(changed)).toEqual(
      authoredReferences(fixture.solid),
    );
    expect(
      changed.discovery!.references.filter(
        (reference) => reference.target.kind === "face",
      ),
    ).toHaveLength(6);
    expect(changed.discovery!.references).not.toEqual(references);
    const stale = await fixture.run({
      operation: "export.step",
      basis: fixture.solid.discovery!.state,
      target: references.find((reference) => reference.target.kind === "face")!
        .target,
      options: { schema: "AP242", unit: "millimeter" },
      path: join(directory, "stale.step"),
    });
    expect(stale.outcome.kind).toBe("conflicted");
    expect(stale.completion.file.kind).toBe("not-required");
    expect(changed.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Publish Sketch",
    );
    const undone = await fixture.execute({
      operation: "history.undo",
      draft: null,
    });
    expect(undone.completion.geometry.kind).toBe("current");
    expectSize(undone, 20);
    const redone = await fixture.execute({
      operation: "history.redo",
      draft: null,
    });
    expect(redone.completion.geometry.kind).toBe("current");
    expectSize(redone, 35);
    const savedReferences = redone.discovery!.references;
    const path = join(directory, "plate.cadara");
    const saved = await fixture.execute({ operation: "document.save", path });
    const text = await readFile(path, "utf8");
    expect(saved.completion.file).toMatchObject({
      kind: "written",
      bytesWritten: Buffer.byteLength(text),
    });
    const authored = JSON.parse(text) as AuthoredModelDocument;
    expect(authored.features).toHaveLength(1);
    expect(authored.sketches).toHaveLength(1);
    expect((await fixture.close()).kind).toBe("closed");
    fresh = await createHeadlessSessionFactory().open();
    if (fresh.kind !== "ready") throw new Error(JSON.stringify(fresh));
    let sequence = 0;
    let current = await fresh.session.execute({
      version: 1,
      commandId: "fresh-open",
      operation: "document.open",
      path,
      basis: null,
    });
    async function execute(input: Record<string, unknown>) {
      if (fresh?.kind !== "ready") throw new Error("Fresh session unavailable");
      const state = current.discovery!.state;
      const command = {
        version: 1,
        commandId: `fresh-${++sequence}`,
        basis: {
          documentId: state.documentId,
          revisionId: state.revisionId,
          repositoryHeads: state.repositoryHeads,
        },
        ...input,
      };
      expect(
        validateSemanticCommand(command).success,
        JSON.stringify(command),
      ).toBe(true);
      current = await fresh.session.execute(command as SemanticCommand);
      expect(current.outcome.kind, JSON.stringify(current)).toBe("completed");
      expect(validateSemanticResult(current.correlation, current).success).toBe(
        true,
      );
      return current;
    }
    expect(current.outcome.kind, JSON.stringify(current)).toBe("completed");
    expect(current.completion.geometry.kind).toBe("current");
    expectSize(current, 35);
    expect(current.discovery!.references).toEqual(savedReferences);
    expect(current.discovery!.history).toMatchObject({
      canUndo: false,
      canRedo: false,
    });
    const roundtrip = join(directory, "roundtrip.cadara");
    await execute({ operation: "document.save", path: roundtrip });
    const retained = JSON.parse(
      await readFile(roundtrip, "utf8"),
    ) as AuthoredModelDocument;
    for (const key of [
      "features",
      "sketches",
      "assets",
      "settings",
      "bodyLabels",
      "embeddedBinaryAssets",
    ] as const)
      expect(retained[key]).toEqual(authored[key]);
    // Native topology tokens identify rebuild instances, not authored identity.
    // Compare all retained lineage except those intentionally refreshed tokens.
    const lineage = (document: AuthoredModelDocument) =>
      document.topologyLineage?.map((stage) => ({
        ...stage,
        outputs: stage.outputs.map((output) => ({
          ...output,
          topologyToken: "rebuild-instance",
        })),
      }));
    expect(lineage(retained)).toEqual(lineage(authored));
    expect(
      retained
        .topologyLineage!.flatMap((stage) => stage.outputs)
        .every((output) => output.topologyToken.length > 0),
    ).toBe(true);
    await execute({ operation: "sketch.open", sketchId: sketch.sketchId });
    expect(current.discovery!.sketch!.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimensionId: width.dimensionId,
          value: 35,
          measuredValue: expect.closeTo(35, 5),
        }),
        expect.objectContaining({
          value: 10,
          measuredValue: expect.closeTo(10, 5),
        }),
      ]),
    );
    expect(current.discovery!.history).toMatchObject({
      canUndo: false,
      canRedo: false,
    });
    await execute({
      operation: "sketch.discard",
      draft: current.discovery!.state.draft,
    });
    expectSize(current, 35);
    const target = current.discovery!.references.find(
      (reference) => reference.target.kind === "body",
    )!.target;
    const step = join(directory, "plate.step");
    const exported = await execute({
      operation: "export.step",
      target,
      options: { schema: "AP242", unit: "millimeter" },
      path: step,
    });
    expect(exported.completion.geometry.kind).toBe("current");
    const bytes = await readFile(step, "utf8");
    expect(bytes).toMatch(/^ISO-10303-21;/);
    expect(bytes).toContain("MANIFOLD_SOLID_BREP");
    expect(bytes).toContain("AP242");
    expect(bytes).toContain("END-ISO-10303-21;");
    expect(exported.completion.file).toMatchObject({
      kind: "written",
      bytesWritten: Buffer.byteLength(bytes),
    });
  } finally {
    await fixture.close();
    if (fresh?.kind === "ready") await fresh.session.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);

it("rejects bad inputs and cannot fulfill downstream geometry from an explicitly invalid authored plate", async () => {
  const fixture = await createPlateWorkflow();
  try {
    const feature = fixture.solid.discovery!.model!.features[0]!;
    const rejected = await fixture.run({
      operation: "extrude.update",
      featureId: feature.featureId,
      depth: -1,
      intent: "fulfill",
    });
    expect(rejected.outcome.kind).toBe("rejected");
    expect(rejected.completion.live.kind).toBe("unchanged");
    expect(rejected.completion.persistence.kind).toBe("not-required");
    const opened = await fixture.execute({
      operation: "sketch.open",
      sketchId: fixture.published.discovery!.sketch!.sketchId,
    });
    const points = opened.discovery!.sketch!.points;
    const invalid = await fixture.run({
      operation: "sketch.dimension.add",
      draft: opened.discovery!.state.draft,
      axis: "horizontal",
      points: [points[0]!.pointId, points[1]!.pointId],
      mode: "driving",
      value: 35,
      intent: "author-invalid",
    });
    expect(invalid.outcome.kind, JSON.stringify(invalid)).toBe(
      "accepted-invalid",
    );
    expect(invalid.completion.live.kind).toBe("applied");
    expect(invalid.completion.geometry.kind).toBe("invalid-editable");
    expect(invalid.discovery!.sketch!.profiles).toEqual([]);
    expect(invalid.discovery!.sketch!.validity.state).toBe("invalid");
    expect(invalid.diagnostics.length).toBeGreaterThan(0);
    const published = await fixture.run({
      operation: "sketch.publish",
      draft: invalid.discovery!.state.draft,
      requireProfiles: false,
    });
    expect(published.outcome).toMatchObject({
      kind: "failed",
      failures: expect.arrayContaining(["geometry"]),
    });
    expect(published.completion.live.kind).toBe("applied");
    expect(published.completion.persistence.kind).toBe("committed");
    expect(published.discovery!.sketch!.profiles).toEqual([]);
    expect(
      published.discovery!.model!.bodies.every((body) => body.bounds === null),
    ).toBe(true);
    const unavailable = await fixture.run({
      operation: "extrude.update",
      featureId: feature.featureId,
      depth: 12,
      intent: "fulfill",
    });
    expect(unavailable.outcome).toEqual({
      kind: "rejected",
      reasonCode: "profile-region-sketch-not-current",
    });
    expect(unavailable.completion.live.kind).toBe("unchanged");
    for (const result of [rejected, invalid, published, unavailable])
      expect(
        validateSemanticResult(result.correlation, result).success,
        JSON.stringify(result),
      ).toBe(true);
  } finally {
    await fixture.close();
  }
}, 60000);

it("missing production assets fail partial startup with settled cleanup rather than a fallback runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-no-assets-"));
  try {
    const failed = await createHeadlessSessionFactory({
      assetDirectory: directory,
    }).open();
    expect(failed.kind).toBe("failed");
    if (failed.kind !== "failed")
      throw new Error("Missing assets unexpectedly initialized");
    expect(failed.diagnostics.length).toBeGreaterThan(0);
    expect(failed.cleanup).toMatchObject({
      kind: "closed",
      resourcesReleased: true,
      settled: [],
    });
    const recovered = await createHeadlessSessionFactory().open();
    expect(recovered.kind).toBe("ready");
    if (recovered.kind === "ready")
      expect((await recovered.session.close()).kind).toBe("closed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
