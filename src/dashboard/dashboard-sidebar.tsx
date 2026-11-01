import { Link } from "wouter";
import {
  Button,
  Menu,
  Progress,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import type { MouseEvent } from "react";
import { AccountMenu } from "@/components/layout/account-menu";
import {
  WorkbenchIcon,
  type WorkbenchIconName,
} from "@/components/ui/workbench-icon";
import type { AccountMe } from "@/contracts/account/account";
import { summarizeQuota } from "@/core/account/quota-summary";
import type { useAccountSession } from "@/hooks/use-account-session";

type OwnerOrganization = AccountMe["organizations"][number];

const planLabels: Record<OwnerOrganization["entitlements"]["tier"], string> = {
  free: "Free plan",
  individual: "Individual plan",
  team: "Team plan",
};

export interface DashboardSidebarProps {
  location: string;
  session: ReturnType<typeof useAccountSession>;
  accountMenuOpened: boolean;
  onAccountMenuOpenedChange: (opened: boolean) => void;
  /** Organizations the account owns or belongs to (not collaborator-only ones). */
  owners: OwnerOrganization[];
  selected: OwnerOrganization | undefined;
  organizationName: (organizationId: string) => string;
  onSelectOrganization: (organizationId: string) => void;
  onSignIn: () => void;
}

export function DashboardSidebar({
  location,
  session,
  accountMenuOpened,
  onAccountMenuOpenedChange,
  owners,
  selected,
  organizationName,
  onSelectOrganization,
  onSignIn,
}: DashboardSidebarProps) {
  const account = session.account;
  const selectedName = selected
    ? organizationName(selected.organizationId)
    : "On this device";
  const canSwitch = owners.length > 1;
  const organizationCard = (
    <OrganizationCard
      name={selectedName}
      plan={
        selected ? planLabels[selected.entitlements.tier] : "Local projects"
      }
      switchable={canSwitch}
    />
  );
  const quota = selected && summarizeQuota(selected);
  const navItems: { href: string; label: string; icon: WorkbenchIconName }[] = [
    { href: "/dashboard", label: "Projects", icon: "box" },
    ...(selected?.entitlements.tier === "team"
      ? [
          {
            href: "/dashboard/members",
            label: "Members",
            icon: "account" as const,
          },
        ]
      : []),
    { href: "/dashboard/plan", label: "Usage & plan", icon: "layers" },
    { href: "/dashboard/settings", label: "Settings", icon: "slider" },
  ];
  return (
    <aside className="dashboard-sidebar">
      <div className="px-3 pt-3 pb-2">
        {canSwitch ? (
          <Menu position="bottom-start" width={232}>
            <Menu.Target>
              <UnstyledButton
                className="dashboard-organization w-full"
                aria-label={`Switch organization (${selectedName})`}
              >
                {organizationCard}
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              {owners.map((org) => (
                <Menu.Item
                  key={org.organizationId}
                  onClick={() => onSelectOrganization(org.organizationId)}
                  rightSection={
                    org.organizationId === selected?.organizationId ? (
                      <WorkbenchIcon name="check" size={13} />
                    ) : null
                  }
                >
                  {organizationName(org.organizationId)}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        ) : (
          <div className="dashboard-organization">{organizationCard}</div>
        )}
      </div>
      <nav aria-label="Dashboard">
        <Stack gap={2} px="sm" pt="xs">
          {navItems.map((item) => (
            <Button
              key={item.href}
              component={Link}
              href={item.href}
              variant={location === item.href ? "light" : "subtle"}
              color="gray"
              justify="flex-start"
              leftSection={<WorkbenchIcon name={item.icon} size={16} />}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                if (!account && item.href !== "/dashboard") {
                  event.preventDefault();
                  onSignIn();
                }
              }}
            >
              {item.label}
            </Button>
          ))}
        </Stack>
      </nav>
      {quota && selected && (
        <Stack gap="md" px="lg" pb="lg" mt="auto">
          <UsageBar
            label="Storage"
            value={quota.storageLabel}
            percent={quota.storagePercent}
            ariaLabel={`${selectedName} storage usage`}
          />
          <UsageBar
            label={quota.privateProjectsLabel}
            percent={
              selected.entitlements.private_project_limit === null
                ? 0
                : Math.min(
                    100,
                    (selected.usage.private_projects /
                      Math.max(
                        1,
                        selected.entitlements.private_project_limit,
                      )) *
                      100,
                  )
            }
            ariaLabel={`${selectedName} private projects usage`}
          />
        </Stack>
      )}
      <div className={`dashboard-account ${quota ? "" : "mt-auto"}`}>
        <AccountMenu
          {...session}
          opened={accountMenuOpened}
          onOpenedChange={onAccountMenuOpenedChange}
        />
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="sm" truncate>
            {account?.user.name || "Account"}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {account?.user.email ?? "Sign in to CADara"}
          </Text>
        </Stack>
      </div>
    </aside>
  );
}

function OrganizationCard({
  name,
  plan,
  switchable,
}: {
  name: string;
  plan: string;
  switchable: boolean;
}) {
  return (
    <span className="flex items-center gap-3">
      <span className="dashboard-organization-avatar" aria-hidden="true">
        {name.trim().charAt(0).toLocaleUpperCase() || "C"}
      </span>
      <span className="min-w-0 flex-1">
        <Text size="sm" fw={600} truncate>
          {name}
        </Text>
        <Text size="xs" c="dimmed" truncate>
          {plan}
        </Text>
      </span>
      {switchable && <WorkbenchIcon name="chevronDown" size={13} />}
    </span>
  );
}

function UsageBar({
  label,
  value,
  percent,
  ariaLabel,
}: {
  label: string;
  value?: string;
  percent: number;
  ariaLabel: string;
}) {
  return (
    <Stack gap={6}>
      <div className="flex items-baseline justify-between gap-2">
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        {value && (
          <Text size="xs" ff="monospace" ta="right">
            {value}
          </Text>
        )}
      </div>
      <Progress
        size={4}
        radius="xl"
        color="workbench.2"
        aria-label={ariaLabel}
        value={percent}
      />
    </Stack>
  );
}
