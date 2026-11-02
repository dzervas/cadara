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
            project_editor_limit: 1,
            seat_count: 1,
          },
          usage: { storage_bytes: 0, private_projects: 0 },
        },
      ],
    },
    organizations: [{ id: "personal", name: "Personal", personal: true }],
  };
}
