import type { OnshapeWvm } from "@/contracts/import/onshape-capture-bundle";

/** Parsed Onshape document reference extracted from a browser URL. */
export interface OnshapeDocumentRef {
  documentId: string;
  wvm: OnshapeWvm;
  wvmId: string;
  /** Element id when the URL scopes to a single element, else null. */
  elementId: string | null;
}

const DOCUMENT_URL_PATTERN =
  /\/documents\/([0-9a-f]{24})(?:\/(w|v|m)\/([0-9a-f]{24}))?(?:\/e\/([0-9a-f]{24}))?/i;

const EXPECTED_SHAPE =
  "Expected https://cad.onshape.com/documents/{did}/w/{wid}[/e/{eid}] " +
  "(or /v/{vid} | /m/{mid}).";

/**
 * Parse an Onshape browser URL into a document reference. Throws a usage-shaped
 * error with the expected URL form before any network access is attempted.
 */
export function parseDocumentUrl(raw: string): OnshapeDocumentRef {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Unrecognized Onshape document URL: ${raw}\n${EXPECTED_SHAPE}`);
  }

  const match = url.pathname.match(DOCUMENT_URL_PATTERN);
  if (!match) {
    throw new Error(`Unrecognized Onshape document URL: ${raw}\n${EXPECTED_SHAPE}`);
  }

  const [, documentId, wvm, wvmId, elementId] = match;
  if (!wvm || !wvmId) {
    throw new Error(
      "URL is missing the workspace/version segment (/w/{wid}, /v/{vid}, or " +
        `/m/{mid}).\n${EXPECTED_SHAPE}`,
    );
  }

  return {
    documentId: documentId!,
    wvm: wvm.toLowerCase() as OnshapeWvm,
    wvmId,
    elementId: elementId ?? null,
  };
}
