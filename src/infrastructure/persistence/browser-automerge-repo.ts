import {
  Repo,
  type StorageAdapterInterface,
} from "@automerge/automerge-repo/slim";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { prepareAutomerge } from "./automerge-runtime";

/** Catalog readers and the editor use the same WASM initialization and Repo setup. */
export async function createBrowserAutomergeRepo(
  storage: StorageAdapterInterface,
  localPeerSync?: false | { channelName?: string; peerWaitMs?: number },
) {
  await prepareAutomerge();
  return new Repo({
    storage,
    network:
      localPeerSync && typeof BroadcastChannel !== "undefined"
        ? [
            new BroadcastChannelNetworkAdapter({
              channelName:
                localPeerSync.channelName ?? "cad-authored-documents",
              peerWaitMs: localPeerSync.peerWaitMs ?? 100,
            }),
          ]
        : [],
  });
}
