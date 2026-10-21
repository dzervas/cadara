import { test, expect } from "vitest";

import {
  chooseToolbarCompactionLevel,
  estimateToolbarCompactionWidth,
  getUnmeasuredToolbarCompactionLevel,
  listToolbarCompactionLevels,
  type ToolbarCompactionLevel,
  type ToolbarCompactionMetrics,
  type ToolbarCompactionSection,
} from "@/core/tools/toolbar-compaction";
import {
  pickRecentToolbarTool,
  promoteRecentToolbarTool,
  recordRecentToolbarTool,
} from "@/core/tools/toolbar-recency";

const sections: ToolbarCompactionSection[] = [
  { id: "history", pinned: true, tools: [plain("undo"), plain("redo")] },
  {
    id: "draw",
    pinned: false,
    tools: [plain("point"), family("line", 2), family("circle", 3)],
  },
  { id: "constrain", pinned: false, tools: [plain("a"), plain("b")] },
  { id: "dimension", pinned: false, tools: [family("dimension", 4)] },
  { id: "edit", pinned: false, tools: [plain("trim"), plain("offset")] },
];

const metrics: ToolbarCompactionMetrics = {
  toolWidth: 10,
  dropdownWidth: 20,
  pillChromeWidth: 2,
  pillGap: 1,
  railGap: 5,
};

function plain(id: string) {
  return { id, variantCount: null };
}

function family(id: string, variantCount: number) {
  return { id, variantCount };
}

function describeLevel(level: ToolbarCompactionLevel) {
  return {
    stage: level.stage,
    families: [...level.collapsedFamilyIds],
    groups: level.groups.map(
      (group) => `${group.sectionIds.join("+")}${group.collapsed ? "*" : ""}`,
    ),
  };
}

test("toolbar compaction collapses families, then islands, then merges islands, each from the end", () => {
  expect(listToolbarCompactionLevels(sections).map(describeLevel)).toEqual([
    {
      stage: "expanded",
      families: [],
      groups: ["history", "draw", "constrain", "dimension", "edit"],
    },
    {
      stage: "families",
      families: ["dimension"],
      groups: ["history", "draw", "constrain", "dimension", "edit"],
    },
    {
      stage: "families",
      families: ["dimension", "circle"],
      groups: ["history", "draw", "constrain", "dimension", "edit"],
    },
    {
      stage: "families",
      families: ["dimension", "circle", "line"],
      groups: ["history", "draw", "constrain", "dimension", "edit"],
    },
    // The single-control dimension island never collapses on its own and
    // pinned history never collapses at all.
    {
      stage: "islands",
      families: ["dimension", "circle", "line"],
      groups: ["history", "draw", "constrain", "dimension", "edit*"],
    },
    {
      stage: "islands",
      families: ["dimension", "circle", "line"],
      groups: ["history", "draw", "constrain*", "dimension", "edit*"],
    },
    {
      stage: "islands",
      families: ["dimension", "circle", "line"],
      groups: ["history", "draw*", "constrain*", "dimension", "edit*"],
    },
    {
      stage: "merged",
      families: ["dimension", "circle", "line"],
      groups: ["history", "draw*", "constrain*", "dimension+edit*"],
    },
    {
      stage: "merged",
      families: ["dimension", "circle", "line"],
      groups: ["history", "draw*", "constrain+dimension+edit*"],
    },
    {
      stage: "merged",
      families: ["dimension", "circle", "line"],
      groups: ["history", "draw+constrain+dimension+edit*"],
    },
  ]);
});

test("toolbar compaction picks the widest level that fits and never expands past the most compact one", () => {
  const levels = listToolbarCompactionLevels(sections);
  const widths = levels.map((level) =>
    estimateToolbarCompactionWidth(sections, level, metrics),
  );

  // history 2+10+1+10, draw 2 + point + 2 line + 3 circle with 5 gaps,
  // constrain 2+21, dimension 2 + 4 variants with 3 gaps, edit 2+21, 4 rail gaps.
  expect(widths[0]).toBe(23 + 67 + 23 + 45 + 23 + 20);
  for (let index = 1; index < widths.length; index += 1) {
    expect(
      widths[index],
      `level ${index} must not be wider than level ${index - 1}`,
    ).toBeLessThanOrEqual(widths[index - 1]!);
  }

  expect(chooseToolbarCompactionLevel(sections, levels, 10_000, metrics)).toBe(
    levels[0],
  );
  expect(
    chooseToolbarCompactionLevel(sections, levels, widths[5]!, metrics),
  ).toBe(levels[5]);
  expect(
    chooseToolbarCompactionLevel(sections, levels, widths[5]! - 0.5, metrics),
  ).toBe(levels[6]);
  expect(
    chooseToolbarCompactionLevel(sections, levels, 1, metrics),
    "Nothing fits: stay at the most compact level instead of hiding tools.",
  ).toBe(levels.at(-1));
});

test("before measuring, the toolbar shows every family collapsed and every island expanded", () => {
  const levels = listToolbarCompactionLevels(sections);
  expect(describeLevel(getUnmeasuredToolbarCompactionLevel(levels))).toEqual(
    describeLevel(levels[3]!),
  );
});

test("toolbar recency promotes the latest used tool to the front of its dropdown", () => {
  const tools = [{ id: "a" }, { id: "b" }, { id: "c" }];
  let recent = recordRecentToolbarTool([], "b");
  recent = recordRecentToolbarTool(recent, "x");
  recent = recordRecentToolbarTool(recent, "c");
  recent = recordRecentToolbarTool(recent, "b");

  expect(recent).toEqual(["b", "c", "x"]);
  expect(pickRecentToolbarTool(tools, recent)?.id).toBe("b");
  expect(
    promoteRecentToolbarTool(tools, recent).map((tool) => tool.id),
  ).toEqual(["b", "a", "c"]);
  expect(
    promoteRecentToolbarTool(tools, ["x"]).map((tool) => tool.id),
    "With no recent tool in the dropdown, keep definition order.",
  ).toEqual(["a", "b", "c"]);
});
