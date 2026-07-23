import type { AuthoredValue } from "@/contracts/modeling/authored-values";
import type { FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { FeatureReplayFeatureSchemaVersion } from "@/contracts/shared/versioning";

/**
 * Replays the supported operation delta of exact earlier authored features at
 * a linear instance transform or a mirror transform. This is intentionally not
 * a body-copy pattern: source operations retain their original target lineage.
 */
export interface FeatureReplayFeatureParameters {
  /** Ordered durable source features. Their order is semantic for nested replay. */
  sourceFeatureIds: readonly FeatureId[];
  transform:
    | {
        kind: "linear";
        /** Observed feature-pattern direction: an explicit construction plane. */
        direction: Extract<DurableRef, { kind: "construction" }>;
        /** Total count including the original source operation. */
        instanceCount: AuthoredValue<number>;
        /** Positive document-length spacing between adjacent replay instances. */
        spacing: AuthoredValue<number>;
        oppositeDirection: AuthoredValue<boolean>;
      }
    | {
        kind: "mirror";
        /** Observed feature-mirror plane: an explicit construction plane. */
        plane: Extract<DurableRef, { kind: "construction" }>;
      };
}

export interface FeatureReplayFeatureDefinition {
  kind: "featureReplay";
  featureTypeVersion: FeatureReplayFeatureSchemaVersion;
  parameters: FeatureReplayFeatureParameters;
}
