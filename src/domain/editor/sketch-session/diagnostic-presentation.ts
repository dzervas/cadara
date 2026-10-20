import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchSessionState } from "./types";

/** Presentation of the session-owned diagnostic; tool refusals retain their own source. */
export function getSketchSessionDiagnosticPresentation(
  session: SketchSessionState,
): {
  message: string;
  severity: "warning" | "error";
  target: PrimitiveRef | null;
} | null {
  const message = session.validationMessage;
  if (!message) return null;
  const diagnostic = [
    ...session.liveRegions.diagnostics,
    ...(session.liveSolve?.solvedSnapshot.diagnostics ?? []),
  ].find((entry) => message.startsWith(entry.message));
  const target = diagnostic?.target;
  const entity =
    target?.kind === "entity"
      ? session.definition.entities.find(
          (entry) => entry.entityId === target.entityId,
        )
      : undefined;
  const linkedTarget =
    entity?.target ??
    (target?.kind === "point"
      ? session.definition.points.find(
          (entry) => entry.pointId === target.pointId,
        )?.target
      : undefined);
  const selfIntersection = diagnostic?.message.startsWith(
    "The self-intersection query of ",
  );
  const regionWithheld = diagnostic?.code.startsWith("region-");
  const near = entity ? ` near ‘${entity.label}’` : "";
  return {
    message: selfIntersection
      ? `Cannot resolve self-intersections${near}. No region is formed.`
      : regionWithheld
        ? `${diagnostic?.code === "region-join-uncertain" ? "The join" : "The geometry"}${near} cannot form a region.`
        : message,
    severity:
      selfIntersection || !regionWithheld || diagnostic?.severity === "error"
        ? "error"
        : "warning",
    target: linkedTarget ?? null,
  };
}
