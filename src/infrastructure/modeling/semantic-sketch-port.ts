import type {
  SemanticSketchCommand,
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
      sketch: {
        sketchId: s.sketchId,
        plane: s.plane.key!,
        solveStatus: s.liveSolve!.solvedSnapshot.status,
        validity: getSketchSessionDerivedValidity(s),
        points: s.definition.points.map((p) => ({
          pointId: p.pointId,
          position: p.position,
          construction: p.isConstruction,
        })),
        entities: s.definition.entities.flatMap<
          NonNullable<SemanticDiscovery["sketch"]>["entities"][number]
        >((e) =>
          e.kind === "point"
            ? [
                {
                  entityId: e.entityId,
                  kind: e.kind,
                  pointIds: [e.pointId],
                  construction: e.isConstruction,
                },
              ]
            : e.kind === "lineSegment"
              ? [
                  {
                    entityId: e.entityId,
                    kind: e.kind,
                    pointIds: [e.startPointId, e.endPointId],
                    construction: e.isConstruction,
                  },
                ]
              : [],
        ),
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
    command: SemanticSketchCommand,
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
      command.operation === "sketch.begin"
        ? editor.kind !== "idle"
        : editor.kind !== "editingSketch"
    )
      return {
        ...terminal,
        outcome: { kind: "rejected" as const, reasonCode: "editing-context" },
      };
    if (
      command.operation !== "sketch.begin" &&
      (initial.state.draft?.commandSessionId !==
        command.draft.commandSessionId ||
        initial.state.draft.generation !== command.draft.generation)
    )
      return {
        ...terminal,
        outcome: { kind: "conflicted" as const, actualBasis: initial.state },
      };
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
    const priorGeometry = geometry(initial.state);
    let events: readonly EditorEvent[] = [];
    let publicationReceipt:
      | import("@/domain/modeling/document-repository").DocumentRepositoryMutationResult
      | undefined;
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
      if (command.operation === "sketch.author")
        events = await input.loop.dispatchAndSettle(command.commandId, {
          type: "sketch.primitiveAuthored",
          primitive: command.primitive,
          construction: command.construction,
        });
      if (command.operation === "sketch.publish")
        events = await input.loop.dispatchAndSettle(command.commandId, {
          type: "sketch.publishRequested",
        });
      if (command.operation === "sketch.discard")
        events = await input.loop.dispatchAndSettle(command.commandId, {
          type: "sketch.discardRequested",
        });
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
        command.operation === "sketch.inspect"
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
          } else
            terminal.completion.live = { kind: "unchanged", state: ownedState };
        }
      }
      const inspected = await input.inspect({
        commandId: `${command.commandId}:after`,
      });
      terminal.discovery = discovery(inspected.discovery);
      const state = terminal.discovery.state;
      terminal.completion.live =
        command.operation === "sketch.inspect"
          ? { kind: "unchanged", state }
          : { kind: "applied", state };
      terminal.completion.handoff = { kind: "current", state };
      terminal.completion.geometry = geometry(state);
      terminal.diagnostics = [
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
                command.operation === "sketch.inspect"
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
        const applied = receipt?.ok ? receipt : receipt?.appliedLive;
        if (
          applied &&
          (!committed?.accepted ||
            state.revisionId !== applied.document.revisionId ||
            [...state.repositoryHeads].sort().join("\0") !==
              [...applied.metadata.heads].sort().join("\0"))
        ) {
          const actualState = {
            ...state,
            revisionId: applied.document.revisionId,
            repositoryHeads: [...applied.metadata.heads],
          };
          terminal.completion.live = { kind: "applied", state: actualState };
          terminal.completion.persistence = {
            kind: receipt!.ok ? "committed" : "failed",
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
              ...(!receipt!.ok ? ["persistence" as const] : []),
            ],
          };
          terminal.diagnostics = [
            ...terminal.diagnostics,
            semanticDiagnostic(
              new Error(
                commitFailure?.message ??
                  "Publication snapshot does not match the exact accepted transaction.",
              ),
            ),
          ];
          return terminal;
        }
        if (committed?.accepted && applied) {
          terminal.completion.persistence = {
            kind: receipt!.ok ? "committed" : "failed",
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
            sketchId: sketch.sketchId,
            solveStatus: sketch.solvedSnapshot.status,
            validity: sketch.derivedValidity,
            points: sketch.definition.points.map((p) => ({
              pointId: p.pointId,
              position: p.position,
              construction: p.isConstruction,
            })),
            entities: sketch.definition.entities.flatMap<
              NonNullable<SemanticDiscovery["sketch"]>["entities"][number]
            >((e) =>
              e.kind === "point"
                ? [
                    {
                      entityId: e.entityId,
                      kind: e.kind,
                      pointIds: [e.pointId],
                      construction: e.isConstruction,
                    },
                  ]
                : e.kind === "lineSegment"
                  ? [
                      {
                        entityId: e.entityId,
                        kind: e.kind,
                        pointIds: [e.startPointId, e.endPointId],
                        construction: e.isConstruction,
                      },
                    ]
                  : [],
            ),
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
            ...(!receipt!.ok ? ["persistence" as const] : []),
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
          terminal.diagnostics = [
            ...terminal.diagnostics,
            ...committed.diagnostics,
          ];
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
          terminal.outcome = { kind: "failed", failures: ["execution"] };
          terminal.diagnostics = [
            ...terminal.diagnostics,
            ...(committed?.diagnostics ?? []),
          ];
        }
      }
      if (
        terminal.completion.geometry.kind === "invalid-editable" &&
        command.operation === "sketch.author" &&
        command.intent === "author-invalid"
      )
        terminal.outcome = { kind: "accepted-invalid" };
      if (
        command.operation === "sketch.inspect" &&
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
