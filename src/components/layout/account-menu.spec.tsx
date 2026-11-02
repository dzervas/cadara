import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { AccountPanel, type AccountPanelProps } from "./account-menu";
import { workbenchTheme } from "@/theme/workbench-theme";
import { makeAccount } from "../../../test/helpers/account-fixtures";

function render(overrides: Partial<AccountPanelProps> = {}) {
  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <AccountPanel
        account={null}
        offline={false}
        errorMessage={null}
        pendingEmail={null}
        busy={false}
        passkeyRegistered={false}
        onMagicLink={() => undefined}
        onSocial={() => undefined}
        onPasskey={() => undefined}
        onRegisterPasskey={() => undefined}
        onSignOut={() => undefined}
        {...overrides}
      />
    </MantineProvider>,
  );
}

test("signed-out account exposes all sign-in methods without gating local projects", () => {
  const html = render();
  for (const label of [
    "Email",
    "Email sign-in link",
    "Continue with Google",
    "Continue with GitHub",
    "Sign in with passkey",
    "Your local projects work without an account.",
  ])
    expect(html).toContain(label);
  expect(html).not.toContain("Sign out");
});

test("pending link tells the user which inbox to check", () => {
  expect(render({ pendingEmail: "maker@example.test" })).toContain(
    "Check your inbox at maker@example.test",
  );
});

test("signed-in account displays profile with registration and sign-out", () => {
  const html = render({ account: makeAccount() });
  for (const label of [
    "Maker",
    "maker@example.test",
    "Register passkey",
    "Sign out",
  ])
    expect(html).toContain(label);
  expect(html).not.toContain("Continue with Google");
});

test("an account without a team never reads of teams or organizations, save the offer to create one", () => {
  const account = makeAccount();
  // Collaborator access to another account's team projects is not a team.
  account.organizations.push({
    id: "studio",
    name: "Studio",
    personal: false,
  });
  account.me.actor.memberships.push({
    ...account.me.actor.memberships[0]!,
    id: "collaborator",
    organizationId: "studio",
    role: "collaborator",
    defaultProjectRole: null,
  });
  const text = (html: string) => html.replace(/<[^>]*>/g, " ");
  const withOffer = text(
    render({ account, onCreateTeam: () => undefined }),
  ).replace("Create team", "");
  expect(withOffer).not.toMatch(/organi[sz]ation|team/i);
  expect(withOffer).not.toContain("Personal");
  expect(text(render({ account }))).not.toContain("Create team");
});

test("a team member sees their teams and roles", () => {
  const account = makeAccount();
  account.organizations.push({
    id: "team",
    name: "Workshop crew",
    personal: false,
  });
  account.me.actor.memberships.push({
    ...account.me.actor.memberships[0]!,
    id: "team-membership",
    organizationId: "team",
    role: "admin",
  });
  const html = render({ account, onCreateTeam: () => undefined });
  expect(html).toContain("Teams");
  expect(html).toMatch(
    /href="\/dashboard\/members"[^>]*>Workshop crew · admin/,
  );
  expect(html).toContain("Create team");
});

test("quota explains usage and preserves sync when over the limit", () => {
  const account = makeAccount();
  account.me.organizations[0]!.usage.storage_bytes = 2048;
  const html = render({ account });
  expect(html).toContain("2 KB of 1 KB");
  expect(html).toContain("0 of 3 private projects");
  expect(html).toContain("Sync keeps working.");
  expect(html).toContain('href="/dashboard/plan"');
  expect(html).toContain('target="_blank"');
});

test("unreachable account API is distinguished from a known signed-out session", () => {
  expect(render({ offline: true })).toContain(
    "Account offline · unable to check your session.",
  );
});

test("account failures remain visible inline", () => {
  const html = render({ errorMessage: "Unable to send the sign-in link." });
  expect(html).toContain('role="alert"');
  expect(html).toContain("Unable to send the sign-in link.");
});
