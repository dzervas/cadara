import { splineTangentStateKey } from "./parameter-projection";
import { cloneValues, length, subtract } from "./solver-geometry";
import type { SketchCompiledSolveProgram } from "./system-types";
import type { SolvedSketchSnapshot } from "@/contracts/sketch/schema";
import { orderedSplineOccurrences } from "@/contracts/sketch/spline-geometry";

export function seedSolveValuesFromSnapshot(
  program: SketchCompiledSolveProgram,
  solvedSnapshot: SolvedSketchSnapshot | null | undefined,
) {
  const values = cloneValues(program.system.initialValues);
  if (!solvedSnapshot) {
    return { values, warmStarted: false };
  }

  let seeded = false;
  for (const point of solvedSnapshot.solvedPoints) {
    const record = program.system.pointRecords.get(point.pointId);
    if (!record) {
      continue;
    }
    values[record.baseIndex] = point.solvedPosition[0];
    values[record.baseIndex + 1] = point.solvedPosition[1];
    seeded = true;
  }

  for (const entity of solvedSnapshot.solvedEntities) {
    const state = program.system.entityStates.get(entity.entityId);
    if (!state) {
      continue;
    }
    if (state.kind === "circle" && entity.kind === "circle") {
      values[state.baseIndex] = entity.solvedRadius;
      seeded = true;
    }
    if (state.kind === "arc" && entity.kind === "arc") {
      values[state.baseIndex] = length(
        subtract(entity.startPosition, entity.centerPosition),
      );
      values[state.baseIndex + 1] = Math.atan2(
        entity.startPosition[1] - entity.centerPosition[1],
        entity.startPosition[0] - entity.centerPosition[0],
      );
      values[state.baseIndex + 2] = Math.atan2(
        entity.endPosition[1] - entity.centerPosition[1],
        entity.endPosition[0] - entity.centerPosition[0],
      );
      seeded = true;
    }
    if (
      entity.kind === "spline" &&
      entity.reconstruction.validity === "valid"
    ) {
      const reconstruction = entity.reconstruction;
      const authored = program.definition.entities.find(
        (candidate) =>
          candidate.entityId === entity.entityId && candidate.kind === "spline",
      );
      if (authored?.kind === "spline") {
        (orderedSplineOccurrences(authored) ?? []).forEach(
          (occurrence, occurrenceIndex) => {
            if (occurrence.tangent.kind !== "authored") return;
            const tangentState = program.system.splineTangentStates.get(
              splineTangentStateKey(authored.entityId, occurrence.occurrenceId),
            );
            const handle = reconstruction.handles[occurrenceIndex];
            if (!tangentState || !handle) return;
            values[tangentState.baseIndex] = handle[0];
            values[tangentState.baseIndex + 1] = handle[1];
            seeded = true;
          },
        );
      }
    }
  }

  return { values, warmStarted: seeded };
}
