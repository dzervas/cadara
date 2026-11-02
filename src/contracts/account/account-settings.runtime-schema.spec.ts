// Logic lane (contracts): account settings response validation.
import { expect, test } from "vitest";
import { parseApiKeys } from "./account-settings.runtime-schema";

test("API key listings never accept fields the client does not know, such as a secret", () => {
  const key = {
    id: "key",
    name: "CI",
    prefix: "cad_",
    metadata: { organizationId: "org", scopes: ["project:read"] },
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
  };
  expect(parseApiKeys([key])).toEqual([key]);
  expect(() => parseApiKeys([{ ...key, key: "cad_secret" }])).toThrow();
  expect(() =>
    parseApiKeys([{ ...key, metadata: { ...key.metadata, scopes: ["root"] } }]),
  ).toThrow();
});
