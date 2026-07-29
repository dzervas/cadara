import { test, expect } from "vitest";

import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import {
  createCreateFeatureHistoryEntry,
  createEmptyOperationHistory,
} from "@/contracts/modeling/operation-history";
import { parseOperationHistoryPayload } from "@/contracts/modeling/operation-history.runtime-schema";
import {
  validateFeatureDefinition,
  validateKernelDocumentSnapshot,
} from "@/contracts/modeling/runtime-schema";
import type {
  BodySnapshotRecord,
  CreateFeatureRequest,
  FeatureDefinition,
} from "@/contracts/modeling/schema";
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  REVOLVE_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

const profileRef = {
  kind: "region",
  sketchId: "sketch_profile",
  regionId: "region_profile",
} as const;

const openCurveRef = {
  kind: "sketchEntity",
  sketchId: "sketch_profile",
  entityId: "sketch_entity_curve",
} as const;

const extrudeExtent = {
  mode: "oneSide",
  end: {
    kind: "blind",
    direction: "positive",
    distance: createLiteralAuthoredValue(10),
  },
} as const;

const solidExtrude = {
  kind: "extrude",
  featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
  parameters: {
    resultBodyType: "solid",
    profiles: [profileRef],
    startExtent: { kind: "profilePlane" },
    extent: extrudeExtent,
    operation: createLiteralAuthoredValue("newBody"),
    booleanScope: { kind: "standalone" },
  },
} as const satisfies FeatureDefinition;

const surfaceExtrude = {
  kind: "extrude",
  featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
  parameters: {
    resultBodyType: "surface",
    profiles: [openCurveRef],
    startExtent: { kind: "profilePlane" },
    extent: extrudeExtent,
  },
} as const satisfies FeatureDefinition;

const surfaceRevolve = {
  kind: "revolve",
  featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
  parameters: {
    resultBodyType: "surface",
    profiles: [openCurveRef],
    axis: {
      kind: "sketchEntity",
      sketchId: "sketch_profile",
      entityId: "sketch_entity_axis",
    },
    startAngle: createLiteralAuthoredValue(0),
    extent: { mode: "oneSide", end: { kind: "full" } },
  },
} as const satisfies FeatureDefinition;

test("extrude and revolve parameters require an explicit result body discriminant", () => {
  expect(
    validateFeatureDefinition(solidExtrude).success,
    "Solid extrude payloads should validate with the explicit solid discriminant.",
  ).toBeTruthy();
  expect(
    validateFeatureDefinition(surfaceExtrude).success,
    "Surface extrude payloads should validate with the explicit surface discriminant.",
  ).toBeTruthy();
  expect(
    validateFeatureDefinition(surfaceRevolve).success,
    "Surface revolve payloads should validate with the explicit surface discriminant.",
  ).toBeTruthy();

  const parametersWithoutDiscriminant: Record<string, unknown> = {
    ...solidExtrude.parameters,
  };
  delete parametersWithoutDiscriminant.resultBodyType;
  expect(
    validateFeatureDefinition({
      ...solidExtrude,
      parameters: parametersWithoutDiscriminant,
    }).success,
    "Extrude payloads without resultBodyType should be rejected before execution.",
  ).toBeFalsy();
});

test("surface extrude and revolve payloads cannot carry boolean operation state", () => {
  expect(
    validateFeatureDefinition({
      ...surfaceExtrude,
      parameters: {
        ...surfaceExtrude.parameters,
        operation: createLiteralAuthoredValue("join"),
      },
    }).success,
    "Surface extrude payloads carrying an operation should be rejected.",
  ).toBeFalsy();
  expect(
    validateFeatureDefinition({
      ...surfaceRevolve,
      parameters: {
        ...surfaceRevolve.parameters,
        booleanScope: { kind: "standalone" },
      },
    }).success,
    "Surface revolve payloads carrying a boolean scope should be rejected.",
  ).toBeFalsy();
});

test("open sketch-curve profile refs are surface-only and name exactly one entity", () => {
  expect(
    validateFeatureDefinition({
      ...solidExtrude,
      parameters: { ...solidExtrude.parameters, profiles: [openCurveRef] },
    }).success,
    "Solid extrude payloads should reject open sketch-curve profile refs.",
  ).toBeFalsy();
  expect(
    validateFeatureDefinition({
      ...surfaceExtrude,
      parameters: {
        ...surfaceExtrude.parameters,
        profiles: [{ ...openCurveRef, entityIds: ["sketch_entity_curve"] }],
      },
    }).success,
    "Surface profile refs naming more than one sketch entity should be rejected.",
  ).toBeFalsy();
  expect(
    validateFeatureDefinition({
      ...surfaceExtrude,
      parameters: {
        ...surfaceExtrude.parameters,
        profiles: [{ kind: "sketchEntity", sketchId: "sketch_profile" }],
      },
    }).success,
    "Surface profile refs missing a durable entity id should be rejected.",
  ).toBeFalsy();
});

test("extrude and revolve profile collections must be non-empty", () => {
  expect(
    validateFeatureDefinition({
      ...solidExtrude,
      parameters: { ...solidExtrude.parameters, profiles: [] },
    }).success,
    "Solid extrude payloads with empty profile collections should be rejected.",
  ).toBeFalsy();
  expect(
    validateFeatureDefinition({
      ...surfaceRevolve,
      parameters: { ...surfaceRevolve.parameters, profiles: [] },
    }).success,
    "Surface revolve payloads with empty profile collections should be rejected.",
  ).toBeFalsy();
});

test("body snapshots round-trip an explicit body kind through snapshot hydration", async () => {
  const adapter = new MockKernelAdapter();
  const response = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const document = response.snapshot.document;
  const [solidBody] = document.bodies;
  expect(
    solidBody?.bodyKind,
    "Seeded solid bodies should persist an explicit solid body kind.",
  ).toBe("solid");

  const sheetBody: BodySnapshotRecord = {
    ...solidBody!,
    bodyId: "body_sheet-1",
    ownerBodyId: "body_sheet-1",
    label: "Sheet body",
    bodyKind: "sheet",
    topology: { faceIds: [], edgeIds: [], vertexIds: [] },
  };
  const hydrated = validateKernelDocumentSnapshot({
    ...document,
    bodies: [...document.bodies, sheetBody],
  });
  expect(
    hydrated.success,
    "Snapshots holding both solid and sheet bodies should hydrate.",
  ).toBeTruthy();
  expect(
    hydrated.success ? hydrated.data.bodies.map((body) => body.bodyKind) : [],
    "Hydrated body kinds should round-trip exactly as persisted.",
  ).toEqual(["solid", "sheet"]);

  const bodyWithoutKind: Record<string, unknown> = { ...solidBody! };
  delete bodyWithoutKind.bodyKind;
  expect(
    validateKernelDocumentSnapshot({
      ...document,
      bodies: [bodyWithoutKind],
    }).success,
    "Snapshot hydration should reject body records without an explicit body kind.",
  ).toBeFalsy();
});

test("operation history replays solid and surface feature definitions", () => {
  const request = (definition: FeatureDefinition): CreateFeatureRequest => ({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: "rev_0001",
    definition,
  });
  const history = {
    ...createEmptyOperationHistory("doc_workspace"),
    entries: [
      createCreateFeatureHistoryEntry(request(solidExtrude)),
      createCreateFeatureHistoryEntry(request(surfaceExtrude)),
      createCreateFeatureHistoryEntry(request(surfaceRevolve)),
    ],
  };

  const result = parseOperationHistoryPayload(history);
  expect(
    result.ok,
    "Solid and surface feature history entries should replay through the durable log.",
  ).toBeTruthy();
});
