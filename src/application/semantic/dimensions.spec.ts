import { expect, it } from "vitest";
import { createHeadlessSessionFactory } from "@/composition/headless";
import { createSemanticSessionFactory, createSemanticResult } from "./session";
import type { SemanticDocumentPort } from "./document-port";
import type {
  SemanticCommand,
  SemanticResult,
  SemanticState,
} from "@/contracts/semantic/schema";

type DraftCommand = Extract<SemanticCommand, { draft: unknown }>;
type Input<T = DraftCommand> = T extends DraftCommand
  ? Omit<T, "version" | "commandId" | "basis" | "draft">
  : never;

async function rectangle() {
  const opened = await createHeadlessSessionFactory().open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  const session = opened.session;
  let current: SemanticResult = await session.execute({
    version: 1,
    commandId: "begin",
    operation: "sketch.begin",
    basis: opened.initialization.state,
    plane: "xy",
  });
  let sequence = 0;
  async function execute(input: Input) {
    current = await session.execute({
      ...input,
      version: 1,
      commandId: `edit-${++sequence}`,
      basis: current.discovery!.state,
      draft: current.discovery!.state.draft!,
    } as SemanticCommand);
    return current;
  }
  await execute({
    operation: "sketch.author",
    primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
    construction: false,
    intent: "fulfill",
  });
  return { execute, initial: current, close: () => session.close() };
}

it("drives rectangle width through semantic point targets and returns the measured requirement identity", async () => {
  const fixture = await rectangle();
  try {
    const discovery = fixture.initial.discovery!;
    const context = discovery.state.editingContext;
    expect(context.kind).toBe("sketch");
    if (context.kind !== "sketch")
      throw new Error("Expected private sketch owner");
    const pointReferences = discovery.references.filter(
      (r) => r.target.kind === "sketchPoint",
    );
    expect(pointReferences).toHaveLength(4);
    expect(
      pointReferences.every(
        (r) =>
          r.target.kind === "sketchPoint" &&
          r.target.sketchId === context.sketchId,
      ),
    ).toBe(true);
    const points = discovery.sketch!.points;
    const result = await fixture.execute({
      operation: "sketch.dimension.add",
      axis: "horizontal",
      points: [points[0]!.pointId, points[1]!.pointId],
      mode: "driving",
      value: 30,
      intent: "fulfill",
    });
    expect(result.outcome, JSON.stringify(result)).toEqual({
      kind: "completed",
      change: "changed",
    });
    expect(result.discovery!.sketch!.requirements).toEqual([
      expect.objectContaining({
        dimensionId: expect.any(String),
        mode: "driving",
        value: 30,
      }),
    ]);
    expect(
      result.discovery!.sketch!.requirements[0]!.measuredValue,
    ).toBeCloseTo(30, 6);
    const solved = result.discovery!.sketch!.points;
    expect(
      Math.abs(solved[1]!.position[0] - solved[0]!.position[0]),
    ).toBeCloseTo(30, 6);
    expect(result.discovery!.sketch!.profiles).toHaveLength(1);
    expect(result.completion.geometry.kind).toBe("current");
  } finally {
    await fixture.close();
  }
}, 60000);

it("updates the same driving height identity and refreshes geometry and measurements", async () => {
  const fixture = await rectangle();
  try {
    const points = fixture.initial.discovery!.sketch!.points;
    const added = await fixture.execute({
      operation: "sketch.dimension.add",
      axis: "vertical",
      points: [points[1]!.pointId, points[2]!.pointId],
      mode: "driving",
      value: 15,
      intent: "fulfill",
    });
    expect(added.outcome.kind).toBe("completed");
    expect(added.discovery!.sketch!.requirements[0]!.measuredValue).toBeCloseTo(
      15,
      6,
    );
    const dimensionId = added.discovery!.sketch!.requirements[0]!.dimensionId;
    const updated = await fixture.execute({
      operation: "sketch.dimension.update",
      dimensionId,
      value: 25,
      intent: "fulfill",
    });
    expect(updated.outcome, JSON.stringify(updated)).toEqual({
      kind: "completed",
      change: "changed",
    });
    expect(updated.discovery!.sketch!.requirements).toEqual([
      expect.objectContaining({ dimensionId, value: 25 }),
    ]);
    expect(
      updated.discovery!.sketch!.requirements[0]!.measuredValue,
    ).toBeCloseTo(25, 6);
    const solved = updated.discovery!.sketch!.points;
    expect(
      Math.abs(solved[2]!.position[1] - solved[1]!.position[1]),
    ).toBeCloseTo(25, 6);
    expect(updated.discovery!.sketch!.profiles).toHaveLength(1);
    expect(updated.discovery!.state.draft!.generation).toBeGreaterThan(
      added.discovery!.state.draft!.generation,
    );
    expect(updated.discovery!.settings).toEqual({
      linearUnit: "millimeter",
      modelingTolerance: 0.001,
      angularToleranceRadians: 0.0001,
    });
  } finally {
    await fixture.close();
  }
}, 60000);

it("keeps a reference measurement non-driving and updates its solved value after a driver edit", async () => {
  const fixture = await rectangle();
  try {
    const points = fixture.initial.discovery!.sketch!.points;
    const pair = [points[0]!.pointId, points[1]!.pointId] as const;
    const reference = await fixture.execute({
      operation: "sketch.dimension.add",
      axis: "horizontal",
      points: pair,
      mode: "reference",
      intent: "fulfill",
    });
    expect(reference.outcome.kind).toBe("completed");
    expect(reference.discovery!.sketch!.requirements).toEqual([]);
    expect(reference.discovery!.sketch!.measurements).toHaveLength(1);
    expect(
      reference.discovery!.sketch!.measurements[0]!.measuredValue,
    ).toBeCloseTo(20, 6);
    const driver = await fixture.execute({
      operation: "sketch.dimension.add",
      axis: "horizontal",
      points: pair,
      mode: "driving",
      value: 35,
      intent: "fulfill",
    });
    expect(driver.outcome, JSON.stringify(driver)).toEqual({
      kind: "completed",
      change: "changed",
    });
    expect(
      driver.discovery!.sketch!.measurements[0]!.measuredValue,
    ).toBeCloseTo(35, 6);
    expect(
      driver.discovery!.sketch!.requirements[0]!.measuredValue,
    ).toBeCloseTo(35, 6);
    expect(driver.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await fixture.close();
  }
}, 60000);

it("converts an edited reference to a driving requirement without changing its identity", async () => {
  const fixture = await rectangle();
  try {
    const points = fixture.initial.discovery!.sketch!.points;
    const reference = await fixture.execute({
      operation: "sketch.dimension.add",
      axis: "horizontal",
      points: [points[0]!.pointId, points[1]!.pointId],
      mode: "reference",
      intent: "fulfill",
    });
    const dimensionId =
      reference.discovery!.sketch!.measurements[0]!.dimensionId;
    const converted = await fixture.execute({
      operation: "sketch.dimension.update",
      dimensionId,
      value: 28,
      intent: "fulfill",
    });
    expect(converted.outcome, JSON.stringify(converted)).toEqual({
      kind: "completed",
      change: "changed",
    });
    expect(converted.discovery!.sketch!.measurements).toEqual([]);
    expect(converted.discovery!.sketch!.requirements).toEqual([
      expect.objectContaining({ dimensionId, value: 28 }),
    ]);
    expect(
      converted.discovery!.sketch!.requirements[0]!.measuredValue,
    ).toBeCloseTo(28, 6);
    expect(converted.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await fixture.close();
  }
}, 60000);

it("awaits a late dimension failure after abort and close without inventing fulfillment", async () => {
  const state: SemanticState = {
    documentId: "doc_test",
    revisionId: "rev_test",
    repositoryHeads: [],
    editingContext: { kind: "sketch", sketchId: "sketch_test" },
    draft: { commandSessionId: "command_test", generation: 1 },
  };
  const command: SemanticCommand = {
    version: 1,
    commandId: "dimension",
    operation: "sketch.dimension.update",
    basis: state,
    draft: state.draft!,
    dimensionId: "dimension_test",
    value: 40,
    intent: "fulfill",
  };
  let finish!: (result: SemanticResult) => void;
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const delayed = new Promise<SemanticResult>((resolve) => {
    finish = resolve;
  });
  let released = false;
  const owner: SemanticDocumentPort = {
    initialize: async () => ({
      kind: "ready",
      discovery: { state, references: [], history: null },
    }),
    create: async () => {
      throw new Error("Unused");
    },
    inspect: async () => ({
      discovery: { state, references: [], history: null },
      diagnostics: [],
    }),
    sketch: async () => {
      start();
      return delayed;
    },
    drain: async () => {},
    release: async () => {
      released = true;
    },
  };
  const opened = await createSemanticSessionFactory(async () => owner).open();
  if (opened.kind !== "ready") throw new Error("Expected ready");
  const abort = new AbortController();
  let settled = false;
  const pending = opened.session
    .execute(command, { signal: abort.signal })
    .then((result) => {
      settled = true;
      return result;
    });
  await started;
  abort.abort();
  const closing = opened.session.close();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(released).toBe(false);
  const late = createSemanticResult(command, state);
  late.outcome = { kind: "failed", failures: ["geometry"] };
  late.completion.live = {
    kind: "applied",
    state: { ...state, draft: { ...state.draft!, generation: 2 } },
  };
  late.completion.geometry = {
    kind: "failed",
    state: late.completion.live.state,
    sketchBasis: late.completion.live.state.draft,
    solve: { kind: "synchronous", generation: 2 },
    derivation: { requestId: "request_final", generation: 2 },
    rebuildRevisionId: null,
  };
  late.diagnostics = [
    {
      code: "late-dimension",
      severity: "error",
      message: "Final dimension generation failed",
      target: null,
      detail: null,
    },
  ];
  finish(late);
  expect(await pending).toEqual(late);
  expect(await closing).toMatchObject({
    kind: "closed",
    settled: [late],
    resourcesReleased: true,
  });
  expect(released).toBe(true);
});

it.each(["fulfill", "author-invalid"] as const)(
  "never fulfills conflicting width requirements requested as %s",
  async (intent) => {
    const fixture = await rectangle();
    try {
      const points = fixture.initial.discovery!.sketch!.points;
      const pair = [points[0]!.pointId, points[1]!.pointId] as const;
      await fixture.execute({
        operation: "sketch.dimension.add",
        axis: "horizontal",
        points: pair,
        mode: "driving",
        value: 30,
        intent: "fulfill",
      });
      const conflict = await fixture.execute({
        operation: "sketch.dimension.add",
        axis: "horizontal",
        points: pair,
        mode: "driving",
        value: 40,
        intent,
      });
      expect(conflict.outcome.kind, JSON.stringify(conflict)).toBe(
        intent === "author-invalid" ? "accepted-invalid" : "failed",
      );
      expect(conflict.completion.geometry.kind).toBe("invalid-editable");
      expect(conflict.completion.live.kind).toBe("applied");
      expect(
        conflict.discovery!.sketch!.requirements.map((d) => d.value),
      ).toEqual([30, 40]);
      expect(conflict.discovery!.sketch!.profiles).toEqual([]);
      expect(conflict.diagnostics.length).toBeGreaterThan(0);
    } finally {
      await fixture.close();
    }
  },
  60000,
);
