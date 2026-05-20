import { test, expect } from "vitest";
import {
  MAX_LEFT_SIDEBAR_WIDTH,
  MIN_LEFT_SIDEBAR_WIDTH,
  MIN_WORKBENCH_VIEWPORT_WIDTH,
  clampWorkbenchSidebarWidth,
  getWorkbenchSidebarWidthFromPointer,
} from "@/workbench/shell/workbench-shell-layout";

test("src/workbench/shell/workbench-shell-layout.spec.ts", async () => {
  expect(
    clampWorkbenchSidebarWidth(MIN_LEFT_SIDEBAR_WIDTH - 80, 1600),
    "Sidebar resizing should not collapse below the minimum width.",
  ).toBe(MIN_LEFT_SIDEBAR_WIDTH);

  expect(
    clampWorkbenchSidebarWidth(MAX_LEFT_SIDEBAR_WIDTH + 120, 2000),
    "Sidebar resizing should not exceed the configured maximum width on wide workbenches.",
  ).toBe(MAX_LEFT_SIDEBAR_WIDTH);

  expect(
    clampWorkbenchSidebarWidth(
      900,
      MIN_LEFT_SIDEBAR_WIDTH + MIN_WORKBENCH_VIEWPORT_WIDTH + 120,
    ),
    "Sidebar resizing should preserve the minimum viewport width on narrow workbenches.",
  ).toBe(400);

  expect(
    getWorkbenchSidebarWidthFromPointer(540, 120, 1200),
    "Sidebar dragging should resolve width from the shell-relative pointer position.",
  ).toBe(420);
});
