import { useEffect, useState } from "react";
import { Anchor, Center, Paper, Stack, Text } from "@mantine/core";
import { ACCOUNT_SESSION_CHANGED } from "@/application/account/account-session";
import type { SessionPort } from "@/application/account/session-port";

/** The emailed link ends here, without creating a second editor or document. */
export function SignInComplete({ session }: { session: SessionPort }) {
  const [message, setMessage] = useState("Checking your session…");
  // Names the account: a link someone else sent signs this browser in as them.
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void session
      .getAccount()
      .then((account) => {
        if (!active) return;
        if (!account) {
          setMessage("Sign-in failed. Request a new email.");
          return;
        }
        localStorage.setItem(ACCOUNT_SESSION_CHANGED, String(Date.now()));
        setEmail(account.user.email);
        setMessage("Signed in, you can close this tab");
      })
      .catch(() => {
        if (active)
          setMessage(
            "Unable to check your session. Try again when you are online.",
          );
      });
    return () => {
      active = false;
    };
  }, [session]);
  return (
    <Center h="100dvh">
      <Paper p="xl" withBorder>
        <Stack>
          <Stack gap={2}>
            <Text role="status">{message}</Text>
            {email && (
              <Text size="sm" c="dimmed">
                as {email}
              </Text>
            )}
          </Stack>
          <Anchor href="/app">Open CADara</Anchor>
        </Stack>
      </Paper>
    </Center>
  );
}
