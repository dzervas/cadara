import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { workbenchTheme } from "../../src/theme/workbench-theme";
import { ProjectSyncPresence } from "../../src/workbench/bootstrap/project-sync-controls";
import type { ProjectSync } from "../../src/workbench/bootstrap/use-project-sync";

/** Browser presentation fixture, mounted in the real toolbar's empty slot. */
export function mountPresenceFixture(
  connection: "synced" | "offline",
  count = 6,
) {
  const slot = document.querySelector<HTMLElement>(
    "[data-project-presence-slot]",
  )!;
  const peers = Array.from({ length: count }, (_, i) => ({
    peerId: `session-${i}`,
    userId: `peer-${i}`,
    name: `Person ${i}`,
    role: i === 0 ? "viewer" : "editor",
    activeDocumentId: null,
  }));
  // A second session of one account still shows a single avatar.
  if (peers[1]) peers.push({ ...peers[1], peerId: "session-1-second-tab" });
  const sync = {
    available: true,
    linked: true,
    account: { user: { id: "self" } },
    role: "editor",
    accountChecked: true,
    status: { connection, error: null, peers },
    otherPeers: peers,
  } as unknown as ProjectSync;
  createRoot(slot).render(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <ProjectSyncPresence sync={sync} />
    </MantineProvider>,
  );
}
