import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import type { SketchSessionState } from "./types";
import {
  getSketchSessionSolvedSnapshot,
  getSketchSessionDisplayDefinition,
  getSketchSessionDisplayProjectedReferences,
  resolveSketchDefinitionForSolve,
  getSketchSessionDerivationSettings,
} from "./internals";
const stableDisplayObjectIds = new WeakMap<object, number>();
let nextStableDisplayObjectId = 1;
let displaySolveCacheKey: string | null = null;
let displaySolveCacheSnapshot: SolvedSketchSnapshot | null = null;

/**
 * The solved snapshot the session displays: the live solve, else a
 * best-effort solve of the display definition, cached on the stable display
 * key. Every editor sketch entry establishes the live solve (T11a), so the
 * fallback serves only sessions never entered for editing (domain fixtures
 * built from the session constructors). Display, pick and snap read
 * the shells' spans from this one snapshot (T08b-g5b).
 */
export function getSketchSessionDisplaySolvedSnapshot(
  session: SketchSessionState,
  displayDefinition?: SketchDefinition,
  displayProjectedReferences?: readonly ProjectedSketchReferenceRecord[],
): SolvedSketchSnapshot {
  const live = getSketchSessionSolvedSnapshot(session);
  if (live) return live;
  const key = getStableSketchSessionDisplayKey(session);
  if (displaySolveCacheKey === key && displaySolveCacheSnapshot)
    return displaySolveCacheSnapshot;
  // Derived lazily: callers without a display definition (snap, on every
  // pointer move) skip the derivation when a live solve exists.
  displayDefinition ??= getSketchSessionDisplayDefinition(session);
  displayProjectedReferences ??= getSketchSessionDisplayProjectedReferences(
    session,
    displayDefinition,
  );
  const snapshot = solveSketchDefinitionCore({
    definition: resolveSketchDefinitionForSolve(
      displayDefinition,
      session.documentVariables,
    ),
    projectedReferences: displayProjectedReferences,
    tolerances: session.solverTolerances,
    ...getSketchSessionDerivationSettings(session),
    partialSolvePolicy: "bestEffort",
  }).solvedSnapshot;
  displaySolveCacheKey = key;
  displaySolveCacheSnapshot = snapshot;
  return snapshot;
}

export function getStableSketchSessionDisplayKey(
  session: SketchSessionState,
): string {
  return [
    "sketch",
    session.sketchId ?? "draft",
    objectIdentity(session.plane),
    objectIdentity(session.definition),
    objectIdentity(session.projectedReferences),
    objectIdentity(session.projectionDiagnostics),
    objectIdentity(session.liveRegions),
    session.liveSolve ? objectIdentity(session.liveSolve) : "no-live-solve",
    session.activeSpecialMode
      ? [
          session.activeSpecialMode.modeId,
          objectIdentity(session.activeSpecialMode.operationTarget),
          unknownIdentity(session.activeSpecialMode.state),
          session.activeSpecialMode.generation,
        ].join(":")
      : "no-special-mode",
  ].join("|");
}

function unknownIdentity(value: unknown): string {
  return value !== null && typeof value === "object"
    ? String(objectIdentity(value))
    : String(value);
}

function objectIdentity(value: object): number {
  const existing = stableDisplayObjectIds.get(value);
  if (existing !== undefined) {
    return existing;
  }

  const nextId = nextStableDisplayObjectId;
  nextStableDisplayObjectId += 1;
  stableDisplayObjectIds.set(value, nextId);
  return nextId;
}
