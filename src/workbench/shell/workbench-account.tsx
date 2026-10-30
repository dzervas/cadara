import { useState } from "react";
import { AccountMenu } from "@/components/layout/account-menu";
import { useAccountSession } from "@/hooks/use-account-session";
import { createBrowserSession } from "@/infrastructure/account/browser-session";
import { getAccountApiOrigin } from "@/infrastructure/account/api-origin";

export function WorkbenchAccount({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const [session] = useState(() =>
    createBrowserSession({
      apiOrigin: getAccountApiOrigin(),
      callbackURL: new URL("/app", window.location.origin).href,
    }),
  );
  return <AccountMenu {...useAccountSession(session, onError)} />;
}
