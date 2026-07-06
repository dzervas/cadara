import { writeFile } from "node:fs/promises";

import type { CliEnv, CliIO, CommandModule, CommandResult } from "@/cli/types";
import {
  captureBundle,
  type CaptureRuntime,
} from "@/cli/commands/onshape-capture/capture";
import { parseDocumentUrl } from "@/cli/commands/onshape-capture/url";

/** Version stamped into capture provenance. */
export const ONSHAPE_CAPTURE_CLI_VERSION = "0.0.1";

const ACCESS_KEY_VAR = "ONSHAPE_ACCESS_KEY";
const SECRET_KEY_VAR = "ONSHAPE_SECRET_KEY";

const USAGE =
  "Usage: cadara onshape capture <onshape-document-url> [output-file]\n" +
  `Requires ${ACCESS_KEY_VAR} and ${SECRET_KEY_VAR} in the environment.`;

function defaultOutputPath(documentId: string): string {
  return `${documentId}.onshape-capture.json`;
}

/**
 * `cadara onshape capture <url> [out]` — authenticate with Onshape API keys
 * from the environment, capture a document into a single bundle file, and write
 * it only after the bundle validates. Credential and URL problems are reported
 * as usage errors before any network request is made.
 */
export const onshapeCaptureCommand: CommandModule = {
  name: "onshape capture",
  description: "Capture an Onshape document into an offline import bundle.",

  async run(argv: string[], env: CliEnv, io: CliIO): Promise<CommandResult> {
    const [url, outArg] = argv;
    if (!url) {
      return { ok: false, kind: "usage", message: USAGE };
    }

    const accessKey = env(ACCESS_KEY_VAR);
    const secretKey = env(SECRET_KEY_VAR);
    if (!accessKey) {
      return {
        ok: false,
        kind: "usage",
        message: `Missing required environment variable ${ACCESS_KEY_VAR}.`,
      };
    }
    if (!secretKey) {
      return {
        ok: false,
        kind: "usage",
        message: `Missing required environment variable ${SECRET_KEY_VAR}.`,
      };
    }

    let ref;
    try {
      ref = parseDocumentUrl(url);
    } catch (error) {
      return {
        ok: false,
        kind: "usage",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const runtime: CaptureRuntime = {
      fetch: (input, init) => fetch(input, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
      cliVersion: ONSHAPE_CAPTURE_CLI_VERSION,
    };

    try {
      const bundle = await captureBundle(
        ref,
        { accessKey, secretKey },
        runtime,
      );
      const outputPath = outArg ?? defaultOutputPath(ref.documentId);
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
