import { test, expect } from "vitest";

import { validateOnshapeCaptureBundle } from "@/contracts/import/onshape-capture-bundle";

import { captureBundle, enrichBundleHistoryEvidence } from "@/cli/commands/onshape-capture/capture";
import { OnshapeRequestError } from "@/cli/commands/onshape-capture/client";
import { parseDocumentUrl } from "@/cli/commands/onshape-capture/url";
import { captureGroundTruth } from "@/cli/commands/onshape-capture/ground-truth";
import {
  buildDefaultRoutes,
  createFixtureFetch,
  createFixtureRuntime,
  FIXTURE_DOCUMENT_ID,
  FIXTURE_DOCUMENT_URL,
  FIXTURE_EMPTY_STUDIO_ID,
  FIXTURE_ELEMENT_URL,
  FIXTURE_MICROVERSION,
  FEATURES_WITH_REFERENCES,
  FIXTURE_PART_STUDIO_ID,
  FIXTURE_TEMP_WORKSPACE_ID,
  type FetchResponseStub,
} from "@/cli/commands/onshape-capture/fixtures/transcript";

const CREDENTIALS = { accessKey: "access", secretKey: "secret" };

function featuresWithSurfaceExtrude(): typeof FEATURES_WITH_REFERENCES {
  const features = structuredClone(FEATURES_WITH_REFERENCES) as {
    features: Array<Record<string, unknown>>;
  };
  features.features.push(
    { featureType: "fillet", featureId: "F_ORDINARY", parameters: [] },
    {
      featureType: "extrude",
      featureId: "F_SURFACE",
      parameters: [{ parameterId: "bodyType", value: "SURFACE" }],
    },
  );
  return features as typeof FEATURES_WITH_REFERENCES;
}

function featuresWithOpaqueProfile(): typeof FEATURES_WITH_REFERENCES {
  const features = structuredClone(FEATURES_WITH_REFERENCES) as {
    features: Array<Record<string, unknown>>;
  };
  features.features.push({
    featureType: "extrude",
    featureId: "E_OPAQUE",
    parameters: [{
      parameterId: "entities",
      queries: [{
        deterministicIds: [],
        queryString: 'query = qCompressed(1.0, "opaque-profile", id);',
      }],
    }],
  });
  return features as typeof FEATURES_WITH_REFERENCES;
}

function immutableBundleSections(bundle: Awaited<ReturnType<typeof captureBundle>>) {
  return {
    provenance: bundle.provenance,
    document: bundle.document,
    elements: bundle.elements,
    diagnostics: bundle.diagnostics,
    partStudios: bundle.partStudios.map(({
      resolvedReferences: _resolvedReferences,
      resolvedQueryReferences: _resolvedQueryReferences,
      immutableHistoryEvidenceSchemaVersion: _historySchema,
      immutableHistoryEvidenceManifest: _historyManifest,
      profileEvidence: _profileEvidence,
      profileEvidenceSchemaVersion: _profileSchema,
      profileEvidenceManifest: _profileManifest,
      ...immutable
    }) => immutable),
  };
}

function featuresWithIdlessChamfer(queryString: string): typeof FEATURES_WITH_REFERENCES {
  const features = structuredClone(FEATURES_WITH_REFERENCES) as {
    features: Array<Record<string, unknown>>;
  };
  features.features.push({
    btType: "BTMFeature-134",
    featureType: "chamfer",
    featureId: "FqXExmahcCNDI8A_1",
    name: "Chamfer 1",
    parameters: [{
      btType: "BTMParameterQueryList-148",
      parameterId: "entities",
      queries: [{
        btType: "BTMIndividualQuery-138",
        deterministicIds: [],
        queryString,
      }],
    }],
  });
  return features as typeof FEATURES_WITH_REFERENCES;
}

test("capture.spec.ts full capture happy path produces a valid bundle", async () => {
  const { fetch } = createFixtureFetch();
  const ref = parseDocumentUrl(FIXTURE_DOCUMENT_URL);

  const bundle = await captureBundle(ref, CREDENTIALS, createFixtureRuntime(fetch));

  expect(
    validateOnshapeCaptureBundle(bundle).success,
    "A full happy-path capture should validate against the envelope schema.",
  ).toBeTruthy();
  expect(
    bundle.partStudios.length,
    "Both Part Studios (not the assembly) should be captured.",
  ).toBe(2);
  expect(bundle.provenance.microversion).toBe(FIXTURE_MICROVERSION);
  expect(bundle.provenance.documentId).toBe(FIXTURE_DOCUMENT_ID);

  const mounts = bundle.partStudios.find(
    (studio) => studio.elementId === FIXTURE_PART_STUDIO_ID,
  );
  expect(mounts?.groundTruth).toEqual({
    hasBodies: true,
    omittedReason: "no-final-bake-boundary",
  });
  expect(mounts?.featureSpecs.present).toBe(true);
  expect(bundle.formatVersion).toBe(2);
  expect(bundle.diagnostics).toEqual([]);
  const profileEvidence = mounts?.profileEvidence;
  expect(
    profileEvidence,
    "Readable qSketchRegion assignments preserve their local region-set semantics.",
  ).toEqual([{
    consumingFeatureId: "FG094ehBlsq34dl_0",
    parameterId: "entities",
    queryIndex: 0,
    evaluatedAt: "historyPoint",
    kind: "sketchRegionSet",
    sourceSketchFeatureId: "FOoap8tw3jKAJf5_0",
    filterInnerLoops: true,
  }]);
  expect(mounts?.profileEvidenceManifest).toEqual([{
    consumingFeatureId: "FG094ehBlsq34dl_0",
    parameterId: "entities",
    queryIndex: 0,
    sourceQueryString: 'query = qSketchRegion(id + "FOoap8tw3jKAJf5_0", true);',
    kind: "sketchRegionSet",
    emittedRecordCount: 1,
    completed: true,
  }]);
});


test("capture.spec.ts keeps readable qSketchRegion evidence local without a profile witness call", async () => {
  const { fetch, calls } = createFixtureFetch();
  await captureBundle(
    parseDocumentUrl(FIXTURE_DOCUMENT_URL),
    CREDENTIALS,
    createFixtureRuntime(fetch),
  );
  expect(calls.filter((call) => call.body?.includes("profileQuery0"))).toHaveLength(0);
});

test("capture.spec.ts element-scoped capture keeps one studio but full element list", async () => {
  const { fetch } = createFixtureFetch();
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);

  const bundle = await captureBundle(ref, CREDENTIALS, createFixtureRuntime(fetch));

  expect(bundle.partStudios).toHaveLength(1);
  expect(bundle.partStudios[0]!.elementId).toBe(FIXTURE_PART_STUDIO_ID);
  expect(
    Array.isArray(bundle.elements) ? (bundle.elements as unknown[]).length : 0,
    "The element list should still record every element for provenance.",
  ).toBe(3);
});

test("capture.spec.ts records final-state and history-point deterministic reference results", async () => {
  const { fetch, calls } = createFixtureFetch();
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);

  const bundle = await captureBundle(ref, CREDENTIALS, createFixtureRuntime(fetch));
  const references = bundle.partStudios[0]!.resolvedReferences;

  expect(
    references.map((reference) => `${reference.deterministicId}:${reference.evaluatedAt}`).sort(),
    "Every deterministic-ID consumer should retain final evidence and receive its own history-point record.",
  ).toEqual([
    "JDC:finalState",
    "JDC:historyPoint",
    "JGC:finalState",
    "JGC:historyPoint",
    "ZZZ:finalState",
    "ZZZ:historyPoint",
  ]);

  const finalUnresolved = references.find(
    (reference) => reference.deterministicId === "ZZZ" && reference.evaluatedAt === "finalState",
  );
  expect(finalUnresolved && "unresolved" in finalUnresolved).toBeTruthy();

  const historyResolved = references.find(
    (reference) => reference.deterministicId === "ZZZ" && reference.evaluatedAt === "historyPoint",
  );
  expect(historyResolved && "signature" in historyResolved).toBeTruthy();
  expect(
    historyResolved && "consumingFeatureId" in historyResolved
      ? historyResolved.consumingFeatureId
      : null,
  ).toBe("FkkBVfXRKopMlIW_1");
  expect(
    calls.filter((call) => call.url.includes("rollbackBarIndex=2")).length,
    "A consumer's history-point evidence should use one immutable FeatureScript request.",
  ).toBe(1);
  expect(
    calls.filter((call) => /rollbackBarIndex=[012]/.test(call.url)),
    "Distinct deterministic-ID consumer points should each be evaluated once without workspace rollback.",
  ).toHaveLength(3);
  expect(calls.filter((call) => call.url.includes("/features/rollback"))).toHaveLength(0);
  const featureRequest = calls.find(
    (call) => call.method === "GET" && call.url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/features?`),
  );
  expect(featureRequest?.url).toContain("rollbackBarIndex=-1");
  expect(featureRequest?.url).toContain("includeGeometryIds=true");
  expect(featureRequest?.url).toContain("noSketchGeometry=false");
});

test("capture.spec.ts evaluates an ID-less compressed query at its history point", async () => {
  const features = featuresWithIdlessChamfer(
    'query=qCompressed(1.0,"fixture-payload",id);',
  );
  const routes = buildDefaultRoutes();
  routes.unshift({
    method: "GET",
    match: (url) => url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/features?`),
    respond: () => ({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(features)),
    }),
  });
  const { fetch, calls } = createFixtureFetch(routes);
  const bundle = await captureBundle(
    parseDocumentUrl(FIXTURE_ELEMENT_URL),
    CREDENTIALS,
    createFixtureRuntime(fetch),
  );

  expect(bundle.partStudios[0]!.resolvedQueryReferences).toEqual([{
    consumingFeatureId: "FqXExmahcCNDI8A_1",
    parameterId: "entities",
    queryIndex: 0,
    entityIndex: 0,
    evaluatedAt: "historyPoint",
    signature: expect.objectContaining({
      entityClass: "edge",
      geometryType: "line",
      boundingBox: { low: [0, 0, 0], high: [0.01, 0, 0] },
    }),
  }]);
  expect(
    calls.filter(
      (call) =>
        call.url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/featurescript`) &&
        call.url.includes("rollbackBarIndex=3"),
    ),
    "ID-less queries at one history point should share one FeatureScript evaluation.",
  ).toHaveLength(1);
});

test("capture.spec.ts rejects non-qCompressed query strings without evaluating them", async () => {
  const features = featuresWithIdlessChamfer("query=qEverything();");
  const routes = buildDefaultRoutes();
  routes.unshift({
    method: "GET",
    match: (url) => url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/features?`),
    respond: () => ({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(features)),
    }),
  });
  const { fetch, calls } = createFixtureFetch(routes);
  const bundle = await captureBundle(
    parseDocumentUrl(FIXTURE_ELEMENT_URL),
    CREDENTIALS,
    createFixtureRuntime(fetch),
  );

  expect(bundle.partStudios[0]!.resolvedQueryReferences).toEqual([{
    consumingFeatureId: "FqXExmahcCNDI8A_1",
    parameterId: "entities",
    queryIndex: 0,
    evaluatedAt: "historyPoint",
    unresolved: { reason: "queryString is not a supported qCompressed assignment" },
  }]);
  expect(calls.some((call) => call.url.includes("rollbackBarIndex=3"))).toBe(false);
});

test("capture.spec.ts ordinary capture is immutable and does not create or mutate a workspace", async () => {
  const { fetch, calls } = createFixtureFetch();
  await captureBundle(parseDocumentUrl(FIXTURE_ELEMENT_URL), CREDENTIALS, createFixtureRuntime(fetch));

  expect(calls.filter((call) => call.url.includes("/workspaces"))).toHaveLength(0);
  expect(calls.filter((call) => call.url.includes("/features/rollback"))).toHaveLength(0);
  expect(calls.filter((call) => /\/(tessellatedfaces|translations|externaldata)\b/.test(call.url))).toHaveLength(0);
  expect(calls.filter((call) => call.url.includes("/featurescript")).every(
    (call) => call.url.includes(`/m/${FIXTURE_MICROVERSION}/`),
  )).toBe(true);
});

test("capture.spec.ts reports an undeleted rollback workspace after snapshot capture failure", async () => {
  const routes = buildDefaultRoutes();
  routes.unshift({
    method: "DELETE",
    match: (url) => url.includes(`/workspaces/${FIXTURE_TEMP_WORKSPACE_ID}`),
    respond: (): FetchResponseStub => ({
      ok: false,
      status: 403,
      text: () => Promise.resolve("delete forbidden"),
    }),
  });
  routes.unshift({
    method: "GET",
    match: (url) => url.includes(`/w/${FIXTURE_TEMP_WORKSPACE_ID}/e/${FIXTURE_PART_STUDIO_ID}/tessellatedfaces`),
    respond: (): FetchResponseStub => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve("snapshot tessellation failure"),
    }),
  });
  routes.unshift({
    method: "GET",
    match: (url) => url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/features?`),
    respond: () => ({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(featuresWithSurfaceExtrude())) }),
  });
  const { fetch } = createFixtureFetch(routes);
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);

  await expect(
    captureBundle(ref, CREDENTIALS, createFixtureRuntime(fetch)),
  ).rejects.toThrow(FIXTURE_TEMP_WORKSPACE_ID);
});

test("capture.spec.ts preserves immutable evidence and diagnoses unavailable boundary geometry on workspace 403", async () => {
  const routes = buildDefaultRoutes();
  routes.unshift({
    method: "POST",
    match: (url) => url.includes(`/documents/d/${FIXTURE_DOCUMENT_ID}/workspaces`),
    respond: (): FetchResponseStub => ({
      ok: false,
      status: 403,
      text: () => Promise.resolve("workspace rights unavailable"),
    }),
  });
  routes.unshift({
    method: "GET",
    match: (url) => url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/features?`),
    respond: () => ({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(featuresWithSurfaceExtrude())) }),
  });
  const { fetch, calls } = createFixtureFetch(routes);
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);

  const bundle = await captureBundle(
    ref,
    CREDENTIALS,
    createFixtureRuntime(fetch),
  );

  expect(bundle.diagnostics?.[0]?.code).toBe("onshape-rollback-workspace-unavailable");
  expect(bundle.partStudios[0]!.rollbackSnapshots).toBeNull();
  expect(
    bundle.partStudios[0]!.resolvedReferences.some(
      (reference) => reference.evaluatedAt === "historyPoint",
    ),
  ).toBe(true);
  expect(calls.filter((call) => call.url.includes("/features/rollback"))).toHaveLength(0);
  const beforeEnrichment = calls.length;
  const progress: string[] = [];
  const enriched = await enrichBundleHistoryEvidence(
    bundle,
    CREDENTIALS,
    { ...createFixtureRuntime(fetch), log: (message) => progress.push(message) },
  );
  expect(calls).toHaveLength(beforeEnrichment);
  expect(progress).toEqual([
    `Enrichment 1/1: ${bundle.partStudios[0]!.name} — evidence is current; no FeatureScript request.\n`,
  ]);
  expect(enriched.partStudios[0]!.rollbackSnapshots).toBeNull();
  expect(calls.some((call) => call.method === "DELETE")).toBe(false);
});

test("capture.spec.ts automatically snapshots only locally proven surface-extrude bake boundaries", async () => {
  const { fetch: ordinaryFetch, calls: ordinaryCalls } = createFixtureFetch();
  const noBoundaries = await captureBundle(
    parseDocumentUrl(FIXTURE_ELEMENT_URL),
    CREDENTIALS,
    createFixtureRuntime(ordinaryFetch),
  );
  expect(noBoundaries.partStudios[0]!.rollbackSnapshots).toEqual([]);
  expect(ordinaryCalls.filter((call) => call.url.includes("/workspaces"))).toHaveLength(0);
  expect(ordinaryCalls.filter((call) => /\/(tessellatedfaces|translations|externaldata)\b/.test(call.url))).toHaveLength(0);

  const routes = buildDefaultRoutes();
  routes.unshift({
    method: "GET",
    match: (url) => url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/features?`),
    respond: () => ({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(featuresWithSurfaceExtrude())) }),
  });
  const { fetch, calls } = createFixtureFetch(routes);
  const withSnapshots = await captureBundle(
    parseDocumentUrl(FIXTURE_ELEMENT_URL),
    CREDENTIALS,
    createFixtureRuntime(fetch),
  );

  expect(withSnapshots.partStudios[0]!.rollbackSnapshots).toEqual([
    expect.objectContaining({ featureId: "F_SURFACE", tessellationTolerance: 0.001 }),
  ]);
  expect(calls.filter((call) => call.url.includes("/features/rollback"))).toHaveLength(1);
  expect(calls.filter((call) => call.url.includes("/tessellatedfaces"))).toHaveLength(1);
  expect(calls.filter((call) => call.method === "POST" && call.url.includes("/translations"))).toHaveLength(1);
  expect(calls.filter((call) => call.method === "GET" && call.url.includes("/translations/"))).toHaveLength(1);
  expect(calls.filter((call) => call.url.includes("/externaldata/"))).toHaveLength(1);
});

test("capture.spec.ts enrichment prunes legacy snapshots without recapturing current evidence", async () => {
  const { fetch, calls } = createFixtureFetch();
  const captured = await captureBundle(
    parseDocumentUrl(FIXTURE_ELEMENT_URL), CREDENTIALS, createFixtureRuntime(fetch),
  );
  const staleSnapshots = structuredClone(captured);
  staleSnapshots.partStudios[0]!.features = featuresWithSurfaceExtrude();
  staleSnapshots.partStudios[0]!.rollbackSnapshots = [
    { featureId: "F_ORDINARY", tessellationTolerance: 0.001, tessellatedFaces: { legacy: true } },
    { featureId: "F_SURFACE", tessellationTolerance: 0.001, tessellatedFaces: { boundary: true } },
  ];
  const beforeEnrichment = calls.length;

  const enriched = await enrichBundleHistoryEvidence(
    staleSnapshots, CREDENTIALS, createFixtureRuntime(fetch),
  );

  expect(calls).toHaveLength(beforeEnrichment);
  expect(enriched.partStudios[0]!.rollbackSnapshots).toEqual([
    { featureId: "F_SURFACE", tessellationTolerance: 0.001, tessellatedFaces: { boundary: true } },
  ]);
  expect(enriched.partStudios[0]!.groundTruth).toEqual(staleSnapshots.partStudios[0]!.groundTruth);
});

test("capture.spec.ts targeted enrichment replaces complete immutable history evidence without recapturing immutable sections", async () => {
  const { fetch, calls } = createFixtureFetch();
  const captured = await captureBundle(
    parseDocumentUrl(FIXTURE_ELEMENT_URL),
    CREDENTIALS,
    createFixtureRuntime(fetch),
  );
  const stale = structuredClone(captured);
  stale.partStudios[0]!.features = featuresWithOpaqueProfile();
  stale.partStudios[0]!.profileEvidence = [];
  stale.partStudios[0]!.profileEvidenceSchemaVersion = 0;
  stale.partStudios[0]!.resolvedReferences.push({
    deterministicId: "JDC",
    consumingFeatureId: "FOoap8tw3jKAJf5_0",
    evaluatedAt: "historyPoint",
    unresolved: { reason: "stale duplicate" },
  });
  stale.partStudios[0]!.resolvedQueryReferences = [{
    consumingFeatureId: "E_OPAQUE",
    parameterId: "entities",
    queryIndex: 0,
    evaluatedAt: "historyPoint",
    unresolved: { reason: "stale query" },
  }];
  const immutableBefore = immutableBundleSections(stale);
  const finalBefore = stale.partStudios[0]!.resolvedReferences.filter(
    (record) => record.evaluatedAt === "finalState",
  );

  const beforeEnrich = calls.length;
  const progress: string[] = [];
  const enriched = await enrichBundleHistoryEvidence(
    stale,
    CREDENTIALS,
    { ...createFixtureRuntime(fetch), log: (message) => progress.push(message) },
  );
  const enrichCalls = calls.slice(beforeEnrich);
  expect(enrichCalls.filter((call) => call.url.includes("/featurescript"))).toHaveLength(4);
  expect(enrichCalls.every((call) => call.url.includes("/featurescript") && call.url.includes(`/m/${FIXTURE_MICROVERSION}/`))).toBe(true);
  expect(progress).toHaveLength(4);
  expect(progress).toEqual(expect.arrayContaining([
    `Enrichment 1/1: ${stale.partStudios[0]!.name} — requesting FeatureScript evidence #1 at rollback index 0.\n`,
  ]));
  const opaqueEvaluation = enrichCalls.find((call) => call.body?.includes("opaque-profile"));
  expect(opaqueEvaluation?.body).toContain("opaque-profile");
  expect(opaqueEvaluation?.body).not.toContain("qEverything");
  expect(opaqueEvaluation?.body).toContain("qSketchRegion(makeId(sketchFeatureId0), false)");
  expect(opaqueEvaluation?.body).not.toContain("qSketchRegion(id + sketchFeatureId0");
  expect(enriched.partStudios[0]!.resolvedReferences.filter(
    (record) => record.evaluatedAt === "historyPoint",
  )).toHaveLength(3);
  expect(enriched.partStudios[0]!.resolvedReferences.filter(
    (record) => record.deterministicId === "JDC" && record.evaluatedAt === "historyPoint",
  )).toHaveLength(1);
  expect(enriched.partStudios[0]!.resolvedReferences.filter(
    (record) => record.evaluatedAt === "finalState",
  )).toEqual(finalBefore);
  expect(enriched.partStudios[0]!.resolvedQueryReferences).toEqual([{
    consumingFeatureId: "E_OPAQUE",
    parameterId: "entities",
    queryIndex: 0,
    entityIndex: 0,
    evaluatedAt: "historyPoint",
    signature: expect.objectContaining({ entityClass: "edge" }),
  }]);
  expect(enriched.partStudios[0]!.profileEvidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "sketchRegionSet", filterInnerLoops: true }),
    expect.objectContaining({
      consumingFeatureId: "E_OPAQUE",
      kind: "sketchRegion",
      sourceSketchFeatureId: "FOoap8tw3jKAJf5_0",
      interiorPoint3d: [0.005, 0.005, 0],
    }),
  ]));
  expect(enriched.partStudios[0]!.profileEvidence).toHaveLength(2);

  expect(enriched.partStudios[0]!.profileEvidenceManifest).toEqual(expect.arrayContaining([
    expect.objectContaining({
      consumingFeatureId: "E_OPAQUE",
      sourceQueryString: 'query = qCompressed(1.0, "opaque-profile", id);',
      emittedRecordCount: 1,
      completed: true,
    }),
  ]));
  expect(enriched.partStudios[0]!.immutableHistoryEvidenceManifest).toEqual(expect.objectContaining({
    queryStringConsumers: [expect.objectContaining({
      consumingFeatureId: "E_OPAQUE",
      emittedRecordCount: 1,
      completed: true,
    })],
  }));
  expect(immutableBundleSections(enriched)).toEqual(immutableBefore);

  const beforeCurrentRerun = calls.length;
  await enrichBundleHistoryEvidence(enriched, CREDENTIALS, createFixtureRuntime(fetch));
  expect(calls).toHaveLength(beforeCurrentRerun);

  const staleMarker = structuredClone(enriched);
  staleMarker.partStudios[0]!.profileEvidenceSchemaVersion = 0;
  const beforeStaleRerun = calls.length;
  await enrichBundleHistoryEvidence(staleMarker, CREDENTIALS, createFixtureRuntime(fetch));
  expect(calls.slice(beforeStaleRerun).filter((call) => call.url.includes("/featurescript"))).toHaveLength(1);
});


test("capture.spec.ts rejects malformed FeatureScript profile evidence instead of completing its manifest", async () => {
  const { fetch } = createFixtureFetch();
  const captured = await captureBundle(
    parseDocumentUrl(FIXTURE_ELEMENT_URL), CREDENTIALS, createFixtureRuntime(fetch),
  );
  const stale = structuredClone(captured);
  stale.partStudios[0]!.features = featuresWithOpaqueProfile();
  stale.partStudios[0]!.profileEvidence = [];
  stale.partStudios[0]!.profileEvidenceSchemaVersion = 0;

  const routes = buildDefaultRoutes();
  routes.unshift({
    method: "POST",
    match: (url) => url.includes(`/m/${FIXTURE_MICROVERSION}/e/${FIXTURE_PART_STUDIO_ID}/featurescript`),
    respond: (): FetchResponseStub => ({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        btType: "BTFeatureScriptEvalResponse-1859",
        notices: [{ message: "synthetic compile failure" }],
      })),
    }),
  });
  const { fetch: malformedFetch } = createFixtureFetch(routes);

  await expect(enrichBundleHistoryEvidence(
    stale,
    CREDENTIALS,
    createFixtureRuntime(malformedFetch),
  )).rejects.toThrow("returned no decodable result");
});

test("capture.spec.ts replaces falsely completed malformed evidence instead of retaining it", async () => {
  const { fetch, calls } = createFixtureFetch();
  const captured = await captureBundle(
    parseDocumentUrl(FIXTURE_ELEMENT_URL), CREDENTIALS, createFixtureRuntime(fetch),
  );
  const stale = structuredClone(captured);
  stale.partStudios[0]!.features = featuresWithOpaqueProfile();
  stale.partStudios[0]!.profileEvidenceSchemaVersion = 3;
  stale.partStudios[0]!.profileEvidence = [{
    consumingFeatureId: "E_OPAQUE", parameterId: "entities", queryIndex: 0,
    evaluatedAt: "historyPoint", kind: "unresolved",
    unresolved: { reason: "profile evidence FeatureScript result was malformed" },
  }];
  stale.partStudios[0]!.profileEvidenceManifest = [{
    consumingFeatureId: "E_OPAQUE", parameterId: "entities", queryIndex: 0,
    sourceQueryString: 'query = qCompressed(1.0, "opaque-profile", id);',
    kind: "unresolved", emittedRecordCount: 1, completed: true,
  }];
  const before = calls.length;

  const enriched = await enrichBundleHistoryEvidence(stale, CREDENTIALS, createFixtureRuntime(fetch));
  const records = enriched.partStudios[0]!.profileEvidence?.filter(
    (record) => record.consumingFeatureId === "E_OPAQUE",
  );
  expect(calls.slice(before).filter((call) => call.url.includes("/featurescript"))).toHaveLength(4);
  expect(records).toHaveLength(1);
  expect(enriched.partStudios[0]!.profileEvidenceManifest).toEqual(expect.arrayContaining([
    expect.objectContaining({ consumingFeatureId: "E_OPAQUE", emittedRecordCount: 1 }),
  ]));
});

test("capture.spec.ts empty Part Studio records absence of bodies explicitly", async () => {
  const { fetch } = createFixtureFetch();
  const url = `https://cad.onshape.com/documents/${FIXTURE_DOCUMENT_ID}/w/a14bbd18c43e1cd99d2cfc48/e/${FIXTURE_EMPTY_STUDIO_ID}`;
  const ref = parseDocumentUrl(url);

  const bundle = await captureBundle(ref, CREDENTIALS, createFixtureRuntime(fetch));

  expect(bundle.partStudios[0]!.groundTruth).toEqual({ hasBodies: false });
});

test("capture.spec.ts records optional feature-specs absence but still succeeds", async () => {
  const routes = buildDefaultRoutes();
  routes.unshift({
    method: "GET",
    match: (url) => url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/featurespecs`),
    respond: (): FetchResponseStub => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve("not found"),
    }),
  });
  const { fetch } = createFixtureFetch(routes);
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);

  const bundle = await captureBundle(ref, CREDENTIALS, createFixtureRuntime(fetch));

  expect(bundle.partStudios[0]!.featureSpecs.present).toBe(false);
  expect(
    validateOnshapeCaptureBundle(bundle).success,
    "Optional-section absence should still yield a valid bundle.",
  ).toBeTruthy();
});

test("capture.spec.ts aborts when a mandatory section keeps failing", async () => {
  const routes = buildDefaultRoutes();
  routes.unshift({
    method: "GET",
    match: (url) => url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/features?`),
    respond: (): FetchResponseStub => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve("server error"),
    }),
  });
  const { fetch } = createFixtureFetch(routes);
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);

  await expect(
    captureBundle(
      ref,
      CREDENTIALS,
      { ...createFixtureRuntime(fetch), sleep: () => Promise.resolve() },
    ),
  ).rejects.toBeInstanceOf(OnshapeRequestError);
});

test("capture.spec.ts retries with backoff on HTTP 429 before succeeding", async () => {
  const routes = buildDefaultRoutes();
  let attempts = 0;
  routes.unshift({
    method: "GET",
    match: (url) => url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/features?`),
    respond: (): FetchResponseStub => {
      attempts += 1;
      if (attempts < 3) {
        return {
          ok: false,
          status: 429,
          text: () => Promise.resolve("rate limited"),
        };
      }
      return {
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(JSON.stringify({ btType: "x", features: [] })),
      };
    },
  });
  const { fetch, calls } = createFixtureFetch(routes);
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);
  const sleeps: number[] = [];

  const bundle = await captureBundle(ref, CREDENTIALS, {
    ...createFixtureRuntime(fetch),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });

  expect(attempts, "Should retry the 429 responses before succeeding.").toBe(3);
  // First two sleeps are the bounded rate-limit backoff on the retried endpoint
  // (later sleeps belong to STEP translation polling).
  expect(sleeps.slice(0, 2)).toEqual([15_000, 30_000]);
  expect(
    calls.filter((call) => call.url.includes("/features")).length,
  ).toBeGreaterThanOrEqual(3);
  expect(validateOnshapeCaptureBundle(bundle).success).toBeTruthy();
});

test("capture.spec.ts uses an overrideable STEP translation poll budget", async () => {
  let translationPolls = 0;
  const client = {
    async getJson(path: string) {
      if (path.includes("tessellatedfaces")) {
        return { bodies: [] };
      }
      if (path === "/translations/translation_1") {
        translationPolls += 1;
        return { requestState: "ACTIVE" };
      }
      throw new Error(`Unexpected GET ${path}`);
    },
    async postJson() {
      return { id: "translation_1", requestState: "ACTIVE" };
    },
    async getText() {
      throw new Error("STEP text should not be requested before timeout.");
    },
  };

  await expect(
    captureGroundTruth(client as never, {
      documentId: "doc",
      wvm: "w",
      wvmId: "workspace",
      elementId: "element",
      studioPath: "/partstudios/d/doc/w/workspace/e/element",
      parts: [{ partId: "part" }],
      sleep: () => Promise.resolve(),
      maxTranslationPolls: 2,
    }),
  ).rejects.toThrow("after 2 polls");
  expect(translationPolls).toBe(2);
});
