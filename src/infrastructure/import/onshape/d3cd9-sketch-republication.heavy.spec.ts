// Logic lane, heavy tier (docs/testing.md): the modeling service over the
// production OCC adapter and a memory document repository, on the d3cd9
// Onshape capture imported through the real pipeline (the bench's "large"
// fixture). Editing Sketch 1 rolls the cursor back to it, Publish restores
// that rolled-back document, and Exit rolls back to the end. Split 1's sheet
// faces keep their ids only through the persisted topology lineage, so a
// restore that dropped the lineage of the features behind its cursor re-minted
// them: Extrude 8 lost its face, and the second publish could not place
// Sketch 7 on its split face ("Document refresh failed", empty model).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import { MemoryDocumentRepository } from "@/application/modeling/memory-document-repository";
import { createModelingService } from "@/application/modeling/modeling-service";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";
import type { ResolvedImportSource } from "@/contracts/import/source";
import { createAuthoredModelDocumentFromSnapshot } from "@/contracts/modeling/authored-document";
import type { DocumentId, RevisionId } from "@/contracts/shared/ids";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { createKernelHistoryProbeSession } from "@/infrastructure/import/kernel-history-probe";
import { onshapeImportProvider } from "@/infrastructure/import/onshape/provider";
import {
  applyImportPreparedActions,
  createImportCapabilities,
  prepareImportActions,
} from "@/infrastructure/import/orchestrator";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import { OpenCascadeKernelAdapter } from "@/infrastructure/occ/opencascade-kernel-adapter";

const D3_CAPTURE_FIXTURE =
  "test/fixtures/onshape-captures/d3cd9b09c3c36af1dd2efae9.onshape-capture.json";
// Sketch 1's 15 mm line distance: the bench's sketchDimensionEdit row.
const DIMENSION_ID = "dimension_FBrqEbXvoH3uWWX_0_SNKtOGpImmby";

let occ: Promise<OpenCascadeInstance> | null = null;
function loadOcc() {
  occ ??= (async () => {
    const module =
      (await import("../../../../public/cadara-occ.js")) as unknown as {
        default: new (
          module: Record<string, unknown>,
        ) => Promise<OpenCascadeInstance>;
      };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );
    return new module.default({ wasmBinary });
  })();
  return occ;
}

function createOccService(
  documentId: DocumentId,
  repository?: MemoryDocumentRepository,
) {
  const createSolver = (revisionId: RevisionId | null) =>
    new SketchConstraintSolverAdapter({
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
      documentId,
      revisionId,
    });
  return createModelingService(
    new OpenCascadeKernelAdapter({
      documentId,
      createSolverAdapter: createSolver,
      getOpenCascadeInstance: loadOcc,
    }),
    {
      currentDocumentId: documentId,
      sketchSolver: createSolver(null),
      ...(repository ? { documentRepository: repository } : {}),
    },
  );
}

/** Imports the d3cd9 Part Studio into `service` as the workbench commits it. */
async function importD3cd9(service: ReturnType<typeof createOccService>) {
  const bundle = JSON.parse(await readFile(D3_CAPTURE_FIXTURE, "utf8"));
  const source: ResolvedImportSource = {
    name: "d3cd9.onshape-capture.json",
    origin: { kind: "localFile", fileName: "d3cd9.onshape-capture.json" },
    mediaType: "application/json",
    bytes: new TextEncoder().encode(JSON.stringify(bundle)),
    fingerprint: `sha256:${"d".repeat(64)}`,
  };
  let probeOrdinal = 0;
  const history = () =>
    createKernelHistoryProbeSession({
      createService: () => {
        probeOrdinal += 1;
        return createOccService(
          `doc_occ_history_probe_${probeOrdinal}` as DocumentId,
        );
      },
    });
  const before = await service.getCurrentDocumentSnapshot();
  const review = await onshapeImportProvider.review({
    source,
    capabilities: createImportCapabilities(service, before, {
      history: history(),
    }),
  });
  const actions = await prepareImportActions({
    provider: onshapeImportProvider,
    source,
    review,
    selections: onshapeImportProvider.createDefaultSelections(review),
    capabilities: createImportCapabilities(service, before, {
      history: history(),
    }),
  });
  const applied = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: before.document.revisionId,
    actions,
  });
  expect(applied.rolledBack, "premise: the import applies").toBe(false);
}

test.skipIf(!existsSync(D3_CAPTURE_FIXTURE))(
  "publishing d3cd9 Sketch 1 twice from a rolled-back cursor rebuilds every split body and keeps the face sketches placed",
  { timeout: 900_000 },
  async () => {
    const service = createOccService(
      "doc_workspace" as DocumentId,
      new MemoryDocumentRepository(),
    );
    try {
      await importD3cd9(service);
      const start = await service.getCurrentDocumentSnapshot();
      const bodyIds = start.document.bodies.map((body) => body.bodyId).sort();
      expect(
        bodyIds.filter((bodyId) => bodyId.includes("_sheet_split_")),
        "premise: Split 1 publishes sheet-split bodies",
      ).not.toEqual([]);
      expect(start.document.diagnostics, "premise").toEqual([]);
      const startDocument = createAuthoredModelDocumentFromSnapshot(start);
      const end = startDocument.cursor;
      const faceSketchSupports = startDocument.sketches.flatMap((sketch) =>
        sketch.plane.support.kind === "face" ? [sketch.plane.support] : [],
      );
      expect(
        faceSketchSupports.some((support) =>
          support.bodyId.includes("_sheet_split_"),
        ),
        "premise: a face sketch sits on a split body",
      ).toBe(true);

      for (const [step, valueText] of [
        ["first publish", "16.5"],
        ["second publish, back to the original", "15"],
      ] as const) {
        const before = createAuthoredModelDocumentFromSnapshot(
          await service.getCurrentDocumentSnapshot(),
        );
        const sketch = before.sketches.find(
          (entry) => entry.label === "Sketch 1",
        )!;
        const rolledBack = await service.setFeatureCursor({
          baseRevisionId: before.revisionId,
          cursor: { kind: "sketch", sketchId: sketch.sketchId },
        });
        if (rolledBack.isErr()) throw rolledBack.error;
        const definition = structuredClone(sketch.definition);
        const dimension = definition.dimensions.find(
          (entry) => entry.dimensionId === DIMENSION_ID,
        );
        if (dimension?.kind !== "lineDistance")
          throw new Error(`Expected the ${DIMENSION_ID} line distance.`);
        dimension.value = { source: "expression", valueText };
        const published = await service.commitSketch({
          baseRevisionId: rolledBack.value.revisionId,
          sketchId: sketch.sketchId,
          sketchLabel: sketch.label,
          plane: sketch.plane,
          definition,
          solverCorrelation: {
            requestId: "request_republish",
            projectionRequestId: "request_republish:project",
            validationRequestId: "request_republish:validate",
            solveRequestId: "request_republish:solve",
            regionRequestId: "request_republish:regions",
          },
          publicationBase: {
            actionContextId: sketch.sketchId,
            expectedSketch: sketch,
          },
        });
        if (published.isErr()) throw published.error;
        expect(published.value.revisionState.kind, step).toBe("accepted");
        expect(
          published.value.diagnostics,
          `${step}: the document refresh after the publication succeeds`,
        ).toEqual([]);
        const rolledToEnd = await service.setFeatureCursor({
          baseRevisionId: published.value.revisionId,
          cursor: end,
        });
        if (rolledToEnd.isErr()) throw rolledToEnd.error;
        const after = await service.getCurrentDocumentSnapshot();
        expect(
          after.document.bodies.map((body) => body.bodyId).sort(),
          `${step}: every body rebuilds`,
        ).toEqual(bodyIds);
        expect(
          after.document.diagnostics,
          `${step}: every feature keeps its references`,
        ).toEqual([]);
        expect(
          createAuthoredModelDocumentFromSnapshot(after).sketches.flatMap(
            (entry) =>
              entry.plane.support.kind === "face" ? [entry.plane.support] : [],
          ),
          `${step}: the face sketches keep their supports`,
        ).toEqual(faceSketchSupports);
      }
    } finally {
      service.dispose();
    }
  },
);
