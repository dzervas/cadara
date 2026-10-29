import type {
  Chunk,
  StorageAdapterInterface,
  StorageKey,
} from "@automerge/automerge-repo/slim";

/** The chunk kinds that hold a document's changes; sync states do not. */
const DOCUMENT_CHUNK_KINDS = new Set(["snapshot", "incremental"]);

function isDocumentChunk(key: StorageKey) {
  return key.length === 3 && DOCUMENT_CHUNK_KINDS.has(key[1]!);
}

function chunkKeyName(key: StorageKey) {
  return key.join("/");
}

/**
 * The storage adapter a Repo writes through, recording per Automerge
 * document the chunk keys whose changes that Repo's handle holds: the
 * chunks its load read, plus the chunks it saved, minus the chunks it
 * removed.
 *
 * automerge-repo names document chunks by their content: an incremental
 * chunk by the SHA-256 of its bytes, a snapshot by the hash of the heads it
 * was saved at. A set of chunk keys therefore names one set of changes, and
 * every load of that set materializes the same document. When the stored
 * keys equal the recorded keys while the handle sits at the heads it was
 * saved at, the stored chunks hold exactly the handle's changes: the
 * recorded chunks all came from the handle, and the saves cover its heads.
 */
export class AutomergeChunkKeyRecorder implements StorageAdapterInterface {
  private readonly storage: StorageAdapterInterface;
  private readonly held = new Map<string, Set<string>>();

  constructor(storage: StorageAdapterInterface) {
    this.storage = storage;
  }

  private heldKeys(documentId: string) {
    let keys = this.held.get(documentId);
    if (!keys) {
      keys = new Set();
      this.held.set(documentId, keys);
    }
    return keys;
  }

  load(key: StorageKey) {
    return this.storage.load(key);
  }

  async save(key: StorageKey, data: Uint8Array) {
    await this.storage.save(key, data);
    if (isDocumentChunk(key)) this.heldKeys(key[0]!).add(chunkKeyName(key));
  }

  async remove(key: StorageKey) {
    // Forgotten before the removal: a failed removal reads as a mismatch.
    this.held.get(key[0]!)?.delete(chunkKeyName(key));
    await this.storage.remove(key);
  }

  async loadRange(prefix: StorageKey): Promise<Chunk[]> {
    const chunks = await this.storage.loadRange(prefix);
    // StorageSubsystem.loadDocData reads [documentId, kind] per chunk kind.
    if (prefix.length === 2 && DOCUMENT_CHUNK_KINDS.has(prefix[1]!)) {
      const keys = this.heldKeys(prefix[0]!);
      for (const chunk of chunks)
        if (chunk.data !== undefined) keys.add(chunkKeyName(chunk.key));
    }
    return chunks;
  }

  async removeRange(prefix: StorageKey) {
    const keys = this.held.get(prefix[0]!);
    for (const key of keys ?? [])
      if (prefix.every((part, index) => key.split("/")[index] === part))
        keys!.delete(key);
    await this.storage.removeRange(prefix);
  }

  /** The recorded chunk keys of a document, sorted. */
  heldChunkKeys(documentId: string) {
    return [...(this.held.get(documentId) ?? [])].sort();
  }

  /** The document's chunk keys in storage now, sorted; no Automerge parse. */
  async storedChunkKeys(documentId: string) {
    const chunks = await this.storage.loadRange([documentId]);
    return chunks
      .filter((chunk) => chunk.data !== undefined && isDocumentChunk(chunk.key))
      .map((chunk) => chunkKeyName(chunk.key))
      .sort();
  }
}
