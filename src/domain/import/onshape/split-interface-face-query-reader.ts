import { decodeCompressedQuery } from "@/domain/import/onshape/compressed-query-decoder";

/**
 * Exact decoded form used by 9841's post-sheet-split sketch supports. This is
 * intentionally not a general topology-query matcher.
 */
export interface OnshapeSplitInterfaceFaceQuery {
  profileSketchFeatureId: string;
  profileEntityId: "c.0" | "c.1";
  toolExtrudeFeatureId: string;
  splitFeatureId: string;
  endRole: "one-side-end";
}

export function readSplitInterfaceFaceQuery(
  queryString: string | null | undefined,
): OnshapeSplitInterfaceFaceQuery | null {
  const decoded = decodeCompressedQuery(queryString);
  if (!decoded) return null;
  const payload = decoded.payload;
  const sketch = /operationIdB2\$IdA1S[0-9a-f]+\.[0-9a-f]+\$([A-Za-z0-9_]+)wireOpS9\$queryTypeSd\$SKETCH_ENTITYSe\$sketchEntityIdSc\.1\$[A-Za-z0-9_]+J([01])/.exec(payload);
  const tool = /S[0-9a-f.]+\$([A-Za-z0-9_]+)opExtrudeR[\dA-Za-z]+Sa\$SWEPT_FACE/.exec(payload);
  const split = /S[0-9a-f.]+\$([A-Za-z0-9_]+)splitOpR[\dA-Za-z]+S17\$SPLIT_SURFACE_INTERSECT/.exec(payload);
  if (!sketch || !tool || !split || !payload.includes("Se$isFromBackBodyT")) return null;
  return {
    profileSketchFeatureId: sketch[1]!,
    profileEntityId: sketch[2] === "0" ? "c.1" : "c.0",
    toolExtrudeFeatureId: tool[1]!,
    splitFeatureId: split[1]!,
    endRole: "one-side-end",
  };
}
