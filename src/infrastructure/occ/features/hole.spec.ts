import { beforeAll, expect, test } from "vitest";
import { readFile } from "node:fs/promises";

import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import { createExpressionAuthoredValue } from "@/contracts/modeling/authored-values";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import type { SketchDefinition, SketchRecord } from "@/contracts/sketch/schema";
import {
  SKETCH_SCHEMA_VERSION,
  SOLVED_SKETCH_SCHEMA_VERSION,
} from "@/contracts/sketch/schema";
import type { BodyId, FeatureId, SketchId, SketchPointId } from "@/contracts/shared/ids";
import { createOccAuthoringState } from "@/infrastructure/occ/authoring-state";
import { executeOccFeature } from "@/infrastructure/occ/features";
import { toGpPnt } from "@/infrastructure/occ/planes";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import { trackNewSolidBody, type OccTrackedBody } from "@/infrastructure/occ/topology";
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
  createStandardPlaneDefinition,
} from "@/core/modeling/opencascade-kernel-seed";

type CustomOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

async function loadCustomOpenCascadeForTest() {
  const module = (await import("../../../../public/cadara-occ.js")) as {
    default: CustomOpenCascadeMainJSForTest;
  };
  const wasmBinary = new Uint8Array(
    await readFile(new URL("../../../../public/cadara-occ.wasm", import.meta.url)),
  );

  return new module.default({ wasmBinary });
}

let oc: OpenCascadeInstance;

beforeAll(async () => {
  oc = await loadCustomOpenCascadeForTest();
});

function pointId(name: string) {
  return `sketch_point_${name}` as SketchPointId;
}

function makeBoxBody(
  bodyId: BodyId,
  ownerFeatureId: FeatureId,
  origin: readonly [number, number, number] = [0, 0, 0],
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, origin), 4, 4, 4);
  box.Build(new oc.Message_ProgressRange_1());
  expect(box.IsDone(), `Expected ${bodyId} box to build.`).toBeTruthy();

  return trackNewSolidBody(oc, {
    bodyId,
    label: bodyId,
    ownerFeatureId,
    shape: box.Shape(),
  });
}

function bodyVolume(shape: object) {
  const props = new oc.GProp_GProps_1();
  try {
    oc.BRepGProp.VolumeProperties_1(
      shape as InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
      props,
      false,
      false,
      false,
    );
    return props.Mass();
  } finally {
    props.delete();
  }
}

function makeCylinderShape(
  origin: readonly [number, number, number],
  radius: number,
  height: number,
  direction: readonly [number, number, number] = [0, 0, 1],
) {
  const point = toGpPnt(oc, origin);
  const axisDirection = new oc.gp_Dir_4(direction[0], direction[1], direction[2]);
  const xDirection = new oc.gp_Dir_4(1, 0, 0);
  const axis = new oc.gp_Ax2_2(point, axisDirection, xDirection);
  const cylinder = new oc.BRepPrimAPI_MakeCylinder_3(axis, radius, height);
  cylinder.Build(new oc.Message_ProgressRange_1());
  expect(cylinder.IsDone(), "Expected probe cylinder to build.").toBeTruthy();
  return cylinder.Shape();
}

function commonVolume(
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  probe: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const progress = new oc.Message_ProgressRange_1();
  const common = new oc.BRepAlgoAPI_Common_3(shape, probe, progress);
  common.Build(progress);
  expect(common.IsDone(), "Expected probe common operation to build.").toBeTruthy();
  return bodyVolume(common.Shape());
}

function expectProbeEmpty(
  body: OccTrackedBody,
  origin: readonly [number, number, number],
  message: string,
) {
  const probe = makeCylinderShape(origin, 0.08, 0.2);
  expect(commonVolume(body.shape, probe), message).toBeLessThan(1e-4);
}

function expectSmallProbeEmpty(
  body: OccTrackedBody,
  origin: readonly [number, number, number],
  message: string,
) {
  const probe = makeCylinderShape(origin, 0.03, 0.05);
  expect(commonVolume(body.shape, probe), message).toBeLessThan(1e-5);
}

function expectProbeSolid(
  body: OccTrackedBody,
  origin: readonly [number, number, number],
  message: string,
) {
  const probe = makeCylinderShape(origin, 0.08, 0.2);
  expect(commonVolume(body.shape, probe), message).toBeGreaterThan(5e-4);
}

function makeSketch(
  sketchId: SketchId,
  points: readonly { pointId: SketchPointId; position: readonly [number, number] }[],
): SketchSnapshotRecord {
  const plane = createStandardPlaneDefinition("xy");
  const definition: SketchDefinition = {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: points.map((point) => point.pointId),
    points: points.map((point) => ({
      pointId: point.pointId,
      label: point.pointId,
      target: { kind: "sketchPoint", sketchId, pointId: point.pointId },
      position: point.position,
      isConstruction: false,
    })),
    entityIds: [],
    entities: [],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };
  const sketch: SketchRecord = {
    ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
    ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    sketchId,
    label: sketchId,
    planeSupport: plane.support,
    definition,
    solvedSnapshot: {
      schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
      status: { solveState: "solved", constraintState: "wellConstrained" },
      solvedEntities: [],
      solvedPoints: points.map((point) => ({
        pointId: point.pointId,
        target: { kind: "sketchPoint", sketchId, pointId: point.pointId },
        solvedPosition: point.position,
      })),
      constraintStatuses: [],
      dimensionStatuses: [],
      diagnostics: [],
    },
    derivedValidity: { state: "current", diagnostics: [] },
    regions: [],
  };

  return {
    ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
    ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    sketchId,
    label: sketchId,
    plane,
    planeTarget: plane.support,
    planeKey: plane.key,
    sketch,
  };
}

function holeDefinition(input: {
  sketchId: SketchId;
  pointIds: readonly SketchPointId[];
  bodyIds: readonly BodyId[];
  options: NonNullable<AdvancedSolidFeatureDefinition["parameters"]["options"]>;
}) {
  return {
    kind: "hole" as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        {
          role: "location" as const,
          targets: input.pointIds.map((pointId) => ({
            kind: "sketchPoint" as const,
            sketchId: input.sketchId,
            pointId,
          })),
        },
        {
          role: "body" as const,
          targets: input.bodyIds.map((bodyId) => ({ kind: "body" as const, bodyId })),
        },
      ],
      options: input.options,
    },
  } satisfies AdvancedSolidFeatureDefinition & { kind: "hole" };
}

function executeHole(input: {
  featureId: FeatureId;
  bodies: readonly OccTrackedBody[];
  sketch: SketchSnapshotRecord;
  definition: AdvancedSolidFeatureDefinition & { kind: "hole" };
}) {
  return executeOccFeature(
    createOccAuthoringState(oc, { bodies: input.bodies, sketches: [input.sketch] }),
    input.featureId,
    input.definition,
  );
}

function requireBody(result: ReturnType<typeof executeOccFeature>, bodyId: BodyId) {
  const body = result.bodies.find((candidate) => candidate.bodyId === bodyId);
  expect(body, `Expected ${bodyId} in OCC hole result.`).toBeTruthy();
  return body!;
}

test("OCC hole cuts a simple through-all cylindrical opening and retains the body id", () => {
  const body = makeBoxBody("body_hole_through" as BodyId, "feature_hole_seed" as FeatureId);
  const center = pointId("through_center");
  const sketch = makeSketch("sketch_hole_through" as SketchId, [
    { pointId: center, position: [2, 2] },
  ]);

  const result = executeHole({
    featureId: "feature_hole_through" as FeatureId,
    bodies: [body],
    sketch,
    definition: holeDefinition({
      sketchId: sketch.sketchId,
      pointIds: [center],
      bodyIds: [body.bodyId],
      options: { style: "simple", mainDiameter: 1, termination: "throughAll" },
    }),
  });
  const replacement = requireBody(result, body.bodyId);

  expect(result.producedTargets).toEqual([{ kind: "body", bodyId: body.bodyId }]);
  expect(bodyVolume(replacement.shape)).toBeLessThan(bodyVolume(body.shape));
  expectProbeEmpty(
    replacement,
    [2, 2, -0.1],
    "Through-all hole should leave no material on the cylindrical axis.",
  );
  expect(
    result.topologyStage?.outputs.get(body.bodyId)?.sourceTargets.size,
    "Hole must publish conservative unsupported producer topology.",
  ).toBe(0);
});

test("OCC blind hole leaves material below the authored depth", () => {
  const body = makeBoxBody("body_hole_blind" as BodyId, "feature_hole_blind_seed" as FeatureId);
  const center = pointId("blind_center");
  const sketch = makeSketch("sketch_hole_blind" as SketchId, [
    { pointId: center, position: [2, 2] },
  ]);
  const result = executeHole({
    featureId: "feature_hole_blind" as FeatureId,
    bodies: [body],
    sketch,
    definition: holeDefinition({
      sketchId: sketch.sketchId,
      pointIds: [center],
      bodyIds: [body.bodyId],
      options: { style: "simple", mainDiameter: 1, termination: "blind", depth: 2 },
    }),
  });
  const replacement = requireBody(result, body.bodyId);

  expectProbeEmpty(replacement, [2, 2, 0.5], "Blind bore should remove entry-axis material.");
  expectProbeSolid(replacement, [2, 2, 3], "Blind bore should leave bottom material.");
});

test("OCC hole cuts every authored sketchPoint location", () => {
  const body = makeBoxBody("body_hole_two" as BodyId, "feature_hole_two_seed" as FeatureId);
  const left = pointId("two_left");
  const right = pointId("two_right");
  const sketch = makeSketch("sketch_hole_two" as SketchId, [
    { pointId: left, position: [1, 2] },
    { pointId: right, position: [3, 2] },
  ]);
  const result = executeHole({
    featureId: "feature_hole_two" as FeatureId,
    bodies: [body],
    sketch,
    definition: holeDefinition({
      sketchId: sketch.sketchId,
      pointIds: [left, right],
      bodyIds: [body.bodyId],
      options: { style: "simple", mainDiameter: 0.8, termination: "throughAll" },
    }),
  });
  const replacement = requireBody(result, body.bodyId);

  expectProbeEmpty(replacement, [1, 2, 1], "First location should be cut.");
  expectProbeEmpty(replacement, [3, 2, 1], "Second location should be cut.");
});

test("OCC counterbore creates a larger shallow recess plus main bore", () => {
  const body = makeBoxBody("body_hole_counterbore" as BodyId, "feature_hole_cb_seed" as FeatureId);
  const center = pointId("counterbore_center");
  const sketch = makeSketch("sketch_hole_counterbore" as SketchId, [
    { pointId: center, position: [2, 2] },
  ]);
  const result = executeHole({
    featureId: "feature_hole_counterbore" as FeatureId,
    bodies: [body],
    sketch,
    definition: holeDefinition({
      sketchId: sketch.sketchId,
      pointIds: [center],
      bodyIds: [body.bodyId],
      options: {
        style: "counterbore",
        mainDiameter: 1,
        counterboreDiameter: 2,
        counterboreDepth: 1,
        termination: "blind",
        depth: 3,
      },
    }),
  });
  const replacement = requireBody(result, body.bodyId);

  expectProbeEmpty(replacement, [2.75, 2, 0.4], "Counterbore recess should remove the larger shallow ring.");
  expectProbeSolid(replacement, [2.75, 2, 1.6], "Counterbore ring should not continue below recess depth.");
  expectProbeEmpty(replacement, [2, 2, 2], "Main bore should continue below the counterbore recess.");
});

test("OCC countersink creates a conical entry plus main bore", () => {
  const body = makeBoxBody("body_hole_countersink" as BodyId, "feature_hole_cs_seed" as FeatureId);
  const center = pointId("countersink_center");
  const sketch = makeSketch("sketch_hole_countersink" as SketchId, [
    { pointId: center, position: [2, 2] },
  ]);
  const result = executeHole({
    featureId: "feature_hole_countersink" as FeatureId,
    bodies: [body],
    sketch,
    definition: holeDefinition({
      sketchId: sketch.sketchId,
      pointIds: [center],
      bodyIds: [body.bodyId],
      options: {
        style: "countersink",
        mainDiameter: 1,
        countersinkDiameter: 2,
        countersinkAngleDegrees: 90,
        termination: "blind",
        depth: 3,
      },
    }),
  });
  const replacement = requireBody(result, body.bodyId);

  expectSmallProbeEmpty(replacement, [2.75, 2, 0.1], "Countersink should remove wide material at entry.");
  expectProbeSolid(replacement, [2.75, 2, 0.9], "Countersink taper should restore the outer ring below the cone.");
  expectProbeEmpty(replacement, [2, 2, 2], "Main bore should continue below the countersink cone.");
});

test("OCC hole only cuts explicitly scoped bodies", () => {
  const selected = makeBoxBody("body_hole_scope_selected" as BodyId, "feature_hole_scope_selected_seed" as FeatureId);
  const unselected = makeBoxBody("body_hole_scope_unselected" as BodyId, "feature_hole_scope_unselected_seed" as FeatureId);
  const center = pointId("scope_center");
  const sketch = makeSketch("sketch_hole_scope" as SketchId, [
    { pointId: center, position: [2, 2] },
  ]);
  const result = executeHole({
    featureId: "feature_hole_scope" as FeatureId,
    bodies: [selected, unselected],
    sketch,
    definition: holeDefinition({
      sketchId: sketch.sketchId,
      pointIds: [center],
      bodyIds: [selected.bodyId],
      options: { style: "simple", mainDiameter: 1, termination: "throughAll" },
    }),
  });
  const selectedReplacement = requireBody(result, selected.bodyId);
  const unselectedBody = requireBody(result, unselected.bodyId);

  expect(bodyVolume(selectedReplacement.shape)).toBeLessThan(bodyVolume(selected.shape));
  expect(bodyVolume(unselectedBody.shape)).toBeCloseTo(bodyVolume(unselected.shape), 5);
});

test("OCC hole honors reverse direction for blind cuts", () => {
  const body = makeBoxBody(
    "body_hole_reverse" as BodyId,
    "feature_hole_reverse_seed" as FeatureId,
    [0, 0, -4],
  );
  const center = pointId("reverse_center");
  const sketch = makeSketch("sketch_hole_reverse" as SketchId, [
    { pointId: center, position: [2, 2] },
  ]);
  const result = executeHole({
    featureId: "feature_hole_reverse" as FeatureId,
    bodies: [body],
    sketch,
    definition: holeDefinition({
      sketchId: sketch.sketchId,
      pointIds: [center],
      bodyIds: [body.bodyId],
      options: {
        style: "simple",
        direction: "reverse",
        mainDiameter: 1,
        termination: "blind",
        depth: 2,
      },
    }),
  });
  const replacement = requireBody(result, body.bodyId);

  expectProbeEmpty(replacement, [2, 2, -1], "Reverse blind bore should cut into negative sketch normal.");
  expectProbeSolid(replacement, [2, 2, -3], "Reverse blind bore should leave material beyond depth.");
});

test("OCC hole rejects unresolved and excessive inputs with structured failures", () => {
  const body = makeBoxBody("body_hole_invalid" as BodyId, "feature_hole_invalid_seed" as FeatureId);
  const center = pointId("invalid_center");
  const sketch = makeSketch("sketch_hole_invalid" as SketchId, [
    { pointId: center, position: [2, 2] },
  ]);

  expect(() =>
    executeHole({
      featureId: "feature_hole_expression" as FeatureId,
      bodies: [body],
      sketch,
      definition: holeDefinition({
        sketchId: sketch.sketchId,
        pointIds: [center],
        bodyIds: [body.bodyId],
        options: {
          style: "simple",
          mainDiameter: createExpressionAuthoredValue("d1"),
          termination: "throughAll",
        },
      }),
    }),
  ).toThrow(/advanced-feature-unsupported-kernel-case/);

  expect(() =>
    executeHole({
      featureId: "feature_hole_excessive" as FeatureId,
      bodies: [body],
      sketch,
      definition: holeDefinition({
        sketchId: sketch.sketchId,
        pointIds: [center],
        bodyIds: [body.bodyId],
        options: {
          style: "counterbore",
          mainDiameter: 1,
          counterboreDiameter: 2,
          counterboreDepth: 3,
          termination: "blind",
          depth: 2,
        },
      }),
    }),
  ).toThrow(/advanced-feature-unsupported-kernel-case/);
});

function makeBoxShape(
  origin: readonly [number, number, number],
  size: readonly [number, number, number],
) {
  const box = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, origin), size[0], size[1], size[2]);
  box.Build(new oc.Message_ProgressRange_1());
  expect(box.IsDone(), "Expected fixture box to build.").toBeTruthy();
  return box.Shape();
}

function trackBody(
  bodyId: string,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  return trackNewSolidBody(oc, {
    bodyId: bodyId as BodyId,
    label: bodyId,
    ownerFeatureId: `feature_${bodyId}_seed` as FeatureId,
    shape,
  });
}

/** A 4x4x4 block, z 0..4, with a closed internal cavity spanning z 2..3 around the hole axis. */
function makeCavityBody(bodyId: string) {
  const progress = new oc.Message_ProgressRange_1();
  const cut = new oc.BRepAlgoAPI_Cut_3(
    makeBoxShape([0, 0, 0], [4, 4, 4]),
    makeBoxShape([1, 1, 2], [2, 2, 1]),
    progress,
  );
  cut.Build(progress);
  expect(cut.IsDone(), "Expected cavity fixture to build.").toBeTruthy();
  return trackBody(bodyId, cut.Shape());
}

/** A side block beside the 4x4x4 target whose top face sits at z = 2.5. */
function makeStopBody(bodyId: string) {
  return trackBody(bodyId, makeBoxShape([6, 0, -1.5], [2, 2, 4]));
}

function topFaceId(body: OccTrackedBody, z: number) {
  const entry = [...body.facesById].find(([, face]) => {
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.SurfaceProperties_1(face, props, false, false);
    const centre = props.CentreOfMass();
    const onLevel = Math.abs(centre.Z() - z) < 1e-6;
    props.delete();
    return onLevel;
  });
  expect(entry, `Expected a face of ${body.bodyId} at z = ${z}.`).toBeTruthy();
  return entry![0];
}

function topVertexId(body: OccTrackedBody, z: number) {
  const entry = [...body.verticesById].find(
    ([, vertex]) => Math.abs(oc.BRep_Tool.Pnt(vertex).Z() - z) < 1e-6,
  );
  expect(entry, `Expected a vertex of ${body.bodyId} at z = ${z}.`).toBeTruthy();
  return entry![0];
}

function executeUpToHole(input: {
  name: string;
  bodies: readonly OccTrackedBody[];
  target: OccTrackedBody;
  options: NonNullable<AdvancedSolidFeatureDefinition["parameters"]["options"]>;
}) {
  const center = pointId(`${input.name}_center`);
  const sketch = makeSketch(`sketch_${input.name}` as SketchId, [
    { pointId: center, position: [2, 2] },
  ]);
  const result = executeHole({
    featureId: `feature_${input.name}` as FeatureId,
    bodies: input.bodies,
    sketch,
    definition: holeDefinition({
      sketchId: sketch.sketchId,
      pointIds: [center],
      bodyIds: [input.target.bodyId],
      options: { style: "simple", mainDiameter: 1, ...input.options },
    }),
  });
  return requireBody(result, input.target.bodyId);
}

test("OCC up-to-next hole stops at the first face the bore breaks through, unlike through-all", () => {
  const body = makeCavityBody("body_hole_up_to_next");
  const upToNext = executeUpToHole({
    name: "hole_up_to_next",
    bodies: [body],
    target: body,
    options: { termination: "upToNext" },
  });
  expectProbeEmpty(upToNext, [2, 2, 1], "Up-to-next bore should remove material below the cavity.");
  expectProbeSolid(upToNext, [2, 2, 3.5], "Up-to-next bore should stop at the cavity and keep the roof.");

  const throughAll = executeUpToHole({
    name: "hole_up_to_next_control",
    bodies: [body],
    target: body,
    options: { termination: "throughAll" },
  });
  expectProbeEmpty(throughAll, [2, 2, 3.5], "Through-all control should cut the cavity roof.");
});

test("OCC up-to-face, up-to-part and up-to-vertex holes end at the terminator's level", () => {
  const stop = makeStopBody("body_hole_stop");
  const stopFace = { kind: "face" as const, bodyId: stop.bodyId, faceId: topFaceId(stop, 2.5) };
  const stopVertex = { kind: "vertex" as const, bodyId: stop.bodyId, vertexId: topVertexId(stop, 2.5) };
  for (const [termination, upToTarget] of [
    ["upToFace", stopFace],
    ["upToPart", { kind: "body", bodyId: stop.bodyId }],
    ["upToVertex", stopVertex],
  ] as const) {
    const body = makeBoxBody(`body_hole_${termination}` as BodyId, `feature_hole_${termination}_seed` as FeatureId);
    const cut = executeUpToHole({
      name: `hole_${termination}`,
      bodies: [body, stop],
      target: body,
      options: { termination, upToTarget },
    });
    expectProbeEmpty(cut, [2, 2, 2.2], `${termination} hole should cut up to z = 2.5.`);
    expectProbeSolid(cut, [2, 2, 2.7], `${termination} hole should leave material above z = 2.5.`);
  }
});

test("OCC up-to hole applies Extrude's shorten and extend offsets", () => {
  const stop = makeStopBody("body_hole_offset_stop");
  const upToTarget = { kind: "face" as const, bodyId: stop.bodyId, faceId: topFaceId(stop, 2.5) };
  const body = makeBoxBody("body_hole_offset" as BodyId, "feature_hole_offset_seed" as FeatureId);
  const shortened = executeUpToHole({
    name: "hole_offset_shorten",
    bodies: [body, stop],
    target: body,
    options: { termination: "upToFace", upToTarget, upToOffset: { distance: { source: "literal", value: 1 }, direction: "shorten" } },
  });
  expectProbeEmpty(shortened, [2, 2, 1.2], "Shortened bore should reach z = 1.5.");
  expectProbeSolid(shortened, [2, 2, 1.7], "Shortened bore should stop 1 below the face.");
  const extended = executeUpToHole({
    name: "hole_offset_extend",
    bodies: [body, stop],
    target: body,
    options: { termination: "upToFace", upToTarget, upToOffset: { distance: 1, direction: "extend" } },
  });
  expectProbeEmpty(extended, [2, 2, 3.2], "Extended bore should reach z = 3.5.");
  expectProbeSolid(extended, [2, 2, 3.7], "Extended bore should stop 1 beyond the face.");
});

test("OCC up-to hole refuses a too-deep counterbore, a missing terminator and a passed terminator, naming the hole", () => {
  const stop = makeStopBody("body_hole_refuse_stop");
  const body = makeBoxBody("body_hole_refuse" as BodyId, "feature_hole_refuse_seed" as FeatureId);
  expect(() =>
    executeUpToHole({
      name: "hole_refuse_counterbore",
      bodies: [body, stop],
      target: body,
      options: {
        style: "counterbore",
        counterboreDiameter: 2,
        counterboreDepth: 3,
        termination: "upToPart",
        upToTarget: { kind: "body", bodyId: stop.bodyId },
      },
    }),
  ).toThrow(/advanced-feature-unsupported-kernel-case: OCC hole counterboreDepth must be less than the up-to depth/);
  expect(() =>
    executeUpToHole({
      name: "hole_refuse_target",
      bodies: [body, stop],
      target: body,
      options: { termination: "upToFace" },
    }),
  ).toThrow(/advanced-feature-unsupported-kernel-case: .*require one face target/);
  expect(
    () =>
      executeUpToHole({
        name: "hole_refuse_behind",
        bodies: [body, stop],
        target: body,
        options: {
          termination: "upToFace",
          upToTarget: { kind: "face", bodyId: stop.bodyId, faceId: topFaceId(stop, 2.5) },
          upToOffset: { distance: 3, direction: "shorten" },
        },
      }),
    "Refusals from Extrude's shared resolver should name the hole.",
  ).toThrow(/advanced-feature-unsupported-kernel-case: OCC hole termination is behind/);
});
