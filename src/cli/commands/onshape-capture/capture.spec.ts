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
  FIXTURE_PART_STUDIO_ID,
  type FetchResponseStub,
} from "@/cli/commands/onshape-capture/fixtures/transcript";

const CREDENTIALS = { accessKey: "access", secretKey: "secret" };

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

test("capture.spec.ts records unresolved deterministic references without fabricating signatures", async () => {
  const { fetch } = createFixtureFetch();
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);

  const bundle = await captureBundle(ref, CREDENTIALS, createFixtureRuntime(fetch));
  const references = bundle.partStudios[0]!.resolvedReferences;

  expect(
    references.map((reference) => reference.deterministicId).sort(),
    "Every referenced deterministic ID should appear in the resolution table.",
  ).toEqual(["JDC", "JGC", "ZZZ"]);

  const unresolved = references.find(
    (reference) => reference.deterministicId === "ZZZ",
  );
  expect(unresolved && "unresolved" in unresolved).toBeTruthy();

  const resolved = references.find(
    (reference) => reference.deterministicId === "JDC",
  );
  expect(resolved && "signature" in resolved).toBeTruthy();
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
    match: (url) => url.endsWith(`/e/${FIXTURE_PART_STUDIO_ID}/features`),
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
    match: (url) => url.endsWith(`/e/${FIXTURE_PART_STUDIO_ID}/features`),
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
  // First two sleeps are the exponential backoff on the retried endpoint
  // (later sleeps belong to STEP translation polling).
  expect(sleeps[0], "First backoff delay should be the base delay.").toBe(250);
  expect(
    sleeps[1]! > sleeps[0]!,
    "Backoff delay should grow exponentially.",
  ).toBeTruthy();
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
