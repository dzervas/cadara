import * as THREE from "three";
import { SAH, acceleratedRaycast, computeBoundsTree } from "three-mesh-bvh";

/** The pick BVH options (drei `<Bvh>` defaults, which picking was tuned on). */
const PICK_MESH_BVH_OPTIONS = {
  strategy: SAH,
  verbose: false,
  setBoundingBox: true,
  maxDepth: 40,
  maxLeafTris: 10,
  indirect: false,
} as const;

/**
 * Picking BVHs built after the frame that delivered their meshes, a few per
 * idle period, instead of all at once when the meshes mount: on the wheel a
 * fillet's delivery spent 30-100 ms building every face's tree in one frame.
 *
 * Every mesh with three's standard raycast is switched to
 * `acceleratedRaycast` at once. Until its geometry's tree is built, that
 * raycast falls back to three's brute-force `Mesh.raycast`, which reports
 * the same intersections (picking asks for all hits, `firstHitOnly` false),
 * only slower. A geometry keeps its tree for its lifetime, so a mesh whose
 * geometry object survives a snapshot is not re-indexed.
 */
export interface DeferredMeshBvhBuilder {
  /** Queue the meshes under `root` whose geometry has no tree yet. */
  indexMeshesUnder(root: THREE.Object3D): void;
  /** Drop queued builds (the root unmounted). */
  cancel(): void;
}

/** One idle period: `timeRemaining` as in `IdleDeadline`. */
export type DeferredMeshBvhIdleScheduler = (
  run: (deadline: { timeRemaining(): number }) => void,
) => () => void;

const IDLE_BUILD_TIMEOUT_MS = 500;
const TIMER_SLICE_MS = 8;

/**
 * `requestIdleCallback` where it exists, with a timeout so a continuously
 * busy page still indexes; elsewhere (Safari) one timer task of 8 ms.
 */
const scheduleDeferredMeshBvhIdle: DeferredMeshBvhIdleScheduler = (run) => {
  if (typeof globalThis.requestIdleCallback === "function") {
    const handle = globalThis.requestIdleCallback(run, {
      timeout: IDLE_BUILD_TIMEOUT_MS,
    });
    return () => globalThis.cancelIdleCallback(handle);
  }

  const handle = setTimeout(() => {
    const end = performance.now() + TIMER_SLICE_MS;
    run({ timeRemaining: () => Math.max(0, end - performance.now()) });
  }, 0);
  return () => clearTimeout(handle);
};

type BoundsTreeGeometry = THREE.BufferGeometry & { boundsTree?: unknown };

export function createDeferredMeshBvhBuilder(
  schedule: DeferredMeshBvhIdleScheduler = scheduleDeferredMeshBvhIdle,
): DeferredMeshBvhBuilder {
  const queue = new Map<THREE.Mesh, THREE.Object3D>();
  let cancelScheduled: (() => void) | null = null;

  const buildQueued = (deadline: { timeRemaining(): number }) => {
    cancelScheduled = null;
    let built = 0;
    for (const [mesh, root] of queue) {
      // At least one tree per period, so a timed-out callback still advances.
      if (built > 0 && deadline.timeRemaining() <= 0) break;
      queue.delete(mesh);
      const geometry = mesh.geometry as BoundsTreeGeometry;
      if (geometry.boundsTree || !isUnder(mesh, root)) continue;
      computeBoundsTree.call(geometry, PICK_MESH_BVH_OPTIONS);
      built += 1;
    }
    if (queue.size > 0) cancelScheduled = schedule(buildQueued);
  };

  return {
    indexMeshesUnder(root) {
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        // Like drei's `Bvh`: a mesh with its own raycast keeps it.
        if (object.raycast === THREE.Mesh.prototype.raycast) {
          object.raycast = acceleratedRaycast;
        }
        if (
          object.raycast === acceleratedRaycast &&
          !(object.geometry as BoundsTreeGeometry).boundsTree
        ) {
          queue.set(object, root);
        }
      });
      if (queue.size > 0 && !cancelScheduled) {
        cancelScheduled = schedule(buildQueued);
      }
    },
    cancel() {
      queue.clear();
      cancelScheduled?.();
      cancelScheduled = null;
    },
  };
}

/** A mesh unmounted (or moved out) since it was queued is skipped. */
function isUnder(object: THREE.Object3D, root: THREE.Object3D) {
  for (
    let current: THREE.Object3D | null = object;
    current;
    current = current.parent
  ) {
    if (current === root) return true;
  }
  return false;
}
