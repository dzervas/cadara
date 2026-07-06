import { test, expect } from "vitest";

import {
  OnshapeClient,
  OnshapeRequestError,
  type FetchLike,
} from "@/cli/commands/onshape-capture/client";

const NO_SLEEP = () => Promise.resolve();

test("client.spec.ts sends HTTP Basic auth but never leaks it into errors", async () => {
  let seenAuth = "";
  const fetch: FetchLike = (_url, init) => {
    seenAuth = init?.headers?.Authorization ?? "";
    return Promise.resolve({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden: token abc"),
    });
  };
  const client = new OnshapeClient({
    baseUrl: "https://cad.onshape.com/api/v10",
    accessKey: "ACCESSKEY",
    secretKey: "SECRETKEY",
    fetch,
    sleep: NO_SLEEP,
  });

  const error = await client.getJson("/documents/x").catch((e) => e);

  expect(error).toBeInstanceOf(OnshapeRequestError);
  expect(seenAuth.startsWith("Basic "), "Basic auth header should be set.").toBe(
    true,
  );
  const message = (error as OnshapeRequestError).message;
  expect(message).toContain("403");
  expect(message).toContain("/documents/x");
  expect(
    message.includes("ACCESSKEY") ||
      message.includes("SECRETKEY") ||
      message.includes(seenAuth),
    "Error output must not contain credential material.",
  ).toBe(false);
});

test("client.spec.ts retries 5xx within the retry budget then throws", async () => {
  let calls = 0;
  const fetch: FetchLike = () => {
    calls += 1;
    return Promise.resolve({
      ok: false,
      status: 503,
      text: () => Promise.resolve("unavailable"),
    });
  };
  const client = new OnshapeClient({
    baseUrl: "https://x",
    accessKey: "a",
    secretKey: "b",
    fetch,
    sleep: NO_SLEEP,
    maxRetries: 2,
  });

  await expect(client.getJson("/y")).rejects.toBeInstanceOf(OnshapeRequestError);
  expect(calls, "Initial attempt plus two retries.").toBe(3);
});

test("client.spec.ts caps concurrent in-flight requests", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch: FetchLike = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    return { ok: true, status: 200, text: () => Promise.resolve("{}") };
  };
  const client = new OnshapeClient({
    baseUrl: "https://x",
    accessKey: "a",
    secretKey: "b",
    fetch,
    sleep: NO_SLEEP,
    concurrency: 2,
  });

  await Promise.all(
    Array.from({ length: 8 }, (_v, index) => client.getJson(`/p/${index}`)),
  );

  expect(maxInFlight, "In-flight requests should never exceed concurrency.").toBeLessThanOrEqual(
    2,
  );
});
