import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionPort } from "@/application/account/session-port";
import {
  ACCOUNT_SESSION_CHANGED,
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
  const [accountChecked, setAccountChecked] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  // Epoch ms at which the server will accept another sign-in email.
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(
    null,
  );
  const [passkeyRegistered, setPasskeyRegistered] = useState(false);
  const report = useCallback(
    (error: unknown, visibility: "user" | "developer" | "silent" = "user") => {
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
          // An unreachable account service is a normal local-only state, not an
          // application error: the menu shows "offline" and retries on demand.
          report(error, "silent");
        }
      })
      .finally(() => {
        if (active) setAccountChecked(true);
      });
    const refresh = () => {
      if (operationPending.current) return;
      const refreshGeneration = generation.current;
      void hydrateAccountSession(port)
        .then((next) => {
          if (active && generation.current === refreshGeneration)
            setSession(next);
        })
        .catch((error: unknown) => report(error, "silent"));
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === ACCOUNT_SESSION_CHANGED) refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storageChanged);
    window.addEventListener(ACCOUNT_SESSION_CHANGED, refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener(ACCOUNT_SESSION_CHANGED, refresh);
    };
  }, [port, report]);
  useEffect(() => {
    if (!callbackError) return;
    notifyError(report(new Error(callbackError)));
    const url = new URL(window.location.href);
    url.searchParams.delete("accountError");
    window.history.replaceState(null, "", url);
  }, [callbackError, notifyError, report]);
  // An in-place sign-in finishes the email step and tells the other tabs.
  const signedIn = (next: AccountSessionState) => {
    setSession(next);
    setPendingEmail(null);
    window.localStorage.setItem(ACCOUNT_SESSION_CHANGED, String(Date.now()));
    window.dispatchEvent(new Event(ACCOUNT_SESSION_CHANGED));
  };
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
    accountChecked,
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
    resendAvailableAt,
    passkeyRegistered,
    onMagicLink: (email: string) =>
      run(async () => {
        const { resendAfterSeconds } = await port.requestMagicLink(email);
        setPendingEmail(email);
        setResendAvailableAt(Date.now() + resendAfterSeconds * 1000);
      }),
    onChangeEmail: () => setPendingEmail(null),
    onVerifyCode: (code: string) =>
      run(async () => {
        if (!pendingEmail) return;
        await port.redeemEmailCode(pendingEmail, code);
        signedIn(await hydrateAccountSession(port));
      }),
    onSocial: (provider: "google" | "github") =>
      run(() => port.signInSocial(provider)),
    onPasskey: () =>
      run(async () => {
        signedIn(await signInAccountWithPasskey(port));
      }),
    onPasskeyAutofill: async () => {
      try {
        await port.signInPasskey({ autoFill: true });
        signedIn(await hydrateAccountSession(port));
      } catch (error) {
        // Conditional UI can be cancelled by another credential request.
        report(error, "silent");
      }
    },
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
