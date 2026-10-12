import { describe, expect, test } from "vitest";
import {
  validateSemanticCommand,
  validateSemanticResult,
} from "./runtime-schema";
import type {
  SemanticCorrelation,
  SemanticResult,
  SemanticState,
} from "./schema";

const state: SemanticState = {
  documentId: "doc_part",
  revisionId: "rev_3",
  repositoryHeads: ["head-3"],
  editingContext: { kind: "document" },
  draft: null,
};
const correlation: SemanticCorrelation = {
  commandId: "extrude-1",
  family: "model-mutate",
  intent: "fulfill",
  basis: {
    documentId: "doc_part",
    revisionId: "rev_2",
    repositoryHeads: ["head-2"],
  },
};

function completedResult(): SemanticResult {
  return {
    version: 1,
    correlation,
    outcome: { kind: "completed", change: "changed" },
    completion: {
      live: { kind: "applied", state },
      handoff: { kind: "current", state },
      geometry: {
        kind: "current",
        state,
        sketchBasis: null,
        solve: null,
        derivation: null,
        rebuildRevisionId: "rev_3",
      },
      persistence: {
        kind: "committed",
        commandId: "extrude-1",
        transactionId: "tx-1",
        state,
      },
      file: { kind: "not-required" },
    },
    diagnostics: [],
    discovery: {
      state,
      references: [
        { label: "Body", target: { kind: "body", bodyId: "body_part" } },
      ],
      history: null,
    },
  };
}

describe("semantic command boundary", () => {
  test("a live applied mutation with failed requested geometry is not completed fulfillment", () => {
    const result = completedResult();
    expect(validateSemanticResult(correlation, result).success).toBe(true);
    const failedGeometry = {
      ...result,
      completion: {
        ...result.completion,
        geometry: { ...result.completion.geometry, kind: "failed" },
      },
    };
    expect(validateSemanticResult(correlation, failedGeometry).success).toBe(
      false,
    );
    expect(
      validateSemanticResult(correlation, {
        ...failedGeometry,
        outcome: { kind: "failed", failures: ["geometry"] },
      }).success,
    ).toBe(true);
  });
  test("invalid editable acceptance is explicit and cancellation cannot hide applied state", () => {
    const result = completedResult();
    const invalid = {
      ...result,
      completion: {
        ...result.completion,
        geometry: { ...result.completion.geometry, kind: "invalid-editable" },
      },
      outcome: { kind: "accepted-invalid" },
    };
    expect(validateSemanticResult(correlation, invalid).success).toBe(false);
    const authorInvalid: SemanticCorrelation = {
      ...correlation,
      intent: "author-invalid",
    };
    expect(
      validateSemanticResult(authorInvalid, {
        ...invalid,
        correlation: authorInvalid,
      }).success,
    ).toBe(true);
    expect(
      validateSemanticResult(correlation, {
        ...result,
        outcome: { kind: "canceled", phase: "before-apply" },
      }).success,
    ).toBe(false);
  });

  test("late persistence failure remains correlated and never vends stale handoff references", () => {
    const result = completedResult();
    const failedWrite = {
      ...result,
      outcome: { kind: "failed", failures: ["persistence"] },
      completion: {
        ...result.completion,
        persistence: { ...result.completion.persistence, kind: "failed" },
      },
    };
    expect(validateSemanticResult(correlation, failedWrite).success).toBe(true);
    expect(
      validateSemanticResult(correlation, {
        ...failedWrite,
        completion: {
          ...failedWrite.completion,
          persistence: {
            ...failedWrite.completion.persistence,
            commandId: "other-command",
          },
        },
      }).success,
    ).toBe(false);
    const badHandoff = {
      ...failedWrite,
      outcome: { kind: "failed", failures: ["handoff", "persistence"] },
      completion: { ...failedWrite.completion, handoff: { kind: "failed" } },
    };
    expect(validateSemanticResult(correlation, badHandoff).success).toBe(false);
    expect(
      validateSemanticResult(correlation, { ...badHandoff, discovery: null })
        .success,
    ).toBe(true);
  });

  test("completion cannot omit required rebuild, handoff, or save barriers", () => {
    const result = completedResult();
    for (const barrier of ["geometry", "handoff", "persistence"] as const) {
      expect(
        validateSemanticResult(correlation, {
          ...result,
          completion: {
            ...result.completion,
            [barrier]: { kind: "not-required" },
          },
        }).success,
      ).toBe(false);
    }
    const saveCorrelation: SemanticCorrelation = {
      ...correlation,
      family: "file-save",
    };
    const save = {
      ...result,
      correlation: saveCorrelation,
      completion: { ...result.completion, geometry: { kind: "not-required" } },
    };
    expect(validateSemanticResult(saveCorrelation, save).success).toBe(false);
    expect(
      validateSemanticResult(saveCorrelation, {
        ...save,
        completion: {
          ...save.completion,
          file: {
            kind: "written",
            commandId: "extrude-1",
            state,
            path: "/output/part.cadara",
            bytesWritten: 512,
          },
        },
      }).success,
    ).toBe(true);
  });

  test("only the final matching solve and region generation can certify a sketch", () => {
    const sketchState: SemanticState = {
      ...state,
      editingContext: { kind: "sketch", sketchId: "sketch_profile" },
      draft: { commandSessionId: "command_sketch", generation: 4 },
    };
    const sketchCorrelation: SemanticCorrelation = {
      ...correlation,
      family: "sketch-author",
    };
    const result = completedResult();
    const sketch = {
      ...result,
      correlation: sketchCorrelation,
      completion: {
        live: { kind: "applied", state: sketchState },
        handoff: { kind: "current", state: sketchState },
        geometry: {
          kind: "current",
          state: sketchState,
          sketchBasis: sketchState.draft,
          solve: { requestId: "request_solve", generation: 4 },
          derivation: { requestId: "request_regions", generation: 4 },
          rebuildRevisionId: null,
        },
        persistence: { kind: "not-required" },
        file: { kind: "not-required" },
      },
      discovery: { state: sketchState, references: [], history: null },
    };
    expect(validateSemanticResult(sketchCorrelation, sketch).success).toBe(
      true,
    );
    expect(
      validateSemanticResult(sketchCorrelation, {
        ...sketch,
        completion: {
          ...sketch.completion,
          geometry: {
            ...sketch.completion.geometry,
            derivation: { requestId: "request_old", generation: 3 },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      validateSemanticResult(sketchCorrelation, {
        ...sketch,
        completion: {
          ...sketch.completion,
          geometry: { ...sketch.completion.geometry, derivation: null },
        },
      }).success,
    ).toBe(false);
    expect(
      validateSemanticResult(correlation, {
        ...result,
        completion: {
          ...result.completion,
          geometry: { ...result.completion.geometry, rebuildRevisionId: null },
        },
      }).success,
    ).toBe(false);
  });

  test("inspection uses typed revision identities and refuses recipe aliases and raw events", () => {
    const command = {
      version: 1,
      commandId: "inspect-1",
      operation: "document.inspect",
      basis: {
        documentId: "doc_part",
        revisionId: "rev_2",
        repositoryHeads: ["head-2"],
      },
    };
    expect(validateSemanticCommand(command).success).toBe(true);
    expect(validateSemanticCommand({ ...command, alias: "part" }).success).toBe(
      false,
    );
    expect(
      validateSemanticCommand({ ...command, operation: "tool.activated" })
        .success,
    ).toBe(false);
    expect(
      validateSemanticCommand({
        ...command,
        basis: { ...command.basis, revisionId: "latest" },
      }).success,
    ).toBe(false);
  });
});
