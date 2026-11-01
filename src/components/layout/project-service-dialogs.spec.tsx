import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { workbenchTheme } from "@/theme/workbench-theme";
import {
  MoveToProjectForm,
  OpenServiceProjectForm,
  UploadProjectForm,
} from "./project-service-dialogs";

function render(node: ReactNode) {
  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      {node}
    </MantineProvider>,
  );
}

test("the upload form proposes the project name and a slug derived from it, private by default", () => {
  const html = render(
    <UploadProjectForm
      organizations={[{ id: "org", name: "Personal" }]}
      defaultName="My Bracket"
      busy={false}
      error={null}
      deriveSlug={(name) => name.toLowerCase().replace(/\s+/g, "-")}
      onCancel={() => undefined}
      onSubmit={() => undefined}
    />,
  );
  expect(html).toContain('value="My Bracket"');
  expect(html).toContain('value="my-bracket"');
  expect(html).toContain("Personal");
  expect(html).toMatch(/checked="" value="private"/);
});

test("the upload form shows the service's refusal", () => {
  expect(
    render(
      <UploadProjectForm
        organizations={[{ id: "org", name: "Personal" }]}
        defaultName="Bracket"
        busy={false}
        error="Another project already uses that URL name."
        deriveSlug={(name) => name}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    ),
  ).toContain('role="alert"');
});

test("projects without uploaded documents cannot be opened", () => {
  const html = render(
    <OpenServiceProjectForm
      organizations={[{ id: "org", name: "Personal" }]}
      orgId="org"
      projects={[
        { id: "a", name: "Bracket", available: true },
        { id: "b", name: "Hinge", available: false },
      ]}
      busy={false}
      error={null}
      onSelectOrganization={() => undefined}
      onOpen={() => undefined}
    />,
  );
  expect(html).toContain("Bracket");
  expect(html).toMatch(/disabled=""[^>]*>.*Hinge.*Not uploaded yet/s);
});

test("Move to project lists targets by location, explains disabled ones and says undo steps stay behind", () => {
  const html = render(
    <MoveToProjectForm
      documentTitle="Lid"
      targets={[
        {
          projectId: "bracket",
          name: "Bracket",
          group: "On this device",
          disabledReason: null,
          action: null,
        },
        {
          projectId: "shared",
          name: "Shared hinge",
          group: "Team",
          disabledReason: "Offline. Connect to move into an account project.",
          action: null,
        },
      ]}
      busy={false}
      error={null}
      onCancel={() => undefined}
      onMove={() => undefined}
    />,
  );
  expect(html).toMatch(/On this device.*Bracket.*Team.*Shared hinge/s);
  expect(html).toMatch(
    /disabled=""[^>]*value="shared".*Offline\. Connect to move into an account project\./s,
  );
  expect(html).toContain("Its undo steps stay behind.");
  // Nothing is chosen yet, so the move needs a confirmed target.
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
});
