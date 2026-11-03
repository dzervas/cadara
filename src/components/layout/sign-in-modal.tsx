import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Button,
  Divider,
  FocusTrap,
  Portal,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import type { AccountPanelProps } from "./account-menu";
import { WorkbenchIcon } from "@/components/ui/workbench-icon";

const benefits = [
  ["Sync", "Projects follow you to any browser."],
  ["Share", "Invite people with a role, or share a link."],
  ["Local stays local", "On-device projects never leave this machine."],
] as const;

function GoogleGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M16.5 10.2c0 3.7-2.6 6.3-6.4 6.3a6.5 6.5 0 1 1 4.4-11.3" />
      <path d="M10.4 10.1h6" />
    </svg>
  );
}

function PasskeyGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7.5" cy="6" r="3" />
      <path d="M2.5 16.5v-.8A4.2 4.2 0 0 1 6.7 11.5h1.6" />
      <circle cx="14" cy="11" r="2" />
      <path d="M14 13v4.5m0-2h1.6" />
    </svg>
  );
}

function ProviderButton(props: {
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <UnstyledButton
      fz={13}
      px={12}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex h-9 items-center gap-3 rounded-[8px] font-medium transition-colors hover:bg-white/5 disabled:opacity-40"
      style={{ border: "1px solid var(--workbench-shell-border)" }}
    >
      <span style={{ color: "var(--workbench-shell-text-muted)" }}>
        {props.icon}
      </span>
      {props.children}
    </UnstyledButton>
  );
}

/** Whole seconds until `at`, re-evaluated every second while positive. */
function useSecondsUntil(at: number | null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (at === null) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= at) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [at]);
  return at === null ? 0 : Math.max(0, Math.ceil((at - now) / 1000));
}

function TextLink(props: {
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <UnstyledButton
      fz={12}
      disabled={props.disabled}
      onClick={props.onClick}
      className="transition-colors hover:text-[var(--workbench-shell-text)] disabled:opacity-40"
      style={{ color: "var(--workbench-shell-text-muted)" }}
    >
      {props.children}
    </UnstyledButton>
  );
}

export interface SignInModalProps extends AccountPanelProps {
  /** Epoch ms from which the server accepts another sign-in email. */
  resendAvailableAt: number | null;
  onGuest(): void;
  onChangeEmail(): void;
  onVerifyCode(code: string): void;
  onPasskeyAutofill(): Promise<void>;
}

export function SignInModal(props: SignInModalProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [minimizing, setMinimizing] = useState(false);
  const resendIn = useSecondsUntil(props.resendAvailableAt);
  const card = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement);
  const autofill = useRef(props.onPasskeyAutofill);
  useEffect(() => {
    let active = true;
    const restoreFocus = previousFocus.current;
    if (
      typeof PublicKeyCredential !== "undefined" &&
      PublicKeyCredential.isConditionalMediationAvailable
    ) {
      void PublicKeyCredential.isConditionalMediationAvailable().then(
        (available) => {
          if (active) {
            setPasskeyAvailable(available);
            if (available) void autofill.current();
          }
        },
        () => {
          if (active) setPasskeyAvailable(false);
        },
      );
    }
    return () => {
      active = false;
      if (restoreFocus instanceof HTMLElement) restoreFocus.focus();
    };
  }, []);
  const dismiss = () => {
    if (minimizing || !card.current) return;
    setMinimizing(true);
  };
  useEffect(() => {
    if (!minimizing || !card.current) return;
    const element = card.current;
    const from = element.getBoundingClientRect();
    const target = document
      .querySelector('[aria-label="Account"]')
      ?.getBoundingClientRect();
    const dx =
      (target ? target.left + target.width / 2 : window.innerWidth - 36) -
      (from.left + from.width / 2);
    const dy =
      (target ? target.top + target.height / 2 : 32) -
      (from.top + from.height / 2);
    const pill = `inset(${(from.height - 34) / 2}px ${(from.width - 160) / 2}px round 17px)`;
    const animation = element.animate(
      [
        { clipPath: "inset(0px round 16px)", transform: "none", opacity: 1 },
        { clipPath: pill, transform: "none", opacity: 1, offset: 0.42 },
        {
          clipPath: pill,
          transform: `translate(${dx * 0.35}px, ${dy * 0.8}px) scale(.6)`,
          opacity: 1,
          offset: 0.72,
        },
        {
          clipPath: pill,
          transform: `translate(${dx}px, ${dy}px) scale(.2)`,
          opacity: 0,
        },
      ],
      {
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 1
          : 640,
        fill: "forwards",
        easing: "ease-in-out",
      },
    );
    animation.onfinish = props.onGuest;
    return () => animation.cancel();
  }, [minimizing, props.onGuest]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setMinimizing(true);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, []);
  return (
    <Portal>
      <div
        data-sign-in-backdrop=""
        className="fixed inset-0 grid place-items-center p-4"
        style={{
          zIndex: 400,
          background:
            "color-mix(in srgb, var(--workbench-shell-surface) 58%, transparent)",
          backdropFilter: "blur(7px)",
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget) dismiss();
        }}
      >
        <FocusTrap active innerRef={card}>
          {/* A plain div: Mantine Paper's own `display: block` outranks the
              layered Tailwind `grid` utility and stacks the two columns. */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Sign in to CADara"
            className="relative grid h-[452px] w-full max-w-[760px] grid-cols-[300px_1fr] overflow-hidden rounded-2xl"
            style={{
              background: "var(--workbench-shell-overlay-strong)",
              border: "1px solid var(--workbench-glass-border-strong)",
              boxShadow: "var(--workbench-panel-shadow)",
            }}
          >
            {/* Left: what an account gives you; the sent email on the code step. */}
            <div
              className="flex flex-col justify-between p-7"
              style={{
                background: "var(--workbench-shell-surface)",
                borderRight: "1px solid var(--workbench-glass-divider)",
              }}
            >
              <div>
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-[11px] font-bold"
                    style={{
                      background: "var(--workbench-spark-accent)",
                      color: "var(--workbench-spark-accent-ink)",
                      boxShadow: "var(--workbench-spark-logo-shadow)",
                    }}
                  >
                    C
                  </span>
                  <span className="text-[13px] font-semibold tracking-tight">
                    CADara
                  </span>
                </div>
                {props.pendingEmail ? (
                  <div className="mt-9">
                    <div role="status">
                      <div
                        className="text-[11px] font-semibold tracking-[0.18em] uppercase"
                        style={{ color: "var(--workbench-shell-text-dim)" }}
                      >
                        Email sent to
                      </div>
                      <div className="mt-2 text-[13px] font-medium break-all">
                        {props.pendingEmail}
                      </div>
                    </div>
                    <p
                      className="mt-3 mb-0 text-[12px] leading-normal"
                      style={{ color: "var(--workbench-shell-text-muted)" }}
                    >
                      It holds a code and a link. Either one signs this tab in;
                      the link can be opened anywhere.
                    </p>
                    <div className="mt-5 flex flex-col items-start gap-1.5">
                      <TextLink
                        disabled={props.busy}
                        onClick={props.onChangeEmail}
                      >
                        Change email
                      </TextLink>
                      <TextLink
                        disabled={props.busy || resendIn > 0}
                        onClick={() => props.onMagicLink(props.pendingEmail!)}
                      >
                        {resendIn > 0
                          ? `Resend in 0:${`${resendIn}`.padStart(2, "0")}`
                          : "Resend email"}
                      </TextLink>
                    </div>
                  </div>
                ) : (
                  <ul className="m-0 mt-9 flex list-none flex-col gap-5 p-0">
                    {benefits.map(([title, body]) => (
                      <li key={title} className="flex gap-3">
                        <span
                          className="mt-[3px]"
                          style={{ color: "var(--workbench-shell-text-dim)" }}
                        >
                          <WorkbenchIcon name="check" size={14} />
                        </span>
                        <span>
                          <span className="block text-[13px] font-medium">
                            {title}
                          </span>
                          <span
                            className="block text-[12px] leading-normal"
                            style={{
                              color: "var(--workbench-shell-text-muted)",
                            }}
                          >
                            {body}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div
                className="font-mono text-[11px]"
                style={{ color: "var(--workbench-shell-text-dim)" }}
              >
                Free · 1 GB · 5 private projects
              </div>
            </div>

            {/* Right: the form. */}
            <div className="relative flex flex-col px-9 pt-9 pb-6">
              <div className="absolute top-3 right-3">
                <ActionIcon
                  aria-label="Close sign in"
                  variant="subtle"
                  color="workbench"
                  size={26}
                  onClick={dismiss}
                >
                  <WorkbenchIcon name="close" size={14} />
                </ActionIcon>
              </div>
              <h2 className="m-0 text-[20px] leading-tight font-semibold">
                {props.pendingEmail ? "Enter your code" : "Sign in to CADara"}
              </h2>
              <p
                className="mt-1.5 mb-0 text-[13px]"
                style={{ color: "var(--workbench-shell-text-muted)" }}
              >
                {props.pendingEmail
                  ? "Six digits, valid for 5 minutes."
                  : "Sync, share and collaborate"}
              </p>
              {props.errorMessage && (
                <Text size="xs" c="red" mt="sm" role="alert">
                  {props.errorMessage}
                </Text>
              )}
              {props.offline && (
                <Text size="xs" c="dimmed" mt="sm" role="status">
                  Account offline · unable to check your session.
                </Text>
              )}
              {props.pendingEmail ? (
                <form
                  className="mt-6 flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (code.length === 6) props.onVerifyCode(code);
                  }}
                >
                  <TextInput
                    key="code"
                    data-autofocus
                    aria-label="Sign-in code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    placeholder="000000"
                    value={code}
                    onChange={(event) =>
                      setCode(
                        event.currentTarget.value
                          .replace(/\D/g, "")
                          .slice(0, 6),
                      )
                    }
                    disabled={props.busy}
                    styles={{
                      input: {
                        height: 52,
                        fontFamily: "var(--mantine-font-family-monospace)",
                        fontSize: 24,
                        letterSpacing: "0.55em",
                        textAlign: "center",
                        paddingLeft: "0.55em",
                      },
                    }}
                  />
                  <Button
                    type="submit"
                    fullWidth
                    h={36}
                    color="workbench.0"
                    autoContrast
                    disabled={props.busy || code.length !== 6}
                    loading={props.busy}
                  >
                    Verify and sign in
                  </Button>
                </form>
              ) : (
                <>
                  <form
                    className="mt-6 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      props.onMagicLink(email.trim());
                    }}
                  >
                    <TextInput
                      key="email"
                      data-autofocus
                      className="flex-1"
                      aria-label="Email"
                      type="email"
                      required
                      autoComplete="username webauthn"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.currentTarget.value)}
                      disabled={props.busy}
                      styles={{ input: { height: 36 } }}
                    />
                    <Button
                      type="submit"
                      h={36}
                      color="workbench.0"
                      autoContrast
                      disabled={props.busy || !email.trim()}
                      loading={props.busy}
                    >
                      Continue
                    </Button>
                  </form>
                  <Divider
                    my={20}
                    label="or"
                    labelPosition="center"
                    color="var(--workbench-shell-divider)"
                    styles={{
                      label: {
                        color: "var(--workbench-shell-text-dim)",
                        fontSize: 11,
                      },
                    }}
                  />
                  <div className="flex flex-col gap-1.5">
                    <ProviderButton
                      icon={<WorkbenchIcon name="github" size={16} />}
                      disabled={props.busy}
                      onClick={() => props.onSocial("github")}
                    >
                      Continue with GitHub
                    </ProviderButton>
                    <ProviderButton
                      icon={<GoogleGlyph />}
                      disabled={props.busy}
                      onClick={() => props.onSocial("google")}
                    >
                      Continue with Google
                    </ProviderButton>
                    {passkeyAvailable && (
                      <ProviderButton
                        icon={<PasskeyGlyph />}
                        disabled={props.busy}
                        onClick={props.onPasskey}
                      >
                        Sign in with passkey
                      </ProviderButton>
                    )}
                  </div>
                </>
              )}
              <div className="mt-auto flex justify-end">
                <UnstyledButton
                  fz={12}
                  onClick={dismiss}
                  className="transition-colors hover:text-[var(--workbench-shell-text-muted)]"
                  style={{ color: "var(--workbench-shell-text-dim)" }}
                >
                  Continue as guest →
                </UnstyledButton>
              </div>
            </div>
            {minimizing && (
              <div
                className="absolute inset-0 grid place-items-center"
                style={{
                  background: "var(--workbench-shell-surface-panel-elev)",
                }}
              >
                <Text size="xs" fw={600}>
                  Continuing as guest
                </Text>
              </div>
            )}
          </div>
        </FocusTrap>
      </div>
    </Portal>
  );
}
