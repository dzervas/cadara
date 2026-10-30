import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionPort } from "@/application/account/session-port";
import {
  hydrateAccountSession,
  signInAccountWithPasskey,
  type AccountSessionState,
} from "@/application/account/account-session";
import { normalizeUnknownError } from "@/contracts/errors";
import { useErrorReporter } from "./use-error-reporter";

export function useAccountSession(
  port: SessionPort,
  notifyError: (message: string) => void,
) {
  const reporter = useErrorReporter();
  const generation = useRef(0);
  const operationPending = useRef(false);
  const [{ account, offline }, setSession] = useState<AccountSessionState>({
    account: null,
    offline: false,
  });
  const [callbackError] = useState(() =>
    new URL(window.location.href).searchParams.has("accountError")
      ? "Sign-in failed. The link may have expired; request a new one."
      : null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(
    callbackError,
  );
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [passkeyRegistered, setPasskeyRegistered] = useState(false);
  const report = useCallback(
    (error: unknown, visibility: "user" | "developer" = "user") => {
      const appError = normalizeUnknownError(error, {
        code: "app/operation-failed",
        fallbackMessage: "Account request failed. Try again.",
      });
      reporter.report(appError, {
        source: "account",
        visibility,
        attachActiveDocumentPayload: false,
      });
      return appError.message;
    },
    [reporter],
  );
  const showError = (error: unknown) => {
    const message = report(error);
    setErrorMessage(message);
    notifyError(message);
  };
  useEffect(() => {
    let active = true;
    const requestGeneration = generation.current;
    void hydrateAccountSession(port)
      .then((next) => {
        if (active && generation.current === requestGeneration) {
          setSession(next);
        }
      })
      .catch((error: unknown) => {
        if (active && generation.current === requestGeneration) {
          setSession((current) => ({ ...current, offline: true }));
          report(error, "developer");
        }
      });
    return () => {
      active = false;
    };
  }, [port, report]);
  useEffect(() => {
    if (!callbackError) return;
    notifyError(report(new Error(callbackError)));
    const url = new URL(window.location.href);
    url.searchParams.delete("accountError");
    window.history.replaceState(null, "", url);
  }, [callbackError, notifyError, report]);
  const run = (operation: () => Promise<void>, clearError = true) => {
    if (operationPending.current) return;
    operationPending.current = true;
    generation.current += 1;
    setBusy(true);
    if (clearError) setErrorMessage(null);
    void operation()
      .catch(showError)
      .finally(() => {
        operationPending.current = false;
        setBusy(false);
      });
  };
  return {
    account,
    offline,
    errorMessage,
    onOpen: () =>
      run(async () => {
        try {
          setSession(await hydrateAccountSession(port));
        } catch (error) {
          setSession((current) => ({ ...current, offline: true }));
          throw error;
        }
      }, false),
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
        setSession(await signInAccountWithPasskey(port));
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
        setSession({ account: null, offline: false });
        setPendingEmail(null);
        setPasskeyRegistered(false);
      }),
  };
}
