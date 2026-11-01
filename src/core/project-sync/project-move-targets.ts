import type { ProjectManifest } from "@/contracts/modeling/project-manifest";

/** Where local projects are listed: this browser's storage, no quota. */
export const LOCAL_PROJECT_GROUP = "On this device";

/** The list heading of a project: its location, or its account owner. */
export function projectGroupLabel(
  project: Pick<ProjectManifest, "service">,
  organizations: readonly { id: string; name: string }[],
) {
  if (!project.service) return LOCAL_PROJECT_GROUP;
  const orgId = project.service.orgId;
  return organizations.find((org) => org.id === orgId)?.name ?? "CADara";
}

/** Why the open project's part cannot be moved at all; null when it can. */
export function documentMoveUnavailableReason(input: {
  sourceEditable: boolean;
  projectCount: number;
}) {
  if (!input.sourceEditable)
    return "Moving a part needs editor access to this project.";
  if (input.projectCount < 2)
    return "Create another project to move this part into.";
  return null;
}

export interface ProjectMoveTarget {
  projectId: string;
  name: string;
  group: string;
  /** Null when the part can move there. */
  disabledReason: string | null;
  /** A plan with more storage resolves the reason. */
  action: "plan" | null;
}

/**
 * Every project but the source. An account project needs a connection and
 * a signed-in user who can edit it and room in its owner's storage;
 * `editable` reports what is known of the
 * role (true while unknown: the move asks the service before copying).
 */
export function projectMoveTargets(
  projects: readonly ProjectManifest[],
  sourceProjectId: string,
  context: {
    online: boolean;
    signedIn: boolean;
    organizations: readonly { id: string; name: string }[];
    editable: (project: ProjectManifest) => boolean;
    /** The owner's storage is full, so the copy could never be stored. */
    storageAtLimit: (project: ProjectManifest) => boolean;
  },
): ProjectMoveTarget[] {
  return projects
    .filter((project) => project.projectId !== sourceProjectId)
    .map((project) => {
      const full = Boolean(project.service) && context.storageAtLimit(project);
      return {
        projectId: project.projectId,
        name: project.name,
        group: projectGroupLabel(project, context.organizations),
        disabledReason: !project.service
          ? null
          : !context.online
            ? "Offline. Connect to move into an account project."
            : !context.signedIn
              ? "Sign in to move into an account project."
              : !context.editable(project)
                ? "Needs editor access to that project."
                : full
                  ? "Storage limit reached."
                  : null,
        action:
          project.service && context.online && context.signedIn && full
            ? ("plan" as const)
            : null,
      };
    });
}
