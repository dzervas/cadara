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
import type { FeatureId } from "@/contracts/shared/ids";
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
) => Promise<{ expected: AuthoredModelDocument; reruns: number }>;

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
      const { expected, reruns } = await tailEdit(session, beforeEdit);
      expect(
        reruns,
        "premise: the edit leaves an unchanged prefix",
      ).toBeLessThan(applied.length);
      expect(featureRuns.count, "an edit reruns only the changed suffix").toBe(
        reruns,
      );
      await expectColdEquivalent(session, expected, "edit");
    } finally {
      session.adapter.dispose();
    }
  },
  900_000,
);
