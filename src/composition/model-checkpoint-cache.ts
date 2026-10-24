/**
 * cadara-3sq.6: the filesystem model checkpoint cache for headless callers.
 * The CLI configures it (environment, diagnostics); the store lives in
 * infrastructure. Importing this module loads no kernel.
 */
export {
  createFileModelCheckpointStore,
  isModelCheckpointCacheFailure,
  MODEL_CHECKPOINT_CACHE_MAX_BYTES,
  resolveModelCheckpointCacheRoot,
} from "@/infrastructure/modeling/model-checkpoint-file-store";
