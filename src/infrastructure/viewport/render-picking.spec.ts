import { test, expect, assert } from "vitest";
import * as THREE from "three";

import type {
  RenderableEntityRecord,
  RenderMeshGeometry,
} from "@/contracts/render/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  MARKER_SPHERE_GEOMETRY,
  GEOMETRY_HIGHLIGHT_COLORS,
  DEFAULT_LINE_PICK_RADIUS_PX,
  DEFAULT_LINE_PICK_THRESHOLD,
  bindFaceHoverPerimeterObject,
  collectRaycastPickCandidates,
  bindRenderableObject,
  collectBindings,
  createMeshBoundaryLineSegmentsGeometry,
  createInvisiblePickMaterial,
  createMarkerPickProxy,
  createRenderableLineMaterial,
  createRenderableMeshMaterial,
  createProjectedPickCandidate,
  getVisibleMarkerRadius,
  getWorldUnitsPerPixelAt,
  intersectObjectsWithLinePickRadius,
  resolveAllCandidates,
  shouldIncludeProjectedPickCandidate,
  updateWorkspaceHighlight,
} from "@/infrastructure/viewport/render-picking";

/**
 * T17o (G5): the raycast pick resolution the viewport performs, composed
 * from the module's public seams (the spec-only production export
 * `resolvePickTarget` is deleted).
 */
function resolvePickTarget(
  intersections: THREE.Intersection<THREE.Object3D>[],
  acceptsTarget: ((target: PrimitiveRef) => boolean) | null = null,
  options: Parameters<typeof resolveAllCandidates>[2] = {},
) {
  return resolveAllCandidates(
    collectRaycastPickCandidates(intersections),
    acceptsTarget,
    options,
  );
}

test("src/infrastructure/viewport/render-picking.spec.ts", async () => {
  function assertEqual<T>(
    actual: T,
    expected: T,
    message = "Expected values to be equal",
  ) {
    if (actual !== expected) {
      throw new Error(
        `${message}: expected ${String(expected)}, received ${String(actual)}`,
      );
    }
  }

  function assertDeepEqual(
    actual: unknown,
    expected: unknown,
    message = "Expected values to be deeply equal",
  ) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);

    if (actualJson !== expectedJson) {
      throw new Error(
        `${message}: expected ${expectedJson}, received ${actualJson}`,
      );
    }
  }

  const faceRenderable: RenderableEntityRecord = {
    id: "renderable_face",
    label: "Face",
    ownerBodyId: "body_a",
    ownerFeatureId: null,
    binding: {
      pickId: "pick_face",
      pickPriority: 20,
      target: { kind: "face", bodyId: "body_a", faceId: "face_top" },
      topology: "face",
      semanticClass: "bodyFace",
    },
    geometry: {
      kind: "mesh",
      vertexPositions: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ],
      vertexNormals: [
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
      ],
      triangleIndices: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    },
  };

  const edgeRenderable: RenderableEntityRecord = {
    id: "renderable_edge",
    label: "Edge",
    ownerBodyId: "body_a",
    ownerFeatureId: null,
    binding: {
      pickId: "pick_edge",
      pickPriority: 10,
      target: { kind: "edge", bodyId: "body_a", edgeId: "edge_top" },
      topology: "edge",
      semanticClass: "featureEdge",
    },
    geometry: {
      kind: "polyline",
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      isClosed: false,
    },
  };

  const vertexRenderable: RenderableEntityRecord = {
    id: "renderable_vertex",
    label: "Vertex",
    ownerBodyId: "body_a",
    ownerFeatureId: null,
    binding: {
      pickId: "pick_vertex",
      pickPriority: 0,
      target: {
        kind: "vertex",
        bodyId: "body_a",
        vertexId: "vertex_top_right",
      },
      topology: "vertex",
      semanticClass: "featureVertex",
    },
    geometry: {
      kind: "marker",
      position: [1, 0, 0],
      displayRadius: 0.25,
    },
  };

  function createBoundMesh(renderable: RenderableEntityRecord) {
    const geometry = new THREE.BufferGeometry();
    if (renderable.geometry.kind !== "mesh") {
      throw new Error("Expected mesh renderable.");
    }

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        renderable.geometry.vertexPositions.flat(),
        3,
      ),
    );
    geometry.setIndex(renderable.geometry.triangleIndices.flat());
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(
        renderable.geometry.vertexNormals?.flat() ?? [0, 0, 1],
        3,
      ),
    );

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    bindRenderableObject(
      mesh,
      renderable.binding.pickId,
      renderable.binding.target,
      renderable.binding.semanticClass,
      "document",
      renderable,
    );
    return mesh;
  }

  function createBoundLine(renderable: RenderableEntityRecord) {
    if (renderable.geometry.kind !== "polyline") {
      throw new Error("Expected polyline renderable.");
    }

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        renderable.geometry.points.map(
          (point) => new THREE.Vector3(point[0], point[1], point[2]),
        ),
      ),
      new THREE.LineBasicMaterial(),
    );
    bindRenderableObject(
      line,
      renderable.binding.pickId,
      renderable.binding.target,
      renderable.binding.semanticClass,
      "document",
      renderable,
    );
    return line;
  }

  function createBoundMarker(renderable: RenderableEntityRecord) {
    if (renderable.geometry.kind !== "marker") {
      throw new Error("Expected marker renderable.");
    }

    const group = new THREE.Group();
    const visibleMesh = new THREE.Mesh(
      MARKER_SPHERE_GEOMETRY,
      new THREE.MeshStandardMaterial(),
    );
    visibleMesh.position.set(...renderable.geometry.position);
    visibleMesh.scale.setScalar(
      getVisibleMarkerRadius(renderable.geometry.displayRadius),
    );

    const pickProxy = createMarkerPickProxy(
      renderable.geometry.position,
      renderable.geometry.displayRadius,
    );
    pickProxy.userData.highlightExcluded = true;

    group.add(visibleMesh);
    group.add(pickProxy);
    bindRenderableObject(
      group,
      renderable.binding.pickId,
      renderable.binding.target,
      renderable.binding.semanticClass,
      "document",
      renderable,
    );

    return { group, visibleMesh, pickProxy };
  }

  function createFacePerimeterLine(renderable: RenderableEntityRecord) {
    if (renderable.geometry.kind !== "mesh") {
      throw new Error("Expected mesh renderable.");
    }

    if (
      renderable.binding.semanticClass !== "bodyFace" &&
      renderable.binding.semanticClass !== "planarFace"
    ) {
      throw new Error("Expected face renderable.");
    }

    const line = new THREE.LineSegments(
      createMeshBoundaryLineSegmentsGeometry(renderable.geometry),
      new THREE.LineBasicMaterial({
        color: GEOMETRY_HIGHLIGHT_COLORS.hover,
        transparent: true,
        opacity: 0,
      }),
    );
    bindFaceHoverPerimeterObject(
      line,
      renderable.binding.target,
      renderable.binding.semanticClass,
      "document",
    );
    return line;
  }

  function createIntersection(object: THREE.Object3D, distance: number) {
    return {
      distance,
      object,
    } as THREE.Intersection<THREE.Object3D>;
  }

  function createBoundObject(renderable: RenderableEntityRecord) {
    const object = new THREE.Object3D();
    bindRenderableObject(
      object,
      renderable.binding.pickId,
      renderable.binding.target,
      renderable.binding.semanticClass,
      "document",
      renderable,
    );
    return object;
  }

  {
    const faceMesh = createBoundMesh(faceRenderable);
    const edgeLine = createBoundLine(edgeRenderable);

    // This is intentionally beyond the inclusive face/wire occlusion tolerance;
    // wires inside that tolerance are treated as pickable at the face boundary.
    const resolved = resolvePickTarget([
      createIntersection(edgeLine, 0.811),
      createIntersection(faceMesh, 0.8),
    ]);

    assertDeepEqual(
      resolved?.target,
      faceRenderable.binding.target,
      "Closer faces must win when they are nearer than competing edges.",
    );
  }

  {
    const faceMesh = createBoundMesh(faceRenderable);

    const faceResolved = resolvePickTarget(
      [createIntersection(faceMesh, 0.5)],
      (target) => target.kind === "face",
    );
    assertDeepEqual(
      faceResolved?.target,
      faceRenderable.binding.target,
      "Face filters must keep selecting the exact face hit.",
    );

    const bodyResolved = resolvePickTarget(
      [createIntersection(faceMesh, 0.5)],
      (target) => target.kind === "body",
    );
    assertDeepEqual(
      bodyResolved?.target,
      { kind: "body", bodyId: "body_a" },
      "Body filters must resolve a face hit to the owning body.",
    );
  }

  {
    const faceMesh = createBoundMesh(faceRenderable);
    const edgeLine = createBoundLine(edgeRenderable);

    const resolved = resolvePickTarget([
      createIntersection(edgeLine, 1.1),
      createIntersection(faceMesh, 0.8),
    ]);

    assertDeepEqual(
      resolved?.target,
      faceRenderable.binding.target,
      "Faces must win when the edge is clearly occluded behind them.",
    );
  }

  {
    const faceMesh = createBoundMesh(faceRenderable);
    const edgeLine = createBoundLine(edgeRenderable);

    const resolved = resolvePickTarget([
      createIntersection(faceMesh, 1),
      createIntersection(edgeLine, 1),
    ]);

    assertDeepEqual(
      resolved?.target,
      edgeRenderable.binding.target,
      "Equal-distance ties must still prefer lower pickPriority.",
    );
  }

  {
    const constructionRenderable: RenderableEntityRecord = {
      id: "renderable_construction_plane",
      label: "XY Plane",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_construction_plane",
        pickPriority: 5,
        target: {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        topology: null,
        semanticClass: "construction",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [2, 0, 0],
          [0, 2, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [[0, 1, 2]],
      },
    };
    const sketchRenderable: RenderableEntityRecord = {
      id: "renderable_sketch_curve",
      label: "Sketch curve",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_sketch_curve",
        pickPriority: 12,
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_a",
          entityId: "sketch_entity_a",
        },
        topology: null,
        semanticClass: "sketchCurve",
      },
      geometry: {
        kind: "polyline",
        points: [
          [0, 0, 0],
          [2, 0, 0],
        ],
        isClosed: false,
      },
    };
    const construction = createBoundObject(constructionRenderable);
    const sketch = createBoundObject(sketchRenderable);

    const resolved = resolvePickTarget([
      createIntersection(construction, 1),
      createIntersection(sketch, 1.003),
    ]);

    assertDeepEqual(
      resolved?.target,
      sketchRenderable.binding.target,
      "Coplanar sketch curves must beat construction planes even when the plane has a slightly nearer ray hit.",
    );
  }

  {
    const constructionRenderable: RenderableEntityRecord = {
      id: "renderable_construction_plane_region",
      label: "XY Plane",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_construction_plane_region",
        pickPriority: 5,
        target: {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        topology: null,
        semanticClass: "construction",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [2, 0, 0],
          [0, 2, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [[0, 1, 2]],
      },
    };
    const regionRenderable: RenderableEntityRecord = {
      id: "renderable_region",
      label: "Region",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_region",
        pickPriority: 8,
        target: { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
        topology: null,
        semanticClass: "region",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [2, 0, 0],
          [0, 2, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [[0, 1, 2]],
      },
    };
    const construction = createBoundObject(constructionRenderable);
    const region = createBoundObject(regionRenderable);

    const resolved = resolvePickTarget([
      createIntersection(construction, 1),
      createIntersection(region, 1.003),
    ]);

    assertDeepEqual(
      resolved?.target,
      regionRenderable.binding.target,
      "Coplanar regions must beat construction planes within same-layer tolerance.",
    );
  }

  {
    const regionRenderable: RenderableEntityRecord = {
      id: "renderable_region_boundary",
      label: "Region",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_region_boundary",
        pickPriority: 8,
        target: { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
        topology: null,
        semanticClass: "region",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [2, 0, 0],
          [0, 2, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [[0, 1, 2]],
      },
    };
    const sketchRenderable: RenderableEntityRecord = {
      id: "renderable_sketch_curve_boundary",
      label: "Sketch curve",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_sketch_curve_boundary",
        pickPriority: 12,
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_a",
          entityId: "sketch_entity_a",
        },
        topology: null,
        semanticClass: "sketchCurve",
      },
      geometry: {
        kind: "polyline",
        points: [
          [0, 0, 0],
          [2, 0, 0],
        ],
        isClosed: false,
      },
    };
    const region = createBoundObject(regionRenderable);
    const sketch = createBoundObject(sketchRenderable);
    const intersections = [
      createIntersection(region, 1),
      createIntersection(sketch, 1),
    ];

    const curveResolved = resolvePickTarget(intersections);
    assertDeepEqual(
      curveResolved?.target,
      sketchRenderable.binding.target,
      "Sketch curves must beat filled regions at the same apparent depth.",
    );

    const regionResolved = resolvePickTarget(
      intersections,
      (target) => target.kind === "region",
    );
    assertDeepEqual(
      regionResolved?.target,
      regionRenderable.binding.target,
      "Active selection filters must allow region picking when overlapping curves are rejected.",
    );
  }

  {
    const firstRegionRenderable: RenderableEntityRecord = {
      id: "renderable_region_a",
      label: "Region A",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_region_a",
        pickPriority: 8,
        target: { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
        topology: null,
        semanticClass: "region",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [2, 0, 0],
          [0, 2, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [[0, 1, 2]],
      },
    };
    const secondRegionRenderable: RenderableEntityRecord = {
      ...firstRegionRenderable,
      id: "renderable_region_b",
      label: "Region B",
      binding: {
        ...firstRegionRenderable.binding,
        pickId: "pick_region_b",
        target: { kind: "region", sketchId: "sketch_a", regionId: "region_b" },
        // Required to let ts check the type of the target
        topology: null,
        semanticClass: "region",
      },
    };
    const first = createBoundObject(firstRegionRenderable);
    const second = createBoundObject(secondRegionRenderable);

    const forward = resolvePickTarget([
      createIntersection(first, 1),
      createIntersection(second, 1),
    ]);
    const reverse = resolvePickTarget([
      createIntersection(second, 1),
      createIntersection(first, 1),
    ]);

    assertDeepEqual(
      forward?.target,
      reverse?.target,
      "Equal candidates must resolve to the same target regardless of raycaster hit order.",
    );
  }

  {
    const sketchTarget: PrimitiveRef = {
      kind: "sketchEntity",
      sketchId: "sketch_a",
      entityId: "sketch_entity_1",
    };
    const sketchLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
      ]),
      new THREE.LineBasicMaterial(),
    );
    bindRenderableObject(
      sketchLine,
      null,
      sketchTarget,
      "sketchCurve",
      "document",
    );

    const resolved = resolvePickTarget([createIntersection(sketchLine, 0.25)]);

    assertDeepEqual(
      resolved?.target,
      sketchTarget,
      "Sketch display targets must resolve through the same resolver without a renderable record.",
    );
    assertEqual(
      resolved?.pickId ?? null,
      null,
      "Sketch display hits should not require a pickId.",
    );
  }

  {
    const sketchTarget: PrimitiveRef = {
      kind: "sketchEntity",
      sketchId: "sketch_a",
      entityId: "sketch_entity_styled",
    };
    const material = new THREE.LineBasicMaterial({
      color: 0x33ffaa,
      transparent: true,
      opacity: 0.5,
    });
    const sketchLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
      ]),
      material,
    );
    const root = new THREE.Group();
    root.add(sketchLine);
    bindRenderableObject(
      sketchLine,
      null,
      sketchTarget,
      "sketchCurve",
      "document",
    );

    const bindings = collectBindings(root);
    assert(bindings);

    updateWorkspaceHighlight(bindings.targetToObjects, [], sketchTarget);
    assertEqual(
      material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.hover,
      "Hovered styled sketch lines should still receive hover highlight.",
    );
    assertEqual(
      material.opacity,
      0.98,
      "Hovered styled sketch lines should still receive hover opacity.",
    );

    updateWorkspaceHighlight(bindings.targetToObjects, [], null);
    assertEqual(
      material.color.getHex(),
      0x33ffaa,
      "Inactive styled sketch lines should restore authored color after hover.",
    );
    assertEqual(
      material.opacity,
      0.5,
      "Inactive styled sketch lines should restore authored opacity after hover.",
    );

    updateWorkspaceHighlight(bindings.targetToObjects, [sketchTarget], null);
    assertEqual(
      material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.selected,
      "Selected styled sketch lines should still receive selected highlight.",
    );

    updateWorkspaceHighlight(bindings.targetToObjects, [], null);
    assertEqual(
      material.color.getHex(),
      0x33ffaa,
      "Inactive styled sketch lines should restore authored color after selection.",
    );

    sketchLine.geometry.dispose();
    material.dispose();
  }

  {
    const material = createRenderableLineMaterial(edgeRenderable, "document");
    assertEqual(
      material.depthTest,
      true,
      "Committed edges should still depth-test against nearer faces.",
    );
    assertEqual(
      material.depthWrite,
      false,
      "Committed edges must not write depth and destabilize coplanar wires.",
    );
    material.dispose();
  }

  {
    const faceMesh = createBoundMesh(faceRenderable);
    const facePerimeter = createFacePerimeterLine(faceRenderable);
    const root = new THREE.Group();
    root.add(faceMesh);
    root.add(facePerimeter);

    const bindings = collectBindings(root);
    assert(bindings);

    expect(
      bindings.pickables.includes(facePerimeter),
      "Face hover perimeter overlays must not be pickable.",
    ).toBeFalsy();

    expect(
      faceMesh.material instanceof THREE.MeshStandardMaterial,
    ).toBeTruthy();
    expect(
      facePerimeter.material instanceof THREE.LineBasicMaterial,
    ).toBeTruthy();
    const baselineFaceColor = faceMesh.material.color.getHex();

    updateWorkspaceHighlight(
      bindings.targetToObjects,
      [],
      faceRenderable.binding.target,
    );

    assertEqual(
      faceMesh.material.color.getHex(),
      baselineFaceColor,
      "Hovered face meshes must keep their surface color.",
    );
    assertEqual(
      facePerimeter.material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.hover,
      "Hovered face perimeter overlays must receive the hover color.",
    );
    assertEqual(
      facePerimeter.material.opacity,
      0.98,
      "Hovered face perimeter overlays must become visible.",
    );

    updateWorkspaceHighlight(
      bindings.targetToObjects,
      [faceRenderable.binding.target],
      faceRenderable.binding.target,
    );

    assertEqual(
      faceMesh.material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.selected,
      "Selected face meshes must keep whole-face selected coloring.",
    );
    assertEqual(
      facePerimeter.material.opacity,
      0,
      "Selected face perimeter overlays must stay hidden.",
    );
  }

  {
    const faceMesh = createBoundMesh(faceRenderable);
    const edgeLine = createBoundLine(edgeRenderable);
    const root = new THREE.Group();
    root.add(faceMesh);
    root.add(edgeLine);

    const bindings = collectBindings(root);
    assert(bindings);

    updateWorkspaceHighlight(
      bindings.targetToObjects,
      [{ kind: "body", bodyId: "body_a" }],
      null,
    );

    expect(
      faceMesh.material instanceof THREE.MeshStandardMaterial,
    ).toBeTruthy();
    assertEqual(
      faceMesh.material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.selected,
      "Selected body targets must highlight owned face renderables.",
    );
    expect(edgeLine.material instanceof THREE.LineBasicMaterial).toBeTruthy();
    assertEqual(
      edgeLine.material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.selected,
      "Selected body targets must highlight owned edge renderables.",
    );
  }

  {
    const marker = createBoundMarker(vertexRenderable);
    const root = new THREE.Group();
    root.add(marker.group);

    const bindings = collectBindings(root);
    assert(bindings);
    expect(
      bindings.pickables.includes(marker.group),
      "collectBindings must include marker group roots as pickables.",
    ).toBeTruthy();

    const objects =
      bindings.targetToObjects.get("vertex:body_a:vertex_top_right") ?? [];
    assertEqual(
      objects.length,
      1,
      "Only the visible marker mesh should be highlightable.",
    );
    assertEqual(
      objects[0],
      marker.visibleMesh,
      "The visible mesh must be stored in targetToObjects.",
    );
  }

  {
    const marker = createBoundMarker(vertexRenderable);
    const root = new THREE.Group();
    root.add(marker.group);

    const bindings = collectBindings(root);
    assert(bindings);

    updateWorkspaceHighlight(
      bindings.targetToObjects,
      [vertexRenderable.binding.target],
      null,
    );

    expect(
      marker.visibleMesh.material instanceof THREE.MeshStandardMaterial,
    ).toBeTruthy();
    assertEqual(
      marker.visibleMesh.material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.selected,
      "Selected marker mesh must receive the selected wire color.",
    );
    expect(
      marker.pickProxy.material instanceof THREE.MeshBasicMaterial,
    ).toBeTruthy();
    assertEqual(
      marker.pickProxy.material.opacity,
      0,
      "Marker pick proxy must remain invisible.",
    );
  }

  {
    const marker = createBoundMarker(vertexRenderable);
    const root = new THREE.Group();
    root.add(marker.group);

    const bindings = collectBindings(root);
    assert(bindings);

    updateWorkspaceHighlight(bindings.targetToObjects, [], null, [
      vertexRenderable.binding.target,
    ]);

    expect(
      marker.visibleMesh.material instanceof THREE.MeshStandardMaterial,
    ).toBeTruthy();
    assertEqual(
      marker.visibleMesh.material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.hover,
      "Annotation-related geometry must receive hover highlight without becoming selected.",
    );
  }

  {
    const boundaryGeometry = createMeshBoundaryLineSegmentsGeometry(
      faceRenderable.geometry as RenderMeshGeometry,
    );
    const position = boundaryGeometry.getAttribute("position");
    assertEqual(
      position.count,
      8,
      "Two triangle quad meshes should produce four boundary line segments.",
    );

    const segmentKeys = new Set<string>();
    for (let index = 0; index < position.count; index += 2) {
      const start = `${position.getX(index)},${position.getY(index)},${position.getZ(index)}`;
      const end = `${position.getX(index + 1)},${position.getY(index + 1)},${position.getZ(index + 1)}`;
      segmentKeys.add(start < end ? `${start}|${end}` : `${end}|${start}`);
    }

    expect(
      segmentKeys.has("0,0,0|1,1,0"),
      "Face perimeter extraction must exclude internal triangulation diagonals.",
    ).toBeFalsy();
    boundaryGeometry.dispose();
  }

  {
    const invisible = createInvisiblePickMaterial();
    assertEqual(
      invisible.opacity,
      0,
      "Invisible pick material must stay fully transparent.",
    );
    assertEqual(
      invisible.colorWrite,
      false,
      "Invisible pick material must not write color.",
    );
  }

  {
    assertEqual(
      DEFAULT_LINE_PICK_THRESHOLD,
      0.75,
      "Line picking must use the stable default threshold.",
    );
  }

  {
    const regionRenderable: RenderableEntityRecord = {
      id: "renderable_region_material_offset",
      label: "Region",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_region_material_offset",
        pickPriority: 8,
        target: {
          kind: "region",
          sketchId: "sketch_a",
          regionId: "region_material_offset",
        },
        topology: null,
        semanticClass: "region",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [2, 0, 0],
          [0, 2, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [[0, 1, 2]],
      },
    };
    const material = createRenderableMeshMaterial(regionRenderable, "document");
    expect(
      material.polygonOffsetFactor < 0 && material.polygonOffsetUnits < 0,
      "Committed sketch regions should be biased toward the camera to avoid coplanar depth flicker.",
    ).toBeTruthy();
    material.dispose();
  }

  {
    const constructionRenderable: RenderableEntityRecord = {
      id: "renderable_feature_plane",
      label: "Feature plane",
      ownerBodyId: null,
      ownerFeatureId: "feature_plane-1",
      binding: {
        pickId: "pick_feature_plane",
        pickPriority: 40,
        target: {
          kind: "construction",
          constructionId: "construction_feature_plane-1",
        },
        topology: null,
        semanticClass: "construction",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
          [0, 1, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [
          [0, 1, 2],
          [0, 2, 3],
        ],
      },
    };
    const material = createRenderableMeshMaterial(
      constructionRenderable,
      "document",
    );
    expect(
      material.transparent && material.opacity === 0.12 && !material.depthWrite,
      "Document construction planes should honor their faint plane opacity instead of rendering as opaque cyan surfaces.",
    ).toBeTruthy();
    material.dispose();
  }

  {
    const faceMesh = createBoundMesh(faceRenderable);
    const projectedVertex = createProjectedPickCandidate({
      pickId: vertexRenderable.binding.pickId,
      target: vertexRenderable.binding.target,
      renderable: vertexRenderable,
      semanticClass: "featureVertex",
      priority: vertexRenderable.binding.pickPriority,
      screenDistance: 40,
      depth: 0.4,
    });

    const resolved = resolveAllCandidates([
      ...collectRaycastPickCandidates([createIntersection(faceMesh, 0.5)]),
      projectedVertex,
    ]);

    assertDeepEqual(
      resolved?.target,
      vertexRenderable.binding.target,
      "Unified picking must prefer an in-radius projected vertex over a raycast face.",
    );
  }

  {
    const edgeLine = createBoundLine(edgeRenderable);
    const projectedEdge = createProjectedPickCandidate({
      pickId: "projected_edge",
      target: { kind: "edge", bodyId: "body_a", edgeId: "edge_projected" },
      semanticClass: "featureEdge",
      screenDistance: 1,
      depth: 0,
      stableKey: "projected:edge",
    });

    const resolved = resolveAllCandidates([
      projectedEdge,
      ...collectRaycastPickCandidates([createIntersection(edgeLine, 0.5)]),
    ]);

    assertDeepEqual(
      resolved?.target,
      edgeRenderable.binding.target,
      "Projected non-point candidates must not displace same-rank raycast hits.",
    );
  }

  {
    const currentHover = vertexRenderable.binding.target;

    assertEqual(
      shouldIncludeProjectedPickCandidate({
        target: currentHover,
        currentHoverTarget: currentHover,
        screenDistance: 50,
      }),
      true,
      "Current hover must remain active inside the projected-point exit radius.",
    );
    assertDeepEqual(
      resolveAllCandidates([
        createProjectedPickCandidate({
          pickId: vertexRenderable.binding.pickId,
          target: currentHover,
          renderable: vertexRenderable,
          semanticClass: "featureVertex",
          screenDistance: 50,
          depth: 0,
        }),
      ])?.target,
      currentHover,
      "A hysteresis-retained projected candidate must still resolve to the current target.",
    );
    assertEqual(
      shouldIncludeProjectedPickCandidate({
        target: currentHover,
        currentHoverTarget: currentHover,
        screenDistance: 60,
      }),
      false,
      "Current hover must clear beyond the projected-point exit radius.",
    );
  }

  {
    const faceMesh = createBoundMesh(faceRenderable);
    const edgeLine = createBoundLine(edgeRenderable);

    const atBoundary = resolvePickTarget([
      createIntersection(faceMesh, 1),
      createIntersection(edgeLine, 1.01),
    ]);
    assertDeepEqual(
      atBoundary?.target,
      edgeRenderable.binding.target,
      "Wires exactly at the occlusion tolerance behind a face must remain pickable.",
    );

    const beyondBoundary = resolvePickTarget([
      createIntersection(faceMesh, 1),
      createIntersection(edgeLine, 1.011),
    ]);
    assertDeepEqual(
      beyondBoundary?.target,
      faceRenderable.binding.target,
      "Wires beyond the occlusion tolerance must be occluded by the face.",
    );
  }

  {
    const faceMesh = createBoundMesh(faceRenderable);
    const edgeLine = createBoundLine(edgeRenderable);

    const measureBoundary = resolvePickTarget(
      [createIntersection(faceMesh, 1), createIntersection(edgeLine, 1.001)],
      null,
      { wireOcclusionTolerance: 0.001 },
    );
    assertDeepEqual(
      measureBoundary?.target,
      edgeRenderable.binding.target,
      "Custom wire occlusion tolerances should still allow truly same-surface wires to resolve ahead of faces.",
    );

    const measureOccluded = resolvePickTarget(
      [createIntersection(faceMesh, 1), createIntersection(edgeLine, 1.002)],
      null,
      { wireOcclusionTolerance: 0.001 },
    );
    assertDeepEqual(
      measureOccluded?.target,
      faceRenderable.binding.target,
      "Tighter wire occlusion tolerances should block hidden wires that sit behind a visible face.",
    );
  }

  {
    const constructionRenderable: RenderableEntityRecord = {
      id: "renderable_construction_boundary",
      label: "XY Plane",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_construction_boundary",
        pickPriority: 5,
        target: {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        topology: null,
        semanticClass: "construction",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [2, 0, 0],
          [0, 2, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [[0, 1, 2]],
      },
    };
    const regionRenderable: RenderableEntityRecord = {
      id: "renderable_region_same_layer_boundary",
      label: "Region",
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: "pick_region_same_layer_boundary",
        pickPriority: 8,
        target: {
          kind: "region",
          sketchId: "sketch_a",
          regionId: "region_boundary",
        },
        topology: null,
        semanticClass: "region",
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [2, 0, 0],
          [0, 2, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [[0, 1, 2]],
      },
    };
    const construction = createBoundObject(constructionRenderable);
    const region = createBoundObject(regionRenderable);

    assertDeepEqual(
      resolvePickTarget([
        createIntersection(construction, 1),
        createIntersection(region, 1.003),
      ])?.target,
      regionRenderable.binding.target,
      "Same-layer tolerance must prefer the higher-ranked candidate at 0.003.",
    );
    assertDeepEqual(
      resolvePickTarget([
        createIntersection(construction, 1),
        createIntersection(region, 1.004),
      ])?.target,
      regionRenderable.binding.target,
      "Same-layer tolerance must be inclusive at exactly 0.004.",
    );
    assertDeepEqual(
      resolvePickTarget([
        createIntersection(construction, 1),
        createIntersection(region, 1.005),
      ])?.target,
      constructionRenderable.binding.target,
      "Same-layer tolerance must switch to depth ordering beyond 0.004.",
    );
  }

  {
    const nearRenderable: RenderableEntityRecord = {
      ...vertexRenderable,
      id: "renderable_duplicate_near",
      binding: {
        ...vertexRenderable.binding,
        pickId: "pick_duplicate_vertex",
        topology: "vertex",
        semanticClass: "featureVertex",
        target: {
          kind: "vertex",
          bodyId: "body_a",
          vertexId: "vertex_duplicate_near",
        },
      },
    };
    const farRenderable: RenderableEntityRecord = {
      ...vertexRenderable,
      id: "renderable_duplicate_far",
      binding: {
        ...vertexRenderable.binding,
        pickId: "pick_duplicate_vertex",
        topology: "vertex",
        semanticClass: "featureVertex",
        target: {
          kind: "vertex",
          bodyId: "body_a",
          vertexId: "vertex_duplicate_far",
        },
      },
    };
    const near = createBoundObject(nearRenderable);
    const far = createBoundObject(farRenderable);

    const forward = resolvePickTarget([
      createIntersection(far, 2),
      createIntersection(near, 1),
    ]);
    const reverse = resolvePickTarget([
      createIntersection(near, 1),
      createIntersection(far, 2),
    ]);

    assertDeepEqual(
      forward?.target,
      nearRenderable.binding.target,
      "Duplicate pickIds must keep the nearest sorted candidate, not the first input candidate.",
    );
    assertDeepEqual(
      reverse?.target,
      nearRenderable.binding.target,
      "Duplicate pickId filtering must be stable regardless of input order.",
    );
  }

  {
    const rejected = createProjectedPickCandidate({
      pickId: vertexRenderable.binding.pickId,
      target: vertexRenderable.binding.target,
      renderable: vertexRenderable,
      semanticClass: "featureVertex",
      screenDistance: 4,
      depth: 0,
    });
    const accepted = createProjectedPickCandidate({
      pickId: edgeRenderable.binding.pickId,
      target: edgeRenderable.binding.target,
      renderable: edgeRenderable,
      semanticClass: "featureEdge",
      screenDistance: 6,
      depth: 0,
    });

    const resolved = resolveAllCandidates(
      [rejected, accepted],
      (target) => target.kind === "edge",
    );

    assertDeepEqual(
      resolved?.target,
      edgeRenderable.binding.target,
      "Rejected high-priority candidates must not prevent the next acceptable candidate from resolving.",
    );
  }

  {
    const bodyRenderable: RenderableEntityRecord = {
      ...faceRenderable,
      id: "renderable_body_only",
      label: "Baked body",
      binding: {
        pickId: "pick_body_only",
        pickPriority: 20,
        target: { kind: "body", bodyId: "body_a" },
        topology: null,
        semanticClass: "body",
      },
    };
    const resolved = resolvePickTarget([createIntersection(createBoundMesh(bodyRenderable), 1)]);
    assertDeepEqual(
      resolved?.target,
      bodyRenderable.binding.target,
      "Body-only mesh render records must remain viewport-selectable as bodies.",
    );
  }

  console.log("All render-picking tests passed.");
});

// T17-19 (T17f2). Lane: ui (docs/testing.md: `src/infrastructure/viewport`).
// Seam: the part-mode raycast (`intersectObjectsWithLinePickRadius`) feeding
// the part-mode resolver (`resolvePickTarget`). Real three.js cameras,
// raycaster and bound lines/meshes; the pointer is the viewport centre.
const VIEWPORT_HEIGHT_PX = 900;

function orthographicCamera(zoom: number) {
  // The viewport's default frustum: 32 units tall, 3:2.
  const camera = new THREE.OrthographicCamera(-24, 24, 16, -16, -1000, 1000);
  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function perspectiveCamera(distance: number) {
  const camera = new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

/** A sketch curve along x at height `y` (and depth `z`), bound for picking. */
function boundCurve(entityId: string, y: number, z = 0) {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-5, y, z),
      new THREE.Vector3(5, y, z),
    ]),
    new THREE.LineBasicMaterial(),
  );
  line.updateMatrixWorld();
  bindRenderableObject(
    line,
    `pick_${entityId}`,
    {
      kind: "sketchEntity",
      sketchId: "sketch_a",
      entityId: `sketch_entity_${entityId}`,
    },
    "sketchCurve",
    "document",
  );
  return line;
}

/** A region quad between y = ±halfHeight on z = 0, bound for picking. */
function boundRegion(halfHeight: number) {
  const geometry = new THREE.PlaneGeometry(10, 2 * halfHeight);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.updateMatrixWorld();
  bindRenderableObject(
    mesh,
    "pick_region_a",
    { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
    "region",
    "document",
  );
  return mesh;
}

/** The part-mode raycast at `ndc` (the viewport centre by default). */
function centrePick(
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera,
  objects: THREE.Object3D[],
  ndc = new THREE.Vector2(0, 0),
) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  return intersectObjectsWithLinePickRadius({
    raycaster,
    objects,
    camera,
    viewportHeight: VIEWPORT_HEIGHT_PX,
    linePickRadiusPx: DEFAULT_LINE_PICK_RADIUS_PX,
    maxLineThreshold: DEFAULT_LINE_PICK_THRESHOLD,
  });
}

/** A sketch curve from `from` to `to`, bound for picking. */
function boundSegment(
  entityId: string,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
) {
  const line = boundCurve(entityId, 0);
  line.geometry.setFromPoints([
    new THREE.Vector3(...from),
    new THREE.Vector3(...to),
  ]);
  line.geometry.computeBoundingSphere();
  return line;
}

const hitIds = (hits: THREE.Intersection<THREE.Object3D>[]) =>
  hits.map((hit) => hit.object.userData.pickId as string);

test("T17-19: the part-mode line band is 21 screen px at every orthographic zoom", () => {
  expect(DEFAULT_LINE_PICK_RADIUS_PX).toBe(21);
  for (const zoom of [1, 4]) {
    const worldPerPx = 32 / zoom / VIEWPORT_HEIGHT_PX;
    const inside = boundCurve("inside", 20.5 * worldPerPx);
    const outside = boundCurve("outside", -21.5 * worldPerPx);
    expect(
      hitIds(centrePick(orthographicCamera(zoom), [inside, outside])),
      `zoom ${zoom}: 20.5 px away is hit, 21.5 px away is not`,
    ).toEqual(["pick_inside"]);
  }
  // A curve 15 px away at zoom 1 is 60 px away at zoom 4: the band shrank
  // in world units (the old world band, 0.75, would still hit it).
  const curve = boundCurve("curve", (15 * 32) / VIEWPORT_HEIGHT_PX);
  expect(hitIds(centrePick(orthographicCamera(1), [curve]))).toEqual([
    "pick_curve",
  ]);
  expect(hitIds(centrePick(orthographicCamera(4), [curve]))).toEqual([]);
});

test("T17-19: the part-mode line band is 21 screen px at the hit depth under a perspective camera", () => {
  const worldPerPxAt = (depth: number) =>
    (2 * depth * Math.tan(THREE.MathUtils.degToRad(22.5))) / VIEWPORT_HEIGHT_PX;
  for (const distance of [20, 5]) {
    const camera = perspectiveCamera(distance);
    expect(
      getWorldUnitsPerPixelAt(camera, VIEWPORT_HEIGHT_PX, new THREE.Vector3()),
    ).toBeCloseTo(worldPerPxAt(distance), 12);
    const inside = boundCurve("inside", 20.5 * worldPerPxAt(distance));
    const outside = boundCurve("outside", -21.5 * worldPerPxAt(distance));
    expect(
      hitIds(centrePick(camera, [inside, outside])),
      `camera ${distance} away: 20.5 px away is hit, 21.5 px away is not`,
    ).toEqual(["pick_inside"]);
  }
  // Zooming in (20 → 5 units away) shrinks the band in world units.
  const curve = boundCurve("curve", 15 * worldPerPxAt(20));
  expect(hitIds(centrePick(perspectiveCamera(20), [curve]))).toEqual([
    "pick_curve",
  ]);
  expect(hitIds(centrePick(perspectiveCamera(5), [curve]))).toEqual([]);
  // Per candidate depth in one view: the same world offset is 30 px away
  // at depth 10 (missed) and 15 px away at depth 20 (hit).
  const camera = perspectiveCamera(10);
  const offset = 30 * worldPerPxAt(10);
  const near = boundCurve("near", offset, 0);
  const far = boundCurve("far", offset, -10);
  expect(hitIds(centrePick(camera, [near, far]))).toEqual(["pick_far"]);
});

test("T17-19: a point between two curves 2 px apart at the default zoom picks the curve there and the region once zoomed in", () => {
  // The curves bound a region 2 px tall at zoom 1 (the offset-0.1 ring of
  // T17b0 P-5); the pointer is midway between them.
  const halfHeight = 32 / VIEWPORT_HEIGHT_PX;
  const objects = [
    boundCurve("lower", -halfHeight),
    boundCurve("upper", halfHeight),
    boundRegion(halfHeight),
  ];
  const pick = (zoom: number) =>
    resolvePickTarget(centrePick(orthographicCamera(zoom), objects))?.target;
  // Default zoom: inside both curve bands; a curve wins (priority unchanged).
  expect(pick(1)).toMatchObject({ kind: "sketchEntity" });
  // Zoom 30: the curves are 30 px from the pointer, outside the 21 px band.
  expect(pick(30)).toEqual({
    kind: "region",
    sketchId: "sketch_a",
    regionId: "region_a",
  });
});

test("T17-19 (review R-1): zoomed out, the band is the former world band, so a region's pick share equals base's", () => {
  // A 4 × 4 region bounded by four curves, sampled on a 21 × 21 grid of
  // pointers over its footprint (the review's P-1 sweep).
  const objects = [
    boundSegment("bottom", [-2, -2, 0], [2, -2, 0]),
    boundSegment("right", [2, -2, 0], [2, 2, 0]),
    boundSegment("top", [2, 2, 0], [-2, 2, 0]),
    boundSegment("left", [-2, 2, 0], [-2, -2, 0]),
    boundRegion(2),
  ];
  objects[4]!.scale.set(0.4, 1, 1); // the 10-wide quad → 4 × 4
  objects[4]!.updateMatrixWorld();
  for (const zoom of [0.25, 0.5]) {
    const camera = orthographicCamera(zoom);
    // The edge of the band is the world band: 0.74 is hit, 0.76 is not
    // (uncapped, 21 px is 1.49 / 2.99 units at these zooms).
    expect(
      hitIds(
        centrePick(camera, [
          boundCurve("inside", 0.74),
          boundCurve("outside", -0.76),
        ]),
      ),
      `zoom ${zoom}: the band is capped at 0.75 world units`,
    ).toEqual(["pick_inside"]);
    const share = (pick: (ndc: THREE.Vector2) => THREE.Intersection[]) => {
      let regionHits = 0;
      for (let i = 0; i <= 20; i += 1) {
        for (let j = 0; j <= 20; j += 1) {
          const x = -2 + (4 * i) / 20;
          const y = -2 + (4 * j) / 20;
          const ndc = new THREE.Vector2(x / (24 / zoom), y / (16 / zoom));
          if (resolvePickTarget(pick(ndc))?.target.kind === "region") {
            regionHits += 1;
          }
        }
      }
      return regionHits;
    };
    const base = share((ndc) => {
      // Base: one raycast with the world band.
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      raycaster.params.Line.threshold = DEFAULT_LINE_PICK_THRESHOLD;
      return raycaster.intersectObjects(objects, true);
    });
    expect(base, "premise: the region is pickable on base").toBeGreaterThan(0);
    expect(
      share((ndc) => centrePick(camera, objects, ndc)),
      `zoom ${zoom}: the region's pick share equals base's`,
    ).toBe(base);
  }
});

test("T17-19 (review A-1): perspective bands use the view depth off the view axis and the farthest depth of a receding line", () => {
  const worldPerPxAt = (depth: number) =>
    (2 * depth * Math.tan(THREE.MathUtils.degToRad(22.5))) / VIEWPORT_HEIGHT_PX;
  // Off-centre pointer near the corner: the curves lie on z = 0 (view depth
  // 10, parallel to the image plane), so `o` world units across are o /
  // worldPerPx(10) px on screen. Measured from the oblique ray the 21 px
  // band reaches ≈ 24 px across here; a Euclidean-distance depth (12 here)
  // would reach ≈ 29 px.
  const camera = perspectiveCamera(10);
  const ndc = new THREE.Vector2(0.9, 0.9);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const onPlane = raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    new THREE.Vector3(),
  )!;
  const across = (entityId: string, px: number) => {
    const x = onPlane.x + px * worldPerPxAt(10);
    return boundSegment(entityId, [x, onPlane.y - 3, 0], [x, onPlane.y + 3, 0]);
  };
  expect(
    hitIds(centrePick(camera, [across("near", 20), across("far", 26)], ndc)),
    "off-centre: 20 px across is hit, 26 px is not",
  ).toEqual(["pick_near"]);

  // A line receding from depth 5 (200 px off) to depth 15 (15 px off): its
  // closest point is the far end, where the band is widest. The raycast's
  // threshold must cover the farthest depth, not the line's mid depth (10,
  // where 21 px is narrower than the far end's offset).
  const near = perspectiveCamera(5);
  const receding = boundSegment(
    "receding",
    [0, 200 * worldPerPxAt(5), 0],
    [0, 15 * worldPerPxAt(15), -10],
  );
  expect(hitIds(centrePick(near, [receding]))).toEqual(["pick_receding"]);
});
