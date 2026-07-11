import type { FeatureDefinition } from "@/contracts/modeling/schema";

/**
 * Human-readable feature-tree description for a feature definition. Baked bodies
 * expose their non-parametric provenance and source span so the tree stays
 * honest about geometry that is not parametrically editable.
 */
export function describeFeatureTreeNode(definition: FeatureDefinition): string {
  if (definition.kind === "bakedBody") {
    const { provenance } = definition.parameters;
    const span = provenance.featureSpan
      ? ` (features ${provenance.featureSpan.fromFeatureId}–${provenance.featureSpan.toFeatureId})`
      : "";
    const sourceName = provenance.sourceName ? ` from ${provenance.sourceName}` : "";
    return `Baked body${sourceName}${span}`;
  }
  return `${definition.kind} feature`;
}
