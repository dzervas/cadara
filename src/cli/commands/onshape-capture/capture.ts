import {
  ONSHAPE_CAPTURE_BUNDLE_FORMAT_VERSION,
  requireOnshapeCaptureBundle,
  type OnshapeCaptureBundle,
  type OnshapeCaptureDiagnostic,
  type OnshapeOptionalSection,
  type OnshapePartStudioCapture,
  type OnshapeRollbackSnapshot,
} from "@/contracts/import/onshape-capture-bundle";

import {
  OnshapeClient,
  OnshapeRequestError,
  type FetchLike,
} from "@/cli/commands/onshape-capture/client";
import { DEFAULT_TESSELLATION_TOLERANCE, captureGroundTruth, exportStep } from "@/cli/commands/onshape-capture/ground-truth";
import {
  collectDeterministicIdConsumers,
  collectDeterministicIds,
  collectQueryStringConsumers,
  resolveDeterministicIds,
  resolveDeterministicIdsWithHistory,
  resolveQueryStringsWithHistory,
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
  rollbackSnapshots?: boolean;
}

interface RollbackWorkspace {
  workspaceId: string | null;
  diagnostics: OnshapeCaptureDiagnostic[];
}

interface SolidFeatureRollbackPoint {
  featureId: string;
  rollbackIndex: number;
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
  const microversion = microversionResponse.microversion ?? "";

  const partStudios = selectPartStudios(elements, ref.elementId);
  if (partStudios.length === 0) {
    throw new Error(
      ref.elementId
        ? `Element ${ref.elementId} is not a Part Studio in this document.`
        : "No Part Studios found in this document.",
    );
  }

  const rollbackWorkspace = await createRollbackWorkspace(
    client,
    ref.documentId,
    microversion,
    runtime,
  );
  const capturedStudios: OnshapePartStudioCapture[] = [];
  let captureError: unknown;

  try {
    for (const studio of partStudios) {
      capturedStudios.push(
        await captureStudio(client, ref, studio, runtime, options, rollbackWorkspace.workspaceId),
      );
    }
  } catch (error) {
    captureError = error;
  }

  const cleanupError = await cleanupRollbackWorkspace(
    client,
    ref.documentId,
    rollbackWorkspace.workspaceId,
  );
  if (cleanupError) {
    const baseMessage = captureError ? `${errorMessage(captureError)}\n` : "";
    throw new Error(
      `${baseMessage}Temporary Onshape workspace ${rollbackWorkspace.workspaceId} could not be deleted; delete it manually. ${errorMessage(cleanupError)}`,
    );
  }
  if (captureError) {
    throw captureError;
  }

  const bundle: OnshapeCaptureBundle = {
    formatVersion: ONSHAPE_CAPTURE_BUNDLE_FORMAT_VERSION,
    provenance: {
      capturedAt: runtime.now().toISOString(),
      cliVersion: runtime.cliVersion,
      apiVersion,
      baseUrl,
      documentId: ref.documentId,
      wvm: ref.wvm,
      wvmId: ref.wvmId,
      microversion,
    },
    document,
    elements,
    diagnostics: rollbackWorkspace.diagnostics,
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

async function createRollbackWorkspace(
  client: OnshapeClient,
  documentId: string,
  microversion: string,
  runtime: CaptureRuntime,
): Promise<RollbackWorkspace> {
  try {
    const response = (await client.postJson(`/documents/d/${documentId}/workspaces`, {
      documentId,
      microversionId: microversion,
      name: `cadara-capture-${runtime.now().toISOString()}`,
    })) as { id?: unknown; workspaceId?: unknown };
    const workspaceId = response.id ?? response.workspaceId;
    if (typeof workspaceId !== "string" || workspaceId.length === 0) {
      throw new Error("Onshape workspace creation returned no workspace id.");
    }
    return { workspaceId, diagnostics: [] };
  } catch (error) {
    if (error instanceof OnshapeRequestError && error.status === 403) {
      return {
        workspaceId: null,
        diagnostics: [
          {
            severity: "warning",
            code: "onshape-rollback-workspace-unavailable",
            message:
              "Onshape returned HTTP 403 while creating the temporary rollback workspace; capture degraded to final-state-only references and no rollback snapshots.",
          },
        ],
      };
    }
    throw error;
  }
}

async function cleanupRollbackWorkspace(
  client: OnshapeClient,
  documentId: string,
  workspaceId: string | null,
): Promise<unknown | null> {
  if (!workspaceId) {
    return null;
  }
  try {
    await client.delete(`/documents/d/${documentId}/workspaces/${workspaceId}`);
    return null;
  } catch (error) {
    return error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function captureStudio(
  client: OnshapeClient,
  ref: OnshapeDocumentRef,
  studio: RawElement,
  runtime: CaptureRuntime,
  options: Pick<CaptureOptions, "maxTranslationPolls" | "rollbackSnapshots">,
  rollbackWorkspaceId: string | null,
): Promise<OnshapePartStudioCapture> {
  const studioPath = `/partstudios/d/${ref.documentId}/${ref.wvm}/${ref.wvmId}/e/${studio.id}`;
  const rollbackStudioPath = rollbackWorkspaceId
    ? `/partstudios/d/${ref.documentId}/w/${rollbackWorkspaceId}/e/${studio.id}`
    : null;
  const partsPath = `/parts/d/${ref.documentId}/${ref.wvm}/${ref.wvmId}/e/${studio.id}`;

  const features = await client.getJson(
    `${studioPath}/features?rollbackBarIndex=-1&includeGeometryIds=true&noSketchGeometry=false`,
  );
  const sketches = await client.getJson(
    `${studioPath}/sketches?output3D=true&curvePoints=true`,
  );
  const parts = await client.getJson(partsPath);
  const featureSpecs = await captureFeatureSpecs(client, studioPath);

  const deterministicIdConsumers = collectDeterministicIdConsumers(features);
  const deterministicIds = collectDeterministicIds(features);
  const queryStringConsumers = collectQueryStringConsumers(features);
  const resolvedReferences = rollbackStudioPath
    ? await resolveDeterministicIdsWithHistory(
        client,
        studioPath,
        rollbackStudioPath,
        deterministicIdConsumers,
      )
    : await resolveDeterministicIds(client, studioPath, deterministicIds);
  const resolvedQueryReferences = rollbackStudioPath
    ? await resolveQueryStringsWithHistory(client, studioPath, queryStringConsumers)
    : [];

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

  const rollbackSnapshots =
    options.rollbackSnapshots && rollbackStudioPath
      ? await captureRollbackSnapshots(
          client,
          ref,
          studio.id,
          rollbackStudioPath,
          features,
          runtime,
          options,
        )
      : null;

  return {
    elementId: studio.id,
    name: studio.name ?? "",
    features,
    sketches,
    parts,
    featureSpecs,
    resolvedReferences,
    resolvedQueryReferences,
    groundTruth,
    rollbackSnapshots,
  };
}

async function captureRollbackSnapshots(
  client: OnshapeClient,
  ref: OnshapeDocumentRef,
  elementId: string,
  rollbackStudioPath: string,
  features: unknown,
  runtime: CaptureRuntime,
  options: Pick<CaptureOptions, "maxTranslationPolls">,
): Promise<OnshapeRollbackSnapshot[]> {
  const snapshots: OnshapeRollbackSnapshot[] = [];
  for (const point of collectSolidFeatureRollbackPoints(features)) {
    await client.postJson(`${rollbackStudioPath}/features/rollback`, {
      rollbackIndex: point.rollbackIndex,
    });
    const tessellatedFaces = await client.getJson(
      `${rollbackStudioPath}/tessellatedfaces?chordTolerance=${DEFAULT_TESSELLATION_TOLERANCE}`,
    );
    const snapshot: OnshapeRollbackSnapshot = {
      featureId: point.featureId,
      tessellationTolerance: DEFAULT_TESSELLATION_TOLERANCE,
      tessellatedFaces,
    };
    try {
      snapshot.step = await exportStep(client, {
        documentId: ref.documentId,
        wvm: "w",
        wvmId: elementId,
        studioPath: rollbackStudioPath,
        sleep: runtime.sleep,
        maxTranslationPolls: options.maxTranslationPolls,
      });
    } catch (error) {
      if (!(error instanceof OnshapeRequestError)) {
        throw error;
      }
    }
    snapshots.push(snapshot);
  }
  return snapshots;
}

function collectSolidFeatureRollbackPoints(features: unknown): SolidFeatureRollbackPoint[] {
  const featureList = (features as { features?: unknown }).features;
  if (!Array.isArray(featureList)) {
    return [];
  }

  const points: SolidFeatureRollbackPoint[] = [];
  featureList.forEach((feature, index) => {
    if (!feature || typeof feature !== "object") {
      return;
    }
    const record = feature as { featureId?: unknown; featureType?: unknown };
    if (
      typeof record.featureId === "string" &&
      record.featureId.length > 0 &&
      typeof record.featureType === "string" &&
      record.featureType !== "newSketch"
    ) {
      points.push({ featureId: record.featureId, rollbackIndex: index + 1 });
    }
  });
  return points;
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
