import { test, expect } from "vitest";

import {
  getToolById,
  getToolbarSectionsForMode,
  searchToolDefinitions,
} from "@/core/tools/tool-registry";
import { toolIconAssetFileNames } from "@/core/tools/tool-icons";

test("src/core/tools/tool-registry.spec.ts", () => {
  const importTool = getToolById("import");
  const partToolIds = getToolbarSectionsForMode("part").flatMap(
    (section) => section.toolIds,
  );
  const sketchToolIds = getToolbarSectionsForMode("sketch").flatMap(
    (section) => section.toolIds,
  );

  expect(
    importTool.group,
    "Import should register in the import toolbar group.",
  ).toBe("import");
  expect(
    importTool.tooltip.includes("image") && importTool.tooltip.includes("mesh"),
    "Import should describe generic supported file categories.",
  ).toBeTruthy();
  expect(
    toolIconAssetFileNames[importTool.icon],
    "Import should use the requested public SVG asset.",
  ).toBe("import-part.svg");
  expect(
    partToolIds.includes("import"),
    "Import should be visible in part mode.",
  ).toBeTruthy();
  expect(
    sketchToolIds.includes("import"),
    "Import should not be visible while sketching.",
  ).toBeFalsy();
  expect(
    searchToolDefinitions("image").some((tool) => tool.id === "import"),
    "Tool search should discover Import by image intent.",
  ).toBeTruthy();
  expect(
    searchToolDefinitions("mesh").some((tool) => tool.id === "import"),
    "Tool search should discover Import by mesh intent.",
  ).toBeTruthy();
});
