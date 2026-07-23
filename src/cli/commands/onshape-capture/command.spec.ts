import { test, expect } from "vitest";

import { onshapeCaptureCommand } from "@/cli/commands/onshape-capture";
import type { CliEnv, CliIO } from "@/cli/types";
import { FIXTURE_DOCUMENT_URL } from "@/cli/commands/onshape-capture/fixtures/transcript";

function makeIO(): CliIO & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
  };
}

function envFrom(values: Record<string, string>): CliEnv {
  return (name) => values[name];
}

test("command.spec.ts reports a usage error naming the missing access key", async () => {
  const result = await onshapeCaptureCommand.run(
    [FIXTURE_DOCUMENT_URL],
    envFrom({ ONSHAPE_SECRET_KEY: "secret" }),
    makeIO(),
  );

  expect(result.ok).toBe(false);
  expect(result.ok === false && result.kind).toBe("usage");
  expect(result.ok === false && result.message).toContain("ONSHAPE_ACCESS_KEY");
});

test("command.spec.ts reports a usage error naming the missing secret key", async () => {
  const result = await onshapeCaptureCommand.run(
    [FIXTURE_DOCUMENT_URL],
    envFrom({ ONSHAPE_ACCESS_KEY: "access" }),
    makeIO(),
  );

  expect(result.ok === false && result.kind).toBe("usage");
  expect(result.ok === false && result.message).toContain("ONSHAPE_SECRET_KEY");
});

test("command.spec.ts reports a usage error for a missing url argument", async () => {
  const result = await onshapeCaptureCommand.run(
    [],
    envFrom({ ONSHAPE_ACCESS_KEY: "access", ONSHAPE_SECRET_KEY: "secret" }),
    makeIO(),
  );

  expect(result.ok === false && result.kind).toBe("usage");
});

test("command.spec.ts accepts rollback-snapshots as an option before requiring the url", async () => {
  const result = await onshapeCaptureCommand.run(
    ["--rollback-snapshots"],
    envFrom({ ONSHAPE_ACCESS_KEY: "access", ONSHAPE_SECRET_KEY: "secret" }),
    makeIO(),
  );

  expect(result.ok === false && result.kind).toBe("usage");
  expect(result.ok === false && result.message).toContain("<onshape-document-url>");
});

test("command.spec.ts rejects duplicate capture flags before credential or network work", async () => {
  const credentials = envFrom({ ONSHAPE_ACCESS_KEY: "access", ONSHAPE_SECRET_KEY: "secret" });
  for (const argv of [
    ["--rollback-snapshots", "--rollback-snapshots", FIXTURE_DOCUMENT_URL],
    ["--enrich", "--enrich", "capture.json"],
  ]) {
    const result = await onshapeCaptureCommand.run(argv, credentials, makeIO());
    expect(result.ok === false && result.kind).toBe("usage");
  }
});

test("command.spec.ts reports a usage error for a bad url before any network work", async () => {
  const result = await onshapeCaptureCommand.run(
    ["not-a-url"],
    envFrom({ ONSHAPE_ACCESS_KEY: "access", ONSHAPE_SECRET_KEY: "secret" }),
    makeIO(),
  );

  expect(result.ok === false && result.kind).toBe("usage");
  expect(result.ok === false && result.message).toContain("Expected");
});

test("command.spec.ts reports a usage error for an invalid translation poll budget", async () => {
  const result = await onshapeCaptureCommand.run(
    [FIXTURE_DOCUMENT_URL],
    envFrom({
      ONSHAPE_ACCESS_KEY: "access",
      ONSHAPE_SECRET_KEY: "secret",
      ONSHAPE_TRANSLATION_MAX_POLLS: "0",
    }),
    makeIO(),
  );

  expect(result.ok === false && result.kind).toBe("usage");
  expect(result.ok === false && result.message).toContain(
    "ONSHAPE_TRANSLATION_MAX_POLLS",
  );
});
