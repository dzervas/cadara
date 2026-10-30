import { expect, test } from "vitest";
import { createMemorySession } from "./memory-session";
import { makeAccount } from "../../../test/helpers/account-fixtures";

test("memory session stays signed out until link completion, then clears identity on sign-out", async () => {
  const session = createMemorySession();
  expect(await session.port.getAccount()).toBeNull();
  await session.port.requestMagicLink("maker@example.test");
  expect(session.magicLinkRequests).toEqual(["maker@example.test"]);
  expect(await session.port.getAccount()).toBeNull();
  session.completeSignIn(makeAccount());
  expect(await session.port.getAccount()).toEqual(makeAccount());
  await session.port.signOut();
  expect(await session.port.getAccount()).toBeNull();
});
