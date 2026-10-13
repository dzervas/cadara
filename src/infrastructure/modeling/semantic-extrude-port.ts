import {
  getAppErrorContextValue,
  isModelingMutationError,
  modelingMutationErrorToDiagnostic,
} from "@/core/editor/state-machine/error-mapping";
import type {
  SemanticDiscovery,
  SemanticExtrudeCommand,
  SemanticState,
} from "@/contracts/semantic/schema";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import type { EditorEventLoop } from "@/application/editor/editor-event-loop";
import {
  createSemanticResult,
  semanticDiagnostic,
} from "@/application/semantic/session";
import {
  createFeatureEditSession,
  hydrateFeatureEditSession,
  patchFeatureEditSession,
  buildFeatureDefinition,
} from "@/domain/editor/feature-editing";
import {
  regionBoundaryBasisOfRecord,
  resolveRegionBoundaryCurve,
} from "@/contracts/sketch/region-boundary-curves";
import { sketchProfileGateFailures } from "@/contracts/sketch/derived-validity";

export function createSemanticExtrudePort(input: {
  service: ModelingService;
  loop: EditorEventLoop;
  inspect(input: {
    commandId: string;
  }): Promise<{
    discovery: SemanticDiscovery;
    diagnostics: readonly import("@/contracts/modeling/schema").ModelingDiagnostic[];
  }>;
}) {
  return async function execute(command: SemanticExtrudeCommand) {
    const before = await input.inspect({
      commandId: `${command.commandId}:before`,
    });
    const terminal = createSemanticResult(command, before.discovery.state);
    if (input.loop.getState().kind !== "idle")
      return {
        ...terminal,
        outcome: { kind: "rejected" as const, reasonCode: "editing-context" },
      };
    if (!Number.isFinite(command.depth) || command.depth <= 0)
      return {
        ...terminal,
        outcome: {
          kind: "rejected" as const,
          reasonCode: "invalid-extrude-depth",
        },
      };
    const snapshot = await input.service.getCurrentDocumentSnapshot();
    let draft;
    if (command.operation === "extrude.create") {
      const sketch = snapshot.document.sketches.find(
        (s) => s.sketchId === command.profile.sketchId,
      )?.sketch;
      const region = sketch?.regions.find(
        (r) => r.regionId === command.profile.regionId,
      );
      const basis = sketch && regionBoundaryBasisOfRecord(sketch);
      if (
        !sketch ||
        !region?.isClosed ||
        sketch.derivedValidity.state !== "current" ||
        sketchProfileGateFailures(sketch.solvedSnapshot).length ||
        !region.loops.every((l) =>
          l.segments.every(
            (s) => resolveRegionBoundaryCurve(basis!, s).kind !== "failed",
          ),
        )
      )
        return {
          ...terminal,
          outcome: {
            kind: "rejected" as const,
            reasonCode: "profiles-unusable",
          },
        };
      draft = createFeatureEditSession({
        featureType: "extrude",
        selectedTarget: command.profile,
      });
    } else {
      const feature = snapshot.document.features.find(
        (f) => f.featureId === command.featureId,
      );
      if (
        !feature ||
        feature.definition.kind !== "extrude" ||
        feature.definition.parameters.resultBodyType !== "solid"
      )
        return {
          ...terminal,
          outcome: {
            kind: "rejected" as const,
            reasonCode: "extrude-unavailable",
          },
        };
      draft = hydrateFeatureEditSession(feature)!;
    }
    const definition = buildFeatureDefinition(
      patchFeatureEditSession(draft, { depth: command.depth }),
    );
    if (!definition)
      return {
        ...terminal,
        outcome: {
          kind: "rejected" as const,
          reasonCode: "extrude-incomplete",
        },
      };
    let receipt: DocumentRepositoryMutationResult | undefined;
    const transactionId = `transaction_${crypto.randomUUID()}`;
    let mutationStarted = false;
    try {
      const base = {
        baseRevisionId: command.basis.revisionId,
        baseRepositoryHeads: command.basis.repositoryHeads,
        definition,
        observePersistence: (value: DocumentRepositoryMutationResult) => {
          receipt = value;
        },
      };
      mutationStarted = true;
      const response =
        command.operation === "extrude.create"
          ? await input.service.createFeature(base)
          : await input.service.updateFeature({
              ...base,
              featureId: command.featureId,
            });
      if (response.isErr()) {
        terminal.diagnostics = [
          modelingMutationErrorToDiagnostic(response.error),
        ];
        if (isModelingMutationError(response.error)) {
          const after = await input.inspect({
            commandId: `${command.commandId}:refused`,
          });
          const conflict =
            getAppErrorContextValue(response.error, "revisionState") ===
            "conflict";
          terminal.outcome = conflict
            ? { kind: "conflicted", actualBasis: after.discovery.state }
            : {
                kind: "rejected",
                reasonCode: String(
                  getAppErrorContextValue(response.error, "reasonCode") ??
                    response.error.code,
                ),
              };
          terminal.completion.live = {
            kind: "unchanged",
            state: after.discovery.state,
          };
          terminal.completion.handoff = {
            kind: "current",
            state: after.discovery.state,
          };
          terminal.discovery = after.discovery;
          return terminal;
        }
        throw new Error(response.error.message);
      }
      const result = response.value;
      terminal.diagnostics = result.diagnostics;
      if (result.revisionState.kind !== "accepted") {
        terminal.outcome =
          result.revisionState.kind === "conflict"
            ? {
                kind: "conflicted",
                actualBasis: (
                  await input.inspect({
                    commandId: `${command.commandId}:conflict`,
                  })
                ).discovery.state,
              }
            : { kind: "rejected", reasonCode: result.revisionState.reasonCode };
        return terminal;
      }
      const observed = receipt as DocumentRepositoryMutationResult | undefined;
      const applied = observed?.ok ? observed : observed?.appliedLive;
      const state: SemanticState = {
        ...before.discovery.state,
        revisionId: result.revisionId,
        repositoryHeads: applied
          ? [...applied.metadata.heads]
          : before.discovery.state.repositoryHeads,
      };
      terminal.completion.live = { kind: "applied", state };
      terminal.completion.persistence = {
        kind: observed?.ok ? "committed" : "failed",
        commandId: command.commandId,
        transactionId,
        state,
      };
      if (
        !observed ||
        (!observed.ok &&
          !terminal.diagnostics.some(
            (d) => d.message === observed.status.diagnostic.message,
          ))
      )
        terminal.diagnostics = [
          ...terminal.diagnostics,
          semanticDiagnostic(
            new Error(
              observed && !observed.ok
                ? observed.status.diagnostic.message
                : "Accepted feature has no exact repository write receipt.",
            ),
          ),
        ];
      terminal.completion.geometry = {
        kind:
          result.rebuildResult.kind === "rebuilt" &&
          result.rebuildResult.revisionId === state.revisionId
            ? "current"
            : "failed",
        state,
        sketchBasis: null,
        solve: null,
        derivation: null,
        rebuildRevisionId:
          result.rebuildResult.kind === "skipped"
            ? null
            : result.rebuildResult.revisionId,
      };
      const after = await input.inspect({
        commandId: `${command.commandId}:after`,
      });
      if (
        after.discovery.state.revisionId !== state.revisionId ||
        [...after.discovery.state.repositoryHeads].sort().join("\0") !==
          [...state.repositoryHeads].sort().join("\0")
      )
        throw new Error(
          "Feature handoff does not match the accepted mutation.",
        );
      terminal.discovery = after.discovery;
      terminal.completion.handoff = { kind: "current", state };
      terminal.diagnostics = [...terminal.diagnostics, ...after.diagnostics];
      // A rebuilt revision alone is insufficient when the requested output failed.
      const feature = after.discovery.model?.features.find(
        (f) => f.featureId === result.featureId,
      );
      const outputs =
        feature?.producedTargets.filter((t) => t.kind === "body") ?? [];
      const valid =
        terminal.completion.geometry.kind === "current" &&
        outputs.length > 0 &&
        outputs.every(
          (t) =>
            t.kind === "body" &&
            after.discovery.model?.bodies.some(
              (b) =>
                b.bodyId === t.bodyId &&
                b.kind === "solid" &&
                b.bounds !== null,
            ),
        );
      if (!valid)
        terminal.completion.geometry.kind =
          command.intent === "author-invalid" ? "invalid-editable" : "failed";
      const failures = [
        ...(!observed?.ok ? ["persistence" as const] : []),
        ...(!valid && command.intent !== "author-invalid"
          ? ["geometry" as const]
          : []),
      ];
      terminal.outcome = failures.length
        ? { kind: "failed", failures }
        : !valid
          ? { kind: "accepted-invalid" }
          : { kind: "completed", change: "changed" };
      return terminal;
    } catch (error) {
      terminal.diagnostics = [
        ...terminal.diagnostics,
        semanticDiagnostic(error),
      ];
      terminal.completion.handoff = { kind: "failed" };
      terminal.discovery = null;
      // An exception after a production mutation is not evidence of rollback.
      // Observe live truth, but never reconstruct a successful rebuild/write receipt.
      if (mutationStarted && terminal.completion.live.kind === "unchanged") {
        const observed = receipt as
          | DocumentRepositoryMutationResult
          | undefined;
        const applied = observed?.ok ? observed : observed?.appliedLive;
        if (applied) {
          const state = {
            ...before.discovery.state,
            revisionId: applied.document.revisionId,
            repositoryHeads: [...applied.metadata.heads],
          };
          terminal.completion.live = { kind: "applied", state };
          terminal.completion.persistence = {
            kind: observed!.ok ? "committed" : "failed",
            commandId: command.commandId,
            transactionId,
            state,
          };
          terminal.completion.geometry = {
            kind: "failed",
            state,
            sketchBasis: null,
            solve: null,
            derivation: null,
            rebuildRevisionId: null,
          };
        }
        try {
          const after = await input.inspect({
            commandId: `${command.commandId}:failed`,
          });
          const state = after.discovery.state;
          if (
            applied &&
            (state.revisionId !== applied.document.revisionId ||
              [...state.repositoryHeads].sort().join("\0") !==
                [...applied.metadata.heads].sort().join("\0"))
          )
            throw new Error(
              "Failed mutation handoff does not match its exact applied transaction.",
            );
          terminal.discovery = after.discovery;
          terminal.completion.handoff = { kind: "current", state };
          const changed =
            state.revisionId !== before.discovery.state.revisionId;
          terminal.completion.live = {
            kind: changed ? "applied" : "unchanged",
            state,
          };
          if (changed) {
            const observed = receipt as
              | DocumentRepositoryMutationResult
              | undefined;
            terminal.completion.persistence = {
              kind: observed?.ok ? "committed" : "failed",
              commandId: command.commandId,
              transactionId,
              state,
            };
            terminal.completion.geometry = {
              kind: "failed",
              state,
              sketchBasis: null,
              solve: null,
              derivation: null,
              rebuildRevisionId: null,
            };
          }
          terminal.diagnostics = [
            ...terminal.diagnostics,
            ...after.diagnostics,
          ];
        } catch (handoffError) {
          terminal.diagnostics = [
            ...terminal.diagnostics,
            semanticDiagnostic(handoffError),
          ];
        }
      }
      terminal.outcome = {
        kind: "failed",
        failures: [
          "execution",
          ...(terminal.completion.handoff.kind === "failed"
            ? ["handoff" as const]
            : []),
          ...(terminal.completion.geometry.kind === "failed"
            ? ["geometry" as const]
            : []),
          ...(terminal.completion.persistence.kind === "failed"
            ? ["persistence" as const]
            : []),
        ],
      };
      return terminal;
    }
  };
}
