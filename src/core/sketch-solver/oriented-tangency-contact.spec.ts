import { expect, test } from "vitest";
import { solveSketchDefinitionCore } from "./solve-sketch";
import {
  FIXTURE_SKETCH_ID,
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { createSessionCommitFactories } from "@/core/editor/sketch-session/tool-authoring";
import { createSketchOffsetDerivationContribution } from "@/core/sketch-editing/operations";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { SketchDefinition } from "@/contracts/sketch/schema";

// Logic lane: a line tangent to a point-defined arc (an offset seed) whose
// contact is joined to the line end by a coincident constraint, not a shared
// point. Its tangency row reads the radius at the contact against the line
// direction, which alone does not place the contact on the line; the
// tangency must still read unsatisfied when the contact is off the line.

const pid = (name: string) => `sketch_point_${name}` as SketchPointId;
const eid = (name: string) => `sketch_entity_${name}` as SketchEntityId;

/**
 * Line (−3, 1) → (0, 1); clockwise arc about the origin from (0, 1 + gap):
 * its radius at the contact is normal to the line for every gap. `fixed`
 * pins both line ends and the contact, so the coincident cannot hold while
 * the free centre can still put the radius at the contact normal to the line.
 */
function coincidentJoinedTangency(input: { gap: number; fixed: boolean }) {
  const { gap } = input;
  const sketch = makeSketchFixture();
  for (const [name, x, y] of [
    ["l0", -3, 1],
    ["l1", 0, 1],
    ["ac", 0, 0],
    ["as", 0, 1 + gap],
    ["ae", 1 + gap, 0],
  ] as const)
    sketch.point(name, x, y);
  sketch.line("line", "l0", "l1");
  sketch.arc("arc", "ac", "as", "ae", "clockwise");
  const definition = sketch.definition();
  const offset = createSketchOffsetDerivationContribution({
    definition,
    entityIds: [eid("arc")],
    distance: 0.2,
    side: "right",
    sequence: 900,
    factories: createSessionCommitFactories(900, FIXTURE_SKETCH_ID),
    modelingTolerance: 1e-3,
    documentVariables: [],
  });
  if (!offset.valid || !offset.contribution)
    throw new Error(`offset: ${offset.message}`);
  const { contribution } = offset;
  const points = [...definition.points, ...contribution.points];
  const entities = [...definition.entities, ...contribution.entities];
  const fixes = !input.fixed
    ? []
    : (["l0", "l1", "as"] as const).map((name) => ({
        constraintId: `constraint_fix_${name}`,
        kind: "fixPoint",
        label: `fix ${name}`,
        pointId: pid(name),
        position: definition.points.find(
          (point) => point.pointId === pid(name),
        )!.position,
      }));
  const constraints = [
    {
      constraintId: "constraint_join",
      kind: "coincident",
      label: "join",
      pointIds: [pid("l1"), pid("as")],
    },
    {
      constraintId: "constraint_tangent",
      kind: "tangent",
      label: "tangent",
      entityIds: [eid("line"), eid("arc")],
      relation: "external",
    },
    ...fixes,
  ];
  const result = solveSketchDefinitionCore({
    definition: literalResolvedDefinition({
      ...definition,
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: constraints.map((entry) => entry.constraintId),
      constraints,
      derivedRelationships: contribution.derivedRelationships,
    } as unknown as SketchDefinition),
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort",
  });
  const status = (constraintId: string) =>
    result.solvedSnapshot.constraintStatuses.find(
      (entry) => entry.constraintId === constraintId,
    )?.status;
  return { result, status };
}

test("a coincident-joined contact held off the line leaves the tangency unsatisfied, not only the coincident", () => {
  const { result, status } = coincidentJoinedTangency({
    gap: 0.05,
    fixed: true,
  });
  expect(result.status.solveState).toBe("partiallySolved");
  expect({
    join: status("constraint_join"),
    tangent: status("constraint_tangent"),
  }).toEqual({ join: "unsatisfied", tangent: "unsatisfied" });
});

test("a coincident-joined contact that can reach the line solves with the tangency satisfied", () => {
  const { result, status } = coincidentJoinedTangency({
    gap: 0.05,
    fixed: false,
  });
  // The extra row is redundant with the coincident here; it must not change
  // how constrained the sketch reads (the free centre and arc end leave it
  // under-constrained, as before the row existed).
  expect(result.status).toEqual({
    solveState: "solved",
    constraintState: "underConstrained",
  });
  expect({
    join: status("constraint_join"),
    tangent: status("constraint_tangent"),
  }).toEqual({ join: "satisfied", tangent: "satisfied" });
});
