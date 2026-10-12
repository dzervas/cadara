import { expect } from "vitest";

/** T17e (B2; review A-2): the internal id prefixes no user text may contain. */
export const INTERNAL_ID_PATTERN =
  /sketch_|derivation_|dimension_|constraint_|region_|projected_geometry_|feature_|body_|\bref_/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/**
 * T17e (B2, specification "Minimum failure feedback": geometry is named by
 * label): every message is a string with no internal id prefix
 * (`INTERNAL_ID_PATTERN`), no UUID and none of `ids` (the fixture's own ids
 * that the prefixes do not catch, e.g. `ref_a` or an occurrence id).
 */
export function expectNoInternalIds(
  messages: readonly (string | null | undefined)[],
  ids: readonly string[] = [],
) {
  expect(messages.length, "at least one user text").toBeGreaterThan(0);
  for (const message of messages) {
    expect(message, "a user text").toEqual(expect.any(String));
    expect(message, `${message}: no internal id`).not.toMatch(
      INTERNAL_ID_PATTERN,
    );
    expect(message, `${message}: no UUID`).not.toMatch(UUID);
    for (const id of ids)
      expect(message!.includes(id), `${message}: names ${id}`).toBe(false);
  }
}
