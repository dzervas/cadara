import {
  Anchor,
  Box,
  Button,
  Divider,
  Group,
  List,
  NativeSelect,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useId, useRef, useState } from "react";

import { WorkbenchIcon } from "@/components/ui/workbench-icon";
import {
  copyRecoveryDiagnostics,
  detectRecoveryProfile,
  getRecoveryGuide,
  recoveryBrowsers,
  recoveryPlatforms,
} from "./webgl-recovery-guide";

export interface WebGlRecoveryPanelProps {
  diagnostics: string;
  onRetry: () => void;
}

const internalAddress = /^(chrome:\/\/gpu|edge:\/\/gpu|about:support)$/;

function GuideStep({ text }: { text: string }) {
  return text
    .split(/(chrome:\/\/gpu|edge:\/\/gpu|about:support)/)
    .map((part, index) =>
      internalAddress.test(part) ? (
        <Anchor
          key={index}
          href={part}
          c="inherit"
          underline="always"
          title="If your browser blocks this link, copy the address into a new tab."
        >
          {part}
        </Anchor>
      ) : (
        part
      ),
    );
}

/** Only guidance and local copy UI: retrying the renderer belongs to the caller. */
export function WebGlRecoveryPanel({
  diagnostics,
  onRetry,
}: WebGlRecoveryPanelProps) {
  const titleId = useId();
  const [profile, setProfile] = useState(() =>
    detectRecoveryProfile(
      typeof navigator === "undefined" ? "" : navigator.userAgent,
      typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
    ),
  );
  const [copyStatus, setCopyStatus] = useState("");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const diagnosticsRef = useRef<HTMLPreElement>(null);
  const guide = getRecoveryGuide(profile);

  async function copyDiagnostics() {
    const result = await copyRecoveryDiagnostics(
      diagnostics,
      navigator.clipboard,
      () => {
        if (detailsRef.current) detailsRef.current.open = true;
        const element = diagnosticsRef.current;
        if (!element) return;
        element.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection?.removeAllRanges();
        selection?.addRange(range);
      },
    );
    setCopyStatus(
      result === "copied"
        ? "Diagnostics copied. Review them before sharing."
        : "Clipboard access is unavailable. Diagnostics are selectable below; copy them with your device’s copy command.",
    );
  }

  return (
    <Paper
      component="section"
      className="pointer-events-auto"
      role="alert"
      aria-labelledby={titleId}
      w="100%"
      maw={590}
      p={{ base: "md", sm: "xl" }}
      radius="lg"
      shadow="panel"
      withBorder
      bg="var(--workbench-shell-overlay-strong)"
      c="workbench.0"
    >
      <Stack gap="md">
        <Group gap="xs" c="yellow.2">
          <WorkbenchIcon name="warning" size={20} />
          <Text
            size="11px"
            fw={600}
            tt="uppercase"
            style={{ letterSpacing: "0.18em" }}
          >
            Graphics unavailable
          </Text>
        </Group>
        <Title id={titleId} order={1} size={20} fw={600}>
          The 3D view couldn’t start
        </Title>
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
          <NativeSelect
            label="Browser"
            size="xs"
            value={profile.browser}
            data={[...recoveryBrowsers]}
            onChange={(event) => {
              const browser = recoveryBrowsers.find(
                ({ value }) => value === event.currentTarget.value,
              )?.value;
              if (browser) setProfile({ ...profile, browser });
            }}
          />
          <NativeSelect
            label="Platform"
            size="xs"
            value={profile.platform}
            data={[...recoveryPlatforms]}
            onChange={(event) => {
              const platform = recoveryPlatforms.find(
                ({ value }) => value === event.currentTarget.value,
              )?.value;
              if (platform) setProfile({ ...profile, platform });
            }}
          />
        </SimpleGrid>
        <List type="ordered" spacing="xs" size="sm" c="workbench.2">
          {guide.steps.map((step) => (
            <List.Item key={step}>
              <GuideStep text={step} />
            </List.Item>
          ))}
        </List>
        <Divider />
        <Text size="xs" c="workbench.3">
          {guide.platformHelp}
        </Text>
        <Anchor
          href={guide.helpUrl}
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
          c="workbench.0"
          underline="always"
        >
          Official browser help ↗
        </Anchor>
        <Group gap="xs">
          <Button size="xs" bg="workbench.1" c="workbench.9" onClick={onRetry}>
            Retry graphics
          </Button>
          <Button size="xs" variant="default" onClick={copyDiagnostics}>
            Copy diagnostics
          </Button>
        </Group>
        <Text role="status" aria-live="polite" size="xs" c="workbench.3">
          {copyStatus}
        </Text>
        <Divider />
        <Box component="details" ref={detailsRef}>
          <Text
            component="summary"
            size="xs"
            c="workbench.3"
            style={{ cursor: "pointer" }}
          >
            Technical details
          </Text>
          <Text size="xs" c="workbench.3" mt="sm">
            A failure to create a context does not prove your device lacks WebGL
            2. These steps are guidance, not a diagnosis. Don’t override
            graphics blocklists or security settings.
          </Text>
          <Box
            component="pre"
            ref={diagnosticsRef}
            tabIndex={0}
            p="sm"
            bg="workbench.9"
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              userSelect: "text",
              fontFamily: "var(--mantine-font-family-monospace)",
              fontSize: "var(--mantine-font-size-xs)",
            }}
          >
            {diagnostics}
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
}
