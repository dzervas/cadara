import { useCallback, useEffect, useMemo, useState } from "react";
import { CreateTeamModal } from "@/components/account/create-team-modal";
import { rememberChosenOrganization } from "@/core/account/account-teams";
import { getAccountApiOrigin } from "@/infrastructure/account/api-origin";
import { createOrganizationHttpClient } from "@/infrastructure/account/organizations";
import {
  CHECKOUT_FAILED_MEMBERS_PATH,
  useCreateTeam,
} from "@/hooks/use-create-team";
import { SignInModal } from "@/components/layout/sign-in-modal";
import { useIdleSignIn } from "@/hooks/use-idle-sign-in";
import { SIGN_IN_OFFER_KEY } from "@/application/account/sign-in-offer";
import {
  selectEditorIdle,
  useEditorStateSelector,
} from "@/hooks/editor-state-store";
import { AccountMenu } from "@/components/layout/account-menu";
import { useAccountSession } from "@/hooks/use-account-session";
import { useLatestCallbacks } from "@/hooks/use-latest-callbacks";
import { useSignInRequest } from "@/hooks/sign-in-request-context";
import { getWorkbenchSessionPort } from "./workbench-session";
import type { LocalDocumentOffers } from "@/application/account/local-document-offers";
import { WorkbenchLocalDocumentOffer } from "./workbench-local-document-offer";

export function WorkbenchAccount({
  onError,
  localDocumentOffers,
  localDocumentOfferSlot = null,
  localDocumentOfferHeld = false,
  localProject = false,
  onMoveToAccount,
}: {
  onError: (message: string) => void;
  localDocumentOffers?: LocalDocumentOffers;
  /** Where the offer card renders: the first row of the notifications column. */
  localDocumentOfferSlot?: HTMLElement | null;
  /** The Variables panel is open under the column: the offer waits, as for a tool. */
  localDocumentOfferHeld?: boolean;
  localProject?: boolean;
  onMoveToAccount?: () => void;
}) {
  const session = useAccountSession(getWorkbenchSessionPort(), onError);
  const [opened, setOpened] = useState(false);
  const { refreshSession } = useLatestCallbacks({
    refreshSession: session.onOpen,
  });
  const { answerSignInRequests } = useSignInRequest();
  const [signInOpened, setSignInOpened] = useState(false);
  const editorIdle = useEditorStateSelector(selectEditorIdle);
  const openSignIn = useCallback(() => {
    localStorage.setItem(SIGN_IN_OFFER_KEY, "1");
    setOpened(false);
    setSignInOpened(true);
  }, []);
  const closeSignIn = useCallback(() => setSignInOpened(false), []);
  const organizations = useMemo(
    () => createOrganizationHttpClient({ apiOrigin: getAccountApiOrigin() }),
    [],
  );
  const userId = session.account?.user.id;
  // Teams are managed on the dashboard, which opens on the new team.
  const createTeam = useCreateTeam(organizations, (organization, checkout) => {
    if (userId)
      rememberChosenOrganization(window.localStorage, userId, organization.id);
    window.location.assign(checkout ?? CHECKOUT_FAILED_MEMBERS_PATH);
  });
  // An unanswered or failed account check is not a signed-out guest.
  useIdleSignIn(
    session.accountChecked &&
      !session.offline &&
      !session.account &&
      editorIdle,
    openSignIn,
  );
  useEffect(
    () => answerSignInRequests(openSignIn),
    [answerSignInRequests, openSignIn],
  );

  return (
    <>
      <AccountMenu
        {...session}
        opened={opened && session.account !== null}
        onOpen={refreshSession}
        onSignOut={() => {
          closeSignIn();
          session.onSignOut();
        }}
        onOpenedChange={(next) => {
          if (next && !session.account) openSignIn();
          else setOpened(next);
        }}
        onCreateTeam={() => {
          setOpened(false);
          createTeam.open();
        }}
      />
      {session.account && <CreateTeamModal {...createTeam} />}
      {localDocumentOffers && localDocumentOfferSlot && onMoveToAccount && (
        <WorkbenchLocalDocumentOffer
          offers={localDocumentOffers}
          slot={localDocumentOfferSlot}
          held={localDocumentOfferHeld}
          local={localProject}
          account={session.account}
          accountChecked={session.accountChecked}
          offline={session.offline}
          onMove={onMoveToAccount}
        />
      )}
      {signInOpened && !session.account && (
        <SignInModal {...session} onGuest={closeSignIn} />
      )}
    </>
  );
}
