import type { ProjectPeople } from "@/contracts/account/project-access";

/** A personal project as its owner ("user" in makeAccount) sees it. */
export function makeProjectPeople(): ProjectPeople {
  return {
    your_role: "admin",
    can_manage: true,
    owner: {
      user_id: "user",
      name: "Maker",
      email: "maker@example.test",
      image: null,
    },
    organization: {
      personal: true,
      name: "Personal",
      default_project_role: null,
    },
    editors: { limit: 1, used: 0 },
    people: [
      {
        state: "granted",
        user_id: "viewer",
        role: "viewer",
        name: "Vera Viewer",
        email: "vera@example.test",
        image: null,
      },
    ],
    pending: [
      {
        state: "pending",
        invite_id: "invite",
        email: "new@example.test",
        role: "commenter",
        expires_at: Date.UTC(2026, 0, 15),
      },
    ],
  };
}
