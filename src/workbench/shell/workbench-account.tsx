import { useEffect, useState } from "react";
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
  // The account menu holds the sign-in options, so it answers sign-in requests.
  useEffect(
    () =>
      answerSignInRequests(() => {
        setOpened(true);
        refreshSession();
      }),
    [answerSignInRequests, refreshSession],
  );
  return (
    <AccountMenu {...session} opened={opened} onOpenedChange={setOpened} />
  );
}
