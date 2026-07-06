/**
 * Ground-truth verification (probe-absent v1).
 *
 * The spec requires comparing the staged rebuild of the planned import against
 * the bundle's captured tessellation. That staged rebuild needs the sandboxed
 * history evaluation capability, which is absent in v1. Rather than fabricate a
 * passing result, verification is reported as explicitly `unavailable`.
 *
 * The deviation comparison itself is implemented as a pure function so
 * `add-kernel-topology-signatures` can activate it against a staged rebuild
 * without provider changes.
 */

export type GroundTruthVerification =
  | {
      status: "unavailable";
      reason: string;
    }
  | {
      status: "passing";
      maxDeviation: number;
    }
  | {
      status: "diverged";
      maxDeviation: number;
      divergingFeatureIds: readonly string[];
    }
  | {
      status: "noGroundTruth";
    };

export interface RebuildTessellationSample {
  /** Flattened xyz triples sampled from the staged cadara rebuild. */
  points: readonly number[];
}

export interface CapturedTessellationSample {
  /** Flattened xyz triples from the bundle's captured tessellation. */
  points: readonly number[];
}

/** Report verification as explicitly unavailable while the probe is absent. */
export function verificationUnavailable(
  hasBodies: boolean,
): GroundTruthVerification {
  if (!hasBodies) {
    return { status: "noGroundTruth" };
  }
  return {
    status: "unavailable",
    reason:
      "Ground-truth verification requires the sandboxed history evaluation capability, which is not available on this platform. The import was not verified against the captured geometry.",
  };
}

/**
 * Compare a staged rebuild tessellation against the captured tessellation,
 * returning the maximum per-sample deviation. Pure; activated once staged
 * rebuilds exist. Samples must be aligned index-for-index.
 */
export function compareTessellation(
  rebuild: RebuildTessellationSample,
  captured: CapturedTessellationSample,
  tolerance: number,
  divergingFeatureIds: readonly string[] = [],
): GroundTruthVerification {
  const count = Math.min(rebuild.points.length, captured.points.length);
  let maxDeviation = 0;

  for (let index = 0; index + 2 < count; index += 3) {
    const dx = rebuild.points[index]! - captured.points[index]!;
    const dy = rebuild.points[index + 1]! - captured.points[index + 1]!;
    const dz = rebuild.points[index + 2]! - captured.points[index + 2]!;
    const deviation = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (deviation > maxDeviation) {
      maxDeviation = deviation;
    }
  }

  if (maxDeviation <= tolerance) {
    return { status: "passing", maxDeviation };
  }
  return { status: "diverged", maxDeviation, divergingFeatureIds };
}
