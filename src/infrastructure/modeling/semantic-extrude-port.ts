import {
  getAppErrorContextValue,
  isModelingMutationError,
  modelingMutationErrorToDiagnostic,
} from "@/core/editor/state-machine/error-mapping";
import type {
  SemanticDiscovery,
  SemanticExtrudeCommand,
  SemanticRevolveCommand,
  SemanticPlaneCommand,
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
  getFeatureEditorFormField,
} from "@/domain/editor/feature-editing";
import {
  regionBoundaryBasisOfRecord,
  resolveRegionBoundaryCurve,
} from "@/contracts/sketch/region-boundary-curves";
import { sketchProfileGateFailures } from "@/contracts/sketch/derived-validity";
import { createFeatureEditorPatchFromExpression } from "@/core/feature-authoring/form-adapter";
import { prepareExtrudeFeatureDefinition } from "@/core/feature-authoring/features/extrude";

import { prepareRevolveFeatureDefinition } from "@/core/feature-authoring/features/revolve";

import { preparePlaneFeatureDefinition } from "@/core/feature-authoring/features/plane";

// Feature families share exact production mutation, persistence and native
// output completion; parameter preparation and output kind remain family-specific.
export function createSemanticFeatureMutationPort(input: {
  service: ModelingService;
  loop: EditorEventLoop;
  inspect(input: {
    commandId: string;
  }): Promise<{
    discovery: SemanticDiscovery;
    diagnostics: readonly import("@/contracts/modeling/schema").ModelingDiagnostic[];
  }>;
}) {
  return async function execute(command: SemanticExtrudeCommand | SemanticRevolveCommand | SemanticPlaneCommand) {
    const featureKind = command.operation === "plane.create" || command.operation === "plane.update" ? "plane" : command.operation === "revolve.create" || command.operation === "revolve.update" ? "revolve" : "extrude";
    const before = await input.inspect({
      commandId: `${command.commandId}:before`,
    });
    const terminal = createSemanticResult(command, before.discovery.state);
    if (input.loop.getState().kind !== "idle")
      return {
        ...terminal,
        outcome: { kind: "rejected" as const, reasonCode: "editing-context" },
      };
    if ("depth" in command && command.depth !== undefined && (typeof command.depth === "number" ? !Number.isFinite(command.depth) || command.depth <= 0 : !command.depth.trim()))
      return {
        ...terminal,
        outcome: {
          kind: "rejected" as const,
          reasonCode: "invalid-extrude-depth",
        },
      };
    const snapshot = await input.service.getCurrentDocumentSnapshot();
    let draft;
    if (command.operation === "extrude.create" && command.profile !== undefined) {
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
    } else if (command.operation === "extrude.update" || command.operation === "revolve.update" || command.operation === "plane.update") {
      const feature = snapshot.document.features.find(
        (f) => f.featureId === command.featureId,
      );
      if (
        !feature ||
        feature.definition.kind !== featureKind
      )
        return {
          ...terminal,
          outcome: {
            kind: "rejected" as const,
            reasonCode: `${featureKind}-unavailable`,
          },
        };
      draft = hydrateFeatureEditSession(feature)!;
    }
    let definition;
    if (command.operation === "plane.create" || command.operation === "plane.update") {
      definition = preparePlaneFeatureDefinition(command.parameters);
    } else if (command.operation === "revolve.create" || command.operation === "revolve.update") {
      definition = prepareRevolveFeatureDefinition(command.parameters);
    } else if (command.parameters !== undefined) {
      definition = prepareExtrudeFeatureDefinition(command.parameters);
    } else {
      const depthField = getFeatureEditorFormField(draft!, "extrude-depth");
      const patch = typeof command.depth === "string"
        ? depthField?.kind === "numeric" ? createFeatureEditorPatchFromExpression(depthField, command.depth) : null
        : { depth: command.depth };
      definition = patch && buildFeatureDefinition(patchFeatureEditSession(draft!, patch));
    }
    if (!definition || definition.kind !== featureKind)
      return {
        ...terminal,
        outcome: {
          kind: "rejected" as const,
          reasonCode: `${featureKind}-incomplete`,
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
        command.operation === "extrude.create" || command.operation === "revolve.create" || command.operation === "plane.create"
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
      const constructions = feature?.producedTargets.filter(t => t.kind === "construction") ?? [];
      const valid =
        terminal.completion.geometry.kind === "current" &&
        (definition.kind === "plane"
          ? constructions.length > 0 && constructions.every(t =>
              t.kind === "construction" && after.discovery.model?.constructions?.some(c =>
                c.constructionId === t.constructionId && c.ownerFeatureId === result.featureId))
          : outputs.length > 0 && outputs.every(t =>
              t.kind === "body" && after.discovery.model?.bodies.some(b =>
                b.bodyId === t.bodyId &&
                b.kind === (definition.parameters.resultBodyType === "surface" ? "sheet" : "solid") &&
                b.bounds !== null)));
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
