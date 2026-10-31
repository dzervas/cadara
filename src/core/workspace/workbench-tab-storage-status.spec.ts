import { expect, test } from "vitest";
import {
  fileTabStorageStatus,
  projectTabStorageStatus,
  tabFileFix,
  tabStorageBadge,
  type TabFileBinding,
} from "./workbench-tab-storage-status";
import type { DocumentSyncWriteStatus } from "@/contracts/modeling/document-sync-write-status";

const idleUpload = { busy: false, error: null };

test("healthy local and cloud projects are quiet; real connection and upload states explain unsettled work", () => {
  expect(projectTabStorageStatus(false, null, null, idleUpload)).toBeNull();
  expect(
    projectTabStorageStatus(
      true,
      true,
      { connection: "synced", error: null },
      idleUpload,
    ),
  ).toBeNull();
  expect(
    projectTabStorageStatus(
      true,
      true,
      { connection: "synced", error: null },
      { busy: false, error: "Old upload failure" },
    ),
  ).toBeNull();
  for (const connection of ["connecting", "syncing"] as const)
    expect(
      projectTabStorageStatus(
        true,
        true,
        { connection, error: null },
        idleUpload,
      )?.kind,
    ).toBe("syncing");
  expect(
    projectTabStorageStatus(
      true,
      true,
      { connection: "offline", error: null },
      idleUpload,
    )?.kind,
  ).toBe("pending");
  expect(
    projectTabStorageStatus(
      true,
      true,
      { connection: "synced", error: "Access revoked" },
      idleUpload,
    ),
  ).toEqual({ kind: "error", reason: "Access revoked" });
  expect(
    projectTabStorageStatus(false, null, null, { busy: true, error: null })
      ?.kind,
  ).toBe("syncing");
  expect(
    projectTabStorageStatus(false, null, null, {
      busy: false,
      error: "Upload failed",
    }),
  ).toEqual({ kind: "error", reason: "Upload failed" });
});

test("an account project is quiet until the account is checked, and names sign-in when there is no account", () => {
  expect(projectTabStorageStatus(true, null, null, idleUpload)).toBeNull();
  expect(projectTabStorageStatus(true, false, null, idleUpload)).toMatchObject({
    kind: "pending",
    reason: expect.stringContaining("sign in"),
  });
  expect(projectTabStorageStatus(true, true, null, idleUpload)?.kind).toBe(
    "syncing",
  );
});

test("file permission/write failures are actionable errors; saved files have no badge", () => {
  const base = {
    documentId: "doc_storage",
    sequence: 1,
    metadata: {
      documentId: "doc_storage",
      fileName: "Bracket.cadara",
      storedAt: "2026-10-31",
    },
  } as const;
  for (const kind of ["idle", "binding-restored", "synced"] as const)
    expect(fileTabStorageStatus({ ...base, kind })).toBeNull();
  expect(fileTabStorageStatus({ ...base, kind: "syncing" })?.kind).toBe(
    "syncing",
  );
  expect(
    fileTabStorageStatus({ ...base, kind: "permission-required" })?.kind,
  ).toBe("error");
  for (const kind of [
    "permission-denied",
    "failed",
    "persistent-binding-unavailable",
  ] as const) {
    const status: DocumentSyncWriteStatus = {
      ...base,
      kind,
      message: "File access needs attention",
    };
    expect(fileTabStorageStatus(status)).toEqual({
      kind: kind === "persistent-binding-unavailable" ? "pending" : "error",
      reason: "File access needs attention",
    });
  }
});

test("a file-linked account-project tab shows the worst of its file and project states and names both", () => {
  const fileError = { kind: "error", reason: "File access lost." } as const;
  const cloudSyncing = { kind: "syncing", reason: "Syncing." } as const;
  expect(tabStorageBadge(cloudSyncing, fileError)).toEqual({
    kind: "error",
    reason: "File access lost. · Syncing.",
    fixes: "file",
  });
  const cloudError = { kind: "error", reason: "Access revoked." } as const;
  expect(tabStorageBadge(cloudError, null)).toEqual({
    ...cloudError,
    fixes: "project",
  });
  const offline = { kind: "pending", reason: "Offline." } as const;
  const fileSaving = { kind: "syncing", reason: "Saving." } as const;
  expect(tabStorageBadge(offline, fileSaving)).toMatchObject({
    kind: "pending",
    fixes: "project",
  });
  expect(tabStorageBadge(null, null)).toBeNull();
});

test("the save picker (Re-link) is never the main fix while the existing handle can still ask for permission", () => {
  for (const state of [
    "permission-required",
    "permission-denied",
    "failed",
  ] as const)
    for (const denied of [false, true])
      expect(tabFileFix(state, "restorable", denied).action).not.toBe("relink");
  expect(tabFileFix("permission-required", "restorable", false)).toEqual({
    action: "restore-access",
  });
  expect(tabFileFix("permission-denied", "restorable", true)).toEqual({
    action: "restore-access",
    secondary: "relink",
  });
});

test("a failed write retries in place while a handle is held; a missing or unaskable handle is re-linked; nothing is offered while loading", () => {
  for (const binding of ["held", "restorable"] as const)
    expect(tabFileFix("failed", binding, false).action).toBe("retry-write");
  for (const state of ["failed", "permission-required"] as const)
    expect(tabFileFix(state, "gone", false).action).toBe("relink");
  expect(tabFileFix("permission-required", "held", false).action).toBe(
    "relink",
  );
  for (const state of ["failed", "permission-required"] as const)
    expect(tabFileFix(state, "loading" satisfies TabFileBinding, true)).toEqual(
      { action: "loading" },
    );
});
