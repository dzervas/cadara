// Logic lane (contracts): billing response validation.
import { expect, test } from "vitest";
import { parseHostedBillingPage } from "./account-billing.runtime-schema";

test("hosted billing pages keep provider fields out and only follow web addresses", () => {
  expect(
    parseHostedBillingPage({ url: "https://pay.test/c", redirect: true }),
  ).toEqual({ url: "https://pay.test/c" });
  expect(parseHostedBillingPage({ url: "http://localhost:8810/p" })).toEqual({
    url: "http://localhost:8810/p",
  });
  for (const url of ["http://pay.test/c", "javascript:alert(1)", "not a url"])
    expect(() => parseHostedBillingPage({ url })).toThrow();
  expect(() => parseHostedBillingPage({})).toThrow();
});
