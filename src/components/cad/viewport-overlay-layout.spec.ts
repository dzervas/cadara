import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import {
  FLOATING_PARTS_TREE_WIDTH_PX,
  VIEWPORT_FLOATING_PANEL_GAP_PX,
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_FLOATING_PANEL_TOP_PX,
  VIEWPORT_OVERLAY_GAP_PX,
  VIEWPORT_OVERLAY_INSET_PX,
  VIEWPORT_OVERLAY_TOP_INSET_PX,
  VIEW_CUBE_SIZE_PX,
  getWorkbenchNotificationRightOffsetPx,
} from "@/components/cad/viewport-overlay-layout";

test("src/components/cad/viewport-overlay-layout.spec.ts", async () => {
  expectTrue(
    getWorkbenchNotificationRightOffsetPx({ reserveViewCube: false }) ===
      VIEWPORT_OVERLAY_INSET_PX,
    "Notification cards should use the normal viewport inset when no view cube space is reserved.",
  );

  expectTrue(
    getWorkbenchNotificationRightOffsetPx({ reserveViewCube: true }) ===
      VIEWPORT_OVERLAY_INSET_PX + VIEW_CUBE_SIZE_PX + VIEWPORT_OVERLAY_GAP_PX,
    "Notification cards should reserve the view cube width plus a gap when sharing the top-right viewport corner.",
  );

  expectTrue(
    VIEWPORT_FLOATING_PANEL_TOP_PX === VIEWPORT_OVERLAY_TOP_INSET_PX,
    "Left-side floating panels should start below the toolbar clearance line.",
  );

  expectTrue(
    VIEWPORT_FLOATING_PANEL_LEFT_PX ===
      VIEWPORT_OVERLAY_INSET_PX +
        FLOATING_PARTS_TREE_WIDTH_PX +
        VIEWPORT_FLOATING_PANEL_GAP_PX,
    "Left-side floating panels should clear the floating parts tree while matching the feature editor slot.",
  );
});
