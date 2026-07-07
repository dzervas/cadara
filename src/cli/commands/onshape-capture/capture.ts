import {
  requireOnshapeCaptureBundle,
  type OnshapeCaptureBundle,
  type OnshapeOptionalSection,
  type OnshapePartStudioCapture,
} from "@/contracts/import/onshape-capture-bundle";

import {
  OnshapeClient,
  OnshapeRequestError,
  type FetchLike,
} from "@/cli/commands/onshape-capture/client";
import { captureGroundTruth } from "@/cli/commands/onshape-capture/ground-truth";
import {
  collectDeterministicIds,
  resolveDeterministicIds,
} from "@/cli/commands/onshape-capture/references";
import type { OnshapeDocumentRef } from "@/cli/commands/onshape-capture/url";

export const DEFAULT_ONSHAPE_API_VERSION = "v10";
export const DEFAULT_ONSHAPE_BASE_URL = "https://cad.onshape.com/api/v10";

/** Injected runtime dependencies so tests run without real IO. */
export interface CaptureRuntime {
  fetch: FetchLike;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  cliVersion: string;
}

export interface CaptureOptions {
  accessKey: string;
  secretKey: string;
  baseUrl?: string;
  apiVersion?: string;
  concurrency?: number;
  maxTranslationPolls?: number;
}

interface RawElement {
  id: string;
  name?: string;
  elementType?: string;
}

/**
 * Capture an Onshape document reference into a validated {@link OnshapeCaptureBundle}.
 *
 * Every mandatory section is fetched and archived verbatim; any failure throws
 * before a bundle is produced (the caller writes no file on throw). The
 * returned bundle is validated against the envelope schema before it is handed
 * back — assembly never yields an invalid bundle.
 */
export async function captureBundle(
  ref: OnshapeDocumentRef,
  options: CaptureOptions,
  runtime: CaptureRuntime,
): Promise<OnshapeCaptureBundle> {
  const baseUrl = options.baseUrl ?? DEFAULT_ONSHAPE_BASE_URL;
  const apiVersion = options.apiVersion ?? DEFAULT_ONSHAPE_API_VERSION;
  const client = new OnshapeClient({
    baseUrl,
    accessKey: options.accessKey,
    secretKey: options.secretKey,
    fetch: runtime.fetch,
    sleep: runtime.sleep,
    concurrency: options.concurrency,
  });

  const wvmContext = `d/${ref.documentId}/${ref.wvm}/${ref.wvmId}`;

  const document = await client.getJson(`/documents/${ref.documentId}`);
  const elements = await client.getJson(`/documents/${wvmContext}/elements`);
  const microversionResponse = (await client.getJson(
    `/documents/${wvmContext}/currentmicroversion`,
  )) as { microversion?: string };

  const partStudios = selectPartStudios(elements, ref.elementId);
  if (partStudios.length === 0) {
    throw new Error(
      ref.elementId
        ? `Element ${ref.elementId} is not a Part Studio in this document.`
        : "No Part Studios found in this document.",
    );
  }

  const capturedStudios: OnshapePartStudioCapture[] = [];
  for (const studio of partStudios) {
    capturedStudios.push(await captureStudio(client, ref, studio, runtime, options));
  }

  const bundle: OnshapeCaptureBundle = {
    formatVersion: 1,
    provenance: {
      capturedAt: runtime.now().toISOString(),
      cliVersion: runtime.cliVersion,
      apiVersion,
      baseUrl,
      documentId: ref.documentId,
      wvm: ref.wvm,
      wvmId: ref.wvmId,
      microversion: microversionResponse.microversion ?? "",
    },
    document,
    elements,
    partStudios: capturedStudios,
  };

  // Never hand back a bundle that does not satisfy the shared envelope schema.
  return requireOnshapeCaptureBundle(bundle);
}

function selectPartStudios(
  elements: unknown,
  elementId: string | null,
): RawElement[] {
  if (!Array.isArray(elements)) {
    throw new Error("Onshape element list response was not an array.");
  }
  return (elements as RawElement[]).filter(
    (element) =>
      element.elementType === "PARTSTUDIO" &&
      (elementId === null || element.id === elementId),
  );
}

async function captureStudio(
  client: OnshapeClient,
  ref: OnshapeDocumentRef,
  studio: RawElement,
  runtime: CaptureRuntime,
  options: Pick<CaptureOptions, "maxTranslationPolls">,
): Promise<OnshapePartStudioCapture> {
  const studioPath = `/partstudios/d/${ref.documentId}/${ref.wvm}/${ref.wvmId}/e/${studio.id}`;
  const partsPath = `/parts/d/${ref.documentId}/${ref.wvm}/${ref.wvmId}/e/${studio.id}`;

  const features = await client.getJson(`${studioPath}/features`);
  const sketches = await client.getJson(
    `${studioPath}/sketches?output3D=true&curvePoints=true`,
  );
  const parts = await client.getJson(partsPath);
  const featureSpecs = await captureFeatureSpecs(client, studioPath);

  const deterministicIds = collectDeterministicIds(features);
  const resolvedReferences = await resolveDeterministicIds(
    client,
    studioPath,
    deterministicIds,
  );

  const groundTruth = await captureGroundTruth(client, {
    documentId: ref.documentId,
    wvm: ref.wvm,
    wvmId: ref.wvmId,
    elementId: studio.id,
    studioPath,
    parts,
    sleep: runtime.sleep,
    maxTranslationPolls: options.maxTranslationPolls,
  });

  return {
    elementId: studio.id,
    name: studio.name ?? "",
    features,
    sketches,
    parts,
    featureSpecs,
    resolvedReferences,
    groundTruth,
    rollbackSnapshots: null,
  };
}

/**
 * Capture the optional feature-specs section. Its absence is recorded with a
 * structured reason rather than silently dropped; only the recognized HTTP
 * failure is treated as "absent" — any other error bubbles up.
 */
async function captureFeatureSpecs(
  client: OnshapeClient,
  studioPath: string,
): Promise<OnshapeOptionalSection> {
  try {
    return { present: true, response: await client.getJson(`${studioPath}/featurespecs`) };
  } catch (error) {
    if (error instanceof OnshapeRequestError) {
      return {
        present: false,
        reason: `feature specs unavailable (HTTP ${error.status})`,
      };
    }
    throw error;
  }
}
