import type {
  SemanticBasis,
  SemanticCorrelation,
  SemanticResult,
  SemanticState,
} from "./schema";
import type { ContractValidationIssue } from "@/contracts/shared/validation";

/** Domain-independent invariants on the public terminal outcome. */
export function semanticResultIssues(
  expected: SemanticCorrelation,
  result: SemanticResult,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  function refuse(path: string, message: string) {
    issues.push({ path, expected: message, value: result, message });
  }
  if (
    result.correlation.commandId !== expected.commandId ||
    result.correlation.family !== expected.family ||
    result.correlation.intent !== expected.intent ||
    !sameBasis(result.correlation.basis, expected.basis)
  ) {
    refuse("correlation", "Result must belong to the requested command.");
  }
  const { outcome, completion } = result;
  const liveState = completion.live.state;
  if (expected.intent === "inspect" && completion.live.kind === "applied") {
    refuse("completion.live", "Inspection cannot apply authored state.");
  }
  for (const receipt of [completion.persistence, completion.file]) {
    if (
      receipt.kind !== "not-required" &&
      (receipt.commandId !== expected.commandId ||
        !sameState(receipt.state, liveState))
    ) {
      refuse(
        "completion",
        "Receipts must identify this command and its actual live state.",
      );
    }
  }
  if (
    completion.handoff.kind === "current" &&
    !sameState(completion.handoff.state, liveState)
  ) {
    refuse(
      "completion.handoff",
      "Handoff must identify the actual live state.",
    );
  }
  if (
    completion.geometry.kind !== "not-required" &&
    !sameState(completion.geometry.state, liveState)
  ) {
    refuse(
      "completion.geometry",
      "Geometry must identify the actual live state.",
    );
  }
  if (
    result.discovery !== null &&
    (completion.handoff.kind !== "current" ||
      !sameState(result.discovery.state, completion.handoff.state))
  ) {
    refuse(
      "discovery",
      "Discovery requires a current matching authoritative handoff.",
    );
  }
  if (
    outcome.kind === "accepted-invalid" &&
    (expected.intent !== "author-invalid" ||
      completion.geometry.kind !== "invalid-editable" ||
      completion.live.kind !== "applied")
  ) {
    refuse(
      "outcome",
      "Accepted invalid editable state requires explicit author-invalid intent and applied invalid geometry.",
    );
  }
  if (
    completion.geometry.kind === "invalid-editable" &&
    outcome.kind === "completed" &&
    expected.intent !== "inspect"
  ) {
    refuse("outcome", "Invalid geometry cannot fulfill a geometry request.");
  }
  if (
    ["rejected", "conflicted", "canceled", "unavailable"].includes(
      outcome.kind,
    ) &&
    completion.live.kind === "applied"
  ) {
    refuse(
      "completion.live",
      "Refusal or cancellation cannot hide already applied live state.",
    );
  }
  if (outcome.kind === "completed" || outcome.kind === "accepted-invalid") {
    if (completion.handoff.kind !== "current" || liveState === null) {
      refuse(
        "completion.handoff",
        "Successful completion requires authoritative state handoff.",
      );
    }
    const geometryFamilies = [
      "sketch-open",
      "sketch-author",
      "sketch-publish",
      "model-mutate",
      "history",
      "file-open",
      "export",
    ];
    if (
      geometryFamilies.includes(expected.family) &&
      completion.geometry.kind === "not-required"
    ) {
      refuse(
        "completion.geometry",
        "This family requires current geometry evidence.",
      );
    }
    const geometry = completion.geometry;
    if (geometry.kind !== "not-required") {
      const sketchRequired =
        ["sketch-open", "sketch-author", "sketch-publish"].includes(
          expected.family,
        ) ||
        (expected.family === "history" &&
          liveState?.editingContext.kind === "sketch");
      if (
        sketchRequired &&
        (geometry.sketchBasis === null ||
          geometry.solve === null ||
          (geometry.derivation === null && !(geometry.derivationUnavailableReason === "empty-sketch" && result.discovery?.sketch?.entities.length === 0) && !(geometry.derivationUnavailableReason === "solve-invalid" && geometry.kind === "invalid-editable")))
      ) {
        refuse(
          "completion.geometry",
          "Sketch completion requires final solve and derivation certificates.",
        );
      }
      if (
        geometry.sketchBasis !== null &&
        (geometry.solve?.generation !== geometry.sketchBasis.generation ||
          (geometry.derivation !== null && geometry.derivation.generation !== geometry.sketchBasis.generation) ||
          (liveState?.draft !== null &&
            liveState?.draft !== undefined &&
            !sameDraft(geometry.sketchBasis, liveState.draft)))
      ) {
        refuse(
          "completion.geometry",
          "Solve and derivation must certify the final current draft generation.",
        );
      }
      if (
        (["model-mutate", "sketch-publish", "file-open"].includes(
          expected.family,
        ) && completion.live.kind === "applied" || expected.family === "export") &&
        geometry.rebuildRevisionId !== liveState?.revisionId
      ) {
        refuse(
          "completion.geometry.rebuildRevisionId",
          "Rebuild must certify the applied revision.",
        );
      }
    }
    const repositoryRequired =
      [
        "model-mutate",
        "file-open",
        "file-save",
        // Geometry export reads the certified revision; unlike native save it
        // does not publish a new repository transaction. Its file barrier below
        // remains mandatory, without inventing a commit receipt.
      ].includes(expected.family) ||
      (expected.family === "sketch-publish" && completion.live.kind === "applied") ||
      (expected.family === "document" && completion.live.kind === "applied") ||
      (expected.family === "history" &&
        liveState?.editingContext.kind === "document" &&
        completion.live.kind === "applied");
    if (repositoryRequired && completion.persistence.kind !== "committed") {
      refuse(
        "completion.persistence",
        "This family requires a committed transaction receipt.",
      );
    }
    if (
      ["file-save", "export"].includes(expected.family) &&
      completion.file.kind !== "written"
    ) {
      refuse(
        "completion.file",
        "Save/export completion requires an observed file write.",
      );
    }
    if (expected.family === "history" && result.discovery?.history == null) {
      refuse(
        "discovery.history",
        "History completion requires refreshed availability.",
      );
    }
    if (
      outcome.kind === "completed" &&
      (outcome.change === "changed") !== (completion.live.kind === "applied")
    ) {
      refuse("outcome.change", "Change must match actual live application.");
    }
  }
  const failedBarriers = (
    [
      result.completion.geometry.kind === "failed" ? "geometry" : null,
      result.completion.handoff.kind === "failed" ? "handoff" : null,
      result.completion.persistence.kind === "failed" ? "persistence" : null,
      result.completion.file.kind === "failed" ? "file" : null,
    ] as const
  ).filter((failure) => failure !== null);
  if (failedBarriers.length && result.outcome.kind !== "failed") {
    refuse(
      "outcome",
      "Failed required barriers cannot be successful fulfillment.",
    );
  }
  if (result.outcome.kind === "failed") {
    const failures = result.outcome.failures;
    if (
      !failures.length ||
      failedBarriers.some((failure) => !failures.includes(failure))
    ) {
      refuse(
        "outcome.failures",
        "All observed barrier failures must be reported.",
      );
    }
  }
  return issues;
}

function sameBasis(a: SemanticBasis | null, b: SemanticBasis | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.documentId === b.documentId &&
    a.revisionId === b.revisionId &&
    a.repositoryHeads.length === b.repositoryHeads.length &&
    [...a.repositoryHeads]
      .sort()
      .every((head, index) => head === [...b.repositoryHeads].sort()[index])
  );
}

function sameDraft(
  a: SemanticState["draft"],
  b: SemanticState["draft"],
): boolean {
  if (!a || !b) return a === b;
  return (
    a.commandSessionId === b.commandSessionId && a.generation === b.generation
  );
}

function sameState(a: SemanticState, b: SemanticState | null): boolean {
  return (
    b !== null &&
    sameBasis(a, b) &&
    sameDraft(a.draft, b.draft) &&
    a.editingContext.kind === b.editingContext.kind &&
    (a.editingContext.kind !== "sketch" ||
      (b.editingContext.kind === "sketch" &&
        a.editingContext.sketchId === b.editingContext.sketchId))
  );
}
