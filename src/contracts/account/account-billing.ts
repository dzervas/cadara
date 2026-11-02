/** Paid tiers a free workspace can buy through hosted checkout. */
export type CheckoutTier = "individual" | "team";

/**
 * A hosted billing page (checkout or customer portal). Providers add their own
 * fields (expiry, redirect hints); the client only follows `url`.
 */
export interface HostedBillingPage {
  url: string;
}

/** The part of GET /orgs/:orgId the plan page reads. */
export interface WorkspaceKind {
  id: string;
  personal: boolean;
}
