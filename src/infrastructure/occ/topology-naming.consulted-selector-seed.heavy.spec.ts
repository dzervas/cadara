// Logic lane, heavy tier (docs/testing.md): the production OCC adapter
// (`public/cadara-occ`) on the landing enclosure, bracket and wheel. Seam:
// reconcileReplacementTopology, as every adapter path reaches it. A
// reconciliation from a body without naming whose result naming the stage
// drops seeds selectors only for the subshapes that consult the selector
// fallback and builds no result selectors (admitsConsultedSelectorSeed holds
// the argument for why that is exact). Every such reconciliation is shadowed
// here by the eager one (every selector seeded, result selectors built: what
// a kept result naming still gets), and both must run the same selector
// solves with the same results and reach the same ids, contributors and
// invalidations.
import { afterAll, expect, test, vi } from "vitest";

import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import type { OccTopologyReconciliationResult } from "@/infrastructure/occ/topology-naming";

type ReconcileReplacementTopology =
  typeof import("@/infrastructure/occ/topology-naming").reconcileReplacementTopology;
type ReconciliationInput = Parameters<ReconcileReplacementTopology>[1];

interface ArmRecord {
  /** One entry per TNaming_Selector::Solve, in call order. */
  solves: string[];
  selections: number;
  outcome: unknown;
}

interface ShadowedReconciliation {
  bodyId: string;
  partial: ArmRecord;
  eager: ArmRecord;
}

const shadow = vi.hoisted(() => ({
  reconciliations: [] as ShadowedReconciliation[],
  /** Collects the selector calls of the arm that is running. */
  arm: undefined as { solves: string[]; selections: number } | undefined,
  /** The shapes whose subshapes a solve result is identified among. */
  shapes: undefined as { previous: unknown; result: unknown } | undefined,
}));

vi.mock("@/infrastructure/occ/topology-naming", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/infrastructure/occ/topology-naming")
    >();
  return {
    ...actual,
    reconcileReplacementTopology: (
      oc: OpenCascadeInstance,
      input: ReconciliationInput,
    ) =>
      reconcileWithEagerShadow(actual.reconcileReplacementTopology, oc, input),
  };
});

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { FeatureId } from "@/contracts/shared/ids";
import { enrichExtrudeRegionProfiles } from "@/core/modeling/region-profile-selection";
import { releaseOccObjects } from "@/infrastructure/occ/memory";

import {
  loadLandingModel,
  open,
  type Session,
} from "../../../test/helpers/occ-history-prefix-reuse-session";

type OccShape = InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
type OccLabelMap = InstanceType<OpenCascadeInstance["TDF_LabelMap"]>;
type OccNamedShape = ReturnType<
  InstanceType<OpenCascadeInstance["TNaming_Selector"]>["NamedShape"]
>;

const patchedInstances = new WeakSet<object>();
/** Restores the TNaming_Selector methods recordSelectorCalls replaced. */
const selectorPatchRestores: (() => void)[] = [];
afterAll(() => {
  for (const restore of selectorPatchRestores.splice(0)) restore();
});

/** Records every Solve (its value and what the reconciliation reads after it) and counts Select_1. */
function recordSelectorCalls(oc: OpenCascadeInstance) {
  if (patchedInstances.has(oc)) return;
  patchedInstances.add(oc);
  const prototype = oc.TNaming_Selector.prototype as unknown as {
    Select_1: (...args: unknown[]) => unknown;
    Solve: (valid: OccLabelMap) => boolean;
    NamedShape: () => OccNamedShape;
  };
  const select = prototype.Select_1;
  const solve = prototype.Solve;
  selectorPatchRestores.push(() => {
    prototype.Select_1 = select;
    prototype.Solve = solve;
  });
  prototype.Select_1 = function (this: unknown, ...args: unknown[]) {
    if (shadow.arm) shadow.arm.selections += 1;
    return select.apply(this, args);
  };
  prototype.Solve = function (this: typeof prototype, valid: OccLabelMap) {
    let solved: boolean;
    try {
      solved = solve.call(this, valid);
    } catch (error) {
      shadow.arm?.solves.push("threw");
      throw error;
    }
    shadow.arm?.solves.push(
      `${String(solved)} ${describeSolveResult(oc, this.NamedShape(), valid)}`,
    );
    return solved;
  };
}

/**
 * The shapes resolveSelectorFinalSuccessors reads after a Solve, each as its
 * type, orientation and indexes among the result and previous subshapes of
 * that type (0: not among them).
 */
function describeSolveResult(
  oc: OpenCascadeInstance,
  namedShape: OccNamedShape,
  valid: OccLabelMap,
) {
  const owned: { delete(): void }[] = [namedShape];
  const read = (name: string, get: () => OccShape | OccNamedShape) => {
    try {
      const value = get();
      owned.push(value);
      if ("IsNull" in value && value.IsNull()) return `${name}=null`;
      return `${name}=${describeShape(oc, value as OccShape)}`;
    } catch {
      // The production reader skips a read that throws; record that it threw.
      return `${name}=threw`;
    }
  };
  try {
    if (namedShape.IsNull()) return "no-named-shape";
    const reads = [
      read("get", () => oc.TNaming_Tool.GetShape(namedShape)),
      read("current", () => oc.TNaming_Tool.CurrentShape_1(namedShape)),
      read("currentValid", () =>
        oc.TNaming_Tool.CurrentShape_2(namedShape, valid),
      ),
    ];
    let current: OccNamedShape | undefined;
    try {
      current = oc.TNaming_Tool.CurrentNamedShape_1(namedShape, valid);
      owned.push(current);
    } catch {
      reads.push("currentNamed=threw");
    }
    if (current && current.IsNull()) reads.push("currentNamed=null");
    if (current && !current.IsNull()) {
      reads.push(
        read("currentNamed.get", () => oc.TNaming_Tool.GetShape(current)),
        read("currentNamed.current", () =>
          oc.TNaming_Tool.CurrentShape_1(current),
        ),
      );
    }
    return reads.join(" ");
  } finally {
    releaseOccObjects(owned);
  }
}

function describeShape(oc: OpenCascadeInstance, shape: OccShape): string {
  if (shape.IsNull()) return "null";
  const type = (shape.ShapeType() as unknown as { value: number }).value;
  const orientation = (shape.Orientation_1() as unknown as { value: number })
    .value;
  const compound = (
    oc.TopAbs_ShapeEnum.TopAbs_COMPOUND as unknown as { value: number }
  ).value;
  if (type !== compound) {
    return `${type}/${orientation}#${resultIndexes(oc, shape, shape.ShapeType())}`;
  }
  // A compound (several current shapes): its faces, edges and vertices.
  const { TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX } = oc.TopAbs_ShapeEnum;
  return `compound(${[TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX]
    .map((subshapeType) => resultIndexes(oc, shape, subshapeType))
    .join("|")})`;
}

/**
 * `result~previous` indexes, among the result and the previous body's
 * subshapes of `type`, of each of `shape`'s subshapes of that type.
 */
function resultIndexes(
  oc: OpenCascadeInstance,
  shape: OccShape,
  type: unknown,
) {
  const maps = [
    new oc.TopTools_IndexedMapOfShape_1(),
    new oc.TopTools_IndexedMapOfShape_1(),
    new oc.TopTools_IndexedMapOfShape_1(),
  ] as const;
  const [result, previous, subshapes] = maps;
  try {
    oc.TopExp.MapShapes_1(
      shadow.shapes!.result as OccShape,
      type as never,
      result,
    );
    oc.TopExp.MapShapes_1(
      shadow.shapes!.previous as OccShape,
      type as never,
      previous,
    );
    oc.TopExp.MapShapes_1(shape, type as never, subshapes);
    const indexes: string[] = [];
    for (let index = 1; index <= subshapes.Size(); index += 1) {
      const subshape = subshapes.FindKey(index);
      indexes.push(
        `${result.FindIndex(subshape)}~${previous.FindIndex(subshape)}`,
      );
      subshape.delete();
    }
    return indexes.join(",");
  } finally {
    for (const map of maps) map.delete();
  }
}

function reconciliationOutcome(result: OccTopologyReconciliationResult) {
  return {
    topology: result.topology,
    contributingFeatureIds: result.contributingFeatureIds,
    faces: [...result.faceContributingFeatureIdsById],
    edges: [...result.edgeContributingFeatureIdsById],
    vertices: [...result.vertexContributingFeatureIdsById],
    invalidations: [...result.invalidations],
  };
}

function runArm(
  oc: OpenCascadeInstance,
  reconcile: ReconcileReplacementTopology,
  input: ReconciliationInput,
) {
  const arm = { solves: [] as string[], selections: 0 };
  shadow.arm = arm;
  shadow.shapes = {
    previous: input.previous.shape,
    result: input.replacement.shape,
  };
  try {
    const result = reconcile(oc, input);
    return {
      result,
      record: { ...arm, outcome: reconciliationOutcome(result) },
    };
  } finally {
    shadow.arm = undefined;
    shadow.shapes = undefined;
  }
}

/**
 * Runs the production reconciliation, then, when it may take the consulted
 * seed (no naming on the previous body and the result naming dropped), the
 * eager one on the same input, whose naming is released here.
 */
function reconcileWithEagerShadow(
  reconcile: ReconcileReplacementTopology,
  oc: OpenCascadeInstance,
  input: ReconciliationInput,
) {
  recordSelectorCalls(oc);
  if (input.previous.naming || !input.resultNamingDiscarded) {
    return reconcile(oc, input);
  }
  const partial = runArm(oc, reconcile, input);
  const eager = runArm(oc, reconcile, {
    ...input,
    resultNamingDiscarded: false,
  });
  const naming = eager.result.naming!;
  releaseOccObjects([
    naming.bodyLabel,
    ...naming.topologyLabelsByKey.values(),
    ...naming.selectorLabelsByKey.values(),
    naming.document,
  ]);
  shadow.reconciliations.push({
    bodyId: input.previous.bodyId,
    partial: partial.record,
    eager: eager.record,
  });
  return partial.result;
}

/** Shadowed reconciliations since the last call, with the premise counts. */
function takeShadowedReconciliations() {
  const taken = shadow.reconciliations.splice(0);
  const consulting = taken.filter(({ eager }) => eager.solves.length > 0);
  return {
    taken,
    consulting: consulting.length,
    partialSeeds: consulting.filter(
      ({ partial, eager }) => partial.selections < eager.selections,
    ).length,
    solves: consulting.reduce((sum, { eager }) => sum + eager.solves.length, 0),
  };
}

/**
 * Every shadowed reconciliation must equal its eager twin. `premises` also
 * requires that some reconciliation consulted selectors through the
 * consulted seed, so the comparison is not vacuous.
 */
function expectIdenticalToEager(
  what: string,
  {
    taken,
    consulting,
    partialSeeds,
  }: ReturnType<typeof takeShadowedReconciliations>,
  { premises }: { premises: boolean } = { premises: true },
) {
  if (premises) {
    expect(
      consulting,
      `premise (${what}): some reconciliation consults selectors`,
    ).toBeGreaterThan(0);
    expect(
      partialSeeds,
      `premise (${what}): the consulted seed was taken`,
    ).toBeGreaterThan(0);
  }
  const compared = (arm: "partial" | "eager") =>
    taken.map((entry) => ({
      bodyId: entry.bodyId,
      solves: entry[arm].solves,
      outcome: entry[arm].outcome,
    }));
  expect(
    compared("partial"),
    `${what}: every selector solve and every reconciled id, contributor and invalidation equals the eager seed`,
  ).toEqual(compared("eager"));
}

async function withSession<T>(
  document: AuthoredModelDocument,
  run: (session: Session) => Promise<T>,
) {
  const session = await open(document);
  try {
    return await run(session);
  } finally {
    session.adapter.dispose();
  }
}

/** `value`, failing with `premise` when the landing model no longer has it. */
function required<T>(value: T | undefined, premise: string): T {
  expect(value, `premise: ${premise}`).toBeDefined();
  return value!;
}

/**
 * Commits a copy of `featureId`'s first sketch at the history tail and
 * returns `featureId`'s definition retargeted to that copy's closed regions.
 */
async function tailCopyOf(
  session: Session,
  source: AuthoredModelDocument,
  featureId: string,
) {
  const { definition } = required(
    source.features.find((feature) => feature.featureId === featureId),
    `the landing model has ${featureId}`,
  );
  const sketch = required(
    source.sketches.find((entry) =>
      JSON.stringify(definition).includes(`"${entry.sketchId}"`),
    ),
    `${featureId} extrudes a sketch`,
  );
  const sketchId = await session.commitSketch({
    label: `Tail copy of ${featureId}`,
    plane: sketch.plane,
    definition: sketch.definition,
  });
  const snapshot = await session.snapshot();
  const regionIds = snapshot.document.sketches
    .find((entry) => entry.sketchId === sketchId)!
    .sketch.regions.filter((region) => region.isClosed)
    .map((region) => region.regionId);
  const retargeted = structuredClone(definition) as unknown as {
    parameters: { profiles: unknown[] };
  };
  retargeted.parameters.profiles = regionIds.map((regionId) => ({
    kind: "region",
    sketchId,
    regionId,
  }));
  return enrichExtrudeRegionProfiles(
    retargeted as unknown as FeatureDefinition,
    snapshot.document.sketches,
  );
}

test("the landing enclosure opens, rebuilds after an edit and two tail features, and reopens its export with the consulted seed identical to the eager seed", async () => {
  const source = await loadLandingModel("enclosure");
  shadow.reconciliations.length = 0;
  const exported = await withSession(source, async (session) => {
    expectIdenticalToEager("open", takeShadowedReconciliations());

    const lidThickness = required(
      source.variables.find((variable) => variable.name === "lidThickness"),
      "the landing enclosure has the lidThickness variable",
    );
    await session.setVariable(lidThickness.variableId, "lidThickness", "4");
    // The bosses join the shell, the bores cut it.
    const join = await tailCopyOf(session, source, "feature_extrude-3");
    await session.preview(join, null);
    await session.create(join);
    await session.create(
      await tailCopyOf(session, source, "feature_extrude-4"),
    );
    takeShadowedReconciliations();
    return session.exported();
  });

  await withSession(exported, async () => {
    expectIdenticalToEager(
      "reopen of the edited export with two tail features",
      takeShadowedReconciliations(),
    );
  });
}, 900_000);

test("the landing bracket opens and rebuilds after a middle feature is deleted with the consulted seed identical to the eager seed", async () => {
  const source = await loadLandingModel("bracket");
  shadow.reconciliations.length = 0;
  await withSession(source, async (session) => {
    expectIdenticalToEager("open", takeShadowedReconciliations());
    const middle = required(
      source.features[4],
      "the landing bracket has a fifth feature",
    );
    await session.deleteFeature(middle.featureId as FeatureId);
    expectIdenticalToEager(
      "rebuild after the delete",
      takeShadowedReconciliations(),
      { premises: false },
    );
  });
}, 900_000);

test("the landing wheel opens with the consulted seed identical to the eager seed", async () => {
  const source = await loadLandingModel("wheel");
  shadow.reconciliations.length = 0;
  await withSession(source, async () => {
    expectIdenticalToEager("open", takeShadowedReconciliations());
  });
}, 900_000);
