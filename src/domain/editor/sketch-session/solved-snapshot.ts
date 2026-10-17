import type { SolvedSketchSnapshot } from "@/contracts/sketch/schema";
import type { SketchSessionState } from "./types";
import { SKETCH_NOT_SOLVED_YET } from "./internals";

const stableDisplayObjectIds = new WeakMap<object, number>();
let nextStableDisplayObjectId = 1;

/** Display, picking and snapping share the live solve; an opened draft is not certified. */
export function getSketchSessionDisplaySolvedSnapshot(
  session: SketchSessionState,
): SolvedSketchSnapshot {
  return session.liveSolve?.solvedSnapshot ?? SKETCH_NOT_SOLVED_YET;
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
