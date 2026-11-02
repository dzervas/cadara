// Lane: ui. Seam: ProjectPeopleSection's static rendering for admins and for
// read-only viewers (view rules live in project-people-view.spec.ts; clicks are
// proven in e2e/cadara-vxju.8-sharing.spec.ts).
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import type { ComponentProps } from "react";
import { workbenchTheme } from "@/theme/workbench-theme";
import { makeProjectPeople } from "../../../../test/helpers/project-people-fixtures";
import { ProjectAccessRefusal } from "@/application/account/project-access-port";
import { ProjectPeopleSection } from "./project-people-section";

function render(props: Partial<ComponentProps<typeof ProjectPeopleSection>>) {
  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <ProjectPeopleSection
        people={makeProjectPeople()}
        userId="user"
        canLeave={false}
        ownsPlan
        busy={false}
        failure={null}
        now={Date.UTC(2026, 0, 1)}
        onInvite={async () => true}
        onResendInvite={() => undefined}
        onRevokeInvite={() => undefined}
        onSetRole={() => undefined}
        onRemovePerson={() => undefined}
        onLeave={() => undefined}
        {...props}
      />
    </MantineProvider>,
  );
}

test("an admin gets the invite field, role menus and pending invites with Resend and Revoke", () => {
  const html = render({});
  expect(html).toContain('aria-label="Invite by email"');
  expect(html).toContain('aria-label="Role of Vera Viewer: Viewer"');
  expect(html).toContain("Owner · Admin");
  expect(html).toContain("Maker (you)");
  expect(html).toContain("new@example.test");
  expect(html).toContain("Invited as Commenter · expires in 14 days");
  expect(html).toContain(">Resend<");
  expect(html).toContain(">Revoke<");
  expect(html).toContain('aria-label="Editors on this project"');
  expect(html).not.toContain("Leave project");
});

test("someone without admin rights sees the list read-only", () => {
  const people = makeProjectPeople();
  people.can_manage = false;
  people.your_role = "viewer";
  people.pending = [];
  const html = render({ people, userId: "viewer", canLeave: true });
  expect(html).not.toContain("Invite by email");
  expect(html).not.toContain("Role of ");
  expect(html).not.toContain(">Remove<");
  expect(html).not.toContain("Editors on this project");
  expect(html).toContain("Vera Viewer (you)");
  // The role reads as text; there is no role menu to change it.
  expect(html).toContain(">Viewer<");
  expect(html).toContain("Leave project");
});

test("at the editor limit the invite row starts on Viewer instead of greeting the admin with an alert", () => {
  const people = makeProjectPeople();
  people.editors = { limit: 1, used: 1 };
  const html = render({ people });
  expect(html).toMatch(/<option[^>]*value="viewer"[^>]*selected=""/);
  expect(html).not.toContain("editors its plan allows");
});

test("an invite the plan refuses says so inline with Change plan for the plan's owner", () => {
  const people = makeProjectPeople();
  const failure = {
    area: "invite" as const,
    error: new ProjectAccessRefusal(
      { kind: "editor-limit", limit: 1, used: 1 },
      "refused",
    ),
  };
  const html = render({ people, failure });
  expect(html).toContain(
    "This project has 1 of 1 editors its plan allows. Invite as a commenter or viewer instead.",
  );
  expect(html).toContain('href="/dashboard/plan"');
  const guest = render({ people, failure, ownsPlan: false });
  expect(guest).toContain("ask the owner to change plan");
  expect(guest).not.toContain('href="/dashboard/plan"');
});

test("team projects show the team's access instead of an owner, and no editor bar", () => {
  const people = makeProjectPeople();
  people.organization = {
    personal: false,
    name: "Fieldwork",
    default_project_role: "editor",
  };
  people.editors = null;
  const html = render({ people });
  expect(html).toContain("Everyone in Fieldwork");
  expect(html).not.toContain("Owner · Admin");
  expect(html).not.toContain("Editors on this project");
});
