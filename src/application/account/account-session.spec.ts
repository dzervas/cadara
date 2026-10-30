import { expect, test } from "vitest";
import { createMemorySession } from "./memory-session";
import {
  hydrateAccountSession,
  signInAccountWithPasskey,
  type AccountSessionState,
} from "./account-session";
import type { SessionPort } from "./session-port";
import { makeAccount } from "../../../test/helpers/account-fixtures";

test("passkey hydration replaces an offline probe state with the current online account", async () => {
  const memory = createMemorySession();
  let unavailable = true;
  const port: SessionPort = {
    ...memory.port,
    async getAccount() {
      if (unavailable) throw new Error("API unavailable");
      return memory.port.getAccount();
    },
    async signInPasskey() {
      unavailable = false;
      memory.completeSignIn(makeAccount());
    },
  };
  let state: AccountSessionState = { account: null, offline: false };
  await hydrateAccountSession(port).catch(() => {
    state = { ...state, offline: true };
  });
  expect(state.offline).toBe(true);
  state = await signInAccountWithPasskey(port);
  expect(state).toEqual({ account: makeAccount(), offline: false });
});

test("hydration failures propagate instead of publishing an online account", async () => {
  const memory = createMemorySession();
  await expect(
    hydrateAccountSession({
      ...memory.port,
      async getAccount() {
        throw new Error("API unavailable");
      },
    }),
  ).rejects.toThrow("API unavailable");
});
