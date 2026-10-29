import {
  validateWorkbenchProjectSession,
  type WorkbenchProjectSession,
} from "@/contracts/workspace/workbench-project-session.runtime-schema";
import type { StorageLike } from "./local-storage-workbench-tabs-store";

/** The active part identity is synchronous so project discovery never gates the shell. */
export function createWorkbenchProjectSessionStore(
  storage: StorageLike,
  key: string,
) {
  return {
    load(): WorkbenchProjectSession | null {
      const serialized = storage.getItem(key);
      if (serialized === null) return null;
      const result = validateWorkbenchProjectSession(
        JSON.parse(serialized) as unknown,
      );
      if (!result.success || !result.data.projectId.trim())
        throw new Error("Invalid stored project session.");
      return result.data;
    },
    save(session: WorkbenchProjectSession) {
      storage.setItem(key, JSON.stringify(session));
    },
  };
}
