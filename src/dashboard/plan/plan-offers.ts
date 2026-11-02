import type { PlanTier } from "@/core/account/plan-actions";

export interface PlanOffer {
  label: string;
  /** How the plan bills; hosted checkout states the actual price. */
  billingNote?: string;
  /** What sets this plan apart from the others, most important first. */
  lines: string[];
}

/**
 * Plan names and comparison copy shown on the Usage & plan page. Prices are
 * deliberately absent: hosted checkout states them. Keep the lines in step
 * with the server's plan limits.
 */
export const planOffers: Record<PlanTier, PlanOffer> = {
  free: {
    label: "Free",
    lines: [
      "1 GB cloud storage",
      "3 private projects, unlimited public",
      "1 other editor per project",
      "Unlimited projects on this device",
    ],
  },
  individual: {
    label: "Pro",
    lines: [
      "10 GB cloud storage",
      "Unlimited private projects",
      "3 other editors per project",
      "Viewers and commenters are always free",
    ],
  },
  team: {
    label: "Team",
    billingNote: "Billed per editor seat",
    lines: [
      "100 GB shared storage",
      "Unlimited private projects and editors",
      "Members with roles and a default project role",
      "Team-owned projects, with control over sharing outside the team",
      "Service API keys for automation",
    ],
  },
};

export const planTiers: PlanTier[] = ["free", "individual", "team"];
