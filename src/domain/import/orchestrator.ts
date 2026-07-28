import type {
  ImportCapabilities,
  ImportHistoryProbeCapabilities,
  HistoryProbeTopologySignature,
} from "@/contracts/import/capabilities";
import type {
  ImportDeferredExtrudeEndCondition,
  ImportDeferredExtrudeExtent,
  ImportDeferredExtrudeStartExtent,
  ImportDeferredSketchEntityRef,
  ImportDeferredSketchPointRef,
  ImportDeferredTopologyRef,
  ImportDeferredValue,
  ImportPreparedActions,
  ImportPreparedActionRef,
  ImportCommitSketchRequest,
} from "@/contracts/import/actions";
import { validateImportOrderedActionsInvariants } from "@/contracts/import/validation";
import type { ImportProvider } from "@/contracts/import/provider";
import type { ImportResult } from "@/contracts/import/result";
import type { ImportReviewEnvelope } from "@/contracts/import/review";
import type { ResolvedImportSource } from "@/contracts/import/source";
import type {
  BakedMeshGeometryAssetData,
  GeometryAssetFormat,
  GeometryAssetRecord,
  GeometryAssetProvenance,
} from "@/contracts/modeling/geometry-assets";
import { requireBakedMeshGeometryAssetData } from "@/contracts/modeling/geometry-assets.runtime-schema";
import type {
  CommitSketchRequest,
  CreateFeatureRequest,
  ExtrudeEndCondition,
  ExtrudeFeatureExtent,
  ExtrudeStartExtent,
  ModelingDiagnostic,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import type { BodyId, ConstructionId, FeatureId, SketchId } from "@/contracts/shared/ids";
import type { RegionRecord, SketchRecord } from "@/contracts/sketch/schema";
import {
  CONTRACT_VERSION,
  GEOMETRY_ASSET_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";
import {
  createMemoryGeometryAssetStore,
  hashGeometryAssetBytes,
  type GeometryAssetStore,
} from "@/domain/modeling/geometry-asset-store";
import { validateGeometryAssetRecord } from "@/contracts/modeling/geometry-assets.runtime-schema";
import { registerEmbeddedBinaryAsset } from "@/domain/modeling/embedded-binary-asset-registry";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import {
  selectInnermostContainingRegion,
  type RegionSelectionSketch,
} from "@/domain/import/region-containment";
import { describeUnknownError } from "@/contracts/errors";
import { matchSignature } from "@/domain/import/onshape/signature-matcher";
import { deriveLiveBodySignatures } from "@/domain/import/live-body-signatures";
import type { DurableRef } from "@/contracts/shared/references";
import { requireAcceptedModelingResult } from "@/lib/reported-action";

export async function resolveLocalFileImportSource(
  file: File,
): Promise<ResolvedImportSource> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fingerprint = await hashGeometryAssetBytes(bytes);

  return {
    name: file.name,
    origin: {
      kind: "localFile",
      fileName: file.name,
    },
    mediaType: file.type.trim().length > 0 ? file.type : null,
    bytes,
    fingerprint,
  };
}

export type ImportCapabilityErrorCode =
  | "import-capability-unsupported-format"
  | "import-capability-invalid-geometry"
  | "import-capability-storage-failed";

export class ImportCapabilityError extends Error {
  readonly code: ImportCapabilityErrorCode;
  readonly format?: GeometryAssetFormat;
  readonly diagnostic?: ModelingDiagnostic;

  constructor(input: {
    code: ImportCapabilityErrorCode;
    message: string;
    format?: GeometryAssetFormat;
    diagnostic?: ModelingDiagnostic;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "ImportCapabilityError";
    this.code = input.code;
    this.format = input.format;
    this.diagnostic = input.diagnostic;
  }
}

const bakeableGeometryFormats = new Set<GeometryAssetFormat>(["baked-mesh"]);

function parseBakedMeshGeometry(
  bytes: Uint8Array,
  format: GeometryAssetFormat,
): BakedMeshGeometryAssetData {
  if (format !== "baked-mesh") {
    throw new ImportCapabilityError({
      code: "import-capability-unsupported-format",
      format,
      message: `Geometry baking cannot parse ${format} as baked mesh geometry.`,
    });
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return requireBakedMeshGeometryAssetData(parsed);
  } catch (error) {
    throw new ImportCapabilityError({
      code: "import-capability-invalid-geometry",
      format,
      message:
        "Baked mesh geometry bytes must be valid, partitioned baked-mesh JSON.",
      cause: error,
    });
  }
}

function mediaTypeForGeometryFormat(format: GeometryAssetFormat) {
  switch (format) {
    case "baked-mesh":
      return "application/vnd.cadara-baked-mesh+json";
    case "cadara-brep":
      return "application/vnd.cadara-brep+json";
    case "step":
      return "model/step";
    case "stl":
      return "model/stl";
    case "3mf":
      return "model/3mf";
    case "baked-occ":
      return "application/vnd.cadara-baked-occ";
  }
}

export function createImportCapabilities(
  _modelingService: ModelingService,
  snapshot: WorkspaceSnapshot,
  options: {
    history?: ImportHistoryProbeCapabilities;
    assetStore?: GeometryAssetStore;
  } = {},
): ImportCapabilities {
  const assetStore = options.assetStore ?? createMemoryGeometryAssetStore();
  return {
    context: {
      contractVersion: CONTRACT_VERSION,
      documentId: snapshot.document.documentId,
      baseRevisionId: snapshot.document.revisionId,
    },
    modeling: {
      async bakeGeometry(input) {
        if (!bakeableGeometryFormats.has(input.format)) {
          throw new ImportCapabilityError({
            code: "import-capability-unsupported-format",
            format: input.format,
            message: `Geometry baking does not support ${input.format} assets on this platform.`,
          });
        }

        const hash = await hashGeometryAssetBytes(input.bytes);
        const assetId =
          `asset_baked_${hash.slice("sha256:".length, "sha256:".length + 16)}` as const;
        const data = parseBakedMeshGeometry(input.bytes, input.format);
        const provenance: GeometryAssetProvenance = {
          kind: "generated",
          generator: "cadara-import-bakeGeometry",
          sourceHash: hash,
        };
        const asset: GeometryAssetRecord = {
          schemaVersion: GEOMETRY_ASSET_SCHEMA_VERSION,
          assetId,
          hash,
          byteLength: input.bytes.byteLength,
          format: input.format,
          mediaType: mediaTypeForGeometryFormat(input.format),
          provenance,
          data,
          ownerFeatureIds: [],
        };

        const validation = validateGeometryAssetRecord(asset);
        if (!validation.success) {
          throw new ImportCapabilityError({
            code: "import-capability-invalid-geometry",
            format: input.format,
            message:
              validation.issues[0]?.message ??
              `Invalid ${input.format} geometry asset payload.`,
          });
        }

        const stored = await assetStore.put({ asset, bytes: input.bytes });
        if (!stored.ok) {
          throw new ImportCapabilityError({
            code: "import-capability-storage-failed",
            format: input.format,
            diagnostic: stored.diagnostic,
            message: stored.diagnostic.message,
          });
        }

        // Return a self-describing reference: the definition that will carry it
        // must be sufficient to reconstruct the store record on reload, with no
        // session-scoped registry.
        return {
          assetId: asset.assetId,
          format: asset.format,
          hash: asset.hash,
          byteLength: asset.byteLength,
        };
      },
      async reconstructMeshToBrep() {
        throw new Error("Mesh-to-B-rep reconstruction is not implemented yet.");
      },
    },
    sketch: {
      async convertVectorToSketch() {
        throw new Error("Vector-to-sketch conversion is not implemented yet.");
      },
    },
    assets: {
      async registerGeometryAsset() {
        throw new Error("Geometry asset registration is not implemented yet.");
      },
      async storeEmbeddedBinary(input) {
        const hash = await hashGeometryAssetBytes(input.bytes);
        const assetId = `asset_embedded_${hash.slice("sha256:".length, "sha256:".length + 16)}`;
        registerEmbeddedBinaryAsset({
          assetId,
          bytes: input.bytes,
          mediaType: input.mediaType,
        });
        return assetId;
      },
    },
    ...(options.history ? { history: options.history } : {}),
  };
}

export function toImportModelingDiagnostics(
  diagnostics: readonly {
    severity: ModelingDiagnostic["severity"];
    message: string;
    code?: string;
  }[],
): ModelingDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code ?? "import-diagnostic",
    severity: diagnostic.severity,
    message: diagnostic.message,
    target: null,
    detail: null,
  }));
}

export async function createImportSession(input: {
  provider: ImportProvider<unknown, unknown, FeatureEditorFormSchema>;
  source: ResolvedImportSource;
  capabilities: ImportCapabilities;
}) {
  const review = await input.provider.review({
    source: input.source,
    capabilities: input.capabilities,
  });
  const selections = input.provider.createDefaultSelections(review);

  return {
    providerId: input.provider.id,
    resolvedSource: input.source,
    review,
    selections,
    formSchema: input.provider.getReviewFormSchema(review, selections),
    diagnostics: [],
  };
}

export interface ImportActionOutputRecord {
  sketchId?: SketchId;
  bodyIds?: BodyId[];
  constructionIds?: ConstructionId[];
  featureId?: FeatureId;
}

type ImportRegionSketchSource =
  | SketchRecord
  | WorkspaceSnapshot["document"]["sketches"][number];

export function orderedOutputKey(actionIndex: number) {
  return `ordered:${actionIndex}`;
}

function isDeferredValue(value: unknown): value is ImportDeferredValue {
  if (!value || typeof value !== "object") {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "sketchIdOf" ||
    kind === "regionOf" ||
    kind === "bodyOf" ||
    kind === "constructionOf" ||
    kind === "featureOf"
  );
}

function isDeferredTopologyRef(value: unknown): value is ImportDeferredTopologyRef {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { kind?: unknown }).kind === "topologyOf",
  );
}

function isDeferredSketchTargetRef(
  value: unknown,
): value is (ImportDeferredSketchEntityRef | ImportDeferredSketchPointRef) & {
  sketchId: Extract<ImportDeferredValue, { kind: "sketchIdOf" }>;
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      ((value as { kind?: unknown }).kind === "sketchEntity" ||
        (value as { kind?: unknown }).kind === "sketchPoint") &&
      isDeferredValue((value as { sketchId?: unknown }).sketchId),
  );
}

export class TopologyApplyRematchError extends Error {
  readonly selector: ImportDeferredTopologyRef;
  /**
   * Zero/one/many detail for the live match that failed, preserved verbatim so a
   * contained bake names the real mismatch instead of only its reason code.
   * Purely diagnostic; it never participates in matching.
   */
  readonly detail: string | null;

  constructor(selector: ImportDeferredTopologyRef, detail: string | null = null) {
    super(
      `Live topology rematch failed for ${selector.source.consumerFeatureId}:${selector.source.parameterId}:${selector.source.deterministicId}.`,
    );
    this.name = "TopologyApplyRematchError";
    this.selector = selector;
    this.detail = detail;
  }
}

/**
 * Structural guard so the review/apply seam can recognize an apply-time topology
 * rematch failure without relying on `instanceof` surviving module boundaries.
 */
export function isTopologyApplyRematchError(
  error: unknown,
): error is TopologyApplyRematchError {
  return (
    error instanceof TopologyApplyRematchError ||
    (error instanceof Error &&
      error.name === "TopologyApplyRematchError" &&
      typeof (error as { selector?: unknown }).selector === "object" &&
      (error as { selector?: unknown }).selector !== null)
  );
}

/**
 * Zero/one/many detail for an apply-time rematch failure: which live candidates
 * were rejected and on which analytic gates, or which candidates tied, plus a
 * census of the live prefix the match ran against. Same shape as the review-time
 * flywheel detail, so a contained bake names the real next root cause. Purely
 * diagnostic.
 */
function describeApplyRematchFailure(
  selector: ImportDeferredTopologyRef,
  match: ReturnType<typeof matchSignature>,
  signatures: readonly HistoryProbeTopologySignature[],
) {
  const refLabel = (reference: DurableRef) =>
    reference.kind === "body"
      ? reference.bodyId
      : reference.kind === "face"
        ? reference.faceId
        : reference.kind === "edge"
          ? reference.edgeId
          : reference.kind === "vertex"
            ? reference.vertexId
            : reference.kind;
  const parts = [
    `wants ${selector.expectedKind} for ${selector.source.deterministicId}; live match ${match.kind}`,
  ];
  if (match.kind === "noMatch") {
    const rejected = match.rejected
      .map((entry) => `${refLabel(entry.reference)}: ${entry.reasons.join(",")}`)
      .join(" | ");
    parts.push(rejected.length > 0 ? `rejected ${rejected}` : "rejected nothing");
  }
  if (match.kind === "ambiguous") {
    parts.push(
      `tied ${match.candidates
        .map((entry) => `${refLabel(entry.reference)}@${entry.score}`)
        .join(" | ")}`,
    );
  }
  if (match.kind === "unique") {
    parts.push(`resolved ${refLabel(match.reference)} of kind ${match.reference.kind}`);
  }
  const census = new Map<string, number>();
  for (const signature of signatures) {
    const key = `${signature.entityClass}/${signature.geometryType}`;
    census.set(key, (census.get(key) ?? 0) + 1);
  }
  parts.push(
    `live prefix ${signatures.length}: ${
      [...census].map(([key, count]) => `${key}x${count}`).join(",") || "empty"
    }`,
  );
  return parts.join(" || ");
}

function getSketchRegions(
  sketch: ImportRegionSketchSource,
): readonly RegionRecord[] {
  const candidate = sketch as ImportRegionSketchSource & {
    regions?: RegionRecord[];
    sketch?: { regions?: RegionRecord[] };
  };
  return candidate.regions ?? candidate.sketch?.regions ?? [];
}

function getSketchSolvedPoints(sketch: ImportRegionSketchSource) {
  const candidate = sketch as ImportRegionSketchSource & {
    sketch?: { solvedSnapshot?: SketchRecord["solvedSnapshot"] };
    solvedSnapshot?: SketchRecord["solvedSnapshot"];
  };
  return (
    candidate.solvedSnapshot?.solvedPoints ??
    candidate.sketch?.solvedSnapshot?.solvedPoints ??
    []
  );
}

function getSketchDefinition(
  sketch: ImportRegionSketchSource,
): SketchRecord["definition"] {
  const candidate = sketch as ImportRegionSketchSource & {
    sketch?: { definition?: SketchRecord["definition"] };
    definition?: SketchRecord["definition"];
  };
  return (
    candidate.definition ??
    candidate.sketch?.definition ?? {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
      styleIds: [],
      styles: [],
      svgRenderingEnabled: true,
      derivedRelationships: [],
      authoringOperations: [],
    }
  );
}

function toSelectionSketch(
  sketch: ImportRegionSketchSource,
): RegionSelectionSketch {
  return {
    regions: getSketchRegions(sketch),
    solvedPoints: new Map(
      getSketchSolvedPoints(sketch).map(
        (point) => [point.pointId, point.solvedPosition] as const,
      ),
    ),
    definition: getSketchDefinition(sketch),
  };
}

export class ImportDeferredMaterializer {
  private readonly input: {
    modelingService: Pick<
      ModelingService,
      "getCurrentDocumentSnapshot" | "buildNativeExactBrepPayload"
    >;
    outputRecords: Map<string, ImportActionOutputRecord>;
  };
  private topologyFallbackSource: ImportDeferredTopologyRef["source"] | null = null;

  constructor(input: {
    modelingService: Pick<
      ModelingService,
      "getCurrentDocumentSnapshot" | "buildNativeExactBrepPayload"
    >;
    outputRecords: Map<string, ImportActionOutputRecord>;
  }) {
    this.input = input;
  }

  recordSketchOutput(orderedPosition: number, sketchId: SketchId) {
    this.input.outputRecords.set(orderedOutputKey(orderedPosition), {
      sketchId,
    });
  }

  recordBodyOutput(orderedPosition: number, bodyIds: BodyId[]) {
    const key = orderedOutputKey(orderedPosition);
    const existing = this.input.outputRecords.get(key) ?? {};
    this.input.outputRecords.set(key, { ...existing, bodyIds });
  }

  recordFeatureOutput(orderedPosition: number, featureId: FeatureId) {
    const key = orderedOutputKey(orderedPosition);
    const existing = this.input.outputRecords.get(key) ?? {};
    this.input.outputRecords.set(key, { ...existing, featureId });
  }

  recordConstructionOutput(
    orderedPosition: number,
    constructionIds: ConstructionId[],
  ) {
    const key = orderedOutputKey(orderedPosition);
    const existing = this.input.outputRecords.get(key) ?? {};
    this.input.outputRecords.set(key, { ...existing, constructionIds });
  }

  takeTopologyFallbackSource() {
    const source = this.topologyFallbackSource;
    this.topologyFallbackSource = null;
    return source;
  }

  async resolveDeferredTopologyRef(
    selector: ImportDeferredTopologyRef,
  ): Promise<DurableRef> {
    const snapshot = await this.input.modelingService.getCurrentDocumentSnapshot();
    const signatureResult = await deriveLiveBodySignatures({
      snapshot,
      service: this.input.modelingService,
    });
    const signatures: HistoryProbeTopologySignature[] =
      signatureResult.status === "available" ? signatureResult.signatures : [];
    const match = matchSignature(
      selector.capturedSignature,
      signatures,
      selector.tolerance,
    );
    if (match.kind !== "unique" || match.reference.kind !== selector.expectedKind) {
      // An unavailable signature derivation is not a no-match: its own
      // diagnostics are the real cause and must not be dropped on the floor.
      const unavailable =
        signatureResult.status === "available"
          ? null
          : `live signatures unavailable: ${signatureResult.diagnostics
              .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
              .join(" | ")}`;
      throw new TopologyApplyRematchError(
        selector,
        [describeApplyRematchFailure(selector, match, signatures), unavailable]
          .filter((part): part is string => part !== null)
          .join(" || "),
      );
    }
    return match.reference;
  }

  async resolveDeferredBodyId(selector: ImportDeferredTopologyRef): Promise<BodyId> {
    const reference = await this.resolveDeferredTopologyRef(selector);
    if (reference.kind !== "body") {
      throw new TopologyApplyRematchError(
        selector,
        `live match resolved a ${reference.kind}, but the consumer needs a body`,
      );
    }
    return reference.bodyId;
  }

  async resolveDeferredValue(
    value: ImportDeferredValue,
    consumer: ImportPreparedActionRef,
  ) {
    const output = this.input.outputRecords.get(
      orderedOutputKey(value.actionIndex),
    );
    if (!output) {
      throw new Error(
        `Unable to resolve deferred ${value.kind} for ${consumer.kind}:${consumer.index}; producer action ${value.actionIndex} has no recorded output.`,
      );
    }

    switch (value.kind) {
      case "sketchIdOf": {
        if (!output.sketchId) {
          throw new Error(
            `Unable to resolve deferred sketchIdOf for ${consumer.kind}:${consumer.index}; producer action ${value.actionIndex} produced no sketch id.`,
          );
        }
        return output.sketchId;
      }
      case "bodyOf": {
        const bodyIds = output.bodyIds ?? [];
        if (bodyIds.length !== 1) {
          throw new Error(
            `Unable to resolve deferred bodyOf for ${consumer.kind}:${consumer.index}; producer action ${value.actionIndex} produced ${bodyIds.length} body ids, expected exactly one.`,
          );
        }
        return bodyIds[0]!;
      }
      case "constructionOf": {
        const constructionId = output.constructionIds?.[0];
        if (!constructionId) {
          throw new Error(
            `Unable to resolve deferred constructionOf for ${consumer.kind}:${consumer.index}; producer action ${value.actionIndex} produced no construction id.`,
          );
        }
        return { kind: "construction" as const, constructionId };
      }
      case "featureOf": {
        if (!output.featureId) {
          throw new Error(
            `Unable to resolve deferred featureOf for ${consumer.kind}:${consumer.index}; producer action ${value.actionIndex} produced no feature id.`,
          );
        }
        return output.featureId;
      }
      case "regionOf": {
        if (!output.sketchId) {
          throw new Error(
            `Unable to resolve deferred regionOf for ${consumer.kind}:${consumer.index}; producer action ${value.actionIndex} produced no sketch id; selector ${JSON.stringify(value.selector)}.`,
          );
        }
        const snapshot =
          await this.input.modelingService.getCurrentDocumentSnapshot();
        const sketch = snapshot.document.sketches.find(
          (candidate) => candidate.sketchId === output.sketchId,
        );
        const region = sketch
          ? selectInnermostContainingRegion(
              toSelectionSketch(sketch),
              value.selector.point,
            )
          : null;
        if (!region) {
          throw new Error(
            `Unable to resolve deferred regionOf for ${consumer.kind}:${consumer.index}; reference action ${value.actionIndex}, sketch ${output.sketchId}, selector ${JSON.stringify(value.selector)}.`,
          );
        }
        return {
          kind: "region" as const,
          sketchId: output.sketchId,
          regionId: region.regionId,
        };
      }
    }
  }

  private async materializeExtrudeEnd(
    end: ImportDeferredExtrudeEndCondition,
    consumer: ImportPreparedActionRef,
  ): Promise<ExtrudeEndCondition> {
    if (
      end.kind !== "upToFace" &&
      end.kind !== "upToPart" &&
      end.kind !== "upToVertex"
    ) {
      return end;
    }

    // An up-to-vertex extent may terminate at an exact authored sketch point
    // committed earlier in this import; only its owning sketch id is deferred.
    if (
      end.kind === "upToVertex" &&
      end.target.kind === "sketchPoint" &&
      isDeferredValue(end.target.sketchId)
    ) {
      return {
        ...end,
        target: {
          ...end.target,
          sketchId: (await this.resolveDeferredValue(
            end.target.sketchId,
            consumer,
          )) as SketchId,
        },
      };
    }

    const target = isDeferredTopologyRef(end.target)
      ? await this.resolveDeferredTopologyRef(end.target)
      : end.target;
    const expectedKind =
      end.kind === "upToFace"
        ? "face"
        : end.kind === "upToPart"
          ? "body"
          : "vertex";
    if (target.kind !== expectedKind && target.kind !== "sketchPoint") {
      throw new Error(
        `Deferred ${end.kind} target resolved as ${target.kind}, expected ${expectedKind}.`,
      );
    }
    return { ...end, target } as Extract<ExtrudeEndCondition, { kind: typeof end.kind }>;
  }

  /** Resolve the sketch id of a deferred sketch-point start offset. */
  private async materializeExtrudeStartExtent(
    startExtent: ImportDeferredExtrudeStartExtent,
    consumer: ImportPreparedActionRef,
  ): Promise<ExtrudeStartExtent> {
    if (
      startExtent.kind !== "sketchPointOffset" ||
      !isDeferredValue(startExtent.target.sketchId)
    ) {
      return startExtent as ExtrudeStartExtent;
    }
    return {
      ...startExtent,
      target: {
        ...startExtent.target,
        sketchId: (await this.resolveDeferredValue(
          startExtent.target.sketchId,
          consumer,
        )) as SketchId,
      },
    };
  }
  private async materializeExtrudeExtent(
    extent: ImportDeferredExtrudeExtent,
    consumer: ImportPreparedActionRef,
  ): Promise<ExtrudeFeatureExtent> {
    if (extent.mode === "twoSide") {
      return {
        mode: "twoSide",
        firstEnd: await this.materializeExtrudeEnd(extent.firstEnd, consumer),
        secondEnd: await this.materializeExtrudeEnd(extent.secondEnd, consumer),
      };
    }
    return {
      ...extent,
      end: await this.materializeExtrudeEnd(extent.end, consumer),
    } as ExtrudeFeatureExtent;
  }

  async materializeFeatureRequest(
    request: ImportPreparedActions["createFeatures"] extends
      | (infer Entry)[]
      | undefined
      ? Entry
      : never,
    consumer: ImportPreparedActionRef,
  ): Promise<CreateFeatureRequest> {
    try {
      return await this.materializeFeatureRequestUnchecked(request, consumer);
    } catch (error) {
      if (!(error instanceof TopologyApplyRematchError) || !request.topologyFallback) {
        throw error;
      }
      this.topologyFallbackSource = error.selector.source;
      return this.materializeFeatureRequestUnchecked(
        request.topologyFallback,
        consumer,
      );
    }
  }

  private async materializeFeatureRequestUnchecked(
    request: ImportPreparedActions["createFeatures"] extends
      | (infer Entry)[]
      | undefined
      ? Entry
      : never,
    consumer: ImportPreparedActionRef,
  ): Promise<CreateFeatureRequest> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-sibling destructuring strips `topologyFallback` from the forwarded request.
    const { topologyFallback: _topologyFallback, ...requestWithoutFallback } = request;
    if (request.definition?.kind === "bakedBody") {
      const replacement = request.definition.parameters.replacement;
      const bodyIds = Array.from(
        new Set(
          replacement.actionIndexes.flatMap((actionIndex) => {
            const output = this.input.outputRecords.get(orderedOutputKey(actionIndex));
            if (!output) {
              throw new Error(
                `Unable to resolve baked checkpoint replacement for ${consumer.kind}:${consumer.index}; producer action ${actionIndex} has no recorded output.`,
              );
            }
            return output.bodyIds ?? [];
          }),
        ),
      );
      return {
        ...requestWithoutFallback,
        definition: {
          ...request.definition,
          parameters: {
            ...request.definition.parameters,
            replacement: { kind: "replaceBodies", bodyIds },
          },
        },
      };
    }

    if (!request.definition) {
      return requestWithoutFallback as CreateFeatureRequest;
    }

    if (request.definition.kind === "featureReplay") {
      const sourceFeatureIds = await Promise.all(
        request.definition.parameters.sourceFeatureIds.map((sourceFeatureId) =>
          isDeferredValue(sourceFeatureId)
            ? this.resolveDeferredValue(sourceFeatureId, consumer)
            : sourceFeatureId,
        ),
      );
      return {
        ...requestWithoutFallback,
        definition: {
          ...request.definition,
          parameters: { ...request.definition.parameters, sourceFeatureIds },
        },
      } as CreateFeatureRequest;
    }

    if (request.definition.kind === "fillet") {
      const edgeTargets = await Promise.all(
        request.definition.parameters.edgeTargets.map((target) =>
          isDeferredTopologyRef(target)
            ? this.resolveDeferredTopologyRef(target)
            : target,
        ),
      );
      return {
        ...requestWithoutFallback,
        definition: {
          ...request.definition,
          parameters: { ...request.definition.parameters, edgeTargets },
        },
      } as CreateFeatureRequest;
    }

    if (request.definition.kind === "shell") {
      const parameters = request.definition.parameters;
      const bodyTarget = isDeferredTopologyRef(parameters.bodyTarget)
        ? await this.resolveDeferredTopologyRef(parameters.bodyTarget)
        : parameters.bodyTarget;
      const faceTargets = await Promise.all(
        parameters.faceTargets.map((target) =>
          isDeferredTopologyRef(target)
            ? this.resolveDeferredTopologyRef(target)
            : target,
        ),
      );
      return {
        ...requestWithoutFallback,
        definition: {
          ...request.definition,
          parameters: { ...parameters, bodyTarget, faceTargets },
        },
      } as CreateFeatureRequest;
    }

    if (
      request.definition.kind === "plane" &&
      request.definition.parameters.mode === "coplanar"
    ) {
      const target = request.definition.parameters.reference.target;
      const materialized = isDeferredTopologyRef(target)
        ? await this.resolveDeferredTopologyRef(target)
        : target;
      return {
        ...requestWithoutFallback,
        definition: {
          ...request.definition,
          parameters: {
            ...request.definition.parameters,
            reference: { target: materialized },
          },
        },
      } as CreateFeatureRequest;
    }

    const advancedParameters = request.definition.parameters as
      | {
          participants?: readonly {
            role: string;
            targets: readonly (
              | DurableRef
              | ImportDeferredTopologyRef
              | ImportDeferredSketchEntityRef
              | ImportDeferredSketchPointRef
              | Extract<ImportDeferredValue, { kind: "regionOf" | "constructionOf" }>
            )[];
          }[];
        }
      | undefined;
    if (advancedParameters?.participants) {
      const participants = await Promise.all(
        advancedParameters.participants.map(async (participant) => ({
          ...participant,
          targets: await Promise.all(
            participant.targets.map(async (target) => {
              if (isDeferredTopologyRef(target)) {
                return this.resolveDeferredTopologyRef(target);
              }
              if (isDeferredSketchTargetRef(target)) {
                return {
                  ...target,
                  sketchId: await this.resolveDeferredValue(
                    target.sketchId,
                    consumer,
                  ),
                };
              }
              if (isDeferredValue(target)) {
                return this.resolveDeferredValue(target, consumer);
              }
              return target;
            }),
          ),
        })),
      );
      return {
        ...requestWithoutFallback,
        definition: {
          ...request.definition,
          parameters: { ...request.definition.parameters, participants },
        },
      } as CreateFeatureRequest;
    }

    if (
      request.definition.kind !== "extrude" &&
      request.definition.kind !== "revolve"
    ) {
      return requestWithoutFallback as CreateFeatureRequest;
    }

    const profiles = await Promise.all(
      request.definition.parameters.profiles.map(async (profile) => {
        if (isDeferredTopologyRef(profile)) {
          return this.resolveDeferredTopologyRef(profile);
        }
        return isDeferredValue(profile)
          ? this.resolveDeferredValue(profile, consumer)
          : profile;
      }),
    );
    const booleanScope = request.definition.parameters.booleanScope;
    const materializedBooleanScope =
      booleanScope.kind === "targetBody"
        ? {
            ...booleanScope,
            bodyId: isDeferredTopologyRef(booleanScope.bodyId)
              ? await this.resolveDeferredBodyId(booleanScope.bodyId)
              : isDeferredValue(booleanScope.bodyId)
                ? await this.resolveDeferredValue(booleanScope.bodyId, consumer)
                : booleanScope.bodyId,
          }
        : booleanScope.kind === "targetBodies"
          ? {
              ...booleanScope,
              bodyIds: await Promise.all(
                booleanScope.bodyIds.map((bodyId) =>
                  isDeferredTopologyRef(bodyId)
                    ? this.resolveDeferredBodyId(bodyId)
                    : bodyId,
                ),
              ),
            }
          : booleanScope;

    const extent =
      request.definition.kind === "extrude"
        ? await this.materializeExtrudeExtent(
            request.definition.parameters.extent,
            consumer,
          )
        : null;
    const startExtent =
      request.definition.kind === "extrude"
        ? await this.materializeExtrudeStartExtent(
            request.definition.parameters.startExtent,
            consumer,
          )
        : null;

    if (request.definition.kind === "revolve") {
      const axis = request.definition.parameters.axis;
      const materializedAxis =
        axis.kind === "sketchEntity" && isDeferredValue(axis.sketchId)
          ? {
              ...axis,
              sketchId: await this.resolveDeferredValue(axis.sketchId, consumer),
            }
          : axis;
      return {
        ...requestWithoutFallback,
        definition: {
          ...request.definition,
          parameters: {
            ...request.definition.parameters,
            profiles,
            axis: materializedAxis,
            booleanScope: materializedBooleanScope,
          },
        },
      } as unknown as CreateFeatureRequest;
    }
    return {
      ...requestWithoutFallback,
      definition: {
        ...request.definition,
        parameters: {
          ...request.definition.parameters,
          profiles,
          extent: extent!,
          startExtent: startExtent!,
          booleanScope: materializedBooleanScope,
        },
      },
    } as unknown as CreateFeatureRequest;
  }

  async materializeCommitSketchRequest(
    request: ImportCommitSketchRequest,
    consumer: ImportPreparedActionRef,
  ): Promise<CommitSketchRequest> {
    const support = request.plane.support;
    if (isDeferredTopologyRef(support)) {
      const resolvedSupport = await this.resolveDeferredTopologyRef(support);
      return {
        ...request,
        plane: { ...request.plane, support: resolvedSupport },
      } as CommitSketchRequest;
    }
    if (!isDeferredValue(support)) {
      return request as unknown as CommitSketchRequest;
    }
    const resolvedSupport = await this.resolveDeferredValue(support, consumer);
    return {
      ...request,
      plane: {
        ...request.plane,
        support: resolvedSupport,
      },
    } as unknown as CommitSketchRequest;
  }
}

export async function applyImportPreparedActions(input: {
  modelingService: ModelingService;
  baseRevisionId: WorkspaceSnapshot["document"]["revisionId"];
  actions: ImportPreparedActions;
  /**
   * Reverts the last `appliedOperationCount` committed operations to keep the
   * import atomic on mid-sequence failure. Injected by the caller because the
   * durable-history revert lives at the repository layer; called once with the
   * number of operations that were applied before the failure.
   */
  rollback?: (appliedOperationCount: number) => Promise<void>;
}) {
  let revisionId = input.baseRevisionId;
  const diagnostics: ModelingDiagnostic[] = [
    ...toImportModelingDiagnostics(input.actions.diagnostics ?? []),
  ];
  const createdEntityIds: ImportResult["createdEntityIds"] = {
    featureIds: [],
    sketchIds: [],
    variableIds: [],
  };
  let appliedOperationCount = 0;
  const outputRecords = new Map<string, ImportActionOutputRecord>();
  let currentOrderedPosition = -1;

  const materializer = new ImportDeferredMaterializer({
    modelingService: input.modelingService,
    outputRecords,
  });

  const applyVariable = async (index: number) => {
    const request = (input.actions.addDocumentVariables ?? [])[index];
    const result = await input.modelingService.addDocumentVariable({
      ...request,
      baseRevisionId: revisionId,
    });
    if (result.isErr()) throw result.error;

    diagnostics.push(...result.value.diagnostics);
    const accepted = requireAcceptedModelingResult(result.value, {
      operation: `Import variable ${request.name}`,
      fallbackMessage: `Import variable ${request.name} failed.`,
    });
    if (accepted.isErr()) throw accepted.error;

    revisionId = accepted.value.revisionId;
    createdEntityIds.variableIds.push(accepted.value.variableId);
    appliedOperationCount += 1;
    const errorDiagnostic = accepted.value.diagnostics.find(
      (diagnostic) => diagnostic.severity === "error",
    );
    if (errorDiagnostic) throw new Error(errorDiagnostic.message);
  };

  const applyFeature = async (index: number) => {
    const request = (input.actions.createFeatures ?? [])[index];
    const consumer = { kind: "createFeature" as const, index };
    const materialized = await materializer.materializeFeatureRequest(request, consumer);
    const fallbackSource = materializer.takeTopologyFallbackSource();
    const result = await input.modelingService.createFeature({
      ...materialized,
      baseRevisionId: revisionId,
    });
    if (fallbackSource) {
      diagnostics.push({
        code: "topology-apply-rematch-failed",
        severity: "warning",
        message: `Topology rematch changed before apply for ${fallbackSource.consumerFeatureId}:${fallbackSource.parameterId}:${fallbackSource.deterministicId}; the captured post-feature checkpoint was used.`,
        target: null,
        detail: null,
      });
    }
    if (result.isErr()) throw result.error;

    diagnostics.push(...result.value.diagnostics);
    const accepted = requireAcceptedModelingResult(result.value, {
      operation: `Import feature ${request.featureLabel ?? request.definition.kind}`,
      fallbackMessage: `Import feature ${request.featureLabel ?? request.definition.kind} failed.`,
    });
    if (accepted.isErr()) throw accepted.error;

    revisionId = accepted.value.revisionId;
    createdEntityIds.featureIds.push(accepted.value.featureId);
    if (currentOrderedPosition >= 0) {
      materializer.recordFeatureOutput(
        currentOrderedPosition,
        accepted.value.featureId,
      );
    }
    const bodyIds = accepted.value.changedTargets.flatMap((target) =>
      target.kind === "body" ? [target.bodyId] : [],
    );
    const constructionIds = accepted.value.changedTargets.flatMap((target) =>
      target.kind === "construction" ? [target.constructionId] : [],
    );
    if (currentOrderedPosition >= 0) {
      materializer.recordBodyOutput(currentOrderedPosition, bodyIds);
      if (constructionIds.length > 0) {
        materializer.recordConstructionOutput(
          currentOrderedPosition,
          constructionIds,
        );
      }
    }
    appliedOperationCount += 1;
    const errorDiagnostic = accepted.value.diagnostics.find(
      (diagnostic) => diagnostic.severity === "error",
    );
    if (errorDiagnostic) throw new Error(errorDiagnostic.message);
  };

  const applySketch = async (index: number) => {
    const request = (input.actions.commitSketches ?? [])[index];
    const consumer = { kind: "commitSketch" as const, index };
    const result = await input.modelingService.commitSketch({
      ...(await materializer.materializeCommitSketchRequest(request, consumer)),
      baseRevisionId: revisionId,
    });
    if (result.isErr()) throw result.error;

    diagnostics.push(...result.value.diagnostics);
    const accepted = requireAcceptedModelingResult(result.value, {
      operation: `Import sketch ${request.sketchLabel}`,
      fallbackMessage: `Import sketch ${request.sketchLabel} failed.`,
    });
    if (accepted.isErr()) throw accepted.error;

    revisionId = accepted.value.revisionId;
    createdEntityIds.sketchIds.push(accepted.value.sketchId);
    if (currentOrderedPosition >= 0) {
      materializer.recordSketchOutput(
        currentOrderedPosition,
        accepted.value.sketchId,
      );
    }
    appliedOperationCount += 1;
    const errorDiagnostic = accepted.value.diagnostics.find(
      (diagnostic) => diagnostic.severity === "error",
    );
    if (errorDiagnostic) throw new Error(errorDiagnostic.message);
  };

  const applyByKind = async (ref: ImportPreparedActionRef) => {
    switch (ref.kind) {
      case "addDocumentVariable":
        return applyVariable(ref.index);
      case "createFeature":
        return applyFeature(ref.index);
      case "commitSketch":
        return applySketch(ref.index);
    }
  };

  // Build the ordered ref list for both the explicit and grouped paths, so a
  // single application loop can enforce atomic rollback uniformly.
  let refs: ImportPreparedActionRef[];
  if (input.actions.orderedActions) {
    // Reject omissions/duplicates before applying any action, keeping the
    // import atomic. Only the ordered-sequence permutation invariant is checked
    // here; per-request structural validity is the adapter's responsibility, as
    // in the grouped path.
    const issues = validateImportOrderedActionsInvariants(input.actions);
    if (issues.length > 0) {
      throw new Error(
        issues[0]?.message ?? "Invalid ordered import action sequence.",
      );
    }
    refs = input.actions.orderedActions;
  } else {
    refs = [
      ...(input.actions.addDocumentVariables ?? []).map(
        (_request, index): ImportPreparedActionRef => ({
          kind: "addDocumentVariable",
          index,
        }),
      ),
      ...(input.actions.createFeatures ?? []).map(
        (_request, index): ImportPreparedActionRef => ({
          kind: "createFeature",
          index,
        }),
      ),
      ...(input.actions.commitSketches ?? []).map(
        (_request, index): ImportPreparedActionRef => ({
          kind: "commitSketch",
          index,
        }),
      ),
    ];
  }

  let failure: unknown = null;
  for (
    let orderedPosition = 0;
    orderedPosition < refs.length;
    orderedPosition += 1
  ) {
    const ref = refs[orderedPosition]!;
    currentOrderedPosition = orderedPosition;
    try {
      await applyByKind(ref);
    } catch (error) {
      failure = error;
      break;
    }
  }

  if (failure) {
    // Atomic failure: revert every already-applied operation so no partial
    // import is committed. A rollback failure is also actionable, but it must
    // not hide the operation that made the import fail in the first place.
    let rollbackFailure: unknown = null;
    if (appliedOperationCount > 0 && input.rollback) {
      try {
        await input.rollback(appliedOperationCount);
      } catch (error) {
        rollbackFailure = error;
      }
    }

    const message = describeUnknownError(failure, "Import failed.");
    diagnostics.push({
      code: "import-apply-failed",
      severity: "error",
      message: `Import failed: ${message}`,
      target: null,
      detail: null,
    });
    if (rollbackFailure) {
      diagnostics.push({
        code: "import-rollback-failed",
        severity: "error",
        message: `Import rollback after the apply failure also failed: ${describeUnknownError(
          rollbackFailure,
          "Rollback failed.",
        )}`,
        target: null,
        detail: null,
      });
    }
    return {
      revisionId: input.baseRevisionId,
      createdEntityIds: { featureIds: [], sketchIds: [], variableIds: [] },
      diagnostics,
      appliedOperationCount,
      rolledBack: appliedOperationCount > 0 && rollbackFailure === null,
      rollbackAttempted: appliedOperationCount > 0 && input.rollback !== undefined,
    };
  }

  return {
    revisionId,
    createdEntityIds,
    diagnostics,
    appliedOperationCount,
    rolledBack: false,
    rollbackAttempted: false,
  };
}

export async function prepareImportActions<TReview, TSelections>(input: {
  provider: ImportProvider<TReview, TSelections, FeatureEditorFormSchema>;
  source: ResolvedImportSource;
  review: ImportReviewEnvelope<TReview>;
  selections: TSelections;
  capabilities: ImportCapabilities;
}) {
  return input.provider.prepare({
    source: input.source,
    review: input.review,
    selections: input.selections,
    capabilities: input.capabilities,
  });
}
