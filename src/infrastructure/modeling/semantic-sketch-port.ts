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
} from "@/domain/editor/sketch-session/internals";
import { getSketchToolDefinition } from "@/core/sketch-tools/registry";
import { validateAlignedRectanglePoints } from "@/core/sketch-tools/tools/aligned-rectangle";
import {
  regionBoundaryBasisOfRecord,
  resolveRegionBoundaryCurve,
} from "@/contracts/sketch/region-boundary-curves";
import { sketchProfileGateFailures } from "@/contracts/sketch/derived-validity";

import { isReferenceDimension } from "@/contracts/sketch/schema";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import { getEntityPointIds } from "@/domain/sketch-editing/definition-references";

function entityDiscovery(definition: import("@/contracts/sketch/schema").SketchDefinition): NonNullable<SemanticDiscovery["sketch"]>["entities"] {
  return definition.entities.map(e => ({
    entityId: e.entityId, kind: e.kind, pointIds: getEntityPointIds(e), construction: e.isConstruction,
    ...(e.kind === "circle" ? { radius: e.radius } : e.kind === "arc" ? { radius: (() => {
      const center = definition.points.find(p => p.pointId === e.centerPointId)!.position;
      const start = definition.points.find(p => p.pointId === e.startPointId)!.position;
      return Math.hypot(start[0] - center[0], start[1] - center[1]);
    })() } : {}),
    ...(e.kind === "spline" ? { tangents: e.pointOccurrences.map(o => ({ occurrenceId: o.occurrenceId, pointId: o.pointId, vector: o.tangent.kind === "authored" ? o.tangent.vector : null })) } : {}),
  }));
}

function dimensionDiscovery(
  definition: import("@/contracts/sketch/schema").SketchDefinition,
  solved: import("@/contracts/sketch/schema").SolvedSketchSnapshot,
) {
  const values = new Map(solved.dimensionStatuses.map(s => [s.dimensionId, s.solvedValue]));
  return {
    requirements: definition.dimensions.filter(d => !isReferenceDimension(d)).map(d => ({
      dimensionId: d.dimensionId, label: d.label, mode: "driving" as const,
      value: "value" in d ? getAuthoredLiteralValue(d.value) : null,
      measuredValue: values.get(d.dimensionId) ?? null,
    })),
    measurements: definition.dimensions.filter(isReferenceDimension).map(d => ({
      dimensionId: d.dimensionId, label: d.label, mode: "reference" as const,
      measuredValue: values.get(d.dimensionId) ?? null,
    })),
  };
}

/** Certificates only are retained here; the editor/action owner owns all draft state. */
export function createSemanticSketchPort(input: {
  loop: EditorEventLoop;
  service: import("@/domain/modeling/modeling-service").ModelingService;
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
    const usable =
      hasAcceptedLiveSolveOfDefinition(s) &&
      s.liveRegions.status === "current" &&
      sketchProfileGateFailures(s.liveSolve!.solvedSnapshot).length === 0 &&
      getLiveRegionBoundaryDiagnostics(s.liveRegions).length === 0;
    return {
      ...base,
      state,
      references: [
        ...base.references.filter(r => !("sketchId" in r.target && r.target.sketchId === (s.sketchId ?? s.actionContextId))),
        { label: s.sketchLabel, target: { kind: "sketch", sketchId: s.sketchId ?? s.actionContextId } },
        ...s.definition.points.map(p => ({ label: p.label, target: { kind: "sketchPoint" as const, sketchId: s.sketchId ?? s.actionContextId, pointId: p.pointId } })),
        ...s.definition.entities.map(e => ({ label: e.label, target: { kind: "sketchEntity" as const, sketchId: s.sketchId ?? s.actionContextId, entityId: e.entityId } })),
        ...s.definition.dimensions.map(d => ({ label: d.label, target: { kind: "dimension" as const, sketchId: s.sketchId ?? s.actionContextId, dimensionId: d.dimensionId } })),
        ...s.definition.constraints.map(c => ({ label: c.label, target: { kind: "constraint" as const, sketchId: s.sketchId ?? s.actionContextId, constraintId: c.constraintId } })),
        ...(usable ? s.liveRegions.regions.filter(r => r.isClosed).map(r => ({ label: r.label, target: { kind: "region" as const, sketchId: s.sketchId ?? s.actionContextId, regionId: r.regionId } })) : []),
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
        sketchId: s.sketchId,
        plane: s.plane.key!,
        solveStatus: s.liveSolve!.solvedSnapshot.status,
        validity: getSketchSessionDerivedValidity(s),
        points: s.definition.points.map((p) => ({
          pointId: p.pointId,
          position: p.position,
          construction: p.isConstruction,
        })),
        entities: entityDiscovery(s.definition),
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
    const current =
      empty ||
      (hasAcceptedLiveSolveOfDefinition(s) &&
        s.liveRegions.status === "current" &&
        getLiveRegionBoundaryDiagnostics(s.liveRegions).length === 0);
    return {
      kind: current
        ? "current"
        : s.liveRegions.status === "failed" ||
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
  async function execute(
    command: SemanticSketchCommand | SemanticHistoryCommand,
  ): Promise<import("@/contracts/semantic/schema").SemanticResult> {
    const before = await input.inspect({
      commandId: `${command.commandId}:before`,
    });
    const initial = discovery(before.discovery);
    const terminal = createSemanticResult(command, initial.state);
    const editor = input.loop.getState();
    if (
      command.basis.documentId !== initial.state.documentId ||
      command.basis.revisionId !== initial.state.revisionId ||
      [...command.basis.repositoryHeads].sort().join("\0") !==
        [...initial.state.repositoryHeads].sort().join("\0")
    )
      return {
        ...terminal,
        outcome: { kind: "conflicted" as const, actualBasis: initial.state },
      };
    if (
      (command.operation === "sketch.begin" || command.operation === "sketch.open")
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
        outcome: { kind: "conflicted" as const, actualBasis: initial.state },
      };
    if (command.operation === "sketch.open" && !initial.references.some(r => r.target.kind === "sketch" && r.target.sketchId === command.sketchId))
      return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-unavailable" } };
    const geometryMutation = command.operation === "sketch.construction.set" || command.operation === "sketch.geometry.update" || command.operation === "sketch.geometry.delete" || command.operation === "sketch.label.set";
    if (geometryMutation) {
      if (editor.kind !== "editingSketch") throw new Error("Missing private sketch owner.");
      const s = editor.session;
      const targets = command.operation === "sketch.geometry.update" ? [command.edit.target] : command.operation === "sketch.geometry.delete" ? command.targets : [command.target];
      const valid = targets.length > 0 && targets.every(t => t.sketchId === (s.sketchId ?? s.actionContextId) && (t.kind === "sketch" || (t.kind === "sketchPoint" ? s.definition.points.some(p => p.pointId === t.pointId) : t.kind === "dimension" ? s.definition.dimensions.some(d => d.dimensionId === t.dimensionId) : t.kind === "constraint" ? s.definition.constraints.some(c => c.constraintId === t.constraintId) : s.definition.entities.some(e => e.entityId === t.entityId))));
      if (!valid) return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-target-unavailable" } };
      if (command.operation === "sketch.label.set" && !command.label.trim()) return { ...terminal, outcome: { kind: "rejected", reasonCode: "invalid-label" } };
    }
    if (command.operation === "sketch.author") {
      const p = command.primitive;
      const start = p.kind === "point" ? p.position : p.start;
      const end = p.kind === "point" ? p.position : p.end;
      const points =
        p.kind === "alignedRectangle"
          ? [start, end, p.heightPoint]
          : [start, end];
      const valid =
        p.kind === "alignedRectangle"
          ? validateAlignedRectanglePoints(points)
          : getSketchToolDefinition(p.kind).validate(start, end);
      if (
        points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1])) ||
        (!valid.valid && command.intent !== "author-invalid") ||
        (!valid.valid && p.kind === "alignedRectangle")
      )
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
    if (command.operation === "sketch.dimension.add" || command.operation === "sketch.dimension.update") {
      if (editor.kind !== "editingSketch") throw new Error("Missing private sketch owner.");
      const validTarget = command.operation === "sketch.dimension.add"
        ? command.points[0] !== command.points[1] && command.points.every(id => editor.session.definition.points.some(p => p.pointId === id))
        : editor.session.definition.dimensions.some(d => d.dimensionId === command.dimensionId);
      if (!validTarget || ("value" in command && (!Number.isFinite(command.value) || command.value <= 0)))
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
    let publicationReceipt:
      | import("@/domain/modeling/document-repository").DocumentRepositoryMutationResult
      | undefined;
    const cursorWrites: { event: Extract<EditorEvent, { type: "effect.documentCursorMoved" | "effect.documentCursorMoveFailed" }>; receipt: import("@/domain/modeling/document-repository").DocumentRepositoryMutationResult | undefined }[] = [];
    try {
      if (command.operation === "sketch.begin")
        events = await input.loop.dispatchAndSettle(command.commandId, {
          type: "sketch.beginRequested",
          target: {
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
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.geometryUpdated", edit });
      }
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
      if (command.operation === "sketch.dimension.add") {
        const { axis, points, mode } = command;
        const dimension = mode === "driving" ? { axis, points, mode, value: command.value } : { axis, points, mode };
        events = await input.loop.dispatchAndSettle(command.commandId, { type: "sketch.dimensionAuthored", input: dimension });
      }
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
          return { ...terminal, outcome: { kind: "conflicted", actualBasis: initial.state }, diagnostics: [...terminal.diagnostics, semanticDiagnostic(new Error(blocked.blockedReason))] };
      }
      if (geometryMutation && editor.kind === "editingSketch" && finalEditor.kind === "editingSketch" && finalEditor.session.definition === editor.session.definition && finalEditor.session.sketchLabel === editor.session.sketchLabel) {
        if (finalEditor.session.validationMessage) return { ...terminal, outcome: { kind: "rejected", reasonCode: "sketch-edit-refused" }, diagnostics: [semanticDiagnostic(new Error(finalEditor.session.validationMessage))] };
        return { ...terminal, outcome: priorGeometry.kind === "current" ? { kind: "completed", change: "unchanged" } : { kind: "failed", failures: ["geometry"] }, discovery: initial, completion: { ...terminal.completion, handoff: { kind: "current", state: initial.state }, geometry: priorGeometry } };
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
              revisionId: applied.document.revisionId,
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
      terminal.diagnostics = [
        ...terminal.diagnostics,
        ...inspected.diagnostics,
        ...(terminal.discovery.sketch?.validity.diagnostics ?? []).map((d) => ({
          ...d,
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
        for (const cursor of cursorWrites) {
          const next = cursor.receipt?.ok ? cursor.receipt : cursor.receipt?.appliedLive;
          if (!applied || cursor.event.baseRevisionId !== applied.document.revisionId || !next || cursor.event.type !== "effect.documentCursorMoved" || !cursor.event.accepted) cursorChainValid = false;
          if (next) applied = next;
        }
        const persistenceFailed = !receipt?.ok || cursorWrites.some(c => !c.receipt?.ok);
        if (
          applied &&
          (!committed?.accepted || !cursorChainValid ||
            state.revisionId !== applied.document.revisionId ||
            [...state.repositoryHeads].sort().join("\0") !==
              [...applied.metadata.heads].sort().join("\0"))
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
          const usable =
            !snapshot.document.diagnostics.some(d => d.severity === "error") &&
            sketch.derivedValidity.state === "current" &&
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
            sketchId: sketch.sketchId,
            solveStatus: sketch.solvedSnapshot.status,
            validity: sketch.derivedValidity,
            points: sketch.definition.points.map((p) => ({
              pointId: p.pointId,
              position: p.position,
              construction: p.isConstruction,
            })),
            entities: entityDiscovery(sketch.definition),
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
