import type { CheckoutTier } from "@/contracts/account/account-billing";
import { parseHostedBillingPage } from "@/contracts/account/account-billing.runtime-schema";
import { accountApiError } from "./account-api-error";

export interface BillingClient {
  /** Starts hosted checkout for a free workspace; resolves to the page to open. */
  startCheckout(organizationId: string, tier: CheckoutTier): Promise<string>;
  /** Opens the hosted billing portal of the signed-in payer. */
  openPortal(organizationId: string): Promise<string>;
}

export function createBillingClient({
  apiOrigin,
  fetcher = fetch,
}: {
  apiOrigin: string;
  fetcher?: typeof fetch;
}): BillingClient {
  const billingPage = async (
    organizationId: string,
    path: string,
    body: object,
  ) => {
    const response = await fetcher(
      new URL(
        `/orgs/${encodeURIComponent(organizationId)}/billing/${path}`,
        apiOrigin,
      ),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok)
      throw await accountApiError(
        response,
        "Billing is unavailable right now.",
      );
    return parseHostedBillingPage(await response.json()).url;
  };
  return {
    startCheckout: (organizationId, tier) =>
      billingPage(organizationId, "checkout", { tier }),
    // The portal needs no options; the server keeps the provider's return URL.
    openPortal: (organizationId) => billingPage(organizationId, "portal", {}),
  };
}
