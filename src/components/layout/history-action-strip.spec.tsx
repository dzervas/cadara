import { MantineProvider } from "@mantine/core";
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { HistoryActionStrip } from "@/components/layout/history-action-strip";
import { workbenchTheme } from "@/theme/workbench-theme";

test("contextual action controls keep blocked entries visible with reasons and selected sequences", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme}>
      <HistoryActionStrip
        undo={[
          { sequence: 4, label: "Move Point" },
          {
            sequence: 7,
            label: "Delete Circle",
            blockedReason: "expected-state-changed",
          },
        ]}
        redo={[{ sequence: 3, label: "Set Diameter" }]}
        onUndo={() => undefined}
        onRedo={() => undefined}
      />
    </MantineProvider>,
  );

  expect(markup).toContain('data-history-action-sequence="7"');
  expect(markup).toContain("Delete Circle — blocked: expected-state-changed");
  expect(markup).toContain('data-history-action-sequence="4"');
  expect(markup).toContain('data-history-action-direction="redo"');
  expect(markup).toContain("Redo Set Diameter");
});
