import {
  ProjectSlugConflictError,
  type ProjectServicePort,
} from "@/application/project-sync/project-service-port";
import {
  parseRemoteProject,
  parseRemoteProjects,
  parseSyncTokenClaims,
  parseSyncTokenResponse,
} from "@/contracts/project-sync/project-service.runtime-schema";

const SERVICE_ERRORS: Record<string, string> = {
  quota_exceeded: "This organization has reached its plan's project limit.",
  manifest_conflict: "This service project already syncs another manifest.",
};

async function failure(response: Response, fallback: string) {
  // A body that is not JSON keeps the status-based message below.
  const body: unknown = await response.json().catch(() => null);
  const code =
    body && typeof body === "object" && "error" in body
      ? String(body.error)
      : "";
  if (code === "slug_conflict") return new ProjectSlugConflictError();
  if (SERVICE_ERRORS[code]) return new Error(SERVICE_ERRORS[code]);
  if (response.status === 401)
    return new Error("Sign in to CADara to sync projects.");
  if (response.status === 403)
    return new Error("Your role does not allow this on the project.");
  return new Error(`${fallback} (HTTP ${response.status}).`);
}

export function createProjectServiceHttpClient({
  apiOrigin,
  fetcher = (input, init) => fetch(input, init),
}: {
  apiOrigin: string;
  fetcher?: typeof fetch;
}): ProjectServicePort {
  const call = async (
    path: string,
    fallback: string,
    init: { method?: string; body?: unknown } = {},
  ) => {
    const response = await fetcher(new URL(path, apiOrigin), {
      method: init.method ?? "GET",
      credentials: "include",
      ...(init.body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(init.body),
          }),
    });
    if (!response.ok) throw await failure(response, fallback);
    return (await response.json()) as unknown;
  };
  const projectPath = (orgId: string, projectId: string) =>
    `/orgs/${encodeURIComponent(orgId)}/projects/${encodeURIComponent(projectId)}`;
  return {
    async createProject(orgId, input) {
      return parseRemoteProject(
        await call(
          `/orgs/${encodeURIComponent(orgId)}/projects`,
          "The project could not be created",
          { method: "POST", body: input },
        ),
      );
    },
    async registerManifest(link, automergeDocumentId) {
      await call(
        `${projectPath(link.orgId, link.projectId)}/manifest`,
        "The project manifest could not be registered",
        { method: "PUT", body: { automergeDocumentId } },
      );
    },
    async listProjects(orgId) {
      return parseRemoteProjects(
        await call(
          `/orgs/${encodeURIComponent(orgId)}/projects`,
          "The organization's projects could not be listed",
        ),
      );
    },
    async issueSyncGrant(link) {
      const response = parseSyncTokenResponse(
        await call(
          `${projectPath(link.orgId, link.projectId)}/sync-token`,
          "A sync token could not be issued",
          // The service accepts only JSON request bodies on writes.
          { method: "POST", body: {} },
        ),
      );
      return { ...response, role: parseSyncTokenClaims(response.token).role };
    },
  };
}
