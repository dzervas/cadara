import type { SketchId } from "@/contracts/shared/ids";
import type { RegionRecord, SketchDefinition } from "@/contracts/sketch/schema";
import { createRegionId } from "@/contracts/sketch/region-identity";

/** Publishing a private sketch changes the sketch-id component of region identity. */
export async function remapPublishedRegionStyles(
  definition: SketchDefinition,
  sourceSketchId: SketchId | undefined,
  regions: readonly RegionRecord[],
): Promise<SketchDefinition> {
  if (!sourceSketchId || !definition.styles?.some((style) => style.target.kind === "region")) {
    return definition;
  }
  const regionIds = new Map(await Promise.all(regions.map(async (region) => [
    await createRegionId(sourceSketchId, region.signature), region.regionId,
  ] as const)));
  return {
    ...definition,
    styles: definition.styles.map((style) => {
      if (style.target.kind !== "region") return style;
      const regionId = regionIds.get(style.target.regionId);
      return regionId && regionId !== style.target.regionId
        ? { ...style, target: { ...style.target, regionId } }
        : style;
    }),
  };
}
