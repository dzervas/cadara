import type { AccountMe } from "@/contracts/account/account";

export type AccountQuota = AccountMe["organizations"][number];
export type QuotaSeverity = "normal" | "warning" | "over";

/** Null limits are unlimited; reaching a limit blocks creation, exceeding it warns in red. */
export function summarizeQuota({ entitlements, usage }: AccountQuota) {
  const storageRatio =
    entitlements.storage_limit_bytes === 0
      ? usage.storage_bytes > 0
        ? Infinity
        : 0
      : usage.storage_bytes / entitlements.storage_limit_bytes;
  const privateProjectRatio =
    entitlements.private_project_limit === null
      ? 0
      : entitlements.private_project_limit === 0
        ? usage.private_projects > 0
          ? Infinity
          : 0
        : usage.private_projects / entitlements.private_project_limit;
  const highestRatio = Math.max(storageRatio, privateProjectRatio);
  const severity: QuotaSeverity =
    highestRatio > 1 ? "over" : highestRatio > 0.8 ? "warning" : "normal";
  return {
    severity,
    storagePercent: Math.min(100, storageRatio * 100),
    storageAtLimit: usage.storage_bytes >= entitlements.storage_limit_bytes,
    privateProjectsAtLimit:
      entitlements.private_project_limit !== null &&
      usage.private_projects >= entitlements.private_project_limit,
    storageLabel: `${formatStorageBytes(usage.storage_bytes)} of ${formatStorageBytes(entitlements.storage_limit_bytes)}`,
    privateProjectsLabel:
      entitlements.private_project_limit === null
        ? `${usage.private_projects} private projects · unlimited`
        : `${usage.private_projects} of ${entitlements.private_project_limit} private projects`,
  };
}

function formatStorageBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log10(bytes) / 3), units.length);
  return `${Number((bytes / 1000 ** exponent).toFixed(1))} ${units[exponent - 1]}`;
}
