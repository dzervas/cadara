import { expect, test } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { appVersion, gitCommit } from "@/build-info";
import { AboutModal } from "@/components/layout/about-modal";
import { workbenchTheme } from "@/theme/workbench-theme";

test("About modal renders product identity, shared build info, and the project license", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <AboutModal opened withinPortal={false} onClose={() => undefined} />
    </MantineProvider>,
  );

  expect(markup).toContain("About CADara");
  expect(markup).toContain(`Version ${appVersion}`);
  expect(markup).toContain(`Build ${gitCommit}`);
  expect(markup).toContain("GNU Affero General Public License v3");
  expect(markup).toContain('role="dialog"');
  expect(markup).toContain('aria-label="Close modal"');
  expect(markup).not.toContain("Repository");
});

test("About modal is not rendered while closed", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <AboutModal
        opened={false}
        withinPortal={false}
        onClose={() => undefined}
      />
    </MantineProvider>,
  );

  expect(markup).not.toContain("About CADara");
});
