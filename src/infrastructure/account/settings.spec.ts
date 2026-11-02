// Logic lane (adapter conformance): account settings requests against a fake account API.
import { expect, test } from "vitest";
import { createAccountSettingsClient } from "./settings";

function fakeAccountApi(answer: (request: Request) => Response) {
  const requests: Request[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return answer(request);
  };
  return {
    requests,
    client: createAccountSettingsClient({
      apiOrigin: "https://api.test",
      fetcher,
    }),
  };
}

test("workspace API keys are created with the chosen access and revoked by id", async () => {
  const metadata = {
    organizationId: "org",
    scopes: [
      "project:read",
      "project:write",
      "project:create",
      "project:delete",
    ],
  };
  const { client, requests } = fakeAccountApi((request) =>
    request.method === "POST"
      ? Response.json(
          {
            id: "key",
            key: "cad_secret",
            name: "CI",
            prefix: "cad_",
            metadata,
          },
          { status: 201 },
        )
      : Response.json({ success: true }),
  );
  await expect(
    client.createApiKey("org", "CI", "read-write"),
  ).resolves.toMatchObject({
    key: "cad_secret",
  });
  await client.revokeApiKey("org", "key");
  expect(await requests[0]!.json()).toEqual({
    name: "CI",
    scopes: metadata.scopes,
  });
  expect(
    requests.map(
      (request) => `${request.method} ${new URL(request.url).pathname}`,
    ),
  ).toEqual(["POST /orgs/org/api-keys", "DELETE /orgs/org/api-keys/key"]);
});

test("deleting an account that owns teams reports them instead of deleting", async () => {
  const blocked = fakeAccountApi(() =>
    Response.json(
      { error: "owned_organizations", organizations: ["team-1"] },
      { status: 409 },
    ),
  );
  await expect(blocked.client.deleteAccount()).resolves.toEqual({
    deleted: false,
    ownedOrganizationIds: ["team-1"],
  });
  const deleted = fakeAccountApi(() => Response.json({ deleted: true }));
  await expect(deleted.client.deleteAccount()).resolves.toEqual({
    deleted: true,
  });
  expect(deleted.requests[0]!.method).toBe("DELETE");
  expect(new URL(deleted.requests[0]!.url).pathname).toBe("/me");
});

test("export resolves to the archive and explains an oversized account", async () => {
  const archive = fakeAccountApi(
    () =>
      new Response(new Uint8Array([0x50, 0x4b]), {
        headers: { "Content-Type": "application/zip" },
      }),
  );
  const blob = await archive.client.downloadExport();
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
    new Uint8Array([0x50, 0x4b]),
  );
  expect(archive.requests[0]!.credentials).toBe("include");
  const oversized = fakeAccountApi(() =>
    Response.json({ error: "export_too_large" }, { status: 413 }),
  );
  await expect(oversized.client.downloadExport()).rejects.toThrow("too large");
});
