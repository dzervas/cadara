/** How many projects the logo menu's project submenu lists. */
export const RECENT_PROJECT_LIMIT = 8;

/** Moves `projectId` to the front of the most-recently-opened ids. */
export function recordRecentProject(
  recentIds: readonly string[],
  projectId: string,
) {
  return [projectId, ...recentIds.filter((id) => id !== projectId)].slice(
    0,
    // Ids of projects no longer listed fall off behind the listed ones.
    RECENT_PROJECT_LIMIT * 4,
  );
}

/**
 * The projects to switch to, most recently opened first: every listed
 * project but the open one, those never opened here after the rest in list
 * order, at most RECENT_PROJECT_LIMIT.
 */
export function recentProjects<Project extends { projectId: string }>(
  projects: readonly Project[],
  recentIds: readonly string[],
  openProjectId: string,
) {
  const rank = (project: Project) => {
    const index = recentIds.indexOf(project.projectId);
    return index === -1 ? recentIds.length : index;
  };
  return projects
    .filter((project) => project.projectId !== openProjectId)
    .map((project, order) => ({ project, order }))
    .sort((a, b) => rank(a.project) - rank(b.project) || a.order - b.order)
    .slice(0, RECENT_PROJECT_LIMIT)
    .map(({ project }) => project);
}
