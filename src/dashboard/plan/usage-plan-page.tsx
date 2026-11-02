import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { Account, AccountMe } from "@/contracts/account/account";
import {
  canOpenBillingPortal,
  planCardAction,
  type PlanCardAction,
  type PlanTier,
  type PlanWorkspace,
} from "@/core/account/plan-actions";
import { WorkbenchIcon } from "@/components/ui/workbench-icon";
import { getAccountApiOrigin } from "@/infrastructure/account/api-origin";
import { createBillingClient } from "@/infrastructure/account/billing";
import { WorkspaceUsageBars } from "../dashboard-usage-bars";
import { planOffers, planTiers } from "./plan-offers";

type OwnerOrganization = AccountMe["organizations"][number];

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Follows hosted checkout/portal pages for the workspace. */
export function UsagePlanPage({
  account,
  workspace,
  workspaceName,
  onCreateTeam,
}: {
  account: Account;
  workspace: OwnerOrganization;
  workspaceName: string;
  onCreateTeam: () => void;
}) {
  const billing = useMemo(
    () => createBillingClient({ apiOrigin: getAccountApiOrigin() }),
    [],
  );
  const organizationId = workspace.organizationId;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"portal" | PlanTier | null>(null);
  const personal =
    account.organizations.find((org) => org.id === organizationId)?.personal ??
    null;
  const role = account.me.actor.memberships.find(
    (membership) => membership.organizationId === organizationId,
  )?.role;
  const planWorkspace =
    personal !== null
      ? {
          tier: workspace.entitlements.tier,
          personal,
          canManageBilling: role === "owner" || role === "admin",
        }
      : null;
  // Coming back from a hosted page through history restores this page as it
  // was left, busy button included.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(null);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  // Hosted billing replaces this page; the button stays busy until it does.
  const follow = (action: "portal" | PlanTier, page: () => Promise<string>) => {
    setPending(action);
    setError(null);
    page()
      .then((url) => window.location.assign(url))
      .catch((reason: unknown) => {
        setPending(null);
        setError(errorMessage(reason));
      });
  };
  return (
    <UsagePlanView
      workspace={workspace}
      workspaceName={workspaceName}
      planWorkspace={planWorkspace}
      pending={pending}
      error={error}
      onDismissError={() => setError(null)}
      onCheckout={(tier) =>
        follow(tier, () => billing.startCheckout(organizationId, tier))
      }
      onManageBilling={() =>
        follow("portal", () => billing.openPortal(organizationId))
      }
      onCreateTeam={onCreateTeam}
    />
  );
}

export function UsagePlanView({
  workspace,
  workspaceName,
  planWorkspace,
  pending,
  error,
  onDismissError,
  onCheckout,
  onManageBilling,
  onCreateTeam,
}: {
  workspace: OwnerOrganization;
  workspaceName: string;
  /** Null while the workspace kind is unknown: cards show, actions wait. */
  planWorkspace: PlanWorkspace | null;
  pending: "portal" | PlanTier | null;
  error: string | null;
  onDismissError: () => void;
  onCheckout: (tier: Exclude<PlanTier, "free">) => void;
  onManageBilling: () => void;
  onCreateTeam: () => void;
}) {
  const current = planOffers[workspace.entitlements.tier];
  return (
    <Stack gap="xl" maw={880}>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={1} size={20}>
            Usage & plan
          </Title>
          <Text size="sm" c="dimmed">
            {workspaceName} · {current.label} plan
          </Text>
        </div>
        {planWorkspace && canOpenBillingPortal(planWorkspace) && (
          <Button
            variant="default"
            loading={pending === "portal"}
            disabled={pending !== null && pending !== "portal"}
            onClick={onManageBilling}
          >
            Manage billing
          </Button>
        )}
      </Group>
      {error && (
        <Alert
          color="red"
          role="alert"
          withCloseButton
          onClose={onDismissError}
        >
          {error}
        </Alert>
      )}
      <section aria-label="Usage">
        <Title order={2} size={13} mb="sm">
          Usage
        </Title>
        <Paper withBorder radius="md" p="lg" maw={480} bg="transparent">
          <WorkspaceUsageBars
            workspace={workspace}
            workspaceName={workspaceName}
          />
        </Paper>
      </section>
      <section aria-label="Plans">
        <Title order={2} size={13} mb="sm">
          Plans
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          {planTiers.map((tier) => (
            <PlanCard
              key={tier}
              tier={tier}
              action={planWorkspace && planCardAction(planWorkspace, tier)}
              pending={pending}
              onCheckout={onCheckout}
              onCreateTeam={onCreateTeam}
            />
          ))}
        </SimpleGrid>
        {planWorkspace &&
          !planWorkspace.canManageBilling &&
          planWorkspace.tier === "free" && (
            <Text size="xs" c="dimmed" mt="sm">
              Only owners and admins can change this workspace's plan.
            </Text>
          )}
      </section>
    </Stack>
  );
}

function PlanCard({
  tier,
  action,
  pending,
  onCheckout,
  onCreateTeam,
}: {
  tier: PlanTier;
  action: PlanCardAction | null;
  pending: "portal" | PlanTier | null;
  onCheckout: (tier: Exclude<PlanTier, "free">) => void;
  onCreateTeam: () => void;
}) {
  const offer = planOffers[tier];
  const current = action?.kind === "current";
  return (
    <Paper
      component="article"
      aria-label={`${offer.label} plan`}
      withBorder
      radius="md"
      p="lg"
      bg="transparent"
      style={
        current
          ? { borderColor: "var(--mantine-color-workbench-4)" }
          : undefined
      }
    >
      <Stack gap="md" h="100%">
        <Group justify="space-between" align="center" gap="xs">
          <Title order={3} size={16}>
            {offer.label}
          </Title>
          {current && (
            <Badge variant="light" color="gray" size="sm">
              Current plan
            </Badge>
          )}
        </Group>
        {offer.billingNote && (
          <Text size="xs" c="dimmed" mt={-8}>
            {offer.billingNote}
          </Text>
        )}
        <Stack component="ul" gap={8} className="m-0 flex-1 list-none p-0">
          {offer.lines.map((line) => (
            <Group
              component="li"
              key={line}
              gap={8}
              wrap="nowrap"
              align="flex-start"
            >
              <Text component="span" c="dimmed" mt={2} lh={0}>
                <WorkbenchIcon name="check" size={12} />
              </Text>
              <Text component="span" size="sm" c="dimmed">
                {line}
              </Text>
            </Group>
          ))}
        </Stack>
        {action?.kind === "checkout" && (
          <Button
            color="workbench.0"
            autoContrast
            loading={pending === action.tier}
            disabled={pending !== null && pending !== action.tier}
            onClick={() => onCheckout(action.tier)}
          >
            Upgrade to {offer.label}
          </Button>
        )}
        {action?.kind === "create-team" && (
          <Stack gap={8}>
            <Text size="xs" c="dimmed">
              Teams have their own workspace.
            </Text>
            <Button
              variant="default"
              leftSection={<WorkbenchIcon name="plus" size={13} />}
              disabled={pending !== null}
              onClick={onCreateTeam}
            >
              Create team
            </Button>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
