// Lane: logic. Seam: which projects Move to project offers and why others
// are disabled (projectMoveTargets, documentMoveUnavailableReason).
import { expect, test } from "vitest";
import type { ProjectManifest } from "@/contracts/modeling/project-manifest";
import {
  documentMoveUnavailableReason,
  LOCAL_PROJECT_GROUP,
  projectMoveTargets,
} from "./project-move-targets";

function project(
  projectId: string,
  service?: ProjectManifest["service"],
): ProjectManifest {
  return {
    format: "cadara-project",
    schemaVersion: 1,
    projectId,
    name: projectId,
    entries: [],
    versions: [],
    ...(service ? { service } : {}),
  };
}

const projects = [
  project("source"),
  project("bracket"),
  project("shared", { orgId: "team", projectId: "remote" }),
];
const context = {
  online: true,
  signedIn: true,
  organizations: [{ id: "team", name: "Team" }],
  editable: () => true,
  storageAtLimit: () => false,
};

test("every other project is a target, grouped by where it lives", () => {
  expect(projectMoveTargets(projects, "source", context)).toEqual([
    {
      projectId: "bracket",
      name: "bracket",
      group: LOCAL_PROJECT_GROUP,
      disabledReason: null,
      action: null,
    },
    {
      projectId: "shared",
      name: "shared",
      group: "Team",
      disabledReason: null,
      action: null,
    },
  ]);
});

test.each([
  [{ online: false }, "Offline. Connect to move into an account project."],
  [{ signedIn: false }, "Sign in to move into an account project."],
  [{ editable: () => false }, "Needs editor access to that project."],
  [{ storageAtLimit: () => true }, "Storage limit reached."],
])(
  "an account target is disabled with the reason (%o) while local targets stay available",
  (override, reason) => {
    const targets = projectMoveTargets(projects, "source", {
      ...context,
      ...override,
    });
    expect(targets.map((target) => target.disabledReason)).toEqual([
      null,
      reason,
    ]);
  },
);

test("a part cannot move without editor access to its project or another project", () => {
  expect(
    documentMoveUnavailableReason({ sourceEditable: false, projectCount: 3 }),
  ).toBe("Moving a part needs editor access to this project.");
  expect(
    documentMoveUnavailableReason({ sourceEditable: true, projectCount: 1 }),
  ).toBe("Create another project to move this part into.");
  expect(
    documentMoveUnavailableReason({ sourceEditable: true, projectCount: 2 }),
  ).toBeNull();
});

test("a target whose owner's storage is full offers Change plan", () => {
  const [, shared] = projectMoveTargets(projects, "source", {
    ...context,
    storageAtLimit: () => true,
  });
  expect(shared).toMatchObject({
    disabledReason: "Storage limit reached.",
    action: "plan",
  });
});
