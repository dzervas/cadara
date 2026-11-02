import { Progress, Stack, Text } from "@mantine/core";
import type { AccountQuota } from "@/core/account/quota-summary";
import { summarizeQuota } from "@/core/account/quota-summary";

/**
 * A workspace's storage and private-project bars, as the dashboard sidebar
 * shows them; the Usage & plan page repeats the same bars.
 */
export function WorkspaceUsageBars({
  workspace,
  workspaceName,
}: {
  workspace: AccountQuota;
  workspaceName: string;
}) {
  const quota = summarizeQuota(workspace);
  const limit = workspace.entitlements.private_project_limit;
  return (
    <Stack gap="md">
      <UsageBar
        label="Storage"
        value={quota.storageLabel}
        percent={quota.storagePercent}
        ariaLabel={`${workspaceName} storage usage`}
      />
      <UsageBar
        label={quota.privateProjectsLabel}
        percent={
          limit === null
            ? 0
            : Math.min(
                100,
                (workspace.usage.private_projects / Math.max(1, limit)) * 100,
              )
        }
        ariaLabel={`${workspaceName} private projects usage`}
      />
    </Stack>
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
