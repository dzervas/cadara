import { expect, it } from "vitest";
import { createHeadlessSessionFactory } from "@/composition/headless";
import { createSemanticSessionFactory } from "./session";
import type { SemanticDocumentPort } from "./document-port";
import type { SemanticState } from "@/contracts/semantic/schema";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const initial: SemanticState = {
  documentId: "doc_test",
  revisionId: "rev_initial",
  repositoryHeads: ["head_initial"],
  editingContext: { kind: "document" },
  draft: null,
};
function documentPort(
  overrides: Partial<SemanticDocumentPort> = {},
): SemanticDocumentPort {
  return {
    initialize: async () => ({
      kind: "ready",
      discovery: { state: initial, references: [], history: null },
    }),
    create: async () => {
      throw new Error("Unused create");
    },
    inspect: async () => ({
      discovery: { state: initial, references: [], history: null },
      diagnostics: [],
    }),
    drain: async () => {},
    release: async () => {},
    ...overrides,
  };
}

it("creates and inspects one isolated document through terminal results", async () => {
  const opened = await createHeadlessSessionFactory().open();
  expect(opened.kind, JSON.stringify(opened)).toBe("ready");
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const created = await opened.session.execute({
      version: 1,
      commandId: "create",
      operation: "document.create",
      label: "Bracket",
      basis: null,
    });
    expect(created.outcome).toEqual({ kind: "completed", change: "changed" });
    expect(created.completion.persistence.kind).toBe("committed");
    expect(created.discovery).not.toBeNull();
    expect(created.discovery).toMatchObject({ document: { label: "Bracket" } });
    expect(
      created.discovery!.references.filter(
        (entry) => entry.target.kind === "construction",
      ),
    ).toHaveLength(3);
    const inspected = await opened.session.execute({
      version: 1,
      commandId: "inspect",
      operation: "document.inspect",
      basis: created.discovery!.state,
    });
    expect(inspected.outcome).toEqual({
      kind: "completed",
      change: "unchanged",
    });
    expect(inspected.discovery!.state).toEqual(created.discovery!.state);
    expect(inspected.correlation.commandId).toBe("inspect");
    expect(inspected.completion.handoff.kind).toBe("current");
  } finally {
    expect(await opened.session.close()).toMatchObject({
      kind: "closed",
      resourcesReleased: true,
    });
  }
}, 30000);

it("cancels pre-aborted commands without applying document work", async () => {
  const opened = await createSemanticSessionFactory(async () =>
    documentPort(),
  ).open();
  if (opened.kind !== "ready") throw new Error("Expected ready");
  const signal = new AbortController();
  signal.abort();
  try {
    await expect(
      opened.session.execute(
        {
          version: 1,
          commandId: "aborted",
          operation: "document.create",
          label: "Never",
          basis: null,
        },
        { signal: signal.signal },
      ),
    ).resolves.toMatchObject({
      outcome: { kind: "canceled", phase: "not-started" },
      completion: { live: { kind: "unchanged", state: initial } },
    });
  } finally {
    await opened.session.close();
  }
});

it("does not turn a late accepted execution failure into success merely because handoff succeeds", async () => {
  const opened = await createSemanticSessionFactory(async () =>
    documentPort({
      create: async () => ({
        state: initial,
        failure: "execution",
        persistence: {
          kind: "committed",
          commandId: "late",
          transactionId: "tx_late",
          state: initial,
        },
        diagnostics: [
          {
            code: "late-failure",
            severity: "error",
            message: "late restore failure",
            target: null,
            detail: null,
          },
        ],
      }),
    }),
  ).open();
  if (opened.kind !== "ready") throw new Error("Expected ready");
  try {
    const terminal = await opened.session.execute({
      version: 1,
      commandId: "late",
      operation: "document.create",
      label: "Part",
      basis: null,
    });
    expect(terminal.outcome).toEqual({
      kind: "failed",
      failures: ["execution"],
    });
    expect(terminal.completion).toMatchObject({
      live: { kind: "applied" },
      persistence: { kind: "committed" },
      handoff: { kind: "current" },
    });
    expect(terminal.diagnostics[0]!.message).toBe("late restore failure");
  } finally {
    await opened.session.close();
  }
});

it("refuses stale snapshot handoff after a committed creation", async () => {
  const applied: SemanticState = { ...initial, revisionId: "rev_applied" };
  const opened = await createSemanticSessionFactory(async () =>
    documentPort({
      create: async () => ({
        state: applied,
        persistence: {
          kind: "committed",
          commandId: "create",
          transactionId: "tx",
          state: applied,
        },
        diagnostics: [],
      }),
    }),
  ).open();
  if (opened.kind !== "ready") throw new Error("Expected ready");
  try {
    const terminal = await opened.session.execute({
      version: 1,
      commandId: "create",
      operation: "document.create",
      label: "Part",
      basis: null,
    });
    expect(terminal.outcome).toEqual({ kind: "failed", failures: ["handoff"] });
    expect(terminal.completion.live).toEqual({
      kind: "applied",
      state: applied,
    });
    expect(terminal.discovery).toBeNull();
  } finally {
    await opened.session.close();
  }
});

it("settles partial startup failure and reports failed resource release instead of returning ready", async () => {
  const initialization =
    deferred<Awaited<ReturnType<SemanticDocumentPort["initialize"]>>>();
  const acquired = deferred<void>();
  const aborted = new AbortController();
  let releases = 0;
  const opening = createSemanticSessionFactory(async () => {
    acquired.resolve();
    return documentPort({
      initialize: () => initialization.promise,
      release: async () => {
        releases += 1;
        throw new Error("release failed");
      },
    });
  }).open({ signal: aborted.signal });
  await acquired.promise;
  aborted.abort();
  initialization.resolve({
    kind: "failed",
    diagnostics: [
      {
        code: "restore-failed",
        severity: "error",
        message: "restore failed",
        target: null,
        detail: null,
      },
    ],
  });
  expect(await opening).toMatchObject({
    kind: "canceled",
    diagnostics: [{ message: "restore failed" }],
    cleanup: {
      kind: "failed",
      resourcesReleased: false,
      failures: ["release"],
      diagnostics: [{ message: "release failed" }],
    },
  });
  expect(releases).toBe(1);
});

it("reports failed native initialization once and releases the owner without a spurious flush failure", async () => {
  const opened = await createHeadlessSessionFactory({
    assetDirectory: "/nonexistent-cadara-assets",
  }).open();
  expect(opened).toMatchObject({
    kind: "failed",
    cleanup: { kind: "closed", resourcesReleased: true },
  });
  if (opened.kind === "ready") throw new Error("Unexpected ready");
  expect(opened.diagnostics).toHaveLength(1);
  expect(opened.cleanup).toEqual({
    kind: "closed",
    settled: [],
    resourcesReleased: true,
  });
});

it("close cancels queued work but drains accepted work and retains late persistence/handoff failure after abort", async () => {
  const accepted =
    deferred<Awaited<ReturnType<SemanticDocumentPort["create"]>>>();
  const started = deferred<void>();
  const drain = deferred<void>();
  const applied: SemanticState = {
    ...initial,
    revisionId: "rev_applied",
    repositoryHeads: ["head_applied"],
  };
  let released = 0;
  const opened = await createSemanticSessionFactory(async () =>
    documentPort({
      create: () => {
        started.resolve();
        return accepted.promise;
      },
      inspect: async () => {
        throw new Error("late handoff failure");
      },
      drain: () => drain.promise,
      release: async () => {
        released += 1;
      },
    }),
  ).open();
  if (opened.kind !== "ready") throw new Error("Expected ready");
  const abort = new AbortController();
  const live = opened.session.execute(
    {
      version: 1,
      commandId: "live",
      operation: "document.create",
      label: "Part",
      basis: null,
    },
    { signal: abort.signal },
  );
  await started.promise;
  const queued = opened.session.execute({
    version: 1,
    commandId: "queued",
    operation: "document.inspect",
    basis: initial,
  });
  abort.abort();
  const closing = opened.session.close();
  expect(opened.session.close()).toBe(closing);
  await expect(
    opened.session.execute({
      version: 1,
      commandId: "late",
      operation: "document.inspect",
      basis: initial,
    }),
  ).resolves.toMatchObject({ outcome: { kind: "unavailable" } });
  accepted.resolve({
    state: applied,
    persistence: {
      kind: "failed",
      commandId: "live",
      transactionId: "transaction_live",
      state: applied,
    },
    diagnostics: [],
  });
  const terminal = await live;
  expect(terminal.outcome).toEqual({
    kind: "failed",
    failures: ["persistence", "handoff"],
  });
  expect(terminal.completion.live).toEqual({ kind: "applied", state: applied });
  expect(terminal.discovery).toBeNull();
  await expect(queued).resolves.toMatchObject({
    outcome: { kind: "canceled", phase: "not-started" },
  });
  expect(released).toBe(0);
  drain.resolve();
  const cleanup = await closing;
  expect(cleanup).toMatchObject({
    kind: "closed",
    settled: [terminal, { outcome: { kind: "canceled" } }],
    resourcesReleased: true,
  });
  expect(released).toBe(1);
});
