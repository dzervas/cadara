import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Button,
  Divider,
  FocusTrap,
  Group,
  Paper,
  Portal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { AccountPanelProps } from "./account-menu";
import { WorkbenchIcon } from "@/components/ui/workbench-icon";

export interface SignInModalProps extends AccountPanelProps {
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
    const pill = `inset(${(from.height - 34) / 2}px ${(from.width - 150) / 2}px round 17px)`;
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
          <Paper
            role="dialog"
            aria-modal="true"
            aria-label="Sign in to CADara"
            className="relative grid w-full max-w-[760px] grid-cols-1 overflow-hidden rounded-2xl sm:grid-cols-[300px_1fr]"
            style={{
              background: "var(--workbench-shell-overlay-strong)",
              border: "1px solid var(--workbench-shell-border)",
              boxShadow: "var(--workbench-panel-shadow)",
            }}
          >
            <Stack
              p="xl"
              gap="xl"
              style={{ background: "var(--workbench-shell-surface)" }}
            >
              <Group gap="sm">
                <Text
                  fw={700}
                  aria-hidden="true"
                  c="var(--workbench-spark-accent)"
                >
                  C
                </Text>
                <Text fw={600}>CADara</Text>
              </Group>
              {props.pendingEmail ? (
                <Stack gap="sm">
                  <Text size="sm" role="status">
                    Email sent to {props.pendingEmail}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Your email holds a code and a link. Use either to sign in.
                  </Text>
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    disabled={props.busy}
                    onClick={props.onChangeEmail}
                  >
                    Change email
                  </Button>
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    disabled={props.busy}
                    onClick={() => props.onMagicLink(props.pendingEmail!)}
                  >
                    Resend email
                  </Button>
                </Stack>
              ) : (
                <Stack gap="lg">
                  {[
                    [
                      "Sync your projects",
                      "Pick up where you left off, on any device.",
                    ],
                    ["Share your work", "Send a link, not a file."],
                    ["Collaborate", "Work together in the same project."],
                  ].map(([title, body]) => (
                    <div key={title}>
                      <Text size="sm" fw={500}>
                        {title}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {body}
                      </Text>
                    </div>
                  ))}
                </Stack>
              )}
              <Text size="xs" c="dimmed">
                Your local projects work without an account.
              </Text>
            </Stack>
            <Stack p="xl" gap="md" mih={420}>
              <ActionIcon
                aria-label="Close sign in"
                variant="subtle"
                className="absolute top-3 right-3"
                onClick={dismiss}
              >
                <WorkbenchIcon name="close" size={14} />
              </ActionIcon>
              <div>
                <Text component="h2" fz={20} fw={600} mt="sm">
                  {props.pendingEmail ? "Enter your code" : "Sign in to CADara"}
                </Text>
                <Text size="sm" c="dimmed">
                  Sync, share and collaborate
                </Text>
              </div>
              {props.errorMessage && (
                <Text size="xs" c="red" role="alert">
                  {props.errorMessage}
                </Text>
              )}
              {props.offline && (
                <Text size="xs" c="dimmed" role="status">
                  Account offline · unable to check your session.
                </Text>
              )}
              {props.pendingEmail ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (code.length === 6) props.onVerifyCode(code);
                  }}
                >
                  <Stack>
                    <TextInput
                      key="code"
                      data-autofocus
                      aria-label="Sign-in code"
                      autoComplete="one-time-code"
                      inputMode="numeric"
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
                          letterSpacing: ".5em",
                          textAlign: "center",
                        },
                      }}
                    />
                    <Button
                      type="submit"
                      disabled={props.busy || code.length !== 6}
                      loading={props.busy}
                    >
                      Verify and sign in
                    </Button>
                  </Stack>
                </form>
              ) : (
                <>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      props.onMagicLink(email.trim());
                    }}
                  >
                    <Group align="end" gap="xs" wrap="nowrap">
                      <TextInput
                        key="email"
                        data-autofocus
                        aria-label="Email"
                        type="email"
                        required
                        autoComplete="username webauthn"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(event) =>
                          setEmail(event.currentTarget.value)
                        }
                        disabled={props.busy}
                        style={{ flex: 1 }}
                      />
                      <Button
                        type="submit"
                        disabled={props.busy || !email.trim()}
                        loading={props.busy}
                      >
                        Continue
                      </Button>
                    </Group>
                  </form>
                  <Divider label="or" labelPosition="center" />
                  <Button
                    variant="default"
                    disabled={props.busy}
                    onClick={() => props.onSocial("github")}
                  >
                    Continue with GitHub
                  </Button>
                  <Button
                    variant="default"
                    disabled={props.busy}
                    onClick={() => props.onSocial("google")}
                  >
                    Continue with Google
                  </Button>
                  {passkeyAvailable && (
                    <Button
                      variant="default"
                      disabled={props.busy}
                      onClick={props.onPasskey}
                    >
                      Sign in with passkey
                    </Button>
                  )}
                </>
              )}
              <Button
                variant="subtle"
                size="compact-sm"
                mt="auto"
                onClick={dismiss}
              >
                Continue as guest →
              </Button>
            </Stack>
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
          </Paper>
        </FocusTrap>
      </div>
    </Portal>
  );
}
