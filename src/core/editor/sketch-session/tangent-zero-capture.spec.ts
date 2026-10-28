import { describe, expect, test } from "vitest";

import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import {
  beginSketchGeometryDrag,
  createSketchSessionFromSnapshot,
  finishSketchGeometryDrag,
  updateSketchGeometryDrag,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";

// Lane: logic (docs/testing.md). Seam: the sketch session's tangent-handle
// drag (`beginSketchGeometryDrag` → `updateSketchGeometryDrag` →
// `finishSketchGeometryDrag`) with the viewport's exact-zero capture (T12d
// D4; issue 14 "shrink an authored handle to exactly zero"), in a sketch
// whose drags solve (T17i: as in the E2E-2 mixed outline, the spline is joined
// to other geometry by a coincidence). The unconstrained fast path is pinned
// by `sketch-geometry-editing.spec.ts` (R-1 row 6).

const pid = (name: string) => `sketch_point_${name}` as SketchPointId;
const eid = (name: string) => `sketch_entity_${name}` as SketchEntityId;

/** A line a→b and a spline c→f1→f2→a2 joined to it by a coincidence (a2 on a). */
function joinedSpline(): SketchSessionState {
  const f = makeSketchFixture();
  f.point("a", -10, -4);
  f.point("b", -2, -3);
  f.point("c", -4, 3.8);
  f.point("f1", -7, 4.5);
  f.point("f2", -10.8, 1.2);
  f.point("a2", -10, -4);
  f.line("ab", "a", "b");
  f.spline("s", ["c", "f1", "f2", "a2"], "open");
  f.coincident("a2", "a");
  return enterSketchSession(
    createSketchSessionFromSnapshot(
      sketchSnapshotRecordForTest(
        f.build(),
        [],
        createStandardPlaneDefinition("xy"),
      ),
      OCC_KERNEL_SETTINGS,
    ),
  );
}

const occurrence = (session: SketchSessionState, index: number) => {
  const spline = session.definition.entities.find(
    (entity) => entity.entityId === eid("s"),
  );
  if (spline?.kind !== "spline") throw new Error("No spline.");
  return spline.pointOccurrences[index]!;
};

const position = (session: SketchSessionState, name: string) =>
  session.definition.points.find((point) => point.pointId === pid(name))!
    .position;

describe("T17i: exact-zero capture of a tangent handle in a solved sketch", () => {
  test("a run of capture frames, then the release: the end handle stores exactly [0, 0]", () => {
    const session = joinedSpline();
    expect(session.liveSolve?.accepted, "premise: a solved sketch").toBe(true);
    const fit = position(session, "c");
    const start = occurrence(session, 0);
    const handle = {
      kind: "tangentHandle" as const,
      entityId: eid("s"),
      occurrenceId: start.occurrenceId,
      pointId: pid("c"),
    };
    const spline = session.definition.entities.find(
      (entity) => entity.entityId === eid("s"),
    )!;
    // Grab at the automatic handle's tip (any point works for the intent).
    let dragged = beginSketchGeometryDrag(
      session,
      spline.target,
      [fit[0] - 1, fit[1] + 0.3],
      handle,
    );
    expect(dragged.activeDrag, "premise: the handle drag started").not.toBe(
      null,
    );
    dragged = updateSketchGeometryDrag(dragged, [fit[0] - 0.5, fit[1] + 0.1]);
    // The viewport sends exact-zero on every frame inside the capture radius
    // (here two) and on the release.
    dragged = updateSketchGeometryDrag(
      dragged,
      [fit[0] - 0.05, fit[1] + 0.01],
      { exactZero: true },
    );
    dragged = updateSketchGeometryDrag(dragged, fit, { exactZero: true });
    const zeroed = finishSketchGeometryDrag(dragged, fit, { exactZero: true });
    expect(occurrence(zeroed, 0).tangent).toEqual({
      kind: "authored",
      vector: [0, 0],
    });
    expect(zeroed.activeDrag, "the drag is finished").toBe(null);
    // The control: leaving the capture radius authors a non-zero vector.
    const out = finishSketchGeometryDrag(
      updateSketchGeometryDrag(
        beginSketchGeometryDrag(zeroed, spline.target, fit, handle),
        [fit[0] - 0.02, fit[1] + 0.01],
        { exactZero: true },
      ),
      [fit[0] - 0.8, fit[1] - 0.6],
    );
    const vector = occurrence(out, 0).tangent;
    expect(vector.kind).toBe("authored");
    if (vector.kind === "authored")
      expect(Math.hypot(...vector.vector)).toBeGreaterThan(0.5);
  });
});
