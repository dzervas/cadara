import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { ImportHistoryProbeCapabilities } from "@/contracts/import/capabilities";
import type { ResolvedImportSource } from "@/contracts/import/source";
import type { DocumentId, RevisionId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import { createKernelHistoryProbeSession } from "@/domain/import/kernel-history-probe";
import { onshapeImportProvider } from "@/domain/import/onshape/provider";
import { importedOnshapeSketchEntityId } from "@/domain/import/onshape/sketch-translator";
import {
  applyImportPreparedActions,
  createImportCapabilities,
  prepareImportActions,
} from "@/domain/import/orchestrator";
import { createMemoryGeometryAssetStore } from "@/domain/modeling/geometry-asset-store";
import { createModelingService } from "@/domain/modeling/modeling-service";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { createGeometryAssetComposition } from "@/infrastructure/modeling/browser-geometry-asset-store";

// Lane: logic (docs/testing.md — importer review/prepare/apply through the real
// OCC adapter and the real kernel history probe, without browser behavior).
// Seam: a split-interface sketch plane names its tool side face by the
// source-authored profile entity id, so every review probe, the tool lineage
// key, the Split alias and the committed sketch support agree exactly.
//
// Runtime/reuse policy: one real OCC runtime per file; the tracked 9841 capture
// is trimmed to its first 19 features (through Sketch 4), the smallest prefix
// containing the Split target chain and both split-interface consumers. The
// review+apply takes about a minute on real OCC; 900 s is an explicit upper
// bound for this real integration only. Every probe session and the workspace
// service are disposed in `finally`. The complete 9841 gate lives unchanged in
// apply-pipeline.spec.ts.
const CAPTURE_9841 =
  "test/fixtures/onshape-captures/9841e486906fa2ce62d74d8e.onshape-capture.json";
const LAST_PREFIX_FEATURE_ID = "FivzS12g1EqHZEy_1"; // Sketch 4

type CustomOpenCascade = new (module: Record<string, unknown>) => Promise<OpenCascadeInstance>;

let realOcc: Promise<OpenCascadeInstance> | null = null;
function loadRealOcc() {
  realOcc ??= (async () => {
    const module = (await import("../../../../public/cadara-occ.js")) as {
      default: CustomOpenCascade;
    };
    const wasmBinary = new Uint8Array(
      await readFile(new URL("../../../../public/cadara-occ.wasm", import.meta.url)),
    );
    return new module.default({ wasmBinary });
  })();
  return realOcc;
}

async function readPrefixBundle() {
  const bundle = JSON.parse(await readFile(CAPTURE_9841, "utf8"));
  const studio = bundle.partStudios[0];
  const lastIndex = studio.features.features.findIndex(
    (feature: { featureId: string }) => feature.featureId === LAST_PREFIX_FEATURE_ID,
  );
  studio.features.features = studio.features.features.slice(0, lastIndex + 1);
  const kept = new Set(
    studio.features.features.map((feature: { featureId: string }) => feature.featureId),
  );
  studio.rollbackSnapshots = studio.rollbackSnapshots.filter(
    (snapshot: { featureId: string }) => kept.has(snapshot.featureId),
  );
  return bundle as {
    partStudios: [{ features: { features: { featureId: string; name: string }[] } }];
  };
}

function sourceFromBundle(bundle: unknown): ResolvedImportSource {
  return {
    name: "9841-split-interface-prefix.onshape-capture.json",
    origin: { kind: "localFile", fileName: "9841-split-interface-prefix.onshape-capture.json" },
    mediaType: "application/json",
    bytes: new TextEncoder().encode(JSON.stringify(bundle)),
    fingerprint: `sha256:${"5".repeat(64)}`,
  };
}

test.skipIf(!existsSync(CAPTURE_9841))(
  "9841 Sketch 3/4 bind their own authored Cutter entity's split-interface face through review and apply",
  async () => {
    const bundle = await readPrefixBundle();
    const featureId = (label: string) =>
      bundle.partStudios[0].features.features.find((feature) => feature.name === label)!.featureId;
    const cutterFeatureId = featureId("Cutter");
    const expectedEntity = {
      "Sketch 3": importedOnshapeSketchEntityId(cutterFeatureId, "ZFNETMCD9zyJ.0"),
      "Sketch 4": importedOnshapeSketchEntityId(cutterFeatureId, "ZFNETMCD9zyJ.1"),
    } as const;

    const oc = await loadRealOcc();
    const { assetStore, resolver } = createGeometryAssetComposition(createMemoryGeometryAssetStore());
    const createService = (documentId: DocumentId) => {
      const createSolver = (revisionId: RevisionId | null) =>
        new SketchConstraintSolverAdapter({
          neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
          documentId,
          revisionId,
        });
      const adapter = new OpenCascadeKernelAdapter({
        createSolverAdapter: createSolver,
        getOpenCascadeInstance: async () => oc,
        documentId,
        assetResolver: resolver,
      });
      return {
        adapter,
        service: createModelingService(adapter, {
          currentDocumentId: documentId,
          sketchSolver: createSolver(null),
        }),
      };
    };
    let probeOrdinal = 0;
    const probeFailures: unknown[] = [];
    const recordingHistory = () => {
      const session = createKernelHistoryProbeSession({
        createService: () =>
          createService(`doc_split_interface_probe_${++probeOrdinal}` as DocumentId).service,
      });
      const history: ImportHistoryProbeCapabilities = {
        async evaluateHistoryProbe(input) {
          try {
            const result = await session.evaluateHistoryProbe(input);
            result.steps.forEach((step, ordinal) => {
              if (step.status === "failed") probeFailures.push({ ordinal, diagnostics: step.diagnostics });
            });
            return result;
          } catch (error) {
            probeFailures.push({ thrown: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        },
        dispose: () => session.dispose?.(),
      };
      return history;
    };
    const reviewHistory = recordingHistory();
    const prepareHistory = recordingHistory();
    const workspaceDocumentId = "doc_split_interface_workspace" as DocumentId;
    const workspace = createService(workspaceDocumentId);

    try {
      const before = await workspace.service.getCurrentDocumentSnapshot();
      const source = sourceFromBundle(bundle);
      const review = await onshapeImportProvider.review({
        source,
        capabilities: createImportCapabilities(workspace.service, before, {
          assetStore,
          history: reviewHistory,
        }),
      });
      const actions = await prepareImportActions({
        provider: onshapeImportProvider,
        source,
        review,
        selections: onshapeImportProvider.createDefaultSelections(review),
        capabilities: createImportCapabilities(workspace.service, before, {
          assetStore,
          history: prepareHistory,
        }),
      });
      expect(probeFailures, "No review or prepare history probe step may fail.").toEqual([]);

      const commit = (label: string) =>
        actions.commitSketches?.find((request) => request.sketchLabel === label);
      expect(
        commit("Cutter")?.definition.entities.map((entity) => entity.entityId),
        "Cutter must emit both authored profile entities.",
      ).toEqual(expect.arrayContaining(Object.values(expectedEntity)));
      for (const label of ["Sketch 3", "Sketch 4"] as const) {
        expect(
          commit(label)?.plane.support,
          `${label} must name its own authored Cutter entity.`,
        ).toMatchObject({ kind: "splitInterfaceFaceOf", profileEntityId: expectedEntity[label] });
      }

      const applied = await applyImportPreparedActions({
        modelingService: workspace.service,
        baseRevisionId: before.document.revisionId,
        actions,
      });
      expect(
        applied.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
        "Every prefix action must commit through real OCC apply.",
      ).toEqual([]);
      expect(applied.rolledBack).toBe(false);

      const committed = (await workspace.service.getCurrentDocumentSnapshot()).document;
      const cutterSketchId = committed.sketches.find((sketch) => sketch.label === "Cutter")!.sketchId;
      const extrude4Id = committed.features.find((feature) => feature.label === "Extrude 4")!.featureId;
      const split1Id = committed.features.find((feature) => feature.label === "Split 1")!.featureId;
      const lineage =
        (await workspace.adapter.exportAuthoredModelDocument(workspaceDocumentId)).topologyLineage ?? [];
      const facesClaimedBy = (lineageFeatureId: string, sourceKey: string) =>
        lineage
          .filter((entry) => entry.featureId === lineageFeatureId)
          .flatMap((entry) => entry.outputs)
          .flatMap((output) => output.sourceTargets)
          .filter((entry) => entry.sourceKey === sourceKey)
          .flatMap((entry) => entry.targets)
          .filter((target): target is Extract<DurableRef, { kind: "face" }> => target.kind === "face");

      const aliasFaces = new Map<string, Extract<DurableRef, { kind: "face" }>>();
      for (const label of ["Sketch 3", "Sketch 4"] as const) {
        const toolKey = `extrude:${extrude4Id}:profile-sketch:${cutterSketchId}:end:one-side-end:sketch-entity:${cutterSketchId}:${expectedEntity[label]}:generated-side-face`;
        const toolFaces = facesClaimedBy(extrude4Id, toolKey);
        expect(toolFaces, `${toolKey} must resolve exactly one tool face.`).toHaveLength(1);
        const aliasKey = `sheet-split-tool-successor:${split1Id}:${toolFaces[0]!.bodyId}:face:${toolFaces[0]!.faceId}`;
        const outputFaces = facesClaimedBy(split1Id, aliasKey);
        expect(outputFaces, `${aliasKey} must resolve exactly one output face.`).toHaveLength(1);
        aliasFaces.set(label, outputFaces[0]!);
        expect(
          committed.sketches.find((sketch) => sketch.label === label)?.plane.support,
          `${label} must commit on the exact Split alias of its own entity's tool face.`,
        ).toEqual(outputFaces[0]);
      }
      expect(aliasFaces.get("Sketch 3")).not.toEqual(aliasFaces.get("Sketch 4"));
    } finally {
      await reviewHistory.dispose?.();
      await prepareHistory.dispose?.();
      workspace.service.dispose();
    }
  },
  900_000,
);
