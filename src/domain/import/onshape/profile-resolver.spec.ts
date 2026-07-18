import { expect, test } from "vitest";

import {
  referencedSketchFeatureIdsFromProfileParameter,
  resolveOnshapeSketchProfiles,
} from "@/domain/import/onshape/profile-resolver";

const profileParameter = (sketchFeatureId: string) => ({
  parameterId: "entities",
  queries: [
    {
      queryString: `query = qSketchRegion(id + "${sketchFeatureId}", true);`,
    },
  ],
});

function resolveProfile(entities: {
  entityId: string;
  entityType: "circle" | "lineSegment";
  center3d?: [number, number, number];
  radius?: number;
  start3d?: [number, number, number];
  end3d?: [number, number, number];
}[]) {
  return resolveOnshapeSketchProfiles({
    profileParameter: profileParameter("S1"),
    featureLabel: "Profile consumer",
    featureKind: "revolve",
    solvedSketch: {
      featureId: "S1",
      entities: entities.map((entity) => ({
        ...entity,
        onshapeEntityType: entity.entityType === "circle" ? "skCircle" : "skLineSegment",
        isConstruction: false,
      })),
    },
    referencedSketch: { tier: "parametric", planeKey: "xy" },
  });
}

test("profile resolver returns verified deferred profiles for a closed translated sketch region", () => {
  const result = resolveProfile([
    { entityId: "circle", entityType: "circle", center3d: [0, 0, 0], radius: 0.005 },
  ]);

  expect(result).toMatchObject({
    tier: "resolved",
    sketchFeatureId: "S1",
    profiles: [{ interiorPoint: [0, 0] }],
    diagnostics: [],
  });
});

test("profile resolver derives selectors in the referenced sketch frame", () => {
  const result = resolveOnshapeSketchProfiles({
    profileParameter: profileParameter("S1"),
    featureLabel: "Captured-frame extrude",
    featureKind: "extrude",
    solvedSketch: {
      featureId: "S1",
      entities: [{
        entityId: "circle",
        entityType: "circle",
        onshapeEntityType: "skCircle",
        isConstruction: false,
        center3d: [0.004, 0, 0],
        radius: 0.002,
      }],
    },
    referencedSketch: {
      tier: "parametric",
      planeKey: "xy",
      planeFrame: {
        origin: [4, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
        linearUnit: "documentLength",
        handedness: "rightHanded",
      },
    },
  });

  expect(result).toMatchObject({
    tier: "resolved",
    profiles: [{ interiorPoint: [0, 0] }],
  });
});

test("profile resolver degrades an open translated sketch with needs-region-resolution", () => {
  const result = resolveProfile([
    {
      entityId: "line",
      entityType: "lineSegment",
      start3d: [0, 0, 0],
      end3d: [0.01, 0, 0],
    },
  ]);

  expect(result).toEqual({
    tier: "unresolved",
    reason: "needs-region-resolution",
    diagnostics: [],
  });
});

test("profile resolver requires exactly one sketch profile query", () => {
  expect(
    referencedSketchFeatureIdsFromProfileParameter({
      queries: [
        { queryString: 'qSketchRegion(id + "S1", true)' },
        { queryString: 'qCreatedBy(makeId("S2"), EntityType.FACE)' },
      ],
    }),
  ).toEqual(["S1", "S2"]);
});
