import type {
  AutomergeUrl,
  Chunk,
  StorageAdapterInterface,
  StorageKey,
} from "@automerge/automerge-repo/slim";
import type {
  MaterializedDocumentEvent,
  MaterializedDocumentRecord,
  MaterializedDocumentStore,
} from "./indexeddb-materialized-document-store";

/** One shared key space, like the single IndexedDB database all tabs open. */
export class SharedMemoryStorage implements StorageAdapterInterface {
  readonly chunks = new Map<string, { key: StorageKey; data: Uint8Array }>();
  async load(key: StorageKey) {
    return this.chunks.get(key.join("/"))?.data;
  }
  async save(key: StorageKey, data: Uint8Array) {
    this.chunks.set(key.join("/"), { key, data });
  }
  async remove(key: StorageKey) {
    this.chunks.delete(key.join("/"));
  }
  async loadRange(prefix: StorageKey): Promise<Chunk[]> {
    return [...this.chunks.values()]
      .filter(({ key }) => prefix.every((part, index) => key[index] === part))
      .map(({ key, data }) => ({ key, data }));
  }
  async removeRange(prefix: StorageKey) {
    for (const chunk of await this.loadRange(prefix))
      this.chunks.delete(chunk.key.join("/"));
  }
  documentChunkKeys(url: AutomergeUrl) {
    const documentId = url.slice("automerge:".length);
    return [...this.chunks.keys()]
      .filter((key) => key.startsWith(documentId))
      .sort();
  }
  documentChunkKinds(url: AutomergeUrl) {
    const documentId = url.slice("automerge:".length);
    return [...this.chunks.values()]
      .filter(({ key }) => key[0] === documentId)
      .map(({ key }) => key[1])
      .sort();
  }
}

/**
 * The materialized-document cache all tabs share (one IndexedDB database
 * in the browser), with the events every tab reported and a switch that
 * makes writes fail like an exceeded quota.
 */
export class SharedMemoryMaterializedDocumentStore implements MaterializedDocumentStore {
  readonly records = new Map<string, unknown>();
  readonly events: MaterializedDocumentEvent[] = [];
  failWrites = false;
  async read(automergeUrl: string) {
    return structuredClone(this.records.get(automergeUrl));
  }
  async write(record: MaterializedDocumentRecord) {
    if (this.failWrites)
      throw Object.assign(new Error("The quota has been exceeded."), {
        name: "QuotaExceededError",
      });
    this.records.set(record.automergeUrl, structuredClone(record));
  }
  async remove(automergeUrl: string) {
    this.records.delete(automergeUrl);
  }
  /** The repository option of one tab of this build. */
  options(compatibility = "/assets/document-sync.worker-test.js") {
    return {
      store: this,
      compatibility,
      report: (event: MaterializedDocumentEvent) => this.events.push(event),
    };
  }
  eventKinds() {
    return this.events.map((event) =>
      "reason" in event ? `${event.kind}: ${event.reason}` : event.kind,
    );
  }
}
