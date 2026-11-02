import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectAccessPort } from "@/application/account/project-access-port";
import { ACCOUNT_SESSION_CHANGED } from "@/application/account/account-session";
import type { ProjectRole } from "@/contracts/account/account";
import type {
  ProjectDetails,
  ProjectPeople,
} from "@/contracts/account/project-access";
import { latestShareableFile } from "@/core/account/project-people-view";
import type { ProjectServiceLink } from "@/contracts/modeling/project-manifest";

/** Which part of the sharing UI a failed change explains itself in. */
export type ProjectAccessArea = "invite" | "people" | "links" | "danger";

export interface ProjectAccessFailure {
  area: ProjectAccessArea;
  error: Error;
}

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Loads one account project's details and people and runs sharing changes,
 * reloading after each so the lists show what the service holds. A failed
 * reload after a change shows as that change's failure.
 */
export function useProjectAccess(
  port: ProjectAccessPort,
  link: ProjectServiceLink | null,
) {
  const orgId = link?.orgId ?? null,
    projectId = link?.projectId ?? null;
  const key = orgId && projectId ? `${orgId}/${projectId}` : null;
  const [loaded, setLoaded] = useState<{
    key: string;
    details: ProjectDetails;
    people: ProjectPeople;
    shareableFile: ReturnType<typeof latestShareableFile>;
    /** Why the published versions could not be read; Links shows it. */
    versionsError: string | null;
  } | null>(null);
  // A minted link; any change to links (off, on, rotate) invalidates it.
  const [shareLink, setShareLink] = useState<{
    key: string;
    url: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [failure, setFailure] = useState<
    (ProjectAccessFailure & { key: string }) | null
  >(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(key);

  const fetchAccess = useCallback(
    async (target: ProjectServiceLink) => {
      // Versions only feed Copy link: their failure stays inside Links.
      const [details, people, versions] = await Promise.all([
        port.getProject(target),
        port.listPeople(target),
        port.listVersions(target).then(
          (list) => ({ file: latestShareableFile(list), error: null }),
          (error: unknown) => ({ file: null, error: asError(error).message }),
        ),
      ]);
      return {
        key: `${target.orgId}/${target.projectId}`,
        details,
        people,
        shareableFile: versions.file,
        versionsError: versions.error,
      };
    },
    [port],
  );
  useEffect(() => {
    latest.current = key;
    if (!orgId || !projectId) return;
    let live = true;
    void fetchAccess({ orgId, projectId }).then(
      (next) => {
        if (!live) return;
        setLoaded(next);
        setLoadError(null);
      },
      (error: unknown) => {
        if (live)
          setLoadError({
            key: `${orgId}/${projectId}`,
            message: asError(error).message,
          });
      },
    );
    return () => {
      live = false;
    };
  }, [key, orgId, projectId, fetchAccess]);

  /** Runs a change; returns whether it succeeded, keeping the failure visible. */
  const perform = async (
    area: ProjectAccessArea,
    change: (link: ProjectServiceLink) => Promise<unknown>,
    { reloadAfter = true } = {},
  ) => {
    if (!key || !orgId || !projectId) return false;
    setBusy(true);
    setFailure(null);
    try {
      await change({ orgId, projectId });
      if (reloadAfter) {
        const next = await fetchAccess({ orgId, projectId });
        if (latest.current === next.key) setLoaded(next);
      }
      return true;
    } catch (error) {
      setFailure({ key, area, error: asError(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const current = loaded && loaded.key === key ? loaded : null;
  return {
    details: current?.details ?? null,
    people: current?.people ?? null,
    loadError: loadError && loadError.key === key ? loadError.message : null,
    failure: failure && failure.key === key ? failure : null,
    busy,
    invite: (email: string, role: ProjectRole) =>
      perform("invite", (target) => port.invite(target, email, role)),
    resendInvite: (inviteId: string) =>
      perform("people", (target) => port.resendInvite(target, inviteId)),
    revokeInvite: (inviteId: string) =>
      perform("people", (target) => port.revokeInvite(target, inviteId)),
    setRole: (userId: string, role: ProjectRole) =>
      perform("people", (target) => port.setRole(target, userId, role)),
    removePerson: (userId: string) =>
      perform("people", (target) => port.removePerson(target, userId)),
    // Leaving or deleting ends access: there is nothing left to reload.
    leave: () =>
      perform(
        "people",
        async (target) => {
          await port.leave(target);
          // Leaving a last shared project ends the membership it came with:
          // every tab reloads the account.
          window.localStorage.setItem(
            ACCOUNT_SESSION_CHANGED,
            String(Date.now()),
          );
          window.dispatchEvent(new Event(ACCOUNT_SESSION_CHANGED));
        },
        { reloadAfter: false },
      ),
    shareableFile: current?.shareableFile ?? null,
    versionsError: current?.versionsError ?? null,
    shareLink: shareLink && shareLink.key === key ? shareLink.url : null,
    setShareLinksEnabled: (enabled: boolean) =>
      perform("links", async (target) => {
        setShareLink(null);
        await port.setShareLinksEnabled(target, enabled);
      }),
    rotateShareLinks: () =>
      perform("links", async (target) => {
        setShareLink(null);
        await port.rotateShareLinks(target);
      }),
    /** Mints a link to the latest published version; resolves to its URL. */
    makeShareLink: async () => {
      const file = current?.shareableFile;
      if (!key || !file) return null;
      const minted = { url: null as string | null };
      await perform(
        "links",
        async (target) => {
          // Minting while links are off would turn them back on: another
          // admin may have switched them off since this page loaded.
          const next = await fetchAccess(target);
          if (latest.current === next.key) setLoaded(next);
          if (!next.details.share_links_enabled)
            throw new Error(
              "Links were turned off. Turn them on to copy a link.",
            );
          const { url } = await port.mintShareLink(
            target,
            file.versionId,
            file.fileName,
          );
          minted.url = url;
          setShareLink({ key, url });
        },
        { reloadAfter: false },
      );
      return minted.url;
    },
    deleteProject: () =>
      perform("danger", (target) => port.deleteProject(target), {
        reloadAfter: false,
      }),
  };
}

export type ProjectAccess = ReturnType<typeof useProjectAccess>;
