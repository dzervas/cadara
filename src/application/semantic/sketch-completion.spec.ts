import { expect, it } from "vitest";
import { createSemanticSessionFactory, createSemanticResult } from "./session";
import type { SemanticDocumentPort } from "./document-port";
import type {
  SemanticResult,
  SemanticState,
  SemanticSketchCommand,
} from "@/contracts/semantic/schema";

const initial: SemanticState = {
  documentId: "doc_test",
  revisionId: "rev_initial",
  repositoryHeads: ["head"],
  editingContext: { kind: "document" },
  draft: null,
};
const command: SemanticSketchCommand = {
  version: 1,
  commandId: "begin",
  operation: "sketch.begin",
  basis: initial,
  plane: "xy",
};
const state: SemanticState = {
  ...initial,
  editingContext: { kind: "sketch", sketchId: "sketch_private" },
  draft: { commandSessionId: "command_private", generation: 3 },
};
function current(): SemanticResult {
  const result = createSemanticResult(command, initial);
  result.outcome = { kind: "completed", change: "changed" };
  result.completion.live = { kind: "applied", state };
  result.completion.handoff = { kind: "current", state };
  result.completion.geometry = {
    kind: "current",
    state,
    sketchBasis: state.draft,
    solve: { kind: "synchronous", generation: 3 },
    derivation: { requestId: "request_final", generation: 3 },
    rebuildRevisionId: null,
  };
  result.discovery = { state, references: [], history: null };
  return result;
}
function port(
  sketch: NonNullable<SemanticDocumentPort["sketch"]>,
  release = async () => {},
): SemanticDocumentPort {
  return {
    initialize: async () => ({
      kind: "ready",
      discovery: { state: initial, references: [], history: null },
    }),
    create: async () => {
      throw new Error("Unused");
    },
    inspect: async () => ({
      discovery: { state: initial, references: [], history: null },
      diagnostics: [],
    }),
    sketch,
    drain: async () => {},
    release,
  };
}
it("waits for the terminal sketch owner outcome and retains a late failure even after abort and close", async () => {
  let resolve!: (result: SemanticResult) => void;
  let started!: () => void;
  const ready = new Promise<void>((yes) => {
    started = yes;
  });
  const ownerResult = new Promise<SemanticResult>((yes) => {
    resolve = yes;
  });
  let released = false;
  const opened = await createSemanticSessionFactory(async () =>
    port(
      async () => {
        started();
        return ownerResult;
      },
      async () => {
        released = true;
      },
    ),
  ).open();
  if (opened.kind !== "ready") throw new Error("Expected ready");
  const abort = new AbortController();
  let settled = false;
  const pending = opened.session
    .execute(command, { signal: abort.signal })
    .then((result) => {
      settled = true;
      return result;
    });
  await ready;
  abort.abort();
  const closing = opened.session.close();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(released).toBe(false);
  const late = current();
  late.outcome = { kind: "failed", failures: ["geometry"] };
  late.completion.geometry = {
    ...late.completion.geometry,
    kind: "failed",
  } as SemanticResult["completion"]["geometry"];
  late.diagnostics = [
    {
      code: "late-derivation",
      severity: "error",
      message: "Final generation failed",
      target: null,
      detail: null,
    },
  ];
  resolve(late);
  expect(await pending).toEqual(late);
  expect(await closing).toMatchObject({
    kind: "closed",
    resourcesReleased: true,
    settled: [late],
  });
  expect(released).toBe(true);
});
it("preserves an applied sketch publication with a failed exact transaction instead of reporting rollback or fulfillment", async () => {
  const publication = {
    ...command,
    commandId: "publish",
    operation: "sketch.publish" as const,
    draft: state.draft!,
    requireProfiles: true,
  };
  const failed = current();
  failed.correlation = {
    ...failed.correlation,
    commandId: "publish",
    family: "sketch-publish",
  };
  failed.outcome = { kind: "failed", failures: ["persistence"] };
  failed.completion.persistence = {
    kind: "failed",
    commandId: "publish",
    transactionId: "tx_exact",
    state,
  };
  const opened = await createSemanticSessionFactory(async () =>
    port(async () => failed),
  ).open();
  if (opened.kind !== "ready") throw new Error("Expected ready");
  try {
    const result = await opened.session.execute(publication);
    expect(result).toEqual(failed);
    expect(result.completion.live).toEqual({ kind: "applied", state });
    expect(result.outcome).toEqual({
      kind: "failed",
      failures: ["persistence"],
    });
  } finally {
    await opened.session.close();
  }
});

it("refuses a stale-generation terminal certificate and never vends its profiles as current", async () => {
  const stale = current();
  if (stale.completion.geometry.kind !== "not-required")
    stale.completion.geometry.derivation = {
      requestId: "request_old",
      generation: 2,
    };
  const opened = await createSemanticSessionFactory(async () =>
    port(async () => stale),
  ).open();
  if (opened.kind !== "ready") throw new Error("Expected ready");
  try {
    const result = await opened.session.execute(command);
    expect(result.outcome.kind).toBe("failed");
    expect(result.completion.live).toEqual({ kind: "applied", state });
    expect(result.completion.geometry.kind).toBe("failed");
    expect(result.discovery).toBeNull();
    expect(
      result.diagnostics.some((d) =>
        d.message.includes("final current draft generation"),
      ),
    ).toBe(true);
  } finally {
    await opened.session.close();
  }
});
