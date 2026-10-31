import type { ProjectServiceLink } from "@/contracts/modeling/project-manifest";
import type {
  DocumentSyncWorkerRequest,
  DocumentSyncWorkerResponse,
} from "./document-sync-worker-protocol";
import type {
  ProjectPresencePeer,
  ProjectPresenceState,
  ProjectSyncConnection,
  SyncTokenResponse,
} from "@/contracts/project-sync/project-service";

/**
 * Project sync messages between the page and the document sync worker.
 *
 * The worker's Repo holds the part documents, so the socket to a project's
 * room lives there; the page keeps the account session and issues tokens.
 *
 *   page -> worker  projectSyncStart      link, manifest id, room URL and
 *                                         the page's bridge channel; repeats
 *                                         for a running project are ignored
 *   worker -> page  projectSyncTokenRequest  before every socket opens
 *   page -> worker  projectSyncToken      the grant, or why none was issued
 *   worker -> page  projectSyncStatus     connection, presence peers, on
 *                                         every change
 *   page -> worker  projectSyncPresence   the local participant's state
 *   page -> worker  projectSyncNetwork    the page's online/offline events;
 *                                         a worker does not see emulated
 *                                         (DevTools) network changes itself
 *   page -> worker  projectSyncStop       closes the socket, says goodbye
 *
 * Manifests also live in the page's project Repo. Both Repos join a
 * page-private BroadcastChannel ("bridge") that shares only the manifests
 * of started projects, so manifest edits flow page -> worker -> room and
 * back without loading part documents on the main thread.
 */
export type ProjectSyncWorkerRequest =
  | {
      kind: "projectSyncStart";
      link: ProjectServiceLink;
      manifestDocumentId: string;
      roomUrl: string;
      bridgeChannel: string;
      /**
       * Documents of the page's other local projects. A collaborator's
       * manifest entry naming one of them must not upload it.
       */
      foreignDocumentIds: string[];
    }
  | { kind: "projectSyncStop"; link: ProjectServiceLink }
  | {
      kind: "projectSyncToken";
      tokenRequestId: number;
      grant: SyncTokenResponse | null;
      error?: string;
    }
  | {
      kind: "projectSyncPresence";
      link: ProjectServiceLink;
      state: ProjectPresenceState;
    }
  | { kind: "projectSyncNetwork"; online: boolean };

export type ProjectSyncWorkerResponse =
  | {
      kind: "projectSyncTokenRequest";
      tokenRequestId: number;
      link: ProjectServiceLink;
    }
  | {
      kind: "projectSyncStatus";
      link: ProjectServiceLink;
      connection: ProjectSyncConnection;
      peers: ProjectPresencePeer[];
      /** Why the worker could not start syncing the project. */
      error?: string;
    };

/** Everything the page posts to the document sync worker after bootstrap. */
export type DocumentSyncWorkerInbound =
  | DocumentSyncWorkerRequest
  | ProjectSyncWorkerRequest;
/** Everything the document sync worker posts to the page. */
export type DocumentSyncWorkerOutbound =
  | DocumentSyncWorkerResponse
  | ProjectSyncWorkerResponse;

const REQUEST_KINDS: ReadonlySet<string> = new Set<
  ProjectSyncWorkerRequest["kind"]
>([
  "projectSyncStart",
  "projectSyncStop",
  "projectSyncToken",
  "projectSyncPresence",
  "projectSyncNetwork",
]);
const RESPONSE_KINDS: ReadonlySet<string> = new Set<
  ProjectSyncWorkerResponse["kind"]
>(["projectSyncTokenRequest", "projectSyncStatus"]);

export function isProjectSyncWorkerRequest(message: {
  kind: string;
}): message is ProjectSyncWorkerRequest {
  return REQUEST_KINDS.has(message.kind);
}

export function isProjectSyncWorkerResponse(message: {
  kind: string;
}): message is ProjectSyncWorkerResponse {
  return RESPONSE_KINDS.has(message.kind);
}
