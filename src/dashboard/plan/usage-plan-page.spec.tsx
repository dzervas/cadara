// UI lane: the Usage & plan view shows the plan actions its workspace allows.
import { expect, test } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { makeAccount } from "../../../test/helpers/account-fixtures";
import type { PlanWorkspace } from "@/core/account/plan-actions";
import { workbenchTheme } from "@/theme/workbench-theme";
import { planOffers } from "./plan-offers";
import { UsagePlanView } from "./usage-plan-page";

function render(planWorkspace: PlanWorkspace | null) {
  const workspace = makeAccount().me.organizations[0]!;
  if (planWorkspace) workspace.entitlements.tier = planWorkspace.tier;
  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <UsagePlanView
        workspace={workspace}
        workspaceName="Personal"
        planWorkspace={planWorkspace}
        pending={null}
        error={null}
        onDismissError={() => undefined}
        onCheckout={() => undefined}
        onManageBilling={() => undefined}
      />
    </MantineProvider>,
  );
}

const upgrade = (tier: "individual" | "team") =>
  `Upgrade to ${planOffers[tier].label}`;

test("a free personal workspace offers Pro checkout beside the usage bars, not the portal", () => {
  const markup = render({
    tier: "free",
    personal: true,
    canManageBilling: true,
  });
  expect(markup).toContain(upgrade("individual"));
  expect(markup).not.toContain(upgrade("team"));
  expect(markup).not.toContain("Manage billing");
  expect(markup).toContain('aria-label="Personal storage usage"');
  expect(markup).toContain('aria-label="Personal private projects usage"');
});

test("actions wait for the workspace kind, and a paid workspace manages billing in the portal", () => {
  const loading = render(null);
  expect(loading).not.toContain("Upgrade to");
  expect(loading).not.toContain("Manage billing");
  const paid = render({
    tier: "individual",
    personal: true,
    canManageBilling: true,
  });
  expect(paid).toContain("Manage billing");
  expect(paid).not.toContain("Upgrade to");
});
