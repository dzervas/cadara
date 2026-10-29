import { startBrowserDocumentSyncWorkerClient } from "@/infrastructure/workers/document-sync-worker-browser-client";
import { startOccModuleWorker } from "@/infrastructure/occ/occ-module-worker";

// Imported by the entry before the editor (src/main.tsx), so both workers boot
// while the editor's modules evaluate and render; the app adopts them.
startBrowserDocumentSyncWorkerClient({ search: window.location.search });
startOccModuleWorker();
