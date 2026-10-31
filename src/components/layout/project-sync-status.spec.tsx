import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { workbenchTheme } from "@/theme/workbench-theme";
import {
  ProjectPresenceStrip,
  ProjectSyncIndicator,
} from "./project-sync-status";

function render(node: ReactNode) {
  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      {node}
    </MantineProvider>,
  );
}

test.each(["synced", "syncing", "connecting"] as const)(
  "healthy %s has no badge",
  (connection) => {
    expect(
      render(<ProjectSyncIndicator connection={connection} role="editor" />),
    ).not.toContain('role="status"');
  },
);

test("offline has a visible connection badge", () => {
  expect(
    render(<ProjectSyncIndicator connection="offline" role="editor" />),
  ).toContain('aria-label="Sync status: Offline"');
});

test.each([
  ["viewer", "Read only · Viewer"],
  ["commenter", "Read only · Commenter"],
] as const)(
  "a %s sees a read-only status naming the role in every connection state",
  (role, label) => {
    for (const connection of [
      "synced",
      "syncing",
      "connecting",
      "offline",
    ] as const)
      expect(
        render(<ProjectSyncIndicator connection={connection} role={role} />),
        `${role} while ${connection}`,
      ).toMatch(new RegExp(`<[^>]*role="status"[^>]*aria-label="${label}"`));
  },
);

test("editors and admins see no read-only badge", () => {
  for (const role of ["editor", "admin", null] as const)
    expect(
      render(<ProjectSyncIndicator connection="synced" role={role} />),
    ).not.toContain("Read only");
});

test("the presence strip lists other participants with initials, roles and colour rings", () => {
  const html = render(
    <ProjectPresenceStrip
      participants={[
        {
          key: "a",
          name: "Ada Lovelace",
          role: "editor",
          color: "#b197fc",
        },
        {
          key: "b",
          name: "grace",
          role: "viewer",
          color: "#63e6be",
        },
      ]}
    />,
  );
  expect(html).toContain('aria-label="People in this project"');
  expect(html).toContain('aria-label="Ada Lovelace · editor"');
  expect(html).toContain(">AL<");
  expect(html).toContain('aria-label="grace · viewer"');
  expect(html).toContain(">GR<");
});

test("an empty project shows no presence strip", () => {
  expect(render(<ProjectPresenceStrip participants={[]} />)).not.toContain(
    "People in this project",
  );
});

test("failures are named explicitly and use the danger colour", () => {
  const html = render(
    <ProjectSyncIndicator
      connection="synced"
      role="editor"
      failed
      detail="Rejected"
    />,
  );
  expect(html).toContain('aria-label="Sync status: Sync error"');
  expect(html).toContain("--mantine-color-red");
});

test("at most four avatars show before the overflow list trigger", () => {
  const html = render(
    <ProjectPresenceStrip
      participants={Array.from({ length: 7 }, (_, i) => ({
        key: String(i),
        name: `Peer ${i}`,
        role: "editor",
        color: "#b197fc",
      }))}
    />,
  );
  expect(html.match(/data-project-presence-name=/g)).toHaveLength(4);
  expect(html).toContain('aria-label="3 more people in this project"');
});
