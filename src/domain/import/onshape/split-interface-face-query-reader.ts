import { decodeCompressedQuery } from "@/domain/import/onshape/compressed-query-decoder";

/**
 * Exact decoded form used by 9841's post-sheet-split sketch supports. This is
 * intentionally not a general topology-query matcher.
 */
export interface OnshapeSplitInterfaceFaceQuery {
  profileSketchFeatureId: string;
  /** Onshape sketch entity id the query names, e.g. `ZFNETMCD9zyJ.0`. */
  profileSourceEntityId: string;
  toolExtrudeFeatureId: string;
  splitFeatureId: string;
}

export function readSplitInterfaceFaceQuery(
  queryString: string | null | undefined,
): OnshapeSplitInterfaceFaceQuery | null {
  const decoded = decodeCompressedQuery(queryString);
  if (!decoded) return null;
  const payload = decoded.payload;
  const sketch = /operationIdB2\$IdA1S[0-9a-f]+\.[0-9a-f]+\$([A-Za-z0-9_]+)wireOpS9\$queryTypeSd\$SKETCH_ENTITYSe\$sketchEntityId/.exec(payload);
  const tool = /S[0-9a-f.]+\$([A-Za-z0-9_]+)opExtrudeR[\dA-Za-z]+Sa\$SWEPT_FACE/.exec(payload);
  const split = /S[0-9a-f.]+\$([A-Za-z0-9_]+)splitOpR[\dA-Za-z]+S17\$SPLIT_SURFACE_INTERSECT/.exec(payload);
  if (!sketch || !tool || !split || !payload.includes("Se$isFromBackBodyT")) return null;
  // The value after the single `sketchEntityId` key is the entity id; its
  // length-prefixed parts join with "." like the other sketch-entity readers.
  const keyIndexes = decoded.tokens.flatMap((token, index) =>
    token.kind === "string" && token.parts.length === 1 &&
      token.parts[0]!.kind === "literal" && token.parts[0]!.value === "sketchEntityId"
      ? [index]
      : [],
  );
  if (keyIndexes.length !== 1) return null;
  const entity = decoded.tokens[keyIndexes[0]! + 1];
  if (entity?.kind !== "string") return null;
  const entityParts = entity.parts.flatMap((part) =>
    part.kind === "literal" && part.value.length > 0 ? [part.value] : [],
  );
  if (entityParts.length === 0 || entityParts.length !== entity.parts.length) return null;
  return {
    profileSketchFeatureId: sketch[1]!,
    profileSourceEntityId: entityParts.join("."),
    toolExtrudeFeatureId: tool[1]!,
    splitFeatureId: split[1]!
  };
}
