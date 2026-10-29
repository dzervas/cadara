import type {
  SketchDefinition,
  RegionRecord,
  SketchStyleRecord,
  SketchStyleDefinition,
} from "@/contracts/sketch/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  SketchStylePatch,
  SketchStyleToolId,
} from "@/core/sketch-styles/definition";
import type { SketchStyleId } from "@/contracts/shared/ids";

export function applyStylePatchToDefinition(
  definition: SketchDefinition,
  solvedRegions: readonly RegionRecord[],
  targets: readonly Extract<
    PrimitiveRef,
    { kind: "region" | "sketchEntity" }
  >[],
  patch: SketchStylePatch,
  toolId: SketchStyleToolId,
): SketchDefinition {
  if (toolId === "fill") {
    return applyFillStylePatchToDefinition(
      definition,
      solvedRegions,
      targets,
      patch,
    );
  }

  if (isFillStylePatch(patch)) {
    return definition;
  }

  const entityIds = new Set(
    targets
      .filter(
        (target): target is Extract<PrimitiveRef, { kind: "sketchEntity" }> =>
          target.kind === "sketchEntity",
      )
      .map((target) => target.entityId),
  );

  let didChange = false;

  const entities = definition.entities.map((entity) => {
    if (!entityIds.has(entity.entityId)) {
      return entity;
    }

    const nextStyle = applySketchStyleDefinitionPatch(entity.style, patch);
    if (nextStyle === entity.style) {
      return entity;
    }

    didChange = true;
    return { ...entity, style: nextStyle };
  });

  if (!didChange) {
    return definition;
  }

  return {
    ...definition,
    entities,
  };
}

function applyFillStylePatchToDefinition(
  definition: SketchDefinition,
  solvedRegions: readonly RegionRecord[],
  targets: readonly Extract<
    PrimitiveRef,
    { kind: "region" | "sketchEntity" }
  >[],
  patch: SketchStylePatch,
): SketchDefinition {
  if (!isFillStylePatch(patch)) {
    return definition;
  }

  const liveRegionIds = new Set(solvedRegions.map((region) => region.regionId));
  const regionIds = targets.flatMap((target) =>
    target.kind === "region" && liveRegionIds.has(target.regionId)
      ? [target.regionId]
      : [],
  );

  if (regionIds.length === 0) {
    return definition;
  }

  const styles = [...(definition.styles ?? [])];
  const styleIds = [...(definition.styleIds ?? [])];
  let didChange = false;

  for (const regionId of regionIds) {
    const index = styles.findIndex(
      (style) =>
        style.target.kind === "region" && style.target.regionId === regionId,
    );
    const current =
      index >= 0 ? styles[index]! : createDefaultRegionStyleRecord(regionId);
    const next = applyRegionFillPatch(current, patch);
    if (next === current) {
      continue;
    }

    if (!styleIds.includes(next.styleId)) {
      styleIds.push(next.styleId);
    }

    if (index >= 0) {
      styles[index] = next;
    } else {
      styles.push(next);
    }
    didChange = true;
  }

  return didChange
    ? {
        ...definition,
        styleIds,
        styles,
      }
    : definition;
}

export function isFillStylePatch(patch: SketchStylePatch): patch is Extract<
  SketchStylePatch,
  {
    field: "fillMode" | "fillColor" | "fillOpacity" | "gradientStartColor" | "gradientEndColor";
  }
> {
  return (
    patch.field === "fillMode" ||
    patch.field === "fillColor" ||
    patch.field === "fillOpacity" ||
    patch.field === "gradientStartColor" ||
    patch.field === "gradientEndColor"
  );
}

function createDefaultRegionStyleRecord(
  regionId: RegionRecord["regionId"],
): SketchStyleRecord {
  return {
    styleId: `sketch_style_${regionId}` as SketchStyleId,
    label: `Region ${regionId} style`,
    target: { kind: "region", regionId },
    fill: { kind: "none" },
    stroke: {
      color: "var(--cad-foreground)",
      opacity: 0,
      width: 0,
      lineCap: "round",
      lineJoin: "round",
      miterLimit: 4,
    },
  };
}

function applyRegionFillPatch(
  style: SketchStyleRecord,
  patch: Extract<
    SketchStylePatch,
    {
      field:
        | "fillMode"
        | "fillColor"
        | "fillOpacity"
        | "gradientStartColor"
        | "gradientEndColor";
    }
  >,
): SketchStyleRecord {
  const current = sketchStyleRecordToDefinition(style);
  const nextDefinition = applySketchStyleDefinitionPatch(current, patch);
  const nextFill = sketchStyleDefinitionToFill(nextDefinition);

  if (JSON.stringify(style.fill) === JSON.stringify(nextFill)) {
    return style;
  }

  return {
    ...style,
    fill: nextFill,
  };
}

function applySketchStyleDefinitionPatch(
  style: SketchStyleDefinition | undefined,
  patch: SketchStylePatch,
): SketchStyleDefinition {
  const next = { ...(style ?? {}) };

  switch (patch.field) {
    case "fillMode":
      if (next.fillMode === patch.value) {
        return style ?? next;
      }
      next.fillMode = patch.value;
      break;
    case "fillOpacity":
      if (next.fillOpacity === patch.value) {
        return style ?? next;
      }
      next.fillOpacity = patch.value;
      break;
    case "fillColor":
      if (next.fillColor === patch.value) {
        return style ?? next;
      }
      next.fillColor = patch.value;
      break;
    case "gradientStartColor":
      if (next.gradientStartColor === patch.value) {
        return style ?? next;
      }
      next.gradientStartColor = patch.value;
      break;
    case "gradientEndColor":
      if (next.gradientEndColor === patch.value) {
        return style ?? next;
      }
      next.gradientEndColor = patch.value;
      break;
    case "strokeEnabled":
      if (next.strokeEnabled === patch.value) {
        return style ?? next;
      }
      next.strokeEnabled = patch.value;
      break;
    case "strokeColor":
      if (next.strokeColor === patch.value) {
        return style ?? next;
      }
      next.strokeColor = patch.value;
      break;
    case "strokeWidth":
      if (next.strokeWidth === patch.value) {
        return style ?? next;
      }
      next.strokeWidth = patch.value;
      break;
    case "strokeCap":
      if (next.strokeCap === patch.value) {
        return style ?? next;
      }
      next.strokeCap = patch.value;
      break;
    case "strokeJoin":
      if (next.strokeJoin === patch.value) {
        return style ?? next;
      }
      next.strokeJoin = patch.value;
      break;
    case "strokeMiterLimit":
      if (next.strokeMiterLimit === patch.value) {
        return style ?? next;
      }
      next.strokeMiterLimit = patch.value;
      break;
    case "strokeDashSize":
      if (next.strokeDashSize === patch.value) {
        return style ?? next;
      }
      next.strokeDashSize = patch.value;
      break;
    case "strokeGapSize":
      if (next.strokeGapSize === patch.value) {
        return style ?? next;
      }
      next.strokeGapSize = patch.value;
      break;
  }

  return next;
}

export function sketchStyleRecordToDefinition(
  style: SketchStyleRecord | undefined,
): SketchStyleDefinition | undefined {
  if (!style) {
    return undefined;
  }

  return {
    ...sketchStyleFillToDefinition(style.fill),
    strokeEnabled: style.stroke.opacity > 0 && style.stroke.width > 0,
    strokeColor: style.stroke.color,
    strokeWidth: style.stroke.width,
    strokeCap: style.stroke.lineCap,
    strokeJoin: style.stroke.lineJoin,
    strokeMiterLimit: style.stroke.miterLimit,
    strokeDashSize: style.stroke.dashSize,
    strokeGapSize: style.stroke.gapSize,
  };
}

function sketchStyleFillToDefinition(
  fill: SketchStyleRecord["fill"],
): SketchStyleDefinition {
  if (fill.kind === "none") {
    return { fillMode: "none" };
  }

  if (fill.kind === "solid") {
    return {
      fillMode: "solid",
      fillColor: fill.color,
      fillOpacity: fill.opacity,
    };
  }

  return {
    fillMode: "gradient",
    gradientStartColor: fill.gradient.startColor,
    gradientEndColor: fill.gradient.endColor,
  };
}

function sketchStyleDefinitionToFill(
  style: SketchStyleDefinition,
): SketchStyleRecord["fill"] {
  if (style.fillMode === "none" || style.fillMode === undefined) {
    return { kind: "none" };
  }

  if (style.fillMode === "gradient") {
    return {
      kind: "gradient",
      gradient: {
        kind: "linear",
        angleRadians: 0,
        startColor:
          style.gradientStartColor ?? style.fillColor ?? "var(--cad-accent)",
        startOpacity: 0.42,
        endColor: style.gradientEndColor ?? "var(--cad-surface)",
        endOpacity: 0.28,
      },
    };
  }

  return {
    kind: "solid",
    color: style.fillColor ?? "var(--cad-accent)",
    opacity: style.fillOpacity ?? 0.42,
  };
}
