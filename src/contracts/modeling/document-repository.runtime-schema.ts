type UrlValidator = (value: string) => boolean;

export function parseAutomergeDocumentUrlStorePayload(
  value: unknown,
  isValidUrl: UrlValidator,
) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false as const,
      message: "<root>: Automerge document URL store must be an object.",
    };
  }

  const urls: Record<string, string> = {};
  const messages: string[] = [];

  for (const [key, candidate] of Object.entries(value)) {
    if (key.length < 1) {
      messages.push("<root>: Automerge document URL keys must not be empty.");
      continue;
    }

    if (typeof candidate !== "string" || !isValidUrl(candidate)) {
      messages.push(
        `${key}: Automerge document URLs must be valid Automerge URLs.`,
      );
      continue;
    }

    urls[key] = candidate;
  }

  return messages.length === 0
    ? { ok: true as const, urls }
    : { ok: false as const, message: messages.join("; ") };
}
