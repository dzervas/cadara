import { expect, test } from "vitest";
import {
  SYNC_RECONNECT_MAX_DELAY_MS,
  syncReconnectDelayMs,
  syncTokenRefreshDelayMs,
} from "./sync-connection-schedule";

test("a ten-minute token is renewed one minute before the room would close the socket", () => {
  expect(syncTokenRefreshDelayMs(600)).toBe(9 * 60_000);
});

test("short tokens are renewed halfway so a renewal never starts after expiry", () => {
  expect(syncTokenRefreshDelayMs(60)).toBe(30_000);
  expect(syncTokenRefreshDelayMs(90)).toBe(45_000);
});

test("reconnects back off exponentially and stay bounded", () => {
  expect(syncReconnectDelayMs(0)).toBe(0);
  expect([1, 2, 3, 4].map(syncReconnectDelayMs)).toEqual([
    1_000, 2_000, 4_000, 8_000,
  ]);
  expect(syncReconnectDelayMs(20)).toBe(SYNC_RECONNECT_MAX_DELAY_MS);
});
