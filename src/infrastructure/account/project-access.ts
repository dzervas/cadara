import {
  ProjectAccessRefusal,
  type ProjectAccessPort,
} from "@/application/account/project-access-port";
import {
  parseProjectDetails,
  parseProjectInviteOutcome,
  parseProjectPeople,
  parseProjectShareLink,
  parseProjectVersions,
} from "@/contracts/account/project-access.runtime-schema";
import type { ProjectServiceLink } from "@/contracts/modeling/project-manifest";

async function failure(response: Response, fallback: string) {
  // A body that is not JSON keeps the status-based message below.
  const body: unknown = await response.json().catch(() => null);
  const field = (name: string) =>
    body && typeof body === "object" && name in body
      ? (body as Record<string, unknown>)[name]
      : undefined;
  const code = String(field("error") ?? "");
  if (response.status === 402 && code === "quota_exceeded") {
    const limit = Number(field("limit")),
      used = Number(field("used"));
    return new ProjectAccessRefusal(
      { kind: "editor-limit", limit, used },
      `This project already has ${used} of ${limit} editors its plan allows.`,
    );
  }
  if (code === "external_sharing_disabled")
    return new ProjectAccessRefusal(
      { kind: "external-sharing-disabled" },
      "This team doesn't allow sharing with people outside it.",
    );
  if (response.status === 429)
    return new ProjectAccessRefusal(
      { kind: "rate-limited" },
      "An invite was sent recently. Try again in a few minutes.",
    );
  if (response.status === 401)
    return new Error("Sign in to CADara to manage sharing.");
  if (response.status === 403)
    return new ProjectAccessRefusal(
      { kind: "forbidden" },
      "Your role does not allow this on the project.",
    );
  return new Error(`${fallback} (HTTP ${response.status}).`);
}

export function createProjectAccessHttpClient({
  apiOrigin,
  fetcher = (input, init) => fetch(input, init),
}: {
  apiOrigin: string;
  fetcher?: typeof fetch;
}): ProjectAccessPort {
  const call = async (
    link: ProjectServiceLink,
    suffix: string,
    fallback: string,
    init: { method?: string; body?: unknown } = {},
  ) => {
    const path = `/orgs/${encodeURIComponent(link.orgId)}/projects/${encodeURIComponent(link.projectId)}${suffix}`;
    const method = init.method ?? "GET";
    const response = await fetcher(new URL(path, apiOrigin), {
      method,
      credentials: "include",
      // The service accepts only JSON request bodies on writes; a bodiless
      // DELETE still arrives with an empty body in the deployed runtime.
      ...(method === "GET"
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(init.body ?? {}),
          }),
    });
    if (!response.ok) throw await failure(response, fallback);
    return (await response.json()) as unknown;
  };
  return {
    async getProject(link) {
      return parseProjectDetails(
        await call(link, "", "The project could not be loaded"),
      );
    },
    async listPeople(link) {
      return parseProjectPeople(
        await call(
          link,
          "/people",
          "The people on this project could not be loaded",
        ),
      );
    },
    async invite(link, email, role) {
      return parseProjectInviteOutcome(
        await call(link, "/invites", "The invite could not be sent", {
          method: "POST",
          body: { email, role },
        }),
      );
    },
    async resendInvite(link, inviteId) {
      await call(
        link,
        `/invites/${encodeURIComponent(inviteId)}/resend`,
        "The invite could not be resent",
        { method: "POST" },
      );
    },
    async revokeInvite(link, inviteId) {
      await call(
        link,
        `/invites/${encodeURIComponent(inviteId)}`,
        "The invite could not be revoked",
        { method: "DELETE" },
      );
    },
    async setRole(link, userId, role) {
      await call(
        link,
        `/grants/${encodeURIComponent(userId)}`,
        "The role could not be changed",
        { method: "PUT", body: { role } },
      );
    },
    async removePerson(link, userId) {
      await call(
        link,
        `/grants/${encodeURIComponent(userId)}`,
        "The person could not be removed",
        { method: "DELETE" },
      );
    },
    async leave(link) {
      await call(link, "/leave", "You could not leave the project", {
        method: "POST",
      });
    },
    async setShareLinksEnabled(link, enabled) {
      // Rotating sets a fresh link secret, so links handed out before they
      // were turned off never come back.
      await (enabled
        ? call(link, "/share-links/rotate", "Links could not be turned on", {
            method: "POST",
          })
        : call(link, "/share-links", "Links could not be turned off", {
            method: "DELETE",
          }));
    },
    async rotateShareLinks(link) {
      await call(link, "/share-links/rotate", "The link could not be rotated", {
        method: "POST",
      });
    },
    async listVersions(link) {
      return parseProjectVersions(
        await call(
          link,
          "/versions",
          "The published versions could not be loaded",
        ),
      );
    },
    async mintShareLink(link, versionId, fileName) {
      return parseProjectShareLink(
        await call(link, "/share-links", "The link could not be made", {
          method: "POST",
          body: { versionId, name: fileName },
        }),
      );
    },
    async deleteProject(link) {
      await call(link, "", "The project could not be deleted", {
        method: "DELETE",
      });
    },
  };
}
