import { expect, test } from "vitest";
import { createStandardPlaneDefinition, OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import { acceptSketchDraw, beginSketchTool, createNewSketchSession, finalizeSketchDraw, startSketchDraw, updateSketchPointer } from "@/domain/editor/sketch-session";
import { reconcileSketchToolDraft } from "./tool-placement";
import { withSketchSnapScale, SPEC_SKETCH_UNITS_PER_PIXEL } from "./test-snap-scale";
import type { SketchPoint } from "@/contracts/modeling/schema";

function source(kind: "line" | "threePointArc" | "spline") {
  let session = enterSketchSession(createNewSketchSession(createStandardPlaneDefinition("xy"), OCC_KERNEL_SETTINGS));
  session = beginSketchTool(session, kind);
  const points: SketchPoint[] = kind === "line" ? [[10, 10], [20, 10]] : [[10, 10], [15, 15], [20, 10]];
  session = startSketchDraw(session, points[0]!);
  for (const point of points.slice(1)) session = acceptSketchDraw(session, point);
  if (kind === "spline") session = finalizeSketchDraw(session);
  return withSketchSnapScale(session, SPEC_SKETCH_UNITS_PER_PIXEL);
}

for (const kind of ["line", "threePointArc", "spline"] as const) {
  for (const atStart of [false, true]) {
  test(`O25: ${kind} ${atStart ? "start" : "end"} endpoint determines the preview and commits on the second click`, () => {
    const base = source(kind);
    const sourceEntity = base.definition.entities[0]!;
    const startPoint: SketchPoint = atStart ? [10, 10] : [20, 10];
    const endPoint: SketchPoint = atStart ? [2, 17] : [28, 17];
    let draft = startSketchDraw(beginSketchTool(base, "tangentArc"), startPoint);
    expect(draft.status).toBe("drawing");
    draft = updateSketchPointer(draft, endPoint);
    expect(draft.toolStagedEntities[0]?.kind).toBe("polyline");
    expect(draft.toolPresentation?.prompts[0]?.text).toBe("Place arc end");
    const after = acceptSketchDraw(draft, endPoint);
    expect(after.status).toBe("idle");
    expect(after.definition.entities).toHaveLength(base.definition.entities.length + 1);
    const arc = after.definition.entities.at(-1)!;
    expect(arc.kind).toBe("arc");
    expect(after.definition.constraints).toContainEqual(expect.objectContaining({ kind: "tangent", entityIds: [arc.entityId, sourceEntity.entityId] }));
    if (arc.kind !== "arc") throw new Error("Missing arc");
    const at = (id: string) => after.definition.points.find(p => p.pointId === id)!.position;
    const center = at(arc.centerPointId), start = at(arc.startPointId);
    // The tangent is perpendicular to the new arc radius at the join.
    // Source line: horizontal. Source arc/spline: descending at this end.
    if (kind === "line") expect(center[0]).toBeCloseTo(start[0], 8);
    else if (kind === "threePointArc") expect(center[1]).toBeCloseTo(start[1], 8);
    else expect((center[0] - start[0]) + (atStart ? 1 : -1) * (center[1] - start[1])).toBeCloseTo(0, 8);
    expect(after.liveSolve?.accepted).toBe(true);
    expect(after.toolPlacedPoints).toEqual([]);
  });
  }
}

test("O25: empty space and line interiors refuse the first click", () => {
  const base = source("line");
  for (const point of [[30, 30], [15, 10]] as const) {
    const refused = startSketchDraw(beginSketchTool(base, "tangentArc"), point);
    expect(refused.status).toBe("idle");
    expect(refused.toolPlacedPoints).toEqual([]);
    expect(refused.validationMessage).toBeNull();
    expect(refused.toolPresentation?.validation?.[0]?.message).toMatch(/curve end/i);
    expect(refused.definition).toEqual(base.definition);
  }
});

test("O25: bending back beside the source arc authors internal, not external tangency", () => {
  const base = source("threePointArc");
  const draft = startSketchDraw(beginSketchTool(base, "tangentArc"), [20, 10]);
  const after = acceptSketchDraw(draft, [12, 17]);
  expect(after.definition.constraints).toContainEqual(expect.objectContaining({ kind: "tangent", relation: "internal" }));
  expect(after.liveSolve?.accepted).toBe(true);
});

test("O25: a restored draft cannot keep a removed source's tangent", () => {
  const base = source("line");
  const draft = startSketchDraw(beginSketchTool(base, "tangentArc"), [20, 10]);
  const after = reconcileSketchToolDraft({ ...draft, definition: { ...base.definition, entities: [], points: [], constraints: [], dimensions: [] }, liveSolve: null });
  expect(after.status).toBe("idle");
  expect(after.toolPlacedPoints).toEqual([]);
  expect(after.toolTangentSourceEntityId).toBeNull();
  expect(after.toolPresentation?.validation?.[0]?.message).toMatch(/curve end/i);
});
