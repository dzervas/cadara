import { expect, test } from "vitest";
import { makeAccount } from "../../../test/helpers/account-fixtures";
import { parseAccountMe } from "./account.runtime-schema";

test("/me validates memberships and nullable plan limits without losing entitlements", () => {
  const me = makeAccount().me;
  me.organizations[0]!.entitlements.private_project_limit = null;
  expect(parseAccountMe(me)).toEqual(me);
});

test.each([
  { ...makeAccount().me, extra: true },
  {
    ...makeAccount().me,
    actor: { ...makeAccount().me.actor, credential: { kind: "api-key" } },
  },
  {
    ...makeAccount().me,
    organizations: [
      { organizationId: "personal", entitlements: { tier: "invented" } },
    ],
  },
  {
    ...makeAccount().me,
    actor: {
      ...makeAccount().me.actor,
      memberships: [
        {
          organizationId: "personal",
          role: "editor",
          defaultProjectRole: "editor",
        },
      ],
    },
  },
])("/me rejects invalid or unexpected fields", (input) => {
  expect(() => parseAccountMe(input)).toThrow();
});
