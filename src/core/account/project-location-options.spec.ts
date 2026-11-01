// Lane: logic. Seam: the New project modal's location cards and preselection
// (projectLocationOptions, preselectProjectLocation, projectOwners).
import { expect, test } from "vitest";
import type { Account } from "@/contracts/account/account";
import { makeAccount } from "../../../test/helpers/account-fixtures";
import {
  preselectProjectLocation,
  projectLocationOptions,
  projectOwners,
} from "./project-location-options";

function available(options: ReturnType<typeof projectLocationOptions>) {
  return options
    .filter((option) => option.disabledReason === null)
    .map((option) => option.value);
}

function withUsage(
  usage: Account["me"]["organizations"][number]["usage"],
): Account {
  const account = makeAccount();
  account.me.organizations[0]!.usage = usage;
  return account;
}

test("a guest can create only Local projects and is offered sign-in for the account cards", () => {
  const options = projectLocationOptions(null, "", false);
  expect(available(options)).toEqual(["local"]);
  expect(options.filter((option) => option.value !== "local")).toEqual([
    expect.objectContaining({
      value: "private",
      disabledReason: "Sign in to create an account project.",
      action: "sign-in",
    }),
    expect.objectContaining({
      value: "public",
      disabledReason: "Sign in to create an account project.",
      action: "sign-in",
    }),
  ]);
  expect(preselectProjectLocation(options, "private")).toBe("local");
});

test("offline, every account card explains why and only Local stays available", () => {
  const options = projectLocationOptions(makeAccount(), "personal", true);
  expect(available(options)).toEqual(["local"]);
  for (const option of options.slice(1))
    expect(option).toMatchObject({
      disabledReason: "Offline. Connect to create an account project.",
      action: null,
    });
});

test("at the private project limit Private is disabled with a Change plan action and Public stays available", () => {
  const options = projectLocationOptions(
    withUsage({ storage_bytes: 0, private_projects: 3 }),
    "personal",
    false,
  );
  expect(options.find((option) => option.value === "private")).toMatchObject({
    disabledReason: "Private project limit reached.",
    action: "plan",
  });
  expect(available(options)).toEqual(["local", "public"]);
  expect(preselectProjectLocation(options, null)).toBe("local");
});

test("at the storage limit both account cards are disabled with a Change plan action", () => {
  const options = projectLocationOptions(
    withUsage({ storage_bytes: 1024, private_projects: 0 }),
    "personal",
    false,
  );
  expect(available(options)).toEqual(["local"]);
  expect(options.slice(1).map((option) => option.action)).toEqual([
    "plan",
    "plan",
  ]);
});

test("the private card shows storage and private project usage, the public card storage only", () => {
  const [, privateCard, publicCard] = projectLocationOptions(
    withUsage({ storage_bytes: 512, private_projects: 1 }),
    "personal",
    false,
  );
  expect(privateCard!.detail).toBe("512 B of 1 KB · 1 of 3 private projects");
  expect(publicCard!.detail).toBe("512 B of 1 KB");
});

test("the last available choice is preselected, else Private for a signed-in user", () => {
  const options = projectLocationOptions(makeAccount(), "personal", false);
  expect(preselectProjectLocation(options, "public")).toBe("public");
  expect(preselectProjectLocation(options, "local")).toBe("local");
  expect(preselectProjectLocation(options, null)).toBe("private");
});

test("collaborator organizations cannot own new projects", () => {
  const account = makeAccount();
  account.organizations.push({ id: "shared", name: "Shared with me" });
  account.me.actor.memberships.push({
    ...account.me.actor.memberships[0]!,
    id: "collaboration",
    organizationId: "shared",
    role: "collaborator",
    defaultProjectRole: null,
  });
  expect(projectOwners(account).map((owner) => owner.id)).toEqual(["personal"]);
  expect(projectOwners(null)).toEqual([]);
});
