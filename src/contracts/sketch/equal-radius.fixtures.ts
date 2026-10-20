import {
  literalResolvedDefinition,
  makeSketchFixture,
} from "./region-extraction.fixtures";
import type { NumericSketchDefinition } from "./schema";

export function makeEqualCircleDefinition(): NumericSketchDefinition {
  const fixture = makeSketchFixture();
  for (const [index, radius] of [2, 3, 4].entries()) {
    fixture.point(`center${index}`, index * 30, 0);
    fixture.circle(`circle${index}`, `center${index}`, radius);
  }
  const constraints = [1, 2].map((index) => ({
    constraintId: `constraint_equal${index}` as const,
    kind: "equalLength" as const,
    label: `Equal circles ${index}`,
    entityIds: [
      "sketch_entity_circle0",
      `sketch_entity_circle${index}`,
    ] as const,
  }));
  const dimensions = [
    {
      dimensionId: "dimension_size" as const,
      kind: "diameter" as const,
      label: "Driving diameter",
      entityId: "sketch_entity_circle0" as const,
      value: 16,
    },
  ];
  return {
    ...literalResolvedDefinition(fixture.definition()),
    constraints,
    constraintIds: constraints.map((c) => c.constraintId),
    dimensions,
    dimensionIds: dimensions.map((d) => d.dimensionId),
  };
}
