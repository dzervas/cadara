import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import {
  brokenDerivedInputMessage,
  nonAcceptedOffsetOutputPoints,
  nonAcceptedOffsetOutputs,
} from "@/contracts/sketch/offset-publication";
import type { SketchRecord } from "@/contracts/sketch/schema";

/**
 * [TECH] G19 (T08b-g5c review REQUIRED-1): a feature referenced a
 * non-accepted offset output as modeling input (open profile curve, revolve
 * axis, sweep path, direction or axis reference), or ([TECH] G19c) one of its
 * driven points (hole location, extrude start or terminator point).
 * T16c ([TECH] T16-7, review A-4): the code also covers geometry held by a
 * broken (failed) mirror, pattern or transform, worded by label
 * (`brokenDerivedInputMessage`). In production that case never gets here:
 * a failed relationship makes the sketch's derived validity invalid, and
 * features refuse non-current sketches first.
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
  if (!owner) return null;
  return owner.reason === "derivedFailed"
    ? brokenDerivedInputMessage(
        sketch.definition,
        { entityId },
        owner,
        `it can't be used as ${use}`,
      )
    : `Sketch entity ${entityId} is an output of offset relationship ${owner.derivationId}, which is not certified, so it cannot be used as ${use}.`;
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
  if (!owner) return null;
  return owner.reason === "derivedFailed"
    ? brokenDerivedInputMessage(
        sketch.definition,
        { pointId },
        owner,
        `it can't be used as ${use}`,
      )
    : `Sketch point ${pointId} is a driven point of an output of offset relationship ${owner.derivationId}, which is not certified, so it cannot be used as ${use}.`;
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
