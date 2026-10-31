import { expect, test } from "vitest";
import { ProjectSlugConflictError } from "@/application/project-sync/project-service-port";
import { createProjectServiceHttpClient } from "./project-service-http-client";

interface RecordedRequest {
  method: string;
  url: string;
  credentials: RequestCredentials | undefined;
  body: unknown;
}

function makeFakeFetch(
  respond: (request: RecordedRequest) => { status: number; body: unknown },
) {
  const requests: RecordedRequest[] = [];
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const request: RecordedRequest = {
      method: init?.method ?? "GET",
      url: String(input),
      credentials: init?.credentials,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    const { status, body } = respond(request);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { requests, fetcher };
}

const project = {
  id: "p1",
  organization_id: "org",
  slug: "bracket",
  name: "Bracket",
  visibility: "private",
  manifest_doc_id: null,
  created_at: 1,
  automerge_bytes: 0,
};

function tokenWithRole(role: string) {
  const payload = btoa(
    JSON.stringify({
      projectId: "p1",
      orgId: "org",
      userId: "u",
      role,
      exp: 9,
    }),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `${payload}.signature`;
}

test("creating a project and registering its manifest call the service with the session cookie", async () => {
  const { requests, fetcher } = makeFakeFetch((request) =>
    request.url.endsWith("/manifest")
      ? { status: 200, body: { manifest_doc_id: "doc" } }
      : { status: 201, body: project },
  );
  const client = createProjectServiceHttpClient({
    apiOrigin: "http://api.test",
    fetcher,
  });
  const created = await client.createProject("org", {
    name: "Bracket",
    slug: "bracket",
    visibility: "private",
  });
  await client.registerManifest({ orgId: "org", projectId: created.id }, "doc");
  expect(requests).toEqual([
    {
      method: "POST",
      url: "http://api.test/orgs/org/projects",
      credentials: "include",
      body: { name: "Bracket", slug: "bracket", visibility: "private" },
    },
    {
      method: "PUT",
      url: "http://api.test/orgs/org/projects/p1/manifest",
      credentials: "include",
      body: { automergeDocumentId: "doc" },
    },
  ]);
  expect(created.id).toBe("p1");
});

test("service refusals become readable errors", async () => {
  const { fetcher } = makeFakeFetch(() => ({
    status: 409,
    body: { error: "slug_conflict" },
  }));
  const client = createProjectServiceHttpClient({
    apiOrigin: "http://api.test",
    fetcher,
  });
  await expect(
    client.createProject("org", {
      name: "Bracket",
      slug: "bracket",
      visibility: "private",
    }),
  ).rejects.toBeInstanceOf(ProjectSlugConflictError);
});

test("a sync grant carries the role the room will enforce", async () => {
  const { fetcher, requests } = makeFakeFetch(() => ({
    status: 200,
    body: { token: tokenWithRole("viewer"), expiresIn: 600 },
  }));
  const client = createProjectServiceHttpClient({
    apiOrigin: "http://api.test",
    fetcher,
  });
  const grant = await client.issueSyncGrant({ orgId: "org", projectId: "p1" });
  expect(grant).toMatchObject({ expiresIn: 600, role: "viewer" });
  expect(requests[0]).toMatchObject({
    method: "POST",
    url: "http://api.test/orgs/org/projects/p1/sync-token",
    body: {},
  });
});

test("malformed service responses are rejected at the boundary", async () => {
  const { fetcher } = makeFakeFetch(() => ({
    status: 200,
    body: [{ ...project, visibility: "secret" }],
  }));
  const client = createProjectServiceHttpClient({
    apiOrigin: "http://api.test",
    fetcher,
  });
  await expect(client.listProjects("org")).rejects.toThrow();
});
