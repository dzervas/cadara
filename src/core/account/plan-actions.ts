import type { AccountMe } from "@/contracts/account/account";

export type PlanTier =
  AccountMe["organizations"][number]["entitlements"]["tier"];

export interface PlanWorkspace {
  tier: PlanTier;
  /** Personal workspaces cannot have members, so they never buy Team. */
  personal: boolean;
  /** Owners and admins change the plan; other members only see it. */
  canManageBilling: boolean;
}

export type PlanCardAction =
  | { kind: "current" }
  | { kind: "checkout"; tier: Exclude<PlanTier, "free"> }
  | { kind: "create-team" }
  | { kind: "none" };

/**
 * Checkout only upgrades a free workspace (a paid one changes its plan in the
 * hosted portal): Pro for a personal workspace, Team for a team.
 */
export function planCardAction(
  workspace: PlanWorkspace,
  card: PlanTier,
): PlanCardAction {
  if (card === workspace.tier) return { kind: "current" };
  if (workspace.tier !== "free" || !workspace.canManageBilling)
    return { kind: "none" };
  if (workspace.personal) {
    if (card === "individual") return { kind: "checkout", tier: card };
    if (card === "team") return { kind: "create-team" };
    return { kind: "none" };
  }
  return card === "team" ? { kind: "checkout", tier: card } : { kind: "none" };
}

/** The hosted portal manages an existing subscription. */
export function canOpenBillingPortal(workspace: PlanWorkspace): boolean {
  return workspace.tier !== "free" && workspace.canManageBilling;
}
