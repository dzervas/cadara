import { workbenchPeerColors } from "./workbench-theme";

/** Stable across clients and reconnects; never derived from a socket id. */
export function projectPresenceColor(userId: string): string {
  let hash = 0;
  for (const character of userId)
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return workbenchPeerColors[hash % workbenchPeerColors.length]!;
}
