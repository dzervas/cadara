// cadara-3sq.6. Logic lane, heavy tier (docs/testing.md): the production OCC
// adapter's complete-open checkpoint on the shipped kernel build. A second
// adapter (another session document id) adopts the checkpoint the first one
// published without running a single feature, and from then on behaves exactly
// like the cold one: snapshots, exports, an earlier-feature edit with
// downstream rebuild, a new tail feature, a body rename. A corrupt entry or an
// edited document never yields cached geometry.
import { readFile, writeFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";

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
import type { BodyId, DocumentId, FeatureId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import type {
  ModelCheckpoint,
  ModelCheckpointEvent,
  ModelCheckpointStore,
} from "@/domain/modeling/model-checkpoint-store";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";

function memoryStore(compatibility = "test-build") {
  const entries = new Map<string, ModelCheckpoint>();
  const events: ModelCheckpointEvent[] = [];
  const store: ModelCheckpointStore = {
    compatibility: async () => compatibility,
    async read(key) {
      const entry = entries.get(key);
      if (!entry) store.report({ kind: "miss", key, reason: "absent" });
      return entry ? structuredClone(entry) : null;
    },
    async publish(key, checkpoint) {
      entries.set(key, structuredClone(checkpoint));
      store.report({
        kind: "published",
        key,
        bytes: checkpoint.brep.length + checkpoint.graph.length,
      });
    },
    report: (event) => events.push(event),
  };
  return { store, entries, events };
}

let occ: Promise<OpenCascadeInstance> | null = null;
async function open(
  source: AuthoredModelDocument,
  documentId: string,
  store: ModelCheckpointStore,
) {
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
  const document = {
    ...structuredClone(source),
    documentId: documentId as DocumentId,
  };
  const adapter = new OpenCascadeKernelAdapter({
    documentId: document.documentId,
    getOpenCascadeInstance: () => instance,
    modelCheckpoints: store,
    createSolverAdapter: (revisionId) =>
      new SketchConstraintSolverAdapter({
        revisionId,
        documentId: document.documentId,
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
      }),
  });
  featureRuns.count = 0;
  await adapter.validateAuthoredModelDocument(document);
  const runs = featureRuns.count;
  const request = {
    contractVersion: CONTRACT_VERSION,
    documentId: document.documentId,
  } as const;
  const snapshot = async () =>
    (await adapter.getDocumentSnapshot(request)).snapshot;
  const base = async () => ({
    ...request,
    baseRevisionId: (await snapshot()).document.revisionId,
  });
  return {
    adapter,
    runs,
    snapshot,
    exported: () => adapter.exportAuthoredModelDocument(document.documentId),
    async createFeature(definition: FeatureDefinition) {
      return (await adapter.createFeature({ ...(await base()), definition }))
        .revisionState.kind;
    },
    async suppress(featureId: FeatureId, suppressed: boolean) {
      return (
        await adapter.setFeatureSuppression({
          ...(await base()),
          featureId,
          suppressed,
        })
      ).revisionState.kind;
    },
    async rename(bodyId: BodyId, bodyLabel: string) {
      return (
        await adapter.renameBody({ ...(await base()), bodyId, bodyLabel })
      ).revisionState.kind;
    },
  };
}

/** Everything a caller can observe, independent of the session document id. */
function observed(snapshot: WorkspaceSnapshot, documentId: string) {
  return JSON.stringify(snapshot).replaceAll(documentId, "doc");
}
function exported(document: AuthoredModelDocument) {
  return JSON.stringify({ ...document, documentId: "doc" });
}

async function load(name: string) {
  return JSON.parse(
    await readFile(
      new URL(
        `../../../landing/examples/${name}/model.cadara`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;
}

// Optional evidence (per-step render-record diffs and timings), written before
// the strict asserts when CADARA_MODEL_CHECKPOINT_EVIDENCE names a file.
const EVIDENCE_PATH = process.env.CADARA_MODEL_CHECKPOINT_EVIDENCE;
const evidence: Record<string, unknown>[] = [];
async function expectSame(
  cold: Awaited<ReturnType<typeof open>>,
  warm: Awaited<ReturnType<typeof open>>,
  step: string,
) {
  const a = JSON.parse(
    observed(await cold.snapshot(), "doc_cold"),
  ) as WorkspaceSnapshot;
  const b = JSON.parse(
    observed(await warm.snapshot(), "doc_warm"),
  ) as WorkspaceSnapshot;
  const records = (s: WorkspaceSnapshot) =>
    s.document.render.records.map((r) => JSON.stringify(r));
  const ra = records(a),
    rb = records(b);
  const strip = (s: WorkspaceSnapshot) =>
    JSON.stringify({ ...s, document: { ...s.document, render: null } });
  evidence.push({
    step,
    renderRecords: ra.length,
    renderDiffs:
      ra.filter((r, i) => r !== rb[i]).length + Math.abs(ra.length - rb.length),
    nonRenderEqual: strip(a) === strip(b),
    exportEqual:
      exported(await warm.exported()) === exported(await cold.exported()),
  });
  if (EVIDENCE_PATH)
    await writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 1));
  expect(observed(await warm.snapshot(), "doc_warm"), `${step}: snapshot`).toBe(
    observed(await cold.snapshot(), "doc_cold"),
  );
  expect(exported(await warm.exported()), `${step}: authored export`).toBe(
    exported(await cold.exported()),
  );
}

for (const name of ["bracket", "wheel", "enclosure"]) {
  test(`a hydrated ${name} checkpoint runs no feature and edits exactly like the cold open`, async () => {
    const source = await load(name);
    const { store, entries, events } = memoryStore();
    const coldStart = performance.now();
    const cold = await open(source, "doc_cold", store);
    evidence.push({
      name,
      coldOpenPlusPublishMs: performance.now() - coldStart,
    });
    expect(cold.runs, "premise: a cold open runs features").toBeGreaterThan(0);
    expect(events.map((event) => event.kind)).toEqual(["miss", "published"]);
    expect(entries.size).toBe(1);

    const warmStart = performance.now();
    const warm = await open(source, "doc_warm", store);
    evidence.push({
      name,
      warmOpenMs: performance.now() - warmStart,
      warmFeatureRuns: warm.runs,
      entryCharacters: [...entries.values()].map(
        (e) => e.brep.length + e.graph.length,
      ),
    });
    expect(events.slice(2).map((event) => event.kind)).toEqual(["hit"]);
    expect(warm.runs, "a hit replays no feature history").toBe(0);
    await expectSame(cold, warm, "open");

    // Directly on the fresh hydrate (cadara-3sq.7): tail-append, then rename.
    // A new tail feature gets the same id, labels and topology as cold.
    const body = (await cold.snapshot()).document.bodies[0]!;
    const chamfer = {
      featureTypeVersion: "advanced-solid-feature/v0",
      kind: "chamfer",
      parameters: {
        options: {
          distance: { source: "literal", value: 0.2 },
          widthForm: { source: "literal", value: "equalOffsets" },
        },
        participants: [
          {
            role: "edge",
            targets: body.topology.edgeIds
              .slice(0, 2)
              .map((edgeId) => ({ kind: "edge", bodyId: body.bodyId, edgeId })),
          },
        ],
      },
    } as unknown as FeatureDefinition;
    expect(await warm.createFeature(chamfer)).toBe(
      await cold.createFeature(chamfer),
    );
    const lastExtrude = [...source.features]
      .reverse()
      .find((feature) => feature.definition.kind === "extrude")!;
    expect(await warm.createFeature(lastExtrude.definition)).toBe("accepted");
    expect(await cold.createFeature(lastExtrude.definition)).toBe("accepted");
    await expectSame(cold, warm, "new features");
    const features = (await warm.exported()).featureOrder;
    expect(new Set(features).size, "no feature id collides").toBe(
      features.length,
    );

    expect(await warm.rename(body.bodyId, "Renamed")).toBe("accepted");
    expect(await cold.rename(body.bodyId, "Renamed")).toBe("accepted");
    await expectSame(cold, warm, "rename");
    // A substantive edit to an earlier feature rebuilds everything downstream.
    const earlier = source.featureOrder[1] as FeatureId;
    expect(await warm.suppress(earlier, true)).toBe(
      await cold.suppress(earlier, true),
    );
    await expectSame(cold, warm, "suppress an earlier feature");
    expect(await warm.suppress(earlier, false)).toBe(
      await cold.suppress(earlier, false),
    );
    await expectSame(cold, warm, "restore the earlier feature");

    cold.adapter.dispose();
    warm.adapter.dispose();
  }, 1_800_000);
}

test("a corrupt entry and an edited document are cold opens, never cached geometry", async () => {
  const source = await load("bracket");
  const { store, entries, events } = memoryStore();
  const cold = await open(source, "doc_cold", store);
  const [key, entry] = [...entries][0]!;

  // A valid-looking entry whose state graph lost a field.
  const graph = JSON.parse(entry.graph) as { o: [string, unknown][] };
  entries.set(key, {
    ...entry,
    graph: JSON.stringify({ o: graph.o.slice(1) }),
  });
  const corrupt = await open(source, "doc_warm", store);
  expect(events.at(-2)).toMatchObject({ kind: "degraded", key });
  expect(
    corrupt.runs,
    "the degraded open rebuilt from the document",
  ).toBeGreaterThan(0);
  await expectSame(cold, corrupt, "degraded open");
  corrupt.adapter.dispose();

  // Geometry that no longer matches its records.
  entries.set(key, {
    ...entry,
    brep: entry.brep.slice(0, entry.brep.length / 2),
  });
  const truncated = await open(source, "doc_warm", store);
  expect(
    events.some(
      (event) =>
        event.kind === "degraded" &&
        event.reason.includes("occ-checkpoint-invalid"),
    ),
  ).toBe(true);
  expect(truncated.runs).toBeGreaterThan(0);
  truncated.adapter.dispose();

  // Binary data that is not base64 (atob's DOMException) is a degraded open.
  entries.set(key, {
    ...entry,
    graph: JSON.stringify({
      o: [...graph.o, ["extra", { t: "Uint8Array", b: "not base64!" }]],
    }),
  });
  const malformed = await open(source, "doc_warm", store);
  expect(events.at(-2)).toMatchObject({
    kind: "degraded",
    key,
    reason: expect.stringMatching(/malformed base64/),
  });
  expect(malformed.runs).toBeGreaterThan(0);
  await expectSame(cold, malformed, "malformed binary open");
  malformed.adapter.dispose();
  entries.set(key, entry);

  // Same file name, same ids, one changed depth: another key, new geometry.
  const edited = structuredClone(source);
  const extrude = edited.features.find(
    (feature) => feature.featureId === "feature_extrude-1",
  )!;
  const end = (
    extrude.definition.parameters as {
      extent: { end: { distance: { source: string; value?: number } } };
    }
  ).extent.end;
  expect(end.distance.source).toBe("literal");
  end.distance.value = end.distance.value! + 1;
  const before = entries.size;
  const changed = await open(edited, "doc_warm", store);
  expect(changed.runs).toBeGreaterThan(0);
  expect(entries.size, "the edit published its own entry").toBe(before + 1);
  expect(
    JSON.stringify((await changed.snapshot()).document.bodies[0]!.topology) ===
      JSON.stringify((await cold.snapshot()).document.bodies[0]!.topology) &&
      observed(await changed.snapshot(), "doc_warm") ===
        observed(await cold.snapshot(), "doc_cold"),
    "the edited document's geometry differs",
  ).toBe(false);
  changed.adapter.dispose();

  // The edited document's complete, self-consistent entry stored under the
  // original document's key is refused: it is another document's state.
  const editedEntry = [...entries].find(([entryKey]) => entryKey !== key)![1];
  entries.set(key, editedEntry);
  const swapped = await open(source, "doc_warm", store);
  expect(events.at(-2)).toMatchObject({
    kind: "degraded",
    key,
    reason: expect.stringMatching(/another document \(features differ\)/),
  });
  expect(
    swapped.runs,
    "the refused open rebuilt from the document",
  ).toBeGreaterThan(0);
  await expectSame(cold, swapped, "foreign entry open");
  swapped.adapter.dispose();
  entries.set(key, entry);

  // Another build's checkpoint is never consulted.
  const other = memoryStore("other-build");
  for (const [entryKey, value] of entries) other.entries.set(entryKey, value);
  const otherBuild = await open(source, "doc_warm", other.store);
  expect(other.events[0]).toMatchObject({ kind: "miss" });
  expect(otherBuild.runs).toBeGreaterThan(0);
  otherBuild.adapter.dispose();
  cold.adapter.dispose();
}, 1_800_000);
