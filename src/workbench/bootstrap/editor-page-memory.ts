import { useEffect, useRef } from "react";
import { rememberPage } from "@/core/navigation/last-page";
import type { ProjectManifest } from "@/contracts/modeling/project-manifest";

const PROJECT_ADDRESS = /^\/app\/(?:p|local)\//;

function editorProjectPath(project: ProjectManifest) {
  return project.service
    ? `/app/p/${encodeURIComponent(project.service.projectId)}`
    : `/app/local/${encodeURIComponent(project.projectId)}`;
}

/**
 * Remembers the open project as the last page for "/", and keeps a project
 * address (/app/p, /app/local) on the open project so a reload reopens it.
 * Bare /app stays bare.
 *
 * Invariant: when the address names another project than the first one shown,
 * that first project is a stand-in while the address's account project opens
 * (or after it failed to): it neither replaces the address nor is remembered.
 */
export function useEditorPageMemory(project: ProjectManifest | null) {
  const standInProjectId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!project) return;
    const path = editorProjectPath(project);
    const { pathname } = window.location;
    const onProjectAddress = PROJECT_ADDRESS.test(pathname);
    if (standInProjectId.current === undefined)
      standInProjectId.current =
        onProjectAddress && pathname !== path ? project.projectId : null;
    if (project.projectId === standInProjectId.current) return;
    rememberPage(window.localStorage, path);
    if (onProjectAddress && pathname !== path) {
      const url = new URL(window.location.href);
      url.pathname = path;
      window.history.replaceState(window.history.state, "", url);
    }
  }, [project]);
}
