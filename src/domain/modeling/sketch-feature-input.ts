import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import {
  nonAcceptedOffsetOutputPoints,
  nonAcceptedOffsetOutputs,
} from "@/contracts/sketch/offset-publication";
import type { SketchRecord } from "@/contracts/sketch/schema";

/**
 * [TECH] G19 (T08b-g5c review REQUIRED-1): a feature referenced a
 * non-accepted offset output as modeling input (open profile curve, revolve
 * axis, sweep path, direction or axis reference), or ([TECH] G19c) one of its
 * driven points (hole location, extrude start or terminator point).
 */
export const NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE =
  "feature-input-offset-not-certified";

/**
 * The targeted failure message when `entityId` is a non-accepted offset
 * output of `sketch` (the shared G19 predicate), naming the output, its
 * relationship and the feature `use`; null for accepted geometry.
 */
export function nonAcceptedOffsetFeatureInputMessage(
  sketch: Pick<SketchRecord, "definition" | "solvedSnapshot">,
  entityId: SketchEntityId,
  use: string,
): string | null {
  const owner = nonAcceptedOffsetOutputs(
    sketch.definition,
    sketch.solvedSnapshot,
  ).get(entityId);
  return owner
    ? `Sketch entity ${entityId} is an output of offset relationship ${owner.derivationId}, which is not certified, so it cannot be used as ${use}.`
    : null;
}

/** Throws the targeted G19 feature failure (`code: message`) for a non-accepted offset output. */
export function assertAcceptedSketchFeatureInput(
  sketch: Pick<SketchRecord, "definition" | "solvedSnapshot">,
  entityId: SketchEntityId,
  use: string,
) {
  const message = nonAcceptedOffsetFeatureInputMessage(sketch, entityId, use);
  if (message)
    throw new Error(`${NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE}: ${message}`);
}

/**
 * [TECH] G19c: the targeted failure message when `pointId` is a driven point
 * of a non-accepted offset output of `sketch` (the G19b point predicate),
 * naming the point, its relationship and the feature `use`; null otherwise.
 */
export function nonAcceptedOffsetFeaturePointMessage(
  sketch: Pick<SketchRecord, "definition" | "solvedSnapshot">,
  pointId: SketchPointId,
  use: string,
): string | null {
  const owner = nonAcceptedOffsetOutputPoints(
    sketch.definition,
    sketch.solvedSnapshot,
  ).get(pointId);
  return owner
    ? `Sketch point ${pointId} is a driven point of an output of offset relationship ${owner.derivationId}, which is not certified, so it cannot be used as ${use}.`
    : null;
}

/** Throws the targeted G19c feature failure (`code: message`) for a driven point of a non-accepted offset output. */
export function assertAcceptedSketchFeaturePoint(
  sketch: Pick<SketchRecord, "definition" | "solvedSnapshot">,
  pointId: SketchPointId,
  use: string,
) {
  const message = nonAcceptedOffsetFeaturePointMessage(sketch, pointId, use);
  if (message)
    throw new Error(`${NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE}: ${message}`);
}
