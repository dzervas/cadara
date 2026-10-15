import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import {
  brokenDerivedInputMessage,
  nonAcceptedDerivedOutputPoints,
  nonAcceptedDerivedOutputs,
  uncertifiedOffsetInputMessage,
} from "@/contracts/sketch/offset-publication";
import type {
  DerivableSketchDefinition,
  SketchRecord,
} from "@/contracts/sketch/schema";

/** T17p2 (F-2): a committed record or a live pair (no dimension is read). */
type FeatureInputSketch = {
  definition: DerivableSketchDefinition;
  solvedSnapshot: SketchRecord["solvedSnapshot"];
};

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
  sketch: FeatureInputSketch,
  entityId: SketchEntityId,
  use: string,
): string | null {
  const owner = nonAcceptedDerivedOutputs(
    sketch.definition,
    sketch.solvedSnapshot,
  ).get(entityId);
  if (!owner) return null;
  // T17e (B2): both owner kinds are worded by label, never by id.
  return (
    owner.reason === "derivedFailed"
      ? brokenDerivedInputMessage
      : uncertifiedOffsetInputMessage
  )(sketch.definition, { entityId }, owner, `it can't be used as ${use}`);
}

/** Throws the targeted G19 feature failure (`code: message`) for a non-accepted offset output. */
export function assertAcceptedSketchFeatureInput(
  sketch: FeatureInputSketch,
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
  sketch: FeatureInputSketch,
  pointId: SketchPointId,
  use: string,
): string | null {
  const owner = nonAcceptedDerivedOutputPoints(
    sketch.definition,
    sketch.solvedSnapshot,
  ).get(pointId);
  if (!owner) return null;
  // T17e (B2): both owner kinds are worded by label, never by id.
  return (
    owner.reason === "derivedFailed"
      ? brokenDerivedInputMessage
      : uncertifiedOffsetInputMessage
  )(sketch.definition, { pointId }, owner, `it can't be used as ${use}`);
}

/** Throws the targeted G19c feature failure (`code: message`) for a driven point of a non-accepted offset output. */
export function assertAcceptedSketchFeaturePoint(
  sketch: FeatureInputSketch,
  pointId: SketchPointId,
  use: string,
) {
  const message = nonAcceptedOffsetFeaturePointMessage(sketch, pointId, use);
  if (message)
    throw new Error(`${NON_ACCEPTED_OFFSET_FEATURE_INPUT_CODE}: ${message}`);
}
