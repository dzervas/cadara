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

test.each([
  ["synced", "Synced"],
  ["syncing", "Syncing"],
  ["connecting", "Connecting"],
  ["offline", "Offline"],
] as const)("the sync indicator names the %s state", (connection, label) => {
  const html = render(
    <ProjectSyncIndicator connection={connection} role="editor" />,
  );
  expect(html).toContain(`aria-label="Sync status: ${label}"`);
  expect(html).toContain(`data-project-sync-connection="${connection}"`);
  expect(html).not.toContain("Read only");
});

test.each(["viewer", "commenter"] as const)(
  "a %s sees the read-only badge",
  (role) => {
    expect(
      render(<ProjectSyncIndicator connection="synced" role={role} />),
    ).toContain("Read only");
  },
);

test("editors and admins see no read-only badge", () => {
  for (const role of ["editor", "admin", null] as const)
    expect(
      render(<ProjectSyncIndicator connection="synced" role={role} />),
    ).not.toContain("Read only");
});

test("the presence strip lists other participants with initials and their open part", () => {
  const html = render(
    <ProjectPresenceStrip
      participants={[
        { key: "a", name: "Ada Lovelace", activePartName: "Lid" },
        { key: "b", name: "grace", activePartName: null },
      ]}
    />,
  );
  expect(html).toContain('aria-label="People in this project"');
  expect(html).toContain('aria-label="Ada Lovelace · Lid"');
  expect(html).toContain(">AL<");
  expect(html).toContain('aria-label="grace"');
  expect(html).toContain(">GR<");
});

test("an empty project shows no presence strip", () => {
  expect(render(<ProjectPresenceStrip participants={[]} />)).not.toContain(
    "People in this project",
  );
});

test("healthy states stay graphite; offline and failures carry status colour", () => {
  const color = (html: string) =>
    html.match(/--badge-dot-color:var\(--mantine-color-([a-z]+)/)?.[1];
  expect(
    color(render(<ProjectSyncIndicator connection="synced" role="editor" />)),
  ).toBe("gray");
  expect(
    color(render(<ProjectSyncIndicator connection="syncing" role="editor" />)),
  ).toBe("gray");
  expect(
    color(render(<ProjectSyncIndicator connection="offline" role="editor" />)),
  ).toBe("yellow");
  expect(
    color(
      render(
        <ProjectSyncIndicator connection="offline" role="editor" failed />,
      ),
    ),
  ).toBe("red");
});
