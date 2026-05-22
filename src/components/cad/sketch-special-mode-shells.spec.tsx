import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { SketchSpecialModePanel } from "@/components/cad/sketch-special-mode-panel";
import { SketchSpecialModeViewportFeedback } from "@/components/cad/sketch-special-mode-viewport-feedback";
import {
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_OVERLAY_INSET_PX,
  VIEWPORT_FLOATING_PANEL_TOP_STYLE,
  VIEWPORT_OVERLAY_TOP_INSET_STYLE,
} from "@/components/cad/viewport-overlay-layout";

test("src/components/cad/sketch-special-mode-shells.spec.tsx", async () => {
  const panelMarkup = renderToStaticMarkup(
    <MantineProvider>
      <SketchSpecialModePanel
        schema={{
          title: "Fixture mode",
          subtitle: "Generic mode shell",
          prompts: [{ id: "prompt", text: "Adjust the committed operation." }],
          sections: [
            {
              id: "geometry",
              title: "Geometry",
              description: "Generic section copy.",
              fields: [
                {
                  id: "distance",
                  kind: "numeric",
                  label: "Distance",
                  value: 12,
                  action: {
                    kind: "patch",
                    patch: { field: "distance" },
                  },
                },
                {
                  id: "status",
                  kind: "readout",
                  label: "State",
                  value: "Ready",
                },
              ],
              diagnostics: [
                {
                  id: "warning",
                  message: "Review the selected target.",
                  severity: "warning",
                },
              ],
              buttons: [
                {
                  id: "focus",
                  label: "Focus",
                  action: {
                    kind: "invoke",
                    actionId: "focus",
                  },
                },
              ],
            },
          ],
          footerButtons: [
            {
              id: "cancel",
              label: "Cancel",
              action: {
                kind: "command",
                command: "cancel",
              },
            },
          ],
        }}
        onAction={() => undefined}
      />
    </MantineProvider>,
  );

  expect(
    panelMarkup.includes("Fixture mode"),
    "The generic special-mode panel should render the mode title.",
  ).toBeTruthy();
  expect(
    panelMarkup.includes("Geometry"),
    "The generic special-mode panel should render section titles.",
  ).toBeTruthy();
  expect(
    panelMarkup.includes("Review the selected target."),
    "The generic special-mode panel should render diagnostics.",
  ).toBeTruthy();
  expect(
    panelMarkup.includes("Cancel"),
    "The generic special-mode panel should render footer actions.",
  ).toBeTruthy();
  expect(
    panelMarkup.includes(`left:${VIEWPORT_FLOATING_PANEL_LEFT_PX}px`) &&
      panelMarkup.includes(`top:${VIEWPORT_FLOATING_PANEL_TOP_STYLE}`),
    "The generic special-mode panel should use the same floating left panel slot as the feature editor.",
  ).toBeTruthy();

  const feedbackMarkup = renderToStaticMarkup(
    <SketchSpecialModeViewportFeedback
      presentation={{
        prompts: [{ id: "prompt", text: "Pick a handle." }],
        diagnostics: [
          {
            id: "diag",
            message: "Constraint is unresolved.",
            severity: "warning",
          },
        ],
        overlays: [
          {
            id: "badge",
            kind: "badge",
            label: "Anchor",
            anchor: { kind: "sketchPoint", point: [1, 2] },
          },
          {
            id: "segment",
            kind: "segment",
            start: [0, 0],
            end: [4, 5],
          },
          {
            id: "handle",
            kind: "handle",
            label: "Corner",
            anchor: { kind: "sketchPoint", point: [3, 4] },
            handle: {
              kind: "sketchSpecialHandle",
              operationId: "sketch_operation_fixture",
              handleId: "sketch_special_handle_fixture",
            },
            draggable: true,
          },
        ],
      }}
      projections={[
        { id: "sketch-special-overlay:badge", x: 40, y: 60 },
        { id: "sketch-special-segment:segment:start", x: 10, y: 10 },
        { id: "sketch-special-segment:segment:end", x: 80, y: 90 },
        { id: "sketch-special-overlay:handle", x: 50, y: 30 },
      ]}
    />,
  );

  expect(
    feedbackMarkup.includes("Pick a handle."),
    "The generic special-mode feedback shell should render prompts.",
  ).toBeTruthy();
  expect(
    feedbackMarkup.includes("Constraint is unresolved."),
    "The generic special-mode feedback shell should render diagnostics.",
  ).toBeTruthy();
  expect(
    feedbackMarkup.includes("Anchor"),
    "The generic special-mode feedback shell should render badge labels.",
  ).toBeTruthy();
  expect(
    feedbackMarkup.includes("Corner"),
    "The generic special-mode feedback shell should render handle labels.",
  ).toBeTruthy();
  expect(
    feedbackMarkup.includes(`right:${VIEWPORT_OVERLAY_INSET_PX}px`) &&
      feedbackMarkup.includes(`top:${VIEWPORT_OVERLAY_TOP_INSET_STYLE}`),
    "The generic special-mode viewport status should clear the floating toolbar when it anchors on the right edge.",
  ).toBeTruthy();
});
