import { expect, it } from "vitest";
import { createHeadlessSessionFactory } from "@/composition/headless";
import type {
  SemanticCommand,
  SemanticResult,
} from "@/contracts/semantic/schema";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";

type Input<T = SemanticCommand> = T extends SemanticCommand
  ? Omit<T, "version" | "commandId" | "basis">
  : never;

async function plate(
  options: Parameters<typeof createHeadlessSessionFactory>[0] = {},
) {
  const opened = await createHeadlessSessionFactory(options).open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  const session = opened.session;
  let current = await session.execute({
    version: 1,
    commandId: "inspect",
    operation: "document.inspect",
    basis: opened.initialization.state,
  });
  let sequence = 0;
  async function execute(input: Input) {
    current = await session.execute({
      version: 1,
      commandId: `step-${++sequence}`,
      basis: current.discovery!.state,
      ...input,
    } as SemanticCommand);
    return current;
  }
  await execute({ operation: "sketch.begin", plane: "xy" });
  await execute({
    operation: "sketch.author",
    draft: current.discovery!.state.draft!,
    primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
    construction: false,
    intent: "fulfill",
  });
  const points = current.discovery!.sketch!.points;
  for (const dimension of [
    {
      axis: "horizontal",
      points: [points[0]!.pointId, points[1]!.pointId],
      value: 20,
    },
    {
      axis: "vertical",
      points: [points[1]!.pointId, points[2]!.pointId],
      value: 10,
    },
  ] as const) {
    const result = await execute({
      operation: "sketch.dimension.add",
      draft: current.discovery!.state.draft!,
      ...dimension,
      mode: "driving",
      intent: "fulfill",
    });
    expect(result.outcome.kind, JSON.stringify(result)).toBe("completed");
  }
  const published = await execute({
    operation: "sketch.publish",
    draft: current.discovery!.state.draft!,
    requireProfiles: true,
  });
  expect(published.outcome.kind, JSON.stringify(published)).toBe("completed");
  const sketch = published.discovery!.sketch!;
  const profile = {
    kind: "region" as const,
    sketchId: sketch.sketchId!,
    regionId: sketch.profiles[0]!.regionId,
  };
  return {
    execute,
    published,
    profile,
    current: () => current,
    session,
    close: () => session.close(),
  };
}

it("refuses an unavailable profile without applying or certifying geometry", async () => {
  const fixture = await plate();
  try {
    const result = await fixture.execute({
      operation: "extrude.create",
      profile: { ...fixture.profile, regionId: "region_missing" },
      depth: 7,
      intent: "fulfill",
    });
    expect(result.outcome).toEqual({
      kind: "rejected",
      reasonCode: "profiles-unusable",
    });
    expect(result.completion.live).toEqual({
      kind: "unchanged",
      state: fixture.published.discovery!.state,
    });
    expect(result.completion.geometry.kind).toBe("not-required");
  } finally {
    await fixture.close();
  }
}, 60000);

it("reports a kernel-rejected degenerate extrusion without inventing application", async () => {
  const fixture = await plate();
  try {
    const result = await fixture.execute({
      operation: "extrude.create",
      profile: fixture.profile,
      depth: 1e-12,
      intent: "fulfill",
    });
    expect(result.outcome.kind, JSON.stringify(result)).toBe("rejected");
    expect(result.completion.live.kind).toBe("unchanged");
    expect(result.completion.persistence.kind).toBe("not-required");
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(result.discovery!.model!.bodies).toEqual([]);
  } finally {
    await fixture.close();
  }
}, 60000);

it("never certifies last-good extrusion geometry after publishing conflicting sketch requirements", async () => {
  const fixture = await plate();
  try {
    const created = await fixture.execute({
      operation: "extrude.create",
      profile: fixture.profile,
      depth: 7,
      intent: "fulfill",
    });
    expect(created.outcome.kind).toBe("completed");
    const opened = await fixture.execute({
      operation: "sketch.open",
      sketchId: fixture.profile.sketchId,
    });
    const points = opened.discovery!.sketch!.points;
    const conflicted = await fixture.execute({
      operation: "sketch.dimension.add",
      draft: opened.discovery!.state.draft!,
      axis: "horizontal",
      points: [points[0]!.pointId, points[1]!.pointId],
      mode: "driving",
      value: 35,
      intent: "author-invalid",
    });
    expect(conflicted.outcome.kind, JSON.stringify(conflicted)).toBe(
      "accepted-invalid",
    );
    const published = await fixture.execute({
      operation: "sketch.publish",
      draft: conflicted.discovery!.state.draft!,
      requireProfiles: false,
    });
    expect(published.outcome, JSON.stringify(published)).toMatchObject({
      kind: "failed",
      failures: expect.arrayContaining(["geometry"]),
    });
    expect(published.completion.live.kind).toBe("applied");
    expect(published.completion.persistence.kind).toBe("committed");
    expect(published.completion.geometry.kind).toBe("failed");
    expect(
      published.discovery!.model!.bodies.every((b) => b.bounds === null),
    ).toBe(true);
    expect(published.discovery!.sketch!.profiles).toEqual([]);
    expect(published.diagnostics.some((d) => d.severity === "error")).toBe(
      true,
    );
    const featureId = created.discovery!.model!.features[0]!.featureId;
    const updated = await fixture.execute({
      operation: "extrude.update",
      featureId,
      depth: 9,
      intent: "fulfill",
    });
    expect(updated.outcome, JSON.stringify(updated)).toEqual({
      kind: "rejected",
      reasonCode: "profile-region-sketch-not-current",
    });
    expect(updated.completion.live.kind).toBe("unchanged");
    expect(updated.completion.geometry.kind).toBe("not-required");
    expect(updated.discovery!.model!.bodies).toEqual([]);
  } finally {
    await fixture.close();
  }
}, 60000);

it("refuses an extrusion selected from a stale discovery basis", async () => {
  const fixture = await plate();
  try {
    const created = await fixture.execute({
      operation: "extrude.create",
      profile: fixture.profile,
      depth: 7,
      intent: "fulfill",
    });
    const refused = await fixture.session.execute({
      version: 1,
      commandId: "stale",
      operation: "extrude.create",
      basis: fixture.published.discovery!.state,
      profile: fixture.profile,
      depth: 9,
      intent: "fulfill",
    });
    expect(refused.outcome).toEqual({
      kind: "conflicted",
      actualBasis: {
        documentId: created.discovery!.state.documentId,
        revisionId: created.discovery!.state.revisionId,
        repositoryHeads: created.discovery!.state.repositoryHeads,
      },
    });
    expect(refused.completion.live).toEqual({
      kind: "unchanged",
      state: created.discovery!.state,
    });
  } finally {
    await fixture.close();
  }
}, 60000);

it("awaits a delayed failed extrusion write and preserves its applied live solid on close", async () => {
  let start!: () => void, finish!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    finish = resolve;
  });
  class DelayedFailedRepository extends MemoryDocumentRepository {
    override async mutate(
      input: Parameters<MemoryDocumentRepository["mutate"]>[0],
    ): Promise<DocumentRepositoryMutationResult> {
      const result = await super.mutate(input);
      if (
        !result.ok ||
        input.expected.features.length !== 0 ||
        input.document.features.length !== 1
      )
        return result;
      start();
      await barrier;
      return {
        ok: false,
        status: {
          kind: "failed",
          documentId: input.documentId,
          diagnostic: {
            reasonCode: "write-failed",
            message: "Extrusion storage flush failed",
          },
        },
        appliedLive: { document: result.document, metadata: result.metadata },
      };
    }
  }
  const fixture = await plate({
    createRepository: (assets) => new DelayedFailedRepository([], assets),
  });
  try {
    let settled = false;
    const pending = fixture
      .execute({
        operation: "extrude.create",
        profile: fixture.profile,
        depth: 7,
        intent: "fulfill",
      })
      .then((result) => {
        settled = true;
        return result;
      });
    await started;
    const closing = fixture.close();
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    const result = await pending;
    expect(result.outcome, JSON.stringify(result)).toEqual({
      kind: "failed",
      failures: ["persistence"],
    });
    expect(result.completion.live.kind).toBe("applied");
    expect(result.completion.persistence).toMatchObject({
      kind: "failed",
      commandId: result.correlation.commandId,
      state: result.discovery!.state,
    });
    expect(result.completion.geometry.kind).toBe("current");
    expect(dimensions(result)[2]).toBeCloseTo(7, 6);
    expect(result.diagnostics.map((d) => d.message)).toContain(
      "Extrusion storage flush failed",
    );
    expect(await closing).toMatchObject({
      kind: "closed",
      settled: [result],
      resourcesReleased: true,
    });
  } finally {
    finish();
    await fixture.close();
  }
}, 60000);

it("retains already-applied extrusion state when its repository write throws after applying", async () => {
  class ThrowingRepository extends MemoryDocumentRepository {
    override async mutate(
      input: Parameters<MemoryDocumentRepository["mutate"]>[0],
    ): Promise<DocumentRepositoryMutationResult> {
      const result = await super.mutate(input);
      if (
        input.expected.features.length === 0 &&
        input.document.features.length === 1
      )
        throw new Error("Extrusion write completion was lost");
      return result;
    }
  }
  const fixture = await plate({
    createRepository: (assets) => new ThrowingRepository([], assets),
  });
  try {
    const result = await fixture.execute({
      operation: "extrude.create",
      profile: fixture.profile,
      depth: 7,
      intent: "fulfill",
    });
    expect(result.outcome).toMatchObject({
      kind: "failed",
      failures: expect.arrayContaining(["execution", "persistence"]),
    });
    expect(result.completion.live.kind, JSON.stringify(result)).toBe("applied");
    expect(result.completion.persistence.kind).toBe("failed");
    expect(result.diagnostics.map((d) => d.message)).toContain(
      "Extrusion write completion was lost",
    );
    expect(result.discovery!.state.revisionId).not.toBe(
      fixture.published.discovery!.state.revisionId,
    );
    expect(dimensions(result)[2]).toBeCloseTo(7, 6);
  } finally {
    await fixture.close();
  }
}, 60000);

it("preserves the final live cursor revision when its downstream restoration write is refused", async () => {
  let refuseRestore = false;
  class RefusedCursorRepository extends MemoryDocumentRepository {
    override async mutate(
      input: Parameters<MemoryDocumentRepository["mutate"]>[0],
    ): Promise<DocumentRepositoryMutationResult> {
      if (
        refuseRestore &&
        input.label !== "Publish Sketch" &&
        input.document.cursor.kind === "feature"
      )
        return {
          ok: false,
          status: {
            kind: "failed",
            documentId: input.documentId,
            diagnostic: {
              reasonCode: "write-failed",
              message: "Cursor restoration write refused",
            },
          },
        };
      return super.mutate(input);
    }
  }
  const fixture = await plate({
    createRepository: (assets) => new RefusedCursorRepository([], assets),
  });
  try {
    await fixture.execute({
      operation: "extrude.create",
      profile: fixture.profile,
      depth: 7,
      intent: "fulfill",
    });
    const opened = await fixture.execute({
      operation: "sketch.open",
      sketchId: fixture.profile.sketchId,
    });
    const changed = await fixture.execute({
      operation: "sketch.dimension.update",
      draft: opened.discovery!.state.draft!,
      dimensionId: opened.discovery!.sketch!.requirements[0]!.dimensionId,
      value: 35,
      intent: "fulfill",
    });
    refuseRestore = true;
    const published = await fixture.execute({
      operation: "sketch.publish",
      draft: changed.discovery!.state.draft!,
      requireProfiles: true,
    });
    expect(published.outcome).toMatchObject({
      kind: "failed",
      failures: expect.arrayContaining(["persistence"]),
    });
    expect(published.completion.live.kind).toBe("applied");
    const inspected = await fixture.session.execute({
      version: 1,
      commandId: "inspect-after-failure",
      operation: "document.inspect",
      basis: published.completion.live.state!,
    });
    expect(inspected.outcome.kind).toBe("completed");
    expect(published.completion.live.state!.revisionId).toBe(
      inspected.discovery!.state.revisionId,
    );
    expect(published.completion.persistence).toMatchObject({
      kind: "failed",
      state: published.completion.live.state,
    });
    expect(dimensions(inspected)[0]).toBeCloseTo(35, 6);
    expect(published.diagnostics.map((d) => d.message)).toContain(
      "Cursor restoration write refused",
    );
  } finally {
    await fixture.close();
  }
}, 60000);

function dimensions(result: SemanticResult) {
  const model = result.discovery!.model!;
  expect(model.bodies).toHaveLength(1);
  expect(model.bodies[0]!.kind).toBe("solid");
  const bounds = model.bodies[0]!.bounds!;
  return bounds.max.map((value, index) => value - bounds.min[index]!);
}

it("extrudes a discovered dimensioned rectangle and measures its exact solid, then updates depth", async () => {
  const fixture = await plate();
  try {
    const created = await fixture.execute({
      operation: "extrude.create",
      profile: fixture.profile,
      depth: 7,
      intent: "fulfill",
    });
    expect(created.outcome, JSON.stringify(created)).toEqual({
      kind: "completed",
      change: "changed",
    });
    const size = dimensions(created);
    expect(size[0]).toBeCloseTo(20, 6);
    expect(size[1]).toBeCloseTo(10, 6);
    expect(size[2]).toBeCloseTo(7, 6);
    expect(created.completion.geometry).toMatchObject({
      kind: "current",
      rebuildRevisionId: created.discovery!.state.revisionId,
    });
    expect(created.completion.persistence.kind).toBe("committed");
    const feature = created.discovery!.references.find(
      (r) => r.target.kind === "feature",
    )!;
    const updated = await fixture.execute({
      operation: "extrude.update",
      featureId: (
        feature.target as Extract<typeof feature.target, { kind: "feature" }>
      ).featureId,
      depth: 12,
      intent: "fulfill",
    });
    expect(updated.outcome, JSON.stringify(updated)).toEqual({
      kind: "completed",
      change: "changed",
    });
    expect(dimensions(updated)[2]).toBeCloseTo(12, 6);
  } finally {
    await fixture.close();
  }
}, 60000);

it("reopens a published sketch, changes its driving width and awaits the downstream solid rebuild", async () => {
  const fixture = await plate();
  try {
    const created = await fixture.execute({
      operation: "extrude.create",
      profile: fixture.profile,
      depth: 7,
      intent: "fulfill",
    });
    expect(created.outcome.kind, JSON.stringify(created)).toBe("completed");
    const opened = await fixture.execute({
      operation: "sketch.open",
      sketchId: fixture.profile.sketchId,
    });
    expect(opened.outcome, JSON.stringify(opened)).toEqual({
      kind: "completed",
      change: "changed",
    });
    const width = opened.discovery!.sketch!.requirements.find(
      (d) => d.measuredValue === 20,
    )!;
    const changed = await fixture.execute({
      operation: "sketch.dimension.update",
      draft: opened.discovery!.state.draft!,
      dimensionId: width.dimensionId,
      value: 35,
      intent: "fulfill",
    });
    expect(changed.outcome.kind, JSON.stringify(changed)).toBe("completed");
    const published = await fixture.execute({
      operation: "sketch.publish",
      draft: changed.discovery!.state.draft!,
      requireProfiles: true,
    });
    expect(published.outcome.kind, JSON.stringify(published)).toBe("completed");
    const size = dimensions(published);
    expect(size[0]).toBeCloseTo(35, 6);
    expect(size[1]).toBeCloseTo(10, 6);
    expect(size[2]).toBeCloseTo(7, 6);
    expect(published.completion.geometry).toMatchObject({
      kind: "current",
      rebuildRevisionId: published.discovery!.state.revisionId,
    });
  } finally {
    await fixture.close();
  }
}, 60000);
