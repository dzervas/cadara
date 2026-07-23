import { test, expect } from "vitest";

import { validateOnshapeCaptureBundle } from "@/contracts/import/onshape-capture-bundle";

import { captureBundle } from "@/cli/commands/onshape-capture/capture";
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
  expect(mounts?.groundTruth.hasBodies).toBe(true);
  expect(mounts?.featureSpecs.present).toBe(true);
  expect(bundle.formatVersion).toBe(2);
  expect(bundle.diagnostics).toEqual([]);
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
    "Every final-state reference should be present, with failed IDs re-evaluated at their history point.",
  ).toEqual(["JDC:finalState", "JGC:finalState", "ZZZ:finalState", "ZZZ:historyPoint"]);

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
    calls.filter((call) => call.url.includes("/features/rollback")).length,
    "Failed IDs at the same rollback index should share one rollback move.",
  ).toBe(1);
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

test("capture.spec.ts creates and deletes a temporary rollback workspace", async () => {
  const { fetch, calls } = createFixtureFetch();
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);

  await captureBundle(ref, CREDENTIALS, createFixtureRuntime(fetch));

  expect(
    calls.some(
      (call) => call.method === "POST" && call.url.includes(`/documents/d/${FIXTURE_DOCUMENT_ID}/workspaces`),
    ),
  ).toBeTruthy();
  expect(
    calls.some(
      (call) =>
        call.method === "DELETE" &&
        call.url.includes(`/documents/d/${FIXTURE_DOCUMENT_ID}/workspaces/${FIXTURE_TEMP_WORKSPACE_ID}`),
    ),
  ).toBeTruthy();
});

test("capture.spec.ts reports an undeleted rollback workspace after capture failure", async () => {
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
    match: (url) => url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/sketches`),
    respond: (): FetchResponseStub => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve("sketch failure"),
    }),
  });
  const { fetch } = createFixtureFetch(routes);
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);

  await expect(
    captureBundle(ref, CREDENTIALS, createFixtureRuntime(fetch)),
  ).rejects.toThrow(FIXTURE_TEMP_WORKSPACE_ID);
});

test("capture.spec.ts degrades to final-state capture with a bundle diagnostic on workspace create 403", async () => {
  const routes = buildDefaultRoutes();
  routes.unshift({
    method: "POST",
    match: (url) => url.includes(`/documents/d/${FIXTURE_DOCUMENT_ID}/workspaces`),
    respond: (): FetchResponseStub => ({
      ok: false,
      status: 403,
      text: () => Promise.resolve("branch rights unavailable"),
    }),
  });
  const { fetch, calls } = createFixtureFetch(routes);
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);

  const bundle = await captureBundle(ref, CREDENTIALS, createFixtureRuntime(fetch));

  expect(bundle.diagnostics?.[0]?.code).toBe("onshape-rollback-workspace-unavailable");
  expect(bundle.partStudios[0]!.rollbackSnapshots).toBeNull();
  expect(
    bundle.partStudios[0]!.resolvedReferences.some(
      (reference) => reference.evaluatedAt === "historyPoint",
    ),
  ).toBe(false);
  expect(calls.some((call) => call.method === "DELETE")).toBe(false);
});

test("capture.spec.ts captures rollback snapshots only when requested", async () => {
  const { fetch } = createFixtureFetch();
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);

  const withoutSnapshots = await captureBundle(
    ref,
    CREDENTIALS,
    createFixtureRuntime(fetch),
  );
  expect(withoutSnapshots.partStudios[0]!.rollbackSnapshots).toBeNull();

  const { fetch: snapshotFetch } = createFixtureFetch();
  const snapshotSleeps: number[] = [];
  const withSnapshots = await captureBundle(
    ref,
    { ...CREDENTIALS, rollbackSnapshots: true },
    {
      ...createFixtureRuntime(snapshotFetch),
      sleep: (ms) => {
        snapshotSleeps.push(ms);
        return Promise.resolve();
      },
    },
  );

  expect(withSnapshots.partStudios[0]!.rollbackSnapshots).toEqual([
    expect.objectContaining({
      featureId: "FG094ehBlsq34dl_0",
      tessellationTolerance: 0.001,
      step: expect.stringContaining("ISO-10303-21"),
    }),
  ]);
  expect(snapshotSleeps).toContain(5_000);
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
