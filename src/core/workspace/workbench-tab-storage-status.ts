import type { ProjectSyncConnection } from "@/contracts/project-sync/project-service";
import type { DocumentSyncWriteStatus } from "@/contracts/modeling/document-sync-write-status";

export interface WorkbenchTabStorageStatus {
  kind: "syncing" | "pending" | "error";
  reason: string;
}

export interface WorkbenchTabStorageBadge extends WorkbenchTabStorageStatus {
  /** The state whose fix the badge offers: the most severe one, the file on a tie. */
  fixes: "project" | "file";
}

const severity: Record<WorkbenchTabStorageStatus["kind"], number> = {
  syncing: 0,
  pending: 1,
  error: 2,
};

/** One badge per tab: the worst state's kind and fix, with every unhealthy reason named. */
export function tabStorageBadge(
  project: WorkbenchTabStorageStatus | null,
  file: WorkbenchTabStorageStatus | null,
): WorkbenchTabStorageBadge | null {
  if (!project && !file) return null;
  if (!project) return { ...file!, fixes: "file" };
  if (!file) return { ...project, fixes: "project" };
  const [worst, other, fixes] =
    severity[project.kind] > severity[file.kind]
      ? [project, file, "project" as const]
      : [file, project, "file" as const];
  return {
    kind: worst.kind,
    reason: `${worst.reason} · ${other.reason}`,
    fixes,
  };
}

export function projectTabStorageStatus(
  linked: boolean,
  /** Null while the account has not been checked yet. */
  signedIn: boolean | null,
  status: { connection: ProjectSyncConnection; error: string | null } | null,
  upload: { busy: boolean; error: string | null },
): WorkbenchTabStorageStatus | null {
  if (!linked && upload.error) return { kind: "error", reason: upload.error };
  if (upload.busy)
    return { kind: "syncing", reason: "Uploading project to CADara." };
  if (!linked || signedIn === null) return null;
  // No account (signed out, or the service was unreachable when checked):
  // sync never starts, so there is no live status to report.
  if (!signedIn)
    return {
      kind: "pending",
      reason:
        "Not connected to CADara: sign in or check your connection. Changes are saved locally.",
    };
  if (status?.error) return { kind: "error", reason: status.error };
  switch (status?.connection) {
    case "synced":
      return null;
    case "syncing":
      return { kind: "syncing", reason: "Syncing project changes." };
    case "offline":
      return {
        kind: "pending",
        reason:
          "Project is offline; changes are saved locally until it reconnects.",
      };
    default:
      return { kind: "syncing", reason: "Connecting to CADara." };
  }
}

export function fileTabStorageStatus(
  status: DocumentSyncWriteStatus,
): WorkbenchTabStorageStatus | null {
  switch (status.kind) {
    case "syncing":
      return { kind: "syncing", reason: `Saving ${status.metadata.fileName}.` };
    case "permission-required":
      return {
        kind: "error",
        reason: `Restore write access to ${status.metadata.fileName}.`,
      };
    case "permission-denied":
    case "failed":
      return { kind: "error", reason: status.message };
    case "persistent-binding-unavailable":
      return { kind: "pending", reason: status.message };
    default:
      return null;
  }
}

/**
 * Where the tab's stored file handle stands: still being read, gone, held
 * without a way to ask for permission, or restorable in place.
 */
export type TabFileBinding = "loading" | "gone" | "held" | "restorable";

export interface TabFileFix {
  action: "loading" | "retry-write" | "restore-access" | "relink";
  /** Offered beside the main fix once the user denied access. */
  secondary?: "relink";
}

/**
 * The fix a file error offers. Re-linking opens the save picker, which can
 * overwrite the wrong file, so it is the main fix only when the existing
 * handle cannot be used.
 */
export function tabFileFix(
  state: DocumentSyncWriteStatus["kind"] | undefined,
  binding: TabFileBinding,
  denied: boolean,
): TabFileFix {
  if (binding === "loading") return { action: "loading" };
  if (state === "failed" && binding !== "gone")
    return { action: "retry-write" };
  if (binding === "restorable")
    return denied
      ? { action: "restore-access", secondary: "relink" }
      : { action: "restore-access" };
  return { action: "relink" };
}
