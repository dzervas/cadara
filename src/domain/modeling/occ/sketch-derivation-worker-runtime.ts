import {
  SKETCH_REGION_DERIVATION_MINIMUM_SUPERSEDE_AGE_MS,
  SketchRegionDerivationWorkerPool,
} from "@/domain/modeling/occ/sketch-derivation-worker-client";
import { canUseOccModuleWorker } from "@/domain/modeling/occ/worker-runtime";

let browserSketchRegionDerivation: SketchRegionDerivationWorkerPool | null =
  null;

/**
 * The page's live sketch-region derivation, in dedicated workers spawned on
 * demand; null without module-worker support (the solver then derives on its
 * own thread).
 */
export function getBrowserSketchRegionDerivation() {
  if (!browserSketchRegionDerivation && canUseOccModuleWorker()) {
    browserSketchRegionDerivation = new SketchRegionDerivationWorkerPool({
      createWorker: () =>
        new Worker(new URL("./sketch-derivation.worker.ts", import.meta.url), {
          type: "module",
        }),
      minimumSupersedeAgeMs: SKETCH_REGION_DERIVATION_MINIMUM_SUPERSEDE_AGE_MS,
    });
  }
  return browserSketchRegionDerivation;
}
