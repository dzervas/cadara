import { readFile, writeFile } from "node:fs/promises";

import type { CliEnv, CliIO, CommandModule, CommandResult } from "@/cli/types";
import {
  captureBundle,
  enrichBundleHistoryEvidence,
  type CaptureRuntime,
} from "@/cli/commands/onshape-capture/capture";
import { parseDocumentUrl } from "@/cli/commands/onshape-capture/url";
import { requireOnshapeCaptureBundle } from "@/contracts/import/onshape-capture-bundle";
import type { OnshapeCredentials } from "@/cli/commands/onshape-capture/client";

/** Version stamped into capture provenance. */
export const ONSHAPE_CAPTURE_CLI_VERSION = "0.0.1";

const COOKIE_ON_VAR = "ONSHAPE_COOKIE_ON";
const ACCESS_KEY_VAR = "ONSHAPE_ACCESS_KEY";
const SECRET_KEY_VAR = "ONSHAPE_SECRET_KEY";
const TRANSLATION_MAX_POLLS_VAR = "ONSHAPE_TRANSLATION_MAX_POLLS";

const USAGE =
  "Usage: cadara onshape capture <onshape-document-url> [output-file]\n" +
  "       cadara onshape capture --enrich <input-file> [output-file]  # refresh immutable history evidence\n" +
  `Requires ${COOKIE_ON_VAR}, or both ${ACCESS_KEY_VAR} and ${SECRET_KEY_VAR}, in the environment.`;

function defaultOutputPath(documentId: string): string {
  return `${documentId}.onshape-capture.json`;
}

function parsePositiveIntegerEnv(value: string | undefined, variableName: string): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive integer when set.`);
  }
  return parsed;
}

/**
 * `cadara onshape capture <url> [out]` — authenticate with the Onshape `on`
 * cookie or API keys from the environment, capture a document into a single
 * bundle file, and write it only after the bundle validates. Credential and URL
 * problems are reported as usage errors before any network request is made.
 */
export const onshapeCaptureCommand: CommandModule = {
  name: "onshape capture",
  description: "Capture an Onshape document into an offline import bundle.",

  async run(argv: string[], env: CliEnv, io: CliIO): Promise<CommandResult> {
    const enrichCount = argv.filter((arg) => arg === "--enrich").length;
    const enrichIndex = argv.indexOf("--enrich");
    const unknownOption = argv.find((arg) => arg.startsWith("--") && arg !== "--enrich");
    const positional = argv.filter((arg) => arg !== "--enrich");
    const [url, outArg, extraArg] = positional;
    if (
      !url ||
      extraArg ||
      unknownOption ||
      enrichCount > 1 ||
      (enrichIndex >= 0 && enrichIndex !== 0)
    ) {
      return { ok: false, kind: "usage", message: USAGE };
    }

    const cookieOn = env(COOKIE_ON_VAR);
    let credentials: OnshapeCredentials;
    if (cookieOn) {
      credentials = { cookieOn };
    } else {
      const accessKey = env(ACCESS_KEY_VAR);
      const secretKey = env(SECRET_KEY_VAR);
      if (!accessKey) {
        return {
          ok: false,
          kind: "usage",
          message: `Missing required environment variable ${COOKIE_ON_VAR} or ${ACCESS_KEY_VAR}.`,
        };
      }
      if (!secretKey) {
        return {
          ok: false,
          kind: "usage",
          message: `Missing required environment variable ${COOKIE_ON_VAR} or ${SECRET_KEY_VAR}.`,
        };
      }
      credentials = { accessKey, secretKey };
    }

    let ref;
    if (enrichIndex < 0) {
      try {
        ref = parseDocumentUrl(url);
      } catch (error) {
        return {
          ok: false,
          kind: "usage",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const runtime: CaptureRuntime = {
      fetch: (input, init) => fetch(input, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
      cliVersion: ONSHAPE_CAPTURE_CLI_VERSION,
      log: io.stdout,
    };

    let maxTranslationPolls: number | null;
    try {
      maxTranslationPolls = parsePositiveIntegerEnv(
        env(TRANSLATION_MAX_POLLS_VAR),
        TRANSLATION_MAX_POLLS_VAR,
      );
    } catch (error) {
      return {
        ok: false,
        kind: "usage",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      if (enrichIndex >= 0) {
        const input = requireOnshapeCaptureBundle(JSON.parse(await readFile(url, "utf8")));
        io.stdout(`Enriching immutable history evidence for ${input.partStudios.length} Part Studio(s) from ${url}\n`);
        const bundle = await enrichBundleHistoryEvidence(
          input,
          { ...credentials, maxTranslationPolls: maxTranslationPolls ?? undefined },
          runtime,
        );
        const outputPath = outArg ?? url;
        await writeFile(outputPath, JSON.stringify(requireOnshapeCaptureBundle(bundle)));
        io.stdout(`Enriched immutable history evidence for ${bundle.partStudios.length} Part Studio(s) to ${outputPath}\n`);
        return { ok: true };
      }
      const bundle = await captureBundle(
        ref!,
        {
          ...credentials,
          maxTranslationPolls: maxTranslationPolls ?? undefined,
        },
        runtime,
      );
      const outputPath = outArg ?? defaultOutputPath(ref!.documentId);
      await writeFile(outputPath, JSON.stringify(bundle));
      io.stdout(
        `Captured ${bundle.partStudios.length} Part Studio(s) to ${outputPath}\n`,
      );
      return { ok: true };
    } catch (error) {
      // No partial bundle is written: the file write happens only after a
      // successful, validated capture above.
      return {
        ok: false,
        kind: "failure",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
