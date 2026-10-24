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
// Cold opens and rebuilds are not a fixed point on topology tokens (each
// evaluation re-mints fallback ids `…_t0019_1` -> `…_t0020_1`, see the
// body-rename heavy spec) and stamp their revision; comparisons normalize
// both. Invalidated references depend on session history and are excluded.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";

// Counts feature executions without retaining their (large) arguments.
const featureRuns = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/domain/modeling/occ/features", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/domain/modeling/occ/features")>();
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

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type {
  FeatureDefinition,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import type {
  DocumentVariableId,
  FeatureId,
  PreviewId,
  SketchId,
} from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import type { OccTrackedBody } from "@/domain/modeling/occ/topology";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

let occ: Promise<OpenCascadeInstance> | null = null;
/** A production OCC adapter holding `document`. */
async function open(document: AuthoredModelDocument) {
  occ ??= (async () => {
    const module =
      (await import("../../../public/cadara-occ.js")) as unknown as {
        default: new (
          module: Record<string, unknown>,
        ) => Promise<OpenCascadeInstance>;
      };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );
    return new module.default({ wasmBinary });
  })();
  const instance = occ;
  const adapter = new OpenCascadeKernelAdapter({
    documentId: document.documentId,
    getOpenCascadeInstance: () => instance,
    createSolverAdapter: (revisionId) =>
      new SketchConstraintSolverAdapter({
        revisionId,
        documentId: document.documentId,
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
      }),
  });
  await adapter.restoreAuthoredModelDocument(document);
  const request = {
    contractVersion: CONTRACT_VERSION,
    documentId: document.documentId,
  } as const;
  const snapshot = async () =>
    (await adapter.getDocumentSnapshot(request)).snapshot;
  const mutation = async () => ({
    ...request,
    baseRevisionId: (await snapshot()).document.revisionId,
  });
  const accepted = (
    response: { revisionState: { kind: string } },
    what: string,
  ) => expect(response.revisionState.kind, what).toBe("accepted");
  return {
    adapter,
    snapshot,
    exported: () => adapter.exportAuthoredModelDocument(document.documentId),
    async setCursor(cursor: AuthoredModelDocument["cursor"]) {
      accepted(
        await adapter.setFeatureCursor({ ...(await mutation()), cursor }),
        "cursor set",
      );
    },
    async create(definition: FeatureDefinition) {
      const response = await adapter.createFeature({
        ...(await mutation()),
        definition,
      });
      accepted(response, "feature created");
      return response.featureId;
    },
    async deleteFeature(featureId: FeatureId) {
      accepted(
        await adapter.deleteTarget({
          ...(await mutation()),
          target: { kind: "feature", featureId },
        }),
        "feature deleted",
      );
    },
    async update(featureId: FeatureId, definition: FeatureDefinition) {
      accepted(
        await adapter.updateFeature({
          ...(await mutation()),
          featureId,
          definition,
        }),
        "feature updated",
      );
    },
    async addVariable(name: string, valueText: string) {
      const response = await adapter.addDocumentVariable({
        ...(await mutation()),
        name,
        valueText,
      });
      accepted(response, "variable added");
      return response.variableId;
    },
    async setVariable(
      variableId: DocumentVariableId,
      name: string,
      valueText: string,
    ) {
      accepted(
        await adapter.updateDocumentVariable({
          ...(await mutation()),
          variableId,
          name,
          valueText,
        }),
        "variable updated",
      );
    },
    async removeVariable(variableId: DocumentVariableId) {
      accepted(
        await adapter.removeDocumentVariable({
          ...(await mutation()),
          variableId,
        }),
        "variable removed",
      );
    },
    async preview(
      definition: FeatureDefinition,
      replacesFeatureId: FeatureId | null,
    ) {
      return adapter.evaluatePreview({
        ...(await mutation()),
        previewId: "preview_afj3" as PreviewId,
        replacesFeatureId,
        definition,
      });
    },
  };
}

type Session = Awaited<ReturnType<typeof open>>;

/** Live bodies of the adapter's runtime state (premise checks only). */
const runtimeBodies = (session: Session) =>
  (
    session.adapter as unknown as {
      runtimeState: { authoringState: { bodies: readonly OccTrackedBody[] } };
    }
  ).runtimeState.authoringState.bodies;

const normalize = (text: string) =>
  text
    .replace(/rev_\d+/g, "rev")
    .replace(/_t\d+_(\d+)/g, "_t_$1")
    .replace(/"t\d+"/g, '"t"');
const sorted = (values: readonly unknown[]) =>
  values.map((value) => JSON.stringify(value)).sort();

/** The evaluated model: bodies, objects, features, entities, live references,
 * diagnostics, and a digest of every render record's geometry. */
function evaluatedModel(snapshot: WorkspaceSnapshot) {
  const value = JSON.parse(
    normalize(
      JSON.stringify({
        ...snapshot,
        document: { ...snapshot.document, render: null },
      }),
    ),
  ) as WorkspaceSnapshot;
  return {
    bodies: value.document.bodies,
    objects: value.presentation.objects,
    featureTree: value.presentation.featureTree,
    features: value.document.features,
    entities: sorted(value.document.entities),
    references: sorted(
      value.document.references.filter(
        (reference) => reference.invalidation === null,
      ),
    ),
    diagnostics: value.document.diagnostics,
    geometry: snapshot.document.render.records
      .map(
        ({ geometry, ...record }) =>
          `${normalize(JSON.stringify(record))} ${createHash("sha256")
            .update(JSON.stringify(geometry))
            .digest("hex")}`,
      )
      .sort(),
  };
}

/** A preview's diagnostics and a digest of every render record's geometry. */
const previewModel = (preview: Awaited<ReturnType<Session["preview"]>>) => ({
  diagnostics: JSON.parse(
    normalize(JSON.stringify(preview.diagnostics)),
  ) as unknown,
  geometry: preview.render.records
    .map(
      ({ geometry, ...record }) =>
        `${normalize(JSON.stringify(record))} ${createHash("sha256")
          .update(JSON.stringify(geometry))
          .digest("hex")}`,
    )
    .sort(),
});

const authored = (document: AuthoredModelDocument) =>
  JSON.parse(normalize(JSON.stringify(document))) as AuthoredModelDocument;

/**
 * Drops what a session deliberately keeps for features behind the cursor and a
 * cold open of the rolled-back document cannot know: their produced targets
 * and keyed lineage from their last evaluation ("unapplied, not forgotten",
 * tryBuildNextAuthoringState). Main differs from a cold open there too.
 */
function withoutRetainedEvaluation<
  T extends {
    features?: unknown;
    topologyLineage?: readonly { featureId: FeatureId }[];
  },
>(value: T, unapplied: ReadonlySet<FeatureId>): T {
  const features = value.features as
    | { featureId: FeatureId; producedTargets?: unknown }[]
    | undefined;
  return {
    ...value,
    features: features?.map((feature) =>
      unapplied.has(feature.featureId)
        ? { ...feature, producedTargets: null }
        : feature,
    ),
    topologyLineage: value.topologyLineage?.filter(
      (record) => !unapplied.has(record.featureId),
    ),
  };
}

/**
 * Asserts the session equals a cold open of `expected` (the edited document
 * built from the previous export, not from the session): the evaluated model
 * and the authored export, keyed topology lineage included.
 */
async function expectColdEquivalent(
  session: Session,
  expected: AuthoredModelDocument,
  step: string,
) {
  const unapplied = new Set(
    expected.featureOrder.filter(
      (featureId) => !appliedFeatureIds(expected).includes(featureId),
    ),
  );
  const cold = await open(expected);
  try {
    expect(
      withoutRetainedEvaluation(
        evaluatedModel(await session.snapshot()),
        unapplied,
      ),
      `${step}: the session evaluates the same model as a cold open`,
    ).toEqual(
      withoutRetainedEvaluation(
        evaluatedModel(await cold.snapshot()),
        unapplied,
      ),
    );
    expect(
      withoutRetainedEvaluation(authored(await session.exported()), unapplied),
      `${step}: and exports the same authored document and lineage`,
    ).toEqual(
      withoutRetainedEvaluation(authored(await cold.exported()), unapplied),
    );
  } finally {
    cold.adapter.dispose();
  }
}

const appliedFeatureIds = (document: AuthoredModelDocument) => {
  const cursor = document.cursor;
  const end = document.historyOrder.findIndex((item) =>
    cursor.kind === "feature"
      ? item.kind === "feature" && item.featureId === cursor.featureId
      : cursor.kind === "sketch" &&
        item.kind === "sketch" &&
        item.sketchId === cursor.sketchId,
  );
  return document.historyOrder
    .slice(0, end + 1)
    .flatMap((item) => (item.kind === "feature" ? [item.featureId] : []));
};

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

/** Edits a literal parameter of `featureId`; only it and its suffix rerun. */
const editFeature =
  (
    featureId: FeatureId,
    edit: (definition: FeatureDefinition) => FeatureDefinition,
  ): TailEdit =>
  async (session, document) => {
    const features = document.features.map((feature) =>
      feature.featureId === featureId
        ? { ...feature, definition: edit(structuredClone(feature.definition)) }
        : feature,
    );
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

const models: Record<string, TailEdit> = {
  bracket: editFeature("feature_chamfer-1" as FeatureId, (definition) => {
    const parameters = definition.parameters as unknown as {
      options: { distance: { value: number } };
    };
    parameters.options.distance.value = 0.5;
    return definition;
  }),
  wheel: editFeature("feature_extrude-29" as FeatureId, (definition) => {
    const parameters = definition.parameters as unknown as {
      extent: { end: { distance: { value: number } } };
    };
    parameters.extent.end.distance.value = 0.3;
    return definition;
  }),
  // A depth given by a document-variable expression.
  enclosure: editFeature("feature_extrude-21" as FeatureId, (definition) => {
    const parameters = definition.parameters as unknown as {
      extent: { end: { distance: { valueText: string } } };
    };
    parameters.extent.end.distance.valueText = "screwHeadHeight + 0.5";
    return definition;
  }),
};

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
      expect(featureRuns.count, "rolling to the end runs only the tail").toBe(
        1,
      );
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

test("a document variable edit restores a face sketch that follows the first item it changes, and resumes the prefix when the face sketch precedes it (cadara-afj3)", async () => {
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

  // An empty sketch on that face right after the base feature; nothing
  // consumes it, so only its placement depends on upstream geometry.
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
