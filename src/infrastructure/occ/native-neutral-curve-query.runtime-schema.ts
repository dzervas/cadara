import typia, { type tags } from "typia";

type FiniteNumber = number & tags.Type<"double">;
type NativePoint = readonly [FiniteNumber, FiniteNumber];

export interface NativeNeutralCurveQueryPoint {
  readonly u: FiniteNumber;
  readonly v: FiniteNumber;
  readonly first: NativePoint;
  readonly second: NativePoint;
  readonly reported: NativePoint;
}

export interface NativeNeutralCurveQueryPayload {
  readonly schemaVersion: "cadara-neutral-curve-query/v1";
  readonly status: "verified" | "candidate" | "uncertain" | "nativeFailure";
  readonly backend:
    | "IntAna2d"
    | "structuralBezierOverlap"
    | "Geom2dInt_GInter"
    | "none";
  readonly reason?: string;
  readonly points: readonly NativeNeutralCurveQueryPoint[];
  readonly segments: readonly {
    readonly opposite: boolean;
    readonly first: NativeNeutralCurveQueryPoint | null;
    readonly last: NativeNeutralCurveQueryPoint | null;
  }[];
}

const validateNativeNeutralCurveQueryPayload =
  typia.createValidateEquals<NativeNeutralCurveQueryPayload>();

export function parseNativeNeutralCurveQueryPayload(
  json: string,
): NativeNeutralCurveQueryPayload {
  const result = validateNativeNeutralCurveQueryPayload(
    JSON.parse(json) as unknown,
  );
  if (!result.success) {
    throw new Error(
      result.errors[0]?.description ??
        result.errors[0]?.expected ??
        "Native neutral-curve query payload is invalid.",
    );
  }
  return result.data;
}
