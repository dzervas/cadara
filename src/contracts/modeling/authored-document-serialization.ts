export interface AuthoredDocumentSerializationOptions {
  pretty?: boolean;
}

export function stableJsonValue(value: unknown): unknown {
  return orderedJsonValue(value, false);
}

function orderedJsonValue(
  value: unknown,
  preserveGeometryData: boolean,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => orderedJsonValue(entry, preserveGeometryData));
  }

  if (!isRecord(value)) {
    return value;
  }

  // Asset hashes certify the existing encoder's bytes, including nested key
  // order. Sorting retained data corrupts a valid native file on fresh reopen.
  // Equality still uses fully stable ordering; only serialization preserves bytes.
  if (
    preserveGeometryData &&
    (value.kind === "cadaraBrep" || value.kind === "bakedMeshGeometry")
  )
    return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, orderedJsonValue(value[key], preserveGeometryData)]),
  );
}

export function serializeAuthoredDocumentJson(
  document: unknown,
  options: AuthoredDocumentSerializationOptions = {},
) {
  return JSON.stringify(
    orderedJsonValue(document, true),
    null,
    (options.pretty ?? true) ? 2 : 0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
