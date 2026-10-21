import type { tags } from "typia";

/** Slots are semantic authored outputs, never positions in discovery.references. */
export type CreationOutput =
  | { kind: "sketch"; role: "sketch"; index: 0 }
  | { kind: "sketchEntity"; role: "authoredEntity"; index: 0 }
  | { kind: "sketchPoint"; role: "authoredPoint" | "fitPoint"; index: number & tags.Type<"uint32"> }
  | { kind: "dimension"; role: "dimension"; index: 0 };

export type RecipeReference = {
  kind: "recipeRef";
  version: 1;
  createdBy: string;
  /** Earlier alias identifying the sketch owner (normally sketch.begin). */
  owner: { alias: string };
  output: CreationOutput | { kind: "sketchTangentHandle"; role: "splineOccurrence"; index: number & tags.Type<"uint32"> };
};

export function isRecipeReference(value: unknown): value is RecipeReference {
  return !!value && typeof value === "object" && "kind" in value && value.kind === "recipeRef";
}
