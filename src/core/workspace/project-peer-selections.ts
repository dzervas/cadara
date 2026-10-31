import type { ProjectPresencePeer } from "@/contracts/project-sync/project-service";
import type { DurableRef } from "@/contracts/shared/references";
import { primitiveRefEquals } from "@/core/editor/schema";
import type { ViewportRenderableRecord } from "./viewport-renderables";

/**
 * The project room rejects oversized presence messages and drops the
 * connection, so a large marquee selection would stall document sync. Peers
 * see the first refs of a larger selection only.
 */
export const PROJECT_PRESENCE_SELECTION_LIMIT = 100;

export function limitPresenceSelection(selection: readonly DurableRef[]) {
  return selection.slice(0, PROJECT_PRESENCE_SELECTION_LIMIT);
}

/** Sessions of other accounts: your own account is never shown as a peer. */
export function otherProjectPeers(
  peers: readonly ProjectPresencePeer[],
  userId: string | undefined,
) {
  return peers.filter((peer) => peer.userId !== userId);
}

/** Unresolved or other-document selections never produce an overlay. */
export function resolveProjectPeerSelections(
  peers: readonly ProjectPresencePeer[],
  documentId: string | null,
  renderables: readonly ViewportRenderableRecord[],
) {
  return peers
    .filter(
      (peer) => documentId !== null && peer.activeDocumentId === documentId,
    )
    .flatMap((peer) =>
      renderables
        .filter(
          ({ origin, renderable }) =>
            origin === "document" &&
            peer.selection?.some(
              (target) =>
                primitiveRefEquals(target, renderable.binding.target) ||
                (target.kind === "body" &&
                  "bodyId" in renderable.binding.target &&
                  target.bodyId === renderable.binding.target.bodyId) ||
                (target.kind === "sketch" &&
                  "sketchId" in renderable.binding.target &&
                  target.sketchId === renderable.binding.target.sketchId) ||
                (target.kind === "feature" &&
                  target.featureId === renderable.ownerFeatureId),
            ),
        )
        .map(({ renderable }) => ({
          peerId: peer.peerId,
          userId: peer.userId,
          renderable,
        })),
    );
}
