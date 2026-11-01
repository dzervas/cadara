import type { Account } from "@/contracts/account/account";
import { summarizeQuota } from "./quota-summary";

/** Where a new project lives: this browser, or the owner's account. */
export type ProjectLocation = "local" | "private" | "public";

/** A New project choice; `ownerId` is the account owner, empty for a guest. */
export interface NewProjectChoice {
  location: ProjectLocation;
  ownerId: string;
}

export interface ProjectLocationOption {
  value: ProjectLocation;
  label: string;
  detail: string;
  /** Null when the location can be chosen. */
  disabledReason: string | null;
  /** What resolves the reason: signing in, or a plan with higher limits. */
  action: "sign-in" | "plan" | null;
}

/** Organizations the user can create projects in; collaborators only join shared projects. */
export function projectOwners(account: Account | null) {
  if (!account) return [];
  return account.organizations.filter((org) =>
    account.me.actor.memberships.some(
      (membership) =>
        membership.organizationId === org.id &&
        membership.role !== "collaborator",
    ),
  );
}

/**
 * The New project cards. Local is always available (guests, offline, no
 * quota); account locations need a connection, a signed-in owner and room
 * in its plan: a public project counts against storage only.
 */
export function projectLocationOptions(
  account: Account | null,
  ownerId: string,
  offline: boolean,
): ProjectLocationOption[] {
  const usage = account?.me.organizations.find(
    (org) => org.organizationId === ownerId,
  );
  const quota = usage ? summarizeQuota(usage) : null;
  const accountOption = (
    value: "private" | "public",
  ): ProjectLocationOption => {
    const limitReason = !quota
      ? null
      : quota.storageAtLimit
        ? "Storage limit reached."
        : value === "private" && quota.privateProjectsAtLimit
          ? "Private project limit reached."
          : null;
    const disabledReason = offline
      ? "Offline. Connect to create an account project."
      : !account
        ? "Sign in to create an account project."
        : !quota
          ? "Your account cannot own projects. Ask a team admin."
          : limitReason;
    return {
      value,
      label: value === "private" ? "Private" : "Public",
      detail: !quota
        ? "Stored in your CADara account"
        : value === "private"
          ? `${quota.storageLabel} · ${quota.privateProjectsLabel}`
          : quota.storageLabel,
      disabledReason,
      action:
        offline || disabledReason === null
          ? null
          : !account
            ? "sign-in"
            : limitReason
              ? "plan"
              : null,
    };
  };
  return [
    {
      value: "local",
      label: "Local",
      detail: "On this device, no limits",
      disabledReason: null,
      action: null,
    },
    accountOption("private"),
    accountOption("public"),
  ];
}

/** The user's last choice when it is still available, else Private, else Local. */
export function preselectProjectLocation(
  options: readonly ProjectLocationOption[],
  lastChoice: ProjectLocation | null,
) {
  const available = (value: ProjectLocation) =>
    options.some(
      (option) => option.value === value && option.disabledReason === null,
    );
  if (lastChoice && available(lastChoice)) return lastChoice;
  if (available("private")) return "private";
  return "local";
}
