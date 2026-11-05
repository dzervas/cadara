import { expect, test } from "vitest";
import { createSessionCommitFactories } from "@/core/editor/sketch-session/tool-authoring";
import { createSketchOffsetDerivationContribution } from "@/core/sketch-editing/operations";
import {
  FIXTURE_SKETCH_ID,
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  dragSession,
  positionOf,
  preview,
  release,
} from "./constrained-drag-branch.fixtures";

// Logic lane: the study's spline-offset cusp gesture at the compiled-session
// seam. Offset validity remains a derivation domain, not an entity-specific
// inequality in the minimum-motion step.
test("spline-offset cusp: fixed ends stay fixed and the offset domain remains truthful through an out-and-back drag", () => {
  const fixture = makeSketchFixture();
  const a = fixture.point("a", 0, 0);
  const middle = fixture.point("middle", 1, 1);
  const b = fixture.point("b", 2, 0);
  const spline = fixture.spline("seed", ["a", "middle", "b"], "open");
  const line = fixture.line("closing", "b", "a");
  const definition = fixture.definition();
  const offset = createSketchOffsetDerivationContribution({
    definition,
    entityIds: [spline, line],
    distance: 0.2,
    side: "right",
    sequence: 700,
    factories: createSessionCommitFactories(700, FIXTURE_SKETCH_ID),
    modelingTolerance: 1e-3,
    documentVariables: [],
  });
  if (!offset.valid || !offset.contribution)
    throw new Error(offset.message ?? "Offset fixture must build");
  const contribution = offset.contribution;
  const points = [...definition.points, ...contribution.points];
  const entities = [...definition.entities, ...contribution.entities];
  const fixes = [a, b].map((pointId, index) => ({
    constraintId: `constraint_fix_${index}` as const,
    kind: "fixPoint" as const,
    label: `Fixed end ${index}`,
    pointId,
    position: definition.points.find((point) => point.pointId === pointId)!
      .position,
  }));
  const session = dragSession(
    literalResolvedDefinition({
      ...definition,
      points,
      pointIds: points.map((point) => point.pointId),
      entities,
      entityIds: entities.map((entity) => entity.entityId),
      constraints: [...definition.constraints, ...fixes],
      constraintIds: [
        ...definition.constraintIds,
        ...fixes.map((fix) => fix.constraintId),
      ],
      derivedRelationships: [
        ...(definition.derivedRelationships ?? []),
        ...(contribution.derivedRelationships ?? []),
      ],
    }),
  );
  let moves = 0;
  let crossedOffsetDomain = false;
  for (const step of [
    ...Array.from({ length: 16 }, (_, i) => i + 1),
    ...Array.from({ length: 16 }, (_, i) => 15 - i),
  ]) {
    const before = session.lastAcceptedSnapshot;
    const result = preview(session, middle, [1, 1 + (2.4 * step) / 16]);
    if (result.kind === "blocked")
      expect(session.lastAcceptedSnapshot).toBe(before);
    else moves += 1;
    expect(positionOf(session.lastAcceptedSnapshot, a)).toEqual([0, 0]);
    expect(positionOf(session.lastAcceptedSnapshot, b)).toEqual([2, 0]);
    expect(
      session.lastAcceptedSnapshot.constraintStatuses.every(
        (status) => status.status === "satisfied",
      ),
    ).toBe(true);
    const snapshot = session.lastAcceptedSnapshot;
    const certified = snapshot.offsetFramePlans?.some(
      (plan) =>
        plan.derivationId ===
        contribution.derivedRelationships![0]!.derivationId,
    );
    if (!certified) {
      crossedOffsetDomain = true;
      const evaluation =
        session.program.system.parameterProjection.derivationEvaluation(
          session.values,
        );
      expect(
        evaluation?.offsetFailures.map((failure) => failure.derivationId),
      ).toContain(contribution.derivedRelationships![0]!.derivationId);
    }
  }
  expect(moves).toBeGreaterThan(0);
  expect(
    crossedOffsetDomain,
    "the peak crosses the inward offset's cusp domain",
  ).toBe(true);
  release(session, middle, [1, 1]);
  expect(positionOf(session.lastAcceptedSnapshot, middle)[1]).toBeCloseTo(1, 3);
  expect(session.lastAcceptedSnapshot.offsetFramePlans).toHaveLength(1);
});
