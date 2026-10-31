import { Group } from "@mantine/core";
import { projectPresenceColor } from "@/theme/project-presence-colors";
import { useState } from "react";
import { projectSlugFromName } from "@/application/project-sync/project-service-use-cases";
import type { ProjectManifest } from "@/contracts/modeling/project-manifest";
import type { RemoteProject } from "@/contracts/project-sync/project-service";
import {
  OpenServiceProjectModal,
  ProjectServiceMenu,
  UploadProjectModal,
} from "@/components/layout/project-service-dialogs";
import {
  ProjectPresenceStrip,
  ProjectSyncIndicator,
} from "@/components/layout/project-sync-status";
import type { ProjectSync } from "./use-project-sync";

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** The project row's CADara menu, sync indicator and presence strip. */
export function ProjectSyncControls({
  sync,
  project,
  onOpened,
}: {
  sync: ProjectSync;
  project: ProjectManifest;
  /** Switches the workbench to a project opened from the service; false if it failed. */
  onOpened: (manifest: ProjectManifest) => Promise<boolean>;
}) {
  const [dialog, setDialog] = useState<"upload" | "open" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState("");
  const [remoteProjects, setRemoteProjects] = useState<RemoteProject[] | null>(
    null,
  );
  if (!sync.available) return null;
  const organizations = sync.account?.organizations ?? [];
  const show = (next: "upload" | "open") => {
    setError(null);
    setDialog(next);
  };
  const loadProjects = (id: string) => {
    setOrgId(id);
    setRemoteProjects(null);
    setError(null);
    sync.listProjects(id).then(setRemoteProjects, (failure: unknown) => {
      setRemoteProjects([]);
      setError(message(failure));
    });
  };
  const run = (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    operation()
      .then(() => setDialog(null))
      .catch((failure: unknown) => setError(message(failure)))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <ProjectServiceMenu
        signedIn={sync.accountChecked ? sync.account !== null : null}
        linked={sync.linked}
        busy={busy}
        onMenuOpen={() => void sync.refreshAccount()}
        onUpload={() => show("upload")}
        onOpen={() => {
          show("open");
          if (organizations[0]) loadProjects(organizations[0].id);
        }}
      />
      <UploadProjectModal
        opened={dialog === "upload"}
        organizations={organizations}
        defaultName={project.name}
        busy={busy}
        error={error}
        deriveSlug={projectSlugFromName}
        onCancel={() => setDialog(null)}
        onSubmit={(input) => run(() => sync.upload(input))}
      />
      <OpenServiceProjectModal
        opened={dialog === "open"}
        onClose={() => setDialog(null)}
        organizations={organizations}
        orgId={orgId}
        projects={
          remoteProjects?.map((remote) => ({
            id: remote.id,
            name: remote.name,
            available: remote.manifest_doc_id !== null,
          })) ?? null
        }
        busy={busy}
        error={error}
        onSelectOrganization={loadProjects}
        onOpen={(id) => {
          const remote = remoteProjects?.find((entry) => entry.id === id);
          if (!remote) return;
          run(async () => {
            const opened = await sync.openRemote(remote);
            // The switched-to project holds its own connection; a failed
            // switch leaves nothing syncing in the background.
            try {
              await onOpened(opened.manifest);
            } finally {
              opened.release();
            }
          });
        }}
      />
    </>
  );
}

/** Separate slot: service actions stay by the project picker, presence by utilities. */
export function ProjectSyncPresence({ sync }: { sync: ProjectSync }) {
  if (!sync.available || !sync.linked) return null;
  const seen = new Set<string>();
  const participants = sync.otherPeers
    .filter((peer) => {
      if (seen.has(peer.userId)) return false;
      seen.add(peer.userId);
      return true;
    })
    .map((peer) => ({
      key: peer.userId,
      name: peer.name,
      role: peer.role ?? null,
      color: projectPresenceColor(peer.userId),
    }));
  const signedOut = sync.accountChecked && !sync.account;
  // Before the first transport status a signed-in project is still
  // connecting; reporting it offline would flash the badge on every open.
  const connection =
    sync.status?.connection ?? (signedOut ? "offline" : "connecting");
  return (
    <Group
      gap={8}
      wrap="nowrap"
      data-project-presence-row=""
      data-project-sync-state={connection}
    >
      <ProjectSyncIndicator
        connection={connection}
        role={sync.role}
        failed={Boolean(sync.status?.error)}
        detail={
          sync.status?.error ??
          (signedOut ? "Sign in to CADara to sync this project." : null)
        }
      />
      <ProjectPresenceStrip participants={participants} />
    </Group>
  );
}
