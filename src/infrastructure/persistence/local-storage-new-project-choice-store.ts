import type {
  NewProjectChoice,
  ProjectLocation,
} from "@/core/account/project-location-options";
import type { StorageLike } from "./local-storage-workbench-tabs-store";

const NEW_PROJECT_CHOICE_KEY = "cad.workbench.newProjectChoice.v1";
const PROJECT_LOCATIONS: readonly ProjectLocation[] = [
  "local",
  "private",
  "public",
];

/** The New project modal preselects the location and owner chosen last. */
export function createLocalStorageNewProjectChoiceStore(storage: StorageLike) {
  return {
    load(): NewProjectChoice | null {
      const serialized = storage.getItem(NEW_PROJECT_CHOICE_KEY);
      if (serialized === null) return null;
      let stored: unknown;
      try {
        stored = JSON.parse(serialized);
      } catch {
        // A damaged entry is only a preselection; the next choice replaces it.
        return null;
      }
      const { location, ownerId } = (stored ?? {}) as Partial<
        Record<keyof NewProjectChoice, unknown>
      >;
      if (
        !PROJECT_LOCATIONS.includes(location as ProjectLocation) ||
        typeof ownerId !== "string"
      )
        return null;
      return { location: location as ProjectLocation, ownerId };
    },
    save(choice: NewProjectChoice) {
      storage.setItem(NEW_PROJECT_CHOICE_KEY, JSON.stringify(choice));
    },
  };
}
