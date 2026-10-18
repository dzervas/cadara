import type { SemanticCommand } from "@/contracts/semantic/schema";

export type DiscoveryAlias = { alias: string };
/** Omit alias for current discovery. sketch names an alias identifying the owning sketch. */
export type TargetSelector = { alias?: string; label: string; sketch?: string };
type SelectableGeometryEdit<
  T = import("@/contracts/semantic/schema").SemanticSketchGeometryEdit,
> = T extends { target: infer R }
  ? Omit<T, "target" | "destination" | "boundary"> & {
      target: R | TargetSelector;
    } & (T extends { destination: infer D }
        ? { destination: D | TargetSelector }
        : unknown) &
      (T extends { boundary: infer B }
        ? { boundary: B | TargetSelector }
        : unknown)
  : never;
type SelectablePrimitive<
  T = import("@/contracts/semantic/schema").SemanticSketchPrimitive,
> = T extends { source: infer S }
  ? Omit<T, "source"> & { source: S | TargetSelector }
  : T;
type SelectableBooleanScope<T> = T extends { bodyId: infer B }
  ? Omit<T, "bodyId"> & { bodyId: B | TargetSelector }
  : T;
type SelectableReplayTransform<T> = T extends { direction: infer R }
  ? Omit<T, "direction"> & { direction: R | TargetSelector }
  : T extends { plane: infer R }
    ? Omit<T, "plane"> & { plane: R | TargetSelector }
    : never;
type SelectableFeatureParameters<T> = T extends {
  sourceFeatureIds: infer S extends readonly unknown[];
  transform: infer R;
}
  ? Omit<T, "sourceFeatureIds" | "transform"> & {
      sourceFeatureIds: readonly (S[number] | TargetSelector)[];
      transform: SelectableReplayTransform<R>;
    }
  : T extends { profiles: infer P extends readonly unknown[] }
    ? Omit<T, "profiles" | "axis" | "booleanScope"> & {
        profiles: readonly [
          P[number] | TargetSelector,
          ...(P[number] | TargetSelector)[],
        ];
      } & (T extends { axis: infer A }
          ? { axis: A | TargetSelector }
          : unknown) &
        (T extends { booleanScope: infer B }
          ? { booleanScope: SelectableBooleanScope<B> }
          : unknown)
    : T extends { edgeTargets: infer E extends readonly unknown[] }
      ? Omit<T, "edgeTargets"> & {
          edgeTargets: readonly (E[number] | TargetSelector)[];
        }
      : T extends {
            participants: infer P extends readonly {
              role: string;
              targets: readonly unknown[];
            }[];
          }
        ? Omit<T, "participants"> & {
            participants: {
              [K in keyof P]: Omit<P[K], "targets"> & {
                targets: readonly (P[K]["targets"][number] | TargetSelector)[];
              };
            };
          }
        : T extends {
              bodyTarget: infer B;
              faceTargets: infer F extends readonly unknown[];
            }
          ? Omit<T, "bodyTarget" | "faceTargets"> & {
              bodyTarget: B | TargetSelector;
              faceTargets: readonly (F[number] | TargetSelector)[];
            }
          : T extends { reference: { target: infer R } }
            ? Omit<T, "reference"> & {
                reference: { target: R | TargetSelector };
              }
            : T;
export type SelectableCommand<T = SemanticCommand> = T extends SemanticCommand
  ? Omit<
      T,
      | "parameters"
      | "basis"
      | "draft"
      | "points"
      | "dimensionId"
      | "derivationId"
      | "profile"
      | "featureId"
      | "beforeFeatureId"
      | "bodyId"
      | "cursor"
      | "item"
      | "beforeItem"
      | "variableId"
      | "sketchId"
      | "target"
      | "targets"
      | "axis"
      | "repair"
      | "edit"
      | "primitive"
      | "support"
    > &
      (T extends { parameters: infer P }
        ? { parameters: SelectableFeatureParameters<P> }
        : unknown) &
      (T extends { support: infer S }
        ? { support: S | TargetSelector }
        : unknown) &
      (T extends { primitive: unknown }
        ? { primitive: SelectablePrimitive }
        : unknown) &
      (T extends { edit: infer E }
        ? {
            edit: E extends { target: unknown } ? SelectableGeometryEdit<E> : E;
          }
        : unknown) &
      (T extends { axis: infer A } ? { axis: A | TargetSelector } : unknown) &
      (T extends { repair: infer R }
        ? {
            repair: R extends { kind: "axis"; target: infer A }
              ? { kind: "axis"; target: A | TargetSelector }
              : R extends { kind: "original"; target: infer A; output: infer O }
                ? {
                    kind: "original";
                    target: A | TargetSelector;
                    output: O | TargetSelector;
                  }
                : never;
          }
        : unknown) &
      (T extends { targets: infer R extends readonly unknown[] }
        ? { targets: readonly (R[number] | TargetSelector)[] }
        : unknown) &
      (T extends { profile: infer P }
        ? { profile: P | TargetSelector }
        : unknown) &
      (T extends { target: infer R }
        ? { target: R | TargetSelector }
        : unknown) &
      (T extends { featureId: infer F }
        ? { featureId: F | TargetSelector }
        : unknown) &
      (T extends { beforeFeatureId: infer F }
        ? { beforeFeatureId: F | TargetSelector }
        : unknown) &
      (T extends { bodyId: infer B }
        ? { bodyId: B | TargetSelector }
        : unknown) &
      (T extends { cursor: infer C }
        ? { cursor: C | TargetSelector }
        : unknown) &
      (T extends { item: infer I } ? { item: I | TargetSelector } : unknown) &
      (T extends { beforeItem: infer I }
        ? { beforeItem: I | TargetSelector }
        : unknown) &
      (T extends { variableId: infer V }
        ? { variableId: V | TargetSelector }
        : unknown) &
      (T extends { sketchId: infer S }
        ? { sketchId: S | TargetSelector }
        : unknown) &
      (T extends { points: infer P }
        ? { points: { [K in keyof P]: P[K] | TargetSelector } }
        : unknown) &
      (T extends { derivationId: infer D }
        ? { derivationId: D | TargetSelector }
        : unknown) &
      (T extends { dimensionId: infer D }
        ? { dimensionId: D | TargetSelector }
        : unknown) & { basis: T["basis"] | DiscoveryAlias } & (T extends {
        draft: infer D;
      }
        ? { draft: D | DiscoveryAlias }
        : unknown)
  : never;

export function isDiscoveryAlias(value: unknown): value is DiscoveryAlias {
  return !!value && typeof value === "object" && "alias" in value;
}

export function isTargetSelector(value: unknown): value is TargetSelector {
  return (
    !!value &&
    typeof value === "object" &&
    "label" in value &&
    Object.keys(value).every((key) =>
      ["alias", "label", "sketch"].includes(key),
    )
  );
}
