/**
 * UI lane (docs/testing.md: `src/infrastructure/viewport/`). Seam:
 * `createDeferredMeshBvhBuilder` with an injected idle scheduler. A delivery
 * queues the meshes without trees and builds none in the committing frame;
 * idle periods build them, at least one per period; a geometry that already
 * has its tree is never rebuilt; picking before the build (three's
 * brute-force raycast) reports the same hits as after it.
 */
import * as THREE from "three";
import { acceleratedRaycast } from "three-mesh-bvh";
import { expect, test } from "vitest";

import {
  createDeferredMeshBvhBuilder,
  type DeferredMeshBvhIdleScheduler,
} from "@/infrastructure/viewport/deferred-mesh-bvh";

type TreeGeometry = THREE.BufferGeometry & { boundsTree?: unknown };

function createManualScheduler() {
  const pending: Parameters<DeferredMeshBvhIdleScheduler>[0][] = [];
  const schedule: DeferredMeshBvhIdleScheduler = (run) => {
    pending.push(run);
    return () => {
      const index = pending.indexOf(run);
      if (index >= 0) pending.splice(index, 1);
    };
  };
  return {
    schedule,
    pending,
    runIdlePeriod(timeRemainingMs: number) {
      const run = pending.shift();
      if (!run) throw new Error("No idle period was requested.");
      run({ timeRemaining: () => timeRemainingMs });
    },
  };
}

function gridMesh(offset: number) {
  const geometry = new THREE.PlaneGeometry(4, 4, 16, 16);
  geometry.translate(0, 0, offset);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.updateMatrixWorld(true);
  return mesh;
}

function pickHits(root: THREE.Object3D) {
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(0.31, 0.17, 10),
    new THREE.Vector3(0, 0, -1),
  );
  (raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly =
    false;
  return raycaster
    .intersectObject(root, true)
    .map((hit) => [hit.object.uuid, hit.distance, hit.point.toArray()]);
}

test("a delivery's meshes are indexed in idle periods after the commit, picking the same hits before and after", () => {
  const scheduler = createManualScheduler();
  const builder = createDeferredMeshBvhBuilder(scheduler.schedule);
  const root = new THREE.Group();
  const meshes = [gridMesh(0), gridMesh(1), gridMesh(2)];
  root.add(...meshes);

  const bruteForceHits = pickHits(root);
  builder.indexMeshesUnder(root);
  expect(
    meshes.map((mesh) => (mesh.geometry as TreeGeometry).boundsTree),
    "nothing is built in the committing frame",
  ).toEqual([undefined, undefined, undefined]);
  expect(meshes.every((mesh) => mesh.raycast === acceleratedRaycast)).toBe(
    true,
  );
  expect(
    pickHits(root),
    "before its tree, the accelerated raycast falls back to brute force",
  ).toEqual(bruteForceHits);
  expect(scheduler.pending).toHaveLength(1);

  scheduler.runIdlePeriod(0);
  expect(
    meshes.map((mesh) => Boolean((mesh.geometry as TreeGeometry).boundsTree)),
    "an exhausted period still builds one tree",
  ).toEqual([true, false, false]);
  expect(scheduler.pending, "the rest waits for the next period").toHaveLength(
    1,
  );

  scheduler.runIdlePeriod(50);
  expect(
    meshes.every((mesh) => Boolean((mesh.geometry as TreeGeometry).boundsTree)),
  ).toBe(true);
  expect(scheduler.pending).toHaveLength(0);
  expect(pickHits(root), "the BVH picks the same hits").toEqual(bruteForceHits);
});

test("a surviving geometry keeps its tree; only the new geometry is queued, and an unmounted mesh is skipped", () => {
  const scheduler = createManualScheduler();
  const builder = createDeferredMeshBvhBuilder(scheduler.schedule);
  const root = new THREE.Group();
  const kept = gridMesh(0);
  root.add(kept);
  builder.indexMeshesUnder(root);
  scheduler.runIdlePeriod(50);
  const keptTree = (kept.geometry as TreeGeometry).boundsTree;
  expect(keptTree).toBeTruthy();

  const swapped = gridMesh(1);
  const removed = gridMesh(2);
  root.add(swapped, removed);
  builder.indexMeshesUnder(root);
  root.remove(removed);
  scheduler.runIdlePeriod(50);

  expect((kept.geometry as TreeGeometry).boundsTree).toBe(keptTree);
  expect((swapped.geometry as TreeGeometry).boundsTree).toBeTruthy();
  expect(
    (removed.geometry as TreeGeometry).boundsTree,
    "a mesh unmounted before its period is not indexed",
  ).toBeUndefined();

  builder.indexMeshesUnder(root);
  expect(scheduler.pending, "nothing left to index").toHaveLength(0);
});

test("a mesh with its own raycast is left alone, and cancel drops the queue", () => {
  const scheduler = createManualScheduler();
  const builder = createDeferredMeshBvhBuilder(scheduler.schedule);
  const root = new THREE.Group();
  const custom = gridMesh(0);
  const customRaycast = () => {};
  custom.raycast = customRaycast;
  const queued = gridMesh(1);
  root.add(custom, queued);

  builder.indexMeshesUnder(root);
  expect(custom.raycast).toBe(customRaycast);
  builder.cancel();
  expect(scheduler.pending).toHaveLength(0);
  expect((queued.geometry as TreeGeometry).boundsTree).toBeUndefined();
  expect((custom.geometry as TreeGeometry).boundsTree).toBeUndefined();
});
