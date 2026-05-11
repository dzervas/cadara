import { test } from "bun:test";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { SketchToolPanel } from "@/components/cad/sketch-tool-panel";
import {
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_FLOATING_PANEL_TOP_STYLE,
} from "@/components/cad/viewport-overlay-layout";
import { expectTrue } from "@/testing/expect.spec";

test("src/components/cad/sketch-tool-panel.spec.tsx", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchToolPanel
        schema={{
          prompts: [{ id: "line-prompt", text: "Pick the starting point." }],
        }}
        onPatch={() => undefined}
      />
    </MantineProvider>,
  );

  expectTrue(
    markup.includes("Pick the starting point."),
    "Sketch tool panels should render active tool prompts.",
  );
  expectTrue(
    markup.includes(`left:${VIEWPORT_FLOATING_PANEL_LEFT_PX}px`) &&
      markup.includes(`top:${VIEWPORT_FLOATING_PANEL_TOP_STYLE}`),
    "Sketch tool panels should use the shared floating panel slot instead of rendering under the toolbar and parts tree.",
  );
  expectTrue(
    markup.includes("z-20") &&
      markup.includes("pointer-events-none") &&
      !markup.includes("left-4 top-4"),
    "Sketch tool panels should stay on the workbench overlay layer without anchoring to the blocked toolbar corner.",
  );
  expectTrue(
    !markup.includes("pointer-events-auto"),
    "Prompt-only sketch tool panels should not intercept canvas picks while visible in the left editor slot.",
  );
});
