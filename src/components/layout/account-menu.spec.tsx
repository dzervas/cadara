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

test("signed-in account displays profile and membership with registration and sign-out", () => {
  const html = render({ account: makeAccount() });
  for (const label of [
    "Maker",
    "maker@example.test",
    "Personal",
    "owner",
    "Register passkey",
    "Sign out",
  ])
    expect(html).toContain(label);
  expect(html).not.toContain("Continue with Google");
});

test("unreachable account API is distinguished from a known signed-out session", () => {
  expect(render({ offline: true })).toContain(
    "Account offline · unable to check your session.",
  );
});
