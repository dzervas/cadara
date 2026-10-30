import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionPort } from "@/application/account/session-port";
import type { Account } from "@/contracts/account/account";
import { normalizeUnknownError } from "@/contracts/errors";
import { useErrorReporter } from "./use-error-reporter";

export function useAccountSession(port: SessionPort) {
  const reporter = useErrorReporter();
  const generation = useRef(0);
  const operationPending = useRef(false);
  const [offline, setOffline] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [passkeyRegistered, setPasskeyRegistered] = useState(false);
  const report = useCallback(
    (error: unknown, visibility: "user" | "developer" = "user") => {
      reporter.report(
        normalizeUnknownError(error, {
          code: "app/operation-failed",
          fallbackMessage: "Account request failed. Try again.",
        }),
        { source: "account", visibility, attachActiveDocumentPayload: false },
      );
    },
    [reporter],
  );
  useEffect(() => {
    let active = true;
    const requestGeneration = generation.current;
    void port
      .getAccount()
      .then((next) => {
        if (active && generation.current === requestGeneration) {
          setAccount(next);
          setOffline(false);
        }
      })
      .catch((error: unknown) => {
        if (active && generation.current === requestGeneration) {
          setOffline(true);
          report(error, "developer");
        }
      });
    return () => {
      active = false;
    };
  }, [port, report]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("accountError")) {
      report(
        new Error(
          "Sign-in failed. The link may have expired; request a new one.",
        ),
      );
      url.searchParams.delete("accountError");
      window.history.replaceState(null, "", url);
    }
  }, [report]);
  const run = (operation: () => Promise<void>) => {
    if (operationPending.current) return;
    operationPending.current = true;
    generation.current += 1;
    setBusy(true);
    void operation()
      .catch((error: unknown) => report(error))
      .finally(() => {
        operationPending.current = false;
        setBusy(false);
      });
  };
  return {
    account,
    offline,
    onOpen: () =>
      run(async () => {
        try {
          setAccount(await port.getAccount());
          setOffline(false);
        } catch (error) {
          setOffline(true);
          throw error;
        }
      }),
    busy,
    pendingEmail,
    passkeyRegistered,
    onMagicLink: (email: string) =>
      run(async () => {
        await port.requestMagicLink(email);
        setPendingEmail(email);
      }),
    onSocial: (provider: "google" | "github") =>
      run(() => port.signInSocial(provider)),
    onPasskey: () =>
      run(async () => {
        await port.signInPasskey();
        setAccount(await port.getAccount());
        setPendingEmail(null);
      }),
    onRegisterPasskey: () =>
      run(async () => {
        await port.registerPasskey();
        setPasskeyRegistered(true);
      }),
    onSignOut: () =>
      run(async () => {
        await port.signOut();
        setAccount(null);
        setOffline(false);
        setPendingEmail(null);
        setPasskeyRegistered(false);
      }),
  };
}
