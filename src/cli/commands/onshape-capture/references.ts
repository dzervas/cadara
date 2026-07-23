import type {
  OnshapeGeometricSignature,
  OnshapeProfileEvidence,
  OnshapeResolvedQueryReference,
  OnshapeResolvedReference,
} from "@/contracts/import/onshape-capture-bundle";

import type { OnshapeClient } from "@/cli/commands/onshape-capture/client";

export interface DeterministicIdConsumer {
  deterministicId: string;
  consumingFeatureId: string;
  rollbackIndex: number;
}

export interface QueryStringConsumer {
  consumingFeatureId: string;
  parameterId: string;
  queryIndex: number;
  queryString: string;
  rollbackIndex: number;
}

/** One authored `entities` query on a solid extrude, evaluated before that extrude. */
export interface SolidExtrudeProfileQueryConsumer {
  consumingFeatureId: string;
  queryIndex: number;
  queryString: string | null;
  rollbackIndex: number;
  /** Only sketches preceding this consumer may certify qSketchRegion provenance. */
  priorSketchFeatureIds: readonly string[];
}

interface CompressedQuery {
  version: string;
  payload: string;
}

/**
 * Collect every deterministic ID referenced anywhere in a raw `getFeatures`
 * response. Deterministic IDs live in `deterministicIds` arrays on query
 * objects (`BTMIndividualQuery-138`, `BTMIndividualSketchRegionQuery-140`,
 * `BTMIndividualCreatedByQuery-137`, ...) reached through feature parameters,
 * sketch-plane queries, region queries, and constraint externals. A structural
 * walk collects all of them regardless of nesting.
 */
export function collectDeterministicIds(features: unknown): string[] {
  return [
    ...new Set(
      collectDeterministicIdConsumers(features).map(
        (consumer) => consumer.deterministicId,
      ),
    ),
  ];
}

export function collectSolidExtrudeProfileQueryConsumers(
  features: unknown,
): SolidExtrudeProfileQueryConsumer[] {
  const featureList = (features as { features?: unknown }).features;
  if (!Array.isArray(featureList)) return [];

  const consumers: SolidExtrudeProfileQueryConsumer[] = [];
  const priorSketchFeatureIds: string[] = [];
  for (const [rollbackIndex, rawFeature] of featureList.entries()) {
    if (!rawFeature || typeof rawFeature !== "object") continue;
    const feature = rawFeature as {
      featureType?: unknown;
      featureId?: unknown;
      parameters?: unknown;
    };
    if (feature.featureType === "newSketch" && typeof feature.featureId === "string") {
      priorSketchFeatureIds.push(feature.featureId);
      continue;
    }
    if (feature.featureType !== "extrude" || typeof feature.featureId !== "string") continue;
    const consumingFeatureId = feature.featureId;
    const parameters = Array.isArray(feature.parameters) ? feature.parameters : [];
    const bodyType = parameters.find(
      (parameter) =>
        parameter &&
        typeof parameter === "object" &&
        (parameter as { parameterId?: unknown }).parameterId === "bodyType",
    ) as { value?: unknown } | undefined;
    if (bodyType?.value !== undefined && bodyType.value !== "SOLID") continue;
    const entities = parameters.find(
      (parameter) =>
        parameter &&
        typeof parameter === "object" &&
        (parameter as { parameterId?: unknown }).parameterId === "entities",
    ) as { queries?: unknown } | undefined;
    const queries = entities?.queries;
    if (!Array.isArray(queries)) {
      consumers.push({
        consumingFeatureId,
        queryIndex: 0,
        queryString: null,
        rollbackIndex,
        priorSketchFeatureIds: [...priorSketchFeatureIds],
      });
      continue;
    }
    queries.forEach((query, queryIndex) => {
      consumers.push({
        consumingFeatureId,
        queryIndex,
        queryString:
          query &&
          typeof query === "object" &&
          typeof (query as { queryString?: unknown }).queryString === "string"
            ? (query as { queryString: string }).queryString
            : null,
        rollbackIndex,
        priorSketchFeatureIds: [...priorSketchFeatureIds],
      });
    });
  }
  return consumers;
}

export function collectQueryStringConsumers(features: unknown): QueryStringConsumer[] {
  const featureList = (features as { features?: unknown }).features;
  if (!Array.isArray(featureList)) return [];

  const consumers: QueryStringConsumer[] = [];
  const seen = new Set<string>();
  featureList.forEach((feature, rollbackIndex) => {
    if (!feature || typeof feature !== "object") return;
    const consumingFeatureId = (feature as { featureId?: unknown }).featureId;
    if (typeof consumingFeatureId !== "string" || consumingFeatureId.length === 0) return;

    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (typeof record.parameterId === "string" && Array.isArray(record.queries)) {
        record.queries.forEach((rawQuery, queryIndex) => {
          if (!rawQuery || typeof rawQuery !== "object") return;
          const query = rawQuery as Record<string, unknown>;
          if (
            Array.isArray(query.deterministicIds) &&
            query.deterministicIds.length === 0 &&
            typeof query.queryString === "string" &&
            query.queryString.length > 0
          ) {
            const key = `${consumingFeatureId}\u0000${record.parameterId}\u0000${queryIndex}`;
            if (!seen.has(key)) {
              seen.add(key);
              consumers.push({
                consumingFeatureId,
                parameterId: record.parameterId as string,
                queryIndex,
                queryString: query.queryString,
                rollbackIndex,
              });
            }
          }
        });
      }
      for (const value of Object.values(record)) visit(value);
    };
    visit(feature);
  });
  return consumers;
}

export function collectDeterministicIdConsumers(
  features: unknown,
): DeterministicIdConsumer[] {
  const featureList = (features as { features?: unknown }).features;
  if (!Array.isArray(featureList)) {
    return [];
  }

  const consumers: DeterministicIdConsumer[] = [];
  const seen = new Set<string>();

  featureList.forEach((feature, rollbackIndex) => {
    if (!feature || typeof feature !== "object") {
      return;
    }
    const consumingFeatureId = (feature as { featureId?: unknown }).featureId;
    if (typeof consumingFeatureId !== "string" || consumingFeatureId.length === 0) {
      return;
    }

    const ids = new Set<string>();
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) {
          visit(item);
        }
        return;
      }
      if (node && typeof node === "object") {
        const record = node as Record<string, unknown>;
        const deterministicIds = record.deterministicIds;
        if (Array.isArray(deterministicIds)) {
          for (const id of deterministicIds) {
            if (typeof id === "string" && id.length > 0) {
              ids.add(id);
            }
          }
        }
        for (const value of Object.values(record)) {
          visit(value);
        }
      }
    };

    visit(feature);
    for (const deterministicId of ids) {
      const key = `${deterministicId}\u0000${consumingFeatureId}`;
      if (!seen.has(key)) {
        seen.add(key);
        consumers.push({ deterministicId, consumingFeatureId, rollbackIndex });
      }
    }
  });

  return consumers;
}

/**
 * A decoded entity record produced by the resolution FeatureScript: a
 * deterministic-id string, entity class, optional geometry type, an axis-aligned
 * bounding box `[minX, minY, minZ, maxX, maxY, maxZ]` in meters, and any cheap
 * geometry-specific defining data (plane origin/normal, cylinder axis/radius, …).
 */
interface EntityRecord {
  id: string;
  entityClass: string;
  geometryType?: string;
  box?: number[];
  [key: string]: unknown;
}

const RECORD_META_KEYS = new Set(["id", "entityClass", "geometryType", "box"]);

/**
 * FeatureScript lambda evaluated per Part Studio at the final state
 * (`rollbackBarIndex=-1`). It enumerates every body/face/edge, maps each to its
 * deterministic-id string via `transientQueriesToStrings`, and returns a native
 * array of records `{ id, entityClass, geometryType, box, …definingData }`.
 * Entities consumed mid-history are absent (the known Onshape limitation), so
 * their ids resolve to explicit unresolved records.
 */
function buildResolutionScript(): string {
  const boxExpr =
    '[bb.minCorner[0], bb.minCorner[1], bb.minCorner[2], bb.maxCorner[0], bb.maxCorner[1], bb.maxCorner[2]]';
  return `function(context is Context, queries)
{
    var records = [];
    for (var e in evaluateQuery(context, qEverything(EntityType.BODY)))
    {
        var bb = evBox3d(context, { "topology" : e, "tight" : false });
        records = append(records, { "id" : transientQueriesToStrings(e), "entityClass" : "body", "box" : ${boxExpr} });
    }
    for (var e in evaluateQuery(context, qEverything(EntityType.FACE)))
    {
        var bb = evBox3d(context, { "topology" : e, "tight" : false });
        var rec = { "id" : transientQueriesToStrings(e), "entityClass" : "face", "box" : ${boxExpr} };
        try
        {
            var s = evSurfaceDefinition(context, { "face" : e });
            rec.geometryType = s.surfaceType;
            if (s.surfaceType == SurfaceType.PLANE)
            {
                rec.origin = s.origin;
                rec.normal = s.normal;
            }
            else if (s.surfaceType == SurfaceType.CYLINDER)
            {
                rec.axisOrigin = s.coordSystem.origin;
                rec.axis = s.coordSystem.zAxis;
                rec.radius = s.radius;
            }
            else if (s.surfaceType == SurfaceType.SPHERE)
            {
                rec.center = s.coordSystem.origin;
                rec.radius = s.radius;
            }
        }
        catch (error) { }
        records = append(records, rec);
    }
    for (var e in evaluateQuery(context, qEverything(EntityType.EDGE)))
    {
        var bb = evBox3d(context, { "topology" : e, "tight" : false });
        var rec = { "id" : transientQueriesToStrings(e), "entityClass" : "edge", "box" : ${boxExpr} };
        try
        {
            var c = evCurveDefinition(context, { "edge" : e });
            rec.geometryType = c.curveType;
            if (c.curveType == CurveType.LINE)
            {
                rec.origin = c.origin;
                rec.direction = c.direction;
            }
            else if (c.curveType == CurveType.CIRCLE)
            {
                rec.center = c.coordSystem.origin;
                rec.axis = c.coordSystem.zAxis;
                rec.radius = c.radius;
            }
        }
        catch (error) { }
        records = append(records, rec);
    }
    return records;
}`;
}

function parseCompressedQuery(queryString: string): CompressedQuery | null {
  if (queryString.length > 200_000) return null;
  const match = queryString.match(
    /^\s*query\s*=\s*qCompressed\(\s*(\d+(?:\.\d+)?)\s*,\s*("(?:\\.|[^"\\])*")\s*,\s*id\s*\)\s*;\s*$/,
  );
  if (!match) return null;
  try {
    const payload = JSON.parse(match[2]!) as unknown;
    return typeof payload === "string" ? { version: match[1]!, payload } : null;
  } catch {
    return null;
  }
}

const SKETCH_REGION_QUERY =
  /^\s*query\s*=\s*qSketchRegion\(\s*id\s*\+\s*("(?:\\.|[^"\\])*")\s*,\s*(true|false)\s*\)\s*;\s*$/;

export type ExactProfileQueryPlan =
  | {
      kind: "sketchRegionSet";
      sourceSketchFeatureId: string;
      filterInnerLoops: boolean;
    }
  | { kind: "opaque" }
  | { kind: "unresolved"; reason: string };

type ProfileQueryExpression =
  | { kind: "compressed"; compressed: CompressedQuery }
  | { kind: "sketchRegion"; sourceSketchFeatureId: string; filterInnerLoops: boolean };

/**
 * Classify only the exact authored assignment syntax. qCompressed remains
 * opaque: its payload is never inspected beyond syntactically reconstructing
 * the FeatureScript query for server evaluation.
 */
export function classifyExactProfileQuery(queryString: string | null): ExactProfileQueryPlan {
  if (!queryString) {
    return { kind: "unresolved", reason: "profile query is absent" };
  }
  if (parseCompressedQuery(queryString)) return { kind: "opaque" };
  const match = queryString.match(SKETCH_REGION_QUERY);
  if (!match) {
    return {
      kind: "unresolved",
      reason: "profile query is not a supported qCompressed or qSketchRegion assignment",
    };
  }
  try {
    const sourceSketchFeatureId = JSON.parse(match[1]!) as unknown;
    return typeof sourceSketchFeatureId === "string"
      ? {
          kind: "sketchRegionSet",
          sourceSketchFeatureId,
          filterInnerLoops: match[2] === "true",
        }
      : {
          kind: "unresolved",
          reason: "qSketchRegion source sketch id is not a string",
        };
  } catch {
    return { kind: "unresolved", reason: "qSketchRegion source sketch id is malformed" };
  }
}

/** Pure consumer-indexed plan used by capture and targeted enrichment. */
export function planExactProfileEvidence(
  consumers: readonly SolidExtrudeProfileQueryConsumer[],
): Array<{ consumer: SolidExtrudeProfileQueryConsumer; plan: ExactProfileQueryPlan }> {
  return consumers.map((consumer) => ({
    consumer,
    plan: classifyExactProfileQuery(consumer.queryString),
  }));
}

function profileQueryExpression(queryString: string | null): ProfileQueryExpression | null {
  const plan = classifyExactProfileQuery(queryString);
  if (plan.kind === "sketchRegionSet") {
    return {
      kind: "sketchRegion",
      sourceSketchFeatureId: plan.sourceSketchFeatureId,
      filterInnerLoops: plan.filterInnerLoops,
    };
  }
  const compressed = queryString ? parseCompressedQuery(queryString) : null;
  return compressed ? { kind: "compressed", compressed } : null;
}

function profileQueryFeatureScriptExpression(expression: ProfileQueryExpression): string {
  if (expression.kind === "compressed") {
    return `qCompressed(${expression.compressed.version}, ${JSON.stringify(expression.compressed.payload)}, newId())`;
  }
  return `qSketchRegion(id + ${JSON.stringify(expression.sourceSketchFeatureId)}, ${expression.filterInnerLoops})`;
}

/**
 * Server-side exact profile-query evaluation. Sketch-region witnesses are found
 * only on the exact selected face and certified with qContainsPoint. The
 * deterministic adaptive plane grid is a witness search, never nearest-geometry
 * matching; failure remains explicit instead of falling back to a bbox midpoint.
 */
function buildProfileEvidenceBlocks(
  entries: readonly {
    expression: ProfileQueryExpression;
    priorSketchFeatureIds: readonly string[];
  }[],
  groupsVariable: string,
): string {
  const blocks = entries.map((entry, index) => {
    const queryVariable = `profileQuery${index}`;
    const recordsVariable = `profileRecords${index}`;
    const sketchIds = JSON.stringify(entry.priorSketchFeatureIds);
    return `
    var ${queryVariable} = ${profileQueryFeatureScriptExpression(entry.expression)};
    var ${recordsVariable} = [];
    var profileResultIndex${index} = 0;
    for (var selectedFace${index} in evaluateQuery(context, qEntityFilter(${queryVariable}, EntityType.FACE)))
    {
        var selectedId${index} = transientQueriesToStrings(selectedFace${index});
        var matchingSketchIds${index} = [];
        for (var sketchFeatureId${index} in ${sketchIds})
        {
            for (var regionFace${index} in evaluateQuery(context, qSketchRegion(makeId(sketchFeatureId${index}), false)))
            {
                if (transientQueriesToStrings(regionFace${index}) == selectedId${index})
                    matchingSketchIds${index} = append(matchingSketchIds${index}, sketchFeatureId${index});
            }
        }
        if (size(matchingSketchIds${index}) == 1)
        {
            var rec${index} = {
                "resultIndex" : profileResultIndex${index},
                "id" : selectedId${index},
                "kind" : "sketchRegion",
                "sourceSketchFeatureId" : matchingSketchIds${index}[0]
            };
            try
            {
                var selectedSurface${index} = evSurfaceDefinition(context, { "face" : selectedFace${index} });
                if (selectedSurface${index}.surfaceType == SurfaceType.PLANE)
                {
                    var witness${index} = undefined;
                    var centroid${index} = evApproximateCentroid(context, { "entities" : selectedFace${index} });
                    if (size(evaluateQuery(context, qContainsPoint(selectedFace${index}, centroid${index}))) == 1)
                        witness${index} = centroid${index};
                    for (var divisions${index} in [3, 7, 15, 31, 63])
                    {
                        if (witness${index} != undefined)
                            break;
                        var parameters${index} = [];
                        for (var row${index} = 0; row${index} < divisions${index}; row${index} += 1)
                        {
                            for (var column${index} = 0; column${index} < divisions${index}; column${index} += 1)
                            {
                                parameters${index} = append(parameters${index}, vector(
                                    (column${index} + 0.5) / divisions${index},
                                    (row${index} + 0.5) / divisions${index}
                                ));
                            }
                        }
                        var tangentPlanes${index} = evFaceTangentPlanes(context, {
                            "face" : selectedFace${index},
                            "parameters" : parameters${index},
                            "returnUndefinedOutsideFace" : true
                        });
                        for (var tangentPlane${index} in tangentPlanes${index})
                        {
                            if (tangentPlane${index} != undefined &&
                                size(evaluateQuery(context, qContainsPoint(selectedFace${index}, tangentPlane${index}.origin))) == 1)
                            {
                                witness${index} = tangentPlane${index}.origin;
                                break;
                            }
                        }
                    }
                    if (witness${index} != undefined)
                        rec${index}.interiorPoint = witness${index};
                    else
                        rec${index}.reason = "exact selected sketch-region face contained no certified adaptive-grid witness";
                }
                else
                    rec${index}.reason = "exact selected sketch-region face is not planar";
            }
            catch (error)
            {
                rec${index}.reason = "exact selected sketch-region witness certification failed";
            }
            ${recordsVariable} = append(${recordsVariable}, rec${index});
        }
        else
        {
            var rec${index} = {
                "resultIndex" : profileResultIndex${index},
                "id" : selectedId${index},
                "kind" : "unresolved"
            };
            if (size(matchingSketchIds${index}) > 1)
                rec${index}.reason = "selected profile face has more than one exact qSketchRegion source";
            else
            {
                try
                {
                    var surface${index} = evSurfaceDefinition(context, { "face" : selectedFace${index} });
                    if (surface${index}.surfaceType == SurfaceType.PLANE)
                    {
                        rec${index}.kind = "planarFace";
                        rec${index}.geometryType = surface${index}.surfaceType;
                        rec${index}.origin = surface${index}.origin;
                        rec${index}.normal = surface${index}.normal;
                    }
                    else
                        rec${index}.reason = "selected profile face is not a sketch region or planar face";
                }
                catch (error)
                {
                    rec${index}.reason = "selected profile face could not be classified";
                }
            }
            ${recordsVariable} = append(${recordsVariable}, rec${index});
        }
        profileResultIndex${index} += 1;
    }
    if (size(${recordsVariable}) == 0)
        ${recordsVariable} = append(${recordsVariable}, { "kind" : "unresolved", "reason" : "captured profile query resolved no faces" });
    ${groupsVariable} = append(${groupsVariable}, { "index" : ${index}, "records" : ${recordsVariable} });`;
  });
  return blocks.join("");
}

function buildProfileEvidenceScript(
  entries: readonly {
    expression: ProfileQueryExpression;
    priorSketchFeatureIds: readonly string[];
  }[],
): string {
  return `function(context is Context, queries)
{
    var groups = [];${buildProfileEvidenceBlocks(entries, "groups")}
    return groups;
}`;
}

interface ProfileEvidenceRecord {
  resultIndex?: unknown;
  id?: unknown;
  kind?: unknown;
  sourceSketchFeatureId?: unknown;
  interiorPoint?: unknown;
  geometryType?: unknown;
  origin?: unknown;
  normal?: unknown;
  reason?: unknown;
}

function profileEvidenceFromRecord(input: {
  consumer: SolidExtrudeProfileQueryConsumer;
  record: ProfileEvidenceRecord;
}): OnshapeProfileEvidence {
  const resultIndex =
    typeof input.record.resultIndex === "number" && Number.isInteger(input.record.resultIndex)
      ? input.record.resultIndex
      : undefined;
  const deterministicId = typeof input.record.id === "string" ? input.record.id : undefined;
  const common = {
    consumingFeatureId: input.consumer.consumingFeatureId,
    parameterId: "entities" as const,
    queryIndex: input.consumer.queryIndex,
    evaluatedAt: "historyPoint" as const,
  };
  if (
    input.record.kind === "sketchRegion" &&
    resultIndex !== undefined &&
    deterministicId &&
    typeof input.record.sourceSketchFeatureId === "string"
  ) {
    const interiorPoint = input.record.interiorPoint;
    if (
      Array.isArray(interiorPoint) &&
      interiorPoint.length === 3 &&
      interiorPoint.every((component) => typeof component === "number" && Number.isFinite(component))
    ) {
      return {
        ...common,
        resultIndex,
        deterministicId,
        kind: "sketchRegion",
        sourceSketchFeatureId: input.record.sourceSketchFeatureId,
        interiorPoint3d: interiorPoint as [number, number, number],
      };
    }
    return {
      ...common,
      resultIndex,
      deterministicId,
      kind: "sketchRegion",
      sourceSketchFeatureId: input.record.sourceSketchFeatureId,
      unresolved: {
        reason:
          typeof input.record.reason === "string"
            ? input.record.reason
            : "exact sketch-region source had no certified interior witness",
      },
    };
  }
  if (
    input.record.kind === "planarFace" &&
    resultIndex !== undefined &&
    deterministicId &&
    typeof input.record.geometryType === "string"
  ) {
    const definingData: Record<string, unknown> = {};
    if (input.record.origin !== undefined) definingData.origin = input.record.origin;
    if (input.record.normal !== undefined) definingData.normal = input.record.normal;
    return {
      ...common,
      resultIndex,
      deterministicId,
      kind: "planarFace",
      signature: {
        entityClass: "face",
        geometryType: input.record.geometryType.toLowerCase(),
        ...(Object.keys(definingData).length > 0 ? { definingData } : {}),
      },
    };
  }
  return {
    ...common,
    ...(resultIndex === undefined ? {} : { resultIndex }),
    ...(deterministicId ? { deterministicId } : {}),
    kind: "unresolved",
    unresolved: {
      reason:
        typeof input.record.reason === "string"
          ? input.record.reason
          : "captured profile query result lacked exact face classification",
    },
  };
}

/**
 * Capture every solid-extrude profile query at its exact pre-consumer state.
 * This never decodes qCompressed payloads or searches geometry for a likely
 * sketch: qCompressed is reconstructed and evaluated only by FeatureScript.
 */
export async function resolveSolidExtrudeProfileEvidenceWithHistory(
  client: OnshapeClient,
  partStudioPath: string,
  consumers: readonly SolidExtrudeProfileQueryConsumer[],
): Promise<OnshapeProfileEvidence[]> {
  const results: OnshapeProfileEvidence[] = [];
  const byRollbackIndex = new Map<
    number,
    Array<{ consumer: SolidExtrudeProfileQueryConsumer; expression: ProfileQueryExpression }>
  >();

  for (const consumer of consumers) {
    const plan = classifyExactProfileQuery(consumer.queryString);
    if (plan.kind === "sketchRegionSet") {
      results.push({
        consumingFeatureId: consumer.consumingFeatureId,
        parameterId: "entities",
        queryIndex: consumer.queryIndex,
        evaluatedAt: "historyPoint",
        kind: "sketchRegionSet",
        sourceSketchFeatureId: plan.sourceSketchFeatureId,
        filterInnerLoops: plan.filterInnerLoops,
      });
      continue;
    }
    if (plan.kind === "unresolved") {
      results.push({
        consumingFeatureId: consumer.consumingFeatureId,
        parameterId: "entities",
        queryIndex: consumer.queryIndex,
        evaluatedAt: "historyPoint",
        kind: "unresolved",
        unresolved: { reason: plan.reason },
      });
      continue;
    }
    const expression = profileQueryExpression(consumer.queryString);
    if (!expression || expression.kind !== "compressed") {
      throw new Error("Opaque profile query could not be reconstructed for FeatureScript.");
    }
    const group = byRollbackIndex.get(consumer.rollbackIndex) ?? [];
    group.push({ consumer, expression });
    byRollbackIndex.set(consumer.rollbackIndex, group);
  }

  for (const [rollbackIndex, entries] of byRollbackIndex) {
    const response = await client.postJson(
      `${partStudioPath}/featurescript?rollbackBarIndex=${rollbackIndex}`,
      {
        script: buildProfileEvidenceScript(
          entries.map((entry) => ({
            expression: entry.expression,
            priorSketchFeatureIds: entry.consumer.priorSketchFeatureIds,
          })),
        ),
      },
    );
    const decoded = decodeFsValue((response as { result?: unknown }).result);
    const groups = Array.isArray(decoded) ? decoded : [];
    for (const [entryIndex, entry] of entries.entries()) {
      const group = groups.find(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          (candidate as { index?: unknown }).index === entryIndex,
      ) as { records?: unknown } | undefined;
      const records = Array.isArray(group?.records) ? group.records : [];
      if (records.length === 0) {
        results.push({
          consumingFeatureId: entry.consumer.consumingFeatureId,
          parameterId: "entities",
          queryIndex: entry.consumer.queryIndex,
          evaluatedAt: "historyPoint",
          kind: "unresolved",
          unresolved: { reason: "profile evidence FeatureScript result was malformed" },
        });
        continue;
      }
      for (const record of records) {
        results.push(profileEvidenceFromRecord({
          consumer: entry.consumer,
          record: (record ?? {}) as ProfileEvidenceRecord,
        }));
      }
    }
  }
  return results;
}

function buildEntityLoops(queryVariable: string, recordsVariable: string): string {
  const boxExpr =
    "[bb.minCorner[0], bb.minCorner[1], bb.minCorner[2], bb.maxCorner[0], bb.maxCorner[1], bb.maxCorner[2]]";
  return `
    for (var e in evaluateQuery(context, qEntityFilter(${queryVariable}, EntityType.BODY)))
    {
        var bb = evBox3d(context, { "topology" : e, "tight" : false });
        ${recordsVariable} = append(${recordsVariable}, { "id" : transientQueriesToStrings(e), "entityClass" : "body", "geometryType" : "solid", "box" : ${boxExpr} });
    }
    for (var e in evaluateQuery(context, qEntityFilter(${queryVariable}, EntityType.FACE)))
    {
        var bb = evBox3d(context, { "topology" : e, "tight" : false });
        var rec = { "id" : transientQueriesToStrings(e), "entityClass" : "face", "box" : ${boxExpr} };
        try
        {
            var s = evSurfaceDefinition(context, { "face" : e });
            rec.geometryType = s.surfaceType;
            if (s.surfaceType == SurfaceType.PLANE)
            {
                rec.origin = s.origin;
                rec.normal = s.normal;
            }
            else if (s.surfaceType == SurfaceType.CYLINDER)
            {
                rec.axisOrigin = s.coordSystem.origin;
                rec.axis = s.coordSystem.zAxis;
                rec.radius = s.radius;
            }
            else if (s.surfaceType == SurfaceType.SPHERE)
            {
                rec.center = s.coordSystem.origin;
                rec.radius = s.radius;
            }
        }
        catch (error) { }
        ${recordsVariable} = append(${recordsVariable}, rec);
    }
    for (var e in evaluateQuery(context, qEntityFilter(${queryVariable}, EntityType.EDGE)))
    {
        var bb = evBox3d(context, { "topology" : e, "tight" : false });
        var rec = { "id" : transientQueriesToStrings(e), "entityClass" : "edge", "box" : ${boxExpr} };
        try
        {
            var c = evCurveDefinition(context, { "edge" : e });
            rec.geometryType = c.curveType;
            if (c.curveType == CurveType.LINE)
            {
                rec.origin = c.origin;
                rec.direction = c.direction;
            }
            else if (c.curveType == CurveType.CIRCLE)
            {
                rec.center = c.coordSystem.origin;
                rec.axis = c.coordSystem.zAxis;
                rec.radius = c.radius;
            }
        }
        catch (error) { }
        ${recordsVariable} = append(${recordsVariable}, rec);
    }
    for (var e in evaluateQuery(context, qEntityFilter(${queryVariable}, EntityType.VERTEX)))
    {
        var bb = evBox3d(context, { "topology" : e, "tight" : false });
        ${recordsVariable} = append(${recordsVariable}, { "id" : transientQueriesToStrings(e), "entityClass" : "vertex", "geometryType" : "point", "box" : ${boxExpr} });
    }`;
}

function buildQueryResolutionBlocks(
  entries: readonly { compressed: CompressedQuery }[],
  groupsVariable: string,
): string {
  const blocks = entries.map((entry, index) => {
    const queryVariable = `capturedQuery${index}`;
    const recordsVariable = `capturedRecords${index}`;
    return `
    var ${queryVariable} = qCompressed(${entry.compressed.version}, ${JSON.stringify(entry.compressed.payload)}, newId());
    var ${recordsVariable} = [];
    ${buildEntityLoops(queryVariable, recordsVariable)}
    ${groupsVariable} = append(${groupsVariable}, { "index" : ${index}, "records" : ${recordsVariable} });`;
  });
  return blocks.join("");
}

function buildQueryResolutionScript(
  entries: readonly { compressed: CompressedQuery }[],
): string {
  return `function(context is Context, queries)
{
    var groups = [];${buildQueryResolutionBlocks(entries, "groups")}
    return groups;
}`;
}

interface QueryResolutionGroup {
  index: number;
  records: EntityRecord[];
}

function parseQueryResolutionGroups(response: unknown): {
  groups: QueryResolutionGroup[];
  parseError: string | null;
} {
  const decoded = decodeFsValue((response as { result?: unknown }).result);
  if (!Array.isArray(decoded)) {
    return { groups: [], parseError: "featurescript query result was not an array" };
  }
  const groups: QueryResolutionGroup[] = [];
  for (const value of decoded) {
    if (!value || typeof value !== "object") continue;
    const record = value as { index?: unknown; records?: unknown };
    if (typeof record.index !== "number" || !Array.isArray(record.records)) continue;
    groups.push({ index: record.index, records: record.records.filter(isEntityRecord) });
  }
  return groups.length === decoded.length
    ? { groups, parseError: null }
    : { groups: [], parseError: "featurescript query result contained malformed groups" };
}

/** Resolve ID-less compressed queries at the state immediately before each consumer. */
export async function resolveQueryStringsWithHistory(
  client: OnshapeClient,
  partStudioPath: string,
  consumers: readonly QueryStringConsumer[],
): Promise<OnshapeResolvedQueryReference[]> {
  const results: OnshapeResolvedQueryReference[] = [];
  const byRollbackIndex = new Map<
    number,
    Array<{ consumer: QueryStringConsumer; compressed: CompressedQuery }>
  >();

  for (const consumer of consumers) {
    const compressed = parseCompressedQuery(consumer.queryString);
    if (!compressed) {
      results.push({
        consumingFeatureId: consumer.consumingFeatureId,
        parameterId: consumer.parameterId,
        queryIndex: consumer.queryIndex,
        evaluatedAt: "historyPoint",
        unresolved: { reason: "queryString is not a supported qCompressed assignment" },
      });
      continue;
    }
    const group = byRollbackIndex.get(consumer.rollbackIndex) ?? [];
    group.push({ consumer, compressed });
    byRollbackIndex.set(consumer.rollbackIndex, group);
  }

  for (const [rollbackIndex, entries] of byRollbackIndex) {
    const response = await client.postJson(
      `${partStudioPath}/featurescript?rollbackBarIndex=${rollbackIndex}`,
      { script: buildQueryResolutionScript(entries) },
    );
    const parsed = parseQueryResolutionGroups(response);
    for (const [entryIndex, entry] of entries.entries()) {
      const records = parsed.groups.find((group) => group.index === entryIndex)?.records;
      if (parsed.parseError || !records || records.length === 0) {
        results.push({
          consumingFeatureId: entry.consumer.consumingFeatureId,
          parameterId: entry.consumer.parameterId,
          queryIndex: entry.consumer.queryIndex,
          evaluatedAt: "historyPoint",
          unresolved: {
            reason:
              parsed.parseError ??
              "captured query resolved no entities at the consuming history point",
          },
        });
        continue;
      }
      records.forEach((record, entityIndex) => {
        results.push({
          consumingFeatureId: entry.consumer.consumingFeatureId,
          parameterId: entry.consumer.parameterId,
          queryIndex: entry.consumer.queryIndex,
          entityIndex,
          evaluatedAt: "historyPoint",
          signature: toSignature(record),
        });
      });
    }
  }
  return results;
}

export interface ImmutableHistoryEvidenceResult {
  resolvedReferences: OnshapeResolvedReference[];
  resolvedQueryReferences: OnshapeResolvedQueryReference[];
  profileEvidence: OnshapeProfileEvidence[];
}

export type ImmutableHistoryFeatureScriptEvaluator = (
  rollbackBarIndex: number,
  script: string,
) => Promise<unknown>;

function buildUnifiedHistoryEvidenceScript(input: {
  deterministicIds: readonly string[];
  queryEntries: readonly { compressed: CompressedQuery }[];
  profileEntries: readonly {
    expression: ProfileQueryExpression;
    priorSketchFeatureIds: readonly string[];
  }[];
}): string {
  // Profile-only enrichment needs no global entity scan. When deterministic
  // consumers do exist, one all-entity query feeds the four typed record loops.
  const allEntityLoops = input.deterministicIds.length > 0
    ? `var allEntities = qEverything();${buildEntityLoops("allEntities", "allEntityRecords")}`
    : "";
  return `function(context is Context, queries)
{
    var allEntityRecords = [];${allEntityLoops}
    var queryGroups = [];${buildQueryResolutionBlocks(input.queryEntries, "queryGroups")}
    var profileGroups = [];${buildProfileEvidenceBlocks(input.profileEntries, "profileGroups")}
    return {
        "entityRecords" : allEntityRecords,
        "queryGroups" : queryGroups,
        "profileGroups" : profileGroups
    };
}`;
}

interface DecodedHistoryGroup {
  index: number;
  records: unknown[];
}

function groupsFromDecoded(value: unknown): DecodedHistoryGroup[] | null {
  if (!Array.isArray(value)) return null;
  const groups: DecodedHistoryGroup[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const record = candidate as { index?: unknown; records?: unknown };
    if (typeof record.index !== "number" || !Array.isArray(record.records)) return null;
    groups.push({ index: record.index, records: record.records });
  }
  return groups;
}

function referencesFromEntityRecords(input: {
  deterministicIds: readonly string[];
  records: readonly EntityRecord[];
  evaluatedAt: "finalState" | "historyPoint";
}): OnshapeResolvedReference[] {
  const byId = new Map(input.records.map((record) => [record.id, record]));
  return input.deterministicIds.map((deterministicId) => {
    const record = byId.get(deterministicId);
    return record
      ? { deterministicId, evaluatedAt: input.evaluatedAt, signature: toSignature(record) }
      : {
          deterministicId,
          evaluatedAt: input.evaluatedAt,
          unresolved: {
            reason:
              input.evaluatedAt === "finalState"
                ? "entity is not present in the final model state"
                : "entity is not present at the consuming history point",
          },
        };
  }) as OnshapeResolvedReference[];
}

/**
 * Evaluate all history evidence needed at a rollback state in one immutable,
 * read-only FeatureScript request. Readable qSketchRegion plans are local;
 * unsupported plans are explicit unresolved records and make no request.
 */
export async function resolveImmutableHistoryEvidence(input: {
  client: OnshapeClient;
  partStudioPath: string;
  deterministicIdConsumers: readonly DeterministicIdConsumer[];
  queryStringConsumers: readonly QueryStringConsumer[];
  profileConsumers: readonly SolidExtrudeProfileQueryConsumer[];
  /** Reuse validated final-state records while refreshing only consumer history. */
  skipFinalState?: boolean;
  evaluate?: ImmutableHistoryFeatureScriptEvaluator;
}): Promise<ImmutableHistoryEvidenceResult> {
  const evaluate = input.evaluate ?? ((rollbackBarIndex, script) =>
    input.client.postJson(
      `${input.partStudioPath}/featurescript?rollbackBarIndex=${rollbackBarIndex}`,
      { script },
    ));
  const deterministicIds = [...new Set(input.deterministicIdConsumers.map((consumer) => consumer.deterministicId))];
  let finalRecords: OnshapeResolvedReference[] = [];
  if (!input.skipFinalState && deterministicIds.length > 0) {
    const response = await evaluate(-1, buildResolutionScript());
    const parsed = parseEntityRecords(response);
    finalRecords = referencesFromEntityRecords({
      deterministicIds,
      records: parsed.records,
      evaluatedAt: "finalState",
    });
  }

  const results: ImmutableHistoryEvidenceResult = {
    resolvedReferences: finalRecords,
    resolvedQueryReferences: [],
    profileEvidence: [],
  };
  const byRollback = new Map<number, {
    deterministicConsumers: DeterministicIdConsumer[];
    queryEntries: Array<{ consumer: QueryStringConsumer; compressed: CompressedQuery }>;
    profileEntries: Array<{ consumer: SolidExtrudeProfileQueryConsumer; expression: ProfileQueryExpression }>;
  }>();
  const groupFor = (rollbackIndex: number) => {
    const existing = byRollback.get(rollbackIndex);
    if (existing) return existing;
    const created = { deterministicConsumers: [], queryEntries: [], profileEntries: [] };
    byRollback.set(rollbackIndex, created);
    return created;
  };

  // A deterministic ID surviving the final model says nothing about its
  // geometry or owner at the point its consumer was authored. Preserve final
  // records for final-state use, and always add a consumer-scoped history
  // record at the pre-consumer rollback point.
  for (const consumer of input.deterministicIdConsumers) {
    groupFor(consumer.rollbackIndex).deterministicConsumers.push(consumer);
  }
  for (const consumer of input.queryStringConsumers) {
    const compressed = parseCompressedQuery(consumer.queryString);
    if (!compressed) {
      results.resolvedQueryReferences.push({
        consumingFeatureId: consumer.consumingFeatureId,
        parameterId: consumer.parameterId,
        queryIndex: consumer.queryIndex,
        evaluatedAt: "historyPoint",
        unresolved: { reason: "queryString is not a supported qCompressed assignment" },
      });
      continue;
    }
    groupFor(consumer.rollbackIndex).queryEntries.push({ consumer, compressed });
  }
  for (const { consumer, plan } of planExactProfileEvidence(input.profileConsumers)) {
    if (plan.kind === "sketchRegionSet") {
      results.profileEvidence.push({
        consumingFeatureId: consumer.consumingFeatureId,
        parameterId: "entities",
        queryIndex: consumer.queryIndex,
        evaluatedAt: "historyPoint",
        kind: "sketchRegionSet",
        sourceSketchFeatureId: plan.sourceSketchFeatureId,
        filterInnerLoops: plan.filterInnerLoops,
      });
      continue;
    }
    if (plan.kind === "unresolved") {
      results.profileEvidence.push({
        consumingFeatureId: consumer.consumingFeatureId,
        parameterId: "entities",
        queryIndex: consumer.queryIndex,
        evaluatedAt: "historyPoint",
        kind: "unresolved",
        unresolved: { reason: plan.reason },
      });
      continue;
    }
    const expression = profileQueryExpression(consumer.queryString);
    if (!expression || expression.kind !== "compressed") {
      throw new Error("Opaque profile query could not be reconstructed for FeatureScript.");
    }
    groupFor(consumer.rollbackIndex).profileEntries.push({ consumer, expression });
  }

  for (const [rollbackIndex, group] of byRollback) {
    const script = buildUnifiedHistoryEvidenceScript({
      deterministicIds: [...new Set(group.deterministicConsumers.map((consumer) => consumer.deterministicId))],
      queryEntries: group.queryEntries,
      profileEntries: group.profileEntries.map((entry) => ({
        expression: entry.expression,
        priorSketchFeatureIds: entry.consumer.priorSketchFeatureIds,
      })),
    });
    const response = await evaluate(rollbackIndex, script) as { result?: unknown; notices?: unknown };
    const decoded = decodeFsValue(response.result);
    if (!decoded || typeof decoded !== "object") {
      throw new Error(`Onshape history evidence FeatureScript returned no decodable result at rollback index ${rollbackIndex}.`);
    }
    const output = decoded as {
      entityRecords?: unknown;
      queryGroups?: unknown;
      profileGroups?: unknown;
    };
    if (group.deterministicConsumers.length > 0 && !Array.isArray(output.entityRecords)) {
      throw new Error(`Onshape history evidence FeatureScript omitted entity records at rollback index ${rollbackIndex}.`);
    }
    if (group.queryEntries.length > 0 && !Array.isArray(output.queryGroups)) {
      throw new Error(`Onshape history evidence FeatureScript omitted query groups at rollback index ${rollbackIndex}.`);
    }
    if (group.profileEntries.length > 0 && !Array.isArray(output.profileGroups)) {
      throw new Error(`Onshape history evidence FeatureScript omitted profile groups at rollback index ${rollbackIndex}.`);
    }
    const entityRecords = Array.isArray(output.entityRecords)
      ? output.entityRecords.filter(isEntityRecord)
      : [];
    const queryGroups = groupsFromDecoded(output.queryGroups);
    const profileGroups = groupsFromDecoded(output.profileGroups);

    const recordsAtPoint = referencesFromEntityRecords({
      deterministicIds: [...new Set(group.deterministicConsumers.map((consumer) => consumer.deterministicId))],
      records: entityRecords,
      evaluatedAt: "historyPoint",
    });
    for (const consumer of group.deterministicConsumers) {
      const record = recordsAtPoint.find((candidate) => candidate.deterministicId === consumer.deterministicId);
      results.resolvedReferences.push(record && "signature" in record
        ? {
            deterministicId: consumer.deterministicId,
            evaluatedAt: "historyPoint",
            consumingFeatureId: consumer.consumingFeatureId,
            signature: record.signature,
          }
        : {
            deterministicId: consumer.deterministicId,
            evaluatedAt: "historyPoint",
            consumingFeatureId: consumer.consumingFeatureId,
            unresolved: { reason: "entity is not present at the consuming history point" },
          });
    }
    for (const [entryIndex, entry] of group.queryEntries.entries()) {
      const records = queryGroups
        ?.find((candidate) => candidate.index === entryIndex)
        ?.records.filter(isEntityRecord);
      if (!records || records.length === 0) {
        results.resolvedQueryReferences.push({
          consumingFeatureId: entry.consumer.consumingFeatureId,
          parameterId: entry.consumer.parameterId,
          queryIndex: entry.consumer.queryIndex,
          evaluatedAt: "historyPoint",
          unresolved: { reason: "captured query resolved no entities at the consuming history point" },
        });
      } else {
        records.forEach((record, entityIndex) => results.resolvedQueryReferences.push({
          consumingFeatureId: entry.consumer.consumingFeatureId,
          parameterId: entry.consumer.parameterId,
          queryIndex: entry.consumer.queryIndex,
          entityIndex,
          evaluatedAt: "historyPoint",
          signature: toSignature(record),
        }));
      }
    }
    for (const [entryIndex, entry] of group.profileEntries.entries()) {
      const records = profileGroups?.find((candidate) => candidate.index === entryIndex)?.records;
      if (!records || records.length === 0) {
        throw new Error(
          `Onshape history evidence FeatureScript omitted profile result ${entryIndex} at rollback index ${rollbackIndex}.`,
        );
      } else {
        for (const record of records) {
          results.profileEvidence.push(profileEvidenceFromRecord({
            consumer: entry.consumer,
            record: (record ?? {}) as ProfileEvidenceRecord,
          }));
        }
      }
    }
  }
  return results;
}

/**
 * Resolve collected deterministic IDs to geometric signatures with a single
 * batched FeatureScript evaluation per Part Studio. IDs not present in the final
 * model state are recorded with a structured `unresolved` reason; the CLI never
 * fabricates a signature. HTTP failures propagate (a broken eval is loud); an
 * unparseable result degrades every id to an explicit unresolved record.
 */
export async function resolveDeterministicIds(
  client: OnshapeClient,
  partStudioPath: string,
  deterministicIds: readonly string[],
): Promise<OnshapeResolvedReference[]> {
  return resolveAtState(client, partStudioPath, deterministicIds, "finalState");
}

export async function resolveDeterministicIdsWithHistory(
  client: OnshapeClient,
  finalPartStudioPath: string,
  _rollbackPartStudioPath: string,
  consumers: readonly DeterministicIdConsumer[],
): Promise<OnshapeResolvedReference[]> {
  // Retained for callers of the former workspace API. History is now evaluated
  // directly against the immutable path; it never mutates a workspace rollback.
  return (await resolveImmutableHistoryEvidence({
    client,
    partStudioPath: finalPartStudioPath,
    deterministicIdConsumers: consumers,
    queryStringConsumers: [],
    profileConsumers: [],
  })).resolvedReferences;
}

async function resolveAtState(
  client: OnshapeClient,
  partStudioPath: string,
  deterministicIds: readonly string[],
  evaluatedAt: "finalState" | "historyPoint",
  rollbackBarIndex = -1,
): Promise<OnshapeResolvedReference[]> {
  if (deterministicIds.length === 0) {
    return [];
  }

  const response = await client.postJson(
    `${partStudioPath}/featurescript?rollbackBarIndex=${rollbackBarIndex}`,
    { script: buildResolutionScript() },
  );

  const { records, parseError } = parseEntityRecords(response);
  const byId = new Map<string, EntityRecord>();
  for (const record of records) {
    byId.set(record.id, record);
  }

  return deterministicIds.map((deterministicId) => {
    const record = byId.get(deterministicId);
    if (!record) {
      return {
        deterministicId,
        evaluatedAt,
        unresolved: {
          reason:
            parseError ??
            (evaluatedAt === "finalState"
              ? "entity is not present in the final model state"
              : "entity is not present at the consuming history point"),
        },
      } as OnshapeResolvedReference;
    }
    return {
      deterministicId,
      evaluatedAt,
      signature: toSignature(record),
    } as OnshapeResolvedReference;
  });
}

function toSignature(record: EntityRecord): OnshapeGeometricSignature {
  const signature: OnshapeGeometricSignature = {
    entityClass: normalizeEntityClass(record.entityClass),
    geometryType:
      typeof record.geometryType === "string"
        ? record.geometryType.toLowerCase()
        : "unknown",
  };

  if (Array.isArray(record.box) && record.box.length === 6) {
    const [minX, minY, minZ, maxX, maxY, maxZ] = record.box as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    signature.boundingBox = { low: [minX, minY, minZ], high: [maxX, maxY, maxZ] };
    signature.centroid = [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ];
  }

  const definingData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!RECORD_META_KEYS.has(key)) {
      definingData[key] = value;
    }
  }
  if (Object.keys(definingData).length > 0) {
    signature.definingData = definingData;
  }

  return signature;
}

function normalizeEntityClass(
  value: string,
): OnshapeGeometricSignature["entityClass"] {
  if (
    value === "face" ||
    value === "edge" ||
    value === "vertex" ||
    value === "body"
  ) {
    return value;
  }
  return "body";
}

/**
 * Decode the FeatureScript eval result into entity records. The returned value
 * is a `BTFSValue` tree; `decodeFsValue` walks it into plain JS. Anything other
 * than a non-empty array of records yields a structured parse error rather than
 * a silent empty result.
 */
function parseEntityRecords(response: unknown): {
  records: EntityRecord[];
  parseError: string | null;
} {
  const result = (response as { result?: unknown }).result;
  const decoded = decodeFsValue(result);
  if (!Array.isArray(decoded)) {
    return {
      records: [],
      parseError: "featurescript result was not an array of entity records",
    };
  }
  const records = decoded.filter(isEntityRecord);
  if (records.length === 0) {
    return {
      records: [],
      parseError: "featurescript result contained no entity records",
    };
  }
  return { records, parseError: null };
}

function isEntityRecord(value: unknown): value is EntityRecord {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { entityClass?: unknown }).entityClass === "string"
  );
}

/**
 * Decode an Onshape `BTFSValue` node into a plain JS value. Maps become objects,
 * arrays become arrays, and scalar/`WithUnits` nodes yield their `value` (units
 * are always meters at this boundary).
 */
function decodeFsValue(node: unknown): unknown {
  if (node === null || typeof node !== "object") {
    return node;
  }
  const typed = node as { btType?: string; value?: unknown };
  const btType = typed.btType ?? "";

  if (btType.includes("BTFSValueMap")) {
    const entries = Array.isArray(typed.value) ? typed.value : [];
    const object: Record<string, unknown> = {};
    for (const entry of entries) {
      const mapEntry = entry as { key?: unknown; value?: unknown };
      object[String(decodeFsValue(mapEntry.key))] = decodeFsValue(
        mapEntry.value,
      );
    }
    return object;
  }

  if (btType.includes("BTFSValueArray")) {
    const items = Array.isArray(typed.value) ? typed.value : [];
    return items.map(decodeFsValue);
  }

  return typed.value;
}
