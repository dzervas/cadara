export interface AuthoredDocumentSerializationOptions {
  pretty?: boolean;
}

export function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonValue(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}

export function serializeAuthoredDocumentJson(
  document: unknown,
  options: AuthoredDocumentSerializationOptions = {},
) {
  return JSON.stringify(
    stableJsonValue(document),
    null,
    (options.pretty ?? true) ? 2 : 0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
