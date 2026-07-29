/**
 * Exact reader for Onshape `qCompressed` sketch-entity vertex queries.
 *
 * The compressed payload is a length-prefixed key/value encoding, not an opaque
 * blob: `S<hex>[.<hex>]*$` declares the byte lengths of the following
 * concatenated string fields. Reading it is exact decoding, never inference —
 * any payload that does not decode to a complete `SKETCH_ENTITY` vertex query
 * returns `null` so the caller stays honestly unresolved.
 */

export interface OnshapeSketchEntityVertexQuery {
  /** Onshape sketch feature that owns the referenced entity. */
  sketchFeatureId: string;
  /** Onshape sketch entity id, without the endpoint-role suffix. */
  sketchEntityId: string;
  /** Which defining point of the entity the query names. */
  role: "start" | "end" | "center" | "point";
}

const COMPRESSED_ASSIGNMENT =
  /^\s*query\s*=\s*qCompressed\(\s*[\d.]+\s*,\s*"([^"]*)"\s*,\s*id\s*\)\s*;?\s*$/;

const STRING_FIELD = /S((?:[0-9a-f]+)(?:\.[0-9a-f]+)*)\$/g;

/** Decode the payload's ordered string fields exactly as encoded. */
function readStringFields(payload: string): string[][] {
  const fields: string[][] = [];
  STRING_FIELD.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STRING_FIELD.exec(payload)) !== null) {
    const lengths = match[1]!.split(".").map((entry) => Number.parseInt(entry, 16));
    if (lengths.some((length) => !Number.isInteger(length) || length < 0)) return [];
    const start = match.index + match[0].length;
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (start + total > payload.length) return [];
    const parts: string[] = [];
    let offset = start;
    for (const length of lengths) {
      parts.push(payload.slice(offset, offset + length));
      offset += length;
    }
    fields.push(parts);
    STRING_FIELD.lastIndex = start + total;
  }
  return fields;
}

const ROLE_BY_SUFFIX: Record<string, OnshapeSketchEntityVertexQuery["role"]> = {
  start: "start",
  end: "end",
  center: "center",
};

/** Decode the payload's ordered key/value string fields, or null when unreadable. */
function readSketchEntityQueryValues(
  queryString: string | null | undefined,
): Map<string, string[]> | null {
  if (typeof queryString !== "string") return null;
  const payload = COMPRESSED_ASSIGNMENT.exec(queryString)?.[1];
  if (payload === undefined) return null;

  const fields = readStringFields(payload);
  const values = new Map<string, string[]>();
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const key = fields[index]!;
    if (key.length !== 1) continue;
    values.set(key[0]!, fields[index + 1]!);
  }
  return values.get("queryType")?.[0] === "SKETCH_ENTITY" ? values : null;
}

/**
 * Read an exact `entityType=VERTEX, queryType=SKETCH_ENTITY` query. Every other
 * shape (body/face lineage, non-vertex entity types, missing operation id,
 * unknown endpoint role) is rejected rather than guessed at.
 */
export function readSketchEntityVertexQuery(
  queryString: string | null | undefined,
): OnshapeSketchEntityVertexQuery | null {
  const values = readSketchEntityQueryValues(queryString);
  if (!values) return null;

  if (values.get("entityType")?.[0] !== "VERTEX") return null;

  const operation = values.get("operationId");
  if (!operation || operation.length !== 2 || operation[1] !== "wireOp") return null;
  const sketchFeatureId = operation[0]!;
  if (sketchFeatureId.length === 0) return null;

  const entity = values.get("sketchEntityId");
  if (!entity || entity.length === 0) return null;

  // The final field is the endpoint role; everything before it is the entity id.
  if (entity.length === 1) {
    return { sketchFeatureId, sketchEntityId: entity[0]!, role: "point" };
  }
  const role = ROLE_BY_SUFFIX[entity[entity.length - 1]!];
  if (!role) return null;
  return {
    sketchFeatureId,
    sketchEntityId: entity.slice(0, -1).join("."),
    role,
  };
}

/**
 * Read an exact `entityType=EDGE, queryType=SKETCH_ENTITY` query, the form
 * Onshape authors for a surface extrude's open sketch-curve profile. The payload
 * names exactly one sketch entity; an endpoint-suffixed id, a different entity
 * type, or a missing sketch operation id is rejected rather than guessed at.
 */
export function readSketchEntityEdgeQuery(
  queryString: string | null | undefined,
): { sketchFeatureId: string; sketchEntityId: string } | null {
  const values = readSketchEntityQueryValues(queryString);
  if (!values) return null;

  if (values.get("entityType")?.[0] !== "EDGE") return null;

  const operation = values.get("operationId");
  if (!operation || operation.length !== 2 || operation[1] !== "wireOp") return null;
  const sketchFeatureId = operation[0]!;
  if (sketchFeatureId.length === 0) return null;

  const entity = values.get("sketchEntityId");
  if (!entity || entity.length !== 1 || entity[0]!.length === 0) return null;

  return { sketchFeatureId, sketchEntityId: entity[0]! };
}
