import { test, expect } from "vitest";

import type {
  ExtrudeFeatureExtent,
  FeatureBooleanScope,
  FeatureDefinition,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type {
  BodyId,
  FaceId,
  FeatureId,
  RegionId,
  SketchEntityId,
  SketchId,
} from "@/contracts/shared/ids";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import type { OccAuthoringFeatureRecord } from "@/domain/modeling/occ/authoring-state";
import { createFeatureRebuildFailureDiagnostic } from "@/domain/modeling/opencascade-kernel-adapter";
import { tagRebuildSlot } from "@/domain/modeling/occ/features/shared";

// Lane: logic (docs/testing.md — src/domain/ non-UI behavioral coverage).
// Seam: the kernel-adapter rebuild-failure attribution function
// `createFeatureRebuildFailureDiagnostic`, which maps a slot-tagged throw plus
// the extrude definition to the authored field that actually failed. Logic lane
// is correct because this is pure input/output attribution at a domain module
// boundary; the seam is the attribution function itself, so slot-tagged errors
// are constructed directly rather than driving the real OCC kernel.

const profileRegion = {
  kind: "region" as const,
  sketchId: "sketch_a" as SketchId,
  regionId: "region_a" as RegionId,
};

const faceTarget = {
  kind: "face" as const,
  bodyId: "body_face" as BodyId,
  faceId: "face_stop" as FaceId,
};

const scopeBody = {
  kind: "body" as const,
  bodyId: "body_scope" as BodyId,
};

function makeExtrudeFeature(overrides: {
  extent: ExtrudeFeatureExtent;
  booleanScope: FeatureBooleanScope;
}): OccAuthoringFeatureRecord {
  const definition: FeatureDefinition = {
    kind: "extrude",
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      resultBodyType: "solid",
      profiles: [profileRegion],
      startExtent: { kind: "profilePlane" },
      extent: overrides.extent,
      operation: "join",
      booleanScope: overrides.booleanScope,
    },
  };

  return {
    featureId: "feature_extrude" as FeatureId,
    label: "Extrude",
    definition,
    suppressed: false,
  };
}

const upToFaceExtent: ExtrudeFeatureExtent = {
  mode: "oneSide",
  end: {
    kind: "upToFace",
    direction: "positive",
    target: faceTarget,
  },
};

const blindExtent: ExtrudeFeatureExtent = {
  mode: "oneSide",
  end: { kind: "blind", direction: "positive", distance: 4 },
};

const affectedTargets = [profileRegion, faceTarget, scopeBody];

test("extent-slot failure attributes to the end condition target", () => {
  const feature = makeExtrudeFeature({
    extent: upToFaceExtent,
    booleanScope: { kind: "targetBody", bodyId: scopeBody.bodyId },
  });
  const error = tagRebuildSlot(
    new Error("advanced-feature-unsupported-kernel-case: no terminating face."),
    "extent",
  );

  const diagnostic = createFeatureRebuildFailureDiagnostic(
    feature,
    error,
    affectedTargets,
  );

  expect(
    diagnostic.fieldId,
    "Extent-resolution failures should map to the extent field.",
  ).toBe("extent");
  expect(
    diagnostic.target,
    "Extent failures should point at the end-condition target, not the profile.",
  ).toEqual(faceTarget);
  expect(
    diagnostic.message,
    "Extent failures should read as an end-condition problem.",
  ).toBe("Extrude end condition target is incorrect.");
  expect(
    diagnostic.detail?.kind === "rebuildFailure" &&
      diagnostic.detail.affectedTargets.length === affectedTargets.length,
    "The structured rebuildFailure detail must be preserved.",
  ).toBeTruthy();
});

test("scope-slot failure attributes to the boolean target body", () => {
  const feature = makeExtrudeFeature({
    extent: blindExtent,
    booleanScope: { kind: "targetBody", bodyId: scopeBody.bodyId },
  });
  const error = tagRebuildSlot(new Error("OCC boolean join failed to build."), "scope");

  const diagnostic = createFeatureRebuildFailureDiagnostic(
    feature,
    error,
    affectedTargets,
  );

  expect(
    diagnostic.fieldId,
    "Boolean-scope failures should map to the booleanScope field.",
  ).toBe("booleanScope");
  expect(
    diagnostic.target,
    "Scope failures should point at the target body.",
  ).toEqual(scopeBody);
  expect(
    diagnostic.message,
    "Scope failures should read as a boolean-target problem.",
  ).toBe("Extrude boolean target is incorrect.");
});

test("profile-slot failure attributes to the profile selection", () => {
  const feature = makeExtrudeFeature({
    extent: blindExtent,
    booleanScope: { kind: "targetBody", bodyId: scopeBody.bodyId },
  });
  const error = tagRebuildSlot(
    new Error("Sketch region region_a does not resolve on sketch sketch_a."),
    "profile",
  );

  const diagnostic = createFeatureRebuildFailureDiagnostic(
    feature,
    error,
    affectedTargets,
  );

  expect(
    diagnostic.fieldId,
    "Profile-rooted failures should map to the profiles field.",
  ).toBe("profiles");
  expect(
    diagnostic.target,
    "Profile failures should point at the profile selection.",
  ).toEqual(profileRegion);
  expect(
    diagnostic.message,
    "Profile failures should read as a profile-selection problem.",
  ).toBe("Extrude profile selection is incorrect.");
});

test("untagged raw kernel throw stays feature-level and preserves the message", () => {
  const feature = makeExtrudeFeature({
    extent: blindExtent,
    booleanScope: { kind: "targetBody", bodyId: scopeBody.bodyId },
  });
  const error = new Error("Standard_Failure: BRep_API command not done.");

  const diagnostic = createFeatureRebuildFailureDiagnostic(
    feature,
    error,
    affectedTargets,
  );

  expect(
    diagnostic.target,
    "Raw kernel throws must not blame an authored field; keep them feature-level.",
  ).toEqual({ kind: "feature", featureId: feature.featureId });
  expect(
    diagnostic.fieldId,
    "Feature-level diagnostics should not attribute an authored field.",
  ).toBeUndefined();
  expect(
    diagnostic.message,
    "Feature-level diagnostics must preserve the raw kernel message.",
  ).toBe("Standard_Failure: BRep_API command not done.");
  expect(
    diagnostic.featureId,
    "Feature-level diagnostics should still identify the failing feature.",
  ).toBe(feature.featureId);
  expect(
    diagnostic.detail?.kind,
    "The structured rebuildFailure detail must be preserved.",
  ).toBe("rebuildFailure");
});

// T10 plan §2.9: the causes thrown while a feature consumes a sketch region.
const sketchA = {
  sketchId: profileRegion.sketchId,
  label: "Sketch A",
  sketch: {
    derivedValidity: {
      state: "invalid",
      diagnostics: [
        { code: "x", severity: "error", message: "x", target: null },
        { code: "y", severity: "warning", message: "y", target: null },
      ],
    },
  },
} as unknown as SketchSnapshotRecord;

test("an exact profile build failure is attributed to the sketch, not the profile field", () => {
  const feature = makeExtrudeFeature({
    extent: blindExtent,
    booleanScope: { kind: "targetBody", bodyId: scopeBody.bodyId },
  });
  const error = tagRebuildSlot(
    new Error(
      "profile-edge-below-kernel-resolution: The edge of sketch entity e_arc has radius 1e-9 below the kernel resolution.",
    ),
    "profile",
  );

  const diagnostic = createFeatureRebuildFailureDiagnostic(
    feature,
    error,
    affectedTargets,
    [sketchA],
  );

  expect(diagnostic).toMatchObject({
    code: "profile-edge-below-kernel-resolution",
    featureId: feature.featureId,
    fieldId: "sketch",
    target: { kind: "sketch", sketchId: profileRegion.sketchId },
    repairGuidance:
      "Edit Sketch A: The edge of sketch entity e_arc has radius 1e-9 below the kernel resolution.",
  });
  expect(
    diagnostic.detail?.kind,
    "The structured rebuildFailure detail must be preserved.",
  ).toBe("rebuildFailure");
});

test("requireRegion causes attribute to the profile selection with their own code and guidance", () => {
  const feature = makeExtrudeFeature({
    extent: blindExtent,
    booleanScope: { kind: "targetBody", bodyId: scopeBody.bodyId },
  });
  const reselect = createFeatureRebuildFailureDiagnostic(
    feature,
    new Error(
      "profile-region-reselect: Sketch region region_a is not among the current regions of Sketch A; choose a valid profile selection.",
    ),
    affectedTargets,
    [sketchA],
  );
  expect(reselect).toMatchObject({
    code: "profile-region-reselect",
    fieldId: "profiles",
    target: profileRegion,
    repairGuidance: "Edit Extrude and choose a valid profile selection.",
  });

  const notCurrent = createFeatureRebuildFailureDiagnostic(
    feature,
    new Error(
      "profile-region-sketch-not-current: Sketch region region_a waits for Sketch A, whose derived output is invalid.",
    ),
    affectedTargets,
    [sketchA],
  );
  expect(notCurrent).toMatchObject({
    code: "profile-region-sketch-not-current",
    fieldId: "profiles",
    target: profileRegion,
    repairGuidance: "Correct Sketch A (1 error); the profile will resolve again.",
  });
});

// Review R-1: open-chain builders (sweep paths) throw the same build codes, so
// a failure is attributed to a sketch only when every sketch-sourced input of
// the feature comes from that one sketch.
function makeSweepFeature(pathSketchId: SketchId): OccAuthoringFeatureRecord {
  return {
    featureId: "feature_sweep" as FeatureId,
    label: "Sweep 1",
    suppressed: false,
    definition: {
      kind: "sweep",
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: "create",
        participants: [
          { role: "profile", targets: [profileRegion] },
          {
            role: "path",
            targets: [
              {
                kind: "sketchEntity",
                sketchId: pathSketchId,
                entityId: "sketch_entity_path" as SketchEntityId,
              },
            ],
          },
        ],
      },
    } as FeatureDefinition,
  };
}

const pathGap = () =>
  new Error(
    "profile-vertex-gap-exceeds-join: The end of sketch entity sketch_entity_path lies 0.01 from its join.",
  );

test("a build failure of a sweep whose path is in another sketch stays feature-level with its code", () => {
  const sketchB = {
    ...sketchA,
    sketchId: "sketch_b" as SketchId,
    label: "Sketch B",
  } as SketchSnapshotRecord;
  const feature = makeSweepFeature("sketch_b" as SketchId);
  const diagnostic = createFeatureRebuildFailureDiagnostic(
    feature,
    pathGap(),
    affectedTargets,
    [sketchA, sketchB],
  );

  expect(
    diagnostic,
    "Two source sketches: no sketch is blamed for the path failure.",
  ).toMatchObject({
    code: "profile-vertex-gap-exceeds-join",
    featureId: feature.featureId,
    target: { kind: "feature", featureId: feature.featureId },
  });
  expect(diagnostic.fieldId).toBeUndefined();
});

test("a build failure of a sweep whose profile and path share one sketch is attributed to it", () => {
  const feature = makeSweepFeature(profileRegion.sketchId);
  const diagnostic = createFeatureRebuildFailureDiagnostic(
    feature,
    pathGap(),
    affectedTargets,
    [sketchA],
  );

  expect(diagnostic).toMatchObject({
    code: "profile-vertex-gap-exceeds-join",
    fieldId: "sketch",
    target: { kind: "sketch", sketchId: profileRegion.sketchId },
    message:
      "Sweep 1 cannot build from Sketch A: The end of sketch entity sketch_entity_path lies 0.01 from its join.",
    repairGuidance:
      "Edit Sketch A: The end of sketch entity sketch_entity_path lies 0.01 from its join.",
  });
});

test("a requireRegion cause names its region exactly, even when another selected id is its prefix (review A-2)", () => {
  const longer = { ...profileRegion, regionId: "region_a_legacy" as RegionId };
  const base = makeExtrudeFeature({
    extent: blindExtent,
    booleanScope: { kind: "targetBody", bodyId: scopeBody.bodyId },
  });
  const feature = {
    ...base,
    definition: {
      ...base.definition,
      parameters: {
        ...(base.definition.parameters as object),
        profiles: [profileRegion, longer],
      },
    } as FeatureDefinition,
  };
  const diagnostic = createFeatureRebuildFailureDiagnostic(
    feature,
    new Error(
      "profile-region-reselect: Sketch region region_a_legacy is not among the current regions of Sketch A; choose a valid profile selection.",
    ),
    affectedTargets,
    [sketchA],
  );
  expect(diagnostic.target).toEqual(longer);
});
