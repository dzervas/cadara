/**
 * Offline, deterministic assembly of Onshape capture bundles for tests.
 *
 * Real capture bundles are proprietary and git-ignored, but the capture CLI's
 * checked-in fixture transcript contains every mandatory section, so running
 * the real capture pipeline against it (no network) yields valid
 * `OnshapeCaptureBundle`s. Import-provider tests consume these instead of
 * checked-in JSON blobs, keeping the translator honest against the same shapes
 * the capture command produces.
 */
import type { OnshapeCaptureBundle } from "@/contracts/import/onshape-capture-bundle";

import { captureBundle } from "@/cli/commands/onshape-capture/capture";
import { parseDocumentUrl } from "@/cli/commands/onshape-capture/url";
import {
  createFixtureFetch,
  createFixtureRuntime,
  FIXTURE_DOCUMENT_URL,
  FIXTURE_ELEMENT_URL,
  FIXTURE_PART_STUDIO_ID,
} from "@/cli/commands/onshape-capture/fixtures/transcript";

const FIXTURE_CREDENTIALS = { accessKey: "access", secretKey: "secret" };

/**
 * Assemble the full-document fixture bundle (Mounts Part Studio with bodies and
 * references, plus the empty Part Studio). Deterministic: fixed clock, instant
 * sleep, no network.
 */
export async function assembleFixtureCaptureBundle(): Promise<OnshapeCaptureBundle> {
  const { fetch } = createFixtureFetch();
  const ref = parseDocumentUrl(FIXTURE_DOCUMENT_URL);
  return captureBundle(ref, FIXTURE_CREDENTIALS, createFixtureRuntime(fetch));
}

/**
 * Assemble an element-scoped fixture bundle containing only the Mounts Part
 * Studio (the one with translatable features, references, and ground truth).
 */
export async function assembleFixtureMountsBundle(): Promise<OnshapeCaptureBundle> {
  const { fetch } = createFixtureFetch();
  const ref = parseDocumentUrl(FIXTURE_ELEMENT_URL);
  return captureBundle(ref, FIXTURE_CREDENTIALS, createFixtureRuntime(fetch));
}

export { FIXTURE_PART_STUDIO_ID };
