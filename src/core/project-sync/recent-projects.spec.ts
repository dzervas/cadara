// Logic lane: the logo menu's recent projects, ordered from the ids a
// browser recorded as it opened projects.
import { expect, test } from "vitest";
import {
  RECENT_PROJECT_LIMIT,
  recentProjects,
  recordRecentProject,
} from "./recent-projects";

const listed = (...ids: string[]) => ids.map((projectId) => ({ projectId }));
const ids = (projects: { projectId: string }[]) =>
  projects.map((project) => project.projectId);

test("lists the most recently opened projects first, without the open one", () => {
  let recent: string[] = [];
  for (const id of ["a", "b", "c", "a"])
    recent = recordRecentProject(recent, id);
  expect(recent, "reopening moves a project to the front").toEqual([
    "a",
    "c",
    "b",
  ]);
  expect(ids(recentProjects(listed("b", "c", "a", "d"), recent, "a"))).toEqual([
    "c",
    "b",
    "d",
  ]);
});

test("projects never opened here follow in list order, and ids no longer listed are skipped", () => {
  expect(
    ids(recentProjects(listed("x", "y", "b"), ["gone", "b"], "open")),
  ).toEqual(["b", "x", "y"]);
});

test("lists at most the limit", () => {
  const many = listed(
    ...Array.from({ length: RECENT_PROJECT_LIMIT + 3 }, (_, i) => `p${i}`),
  );
  expect(recentProjects(many, [], "none")).toHaveLength(RECENT_PROJECT_LIMIT);
});
