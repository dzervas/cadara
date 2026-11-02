// Logic lane (adapter conformance): the billing client against a fake account API.
import { expect, test } from "vitest";
import { createBillingClient } from "./billing";

function fakeBillingApi(answer: (request: Request) => Response) {
  const requests: Request[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return answer(request);
  };
  return {
    requests,
    client: createBillingClient({ apiOrigin: "https://api.test", fetcher }),
  };
}

test("checkout and portal post to the workspace's billing routes and resolve to the hosted page", async () => {
  const { client, requests } = fakeBillingApi((request) =>
    Response.json(
      new URL(request.url).pathname.endsWith("/checkout")
        ? { id: "checkout", url: "https://pay.test/c/1", expiresAt: 1 }
        : { url: "https://pay.test/portal", redirect: false },
    ),
  );
  await expect(client.startCheckout("org/1", "individual")).resolves.toBe(
    "https://pay.test/c/1",
  );
  await expect(client.openPortal("org/1")).resolves.toBe(
    "https://pay.test/portal",
  );
  expect(
    await Promise.all(
      requests.map(async (request) => ({
        method: request.method,
        path: new URL(request.url).pathname,
        credentials: request.credentials,
        body: await request.text(),
      })),
    ),
  ).toEqual([
    {
      method: "POST",
      path: "/orgs/org%2F1/billing/checkout",
      credentials: "include",
      body: JSON.stringify({ tier: "individual" }),
    },
    {
      method: "POST",
      path: "/orgs/org%2F1/billing/portal",
      credentials: "include",
      body: "{}",
    },
  ]);
});

test("billing refusals surface the server's sentence and unsafe pages are never followed", async () => {
  const refused = fakeBillingApi(() =>
    Response.json(
      { error: "Manage the existing subscription in the portal" },
      { status: 409 },
    ),
  );
  await expect(refused.client.startCheckout("org", "team")).rejects.toThrow(
    "Manage the existing subscription in the portal",
  );
  const unconfigured = fakeBillingApi(() =>
    Response.json({ error: "Billing not configured" }, { status: 503 }),
  );
  await expect(unconfigured.client.openPortal("org")).rejects.toThrow(
    "Billing is unavailable right now.",
  );
  const unsafe = fakeBillingApi(() =>
    Response.json({ url: "javascript:alert(1)" }),
  );
  await expect(unsafe.client.openPortal("org")).rejects.toThrow(
    "invalid page address",
  );
});
