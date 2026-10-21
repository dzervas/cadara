/**
 * Onshape-style progressive toolbar compaction. Widest to narrowest: every
 * family expanded inline; families collapse to dropdowns; islands tuck their
 * trailing tools into one dropdown, one tool per step, rotating backwards from
 * the last island ("1 2 3 4" → "1 2 3>" → "1 2>" → "1>"); finally fully
 * collapsed islands merge. Earlier definitions stay visible longest.
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
  /**
   * Leading tools shown inline; the rest sit in one trailing dropdown. Equal
   * to the tool count when nothing is tucked away; 0 for merged groups.
   */
  inlineCount: number;
}

export interface ToolbarCompactionLevel {
  stage: ToolbarCompactionStage;
  collapsedFamilyIds: ReadonlySet<string>;
  groups: readonly ToolbarCompactionGroup[];
}

export function hasToolbarCompactionDropdown(
  group: ToolbarCompactionGroup,
  sectionById: ReadonlyMap<string, ToolbarCompactionSection>,
) {
  return (
    group.sectionIds.length > 1 ||
    group.inlineCount <
      (sectionById.get(group.sectionIds[0]!)?.tools.length ?? 0)
  );
}

export function listToolbarCompactionLevels(
  sections: readonly ToolbarCompactionSection[],
): ToolbarCompactionLevel[] {
  const collapsedFamilyIds = new Set<string>();
  let groups: ToolbarCompactionGroup[] = sections.map((section) => ({
    sectionIds: [section.id],
    inlineCount: section.tools.length,
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
  // A single-control island gains nothing by tucking, so it only takes part
  // in merging. Tucking one tool would just swap it for a dropdown, so the
  // first step tucks two.
  const trimmableIndexes = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => !section.pinned && section.tools.length > 1)
    .map(({ index }) => index)
    .reverse();
  while (trimmableIndexes.some((index) => groups[index]!.inlineCount > 0)) {
    for (const index of trimmableIndexes) {
      const group = groups[index]!;
      if (group.inlineCount === 0) {
        continue;
      }
      const toolCount = sections[index]!.tools.length;
      const inlineCount =
        group.inlineCount === toolCount ? toolCount - 2 : group.inlineCount - 1;
      groups = groups.map((current, currentIndex) =>
        currentIndex === index ? { ...current, inlineCount } : current,
      );
      levels.push({
        stage: "islands",
        collapsedFamilyIds: allFamiliesCollapsed,
        groups,
      });
    }
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
        inlineCount: 0,
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
    const hasDropdown = hasToolbarCompactionDropdown(group, sectionById);
    let childCount = hasDropdown ? 1 : 0;
    let childWidth = hasDropdown ? metrics.dropdownWidth : 0;
    const inlineTools =
      group.sectionIds.length > 1
        ? []
        : (sectionById.get(group.sectionIds[0]!)?.tools ?? []).slice(
            0,
            group.inlineCount,
          );
    for (const tool of inlineTools) {
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
