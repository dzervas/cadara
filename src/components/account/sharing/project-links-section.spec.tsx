// Lane: ui. Seam: ProjectLinksSection's static rendering of the link state
// (the requests are in project-access.spec.ts; switching, copying and the
// links' effect are proven in e2e/cadara-vxju.8-sharing.spec.ts).
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import type { ComponentProps } from "react";
import { workbenchTheme } from "@/theme/workbench-theme";
import { ProjectLinksSection } from "./project-links-section";

function render(props: Partial<ComponentProps<typeof ProjectLinksSection>>) {
  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <ProjectLinksSection
        enabled
        canManage
        published
        publishedError={null}
        link={null}
        busy={false}
        failure={null}
        onSetEnabled={() => undefined}
        onRotate={() => undefined}
        onMakeLink={async () => null}
        {...props}
      />
    </MantineProvider>,
  );
}

test("with links on and a published version, an admin can copy a link to it and rotate", () => {
  const html = render({});
  expect(html).toContain(
    "Copy link shares the latest published model as a file for 7 days.",
  );
  expect(html).toContain(">Copy link<");
  expect(html).toContain(">Rotate<");
  expect(html).not.toContain("Publish a version to get a link.");
});

test("with nothing published there is no link to copy", () => {
  const html = render({ published: false });
  expect(html).toContain("Publish a version to get a link.");
  expect(html).not.toContain(">Copy link<");
  expect(html).toContain(">Rotate<");
});

test("published versions that could not be read are explained instead of claiming nothing is published", () => {
  const html = render({ published: false, publishedError: "Versions failed" });
  expect(html).toContain("Versions failed");
  expect(html).not.toContain("Publish a version to get a link.");
});

test("with links off nothing can be copied or rotated", () => {
  const html = render({ enabled: false });
  expect(html).not.toContain(">Copy link<");
  expect(html).not.toContain(">Rotate<");
  expect(html).not.toContain("Publish a version");
});

test("someone without admin rights reads the state only", () => {
  const html = render({ canManage: false });
  expect(html).toMatch(
    /<input[^>]*disabled=""[^>]*role="switch"|role="switch"[^>]*disabled=""/,
  );
  expect(html).not.toContain(">Copy link<");
  expect(html).not.toContain(">Rotate<");
});
