/**
 * Onshape-style progressive toolbar compaction. Widest to narrowest:
 * every family expanded inline, families collapse to dropdowns, whole islands
 * collapse to one dropdown, and finally collapsed islands merge. Each stage
 * walks the definition order backwards, so earlier tools stay visible longest.
 */

export interface ToolbarCompactionTool {
  id: string;
  /** Number of family variants, or null for a plain tool. */
  variantCount: number | null;
}

export interface ToolbarCompactionSection {
  id: string;
  pinned: boolean;
  tools: readonly ToolbarCompactionTool[];
}

export interface ToolbarCompactionMetrics {
  toolWidth: number;
  dropdownWidth: number;
  pillChromeWidth: number;
  pillGap: number;
  railGap: number;
}

export type ToolbarCompactionStage =
  | "expanded"
  | "families"
  | "islands"
  | "merged";

export interface ToolbarCompactionGroup {
  sectionIds: readonly string[];
  /** Rendered as a single dropdown listing every tool of its sections. */
  collapsed: boolean;
}

export interface ToolbarCompactionLevel {
  stage: ToolbarCompactionStage;
  collapsedFamilyIds: ReadonlySet<string>;
  groups: readonly ToolbarCompactionGroup[];
}

export function listToolbarCompactionLevels(
  sections: readonly ToolbarCompactionSection[],
): ToolbarCompactionLevel[] {
  const collapsedFamilyIds = new Set<string>();
  let groups: ToolbarCompactionGroup[] = sections.map((section) => ({
    sectionIds: [section.id],
    collapsed: false,
  }));
  const levels: ToolbarCompactionLevel[] = [
    { stage: "expanded", collapsedFamilyIds: new Set(), groups },
  ];

  const familyIds = sections.flatMap((section) =>
    section.tools
      .filter((tool) => tool.variantCount !== null)
      .map((tool) => tool.id),
  );
  for (const familyId of familyIds.reverse()) {
    collapsedFamilyIds.add(familyId);
    levels.push({
      stage: "families",
      collapsedFamilyIds: new Set(collapsedFamilyIds),
      groups,
    });
  }

  const allFamiliesCollapsed: ReadonlySet<string> = new Set(collapsedFamilyIds);
  const pinnedIds = new Set(
    sections.filter((section) => section.pinned).map((section) => section.id),
  );
  // A single-control island gains nothing by collapsing, so it only takes
  // part in merging.
  const collapsibleIds = sections
    .filter((section) => !section.pinned && section.tools.length > 1)
    .map((section) => section.id);
  for (const sectionId of collapsibleIds.reverse()) {
    groups = groups.map((group) =>
      group.sectionIds[0] === sectionId ? { ...group, collapsed: true } : group,
    );
    levels.push({
      stage: "islands",
      collapsedFamilyIds: allFamiliesCollapsed,
      groups,
    });
  }

  const isMergeable = (group: ToolbarCompactionGroup) =>
    !group.sectionIds.some((sectionId) => pinnedIds.has(sectionId));
  for (;;) {
    const index = groups.findLastIndex(
      (group, groupIndex) =>
        groupIndex > 0 &&
        isMergeable(group) &&
        isMergeable(groups[groupIndex - 1]!),
    );
    if (index < 0) {
      break;
    }
    groups = [
      ...groups.slice(0, index - 1),
      {
        sectionIds: [
          ...groups[index - 1]!.sectionIds,
          ...groups[index]!.sectionIds,
        ],
        collapsed: true,
      },
      ...groups.slice(index + 1),
    ];
    levels.push({
      stage: "merged",
      collapsedFamilyIds: allFamiliesCollapsed,
      groups,
    });
  }

  return levels;
}

/** The layout shown before the toolbar can be measured: families collapsed, islands expanded. */
export function getUnmeasuredToolbarCompactionLevel(
  levels: readonly ToolbarCompactionLevel[],
): ToolbarCompactionLevel {
  return levels.findLast((level) => level.stage === "families") ?? levels[0]!;
}

export function estimateToolbarCompactionWidth(
  sections: readonly ToolbarCompactionSection[],
  level: ToolbarCompactionLevel,
  metrics: ToolbarCompactionMetrics,
): number {
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const groupWidths = level.groups.map((group) => {
    if (group.collapsed) {
      return metrics.pillChromeWidth + metrics.dropdownWidth;
    }

    let childCount = 0;
    let childWidth = 0;
    for (const tool of sectionById.get(group.sectionIds[0]!)?.tools ?? []) {
      if (tool.variantCount === null) {
        childCount += 1;
        childWidth += metrics.toolWidth;
      } else if (level.collapsedFamilyIds.has(tool.id)) {
        childCount += 1;
        childWidth += metrics.dropdownWidth;
      } else {
        childCount += tool.variantCount;
        childWidth += tool.variantCount * metrics.toolWidth;
      }
    }
    return (
      metrics.pillChromeWidth +
      childWidth +
      Math.max(0, childCount - 1) * metrics.pillGap
    );
  });

  return (
    groupWidths.reduce((total, width) => total + width, 0) +
    Math.max(0, groupWidths.length - 1) * metrics.railGap
  );
}

/** The widest level that fits, or the most compact one when nothing fits. */
export function chooseToolbarCompactionLevel(
  sections: readonly ToolbarCompactionSection[],
  levels: readonly ToolbarCompactionLevel[],
  availableWidth: number,
  metrics: ToolbarCompactionMetrics,
): ToolbarCompactionLevel {
  return (
    levels.find(
      (level) =>
        estimateToolbarCompactionWidth(sections, level, metrics) <=
        availableWidth,
    ) ?? levels[levels.length - 1]!
  );
}
