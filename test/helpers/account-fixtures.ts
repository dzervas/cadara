import type { Account } from "@/contracts/account/account";

export function makeAccount(): Account {
  return {
    user: { id: "user", name: "Maker", email: "maker@example.test" },
    me: {
      actor: {
        userId: "user",
        credential: { kind: "session" },
        memberships: [
          {
            id: "membership",
            userId: "user",
            createdAt: "2026-01-01T00:00:00.000Z",
            organizationId: "personal",
            role: "owner",
            defaultProjectRole: "editor",
          },
        ],
        projectGrants: [],
      },
      organizations: [
        {
          organizationId: "personal",
          entitlements: {
            tier: "free",
            storage_limit_bytes: 1024,
            private_project_limit: 3,
            collaborator_limit: 2,
            seat_count: 1,
          },
        },
      ],
    },
    organizations: [{ id: "personal", name: "Personal" }],
  };
}
