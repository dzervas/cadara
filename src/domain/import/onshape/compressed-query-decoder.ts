import { strFromU8, unzlibSync } from "fflate";

const COMPRESSED_ASSIGNMENT =
  /^\s*query\s*=\s*qCompressed\(\s*[\d.]+\s*,\s*("(?:\\.|[^"\\])*")\s*,\s*id\s*\)\s*;?\s*$/;

export type CompressedQueryStringPart =
  | { kind: "literal"; value: string }
  | { kind: "reference"; index: number };

export type CompressedQueryToken =
  | { kind: "header" }
  | { kind: "string" | "typedString"; parts: readonly CompressedQueryStringPart[] }
  | { kind: "boolean"; value: true }
  | { kind: "array" | "map" | "constant" | "reference" | "number"; value: number };

function readSignedHex(value: string): number | null {
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  if (!/^[0-9a-f]+$/.test(digits)) return null;
  const parsed = Number.parseInt(digits, 16);
  return Number.isSafeInteger(parsed) ? (negative ? -parsed : parsed) : null;
}

function decodePayload(payload: string): string | null {
  if (!payload.startsWith("&")) return payload;
  const match = /^&([0-9a-f]+)\$([A-Za-z0-9+/]+={0,2})$/.exec(payload);
  if (!match) return null;
  const expectedLength = Number.parseInt(match[1]!, 16);
  try {
    const compressed = Uint8Array.from(atob(match[2]!), (character) => character.charCodeAt(0));
    const decoded = strFromU8(unzlibSync(compressed));
    return decoded.length === expectedLength ? decoded : null;
  } catch {
    return null;
  }
}

/** Strictly decode and tokenize one qCompressed assignment, consuming every byte. */
export function decodeCompressedQuery(
  queryString: string | null | undefined,
): { payload: string; tokens: readonly CompressedQueryToken[] } | null {
  if (typeof queryString !== "string") return null;
  const assignment = COMPRESSED_ASSIGNMENT.exec(queryString);
  if (!assignment) return null;

  let encoded: unknown;
  try {
    encoded = JSON.parse(assignment[1]!);
  } catch {
    return null;
  }
  if (typeof encoded !== "string") return null;
  const payload = decodePayload(encoded);
  if (payload === null) return null;

  const tokens: CompressedQueryToken[] = [];
  let offset = 0;
  while (offset < payload.length) {
    const marker = payload[offset]!;
    if (marker === "%") {
      tokens.push({ kind: "header" });
      offset += 1;
      continue;
    }

    if (marker === "T") {
      tokens.push({ kind: "boolean", value: true });
      offset += 1;
      continue;
    }

    if (marker === "S" || marker === "B") {
      const descriptor = /^(-?[0-9a-f]+(?:\.-?[0-9a-f]+)*)\$/.exec(
        payload.slice(offset + 1),
      );
      if (!descriptor) return null;
      let contentOffset = offset + 1 + descriptor[0].length;
      const parts: CompressedQueryStringPart[] = [];
      for (const encodedLength of descriptor[1]!.split(".")) {
        const length = readSignedHex(encodedLength);
        if (length === null) return null;
        if (length < 0) {
          parts.push({ kind: "reference", index: -length });
          continue;
        }
        if (contentOffset + length > payload.length) return null;
        parts.push({
          kind: "literal",
          value: payload.slice(contentOffset, contentOffset + length),
        });
        contentOffset += length;
      }
      tokens.push({ kind: marker === "S" ? "string" : "typedString", parts });
      offset = contentOffset;
      continue;
    }

    const kind = {
      A: "array",
      M: "map",
      C: "constant",
      R: "reference",
      D: "number",
    }[marker] as Extract<CompressedQueryToken, { value: number }>["kind"] | undefined;
    if (!kind) return null;
    const encodedNumber = /^-?[0-9a-f]+/.exec(payload.slice(offset + 1));
    if (!encodedNumber) return null;
    const value = readSignedHex(encodedNumber[0]);
    if (value === null) return null;
    tokens.push({ kind, value });
    offset += 1 + encodedNumber[0].length;
  }

  return tokens.length > 0 ? { payload, tokens } : null;
}

/** Ordered literal string fields used by the simple sketch entity readers. */
export function readCompressedQueryLiteralFields(
  queryString: string | null | undefined,
): string[][] | null {
  const decoded = decodeCompressedQuery(queryString);
  if (!decoded) return null;
  return decoded.tokens.flatMap((token) =>
    token.kind === "string"
      ? [token.parts.flatMap((part) => (part.kind === "literal" ? [part.value] : []))]
      : [],
  );
}
