import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import type { PeerId, Repo } from "@automerge/automerge-repo/slim";

/**
 * The page-private link between the page's project Repo and the document
 * sync worker's Repo (see project-sync-worker-protocol.ts).
 *
 * Both Repos store into the same IndexedDB database and so report the same
 * storage id; the bridge marks its peer ephemeral so neither Repo persists a
 * sync state that the other would overwrite under that shared key.
 */
export class ProjectSyncBridge {
  readonly peers = new Set<PeerId>();
  readonly adapter: BroadcastChannelNetworkAdapter;

  constructor(channelName: string) {
    this.adapter = new BroadcastChannelNetworkAdapter({
      channelName,
      peerWaitMs: 50,
    });
    // Registered before the Repo's own listeners, so the share policy and
    // the peer metadata are settled when the Repo sees the peer.
    this.adapter.on("peer-candidate", ({ peerId, peerMetadata }) => {
      this.peers.add(peerId);
      delete peerMetadata.storageId;
      peerMetadata.isEphemeral = true;
    });
    this.adapter.on("peer-disconnected", ({ peerId }) => {
      this.peers.delete(peerId);
    });
  }
}

export function createProjectSyncBridgeChannelName() {
  return `cadara-project-sync:${crypto.randomUUID()}`;
}

/**
 * Restricts a Repo's bridge peer to the manifests of started projects; every
 * other peer keeps the Repo's default of sharing everything.
 */
export function shareOnlyManifestsOverBridge(
  repo: Repo,
  bridge: ProjectSyncBridge,
  isStartedManifest: (documentId: string) => boolean,
) {
  const share = async (peerId: PeerId, documentId?: string) =>
    !bridge.peers.has(peerId) ||
    (documentId !== undefined && isStartedManifest(documentId));
  repo.shareConfig = { announce: share, access: share };
}
