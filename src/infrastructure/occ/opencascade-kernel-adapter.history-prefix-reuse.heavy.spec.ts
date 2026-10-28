// cadara-di5. Logic lane, heavy tier (docs/testing.md): the production OCC
// adapter (`public/cadara-occ`) on the landing bracket, wheel and enclosure.
// A history edit (cursor move, tail feature add/delete, tail parameter edit)
// resumes from the evaluated state of the last unchanged feature instead of
// replaying the whole history from the empty cursor, so only the affected
// suffix runs again. Sketch, variable, tolerance, order and label invalidation
// of the reused prefix is covered without OCC in
// occ/authoring-state.feature-checkpoint.spec.ts. The result must equal a cold open of
// the edited document: authored export (lineage included), body/topology ids,
// live references, diagnostics and render geometry.
//
// cadara-afj3: document-variable edits and removal take the same path (a
// variable that only a sketch dimension reads re-solves that sketch and reruns
// its consumers), and a feature preview reuses the prefix before the previewed
// feature and leaves the session as it was. A variable edit still restores the
// document when a face sketch follows the first item it changes, since a
// restore re-places that sketch on the moved face.
//
// cadara-jxe3: a restore (Undo/Redo, a peer's write) takes the runtime's
// sketch records and feature checkpoints for the unchanged prefix, so the
// next snapshot reuses their region meshes and native body payloads. A
// restore must equal a cold open with exact topology tokens (cadara-797), and
// still re-places a face sketch whose supporting face moved.
//
// cadara-vjcv: a cursor rollback keeps the stage checkpoint of each
// rolled-back feature, so Roll To End resumes the tail instead of running it
// again and shows the bodies (and native payloads) it showed before. A rebuild
// that evaluates a feature releases the kept tail.
//
// Cold opens and rebuilds are not a fixed point on topology tokens (each
// evaluation re-mints fallback ids `…_t0019_1` -> `…_t0020_1`, see the
// body-rename heavy spec) and stamp their revision; comparisons normalize
// both. Invalidated references depend on session history and are excluded.
// Nor on the id form (cadara-phi0): a cold open keeps a reproduced output's
// native hash ids where an in-session rebuild re-mints them, so normalized
// comparisons first rename the session's ids to the cold open's through a
// positional correspondence (test/helpers/topology-id-correspondence.ts).
import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";

// Counts feature executions without retaining their (large) arguments.
const featureRuns = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/infrastructure/occ/features", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/infrastructure/occ/features")>();
  return {
    ...actual,
    executeOccFeature: (
      ...args: Parameters<typeof actual.executeOccFeature>
    ) => {
      featureRuns.count += 1;
      return actual.executeOccFeature(...args);
    },
  };
});
// Counts region profile faces built (snapshot meshing and feature profiles).
const regionFaces = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/infrastructure/occ/sketch-profile", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/infrastructure/occ/sketch-profile")
    >();
  return {
    ...actual,
    buildRegionProfileFace: (
      ...args: Parameters<typeof actual.buildRegionProfileFace>
    ) => {
      regionFaces.count += 1;
      return actual.buildRegionProfileFace(...args);
    },
  };
});

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { createExpressionAuthoredValue } from "@/contracts/modeling/authored-values";
import type {
  FeatureDefinition,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import type { FeatureId, SketchId } from "@/contracts/shared/ids";

import {
  appliedFeatureIds,
  evaluatedModel,
  expectColdEquivalent,
  keptTailCheckpoints,
  occInstance,
  open,
  previewModel,
  runtimeBodies,
  type Session,
  shownModel,
} from "../../../test/helpers/occ-history-prefix-reuse-session";

const tailPlane: FeatureDefinition = {
  featureTypeVersion: "feature-type/plane/v1alpha1",
  kind: "plane",
  parameters: {
    mode: "explicitFrame",
    frame: {
      handedness: "rightHanded",
      linearUnit: "documentLength",
      origin: [0, 0, 123],
      normal: [0, 0, 1],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
    },
  },
} as FeatureDefinition;

type TailEdit = (
  session: Session,
  document: AuthoredModelDocument,
) => Promise<{
  expected: AuthoredModelDocument;
  reruns: number;
  featureId: FeatureId;
}>;

interface TailParameterEdit {
  featureId: FeatureId;
  edit: (definition: FeatureDefinition) => FeatureDefinition;
}

/** `document` with `featureId`'s definition edited by `edit`. */
const withEditedFeature = (
  document: AuthoredModelDocument,
  { featureId, edit }: TailParameterEdit,
): AuthoredModelDocument => ({
  ...document,
  features: document.features.map((feature) =>
    feature.featureId === featureId
      ? { ...feature, definition: edit(structuredClone(feature.definition)) }
      : feature,
  ),
});

/** Edits a literal parameter of `featureId`; only it and its suffix rerun. */
const editFeature =
  (parameterEdit: TailParameterEdit): TailEdit =>
  async (session, document) => {
    const { featureId } = parameterEdit;
    const { features } = withEditedFeature(document, parameterEdit);
    await session.update(
      featureId,
      features.find((feature) => feature.featureId === featureId)!.definition,
    );
    const applied = appliedFeatureIds(document);
    return {
      expected: { ...document, features },
      reruns: applied.length - applied.indexOf(featureId),
      featureId,
    };
  };

const tailParameterEdits: Record<string, TailParameterEdit> = {
  bracket: {
    featureId: "feature_chamfer-1" as FeatureId,
    edit: (definition) => {
      const parameters = definition.parameters as unknown as {
        options: { distance: { value: number } };
      };
      parameters.options.distance.value = 0.5;
      return definition;
    },
  },
  wheel: {
    featureId: "feature_extrude-29" as FeatureId,
    edit: (definition) => {
      const parameters = definition.parameters as unknown as {
        extent: { end: { distance: { value: number } } };
      };
      parameters.extent.end.distance.value = 0.3;
      return definition;
    },
  },
  // A depth given by a document-variable expression.
  enclosure: {
    featureId: "feature_extrude-21" as FeatureId,
    edit: (definition) => {
      const parameters = definition.parameters as unknown as {
        extent: { end: { distance: { valueText: string } } };
      };
      parameters.extent.end.distance.valueText = "screwHeadHeight + 0.5";
      return definition;
    },
  },
};
const models = Object.fromEntries(
  Object.entries(tailParameterEdits).map(([model, edit]) => [
    model,
    editFeature(edit),
  ]),
);

test.each(Object.entries(models))(
  "history edits on the landing %s rerun only the changed suffix and equal a cold open",
  async (model, tailEdit) => {
    const source = JSON.parse(
      await readFile(
        new URL(
          `../../../landing/examples/${model}/model.cadara`,
          import.meta.url,
        ),
        "utf8",
      ),
    ) as AuthoredModelDocument;
    const session = await open(source);
    try {
      expect(
        runtimeBodies(session).some((body) =>
          [...(body.nativeTopologyIdAliases?.faceIdsByNativeId ?? [])].some(
            ([nativeId, durableId]) => nativeId !== durableId,
          ),
        ),
        "premise: history-preserved ids differ from the kernel's native ids",
      ).toBe(true);
      const opened = await session.exported();
      const applied = appliedFeatureIds(opened);
      expect(applied.length, "premise").toBeGreaterThan(2);
      const end = opened.cursor;
      const rolledBack = {
        kind: "feature",
        featureId: applied.at(-2)!,
      } as const;

      featureRuns.count = 0;
      await session.setCursor(rolledBack);
      expect(featureRuns.count, "rolling back one feature runs none").toBe(0);
      await expectColdEquivalent(
        session,
        { ...opened, cursor: rolledBack },
        "roll back",
      );

      featureRuns.count = 0;
      await session.setCursor(end);
      expect(
        featureRuns.count,
        "rolling to the end resumes the tail's kept checkpoint and runs none (cadara-vjcv)",
      ).toBe(0);
      await expectColdEquivalent(session, opened, "roll to end");

      featureRuns.count = 0;
      const plane = await session.create(tailPlane);
      expect(featureRuns.count, "a tail add runs only the new feature").toBe(1);
      featureRuns.count = 0;
      await session.deleteFeature(plane);
      expect(featureRuns.count, "deleting the tail feature runs none").toBe(0);
      await expectColdEquivalent(session, opened, "tail add + delete");

      const beforeEdit = await session.exported();
      featureRuns.count = 0;
      const { expected, reruns, featureId } = await tailEdit(
        session,
        beforeEdit,
      );
      expect(
        reruns,
        "premise: the edit leaves an unchanged prefix",
      ).toBeLessThan(applied.length);
      expect(featureRuns.count, "an edit reruns only the changed suffix").toBe(
        reruns,
      );
      await expectColdEquivalent(session, expected, "edit");

      // Reopening the edited feature previews it in its history position.
      const definition = expected.features.find(
        (feature) => feature.featureId === featureId,
      )!.definition;
      featureRuns.count = 0;
      const preview = await session.preview(definition, featureId);
      expect(
        featureRuns.count,
        "a preview runs only the previewed feature after the reused prefix",
      ).toBe(1);
      expect(
        preview.render.records.length,
        "premise: the preview renders the feature",
      ).toBeGreaterThan(0);
      await expectColdEquivalent(session, expected, "preview has no effect");
      const cold = await open(expected);
      try {
        expect(
          previewModel(preview),
          "the preview equals one evaluated by a cold open",
        ).toEqual(previewModel(await cold.preview(definition, featureId)));
      } finally {
        cold.adapter.dispose();
      }
    } finally {
      session.adapter.dispose();
    }
  },
  900_000,
);

/** The applied features that read `name` (directly or through a sketch). */
function readersOf(document: AuthoredModelDocument, name: string) {
  const reads = (value: unknown) =>
    new RegExp(`\\b${name}\\b`).test(JSON.stringify(value));
  const sketchIds = document.sketches
    .filter((sketch) => reads(sketch.definition))
    .map((sketch) => sketch.sketchId);
  return appliedFeatureIds(document).filter((featureId) => {
    const definition = document.features.find(
      (feature) => feature.featureId === featureId,
    )!.definition;
    return (
      reads(definition) ||
      sketchIds.some((sketchId) =>
        JSON.stringify(definition).includes(`"${sketchId}"`),
      )
    );
  });
}

test("document variable edits and removal on the landing enclosure rerun only the features they change and equal a cold open (cadara-afj3)", async () => {
  const source = JSON.parse(
    await readFile(
      new URL(
        "../../../landing/examples/enclosure/model.cadara",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;
  const session = await open(source);
  try {
    let expected = await session.exported();
    const applied = appliedFeatureIds(expected);
    const edit = async (name: string, valueText: string) => {
      const variable = expected.variables.find((entry) => entry.name === name)!;
      const readers = readersOf(expected, name);
      expect(readers.length, `premise: features read ${name}`).toBeGreaterThan(
        0,
      );
      featureRuns.count = 0;
      await session.setVariable(variable.variableId, name, valueText);
      expected = {
        ...expected,
        variables: expected.variables.map((entry) =>
          entry.variableId === variable.variableId
            ? { ...entry, valueText }
            : entry,
        ),
      };
      return applied.length - applied.indexOf(readers[0]!);
    };

    const featureReruns = await edit("socketFloor", "0.9");
    expect(featureReruns, "premise: an unchanged prefix").toBeLessThan(
      applied.length,
    );
    expect(
      featureRuns.count,
      "a variable that features read reruns from the first of them",
    ).toBe(featureReruns);
    await expectColdEquivalent(session, expected, "feature variable edit");

    expect(
      expected.features.some((feature) =>
        JSON.stringify(feature.definition).includes("ventWidth"),
      ),
      "premise: only a sketch dimension reads ventWidth",
    ).toBe(false);
    const sketchReruns = await edit("ventWidth", "3.5");
    expect(sketchReruns, "premise: an unchanged prefix").toBeLessThan(
      applied.length,
    );
    expect(
      featureRuns.count,
      "a variable that a sketch reads re-solves it and reruns from its first consumer",
    ).toBe(sketchReruns);
    await expectColdEquivalent(session, expected, "sketch variable edit");

    const variableId = await session.addVariable("unusedProbe", "1");
    featureRuns.count = 0;
    await session.removeVariable(variableId);
    expect(featureRuns.count, "removing an unread variable runs none").toBe(0);
    await expectColdEquivalent(session, expected, "variable removal");
  } finally {
    session.adapter.dispose();
  }
}, 900_000);

const loadLandingModel = async (model: string) =>
  JSON.parse(
    await readFile(
      new URL(
        `../../../landing/examples/${model}/model.cadara`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;

/**
 * The landing enclosure with an empty sketch on the top face of its base
 * feature right after it; nothing consumes the sketch, so only its placement
 * depends on upstream geometry.
 */
async function enclosureWithTopFaceSketch() {
  const source = await loadLandingModel("enclosure");
  const baseFeatureId = "feature_extrude-1" as FeatureId;
  // feature_extrude-1 extrudes the footprint by height - lidThickness - lidGap.
  const topZ = 32 - 3 - 0.3;
  const probe = await open(source);
  let support: Extract<
    AuthoredModelDocument["sketches"][number]["plane"]["support"],
    { kind: "face" }
  >;
  try {
    await probe.setCursor({ kind: "feature", featureId: baseFeatureId });
    const topFaces = (await probe.snapshot()).document.render.records.filter(
      (record) =>
        record.binding.target.kind === "face" &&
        record.geometry.kind === "mesh" &&
        record.geometry.vertexPositions.every(
          ([, , z]) => Math.abs(z - topZ) < 1e-6,
        ),
    );
    expect(topFaces.length, "premise: one top face after the base").toBe(1);
    support = topFaces[0]!.binding.target as typeof support;
  } finally {
    probe.adapter.dispose();
  }

  const faceSketchId = "sketch_afj3-top-face" as SketchId;
  const emptyDefinition = {
    ...source.sketches[0]!.definition,
    ...Object.fromEntries(
      Object.entries(source.sketches[0]!.definition).flatMap(([key, value]) =>
        Array.isArray(value) ? [[key, []]] : [],
      ),
    ),
  } as AuthoredModelDocument["sketches"][number]["definition"];
  const baseIndex = source.historyOrder.findIndex(
    (item) => item.kind === "feature" && item.featureId === baseFeatureId,
  );
  const document: AuthoredModelDocument = {
    ...source,
    sketches: [
      ...source.sketches,
      {
        sketchId: faceSketchId,
        label: "Top face",
        plane: {
          support,
          frame: {
            handedness: "rightHanded",
            linearUnit: "documentLength",
            origin: [0, 0, topZ],
            normal: [0, 0, 1],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
          },
          key: null,
        },
        definition: emptyDefinition,
      },
    ],
    historyOrder: source.historyOrder.toSpliced(baseIndex + 1, 0, {
      kind: "sketch",
      sketchId: faceSketchId,
    }),
  };
  return { document, faceSketchId, baseFeatureId, topZ };
}

test("a document variable edit restores a face sketch that follows the first item it changes, and resumes the prefix when the face sketch precedes it (cadara-afj3)", async () => {
  const { document, faceSketchId, baseFeatureId, topZ } =
    await enclosureWithTopFaceSketch();

  const session = await open(document);
  try {
    let expected = await session.exported();
    const applied = appliedFeatureIds(expected);
    const faceSketchZ = async () =>
      (await session.snapshot()).document.sketches.find(
        (sketch) => sketch.sketchId === faceSketchId,
      )!.plane.frame.origin[2];
    expect(
      await faceSketchZ(),
      "premise: the sketch sits on the top",
    ).toBeCloseTo(topZ, 6);
    const edit = async (name: string, valueText: string) => {
      const variable = expected.variables.find((entry) => entry.name === name)!;
      featureRuns.count = 0;
      await session.setVariable(variable.variableId, name, valueText);
      expected = {
        ...expected,
        variables: expected.variables.map((entry) =>
          entry.variableId === variable.variableId
            ? { ...entry, valueText }
            : entry,
        ),
      };
    };

    const firstReader = readersOf(expected, "socketFloor")[0]!;
    expect(
      applied.indexOf(firstReader),
      "premise: socketFloor is first read after the face sketch",
    ).toBeGreaterThan(applied.indexOf(baseFeatureId));
    await edit("socketFloor", "0.9");
    expect(
      featureRuns.count,
      "a face sketch before the first changed item keeps the prefix",
    ).toBe(applied.length - applied.indexOf(firstReader));
    await expectColdEquivalent(session, expected, "edit after the face sketch");

    expect(
      readersOf(expected, "lidThickness")[0],
      "premise: lidThickness feeds the base feature",
    ).toBe(baseFeatureId);
    await edit("lidThickness", "4");
    expect(
      await faceSketchZ(),
      "an edit before the face sketch re-places it on the moved face",
    ).toBeCloseTo(topZ - 1, 6);
    await expectColdEquivalent(
      session,
      expected,
      "edit before the face sketch",
    );
  } finally {
    session.adapter.dispose();
  }
}, 900_000);

test("a preview of a feature before the tail that joins an earlier body, after a deletion in the session, resumes the prefix and equals a cold preview (cadara-afj3)", async () => {
  const source = await loadLandingModel("bracket");
  const session = await open(source);
  try {
    const opened = await session.exported();
    const applied = appliedFeatureIds(opened);
    const featureId = "feature_extrude-6" as FeatureId;
    expect(
      applied.indexOf(featureId),
      "premise: the previewed feature is not the tail",
    ).toBeLessThan(applied.length - 1);
    const definition = structuredClone(
      opened.features.find((feature) => feature.featureId === featureId)!
        .definition,
    );
    const parameters = definition.parameters as unknown as {
      booleanScope: { kind: string };
      extent: { end: { distance: { value: number } } };
    };
    expect(
      parameters.booleanScope.kind,
      "premise: it joins an earlier body",
    ).toBe("targetBody");
    parameters.extent.end.distance.value = 3.5;

    // The session now carries reference history a cold open does not have.
    await session.deleteFeature(await session.create(tailPlane));
    featureRuns.count = 0;
    const preview = await session.preview(definition, featureId);
    expect(
      featureRuns.count,
      "a preview runs only the previewed feature after the reused prefix",
    ).toBe(1);
    await expectColdEquivalent(session, opened, "preview has no effect");
    const cold = await open(opened);
    try {
      expect(
        previewModel(preview),
        "the preview equals one evaluated by a cold open",
      ).toEqual(previewModel(await cold.preview(definition, featureId)));
    } finally {
      cold.adapter.dispose();
    }
  } finally {
    session.adapter.dispose();
  }
}, 900_000);

test("snapshots after a cursor rollback it already showed, the Roll To End back, or a tail plane add/delete reuse every native body payload (cadara-rgq, cadara-vjcv)", async () => {
  const source = JSON.parse(
    await readFile(
      new URL(
        "../../../landing/examples/bracket/model.cadara",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;
  const session = await open(source);
  // Bodies whose native topology payload (triangles + ids) the snapshot built
  // through the display builder.
  const native = (
    (await occInstance()) as unknown as {
      CadaraNativeTopologyMeshBuffers: {
        Build: (...args: unknown[]) => unknown;
      };
    }
  ).CadaraNativeTopologyMeshBuffers;
  const build = native.Build;
  let builtBodies: string[] = [];
  native.Build = (...args: unknown[]) => {
    builtBodies.push(String(args[1]));
    return build(...args);
  };
  let lastSnapshot: WorkspaceSnapshot | null = null;
  const snapshotBuilds = async () => {
    builtBodies = [];
    lastSnapshot = await session.snapshot();
    return builtBodies;
  };
  try {
    const shownAtEnd = shownModel(await session.snapshot());
    const opened = await session.exported();
    const end = opened.cursor;
    const tail = appliedFeatureIds(opened).at(-1)!;
    const rolledBack = {
      kind: "feature",
      featureId: appliedFeatureIds(opened).at(-2)!,
    } as const;

    await session.setCursor(rolledBack);
    const tailBodies = await snapshotBuilds();
    expect(
      tailBodies.length,
      "premise: the tail feature changes a body, which the rollback shows as it was before",
    ).toBeGreaterThan(0);
    const firstRollback = evaluatedModel(lastSnapshot!);
    expect
      .soft(
        keptTailCheckpoints(session),
        "the rollback keeps one checkpoint, the rolled-back feature's (cadara-vjcv)",
      )
      .toEqual([tail]);
    featureRuns.count = 0;
    await session.setCursor(end);
    expect
      .soft(
        featureRuns.count,
        "rolling to the end resumes the tail's kept checkpoint (cadara-vjcv)",
      )
      .toBe(0);
    expect(
      await snapshotBuilds(),
      "and shows the bodies it showed before the rollback",
    ).toEqual([]);
    expect(
      shownModel(lastSnapshot!),
      "rolling to the end shows the model shown before the rollback",
    ).toEqual(shownAtEnd);
    expect(
      keptTailCheckpoints(session),
      "moving the cursor past the tail releases its kept checkpoint",
    ).toEqual([]);
    await session.setCursor(rolledBack);
    expect(
      await snapshotBuilds(),
      "rolling back again shows the bodies kept by the feature checkpoints",
    ).toEqual([]);
    expect(
      evaluatedModel(lastSnapshot!),
      "the reused payloads show the same model as the first rollback",
    ).toEqual(firstRollback);

    // A rebuild that evaluates a feature releases the kept tail checkpoint,
    // which holds a history without that evaluation; the tail runs again.
    const inserted = await session.create(tailPlane);
    expect(
      keptTailCheckpoints(session),
      "inserting a feature behind the tail releases its kept checkpoint",
    ).toEqual([]);
    featureRuns.count = 0;
    await session.deleteFeature(inserted);
    await session.setCursor(end);
    expect(
      featureRuns.count,
      "deleting it and rolling to the end after the release runs the tail again",
    ).toBe(1);
    await expectColdEquivalent(session, opened, "roll to end after release");

    await session.setCursor(end);
    await session.snapshot();
    const plane = await session.create(tailPlane);
    expect(await snapshotBuilds(), "a tail plane changes no body").toEqual([]);
    await session.deleteFeature(plane);
    expect(
      await snapshotBuilds(),
      "deleting the tail plane resumes from the unchanged checkpoint",
    ).toEqual([]);
  } finally {
    native.Build = build;
    session.adapter.dispose();
  }
}, 900_000);

test("a rolled-back tail whose definition or variable changes runs again on Roll To End and equals a cold open (cadara-vjcv)", async () => {
  const session = await open(await loadLandingModel("bracket"));
  try {
    await session.snapshot();
    const opened = await session.exported();
    const end = opened.cursor;
    const tailEdit = tailParameterEdits.bracket!;
    const tail = appliedFeatureIds(opened).at(-1)!;
    expect(tail, "premise: the edited feature is the tail").toBe(
      tailEdit.featureId,
    );
    const rolledBack = {
      kind: "feature",
      featureId: appliedFeatureIds(opened).at(-2)!,
    } as const;
    const definition = (document: AuthoredModelDocument) =>
      document.features.find((feature) => feature.featureId === tail)!
        .definition;

    await session.setCursor(rolledBack);
    expect(
      keptTailCheckpoints(session),
      "premise: the rollback keeps the tail's checkpoint",
    ).toEqual([tail]);
    const definitionEdited = withEditedFeature(opened, tailEdit);
    featureRuns.count = 0;
    await session.update(tail, definition(definitionEdited));
    expect(
      featureRuns.count,
      "premise: editing the unapplied tail evaluates nothing",
    ).toBe(0);
    expect(
      keptTailCheckpoints(session),
      "editing the tail's definition discards its kept checkpoint",
    ).toEqual([]);
    await session.setCursor(end);
    expect(featureRuns.count, "rolling to the end runs the edited tail").toBe(
      1,
    );
    await expectColdEquivalent(
      session,
      definitionEdited,
      "roll to end after a tail definition edit",
    );

    // The kept checkpoint's definition matches; the resume rejects it on the
    // variable the tail resolves differently.
    const variableId = await session.addVariable("tailChamfer", "0.5");
    const readsVariable = structuredClone(definition(opened));
    (
      readsVariable.parameters as unknown as {
        options: { distance: unknown };
      }
    ).options.distance = createExpressionAuthoredValue("tailChamfer");
    await session.update(tail, readsVariable);
    const beforeVariableEdit = await session.exported();
    await session.setCursor(rolledBack);
    expect(
      keptTailCheckpoints(session),
      "premise: the rollback keeps the tail's checkpoint",
    ).toEqual([tail]);
    featureRuns.count = 0;
    await session.setVariable(variableId, "tailChamfer", "0.4");
    expect(
      featureRuns.count,
      "premise: no applied feature reads the variable",
    ).toBe(0);
    await session.setCursor(end);
    expect(
      featureRuns.count,
      "rolling to the end runs the tail the variable changed",
    ).toBe(1);
    expect(
      keptTailCheckpoints(session),
      "and leaves no kept checkpoint",
    ).toEqual([]);
    await expectColdEquivalent(
      session,
      {
        ...beforeVariableEdit,
        variables: beforeVariableEdit.variables.map((variable) =>
          variable.variableId === variableId
            ? { ...variable, valueText: "0.4" }
            : variable,
        ),
      },
      "roll to end after a tail variable edit",
    );
  } finally {
    session.adapter.dispose();
  }
}, 900_000);

/**
 * Restores `document` into the session, then takes a snapshot. Returns the
 * features the restore executed, and the bodies (native topology payloads)
 * and region profile faces the snapshot built.
 */
async function restoreAndSnapshot(
  session: Session,
  document: AuthoredModelDocument,
) {
  // The snapshot's display builder (opencascade-kernel-adapter
  // buildNativeTopologyBodyPayload).
  const native = (
    (await occInstance()) as unknown as {
      CadaraNativeTopologyMeshBuffers: {
        Build: (...args: unknown[]) => unknown;
      };
    }
  ).CadaraNativeTopologyMeshBuffers;
  featureRuns.count = 0;
  await session.restore(document);
  const runs = featureRuns.count;
  const build = native.Build;
  const bodies: string[] = [];
  native.Build = (...args: unknown[]) => {
    bodies.push(String(args[1]));
    return build(...args);
  };
  regionFaces.count = 0;
  try {
    await session.snapshot();
  } finally {
    native.Build = build;
  }
  return { runs, bodies: bodies.sort(), regionFaces: regionFaces.count };
}

/** Bodies that the applied features from `featureId` on output. */
const bodiesFrom = (document: AuthoredModelDocument, featureId: FeatureId) => {
  const applied = appliedFeatureIds(document);
  const suffix = new Set(applied.slice(applied.indexOf(featureId)));
  return [
    ...new Set(
      (document.topologyLineage ?? [])
        .filter((record) => suffix.has(record.featureId))
        .flatMap((record) => record.outputs.map((output) => output.outputSlot)),
    ),
  ].sort();
};

test.each(Object.keys(tailParameterEdits))(
  "restores on the landing %s resume from the runtime's unchanged prefix, rebuild only the changed tail and equal a cold open (cadara-jxe3)",
  async (model) => {
    const source = await loadLandingModel(model);
    const session = await open(source);
    try {
      await session.snapshot();
      const opened = await session.exported();
      const tailEdit = tailParameterEdits[model]!;
      const applied = appliedFeatureIds(opened);
      const tail = {
        runs: applied.length - applied.indexOf(tailEdit.featureId),
        bodies: bodiesFrom(opened, tailEdit.featureId),
        regionFaces: 0,
      };
      expect(
        tail.runs,
        "premise: the edit leaves an unchanged prefix",
      ).toBeLessThan(applied.length);
      expect(
        tail.bodies.length,
        "premise: the tail outputs bodies",
      ).toBeGreaterThan(0);
      const bodies = (await session.snapshot()).document.bodies.length;
      expect(
        tail.bodies.length < bodies || bodies === 1,
        "premise: the prefix outputs other bodies, unless there is one",
      ).toBe(true);

      expect
        .soft(
          await restoreAndSnapshot(session, opened),
          "restoring the session's own export evaluates and meshes nothing",
        )
        .toEqual({ runs: 0, bodies: [], regionFaces: 0 });
      await expectColdEquivalent(
        session,
        opened,
        "restore of the export",
        "exact",
      );

      // A peer's write: the edit never ran in this session.
      const peer = withEditedFeature(opened, tailEdit);
      expect
        .soft(
          await restoreAndSnapshot(session, peer),
          "a peer's tail edit reruns the tail and rebuilds only its bodies",
        )
        .toEqual(tail);
      await expectColdEquivalent(session, peer, "peer tail edit", "exact");
      const edited = await session.exported();

      expect
        .soft(
          await restoreAndSnapshot(session, opened),
          "undo of the tail edit reruns the tail and rebuilds only its bodies",
        )
        .toEqual(tail);
      await expectColdEquivalent(session, opened, "undo", "exact");

      expect
        .soft(
          await restoreAndSnapshot(session, edited),
          "redo of the tail edit reruns the tail and rebuilds only its bodies",
        )
        .toEqual(tail);
      await expectColdEquivalent(session, edited, "redo", "exact");

      // Rolling back and to the end resumes the tail's kept checkpoint, which
      // the redo evaluated from `edited` (cadara-vjcv): the session keeps the
      // persisted lineage, and a restore of `edited` takes that tail stage.
      const end = edited.cursor;
      const rolledBack = {
        kind: "feature",
        featureId: applied.at(-2)!,
      } as const;
      await session.setCursor(rolledBack);
      featureRuns.count = 0;
      await session.setCursor(end);
      expect
        .soft(featureRuns.count, "rolling to the end runs no feature")
        .toBe(0);
      expect(
        (await session.exported()).topologyLineage,
        "rolling to the end keeps the persisted lineage",
      ).toEqual(edited.topologyLineage);
      await expectColdEquivalent(
        session,
        edited,
        "roll to end resumed the kept tail",
        "exact",
      );
      expect
        .soft(
          await restoreAndSnapshot(session, edited),
          "a restore after Roll To End evaluates and meshes nothing",
        )
        .toEqual({ runs: 0, bodies: [], regionFaces: 0 });
      await expectColdEquivalent(
        session,
        edited,
        "restore after Roll To End resumed the kept tail",
        "exact",
      );

      // Rolling back, adding and deleting a feature behind the tail (which
      // releases the tail's kept checkpoint, cadara-vjcv) and rolling to the
      // end evaluates the tail again in the session, which advances its
      // topology token past the one `edited` persists. A cold open keeps the
      // persisted one, so the restore must not take the session's tail stage.
      await session.setCursor(rolledBack);
      await session.deleteFeature(await session.create(tailPlane));
      await session.setCursor(end);
      expect(
        (await session.exported()).topologyLineage,
        "premise: the session's tail lineage differs from the persisted one",
      ).not.toEqual(edited.topologyLineage);
      expect
        .soft(
          (await restoreAndSnapshot(session, edited)).runs,
          "a restore reruns the features whose persisted lineage differs",
        )
        .toBe(1);
      await expectColdEquivalent(
        session,
        edited,
        "restore after the session re-evaluated the tail",
        "exact",
      );
    } finally {
      session.adapter.dispose();
    }
  },
  900_000,
);

test("a restore reuses a face sketch whose prefix is unchanged and re-places it when its face moved (cadara-jxe3)", async () => {
  const { document, faceSketchId, topZ } = await enclosureWithTopFaceSketch();
  const session = await open(document);
  try {
    const faceSketchZ = async () =>
      (await session.snapshot()).document.sketches.find(
        (sketch) => sketch.sketchId === faceSketchId,
      )!.plane.frame.origin[2];
    expect(
      await faceSketchZ(),
      "premise: the sketch sits on the top",
    ).toBeCloseTo(topZ, 6);
    const opened = await session.exported();
    expect(
      await restoreAndSnapshot(session, opened),
      "restoring the session's own export evaluates and meshes nothing",
    ).toEqual({ runs: 0, bodies: [], regionFaces: 0 });
    await expectColdEquivalent(
      session,
      opened,
      "restore of the export",
      "exact",
    );

    // A peer's write of lidThickness, which the base feature reads.
    const moved: AuthoredModelDocument = {
      ...opened,
      variables: opened.variables.map((variable) =>
        variable.name === "lidThickness"
          ? { ...variable, valueText: "4" }
          : variable,
      ),
    };
    await session.restore(moved);
    expect(
      await faceSketchZ(),
      "a restore that moves the face re-places the sketch on it",
    ).toBeCloseTo(topZ - 1, 6);
    await expectColdEquivalent(session, moved, "moved face", "exact");

    await session.restore(opened);
    expect(await faceSketchZ(), "undo puts it back").toBeCloseTo(topZ, 6);
    await expectColdEquivalent(session, opened, "undo", "exact");
  } finally {
    session.adapter.dispose();
  }
}, 900_000);

// Finish Sketch publishes the sketch and then restores the committed document
// (service.ts restorePublished). The restore must not replay the history to
// re-solve a sketch that reads no upstream geometry: on the enclosure that
// replay cost 8 s per Finish Sketch.
test("a restore of the session's own export after a new base-plane sketch at the tail evaluates and meshes nothing (cadara-zs79)", async () => {
  const source = await loadLandingModel("enclosure");
  const session = await open(source);
  try {
    await session.snapshot();
    const footprint = source.sketches[0]!;
    expect(
      [footprint.plane.support.kind, footprint.definition.references.length],
      "premise: the copied sketch sits on a construction plane without references",
    ).toEqual(["construction", 0]);
    const sketchId = await session.commitSketch({
      label: "Unrelated",
      plane: footprint.plane,
      definition: footprint.definition,
    });
    const committed = await session.snapshot();
    expect(
      committed.document.sketches.find((sketch) => sketch.sketchId === sketchId)
        ?.sketch.regions.length,
      "premise: the committed sketch has regions to mesh",
    ).toBeGreaterThan(0);
    const exported = await session.exported();
    expect(
      exported.historyOrder.at(-1),
      "premise: the sketch is the history tail",
    ).toEqual({ kind: "sketch", sketchId });

    expect(
      await restoreAndSnapshot(session, exported),
      "restoring the publication of a reference-free sketch evaluates and meshes nothing",
    ).toEqual({ runs: 0, bodies: [], regionFaces: 0 });
    await expectColdEquivalent(session, exported, "published sketch", "exact");
  } finally {
    session.adapter.dispose();
  }
}, 900_000);

/** Literal or expression extrude depths edited before each model's tail. */
const midHistoryParameterEdits: Record<string, TailParameterEdit> = {
  bracket: {
    featureId: "feature_extrude-6" as FeatureId,
    edit: (definition) => {
      const parameters = definition.parameters as unknown as {
        extent: { end: { distance: { value: number } } };
      };
      parameters.extent.end.distance.value = 3.5;
      return definition;
    },
  },
  wheel: {
    featureId: "feature_extrude-21" as FeatureId,
    edit: (definition) => {
      const parameters = definition.parameters as unknown as {
        extent: { end: { distance: { value: number } } };
      };
      parameters.extent.end.distance.value = 3;
      return definition;
    },
  },
  enclosure: {
    featureId: "feature_extrude-19" as FeatureId,
    edit: (definition) => {
      const parameters = definition.parameters as unknown as {
        extent: { end: { distance: { valueText: string } } };
      };
      parameters.extent.end.distance.valueText = "screwLength - 1";
      return definition;
    },
  },
};

// A forward edit evaluates against the session's previous references, so its
// checkpoints hold invalidations a cold open never has.
test.each(Object.keys(midHistoryParameterEdits))(
  "a restore after forward edits on the landing %s keeps no reference invalidation a cold open lacks (cadara-jxe3)",
  async (model) => {
    const session = await open(await loadLandingModel(model));
    try {
      await editFeature(midHistoryParameterEdits[model]!)(
        session,
        await session.exported(),
      );
      const afterMidEditExport = await session.exported();
      await editFeature(tailParameterEdits[model]!)(
        session,
        afterMidEditExport,
      );
      expect(
        (await session.snapshot()).document.references.some(
          (reference) => reference.invalidation !== null,
        ),
        "premise: the forward edits invalidated references",
      ).toBe(true);

      await session.restore(afterMidEditExport);
      await expectColdEquivalent(
        session,
        afterMidEditExport,
        "undo of the tail edit",
        "exact",
      );
    } finally {
      session.adapter.dispose();
    }
  },
  900_000,
);

// A peer's body rename reaches this session as a restore of the peer's
// document. Every checkpoint after the feature that made the body holds it, so
// the restore must take the checkpoints with the new label rather than replay
// the history (on the enclosure, 9 s per peer rename).
test.each(Object.keys(tailParameterEdits))(
  "a restore that renames a body on the landing %s runs no feature and equals a cold open (cadara-dx2k.4)",
  async (model) => {
    const session = await open(await loadLandingModel(model));
    try {
      await session.snapshot();
      const opened = await session.exported();
      const renamed = opened.bodyLabels[0]!;
      expect(
        appliedFeatureIds(opened).length,
        "premise: features after the body's own hold it",
      ).toBeGreaterThan(1);
      const peer: AuthoredModelDocument = {
        ...opened,
        bodyLabels: opened.bodyLabels.map((label) =>
          label.bodyId === renamed.bodyId
            ? { ...label, label: `${label.label} (peer)` }
            : label,
        ),
      };
      const restored = await restoreAndSnapshot(session, peer);
      expect
        .soft(restored, "a peer's body rename evaluates and meshes nothing")
        .toEqual({ runs: 0, bodies: [], regionFaces: 0 });
      await expectColdEquivalent(session, peer, "peer body rename", "exact");

      const undone = await restoreAndSnapshot(session, opened);
      expect
        .soft(
          undone,
          "restoring the previous label evaluates and meshes nothing",
        )
        .toEqual({ runs: 0, bodies: [], regionFaces: 0 });
      await expectColdEquivalent(
        session,
        opened,
        "undo of the rename",
        "exact",
      );
    } finally {
      session.adapter.dispose();
    }
  },
  900_000,
);

// A sketch on a face reads upstream geometry, so a restore re-solves it when
// anything that geometry depends on changed. Body labels feed neither its
// placement nor its projections: a peer's rename of the supporting body must
// keep the sketch record, and with it every checkpoint after it.
test("a restore that renames the body under a face sketch re-solves no sketch and runs no feature (cadara-dx2k.4)", async () => {
  const { document, faceSketchId } = await enclosureWithTopFaceSketch();
  const session = await open(document);
  try {
    await session.snapshot();
    const opened = await session.exported();
    const support = opened.sketches.find(
      (sketch) => sketch.sketchId === faceSketchId,
    )!.plane.support;
    expect(support.kind, "premise: the sketch sits on a face").toBe("face");
    const bodyId = (support as { bodyId: string }).bodyId;
    expect(
      opened.bodyLabels.some((label) => label.bodyId === bodyId),
      "premise: the supporting body has a stored label",
    ).toBe(true);
    const peer: AuthoredModelDocument = {
      ...opened,
      bodyLabels: opened.bodyLabels.map((label) =>
        label.bodyId === bodyId
          ? { ...label, label: `${label.label} (peer)` }
          : label,
      ),
    };
    const sketchSolves = vi.spyOn(
      session.adapter as unknown as {
        rebuildAuthoredSketchRecord: (...args: unknown[]) => unknown;
      },
      "rebuildAuthoredSketchRecord",
    );
    const restored = await restoreAndSnapshot(session, peer);
    expect
      .soft(
        { ...restored, sketchSolves: sketchSolves.mock.calls.length },
        "a peer's rename of the supporting body re-solves and evaluates nothing",
      )
      .toEqual({ runs: 0, bodies: [], regionFaces: 0, sketchSolves: 0 });
    sketchSolves.mockRestore();
    await expectColdEquivalent(
      session,
      peer,
      "peer rename of the supporting body",
      "exact",
    );
  } finally {
    session.adapter.dispose();
  }
}, 900_000);

/** Counts the sketch records a restore of `session` solves again. */
const spyOnSketchRebuilds = (session: Session) =>
  vi.spyOn(
    session.adapter as unknown as {
      rebuildAuthoredSketchRecord: (...args: never[]) => Promise<unknown>;
    },
    "rebuildAuthoredSketchRecord",
  );

/**
 * Opens the landing enclosure and commits a copy of its footprint sketch on
 * the highest horizontal face of the evaluated model, at the history tail
 * (Finish Sketch of a new face sketch).
 */
async function enclosureSessionWithTailFaceSketch() {
  const source = await loadLandingModel("enclosure");
  const session = await open(source);
  const faces = (await session.snapshot()).document.render.records.flatMap(
    ({ binding, geometry }) => {
      if (binding.target.kind !== "face" || geometry.kind !== "mesh") {
        return [];
      }
      const z = geometry.vertexPositions[0]![2];
      return geometry.vertexPositions.every(
        (position) => Math.abs(position[2] - z) < 1e-9,
      )
        ? [{ support: binding.target, z }]
        : [];
    },
  );
  const top = faces.reduce((highest, face) =>
    face.z > highest.z ? face : highest,
  );
  const footprint = source.sketches[0]!;
  const sketchId = await session.commitSketch({
    label: "On top",
    plane: {
      support: top.support as Extract<
        AuthoredModelDocument["sketches"][number]["plane"]["support"],
        { kind: "face" }
      >,
      frame: { ...footprint.plane.frame, origin: [0, 0, top.z] },
      key: null,
    },
    definition: footprint.definition,
  });
  return { session, sketchId };
}

// Finish Sketch of a face sketch publishes it and restores the committed
// document. The commit registers its record with the inputs that restore
// reads, so the restore neither re-solves it nor evaluates the history the
// re-solve projects against (on the enclosure, 11 s per Finish Sketch).
test("a restore of the session's own export after a new face sketch at the tail evaluates, re-solves and meshes nothing (cadara-dx2k.5)", async () => {
  const { session, sketchId } = await enclosureSessionWithTailFaceSketch();
  try {
    const exported = await session.exported();
    const sketch = exported.sketches.find(
      (entry) => entry.sketchId === sketchId,
    )!;
    expect(
      [
        sketch.plane.support.kind,
        exported.historyOrder.at(-1),
        exported.cursor,
      ],
      "premise: the face sketch is the history tail and the cursor",
    ).toEqual([
      "face",
      { kind: "sketch", sketchId },
      { kind: "sketch", sketchId },
    ]);
    expect(
      (await session.snapshot()).document.sketches.find(
        (entry) => entry.sketchId === sketchId,
      )?.sketch.regions.length,
      "premise: the committed sketch has regions to mesh",
    ).toBeGreaterThan(0);

    const sketchRebuilds = spyOnSketchRebuilds(session);
    expect(
      {
        ...(await restoreAndSnapshot(session, exported)),
        sketchRebuilds: sketchRebuilds.mock.calls.length,
      },
      "restoring the publication of a face sketch evaluates, re-solves and meshes nothing",
    ).toEqual({ runs: 0, bodies: [], regionFaces: 0, sketchRebuilds: 0 });
    sketchRebuilds.mockRestore();
    await expectColdEquivalent(session, exported, "published sketch", "exact");
  } finally {
    session.adapter.dispose();
  }
}, 900_000);

// A restore that must re-solve a face sketch (Undo/Redo or a peer's write of
// a feature before it) evaluates the projection history it places the sketch
// against. That projection resumes from the live runtime's checkpoints like
// the rebuild does, so each runs only the changed tail (on the wheel, a face
// sketch made every Undo of a depth edit replay the whole history).
test("a restore that re-solves a face sketch after a tail parameter edit runs only the tail and equals a cold open (cadara-dx2k.5)", async () => {
  const { session, sketchId } = await enclosureSessionWithTailFaceSketch();
  try {
    const exported = await session.exported();
    const tailEdit = tailParameterEdits.enclosure!;
    const applied = appliedFeatureIds(exported);
    const tailRuns = applied.length - applied.indexOf(tailEdit.featureId);
    expect(
      [tailRuns, exported.historyOrder.at(-1)],
      "premise: the edited feature is the last one before the face sketch",
    ).toEqual([1, { kind: "sketch", sketchId }]);
    const restore = async (document: AuthoredModelDocument) => {
      const sketchRebuilds = spyOnSketchRebuilds(session);
      featureRuns.count = 0;
      try {
        await session.restore(document);
        return {
          runs: featureRuns.count,
          sketchRebuilds: sketchRebuilds.mock.calls.length,
        };
      } finally {
        sketchRebuilds.mockRestore();
      }
    };
    // The projection and the rebuild each run the tail once.
    const tailOnly = { runs: 2 * tailRuns, sketchRebuilds: 1 };

    const peer = withEditedFeature(exported, tailEdit);
    expect
      .soft(
        await restore(peer),
        "a peer's tail edit re-solves the face sketch and runs only the tail",
      )
      .toEqual(tailOnly);
    await expectColdEquivalent(session, peer, "peer tail edit", "exact");

    expect
      .soft(
        await restore(exported),
        "undo of the tail edit re-solves the face sketch and runs only the tail",
      )
      .toEqual(tailOnly);
    await expectColdEquivalent(session, exported, "undo", "exact");
  } finally {
    session.adapter.dispose();
  }
}, 900_000);
