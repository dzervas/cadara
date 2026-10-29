import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { ProjectSwitcher } from "./project-switcher";
import { workbenchTheme } from "@/theme/workbench-theme";

test("project switcher exposes the active project and a compact create action", () => {
  const html = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <ProjectSwitcher
        projects={[{ projectId: "one", name: "Enclosure" }]}
        activeProjectId="one"
        busy={false}
        onSwitch={() => undefined}
        onCreate={() => undefined}
      />
    </MantineProvider>,
  );
  expect(html).toContain('aria-label="Project"');
  expect(html).toContain("Enclosure");
  expect(html).toContain("New project");
});
