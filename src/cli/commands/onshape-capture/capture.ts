import {
  ONSHAPE_CAPTURE_BUNDLE_FORMAT_VERSION,
  ONSHAPE_IMMUTABLE_HISTORY_EVIDENCE_SCHEMA_VERSION,
  ONSHAPE_PROFILE_EVIDENCE_SCHEMA_VERSION,
  hasCurrentOnshapeImmutableHistoryEvidence,
  hasCurrentOnshapeProfileEvidence,
  requireOnshapeCaptureBundle,
  type OnshapeCaptureBundle,
  type OnshapeCaptureDiagnostic,
  type OnshapeImmutableHistoryEvidenceManifest,
  type OnshapeOptionalSection,
  type OnshapePartStudioCapture,
  type OnshapeProfileEvidence,
  type OnshapeProfileEvidenceManifestEntry,
  type OnshapeResolvedReference,
  type OnshapeRollbackSnapshot,
} from "@/contracts/import/onshape-capture-bundle";

import {
  immutableFeatureScriptEvidenceCacheKey,
  type ImmutableFeatureScriptEvidenceCache,
} from "@/cli/commands/onshape-capture/evidence-cache";
import {
  OnshapeClient,
  OnshapeRequestError,
  type FetchLike,
  type OnshapeCredentials,
} from "@/cli/commands/onshape-capture/client";
import { DEFAULT_TESSELLATION_TOLERANCE, captureBoundaryOnlyGroundTruth, exportStep } from "@/cli/commands/onshape-capture/ground-truth";
import {
  collectDeterministicIdConsumers,
  collectQueryStringConsumers,
  collectSolidExtrudeProfileQueryConsumers,
  resolveImmutableHistoryEvidence,
  type SolidExtrudeProfileQueryConsumer,
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
  /** Optional safe progress sink for long-running capture/enrichment operations. */
  log?: (text: string) => void;
}

export type CaptureOptions = OnshapeCredentials & {
  baseUrl?: string;
  apiVersion?: string;
  concurrency?: number;
  maxTranslationPolls?: number;
  /** Optional cache for immutable, read-only FeatureScript evidence only. */
  evidenceCache?: ImmutableFeatureScriptEvidenceCache;
};

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
    ...(options.cookieOn !== undefined
      ? { cookieOn: options.cookieOn }
      : { accessKey: options.accessKey, secretKey: options.secretKey }),
    baseUrl,
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

  const immutableRef: OnshapeDocumentRef = {
    ...ref,
    wvm: "m",
    wvmId: microversion,
  };
  const capturedStudios: OnshapePartStudioCapture[] = [];
  for (const studio of partStudios) {
    capturedStudios.push(
      await captureStudio(
        client,
        immutableRef,
        studio,
        options,
        { baseUrl, apiVersion, documentId: ref.documentId, microversion },
      ),
    );
  }

  const rollbackCandidates = capturedStudios.flatMap((studio) => {
    const points = collectIntrinsicBakeRollbackPoints(studio.features);
    return points.length === 0 ? [] : [{ studio, points }];
  });
  const rollbackWorkspace = rollbackCandidates.length > 0
    ? await createRollbackWorkspace(client, ref.documentId, microversion, runtime)
    : { workspaceId: null, diagnostics: [] };
  let captureError: unknown;

  try {
    if (rollbackWorkspace.workspaceId) {
      for (const candidate of rollbackCandidates) {
        candidate.studio.rollbackSnapshots = await captureRollbackSnapshots(
          client,
          ref,
          candidate.studio.elementId,
          `/partstudios/d/${ref.documentId}/w/${rollbackWorkspace.workspaceId}/e/${candidate.studio.elementId}`,
          candidate.points,
          runtime,
          options,
        );
      }
    } else if (rollbackCandidates.length > 0) {
      for (const candidate of rollbackCandidates) {
        candidate.studio.rollbackSnapshots = null;
      }
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

/**
 * Refresh deterministic, ID-less query, and profile history evidence against
 * the captured microversion without re-reading document metadata or geometry.
 */
export async function enrichBundleHistoryEvidence(
  bundle: OnshapeCaptureBundle,
  options: CaptureOptions,
  runtime: CaptureRuntime,
): Promise<OnshapeCaptureBundle> {
  const validated = requireOnshapeCaptureBundle(bundle);
  const baseUrl = options.baseUrl ?? validated.provenance.baseUrl;
  const apiVersion = options.apiVersion ?? validated.provenance.apiVersion;
  const client = new OnshapeClient({
    ...(options.cookieOn !== undefined
      ? { cookieOn: options.cookieOn }
      : { accessKey: options.accessKey, secretKey: options.secretKey }),
    baseUrl,
    fetch: runtime.fetch,
    sleep: runtime.sleep,
    concurrency: options.concurrency,
  });
  const partStudios: OnshapePartStudioCapture[] = [];
  for (const [studioIndex, studio] of validated.partStudios.entries()) {
    const deterministicIdConsumers = collectDeterministicIdConsumers(studio.features);
    const queryStringConsumers = collectQueryStringConsumers(studio.features);
    const profileConsumers = collectSolidExtrudeProfileQueryConsumers(studio.features);
    const progressPrefix = `Enrichment ${studioIndex + 1}/${validated.partStudios.length}: ${studio.name || studio.elementId}`;
    const rollbackSnapshots = retainIntrinsicBakeRollbackSnapshots(studio);
    const historyIsCurrent = hasCurrentOnshapeImmutableHistoryEvidence({
      schemaVersion: studio.immutableHistoryEvidenceSchemaVersion,
      manifest: studio.immutableHistoryEvidenceManifest,
      resolvedReferences: studio.resolvedReferences,
      resolvedQueryReferences: studio.resolvedQueryReferences,
      deterministicIdConsumers,
      queryStringConsumers,
    });
    const profilesAreCurrent = hasCompleteCurrentProfileEvidence(studio, profileConsumers);
    if (historyIsCurrent && profilesAreCurrent) {
      runtime.log?.(`${progressPrefix} — evidence is current; no FeatureScript request.\n`);
      partStudios.push({ ...studio, rollbackSnapshots });
      continue;
    }

    const retainedFinal = historyIsCurrent
      ? null
      : validFinalDeterministicRecords(studio.resolvedReferences, deterministicIdConsumers);
    let featureScriptRequestCount = 0;
    const fresh = await resolveImmutableHistoryEvidence({
      client,
      partStudioPath: `/partstudios/d/${validated.provenance.documentId}/m/${validated.provenance.microversion}/e/${studio.elementId}`,
      deterministicIdConsumers: historyIsCurrent ? [] : deterministicIdConsumers,
      queryStringConsumers: historyIsCurrent ? [] : queryStringConsumers,
      profileConsumers: profilesAreCurrent ? [] : profileConsumers,
      skipFinalState: retainedFinal !== null,
      evaluate: (rollbackBarIndex, script) => {
        runtime.log?.(`${progressPrefix} — requesting FeatureScript evidence #${++featureScriptRequestCount} at rollback index ${rollbackBarIndex}.\n`);
        return evaluateImmutableEvidence(
          client,
          `/partstudios/d/${validated.provenance.documentId}/m/${validated.provenance.microversion}/e/${studio.elementId}`,
          rollbackBarIndex,
          script,
          options.evidenceCache,
          {
            baseUrl,
            apiVersion,
            documentId: validated.provenance.documentId,
            microversion: validated.provenance.microversion,
            elementId: studio.elementId,
          },
        );
      },
    });
    const resolvedReferences = historyIsCurrent
      ? studio.resolvedReferences
      : [...(retainedFinal ?? fresh.resolvedReferences.filter((record) => record.evaluatedAt === "finalState")),
        ...fresh.resolvedReferences.filter((record) => record.evaluatedAt === "historyPoint")];
    const resolvedQueryReferences = historyIsCurrent
      ? studio.resolvedQueryReferences ?? []
      : fresh.resolvedQueryReferences;
    const profileEvidence = profilesAreCurrent
      ? studio.profileEvidence ?? []
      : fresh.profileEvidence;
    partStudios.push({
      ...studio,
      rollbackSnapshots,
      resolvedReferences,
      resolvedQueryReferences,
      immutableHistoryEvidenceSchemaVersion: ONSHAPE_IMMUTABLE_HISTORY_EVIDENCE_SCHEMA_VERSION,
      immutableHistoryEvidenceManifest: immutableHistoryEvidenceManifest(
        deterministicIdConsumers,
        queryStringConsumers,
        resolvedQueryReferences,
      ),
      profileEvidence,
      profileEvidenceManifest: profileEvidenceManifest(profileConsumers, profileEvidence),
      profileEvidenceSchemaVersion: ONSHAPE_PROFILE_EVIDENCE_SCHEMA_VERSION,
    });
  }
  return requireOnshapeCaptureBundle({ ...validated, partStudios });
}

function validFinalDeterministicRecords(
  records: readonly OnshapeResolvedReference[],
  consumers: readonly { deterministicId: string }[],
): OnshapeResolvedReference[] | null {
  const ids = [...new Set(consumers.map((consumer) => consumer.deterministicId))];
  const finalRecords = ids.map((deterministicId) => records.filter((record) =>
    record.evaluatedAt === "finalState" && record.deterministicId === deterministicId,
  ));
  return finalRecords.every((matches) => matches.length === 1)
    ? finalRecords.map(([record]) => record!)
    : null;
}

function immutableHistoryEvidenceManifest(
  deterministicIdConsumers: readonly { deterministicId: string; consumingFeatureId: string }[],
  queryStringConsumers: readonly {
    consumingFeatureId: string;
    parameterId: string;
    queryIndex: number;
    queryString: string;
  }[],
  resolvedQueryReferences: readonly { consumingFeatureId: string; parameterId: string; queryIndex: number }[],
): OnshapeImmutableHistoryEvidenceManifest {
  return {
    deterministicIdConsumers: deterministicIdConsumers.map((consumer) => ({
      deterministicId: consumer.deterministicId,
      consumingFeatureId: consumer.consumingFeatureId,
      completed: true,
    })),
    queryStringConsumers: queryStringConsumers.map((consumer) => ({
      consumingFeatureId: consumer.consumingFeatureId,
      parameterId: consumer.parameterId,
      queryIndex: consumer.queryIndex,
      sourceQueryString: consumer.queryString,
      emittedRecordCount: resolvedQueryReferences.filter((record) =>
        record.consumingFeatureId === consumer.consumingFeatureId &&
        record.parameterId === consumer.parameterId &&
        record.queryIndex === consumer.queryIndex,
      ).length,
      completed: true,
    })),
  };
}

function hasCompleteCurrentProfileEvidence(
  studio: OnshapePartStudioCapture,
  consumers: readonly SolidExtrudeProfileQueryConsumer[],
): boolean {
  const manifest = studio.profileEvidenceManifest;
  if (!consumers.every((consumer) => hasCurrentOnshapeProfileEvidence({
    schemaVersion: studio.profileEvidenceSchemaVersion,
    manifest,
    evidence: studio.profileEvidence,
    consumingFeatureId: consumer.consumingFeatureId,
    queryIndex: consumer.queryIndex,
    sourceQueryString: consumer.queryString,
  }))) return false;
  const expectedRecordCount = consumers.reduce((count, consumer) => count +
    (manifest?.find((entry) =>
      entry.consumingFeatureId === consumer.consumingFeatureId &&
      entry.parameterId === "entities" &&
      entry.queryIndex === consumer.queryIndex &&
      entry.sourceQueryString === consumer.queryString,
    )?.emittedRecordCount ?? 0), 0);
  return (studio.profileEvidence?.length ?? 0) === expectedRecordCount;
}

function profileEvidenceManifest(
  consumers: readonly SolidExtrudeProfileQueryConsumer[],
  evidence: readonly OnshapeProfileEvidence[],
): OnshapeProfileEvidenceManifestEntry[] {
  return consumers.map((consumer) => {
    const records = evidence.filter((record) =>
      record.consumingFeatureId === consumer.consumingFeatureId &&
      record.parameterId === "entities" &&
      record.queryIndex === consumer.queryIndex &&
      record.evaluatedAt === "historyPoint",
    );
    return {
      consumingFeatureId: consumer.consumingFeatureId,
      parameterId: "entities",
      queryIndex: consumer.queryIndex,
      sourceQueryString: consumer.queryString,
      kind: records.length === 1 && records[0]?.kind === "sketchRegionSet"
        ? "sketchRegionSet"
        : records.length === 1 && records[0]?.kind === "unresolved" && !("resultIndex" in records[0])
          ? "unresolved"
          : "faceResults",
      emittedRecordCount: records.length,
      completed: true,
    };
  });
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
              "Onshape returned HTTP 403 while creating the temporary rollback workspace; immutable evidence capture continues, but required bake-boundary snapshots are unavailable.",
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

async function evaluateImmutableEvidence(
  client: OnshapeClient,
  partStudioPath: string,
  rollbackBarIndex: number,
  script: string,
  cache: ImmutableFeatureScriptEvidenceCache | undefined,
  identity: {
    baseUrl: string;
    apiVersion: string;
    documentId: string;
    microversion: string;
    elementId: string;
  },
): Promise<unknown> {
  const key = immutableFeatureScriptEvidenceCacheKey({
    evidenceSchemaVersion: ONSHAPE_PROFILE_EVIDENCE_SCHEMA_VERSION,
    ...identity,
    rollbackBarIndex,
    script,
  });
  const cached = cache?.get(key);
  if (cached !== undefined) return cached;
  const response = await client.postJson(
    `${partStudioPath}/featurescript?rollbackBarIndex=${rollbackBarIndex}`,
    { script },
  );
  cache?.set(key, response);
  return response;
}

async function captureStudio(
  client: OnshapeClient,
  ref: OnshapeDocumentRef,
  studio: RawElement,
  options: Pick<CaptureOptions, "evidenceCache">,
  immutableEvidenceIdentity: {
    baseUrl: string;
    apiVersion: string;
    documentId: string;
    microversion: string;
  },
): Promise<OnshapePartStudioCapture> {
  const studioPath = `/partstudios/d/${ref.documentId}/${ref.wvm}/${ref.wvmId}/e/${studio.id}`;
  const partsPath = `/parts/d/${ref.documentId}/${ref.wvm}/${ref.wvmId}/e/${studio.id}`;

  const features = await client.getJson(
    `${studioPath}/features?rollbackBarIndex=-1&includeGeometryIds=true&noSketchGeometry=false`,
  );
  const sketches = await client.getJson(
    `${studioPath}/sketches?output3D=true&curvePoints=true`,
  );
  const parts = await client.getJson(partsPath);
  const featureSpecs = await captureFeatureSpecs(client, studioPath);

  const profileConsumers = collectSolidExtrudeProfileQueryConsumers(features);
  const evidence = await resolveImmutableHistoryEvidence({
    client,
    partStudioPath: studioPath,
    deterministicIdConsumers: collectDeterministicIdConsumers(features),
    queryStringConsumers: collectQueryStringConsumers(features),
    profileConsumers,
    evaluate: (rollbackBarIndex, script) => evaluateImmutableEvidence(
      client,
      studioPath,
      rollbackBarIndex,
      script,
      options.evidenceCache,
      { ...immutableEvidenceIdentity, elementId: studio.id },
    ),
  });

  const groundTruth = captureBoundaryOnlyGroundTruth(parts);
  const rollbackSnapshots: OnshapeRollbackSnapshot[] = [];

  return {
    elementId: studio.id,
    name: studio.name ?? "",
    features,
    sketches,
    parts,
    featureSpecs,
    resolvedReferences: evidence.resolvedReferences,
    resolvedQueryReferences: evidence.resolvedQueryReferences,
    immutableHistoryEvidenceSchemaVersion: ONSHAPE_IMMUTABLE_HISTORY_EVIDENCE_SCHEMA_VERSION,
    immutableHistoryEvidenceManifest: immutableHistoryEvidenceManifest(
      collectDeterministicIdConsumers(features),
      collectQueryStringConsumers(features),
      evidence.resolvedQueryReferences,
    ),
    profileEvidence: evidence.profileEvidence,
    profileEvidenceManifest: profileEvidenceManifest(profileConsumers, evidence.profileEvidence),
    profileEvidenceSchemaVersion: ONSHAPE_PROFILE_EVIDENCE_SCHEMA_VERSION,
    groundTruth,
    rollbackSnapshots,
  };
}

async function captureRollbackSnapshots(
  client: OnshapeClient,
  ref: OnshapeDocumentRef,
  elementId: string,
  rollbackStudioPath: string,
  points: readonly SolidFeatureRollbackPoint[],
  runtime: CaptureRuntime,
  options: Pick<CaptureOptions, "maxTranslationPolls">,
): Promise<OnshapeRollbackSnapshot[]> {
  const snapshots: OnshapeRollbackSnapshot[] = [];
  const rollbackThrottleMs = 5_000;
  for (const point of points) {
    await runtime.sleep(rollbackThrottleMs);
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

/**
 * Return only feature boundaries proven locally to be intrinsic bakes. Without
 * geometry, this scoped capture treats only `bodyType=SURFACE` extrudes as
 * such boundaries; ordinary feature history must not trigger snapshots.
 */
function collectIntrinsicBakeRollbackPoints(features: unknown): SolidFeatureRollbackPoint[] {
  const featureList = (features as { features?: unknown }).features;
  if (!Array.isArray(featureList)) return [];

  return featureList.flatMap((feature, index) => {
    if (!feature || typeof feature !== "object") return [];
    const record = feature as {
      featureId?: unknown;
      featureType?: unknown;
      parameters?: unknown;
    };
    const bodyType = Array.isArray(record.parameters)
      ? record.parameters.find(
          (parameter) =>
            parameter &&
            typeof parameter === "object" &&
            (parameter as { parameterId?: unknown }).parameterId === "bodyType",
        ) as { value?: unknown } | undefined
      : undefined;
    return record.featureType === "extrude" &&
      typeof record.featureId === "string" &&
      record.featureId.length > 0 &&
      bodyType?.value === "SURFACE"
      ? [{ featureId: record.featureId, rollbackIndex: index + 1 }]
      : [];
  });
}

/**
 * Retain rollback geometry only for bake boundaries that are still proven by
 * the immutable feature history. Enrichment never recaptures geometry, and a
 * `null` value remains an honest record that required boundary capture was
 * unavailable.
 */
function retainIntrinsicBakeRollbackSnapshots(
  studio: OnshapePartStudioCapture,
): OnshapeRollbackSnapshot[] | null {
  if (studio.rollbackSnapshots === null) return null;
  const boundaryFeatureIds = new Set(
    collectIntrinsicBakeRollbackPoints(studio.features).map((point) => point.featureId),
  );
  return studio.rollbackSnapshots.filter((snapshot) => boundaryFeatureIds.has(snapshot.featureId));
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
