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
} from "@/infrastructure/persistence/model-checkpoint-store";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import { OpenCascadeKernelAdapter } from "@/infrastructure/occ/opencascade-kernel-adapter";
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

/**
 * How a session opens the document: an import's validation (CLI), the
 * repository's initial load in the browser worker (a stored-document restore
 * whose checkpoint is published after its first snapshot), or an ordinary
 * restore without a store (the open before cadara-dx2k.6).
 */
type OpenEntry = "validate" | "openStoredDocument" | "plainRestore";

let occ: Promise<OpenCascadeInstance> | null = null;
async function open(
  source: AuthoredModelDocument,
  documentId: string,
  store: ModelCheckpointStore,
  entry: OpenEntry = "validate",
  { publishAfterSnapshot = true } = {},
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
    modelCheckpoints: entry === "plainRestore" ? undefined : store,
    modelCheckpointPublication:
      entry === "openStoredDocument" ? "deferred" : "inline",
    createSolverAdapter: (revisionId) =>
      new SketchConstraintSolverAdapter({
        revisionId,
        documentId: document.documentId,
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
      }),
  });
  const request = {
    contractVersion: CONTRACT_VERSION,
    documentId: document.documentId,
  } as const;
  featureRuns.count = 0;
  if (entry === "validate") {
    await adapter.validateAuthoredModelDocument(document);
  } else {
    await adapter.restoreAuthoredModelDocument(document, [], undefined, {
      openStoredDocument: entry === "openStoredDocument",
    });
  }
  const runs = featureRuns.count;
  if (entry === "openStoredDocument" && publishAfterSnapshot) {
    // The worker's order: the open's snapshot is answered, then the
    // checkpoint is published.
    await adapter.getDocumentSnapshot(request);
    await adapter.publishPendingModelCheckpoint();
  }
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

const OPEN_ROWS = (["validate", "openStoredDocument"] as const).flatMap(
  (entry) =>
    ["bracket", "wheel", "enclosure"].map((name) => ({
      entry,
      name,
      // cadara-dx2k.6: openStoredDocument is the browser's reload of a
      // repository document.
      title:
        entry === "validate"
          ? "checkpoint"
          : "stored-document open's checkpoint",
    })),
);

for (const { entry, name, title } of OPEN_ROWS) {
  test(`a hydrated ${name} ${title} runs no feature and edits exactly like the cold open`, async () => {
    const source = await load(name);
    const { store, entries, events } = memoryStore();
    const coldStart = performance.now();
    const cold = await open(source, "doc_cold", store, entry);
    evidence.push({
      name,
      entry,
      coldOpenPlusPublishMs: performance.now() - coldStart,
    });
    expect(cold.runs, "premise: a cold open runs features").toBeGreaterThan(0);
    expect(events.map((event) => event.kind)).toEqual(["miss", "published"]);
    expect(entries.size).toBe(1);
    if (entry === "openStoredDocument") {
      // Caching changes nothing about the first open.
      const plain = await open(source, "doc_warm", store, "plainRestore");
      await expectSame(cold, plain, "first open");
      plain.adapter.dispose();
    }

    const warmStart = performance.now();
    const warm = await open(source, "doc_warm", store, entry);
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

test("a stored-document open's checkpoint is not published once a change replaced its state", async () => {
  const source = await load("bracket");
  const { store, entries, events } = memoryStore();
  const cold = await open(source, "doc_cold", store, "openStoredDocument", {
    publishAfterSnapshot: false,
  });
  const body = (await cold.snapshot()).document.bodies[0]!;
  expect(await cold.rename(body.bodyId, "Renamed")).toBe("accepted");
  await cold.adapter.publishPendingModelCheckpoint();
  expect(entries.size, "only the open's own evaluation is cached").toBe(0);
  expect(events.at(-1)).toEqual({
    kind: "bypass",
    reason: "superseded-before-publication",
  });
  cold.adapter.dispose();
}, 1_800_000);

test("a reloaded document whose features are listed in repository key order adopts its checkpoint", async () => {
  // The repository stores features as a map keyed by featureId: a reloaded
  // document lists them in key order, not in featureOrder.
  const source = await load("bracket");
  source.features.sort((left, right) =>
    left.featureId < right.featureId ? -1 : 1,
  );
  expect(
    source.features.map((feature) => feature.featureId),
    "premise: key order differs from featureOrder",
  ).not.toEqual(source.featureOrder);
  const { store, events } = memoryStore();
  const cold = await open(source, "doc_cold", store, "openStoredDocument");
  expect(events.map((event) => event.kind)).toEqual(["miss", "published"]);
  const warm = await open(source, "doc_warm", store, "openStoredDocument");
  expect(events.slice(2).map((event) => event.kind)).toEqual(["hit"]);
  expect(warm.runs, "a hit replays no feature history").toBe(0);
  await expectSame(cold, warm, "open");
  cold.adapter.dispose();
  warm.adapter.dispose();
}, 1_800_000);

// cadara-dx2k.15: a stored-document open publishes the display payloads its
// first snapshot built, so the reload's first snapshot meshes no body. A
// stored payload binds to its body by id and topology token only; one that
// matches no body or does not decode is reported and that body is meshed.
async function countMeshBuilds<T>(action: () => Promise<T>) {
  const host = (await occ!) as unknown as {
    CadaraNativeTopologyMeshBuffers: { Build: (...args: unknown[]) => unknown };
  };
  const build = host.CadaraNativeTopologyMeshBuffers.Build;
  let builds = 0;
  host.CadaraNativeTopologyMeshBuffers.Build = (...args) => {
    builds += 1;
    return build(...args);
  };
  try {
    const result = await action();
    return { result, builds };
  } finally {
    host.CadaraNativeTopologyMeshBuffers.Build = build;
  }
}

for (const name of ["bracket", "wheel", "enclosure"]) {
  test(`a reloaded ${name}'s first snapshot reads its stored display payloads and equals the cold one`, async () => {
    const source = await load(name);
    const { store, entries, events } = memoryStore();
    const cold = await open(source, "doc_cold", store, "openStoredDocument");
    const [entry] = [...entries.values()];
    const payloads = entry!.nativeTopologyPayloads ?? [];
    const coldBodies = (await cold.snapshot()).document.bodies;
    expect(payloads.map((record) => record.bodyId).sort()).toEqual(
      coldBodies.map((body) => body.bodyId).sort(),
    );
    evidence.push({
      name,
      displayPayloadTiers: [...new Set(payloads.map((r) => r.lodTierId))],
      displayPayloadBytes: payloads.reduce(
        (sum, r) =>
          sum +
          r.payload.length +
          r.positions.byteLength +
          r.triangleIndices.byteLength,
        0,
      ),
      checkpointCharacters: entry!.brep.length + entry!.graph.length,
    });

    const { result: warm, builds } = await countMeshBuilds(() =>
      open(source, "doc_warm", store, "openStoredDocument"),
    );
    expect(events.slice(2).map((event) => event.kind)).toEqual(["hit"]);
    expect(builds, "the first snapshot meshes no body").toBe(0);
    await expectSame(cold, warm, "open");
    warm.adapter.dispose();

    // A payload whose token names another topology, and one whose mesh is
    // truncated, are never shown: those bodies are meshed again.
    const [first, second] = payloads;
    entries.set([...entries.keys()][0]!, {
      ...entry!,
      nativeTopologyPayloads: [
        { ...first!, topologyToken: `${first!.topologyToken}-other` },
        ...(second
          ? [{ ...second, positions: second.positions.subarray(3) }]
          : []),
        ...payloads.slice(2),
      ],
    });
    const { result: fallback, builds: rebuilt } = await countMeshBuilds(() =>
      open(source, "doc_warm", store, "openStoredDocument"),
    );
    expect(rebuilt).toBe(second ? 2 : 1);
    expect(events.filter((event) => event.kind === "degraded").length).toBe(
      second ? 2 : 1,
    );
    await expectSame(cold, fallback, "open with refused display payloads");
    fallback.adapter.dispose();
    cold.adapter.dispose();
  }, 1_800_000);
}
