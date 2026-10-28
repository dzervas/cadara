import { snapshotRepresentsRepositoryDocument } from "@/contracts/modeling/repository-basis";
import { keptSketchWithheldRegionText } from "@/core/editor/sketch-session/region-feedback";
import { getPeerDeletedSketchNotice } from "@/core/editor/state-machine/selectors";
import type {
  SemanticSketchCommand,
  SemanticHistoryCommand,
  SemanticDiscovery,
  SemanticState,
  SemanticGeometryReceipt,
} from "@/contracts/semantic/schema";
import type { EditorEventLoop } from "@/application/editor/editor-event-loop";
import type { EditorEvent } from "@/core/editor/state-machine";
import type { ConstructionId, RequestId } from "@/contracts/shared/ids";
import {
  createSemanticResult,
  semanticDiagnostic,
} from "@/application/semantic/session";
import {
  getSessionSketchId,
  getSketchSessionDerivedValidity,
  hasAcceptedLiveSolveOfDefinition,
  getLiveRegionBoundaryDiagnostics,
} from "@/core/editor/sketch-session";
import { sketchPrimitiveContributionInput, validateSketchPrimitive } from "@/core/sketch-tools/semantic-primitive";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import { canReassignCommittedSketchPlane } from "@/core/editor/sketch-plane-editing";
import { canStartSketchFromTarget } from "@/core/editor/sketch-session-controller";
import { canUseTangentArcSourceAtPoint } from "@/core/sketch-inference/placement-inference";
import {
  regionBoundaryBasisOfRecord,
  resolveRegionBoundaryCurve,
} from "@/contracts/sketch/region-boundary-curves";
import { isUnevaluatedMetadataOnlySketch, sketchProfileGateFailures } from "@/contracts/sketch/derived-validity";

import { solvedPairDefinition } from "@/contracts/sketch/offset-publication";
import { isReferenceDimension } from "@/contracts/sketch/schema";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import { getEntityPointIds } from "@/core/sketch-editing/definition-references";
import { createModelingServiceEditorEffectRuntime } from "@/application/editor/effect-registry";
import { getSketchMirrorActionEntries } from "@/core/editor/sketch-session/mirror-actions";
import { getSketchOffsetHealth } from "@/core/editor/sketch-session/offset-actions";
import {
  prepareSketchOffset,
  prepareSketchIntersectionEdit,
} from "@/core/editor/sketch-session";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { requireQuerySketchEditIntersectionsResponse } from "@/contracts/solver/runtime-schema";

/** Only accepted solved geometry, shared by mirror and other derived-output discovery. */
function currentDerivedOutputGeometry(
  s: import("@/core/editor/sketch-session/types").SketchSessionState,
  outputIds: readonly import("@/contracts/shared/ids").SketchEntityId[],
): NonNullable<SemanticDiscovery["sketch"]>["offsets"][number]["currentGeometry"] {
  if (!hasAcceptedLiveSolveOfDefinition(s)) return null;
  const solved = solvedPairDefinition(s.liveSolve!.definition, s.liveSolve!.solvedSnapshot);
  return entityDiscovery(solved).filter(e => outputIds.includes(e.entityId)).map(e => ({ entityId: e.entityId, kind: e.kind, ...(e.radius !== undefined ? { radius: e.radius } : {}), points: e.pointIds.map(id => { const point = solved.points.find(p => p.pointId === id)!; return { pointId: id, position: point.position }; }) }));
}

function entityDiscovery(definition: Pick<import("@/contracts/sketch/schema").SketchDefinition, "points" | "entities">): NonNullable<SemanticDiscovery["sketch"]>["entities"] {
  return definition.entities.map(e => ({
    entityId: e.entityId, kind: e.kind, pointIds: getEntityPointIds(e), construction: e.isConstruction,
    ...(e.style ? { style: e.style } : {}),
    ...(e.kind === "circle" ? { radius: e.radius } : e.kind === "arc" ? { radius: (() => {
      const center = definition.points.find(p => p.pointId === e.centerPointId)!.position;
      const start = definition.points.find(p => p.pointId === e.startPointId)!.position;
      return Math.hypot(start[0] - center[0], start[1] - center[1]);
    })() } : {}),
    ...(e.kind === "ellipse" || e.kind === "ellipticalArc" ? { minorRadius: e.minorRadius } : {}),
    ...(e.kind === "arc" || e.kind === "ellipticalArc" ? { sweepDirection: e.sweepDirection } : {}),
    ...(e.kind === "conic" ? { rho: e.rho } : {}),
    ...(e.kind === "bezierCurve" ? { degree: e.degree } : {}),
    ...(e.kind === "spline" ? { closure: e.closure } : {}),
    ...(e.kind === "profileText" ? { text: { content: e.text, height: e.height, rotationRadians: e.rotationRadians, horizontalAlign: e.horizontalAlign, verticalAlign: e.verticalAlign } } : {}),
    ...(e.kind === "spline" ? { tangents: e.pointOccurrences.map(o => ({ occurrenceId: o.occurrenceId, pointId: o.pointId, vector: o.tangent.kind === "authored" ? o.tangent.vector : null })) } : {}),
  }));
}

/** Authored relationships and certified outputs remain separate from display fallbacks. */
function offsetDiscovery(session: import("@/core/editor/sketch-session").SketchSessionState): NonNullable<SemanticDiscovery["sketch"]>["offsets"] {
  const snapshot = session.liveSolve!.solvedSnapshot;
  const solved = solvedPairDefinition(session.liveSolve!.definition, snapshot);
  const entities = entityDiscovery(solved);
  const health = getSketchOffsetHealth(session);
  return (session.definition.derivedRelationships ?? []).flatMap(relationship => {
    if (relationship.kind !== "offset") return [];
    const outputEntityIds = [...relationship.outputs, ...relationship.jointOutputs, ...relationship.piecewiseCubicOutputs].map(output => output.outputEntityId);
    const current = session.liveRegions.status === "current" && snapshot.certifiedOffsetDerivationIds?.includes(relationship.derivationId);
    return [{
      derivationId: relationship.derivationId,
      label: relationship.label,
      seedEntityIds: relationship.seedEntityIds,
      outputEntityIds,
      distance: relationship.distance,
      health: health(relationship),
      currentGeometry: current ? entities.filter(entity => outputEntityIds.includes(entity.entityId)).map(entity => {
        const pointIds = entity.kind === "derivedPiecewiseCubic"
          ? relationship.piecewiseCubicOutputs.filter(shell => shell.outputEntityId === entity.entityId).flatMap(shell => [shell.startPointId, shell.endPointId])
          : entity.pointIds;
        return {
          entityId: entity.entityId,
          kind: entity.kind,
          points: pointIds.map(pointId => ({ pointId, position: solved.points.find(point => point.pointId === pointId)!.position })),
          ...(entity.radius === undefined ? {} : { radius: entity.radius }),
          ...(entity.kind === "derivedPiecewiseCubic" ? { cubicSpans: snapshot.solvedEntities.flatMap(output => output.entityId === entity.entityId && output.kind === "derivedPiecewiseCubic" && output.publication === "certified" ? output.spans : []) } : {}),
        };
      }) : null,
    }];
  });
}

function dimensionDiscovery(
  definition: import("@/contracts/sketch/schema").SketchDefinition,
  solved: import("@/contracts/sketch/schema").SolvedSketchSnapshot,
) {
  const values = new Map(solved.dimensionStatuses.map(s => [s.dimensionId, s.solvedValue]));
  return {
    constraints: definition.constraints.map(c => ({ constraintId: c.constraintId, kind: c.kind, label: c.label, status: solved.constraintStatuses.find(s => s.constraintId === c.constraintId)?.status ?? null })),
    requirements: definition.dimensions.filter(d => !isReferenceDimension(d)).map(d => ({
      dimensionId: d.dimensionId, kind: d.kind, label: d.label, mode: "driving" as const,
      value: d.kind === "lineAngle" ? getAuthoredLiteralValue(d.valueRadians) ?? null : "value" in d ? getAuthoredLiteralValue(d.value) ?? null : null,
      measuredValue: values.get(d.dimensionId) ?? null,
    })),
    measurements: definition.dimensions.filter(isReferenceDimension).map(d => ({
      dimensionId: d.dimensionId, kind: d.kind, label: d.label, mode: "reference" as const,
      measuredValue: values.get(d.dimensionId) ?? null,
    })),
  };
}

/** Certificates only are retained here; the editor/action owner owns all draft state. */
export function createSemanticSketchPort(input: {
  loop: EditorEventLoop;
  referenceImageFiles?: import("@/application/semantic/reference-image-files").ReferenceImageFiles;
  service: import("@/application/modeling/modeling-service").ModelingService;
  publications: ReturnType<
    typeof import("./sketch-publication-receipts").createSketchPublicationReceipts
  >;
  inspect(input: {
    commandId: string;
  }): Promise<{
    discovery: SemanticDiscovery;
    diagnostics: readonly import("@/contracts/modeling/schema").ModelingDiagnostic[];
  }>;
}) {
  let certificate: {
    commandSessionId: string;
    generation: number;
    requestId: RequestId;
  } | null = null;
  function discovery(base: SemanticDiscovery): SemanticDiscovery {
    const editor = input.loop.getState();
    if (editor.kind !== "editingSketch") return base;
    const s = editor.session;
    const draft = {
      commandSessionId: editor.command.commandSessionId,
      generation: s.liveRegions.generation,
    };
    const state: SemanticState = {
      ...base.state,
      editingContext: { kind: "sketch", sketchId: s.actionContextId },
      draft,
    };
    const projectionsCurrent = s.definition.references.every(reference =>
      s.projectedReferences.some(projected => projected.referenceId === reference.referenceId && projected.status === "projected"));
    const usable =
      projectionsCurrent && !s.projectionDiagnostics.some(d => d.severity === "error") && hasAcceptedLiveSolveOfDefinition(s) &&
      s.liveRegions.status === "current" &&
      sketchProfileGateFailures(s.liveSolve!.solvedSnapshot).length === 0 &&
      getLiveRegionBoundaryDiagnostics(s.liveRegions).length === 0;
    return {
      ...base,
      state,
      references: [
        ...base.references.filter(r => !("sketchId" in r.target && r.target.sketchId === (s.sketchId ?? s.actionContextId))),
        ...[
          { label: s.sketchLabel, target: { kind: "sketch" as const, sketchId: s.sketchId ?? s.actionContextId } },
          ...s.definition.points.map(p => ({ label: p.label, target: { kind: "sketchPoint" as const, sketchId: s.sketchId ?? s.actionContextId, pointId: p.pointId } })),
          ...s.definition.entities.map(e => ({ label: e.label, target: { kind: "sketchEntity" as const, sketchId: s.sketchId ?? s.actionContextId, entityId: e.entityId } })),
          ...(s.definition.referenceImages ?? []).map(r => ({ label: r.label, target: { kind: "sketchOperation" as const, sketchId: s.sketchId ?? s.actionContextId, operationId: r.operationId } })),
          ...s.definition.dimensions.map(d => ({ label: d.label, target: { kind: "dimension" as const, sketchId: s.sketchId ?? s.actionContextId, dimensionId: d.dimensionId } })),
          ...s.definition.constraints.map(c => ({ label: c.label, target: { kind: "constraint" as const, sketchId: s.sketchId ?? s.actionContextId, constraintId: c.constraintId } })),
          ...(usable ? s.liveRegions.regions.filter(r => r.isClosed).map(r => ({ label: r.label, target: { kind: "region" as const, sketchId: s.sketchId ?? s.actionContextId, regionId: r.regionId } })) : []),
        ].map(reference => ({ ...reference, owner: { kind: "sketch" as const, sketchId: s.sketchId ?? s.actionContextId } })),
      ],
      history: {
        canUndo: s.actionAvailability?.canUndo ?? false,
        canRedo: s.actionAvailability?.canRedo ?? false,
        // UI-local blocked markers are reported by the refused command's
        // diagnostics, not leaked as unknown fields into the strict contract.
        undoEntries: (s.actionHistory?.undo ?? []).map(({ sequence, label }) => ({ sequence, label })),
        redoEntries: (s.actionHistory?.redo ?? []).map(({ sequence, label }) => ({ sequence, label })),
      },
      sketch: {
        ...dimensionDiscovery(s.definition, s.liveSolve!.solvedSnapshot),
        operands: [
          ...([{ datumId: "origin", geometryKind: "point", label: "Sketch origin" }, { datumId: "xAxis", geometryKind: "lineSegment", label: "Sketch X axis" }, { datumId: "yAxis", geometryKind: "lineSegment", label: "Sketch Y axis" }] as const).map(d => ({ label: d.label, target: { kind: "sketchDatumReference" as const, sketchId: s.sketchId ?? s.actionContextId, datumId: d.datumId, geometryKind: d.geometryKind } })),
          ...s.projectedReferences.filter(r => r.status === "projected").flatMap(r => {
            const label = s.definition.references.find(reference => reference.referenceId === r.referenceId)?.label || "External reference";
            return r.geometry.map((g, index) => ({
              label: `${label} — projected ${g.kind === "lineSegment" ? "line" : g.kind}${r.geometry.length > 1 ? ` ${index + 1}` : ""}`,
              target: { kind: "projectedReferenceGeometry" as const, referenceId: r.referenceId, geometryId: g.geometryId, geometryKind: g.kind },
            }));
          }),
        ],
        sketchId: s.sketchId ?? s.actionContextId,
        plane: s.plane.key,
        support: s.plane,
        references: s.definition.references.map(definition => {
          const projection = s.projectedReferences.find(r => r.referenceId === definition.referenceId) ?? null;
          return { definition, revisionId: projection ? editor.document.revisionId : null, projection };
        }),
        solveStatus: s.liveSolve!.solvedSnapshot.status,
        validity: getSketchSessionDerivedValidity(s),
        points: s.definition.points.map((p) => ({
          pointId: p.pointId,
          position: p.position,
          construction: p.isConstruction,
        })),
        entities: entityDiscovery(s.definition),
        styles: s.definition.styles ?? [],
        referenceImages: s.definition.referenceImages ?? [],
        derivations: (s.definition.derivedRelationships ?? []).flatMap(relationship => {
          if (relationship.kind !== "linearPattern" && relationship.kind !== "circularPattern" && relationship.kind !== "transform") return [];
          const failed = sketchProfileGateFailures(s.liveSolve!.solvedSnapshot).includes(relationship.derivationId);
          const currentGeometry = failed ? null : currentDerivedOutputGeometry(s, relationship.outputs.map(o => o.outputEntityId));
          return [{ definition: relationship, profileGateFailed: failed, currentGeometry }];
        }),
        mirrors: getSketchMirrorActionEntries(s).map(entry => {
          const relationship = s.definition.derivedRelationships!.find(r => r.derivationId === entry.derivationId)!;
          if (relationship.kind !== "mirror") throw new Error("Expected mirror relationship.");
          const health = { derivationId: entry.derivationId, label: entry.label, brokenReason: entry.brokenReason, copyCount: entry.copyCount, requirementCount: entry.requirementCount, sizingRequirementCount: entry.sizingRequirementCount, brokenDownstreamLabels: entry.brokenDownstreamLabels };
          const currentGeometry = health.brokenReason !== null ? null : currentDerivedOutputGeometry(s, relationship.outputs.map(o => o.outputEntityId));
          return { ...health, seedEntityIds: relationship.seedEntityIds, outputEntityIds: relationship.outputs.map(o => o.outputEntityId), axis: relationship.mirrorReference, currentGeometry };
        }),
        offsets: offsetDiscovery(s),
        profiles: usable
          ? s.liveRegions.regions
              .filter((r) => r.isClosed)
              .map((r) => ({ regionId: r.regionId, isClosed: r.isClosed }))
          : [],
      },
    };
  }
  function geometry(state: SemanticState): SemanticGeometryReceipt {
    const editor = input.loop.getState();
    if (editor.kind !== "editingSketch") return { kind: "not-required" };
    const s = editor.session;
    const empty = s.definition.entities.length === 0;
    // An empty local definition is not proof that its external geometry resolved.
    const projectionsCurrent = s.definition.references.every(reference =>
      s.projectedReferences.some(projected => projected.referenceId === reference.referenceId && projected.status === "projected"));
    const current = projectionsCurrent && !s.projectionDiagnostics.some(d => d.severity === "error") &&
      (empty ||
      (hasAcceptedLiveSolveOfDefinition(s) &&
        s.liveRegions.status === "current" &&
        getLiveRegionBoundaryDiagnostics(s.liveRegions).length === 0));
    return {
      kind: current
        ? "current"
        : s.projectionDiagnostics.some(d => d.code === "projection-runtime-failed") ||
            s.liveRegions.status === "failed" ||
            s.liveRegions.status === "pending"
          ? "failed"
          : "invalid-editable",
      state,
      sketchBasis: state.draft,
      // The synchronous solve has no async request; this names its actual owned basis.
      solve: { kind: "synchronous", generation: s.liveRegions.generation },
      derivation:
        certificate?.commandSessionId === editor.command.commandSessionId &&
        certificate.generation === s.liveRegions.generation
          ? {
              requestId: certificate.requestId,
              generation: certificate.generation,
            }
          : null,
      ...(!certificate || certificate.generation !== s.liveRegions.generation
        ? {
            derivationUnavailableReason: empty
              ? ("empty-sketch" as const)
              : ("solve-invalid" as const),
          }
        : {}),
      rebuildRevisionId: null,
    };
  }
  async function reassignSupport(
    command: Extract<SemanticSketchCommand, { operation: "sketch.support.reassign" }>,
    terminal: import("@/contracts/semantic/schema").SemanticResult,
  ): Promise<import("@/contracts/semantic/schema").SemanticResult> {
    const snapshot = await input.service.getCurrentDocumentSnapshot();
    if (!canReassignCommittedSketchPlane(snapshot, command.sketchId) || !canStartSketchFromTarget(command.support, snapshot))
      return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-support-unavailable" } };
    const events: EditorEvent[] = [];
    let error: unknown;
    try {
      events.push(...await input.loop.dispatchAndSettle(`${command.commandId}:support-open`, { type: "sketchPlaneEdit.requested", target: { kind: "sketch", sketchId: command.sketchId } }));
      const opened = input.loop.getState();
      if (opened.kind === "editingSketchPlane" && canStartSketchFromTarget(command.support, opened.snapshot)) {
        events.push(...await input.loop.dispatchAndSettle(command.commandId, { type: "sketchPlaneEdit.supportCommitted", target: command.support }));
      }
      const pending = input.loop.getState();
      if (pending.kind !== "idle") {
        // Restore the production timeline cursor on refused/unchanged edits too.
        events.push(...await input.loop.dispatchAndSettle(`${command.commandId}:support-exit`, { type: "command.cancelled", commandSessionId: pending.command.commandSessionId }));
      }
    } catch (caught) { error = caught; }
    const committed = events.find((e): e is Extract<EditorEvent, { type: "effect.sketchPlaneCommitted" }> => e.type === "effect.sketchPlaneCommitted");
    const failed = events.find((e): e is Extract<EditorEvent, { type: "effect.sketchPlaneCommitFailed" }> => e.type === "effect.sketchPlaneCommitFailed");
    const requestId = committed?.requestId ?? failed?.requestId;
    const receipt = requestId ? input.publications.take(requestId) : undefined;
    const applied = receipt?.ok ? receipt : receipt?.appliedLive;
    const cursorReceipts = events.flatMap(e => e.type === "effect.documentCursorMoved" || e.type === "effect.documentCursorMoveFailed" ? [{ event: e, receipt: input.publications.takeCursor(e.baseRevisionId) }] : []);
    // Rollback, commit and restoration receipts form one chronological basis chain.
    let observed: typeof applied;
    let chainRevision = terminal.completion.live.state!.revisionId;
    let chainValid = true;
    for (const event of events) {
      const write = event.type === "effect.sketchPlaneCommitted" || event.type === "effect.sketchPlaneCommitFailed"
        ? receipt
        : cursorReceipts.find(entry => entry.event === event)?.receipt;
      if (!(event.type === "effect.sketchPlaneCommitted" || event.type === "effect.sketchPlaneCommitFailed" || event.type === "effect.documentCursorMoved" || event.type === "effect.documentCursorMoveFailed")) continue;
      const next = write?.ok ? write : write?.appliedLive;
      if (event.baseRevisionId !== chainRevision || !next ||
          event.type === "effect.sketchPlaneCommitFailed" || event.type === "effect.documentCursorMoveFailed" ||
          ((event.type === "effect.sketchPlaneCommitted" || event.type === "effect.documentCursorMoved") && !event.accepted)) chainValid = false;
      if (next) {
        observed = next;
        chainRevision = "revisionId" in event ? event.revisionId : next.document.revisionId;
      }
    }
    const inspected = await input.inspect({ commandId: `${command.commandId}:support-handoff` });
    const state = inspected.discovery.state;
    const handoff = !error && chainValid && input.loop.getState().kind === "idle" && (!observed || state.revisionId === chainRevision && snapshotRepresentsRepositoryDocument(input.loop.getState().snapshot, observed));
    const persistenceFailed = !!requestId && !receipt?.ok || cursorReceipts.some(entry => !entry.receipt?.ok);
    const current = await input.service.getCurrentDocumentSnapshot();
    const sketch = current.document.sketches.find(s => s.sketchId === command.sketchId);
    const usable = !!sketch && sketch.sketch.derivedValidity.state === "current" && !current.document.diagnostics.some(d => d.severity === "error");
    const diagnostics = [...inspected.diagnostics, ...(committed?.diagnostics ?? []), ...(failed ? [semanticDiagnostic(new Error(failed.message))] : []), ...(error ? [semanticDiagnostic(error)] : []), ...cursorReceipts.flatMap(entry => entry.receipt && !entry.receipt.ok ? [semanticDiagnostic(new Error(entry.receipt.status.diagnostic.message))] : [])];
    const actualState = !handoff && observed ? { ...state, revisionId: observed.document.revisionId, repositoryHeads: [...observed.metadata.heads] } : state;
    const failures = [...(!committed?.accepted || !applied || error ? ["execution" as const] : []), ...(!handoff ? ["handoff" as const] : []), ...(!usable || !handoff ? ["geometry" as const] : []), ...(persistenceFailed ? ["persistence" as const] : [])];
    if (!requestId && !error && handoff && !persistenceFailed) {
      const unchanged = sketch && getPrimitiveRefKey(sketch.plane.support) === getPrimitiveRefKey(command.support);
      if (!unchanged) diagnostics.push(semanticDiagnostic(new Error("Sketch support is unavailable at the edited timeline cursor.")));
      return { ...terminal, discovery: inspected.discovery, diagnostics, completion: { ...terminal.completion, live: observed ? { kind: "applied", state } : { kind: "unchanged", state }, handoff: { kind: "current", state }, geometry: unchanged ? { kind: usable ? "current" : "failed", state, sketchBasis: null, solve: null, derivation: null, rebuildRevisionId: state.revisionId } : { kind: "not-required" }, persistence: cursorReceipts.length ? { kind: "committed", commandId: command.commandId, transactionId: cursorReceipts.map(entry => entry.event.requestId).join(":"), state } : { kind: "not-required" } }, outcome: unchanged ? usable ? { kind: "completed", change: observed ? "changed" : "unchanged" } : { kind: "failed", failures: ["geometry"] } : observed ? { kind: "failed", failures: ["execution"] } : { kind: "rejected", reasonCode: "sketch-support-unavailable" } };
    }
    return {
      ...terminal,
      discovery: handoff ? inspected.discovery : null,
      diagnostics,
      completion: {
        ...terminal.completion,
        live: observed || state.revisionId !== terminal.completion.live.state!.revisionId ? { kind: "applied", state: actualState } : { kind: "unchanged", state: actualState },
        handoff: handoff ? { kind: "current", state } : { kind: "failed" },
        persistence: requestId || cursorReceipts.length ? { kind: persistenceFailed ? "failed" : "committed", commandId: command.commandId, transactionId: requestId ?? cursorReceipts.map(entry => entry.event.requestId).join(":"), state: actualState } : { kind: "not-required" },
        geometry: { kind: usable && handoff ? "current" : "failed", state: actualState, sketchBasis: null, solve: null, derivation: null, rebuildRevisionId: usable && handoff ? state.revisionId : null },
      },
      outcome: failures.length ? { kind: "failed", failures } : { kind: "completed", change: "changed" },
    };
  }
  async function execute(
    command: SemanticSketchCommand | SemanticHistoryCommand,
  ): Promise<import("@/contracts/semantic/schema").SemanticResult> {
    const before = await input.inspect({
      commandId: `${command.commandId}:before`,
    });
    const initial = discovery(before.discovery);
    const terminal = createSemanticResult(command, initial.state);
    const actualBasis = { documentId: initial.state.documentId, revisionId: initial.state.revisionId, repositoryHeads: initial.state.repositoryHeads };
    const editor = input.loop.getState();
    if (
      command.basis.documentId !== initial.state.documentId ||
      command.basis.revisionId !== initial.state.revisionId ||
      [...command.basis.repositoryHeads].sort().join("\0") !==
        [...initial.state.repositoryHeads].sort().join("\0")
    )
      return {
        ...terminal,
        outcome: { kind: "conflicted" as const, actualBasis },
      };
    if (
      (command.operation === "sketch.begin" || command.operation === "sketch.open" || command.operation === "sketch.support.reassign")
        ? editor.kind !== "idle"
        : editor.kind !== "editingSketch"
    )
      return {
        ...terminal,
        outcome: { kind: "rejected" as const, reasonCode: "editing-context" },
      };
    if (
      "draft" in command &&
      (!command.draft || initial.state.draft?.commandSessionId !==
        command.draft.commandSessionId ||
        initial.state.draft.generation !== command.draft.generation)
    )
      return {
        ...terminal,
        outcome: { kind: "conflicted" as const, actualBasis },
      };
    if (command.operation === "sketch.begin" && "support" in command) {
      const snapshot = await input.service.getCurrentDocumentSnapshot();
      const target = command.support;
      if (!canStartSketchFromTarget(target, snapshot)) return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-support-unavailable" } };
    }
    if (command.operation === "sketch.support.reassign") return reassignSupport(command, terminal);
    if (command.operation === "sketch.image.update" || command.operation === "sketch.image.remove" || command.operation === "sketch.image.replace") {
      if (editor.kind !== "editingSketch" || command.target.sketchId !== (editor.session.sketchId ?? editor.session.actionContextId) || !editor.session.definition.referenceImages?.some(r => r.operationId === command.target.operationId))
        return { ...terminal, outcome: { kind: "rejected", reasonCode: "reference-image-unavailable" } };
    }
    if (command.operation === "sketch.style.patch") {
      if (editor.kind !== "editingSketch" || !command.targets.every(t => t.sketchId === (editor.session.sketchId ?? editor.session.actionContextId)))
        return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-target-unavailable" } };
    }
    if (command.operation === "sketch.reference.add") {
      const key = getPrimitiveRefKey(command.target);
      if (!before.discovery.references.some(r => getPrimitiveRefKey(r.target) === key)) return { ...terminal, outcome: { kind: "rejected", reasonCode: "reference-source-unavailable" } };
    }
    if (command.operation === "sketch.open" && !initial.references.some(r => r.target.kind === "sketch" && r.target.sketchId === command.sketchId))
      return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-unavailable" } };
    if (command.operation === "sketch.mirror.remove" || command.operation === "sketch.mirror.repair") {
      if (editor.kind !== "editingSketch" || !editor.session.definition.derivedRelationships?.some(r => r.kind === "mirror" && r.derivationId === command.derivationId)) return { ...terminal, outcome: { kind: "rejected", reasonCode: "mirror-unavailable" } };
      if (command.operation === "sketch.mirror.repair") {
        const s = editor.session;
        const refs = command.repair.kind === "axis" ? [command.repair.target] : [command.repair.target, command.repair.output];
        if (!refs.every(t => t.sketchId === (s.sketchId ?? s.actionContextId) && (t.kind === "sketchDatumReference" ? t.datumId !== "origin" && t.geometryKind === "lineSegment" : s.definition.entities.some(e => e.entityId === t.entityId)))) return { ...terminal, outcome: { kind: "rejected", reasonCode: "mirror-target-unavailable" } };
      }
    }
    const geometryMutation = command.operation === "sketch.derivation.create" || command.operation === "sketch.mirror.remove" || command.operation === "sketch.mirror.repair" || command.operation === "sketch.mirror.create" || command.operation === "sketch.offset.create" || command.operation === "sketch.offset.remove" || command.operation === "sketch.geometry.build" || command.operation === "sketch.requirement.remove" || command.operation === "sketch.construction.set" || command.operation === "sketch.geometry.update" || command.operation === "sketch.geometry.delete" || command.operation === "sketch.label.set";
    if ((command.operation === "sketch.offset.remove" || command.operation === "sketch.offset.update") && (editor.kind !== "editingSketch" || !editor.session.definition.derivedRelationships?.some(r => r.kind === "offset" && r.derivationId === command.derivationId))) return { ...terminal, outcome: { kind: "rejected", reasonCode: "offset-unavailable" } };
    if (command.operation === "sketch.offset.update" && (typeof command.value === "number" ? !Number.isFinite(command.value) : !command.value.trim()))
      return { ...terminal, outcome: { kind: "rejected", reasonCode: "invalid-offset-distance" } };
    if (geometryMutation && command.operation !== "sketch.offset.remove" && command.operation !== "sketch.mirror.remove" && command.operation !== "sketch.mirror.repair") {
      if (editor.kind !== "editingSketch") throw new Error("Missing private sketch owner.");
      const s = editor.session;
      const targets = command.operation === "sketch.geometry.update" ? command.edit.kind === "mergePoints" ? [command.edit.target, command.edit.destination] : command.edit.kind === "split" || command.edit.kind === "extend" ? [command.edit.target, command.edit.boundary] : [command.edit.target] : (command.operation === "sketch.derivation.create" || command.operation === "sketch.mirror.create" || command.operation === "sketch.offset.create" || command.operation === "sketch.geometry.build" || command.operation === "sketch.geometry.delete" || command.operation === "sketch.requirement.remove") ? command.targets : [command.target];
      const valid = targets.length > 0 && targets.every(t => t.sketchId === (s.sketchId ?? s.actionContextId) && (t.kind === "sketch" || (t.kind === "sketchPoint" ? s.definition.points.some(p => p.pointId === t.pointId) : t.kind === "dimension" ? s.definition.dimensions.some(d => d.dimensionId === t.dimensionId) : t.kind === "constraint" ? s.definition.constraints.some(c => c.constraintId === t.constraintId) : s.definition.entities.some(e => e.entityId === t.entityId))));
      if (!valid) return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-target-unavailable" } };
      if (command.operation === "sketch.mirror.create") {
        const axis = command.axis;
        if (axis.sketchId !== (s.sketchId ?? s.actionContextId) || (axis.kind === "sketchEntity" ? !s.definition.entities.some(e => e.entityId === axis.entityId) : axis.datumId === "origin" || axis.geometryKind !== "lineSegment")) return { ...terminal, outcome: { kind: "rejected", reasonCode: "mirror-axis-unavailable" } };
      }
      if (command.operation === "sketch.label.set" && !command.label.trim()) return { ...terminal, outcome: { kind: "rejected", reasonCode: "invalid-label" } };
    }
    if (command.operation === "sketch.author") {
      const p = command.primitive;
      const valid = validateSketchPrimitive(p);
      if (p.kind === "tangentArc" && p.source) {
        if (editor.kind !== "editingSketch") throw new Error("Missing private sketch owner.");
        const s = editor.session;
        const sourceId = p.source.entityId;
        if (p.source.sketchId !== (s.sketchId ?? s.actionContextId) || !canUseTangentArcSourceAtPoint(s.definition, sourceId, p.start))
          return { ...terminal, outcome: { kind: "rejected", reasonCode: "tangent-source-unavailable" }, diagnostics: [semanticDiagnostic(new Error("Tangent arc source must be an owned line, circle or arc; construction endpoints are not supported."))] };
      }
      if (sketchPrimitiveContributionInput(p).points.some(point => !Number.isFinite(point[0]) || !Number.isFinite(point[1])) || (!valid.valid && (command.intent !== "author-invalid" || !["point", "line", "rectangle", "centerPointRectangle"].includes(p.kind))))
        return {
          ...terminal,
          outcome: {
            kind: "rejected" as const,
            reasonCode: "invalid-primitive",
          },
          diagnostics: [
            semanticDiagnostic(
              new Error(valid.message ?? "Coordinates must be finite."),
            ),
          ],
        };
    }
    if (
      command.operation === "sketch.publish" &&
      command.requireProfiles &&
      initial.sketch?.profiles.length === 0
    )
      return {
        ...terminal,
        outcome: { kind: "rejected" as const, reasonCode: "profiles-unusable" },
      };
    if (command.operation === "sketch.requirement.add") {
      if (editor.kind !== "editingSketch") throw new Error("Missing private sketch owner.");
      const s = editor.session;
      if (!command.targets.length || !command.targets.every(t => t.kind === "projectedReferenceGeometry" ? s.projectedReferences.some(r => r.status === "projected" && r.referenceId === t.referenceId && r.geometry.some(g => g.geometryId === t.geometryId && g.kind === t.geometryKind)) : t.sketchId === (s.sketchId ?? s.actionContextId) && (t.kind === "sketchDatumReference" || (t.kind === "sketchPoint" ? s.definition.points.some(p => p.pointId === t.pointId) : s.definition.entities.some(e => e.entityId === t.entityId)))) || (command.tool.startsWith("dimension") && command.mode === "driving" && (command.value === null || !Number.isFinite(command.value) || command.value <= 0)))
        return { ...terminal, outcome: { kind: "rejected", reasonCode: "invalid-requirement-target-or-value" } };
    }
    if (command.operation === "sketch.dimension.add" || command.operation === "sketch.dimension.update" || command.operation === "sketch.dimension.reference") {
      if (editor.kind !== "editingSketch") throw new Error("Missing private sketch owner.");
      const validTarget = command.operation === "sketch.dimension.add"
        ? command.points[0] !== command.points[1] && command.points.every(id => editor.session.definition.points.some(p => p.pointId === id))
        : editor.session.definition.dimensions.some(d => d.dimensionId === command.dimensionId);
      if (!validTarget || ("value" in command && (typeof command.value === "number" ? !Number.isFinite(command.value) || command.value <= 0 : !command.value.trim())))
        return { ...terminal, outcome: { kind: "rejected", reasonCode: "invalid-dimension-target-or-value" } };
    }
    if (command.operation === "history.undo" || command.operation === "history.redo") {
      const direction = command.operation === "history.undo" ? "undo" : "redo";
      const entries = editor.kind === "editingSketch" ? editor.session.actionHistory?.[direction] ?? [] : [];
      if (command.actionSequence === undefined ? !entries.length : !entries.some(e => e.sequence === command.actionSequence))
        return { ...terminal, outcome: { kind: "unavailable", capability: command.operation } };
    }
    // Public draft references name the owned action context. Existing editor
    // definitions still use their internal draft identity until publication.
    const editorTarget = <T extends { sketchId: import("@/contracts/shared/ids").SketchId }>(target: T): T => ({ ...target, sketchId: editor.kind === "editingSketch" ? getSessionSketchId(editor.session) : target.sketchId });
    const priorGeometry = geometry(initial.state);
    let events: readonly EditorEvent[] = [];
    let editQuery: { requestId: RequestId; generation: number } | undefined;
    let publicationReceipt:
      | import("@/contracts/modeling/document-repository").DocumentRepositoryMutationResult
      | undefined;
    const cursorWrites: { event: Extract<EditorEvent, { type: "effect.documentCursorMoved" | "effect.documentCursorMoveFailed" }>; receipt: import("@/contracts/modeling/document-repository").DocumentRepositoryMutationResult | undefined }[] = [];
    try {
      if (command.operation === "sketch.begin")
        events = await input.loop.dispatchAndSettle(command.commandId, {
          type: "sketch.beginRequested",
          target: "support" in command ? command.support : {
            kind: "construction",
            constructionId:
              `construction_plane-${command.plane}` as ConstructionId,
          },
        });
      if (command.operation === "sketch.open")
        events = await input.loop.dispatchAndSettle(command.commandId, {
          type: "sketch.beginRequested",
          target: { kind: "sketch", sketchId: command.sketchId },
        });
      if (command.operation === "sketch.geometry.update") {
        const edit = { ...command.edit };
        edit.target = editorTarget(edit.target);
        if (edit.kind === "mergePoints") edit.destination = editorTarget(edit.destination);
        if (edit.kind === "split" || edit.kind === "extend") edit.boundary = editorTarget(edit.boundary);
        if (edit.kind === "trim" || edit.kind === "extend" || edit.kind === "split") {
          if (editor.kind !== "editingSketch") throw new Error("Missing private sketch owner.");
          const operation: import("@/contracts/sketch/edit-intersections").SketchEditOperation = edit.kind === "trim" ? { kind: edit.kind, targetEntityId: edit.target.entityId } : edit.kind === "extend" ? { kind: edit.kind, targetEntityId: edit.target.entityId, boundaryEntityId: edit.boundary.entityId } : { kind: edit.kind, targetEntityId: edit.target.entityId, boundaryEntityId: edit.boundary.entityId, pick: [edit.pick[0], edit.pick[1]], requireUniquePick: true };
          const prepared = prepareSketchIntersectionEdit(editor.session, operation);
          if ("message" in prepared) return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-edit-refused" }, diagnostics: [semanticDiagnostic(new Error(prepared.message))] };
          const requestId = `request_semantic-edit-${crypto.randomUUID()}` as RequestId;
          if (!input.service.sketchSolver) throw new Error("Sketch edit-intersection queries require the modeling service sketch solver.");
          const answer = requireQuerySketchEditIntersectionsResponse(await input.service.sketchSolver.querySketchEditIntersections({ solverSchemaVersion: SOLVER_SCHEMA_VERSION, requestId, documentId: initial.state.documentId, revisionId: initial.state.revisionId, sketchId: getSessionSketchId(editor.session), ...prepared.input }));
          if (answer.requestId !== requestId || answer.documentId !== initial.state.documentId || answer.revisionId !== initial.state.revisionId || answer.sketchId !== getSessionSketchId(editor.session)) throw new Error("Sketch edit query response does not match its owned request.");
          editQuery = { requestId: answer.requestId, generation: prepared.generation };
          events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.intersectionEditCompleted", basis: prepared, result: answer.result });
        } else events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.geometryUpdated", edit });
      }
      if (command.operation === "sketch.reference.add")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.referenceAuthored", target: command.target });
      if (command.operation === "sketch.image.update")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.imageEdited", target: editorTarget(command.target), edit: command.edit });
      if (command.operation === "sketch.image.remove")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.imageRemoved", target: editorTarget(command.target) });
      if (command.operation === "sketch.image.replace") {
        if (!input.referenceImageFiles) return { ...terminal, outcome: { kind: "unavailable", capability: "reference-image-files" } };
        const image = await input.referenceImageFiles.read(command.path);
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.imageEdited", target: editorTarget(command.target), edit: { kind: "replace", image } });
      }
      if (command.operation === "sketch.image.add") {
        if (!input.referenceImageFiles) return { ...terminal, outcome: { kind: "unavailable", capability: "reference-image-files" } };
        const payload = await input.referenceImageFiles.read(command.path);
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.imageAuthored", payload });
      }
      if (command.operation === "sketch.style.patch")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.styleAuthored", targets: command.targets.map(editorTarget), patch: command.patch });
      if (command.operation === "sketch.derivation.create")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.derivationCreated", input: { ...command, targets: command.targets.map(editorTarget) } });
      if (command.operation === "sketch.mirror.remove")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.mirrorRemoved", derivationId: command.derivationId });
      if (command.operation === "sketch.mirror.repair")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.mirrorRepaired", repair: { derivationId: command.derivationId, target: command.repair.kind === "axis" ? "axis" : { outputEntityId: command.repair.output.entityId }, returnSelection: [] }, target: editorTarget(command.repair.target) });
      if (command.operation === "sketch.mirror.create")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.mirrorCreated", targets: command.targets.map(editorTarget), axis: editorTarget(command.axis) });
      if (command.operation === "sketch.offset.remove")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.offsetRemoved", derivationId: command.derivationId });
      if (command.operation === "sketch.offset.update") {
        // Use the workbench's annotation editor, including its authored-value
        // parsing, single Save action and offset diagnostics/publication owner.
        for (const patch of [
          { intent: "editOffsetDistance", derivationId: command.derivationId },
          { value: command.value },
          { intent: "commitAnnotationValue" },
        ]) events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.toolPatched", patch });
      }
      if (command.operation === "sketch.offset.create") {
        if (editor.kind !== "editingSketch") throw new Error("Missing private sketch owner.");
        const seeds = command.targets.map(t => t.entityId);
        let prepared = prepareSketchOffset(editor.session, seeds, command.distance, command.side);
        if ("message" in prepared) return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-edit-refused" }, diagnostics: [semanticDiagnostic(new Error(prepared.message))] };
        const runtime = createModelingServiceEditorEffectRuntime(input.service);
        const publish = async (p: typeof prepared) => {
          if ("message" in p) throw new Error(p.message);
          const result = await runtime.deriveSketchRegions!({ requestId: `request_semantic-offset-${crypto.randomUUID()}` as RequestId, documentId: initial.state.documentId, baseRevisionId: initial.state.revisionId, basis: p.basis, derivationLane: "offsetPreview" });
          return result.offsetPublications.find(r => r.derivationId === p.derivationId);
        };
        let record = await publish(prepared);
        if (record?.status === "planChanged" && record.plan) {
          prepared = prepareSketchOffset(editor.session, seeds, command.distance, command.side, record.plan);
          if ("message" in prepared) return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-edit-refused" }, diagnostics: [semanticDiagnostic(new Error(prepared.message))] };
          record = await publish(prepared);
        }
        if (!record || record.status !== "certified") return { ...terminal, outcome: { kind: "rejected", reasonCode: "offset-not-certified" }, diagnostics: [semanticDiagnostic(new Error(record?.diagnostic?.message ?? "Offset geometry is not certified."))] };
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.offsetCompleted", prepared, record });
      }
      if (command.operation === "sketch.geometry.build")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.geometryBuilt", input: command.kind === "fillet" ? { kind: command.kind, targets: command.targets.map(editorTarget), radius: command.radius } : command.kind === "chamfer" ? { kind: command.kind, targets: command.targets.map(editorTarget), distance: command.distance } : { kind: command.kind, targets: command.targets.map(editorTarget), width: command.width } });
      if (command.operation === "sketch.geometry.delete")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.geometryDeleted", targets: command.targets.map(editorTarget) });
      if (command.operation === "sketch.label.set")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.labelSet", target: editorTarget(command.target), label: command.label });
      if (command.operation === "sketch.construction.set")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.constructionSet", target: editorTarget(command.target), construction: command.construction });
      if (command.operation === "sketch.author")
        events = await input.loop.dispatchAndSettle(command.commandId, {
          type: "sketch.primitiveAuthored",
          primitive: command.primitive,
          construction: command.construction,
        });
      if (command.operation === "sketch.requirement.remove")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.requirementRemoved", targets: command.targets.map(editorTarget) });
      if (command.operation === "sketch.requirement.add")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.requirementAuthored", input: { tool: command.tool, targets: command.targets.map(t => "sketchId" in t ? editorTarget(t) : t), mode: command.mode, value: command.value } });
      if (command.operation === "sketch.dimension.add") {
        const { axis, points, mode } = command;
        const dimension = mode === "driving" ? { axis, points, mode, value: command.value } : { axis, points, mode };
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.dimensionAuthored", input: dimension });
      }
      if (command.operation === "sketch.dimension.reference")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.dimensionMadeReference", dimensionId: command.dimensionId });
      if (command.operation === "sketch.dimension.update")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.dimensionUpdated", dimensionId: command.dimensionId, value: command.value });
      if (command.operation === "history.undo" || command.operation === "history.redo")
        events = await input.loop.dispatchAndSettle(command.commandId, { type: command.operation === "history.undo" ? "history.undoRequested" : "history.redoRequested", actionSequence: command.actionSequence });
      if (command.operation === "sketch.publish")
        events = await input.loop.dispatchAndSettle(command.commandId, {
          type: "sketch.publishRequested",
        });
      if (command.operation === "sketch.discard")
        events = await input.loop.dispatchAndSettle(command.commandId, {
          type: "sketch.discardRequested",
        });
      // Preserve originating effect evidence before authoritative inspection can fail.
      terminal.diagnostics = events.flatMap((event) =>
        event.type === "effect.sketchCommitted"
          ? event.diagnostics
          : event.type.endsWith("Failed") && "message" in event
            ? [semanticDiagnostic(new Error(event.message))]
            : [],
      );
      for (const event of events) if (event.type === "effect.documentCursorMoved" || event.type === "effect.documentCursorMoveFailed") {
        cursorWrites.push({ event, receipt: input.publications.takeCursor(event.baseRevisionId) });
      }
      const finalEditor = input.loop.getState();
      for (const e of events)
        if (
          e.type === "effect.sketchRegionsDerived" &&
          finalEditor.kind === "editingSketch" &&
          e.commandSessionId === finalEditor.command.commandSessionId &&
          e.generation === finalEditor.session.liveRegions.generation &&
          finalEditor.session.liveRegions.status === "current"
        )
          certificate = {
            commandSessionId: e.commandSessionId,
            generation: e.generation,
            requestId: e.requestId,
          };
      if ((command.operation === "history.undo" || command.operation === "history.redo") && finalEditor.kind === "editingSketch") {
        const direction = command.operation === "history.undo" ? "undo" : "redo";
        const entries = finalEditor.session.actionHistory?.[direction] ?? [];
        const blocked = command.actionSequence === undefined ? entries.at(-1) : entries.find(e => e.sequence === command.actionSequence);
        if (blocked?.blockedReason)
          return { ...terminal, outcome: { kind: "conflicted", actualBasis }, diagnostics: [...terminal.diagnostics, semanticDiagnostic(new Error(blocked.blockedReason))] };
      }
      if ((geometryMutation || command.operation === "sketch.image.update" || command.operation === "sketch.image.replace" || command.operation === "sketch.image.remove" || command.operation === "sketch.style.patch" || command.operation === "sketch.reference.add" || command.operation === "sketch.requirement.add" || command.operation === "sketch.dimension.update" || command.operation === "sketch.dimension.reference" || command.operation === "sketch.offset.update") && editor.kind === "editingSketch" && finalEditor.kind === "editingSketch" && finalEditor.session.definition === editor.session.definition && finalEditor.session.sketchLabel === editor.session.sketchLabel) {
        // Some semantic commands drive interactive tools; their refusals live
        // with the tool, while explicit commands return session diagnostics.
        const refusal = finalEditor.session.toolPresentation?.validation?.[0]?.message
          ?? finalEditor.session.validationMessage;
        if (refusal && refusal !== keptSketchWithheldRegionText(finalEditor.session)) return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-edit-refused" }, diagnostics: [semanticDiagnostic(new Error(refusal))] };
        return { ...terminal, outcome: priorGeometry.kind === "current" ? { kind: "completed", change: "unchanged" } : { kind: "failed", failures: ["geometry"] }, discovery: initial, completion: { ...terminal.completion, handoff: { kind: "current", state: initial.state }, geometry: priorGeometry } };
      }
      if (command.operation === "sketch.publish" && finalEditor.kind === "editingSketch") {
        const notice = getPeerDeletedSketchNotice(finalEditor);
        if (notice) return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-deleted" },
          diagnostics: [semanticDiagnostic(new Error(notice))] };
      }
      const ownedSnapshot = finalEditor.snapshot;
      const ownedState: SemanticState = {
        ...initial.state,
        ...(ownedSnapshot?.provenance
          ? {
              documentId: ownedSnapshot.document.documentId,
              revisionId: ownedSnapshot.document.revisionId,
              repositoryHeads: [...ownedSnapshot.provenance.repositoryHeads],
            }
          : {}),
        editingContext:
          finalEditor.kind === "editingSketch"
            ? { kind: "sketch", sketchId: finalEditor.session.actionContextId }
            : { kind: "document" },
        draft:
          finalEditor.kind === "editingSketch"
            ? {
                commandSessionId: finalEditor.command.commandSessionId,
                generation: finalEditor.session.liveRegions.generation,
              }
            : null,
      };
      terminal.completion.live =
        (command.operation === "sketch.inspect" || command.operation === "history.inspect")
          ? { kind: "unchanged", state: ownedState }
          : { kind: "applied", state: ownedState };
      if (command.operation === "sketch.publish") {
        const finished = events.find(
          (e) =>
            e.type === "effect.sketchCommitted" ||
            e.type === "effect.sketchCommitFailed",
        );
        if (finished && "requestId" in finished) {
          publicationReceipt = input.publications.take(finished.requestId);
          const applied = publicationReceipt?.ok
            ? publicationReceipt
            : publicationReceipt?.appliedLive;
          if (applied) {
            const actualState = {
              ...ownedState,
              revisionId: snapshotRepresentsRepositoryDocument(ownedSnapshot, applied)
                ? ownedSnapshot!.document.revisionId : applied.document.revisionId,
              repositoryHeads: [...applied.metadata.heads],
            };
            terminal.completion.live = { kind: "applied", state: actualState };
            terminal.completion.persistence = {
              kind: publicationReceipt!.ok ? "committed" : "failed",
              commandId: command.commandId,
              transactionId: finished.requestId,
              state: actualState,
            };
          } else {
            terminal.completion.live = { kind: "unchanged", state: ownedState };
            if (publicationReceipt && !publicationReceipt.ok)
              terminal.completion.persistence = {
                kind: "failed",
                commandId: command.commandId,
                transactionId: finished.requestId,
                state: ownedState,
              };
          }
        }
      }
      const inspected = await input.inspect({
        commandId: `${command.commandId}:after`,
      });
      terminal.discovery = discovery(inspected.discovery);
      const state = terminal.discovery.state;
      terminal.completion.live =
        (command.operation === "sketch.inspect" || command.operation === "history.inspect")
          ? { kind: "unchanged", state }
          : { kind: "applied", state };
      terminal.completion.handoff = { kind: "current", state };
      terminal.completion.geometry = geometry(state);
      if (editQuery && terminal.completion.geometry.kind !== "not-required") terminal.completion.geometry.editQuery = editQuery;
      terminal.diagnostics = [
        ...terminal.diagnostics,
        ...inspected.diagnostics,
        ...(finalEditor.kind === "editingSketch" ? finalEditor.session.projectionDiagnostics.map(d => ({ code: d.code, severity: d.severity, message: d.message, target: null, detail: null })) : []),
        ...(terminal.discovery.sketch?.validity.diagnostics ?? []).map((d) => ({
          // Sketch-specific context stays in discovery.sketch.validity; this
          // projection has the narrower ModelingDiagnostic transport shape.
          code: d.code,
          severity: d.severity,
          message: d.message,
          target: null,
          detail: null,
        })),
      ];
      terminal.outcome =
        terminal.completion.geometry.kind === "current"
          ? {
              kind: "completed",
              change:
                (command.operation === "sketch.inspect" || command.operation === "history.inspect")
                  ? "unchanged"
                  : "changed",
            }
          : { kind: "failed", failures: ["geometry"] };
      if (command.operation === "sketch.discard") {
        terminal.completion.geometry = { kind: "not-required" };
        terminal.outcome =
          input.loop.getState().kind === "idle" &&
          !events.some((e) => e.type.endsWith("Failed"))
            ? { kind: "completed", change: "changed" }
            : { kind: "failed", failures: ["handoff"] };
      }
      if (command.operation === "sketch.publish") {
        const committed = events.find(
          (e): e is Extract<EditorEvent, { type: "effect.sketchCommitted" }> =>
            e.type === "effect.sketchCommitted",
        );
        const commitFailure = events.find(
          (
            e,
          ): e is Extract<EditorEvent, { type: "effect.sketchCommitFailed" }> =>
            e.type === "effect.sketchCommitFailed",
        );
        const publicationRequestId =
          committed?.requestId ?? commitFailure?.requestId;
        const receipt = publicationReceipt;
        const publicationApplied = receipt?.ok ? receipt : receipt?.appliedLive;
        let applied = publicationApplied;
        let cursorChainValid = true;
        let liveRevision = committed?.revisionId ?? publicationApplied?.document.revisionId;
        for (const cursor of cursorWrites) {
          const next = cursor.receipt?.ok ? cursor.receipt : cursor.receipt?.appliedLive;
          if (!applied || cursor.event.baseRevisionId !== liveRevision || !next || cursor.event.type !== "effect.documentCursorMoved" || !cursor.event.accepted) cursorChainValid = false;
          if (next) {
            applied = next;
            liveRevision = cursor.event.type === "effect.documentCursorMoved" ? cursor.event.revisionId : next.document.revisionId;
          }
        }
        const persistenceFailed = !receipt?.ok || cursorWrites.some(c => !c.receipt?.ok);
        if (
          applied &&
          (!committed?.accepted || !cursorChainValid ||
            state.revisionId !== liveRevision ||
            !snapshotRepresentsRepositoryDocument(input.loop.getState().snapshot, applied))
        ) {
          const finalCursorApplied = cursorWrites.some(c => c.event.type === "effect.documentCursorMoved" && c.event.accepted && c.event.revisionId === state.revisionId);
          // A failed cursor write does not roll the already accepted kernel cursor back
          // to the publication revision. Preserve the observed final live basis.
          const actualState = finalCursorApplied ? state : {
            ...state,
            revisionId: applied.document.revisionId,
            repositoryHeads: [...applied.metadata.heads],
          };
          terminal.completion.live = { kind: "applied", state: actualState };
          terminal.completion.persistence = {
            kind: persistenceFailed ? "failed" : "committed",
            commandId: command.commandId,
            transactionId: publicationRequestId!,
            state: actualState,
          };
          terminal.completion.handoff = { kind: "failed" };
          terminal.completion.geometry = {
            ...priorGeometry,
            kind: "failed",
            state: actualState,
            rebuildRevisionId: null,
          } as SemanticGeometryReceipt;
          terminal.discovery = null;
          terminal.outcome = {
            kind: "failed",
            failures: [
              "execution",
              "handoff",
              "geometry",
              ...(persistenceFailed ? ["persistence" as const] : []),
            ],
          };
          terminal.diagnostics = [
            ...terminal.diagnostics,
            semanticDiagnostic(new Error("Publication snapshot does not match the exact accepted transaction and cursor restoration.")),
            ...cursorWrites.flatMap(c => c.receipt && !c.receipt.ok ? [semanticDiagnostic(new Error(c.receipt.status.diagnostic.message))] : []),
          ];
          return terminal;
        }
        if (committed?.accepted && applied) {
          terminal.completion.persistence = {
            kind: persistenceFailed ? "failed" : "committed",
            commandId: command.commandId,
            transactionId: committed.requestId,
            state,
          };
          const snapshot = await input.service.getCurrentDocumentSnapshot();
          const sketch = snapshot.document.sketches.find(
            (s) => s.sketchId === committed.publishedSketchId,
          )?.sketch;
          if (!sketch)
            throw new Error(
              "Published sketch is absent from the authoritative snapshot.",
            );
          const boundaryBasis = regionBoundaryBasisOfRecord(sketch);
          // The production image-import contract persists image-only metadata
          // with notEvaluated geometry. Like an empty draft, it has no profile
          // obligation; do not manufacture a solved status or native faces.
          const imageOnly = (sketch.definition.referenceImages?.length ?? 0) > 0 &&
            isUnevaluatedMetadataOnlySketch(sketch.definition, sketch.solvedSnapshot);
          const usable =
            !snapshot.document.diagnostics.some(d => d.severity === "error") &&
            (sketch.derivedValidity.state === "current" || imageOnly) &&
            sketchProfileGateFailures(sketch.solvedSnapshot).length === 0 &&
            sketch.regions.every((r) =>
              r.loops.every((l) =>
                l.segments.every(
                  (segment) =>
                    resolveRegionBoundaryCurve(boundaryBasis, segment).kind !==
                    "failed",
                ),
              ),
            );
          terminal.discovery.sketch = {
            ...initial.sketch!,
            ...dimensionDiscovery(sketch.definition, sketch.solvedSnapshot),
            support: snapshot.document.sketches.find(s => s.sketchId === committed.publishedSketchId)!.plane,
            references: sketch.definition.references.map(definition => {
              const projection = sketch.projectedReferences?.find(r => r.referenceId === definition.referenceId) ?? null;
              return { definition, revisionId: projection ? snapshot.document.revisionId : null, projection };
            }),
            sketchId: sketch.sketchId,
            solveStatus: sketch.solvedSnapshot.status,
            validity: sketch.derivedValidity,
            points: sketch.definition.points.map((p) => ({
              pointId: p.pointId,
              position: p.position,
              construction: p.isConstruction,
            })),
            entities: entityDiscovery(sketch.definition),
            styles: sketch.definition.styles ?? [],
            referenceImages: sketch.definition.referenceImages ?? [],
            profiles: usable
              ? sketch.regions
                  .filter((r) => r.isClosed)
                  .map((r) => ({ regionId: r.regionId, isClosed: r.isClosed }))
              : [],
          };
          terminal.completion.geometry = {
            ...priorGeometry,
            kind: usable ? "current" : "failed",
            state,
            solve: committed.solverCorrelation
              ? {
                  requestId: committed.solverCorrelation.solveRequestId,
                  generation: initial.state.draft!.generation,
                }
              : null,
            derivation: committed.solverCorrelation
              ? {
                  requestId: committed.solverCorrelation.regionRequestId,
                  generation: initial.state.draft!.generation,
                }
              : null,
            rebuildRevisionId: state.revisionId,
          } as SemanticGeometryReceipt;
          const failures = [
            ...(persistenceFailed ? ["persistence" as const] : []),
            ...(!usable ||
            (command.requireProfiles &&
              !terminal.discovery.sketch.profiles.length)
              ? ["geometry" as const]
              : []),
            ...(events.some((e) => e.type.endsWith("Failed"))
              ? ["handoff" as const]
              : []),
          ];
          terminal.outcome = failures.length
            ? { kind: "failed", failures }
            : { kind: "completed", change: "changed" };
        } else if (
          !committed &&
          initial.sketch?.entities.length === 0 &&
          input.loop.getState().kind === "idle"
        ) {
          terminal.completion.live = { kind: "unchanged", state };
          terminal.completion.geometry = {
            ...priorGeometry,
            state,
          } as SemanticGeometryReceipt;
          terminal.discovery.sketch = initial.sketch;
          terminal.outcome = { kind: "completed", change: "unchanged" };
        } else {
          terminal.completion.live = { kind: "unchanged", state };
          terminal.outcome = {
            kind: "failed",
            failures: [
              "execution",
              ...(terminal.completion.persistence.kind === "failed"
                ? ["persistence" as const]
                : []),
            ],
          };
        }
      }
      if (command.operation !== "sketch.publish" && cursorWrites.length) {
        const failed = cursorWrites.some(c => !c.receipt?.ok);
        terminal.completion.persistence = { kind: failed ? "failed" : "committed", commandId: command.commandId, transactionId: cursorWrites.map(c => c.event.requestId).join(":"), state };
        if (failed) terminal.outcome = { kind: "failed", failures: [...(terminal.outcome.kind === "failed" ? terminal.outcome.failures : []), "persistence"] };
      }
      if (
        terminal.completion.geometry.kind === "invalid-editable" &&
        "intent" in command &&
        command.intent === "author-invalid"
      )
        terminal.outcome = { kind: "accepted-invalid" };
      if (
        (command.operation === "sketch.inspect" || command.operation === "history.inspect") &&
        terminal.completion.geometry.kind === "invalid-editable"
      )
        terminal.outcome = { kind: "completed", change: "unchanged" };
      return terminal;
    } catch (error) {
      return {
        ...terminal,
        outcome: {
          kind: "failed" as const,
          failures: [
            "execution" as const,
            "handoff" as const,
            ...(terminal.completion.geometry.kind !== "not-required"
              ? ["geometry" as const]
              : []),
            ...(terminal.completion.persistence.kind === "failed"
              ? ["persistence" as const]
              : []),
          ],
        },
        completion: {
          ...terminal.completion,
          handoff: { kind: "failed" },
          geometry:
            terminal.completion.geometry.kind === "not-required"
              ? terminal.completion.geometry
              : { ...terminal.completion.geometry, kind: "failed" },
        },
        discovery: null,
        diagnostics: [...terminal.diagnostics, semanticDiagnostic(error)],
      };
    }
  }
  return { execute, discovery };
}
