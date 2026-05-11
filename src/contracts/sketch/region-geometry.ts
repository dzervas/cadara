export const REGION_POINT_TOLERANCE = 1e-6;
export const MIN_REGION_AREA = REGION_POINT_TOLERANCE * REGION_POINT_TOLERANCE;

const MIN_CLOSED_REGION_SAMPLE_COUNT = 32;
const MAX_CLOSED_REGION_SAMPLE_COUNT = 256;
const REGION_SAMPLE_TARGET_SAGITTA = 0.05;

export function getClosedCurveSampleCount(radius: number) {
  if (!Number.isFinite(radius) || radius <= REGION_POINT_TOLERANCE) {
    return MIN_CLOSED_REGION_SAMPLE_COUNT;
  }

  const targetSagitta = Math.max(
    REGION_POINT_TOLERANCE * 10,
    Math.min(REGION_SAMPLE_TARGET_SAGITTA, radius * 0.01),
  );
  const angle =
    2 * Math.acos(Math.max(-1, 1 - Math.min(targetSagitta / radius, 1)));
  if (!Number.isFinite(angle) || angle <= 0) {
    return MIN_CLOSED_REGION_SAMPLE_COUNT;
  }

  return Math.min(
    MAX_CLOSED_REGION_SAMPLE_COUNT,
    Math.max(MIN_CLOSED_REGION_SAMPLE_COUNT, Math.ceil((Math.PI * 2) / angle)),
  );
}
