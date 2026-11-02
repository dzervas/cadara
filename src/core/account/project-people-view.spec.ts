// Lane: logic. Seam: the exported People view rules the project page and the
// Share dialog render from (rendering is in project-people-section.spec.tsx).
import { expect, test } from "vitest";
import { makeAccount } from "../../../test/helpers/account-fixtures";
import { makeProjectPeople } from "../../../test/helpers/project-people-fixtures";
import {
  canLeaveProject,
  editorLimitReached,
  inviteExpiryLabel,
  latestShareableFile,
  projectOwnerName,
  projectPersonRows,
} from "./project-people-view";

test("a personal project lists its owner first as admin, then the granted people, marking the user", () => {
  const rows = projectPersonRows(makeProjectPeople(), "viewer");
  expect(rows.map((row) => [row.userId, row.role, row.owner, row.you])).toEqual(
    [
      ["user", "admin", true, false],
      ["viewer", "viewer", false, true],
    ],
  );
});

test("a team project has no owner row: the team owns it and its access is the team row", () => {
  const people = makeProjectPeople();
  people.organization = {
    personal: false,
    name: "Fieldwork",
    default_project_role: "editor",
  };
  expect(projectPersonRows(people, "user").map((row) => row.userId)).toEqual([
    "viewer",
  ]);
  expect(projectOwnerName(people)).toBe("Fieldwork");
});

test("a personal project is owned by its owner, named by email when they have no name", () => {
  const people = makeProjectPeople();
  expect(projectOwnerName(people)).toBe("Maker");
  people.owner!.name = "";
  expect(projectOwnerName(people)).toBe("maker@example.test");
});

test("only individually invited collaborators can leave a project", () => {
  const account = makeAccount();
  expect(canLeaveProject(account, "personal")).toBe(false);
  account.me.actor.memberships.push({
    id: "m2",
    userId: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    organizationId: "host",
    role: "collaborator",
    defaultProjectRole: null,
  });
  account.me.actor.memberships.push({
    id: "m3",
    userId: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    organizationId: "team",
    role: "member",
    defaultProjectRole: "editor",
  });
  expect(canLeaveProject(account, "host")).toBe(true);
  expect(canLeaveProject(account, "team")).toBe(false);
  expect(canLeaveProject(null, "host")).toBe(false);
});

test("the editor limit binds editors and admins only, once the count (pending invites included) reaches it", () => {
  const people = makeProjectPeople();
  expect(editorLimitReached(people, "editor")).toBeNull();
  people.editors = { limit: 1, used: 1 };
  expect(editorLimitReached(people, "editor")).toEqual({ limit: 1, used: 1 });
  expect(editorLimitReached(people, "admin")).toEqual({ limit: 1, used: 1 });
  expect(editorLimitReached(people, "commenter")).toBeNull();
  expect(editorLimitReached(people, "viewer")).toBeNull();
  people.editors = null;
  expect(editorLimitReached(people, "editor")).toBeNull();
});

test("a fresh invite reads as expiring in 14 days and never as less than a day", () => {
  const now = Date.UTC(2026, 0, 1);
  const day = 24 * 60 * 60 * 1000;
  expect(inviteExpiryLabel(now + 14 * day - 1000, now)).toBe(
    "expires in 14 days",
  );
  // Read when the page loaded, a minute before the invite went out.
  expect(inviteExpiryLabel(now + 14 * day + 60_000, now)).toBe(
    "expires in 14 days",
  );
  expect(inviteExpiryLabel(now + 60_000, now)).toBe("expires in 1 day");
});

test("a share link opens the model of the latest published version; unpublished versions never count", () => {
  const version = (
    id: string,
    created_at: number,
    bundle_state: "pending" | "complete",
    files: string[],
  ) => ({
    id,
    created_at,
    bundle_state,
    files: files.map((name) => ({ name })),
  });
  expect(latestShareableFile([])).toBeNull();
  expect(
    latestShareableFile([version("draft", 3, "pending", ["mesh.glb"])]),
  ).toBeNull();
  expect(
    latestShareableFile([
      version("old", 1, "complete", ["part.cadara", "mesh.glb"]),
      version("new", 2, "complete", ["part.cadara", "mesh.3mf"]),
      version("draft", 3, "pending", ["mesh.glb"]),
    ]),
  ).toEqual({ versionId: "new", fileName: "mesh.3mf" });
});
