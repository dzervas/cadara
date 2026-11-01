// Logic lane: the landing page's session probe answers quickly or gives up.
import { expect, test } from "vitest";
import { hasAccountSession } from "./account-session-presence";

const origin = "https://api.example.test";

test("a stored session, no session and a failed response are told apart from the session alone", async () => {
  const requested: string[] = [];
  const answer =
    (body: unknown, status = 200): typeof fetch =>
    async (input) => {
      requested.push(String(input));
      return new Response(JSON.stringify(body), { status });
    };
  await expect(
    hasAccountSession(origin, {
      fetcher: answer({ session: { id: "s" }, user: { id: "u" } }),
    }),
  ).resolves.toBe(true);
  await expect(
    hasAccountSession(origin, { fetcher: answer(null) }),
  ).resolves.toBe(false);
  await expect(
    hasAccountSession(origin, { fetcher: answer({ error: "x" }, 500) }),
  ).resolves.toBe(false);
  expect(new Set(requested)).toEqual(
    new Set([`${origin}/api/auth/get-session`]),
  );
});

test("an account service that never answers is abandoned after the timeout", async () => {
  const hanging: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal!.reason),
      ),
    );
  await expect(
    hasAccountSession(origin, { timeoutMs: 20, fetcher: hanging }),
  ).rejects.toThrow();
});
