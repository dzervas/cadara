import { expect, test } from "vitest";
import { createSessionCommitFactories } from "@/core/editor/sketch-session/tool-authoring";
import { createSketchOffsetDerivationContribution } from "@/core/sketch-editing/operations";
import {
  FIXTURE_SKETCH_ID,
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  chamferedRectangle,
  chamferCursor,
  dragSession,
  pid,
  preview,
  positionOf,
  TAU,
} from "./constrained-drag-branch.fixtures";
import { deriveDragBranchInvariants } from "./constrained-drag-stage";

// Logic lane: validity belongs to authored geometry; a derived output's
// rebuild/hold/fail domain must not become an extra seed-drag boundary.
test("an offset output below tolerance does not block seed motion, while an authored segment's length boundary does", () => {
  const fixture = makeSketchFixture();
  fixture.point("a", 0, 0);
  fixture.point("b", 2, 0);
  const corner = fixture.point("c", 2, 0.2);
  fixture.point("d", 0, 0.2);
  const seeds = [
    fixture.line("ab", "a", "b"),
    fixture.line("bc", "b", "c"),
    fixture.line("cd", "c", "d"),
    fixture.line("da", "d", "a"),
  ];
  const definition = fixture.definition();
  const offset = createSketchOffsetDerivationContribution({
    definition,
    entityIds: seeds,
    distance: 0.05,
    side: "left",
    sequence: 700,
    factories: createSessionCommitFactories(700, FIXTURE_SKETCH_ID),
    modelingTolerance: TAU,
    documentVariables: [],
  });
  if (!offset.valid || !offset.contribution)
    throw new Error(offset.message ?? "Offset fixture must build");
  const contribution = offset.contribution;
  const points = [...definition.points, ...contribution.points];
  const entities = [...definition.entities, ...contribution.entities];
  const session = dragSession(
    literalResolvedDefinition({
      ...definition,
      points,
      pointIds: points.map((point) => point.pointId),
      entities,
      entityIds: entities.map((entity) => entity.entityId),
      derivedRelationships: contribution.derivedRelationships,
    }),
  );
  const before = session.lastAcceptedSnapshot;
  const result = preview(session, corner, [2, 0.05]);
  expect(result.kind).toBe("solved");
  expect(positionOf(session.lastAcceptedSnapshot, corner)[1]).toBeLessThan(
    0.15,
  );
  expect(session.lastAcceptedSnapshot).not.toBe(before);
  expect(session.lastAcceptedSnapshot.offsetFramePlans ?? []).toHaveLength(0);

  const authored = dragSession(chamferedRectangle());
  const invariants = deriveDragBranchInvariants(
    authored.program,
    authored.program.system.scalarConstraints,
    authored.values,
  );
  // The same minimum-length validity, when authored, is still a boundary.
  const across = Float64Array.from(authored.values);
  const record = authored.program.system.pointRecords.get(pid("ca"))!;
  across[record.baseIndex] = 2;
  across[record.baseIndex + 1] = 0.3;
  expect(invariants.refuses(across)).toBe(true);
  expect(preview(authored, pid("ca"), chamferCursor(8)).kind).toBe("blocked");
});
