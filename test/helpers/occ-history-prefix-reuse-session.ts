// Session, model-comparison and history helpers shared by the history
// prefix-reuse heavy spec (cadara-di5/afj3/jxe3/vjcv/zs79): a production OCC
// adapter session over a document, and "equals a cold open" comparisons with
// normalized or exact topology tokens. Counting spies live in the spec, next
// to the vi.mock calls that install them.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type {
  FeatureDefinition,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import type {
  DocumentVariableId,
  FeatureId,
  PreviewId,
} from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import type { OccTrackedBody } from "@/infrastructure/occ/topology";
import { OpenCascadeKernelAdapter } from "@/infrastructure/occ/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";
import {
  createTopologyIdCorrespondence,
  renameTopologyIds,
} from "./topology-id-correspondence";

let occ: Promise<OpenCascadeInstance> | null = null;
/** The production OCC instance the sessions share (loaded by the first `open`). */
export const occInstance = () => occ!;
/** A production OCC adapter holding `document`. */
export async function open(document: AuthoredModelDocument) {
  occ ??= (async () => {
    const module = (await import("../../public/cadara-occ.js")) as unknown as {
      default: new (
        module: Record<string, unknown>,
      ) => Promise<OpenCascadeInstance>;
    };
    const wasmBinary = new Uint8Array(
      await readFile(new URL("../../public/cadara-occ.wasm", import.meta.url)),
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
    restore: (restored: AuthoredModelDocument) =>
      adapter.restoreAuthoredModelDocument(restored),
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
    async commitSketch(
      sketch: Pick<
        AuthoredModelDocument["sketches"][number],
        "label" | "plane" | "definition"
      >,
    ) {
      const response = await adapter.commitSketch({
        ...(await mutation()),
        solverCorrelation: null,
        sketchId: null,
        sketchLabel: sketch.label,
        plane: structuredClone(sketch.plane),
        definition: structuredClone(sketch.definition),
      });
      accepted(response, "sketch committed");
      return response.sketchId;
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

export type Session = Awaited<ReturnType<typeof open>>;

/** Features whose unapplied stage keeps its checkpoint (cadara-vjcv). */
export const keptTailCheckpoints = (session: Session) =>
  [
    ...(
      session.adapter as unknown as {
        runtimeState: {
          authoringState: {
            previousFeatureTopologyStages: ReadonlyMap<
              FeatureId,
              { checkpoint?: unknown }
            >;
          };
        };
      }
    ).runtimeState.authoringState.previousFeatureTopologyStages,
  ].flatMap(([featureId, stage]) => (stage.checkpoint ? [featureId] : []));

/** Live bodies of the adapter's runtime state (premise checks only). */
export const runtimeBodies = (session: Session) =>
  (
    session.adapter as unknown as {
      runtimeState: { authoringState: { bodies: readonly OccTrackedBody[] } };
    }
  ).runtimeState.authoringState.bodies;

/** Topology tokens are normalized unless `tokens` is "exact" (restores). */
export type TokenComparison = "normalized" | "exact";
export const normalize = (
  text: string,
  tokens: TokenComparison = "normalized",
) =>
  tokens === "exact"
    ? text.replace(/rev_\d+/g, "rev")
    : text
        .replace(/rev_\d+/g, "rev")
        .replace(/_t\d+_(\d+)/g, "_t_$1")
        .replace(/"t\d+"/g, '"t"');
export const sorted = (values: readonly unknown[]) =>
  values.map((value) => JSON.stringify(value)).sort();

/** The evaluated model: bodies, objects, features, entities, live references
 * (and invalidated ones too when `tokens` is "exact"), diagnostics, and a
 * digest of every render record's geometry. `rename` maps topology ids first. */
export function evaluatedModel(
  snapshot: WorkspaceSnapshot,
  tokens: TokenComparison = "normalized",
  rename: (text: string) => string = (text) => text,
) {
  const value = JSON.parse(
    normalize(
      rename(
        JSON.stringify({
          ...snapshot,
          document: { ...snapshot.document, render: null },
        }),
      ),
      tokens,
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
        (reference) => tokens === "exact" || reference.invalidation === null,
      ),
    ),
    diagnostics: value.document.diagnostics,
    geometry: snapshot.document.render.records
      .map(
        ({ geometry, ...record }) =>
          `${normalize(rename(JSON.stringify(record)), tokens)} ${createHash(
            "sha256",
          )
            .update(JSON.stringify(geometry))
            .digest("hex")}`,
      )
      .sort(),
  };
}

/** The evaluated model with exact topology tokens and only live references:
 * invalidated ones depend on session history. */
export const shownModel = (snapshot: WorkspaceSnapshot) => {
  const model = evaluatedModel(snapshot, "exact");
  return {
    ...model,
    references: model.references.filter((reference) =>
      reference.includes('"invalidation":null'),
    ),
  };
};

/** A preview's diagnostics and a digest of every render record's geometry. */
export const previewModel = (
  preview: Awaited<ReturnType<Session["preview"]>>,
) => ({
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

export const authored = (
  document: AuthoredModelDocument,
  tokens: TokenComparison = "normalized",
  rename: (text: string) => string = (text) => text,
) =>
  JSON.parse(
    normalize(rename(JSON.stringify(document)), tokens),
  ) as AuthoredModelDocument;

/**
 * Drops what a session deliberately keeps for features behind the cursor and a
 * cold open of the rolled-back document cannot know: their produced targets
 * and keyed lineage from their last evaluation ("unapplied, not forgotten",
 * tryBuildNextAuthoringState). Main differs from a cold open there too.
 */
export function withoutRetainedEvaluation<
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
export async function expectColdEquivalent(
  session: Session,
  expected: AuthoredModelDocument,
  step: string,
  tokens: TokenComparison = "normalized",
) {
  const unapplied = new Set(
    expected.featureOrder.filter(
      (featureId) => !appliedFeatureIds(expected).includes(featureId),
    ),
  );
  const cold = await open(expected);
  try {
    const live = {
      snapshot: await session.snapshot(),
      document: withoutRetainedEvaluation(await session.exported(), unapplied),
    };
    const reference = {
      snapshot: await cold.snapshot(),
      document: withoutRetainedEvaluation(await cold.exported(), unapplied),
    };
    // Exact comparisons keep the id form; normalized ones accept either valid
    // form at each position, paired one to one per position.
    const correspondence =
      tokens === "exact"
        ? new Map<string, string>()
        : createTopologyIdCorrespondence(live, reference);
    const rename = (text: string) => renameTopologyIds(text, correspondence);
    expect(
      withoutRetainedEvaluation(
        evaluatedModel(live.snapshot, tokens, rename),
        unapplied,
      ),
      `${step}: the session evaluates the same model as a cold open`,
    ).toEqual(
      withoutRetainedEvaluation(
        evaluatedModel(reference.snapshot, tokens),
        unapplied,
      ),
    );
    expect(
      authored(live.document, tokens, rename),
      `${step}: and exports the same authored document and lineage`,
    ).toEqual(authored(reference.document, tokens));
  } finally {
    cold.adapter.dispose();
  }
}

export const appliedFeatureIds = (document: AuthoredModelDocument) => {
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
