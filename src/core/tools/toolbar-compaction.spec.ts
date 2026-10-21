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
      (group) => `${group.sectionIds.join("+")}:${group.inlineCount}`,
    ),
  };
}

test("toolbar compaction collapses families, then tucks island tools one at a time rotating from the end, then merges islands", () => {
  const families = ["dimension", "circle", "line"];
  expect(listToolbarCompactionLevels(sections).map(describeLevel)).toEqual([
    {
      stage: "expanded",
      families: [],
      groups: ["history:2", "draw:3", "constrain:2", "dimension:1", "edit:2"],
    },
    {
      stage: "families",
      families: ["dimension"],
      groups: ["history:2", "draw:3", "constrain:2", "dimension:1", "edit:2"],
    },
    {
      stage: "families",
      families: ["dimension", "circle"],
      groups: ["history:2", "draw:3", "constrain:2", "dimension:1", "edit:2"],
    },
    {
      stage: "families",
      families,
      groups: ["history:2", "draw:3", "constrain:2", "dimension:1", "edit:2"],
    },
    // One island per step, last first. The first tuck takes two tools (a
    // one-tool dropdown saves nothing); the single-control dimension island
    // and pinned history never tuck.
    {
      stage: "islands",
      families,
      groups: ["history:2", "draw:3", "constrain:2", "dimension:1", "edit:0"],
    },
    {
      stage: "islands",
      families,
      groups: ["history:2", "draw:3", "constrain:0", "dimension:1", "edit:0"],
    },
    {
      stage: "islands",
      families,
      groups: ["history:2", "draw:1", "constrain:0", "dimension:1", "edit:0"],
    },
    {
      stage: "islands",
      families,
      groups: ["history:2", "draw:0", "constrain:0", "dimension:1", "edit:0"],
    },
    {
      stage: "merged",
      families,
      groups: ["history:2", "draw:0", "constrain:0", "dimension+edit:0"],
    },
    {
      stage: "merged",
      families,
      groups: ["history:2", "draw:0", "constrain+dimension+edit:0"],
    },
    {
      stage: "merged",
      families,
      groups: ["history:2", "draw+constrain+dimension+edit:0"],
    },
  ]);
});

test("two four-tool islands shrink alternately: 1 2 3> | 1 2 3>, then 1 2> | 1 2>, then 1> | 1>", () => {
  const four = (id: string): ToolbarCompactionSection => ({
    id,
    pinned: false,
    tools: ["1", "2", "3", "4"].map((tool) => plain(`${id}${tool}`)),
  });
  expect(
    listToolbarCompactionLevels([four("a"), four("b")]).map(
      (level) => describeLevel(level).groups,
    ),
  ).toEqual([
    ["a:4", "b:4"],
    ["a:4", "b:2"],
    ["a:2", "b:2"],
    ["a:2", "b:1"],
    ["a:1", "b:1"],
    ["a:1", "b:0"],
    ["a:0", "b:0"],
    ["a+b:0"],
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
  // Level 6: draw keeps the point and tucks line and circle: 2 + 10 + 1 + 20,
  // constrain and edit are one dropdown each, dimension one dropdown.
  expect(widths[6]).toBe(23 + 33 + 22 + 22 + 22 + 20);
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
