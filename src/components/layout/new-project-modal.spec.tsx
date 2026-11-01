// Lane: ui. Seam: NewProjectForm's static rendering of the location cards
// (availability rules live in project-location-options.spec.ts; clicks are
// proven in e2e/cadara-vxju.2-projects.spec.ts).
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import type { ComponentProps } from "react";
import { workbenchTheme } from "@/theme/workbench-theme";
import type { Account } from "@/contracts/account/account";
import { makeAccount } from "../../../test/helpers/account-fixtures";
import { NewProjectForm } from "./new-project-modal";

function render(props: Partial<ComponentProps<typeof NewProjectForm>>) {
  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <NewProjectForm
        account={null}
        offline={false}
        lastChoice={null}
        busy={false}
        error={null}
        onSignIn={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
        {...props}
      />
    </MantineProvider>,
  );
}

function checkedLocation(html: string) {
  return html.match(/<input[^>]*checked=""[^>]*value="(\w+)"/)?.[1];
}

test("a guest sees Local preselected and a sign-in action on the disabled account cards", () => {
  const html = render({});
  expect(checkedLocation(html)).toBe("local");
  expect(html).toContain("On this device, no limits");
  expect(html.match(/Sign in to create an account project\./g)).toHaveLength(2);
  expect(html.match(/>Sign in<\/span>/g)).toHaveLength(2);
  expect(html).not.toContain("Change plan");
});

test("a signed-in user at the private limit sees the reason and a Change plan link, with Private not preselected", () => {
  const account: Account = makeAccount();
  account.me.organizations[0]!.usage = {
    storage_bytes: 0,
    private_projects: 3,
  };
  const html = render({
    account,
    lastChoice: { location: "private", ownerId: "personal" },
  });
  expect(html).toContain("Private project limit reached.");
  expect(html).toMatch(/href="\/dashboard\/plan"[^>]*>Change plan/);
  expect(html).toContain("0 B of 1 KB · 3 of 3 private projects");
  expect(checkedLocation(html)).toBe("local");
});

test("team members pick the owner of a new project", () => {
  const account = makeAccount();
  account.organizations.push({ id: "team", name: "Workshop team" });
  account.me.actor.memberships.push({
    ...account.me.actor.memberships[0]!,
    id: "team-membership",
    organizationId: "team",
    role: "member",
  });
  const html = render({ account });
  expect(html).toContain("Owner");
  expect(html).toContain("Personal");
  expect(checkedLocation(html)).toBe("private");
});
