import typia from "typia";
import type { HostedBillingPage } from "./account-billing";
import { requireContract } from "@/contracts/shared/validation";

// Hosted pages carry provider fields this client does not own, so they
// validate only the fields it reads.
const validateHostedBillingPage = typia.createValidate<HostedBillingPage>();

/** Only https pages (or http on localhost for local acceptance) are followed. */
export function parseHostedBillingPage(input: unknown): HostedBillingPage {
  const page = requireContract(
    validateHostedBillingPage,
    input,
    "Hosted billing page",
  );
  const url = URL.parse(page.url);
  if (
    !url ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname === "localhost")
    )
  )
    throw new Error("The billing service returned an invalid page address.");
  return { url: url.href };
}
