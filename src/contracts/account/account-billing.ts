/** Paid tiers a free workspace can buy through hosted checkout. */
export type CheckoutTier = "individual" | "team";

/**
 * A hosted billing page (checkout or customer portal). Providers add their own
 * fields (expiry, redirect hints); the client only follows `url`.
 */
export interface HostedBillingPage {
  url: string;
}
