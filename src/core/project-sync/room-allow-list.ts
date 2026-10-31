/**
 * Which documents a project's room may receive from this client.
 *
 * The room closes the socket on a message for any document missing from
 * its copy of the manifest, so the allow-list holds only entries of the
 * local manifest, and an entry joins it only once the room has
 * acknowledged a manifest that lists it. Removed entries leave at once.
 * The manifest itself is always allowed and is not part of the list.
 */
export function nextRoomAllowList(
  previous: ReadonlySet<string>,
  manifestEntryIds: readonly string[],
  roomHasCurrentManifest: boolean,
): Set<string> {
  if (roomHasCurrentManifest) return new Set(manifestEntryIds);
  return new Set(manifestEntryIds.filter((id) => previous.has(id)));
}

export function sameDocumentSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
) {
  return left.size === right.size && [...left].every((id) => right.has(id));
}
