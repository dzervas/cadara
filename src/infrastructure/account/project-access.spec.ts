// Lane: logic (adapter conformance). Seam: the project access HTTP client
// against a fake service: request shapes and refusal mapping.
import { expect, test } from "vitest";
import { ProjectAccessRefusal } from "@/application/account/project-access-port";
import { createProjectAccessHttpClient } from "./project-access";

const link = { orgId: "org", projectId: "p 1" };

function fakeService(
  respond: (request: Request) => Response = () => Response.json({ ok: true }),
) {
  const requests: Request[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return respond(request);
  };
  return {
    requests,
    client: createProjectAccessHttpClient({
      apiOrigin: "https://api.example.test",
      fetcher,
    }),
  };
}

const route = (request: Request) =>
  `${request.method} ${new URL(request.url).pathname}`;

test("links turn on by starting a new link secret and off by revoking every handed-out link", async () => {
  const { client, requests } = fakeService();
  await client.setShareLinksEnabled(link, true);
  await client.setShareLinksEnabled(link, false);
  await client.rotateShareLinks(link);
  expect(requests.map(route)).toEqual([
    "POST /orgs/org/projects/p%201/share-links/rotate",
    "DELETE /orgs/org/projects/p%201/share-links",
    "POST /orgs/org/projects/p%201/share-links/rotate",
  ]);
  expect(
    requests.map((request) => request.headers.get("content-type")),
  ).toEqual(["application/json", "application/json", "application/json"]);
});

test("a share link names the version and file it opens", async () => {
  const { client, requests } = fakeService(() =>
    Response.json(
      { url: "https://api.example.test/share/x", expires_at: 1 },
      { status: 201 },
    ),
  );
  expect(await client.mintShareLink(link, "v1", "mesh.glb")).toEqual({
    url: "https://api.example.test/share/x",
    expires_at: 1,
  });
  expect(route(requests[0]!)).toBe("POST /orgs/org/projects/p%201/share-links");
  expect(await requests[0]!.json()).toEqual({
    versionId: "v1",
    name: "mesh.glb",
  });
});

test("an invite posts the email and role and reads a pending outcome", async () => {
  const { client, requests } = fakeService(() =>
    Response.json(
      {
        state: "pending",
        invite_id: "i",
        email: "new@example.test",
        role: "viewer",
        expires_at: 1,
      },
      { status: 201 },
    ),
  );
  expect(await client.invite(link, "new@example.test", "viewer")).toEqual(
    expect.objectContaining({ state: "pending", invite_id: "i" }),
  );
  expect(route(requests[0]!)).toBe("POST /orgs/org/projects/p%201/invites");
  expect(await requests[0]!.json()).toEqual({
    email: "new@example.test",
    role: "viewer",
  });
});

test.each([
  [
    402,
    { error: "quota_exceeded", limit: 1, used: 1 },
    { kind: "editor-limit", limit: 1, used: 1 },
  ],
  [
    403,
    { error: "external_sharing_disabled" },
    { kind: "external-sharing-disabled" },
  ],
  [429, { error: "Rate limit exceeded" }, { kind: "rate-limited" }],
  [403, { error: "Forbidden" }, { kind: "forbidden" }],
])("a %i %o refusal explains itself as %o", async (status, body, reason) => {
  const { client } = fakeService(() => Response.json(body, { status }));
  const refusal = await client
    .invite(link, "x@example.test", "editor")
    .catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(ProjectAccessRefusal);
  expect((refusal as ProjectAccessRefusal).reason).toEqual(reason);
});

test("a malformed people response is rejected rather than rendered", async () => {
  const { client } = fakeService(() => Response.json({ people: "nobody" }));
  await expect(client.listPeople(link)).rejects.toThrow();
});
