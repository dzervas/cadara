import type {
  OnshapeGeometricSignature,
  OnshapeResolvedReference,
} from "@/contracts/import/onshape-capture-bundle";

import type { OnshapeClient } from "@/cli/commands/onshape-capture/client";

/**
 * Collect every deterministic ID referenced anywhere in a raw `getFeatures`
 * response. Deterministic IDs live in `deterministicIds` arrays on query
 * objects (`BTMIndividualQuery-138`, `BTMIndividualSketchRegionQuery-140`,
 * `BTMIndividualCreatedByQuery-137`, ...) reached through feature parameters,
 * sketch-plane queries, region queries, and constraint externals. A structural
 * walk collects all of them regardless of nesting.
 */
export function collectDeterministicIds(features: unknown): string[] {
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

  visit(features);
  return [...ids];
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
  if (deterministicIds.length === 0) {
    return [];
  }

  const response = await client.postJson(
    `${partStudioPath}/featurescript?rollbackBarIndex=-1`,
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
        evaluatedAt: "finalState",
        unresolved: {
          reason: parseError ?? "entity is not present in the final model state",
        },
      };
    }
    return {
      deterministicId,
      evaluatedAt: "finalState",
      signature: toSignature(record),
    };
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
