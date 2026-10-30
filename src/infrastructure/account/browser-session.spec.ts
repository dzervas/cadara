import { expect, test } from "vitest";
import { createBrowserSession } from "./browser-session";
import { makeAccount } from "../../../test/helpers/account-fixtures";

function fakeAccountApi() {
  let signedIn = false;
  let invalidMe = false;
  let rejectLink = false;
  const requests: Request[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const path = new URL(request.url).pathname;
    if (path === "/api/auth/sign-in/magic-link") {
      return Response.json(
        rejectLink
          ? { message: "Link request rejected", code: "REJECTED" }
          : { status: true },
        { status: rejectLink ? 400 : 200 },
      );
    }
    if (path === "/api/auth/sign-out") {
      signedIn = false;
      return Response.json({ success: true });
    }
    if (path === "/api/auth/get-session")
      return Response.json(
        signedIn
          ? {
              user: {
                ...makeAccount().user,
                emailVerified: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              session: {
                id: "session",
                userId: "user",
                token: "opaque",
                expiresAt: new Date(Date.now() + 60000).toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }
          : null,
      );
    if (path === "/me")
      return Response.json(invalidMe ? { surprise: true } : makeAccount().me);
    if (path === "/orgs") return Response.json(makeAccount().organizations);
    throw new Error(`Unexpected request ${path}`);
  };
  return {
    requests,
    fetcher,
    completeLink() {
      signedIn = true;
    },
    invalidateMe() {
      invalidMe = true;
    },
    rejectLink() {
      rejectLink = true;
    },
  };
}

test("magic link request is JSON with API credentials; completion hydrates identity and sign-out clears it", async () => {
  const api = fakeAccountApi();
  const port = createBrowserSession({
    apiOrigin: "http://localhost:8787",
    callbackURL: "http://localhost:3000/app",
    fetcher: api.fetcher,
  });
  expect(await port.getAccount()).toBeNull();
  await port.requestMagicLink("maker@example.test");
  const request = api.requests.find((entry) =>
    entry.url.endsWith("/sign-in/magic-link"),
  )!;
  expect(request.method).toBe("POST");
  expect(request.headers.get("content-type")).toContain("application/json");
  expect(await request.json()).toMatchObject({
    email: "maker@example.test",
    callbackURL: "http://localhost:3000/app",
  });
  expect(await port.getAccount()).toBeNull();
  api.completeLink();
  expect(await port.getAccount()).toEqual(makeAccount());
  expect(api.requests.every((entry) => entry.credentials === "include")).toBe(
    true,
  );
  await port.signOut();
  expect(await port.getAccount()).toBeNull();
});

test("invalid account payloads and rejected links propagate to the caller", async () => {
  const api = fakeAccountApi();
  const port = createBrowserSession({
    apiOrigin: "http://localhost:8787",
    callbackURL: "http://localhost:3000/app",
    fetcher: api.fetcher,
  });
  api.completeLink();
  api.invalidateMe();
  await expect(port.getAccount()).rejects.toThrow();
  api.rejectLink();
  await expect(port.requestMagicLink("maker@example.test")).rejects.toThrow(
    "Link request rejected",
  );
});
