import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { workbenchTheme } from "@/theme/workbench-theme";
import { makeSketchDraftRecoveryFixture } from "@/application/sketch-draft-recovery/recovery.fixtures";
import { SketchDraftRecoveryNotification } from "./sketch-draft-recovery-notification";

test("recovery notification offers explicit Resume and Discard and explains private-until-Finish", async () => {
  const { draft } = await makeSketchDraftRecoveryFixture();
  const markup = renderToStaticMarkup(<MantineProvider theme={workbenchTheme}>
    <SketchDraftRecoveryNotification draft={draft} onResume={() => {}} onDiscard={() => {}} />
  </MantineProvider>);
  expect(markup).toContain("Recover sketch draft");
  expect(markup).toContain(">Resume<");
  expect(markup).toContain(">Discard<");
  expect(markup).toContain("stay private until Finish");
  expect(markup).not.toContain("Dismiss notification");
});
