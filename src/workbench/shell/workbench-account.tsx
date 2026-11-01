import { useCallback, useEffect, useState } from "react";
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

export function WorkbenchAccount({
  onError,
}: {
  onError: (message: string) => void;
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
      />
      {signInOpened && !session.account && (
        <SignInModal {...session} onGuest={closeSignIn} />
      )}
    </>
  );
}
