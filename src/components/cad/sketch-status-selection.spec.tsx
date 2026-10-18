import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { SketchValidationStatus } from "./sketch-selection-context";
import { SketchToolPanel } from "./sketch-tool-panel";
import { WorkbenchNotification } from "@/components/layout/workbench-notification";

// UI lane (docs/testing.md): selectable text is a render-local contract;
// only the text takes pointers, not the status panel's canvas overlay.
test("sketch status text is selectable without capturing the surrounding overlay", () => {
  const markup = renderToStaticMarkup(
    <SketchValidationStatus message="Profiles are blocked." />,
  );
  expect(markup).toMatch(/<div[^>]*class="[^"]*pointer-events-none/);
  expect(markup).toMatch(
    /<span[^>]*style="[^"]*pointer-events:auto[^"]*user-select:text[^>]*>Profiles are blocked\.<\/span>/,
  );
  const toolMarkup = renderToStaticMarkup(
    <MantineProvider>
      <SketchToolPanel
        schema={{
          prompts: [],
          validation: [
            { id: "refusal", severity: "error", message: "Cannot trim." },
          ],
        }}
        onPatch={() => undefined}
      />
    </MantineProvider>,
  );
  expect(toolMarkup).toMatch(
    /<span[^>]*style="[^"]*pointer-events:auto[^"]*user-select:text[^>]*>Cannot trim\.<\/span>/,
  );
});

test("workbench notification titles and messages explicitly allow text selection", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <WorkbenchNotification
        type="error"
        title="Document failed"
        message="Could not save."
      />
    </MantineProvider>,
  );
  for (const text of ["Document failed", "Could not save."]) {
    expect(markup).toMatch(
      new RegExp(
        `<div[^>]*style="[^"]*user-select:text[^"]*"[^>]*>${text.replaceAll(".", "\\.")}<`,
      ),
    );
  }
});
