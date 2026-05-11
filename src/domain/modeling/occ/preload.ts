export interface OccRuntimeOwner {
  preload(): Promise<unknown>;
}

export interface OccPreloadController {
  preload(): Promise<void>;
  reset(): void;
}

export function createOccPreloadController(
  owner: OccRuntimeOwner,
): OccPreloadController {
  let preloadPromise: Promise<void> | null = null;

  return {
    preload() {
      if (!preloadPromise) {
        preloadPromise = owner
          .preload()
          .then(() => undefined)
          .catch((error: unknown) => {
            preloadPromise = null;
            throw error;
          });
      }

      return preloadPromise;
    },
    reset() {
      preloadPromise = null;
    },
  };
}
