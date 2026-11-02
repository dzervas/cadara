import { useState } from "react";
import type { Account } from "@/contracts/account/account";
import {
  canLeaveProject,
  ownsOrganization,
} from "@/core/account/project-people-view";
import type { ProjectAccess } from "@/hooks/use-project-access";
import { ProjectPeopleSection } from "./project-people-section";
import { ProjectLinksSection } from "./project-links-section";

/** The People section bound to a loaded project, as the page and dialog show it. */
export function ProjectAccessPeople({
  access,
  account,
  orgId,
  onLeft,
  onChangePlan,
}: {
  access: ProjectAccess;
  account: Account | null;
  orgId: string;
  /** Opens Usage & plan in place; without it Change plan opens a new tab. */
  onChangePlan?: () => void;
  /** The user left the project and no longer has access. */
  onLeft: () => void;
}) {
  // Read once per mount: expiry labels are whole days.
  const [now] = useState(() => Date.now());
  if (!access.people) return null;
  return (
    <ProjectPeopleSection
      people={access.people}
      userId={account?.user.id ?? null}
      canLeave={canLeaveProject(account, orgId)}
      ownsPlan={ownsOrganization(account, orgId)}
      busy={access.busy}
      failure={access.failure}
      now={now}
      onChangePlan={onChangePlan}
      onInvite={access.invite}
      onResendInvite={(id) => void access.resendInvite(id)}
      onRevokeInvite={(id) => void access.revokeInvite(id)}
      onSetRole={(userId, role) => void access.setRole(userId, role)}
      onRemovePerson={(userId) => void access.removePerson(userId)}
      onLeave={() =>
        void access.leave().then((left) => {
          if (left) onLeft();
        })
      }
    />
  );
}

/** The Links section bound to a loaded project. */
export function ProjectAccessLinks({ access }: { access: ProjectAccess }) {
  if (!access.details || !access.people) return null;
  return (
    <ProjectLinksSection
      enabled={access.details.share_links_enabled}
      canManage={access.people.can_manage}
      published={access.shareableFile !== null}
      publishedError={access.versionsError}
      link={access.shareLink}
      busy={access.busy}
      failure={access.failure}
      onSetEnabled={(enabled) => void access.setShareLinksEnabled(enabled)}
      onRotate={() => void access.rotateShareLinks()}
      onMakeLink={access.makeShareLink}
    />
  );
}
