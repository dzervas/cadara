import { expect, it } from "vitest";
import { createHeadlessSessionFactory } from "@/composition/headless";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";

function basis(result: SemanticResult) {
  const { documentId, revisionId, repositoryHeads } = result.discovery!.state;
  return { documentId, revisionId, repositoryHeads };
}

it("authors a rectangle as private geometry and discovers a current closed profile", async () => {
  const opened = await createHeadlessSessionFactory().open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const inspected = await opened.session.execute({
      version: 1,
      commandId: "inspect",
      operation: "document.inspect",
      basis: opened.initialization.state,
    });
    const begun = await opened.session.execute({
      version: 1,
      commandId: "begin",
      operation: "sketch.begin",
      basis: basis(inspected),
      plane: "xy",
    });
    const authored = await opened.session.execute({
      version: 1,
      commandId: "rectangle",
      operation: "sketch.author",
      basis: basis(begun),
      draft: begun.discovery!.state.draft!,
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
    });
    expect(authored.outcome, JSON.stringify(authored)).toEqual({
      kind: "completed",
      change: "changed",
    });
    expect(authored.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ]);
    expect(authored.discovery!.sketch!.entities).toHaveLength(4);
    expect(authored.discovery!.sketch!.profiles).toEqual([
      { regionId: expect.any(String), isClosed: true },
    ]);
    expect(authored.discovery!.state.revisionId).toBe(
      inspected.discovery!.state.revisionId,
    );
    expect(authored.completion.geometry.kind).toBe("current");
    expect(
      validateSemanticResult(authored.correlation, authored).success,
      JSON.stringify(validateSemanticResult(authored.correlation, authored)),
    ).toBe(true);
  } finally {
    await opened.session.close();
  }
}, 30000);

it("publishes the prepared rectangle through the document owner with a committed receipt", async () => {
  const opened = await createHeadlessSessionFactory().open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const begun = await opened.session.execute({
      version: 1,
      commandId: "begin",
      operation: "sketch.begin",
      basis: opened.initialization.state,
      plane: "yz",
    });
    const authored = await opened.session.execute({
      version: 1,
      commandId: "rectangle",
      operation: "sketch.author",
      basis: basis(begun),
      draft: begun.discovery!.state.draft!,
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
    });
    const published = await opened.session.execute({
      version: 1,
      commandId: "publish",
      operation: "sketch.publish",
      basis: basis(authored),
      draft: authored.discovery!.state.draft!,
      requireProfiles: true,
    });
    expect(published.outcome, JSON.stringify(published)).toEqual({
      kind: "completed",
      change: "changed",
    });
    expect(published.discovery!.state.draft).toBeNull();
    expect(published.discovery!.state.revisionId).not.toBe(
      authored.discovery!.state.revisionId,
    );
    expect(published.completion.persistence.kind).toBe("committed");
    expect(
      published.discovery!.references.some((r) => r.target.kind === "sketch"),
    ).toBe(true);
    expect(published.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ]);
    expect(published.discovery!.sketch!.profiles).toEqual([
      { regionId: expect.any(String), isClosed: true },
    ]);
    expect(
      validateSemanticResult(published.correlation, published).success,
      JSON.stringify(published),
    ).toBe(true);
  } finally {
    await opened.session.close();
  }
}, 30000);

it("discards the entire draft and refuses old draft identities", async () => {
  const opened = await createHeadlessSessionFactory().open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const begun = await opened.session.execute({
      version: 1,
      commandId: "begin",
      operation: "sketch.begin",
      basis: opened.initialization.state,
      plane: "xz",
    });
    const authored = await opened.session.execute({
      version: 1,
      commandId: "point",
      operation: "sketch.author",
      basis: basis(begun),
      draft: begun.discovery!.state.draft!,
      primitive: { kind: "point", position: [3, 4] },
      construction: true,
      intent: "fulfill",
    });
    expect(authored.discovery!.sketch!.points).toEqual([
      { pointId: expect.any(String), position: [3, 4], construction: true },
    ]);
    const discarded = await opened.session.execute({
      version: 1,
      commandId: "discard",
      operation: "sketch.discard",
      basis: basis(authored),
      draft: authored.discovery!.state.draft!,
    });
    expect(discarded.outcome).toEqual({ kind: "completed", change: "changed" });
    expect(discarded.discovery!.state).toMatchObject({
      revisionId: opened.initialization.state.revisionId,
      draft: null,
      editingContext: { kind: "document" },
    });
    expect(
      discarded.discovery!.references.some((r) => r.target.kind === "sketch"),
    ).toBe(false);
    const again = await opened.session.execute({
      version: 1,
      commandId: "again",
      operation: "sketch.begin",
      basis: basis(discarded),
      plane: "xy",
    });
    const stale = await opened.session.execute({
      version: 1,
      commandId: "stale",
      operation: "sketch.author",
      basis: basis(again),
      draft: authored.discovery!.state.draft!,
      primitive: { kind: "point", position: [99, 99] },
      construction: false,
      intent: "fulfill",
    });
    expect(stale.outcome.kind).toBe("conflicted");
    const inspected = await opened.session.execute({
      version: 1,
      commandId: "inspect-new",
      operation: "sketch.inspect",
      basis: basis(again),
      draft: again.discovery!.state.draft!,
    });
    expect(inspected.discovery!.sketch!.points).toEqual([]);
  } finally {
    await opened.session.close();
  }
}, 30000);

it.each([
  {
    primitive: {
      kind: "centerPointRectangle" as const,
      start: [0, 0] as const,
      end: [10, 5] as const,
    },
    positions: [
      [-10, -5],
      [10, -5],
      [10, 5],
      [-10, 5],
      [0, 0],
    ],
  },
  {
    primitive: {
      kind: "alignedRectangle" as const,
      start: [0, 0] as const,
      end: [10, 0] as const,
      heightPoint: [4, 5] as const,
    },
    positions: [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ],
  },
])(
  "authors $primitive.kind using the shared requirements and preserves solved geometry",
  async ({ primitive, positions }) => {
    const opened = await createHeadlessSessionFactory().open();
    if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
    try {
      const begun = await opened.session.execute({
        version: 1,
        commandId: "begin",
        operation: "sketch.begin",
        basis: opened.initialization.state,
        plane: "xy",
      });
      const authored = await opened.session.execute({
        version: 1,
        commandId: "author",
        operation: "sketch.author",
        basis: basis(begun),
        draft: begun.discovery!.state.draft!,
        primitive,
        construction: false,
        intent: "fulfill",
      });
      expect(authored.outcome, JSON.stringify(authored)).toEqual({
        kind: "completed",
        change: "changed",
      });
      expect(authored.discovery!.sketch!.points.map((p) => p.position)).toEqual(
        positions,
      );
      expect(authored.discovery!.sketch!.profiles).toEqual([
        { regionId: expect.any(String), isClosed: true },
      ]);
      expect(authored.discovery!.sketch!.validity.state).toBe("current");
      const stale = await opened.session.execute({
        version: 1,
        commandId: "stale",
        operation: "sketch.inspect",
        basis: basis(authored),
        draft: begun.discovery!.state.draft!,
      });
      expect(stale.outcome.kind).toBe("conflicted");
    } finally {
      await opened.session.close();
    }
  },
  30000,
);

it("rejects degenerate and non-finite inputs without authoring and fails closed on missing profiles", async () => {
  const opened = await createHeadlessSessionFactory().open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const begun = await opened.session.execute({
      version: 1,
      commandId: "begin",
      operation: "sketch.begin",
      basis: opened.initialization.state,
      plane: "xy",
    });
    for (const [index, primitive] of [
      { kind: "line" as const, start: [0, 0] as const, end: [0, 0] as const },
      { kind: "point" as const, position: [NaN, 0] as const },
      {
        kind: "alignedRectangle" as const,
        start: [0, 0] as const,
        end: [10, 0] as const,
        heightPoint: [5, 0] as const,
      },
    ].entries()) {
      const refused = await opened.session.execute({
        version: 1,
        commandId: `invalid-${index}`,
        operation: "sketch.author",
        basis: basis(begun),
        draft: begun.discovery!.state.draft!,
        primitive,
        construction: false,
        intent: "fulfill",
      });
      expect(refused.outcome.kind).toBe("rejected");
      expect(refused.completion.live.kind).toBe("unchanged");
    }
    const line = await opened.session.execute({
      version: 1,
      commandId: "line",
      operation: "sketch.author",
      basis: basis(begun),
      draft: begun.discovery!.state.draft!,
      primitive: { kind: "line", start: [0, 0], end: [10, 0] },
      construction: false,
      intent: "fulfill",
    });
    expect(line.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(line.discovery!.sketch!.profiles).toEqual([]);
    const refused = await opened.session.execute({
      version: 1,
      commandId: "publish",
      operation: "sketch.publish",
      basis: basis(line),
      draft: line.discovery!.state.draft!,
      requireProfiles: true,
    });
    expect(refused.outcome).toEqual({
      kind: "rejected",
      reasonCode: "profiles-unusable",
    });
    expect(refused.completion.live.state!.draft).toEqual(
      line.discovery!.state.draft,
    );
  } finally {
    await opened.session.close();
  }
}, 30000);

it("retains explicitly authored invalid geometry as an editable draft, never usable profiles", async () => {
  const opened = await createHeadlessSessionFactory().open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const begun = await opened.session.execute({
      version: 1,
      commandId: "begin",
      operation: "sketch.begin",
      basis: opened.initialization.state,
      plane: "xy",
    });
    const invalid = await opened.session.execute({
      version: 1,
      commandId: "invalid",
      operation: "sketch.author",
      basis: basis(begun),
      draft: begun.discovery!.state.draft!,
      primitive: { kind: "rectangle", start: [0, 0], end: [10, 0] },
      construction: false,
      intent: "author-invalid",
    });
    expect(invalid.outcome, JSON.stringify(invalid)).toEqual({
      kind: "accepted-invalid",
    });
    expect(invalid.completion.live.kind).toBe("applied");
    expect(invalid.discovery!.sketch!.profiles).toEqual([]);
    expect(invalid.discovery!.sketch!.validity.state).toBe("invalid");
    expect(invalid.diagnostics.length).toBeGreaterThan(0);
    const inspected = await opened.session.execute({
      version: 1,
      commandId: "inspect",
      operation: "sketch.inspect",
      basis: basis(invalid),
      draft: invalid.discovery!.state.draft!,
    });
    expect(inspected.outcome).toEqual({
      kind: "completed",
      change: "unchanged",
    });
    expect(inspected.discovery!.sketch!.points).toEqual(
      invalid.discovery!.sketch!.points,
    );
    expect(
      validateSemanticResult(invalid.correlation, invalid).success,
      JSON.stringify(invalid),
    ).toBe(true);
  } finally {
    await opened.session.close();
  }
}, 30000);

it("finishes an empty sketch without fictitious publication or persistence", async () => {
  const opened = await createHeadlessSessionFactory().open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const begun = await opened.session.execute({
      version: 1,
      commandId: "begin",
      operation: "sketch.begin",
      basis: opened.initialization.state,
      plane: "xy",
    });
    const finished = await opened.session.execute({
      version: 1,
      commandId: "finish",
      operation: "sketch.publish",
      basis: basis(begun),
      draft: begun.discovery!.state.draft!,
      requireProfiles: false,
    });
    expect(finished.outcome).toEqual({
      kind: "completed",
      change: "unchanged",
    });
    expect(finished.completion.persistence).toEqual({ kind: "not-required" });
    expect(finished.discovery!.state.draft).toBeNull();
    expect(finished.discovery!.state.revisionId).toBe(
      opened.initialization.state.revisionId,
    );
    expect(
      validateSemanticResult(finished.correlation, finished).success,
      JSON.stringify(finished),
    ).toBe(true);
  } finally {
    await opened.session.close();
  }
}, 30000);

it("opens an owned empty private sketch on XY with current geometry", async () => {
  const opened = await createHeadlessSessionFactory().open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const inspected = await opened.session.execute({
      version: 1,
      commandId: "inspect",
      operation: "document.inspect",
      basis: opened.initialization.state,
    });
    const begun = await opened.session.execute({
      version: 1,
      commandId: "begin",
      operation: "sketch.begin",
      basis: inspected.discovery!.state,
      plane: "xy",
    });
    expect(begun.outcome, JSON.stringify(begun)).toEqual({
      kind: "completed",
      change: "changed",
    });
    expect(begun.discovery?.state.editingContext.kind).toBe("sketch");
    expect(begun.completion.geometry.kind).toBe("current");
    expect(begun.discovery?.sketch).toMatchObject({
      plane: "xy",
      points: [],
      entities: [],
      profiles: [],
    });
  } finally {
    await opened.session.close();
  }
}, 30000);
