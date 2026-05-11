import { z } from "zod";

type UrlValidator = (value: string) => boolean;

export function createAutomergeDocumentUrlStorePayloadSchema(
  isValidUrl: UrlValidator,
) {
  return z.record(
    z.string().min(1),
    z
      .string()
      .refine(
        isValidUrl,
        "Automerge document URLs must be valid Automerge URLs.",
      ),
  );
}

export function parseAutomergeDocumentUrlStorePayload(
  value: unknown,
  isValidUrl: UrlValidator,
) {
  const parsed =
    createAutomergeDocumentUrlStorePayloadSchema(isValidUrl).safeParse(value);

  return parsed.success
    ? { ok: true as const, urls: parsed.data }
    : {
        ok: false as const,
        message: parsed.error.issues
          .map(
            (issue) =>
              `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`,
          )
          .join("; "),
      };
}
