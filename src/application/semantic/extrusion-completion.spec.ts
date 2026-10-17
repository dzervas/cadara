import { expect, it } from "vitest";
import { createSemanticSessionFactory, createSemanticResult } from "./session";
import type { SemanticDocumentPort } from "./document-port";
import type {
  SemanticExtrudeCommand,
  SemanticResult,
  SemanticState,
} from "@/contracts/semantic/schema";

it("awaits a late model geometry failure after abort and close, preserving actual application", async () => {
  const initial: SemanticState = {
    documentId: "doc_test",
    revisionId: "rev_before",
    repositoryHeads: ["before"],
    editingContext: { kind: "document" },
    draft: null,
  };
  const command: SemanticExtrudeCommand = {
    version: 1,
    commandId: "extrude",
    operation: "extrude.create",
    basis: initial,
    profile: {
      kind: "region",
      sketchId: "sketch_test",
      regionId: "region_test",
    },
    depth: 7,
    intent: "fulfill",
  };
  let start!: () => void, finish!: (result: SemanticResult) => void;
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
      discovery: { state: initial, references: [], history: null },
    }),
    create: async () => {
      throw new Error("Unused");
    },
    inspect: async () => ({
      discovery: { state: initial, references: [], history: null },
      diagnostics: [],
    }),
    extrude: async () => {
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
  const state = {
    ...initial,
    revisionId: "rev_after" as const,
    repositoryHeads: ["after"],
  };
  const late = createSemanticResult(command, state);
  late.outcome = { kind: "failed", failures: ["geometry"] };
  late.completion.live = { kind: "applied", state };
  late.completion.handoff = { kind: "current", state };
  late.completion.geometry = {
    kind: "failed",
    state,
    sketchBasis: null,
    solve: null,
    derivation: null,
    rebuildRevisionId: state.revisionId,
  };
  late.completion.persistence = {
    kind: "committed",
    commandId: command.commandId,
    transactionId: "tx_exact",
    state,
  };
  late.discovery = { state, references: [], history: null };
  late.diagnostics = [
    {
      code: "late-extrusion",
      severity: "error",
      message: "Requested solid rebuild failed",
      target: null,
      detail: null,
    },
  ];
  finish(late);
  expect(await pending).toEqual(late);
  expect(await closing).toEqual({
    kind: "closed",
    settled: [late],
    resourcesReleased: true,
  });
  expect(released).toBe(true);
});
