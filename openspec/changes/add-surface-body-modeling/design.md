## Context

Extrude and revolve are typed profile-based features that currently build solid results from closed sketch regions or planar faces. The OCC paths already use shape-agnostic tessellation, picking, and STEP export, but body tracking and result extraction assume `TopAbs_SOLID`. Surface modeling should reuse the same generic inspector, feature authoring registry, operation history, snapshots, and topology naming paths while adding sheet bodies as first-class outputs.

The closest prior change, `add-extrude-revolve-end-controls`, explicitly deferred surface variants. This change fills that gap without adding sweep or loft surface support.

## Goals / Non-Goals

**Goals:**
- Add Onshape-style Solid/Surface result toggles to extrude and revolve through form-schema enum fields.
- Make extrude/revolve persisted parameters discriminated unions whose surface variants cannot carry boolean operation state.
- Allow open sketch-curve profile refs only for surface extrude/revolve, one durable sketch entity per ref.
- Track sheet bodies as first-class bodies in OCC state and persisted snapshots.
- Execute surface extrude/revolve by sweeping wires to one sheet body and preserving sheet-specific topology provenance.
- Rewrite thicken to consume faces or one sheet body and produce a solid through OCC thick-solid/offset APIs.
- Reject sheet bodies explicitly in solid-only feature paths.

**Non-Goals:**
- Add surface sweep, surface loft, sewing, enclose, delete face, heal, or broad sheet repair workflows.
- Add legacy migration, deprecation, or compatibility hydration.
- Branch the feature inspector specifically for extrude or revolve surface mode.
- Implement Onshape importer support for `bodyType: SURFACE` extrudes.

## Decisions

1. Persist extrude and revolve as result-body discriminated unions.

   Sketch of the intended contract shape, using current names from `src/contracts/modeling/schema.ts`:

   ```text
   export type ExtrudeFeatureParameters =
     | {
         resultBodyType: "solid";
         profiles: NonEmptyReadonlyArray<ExtrudeSolidProfileRef>;
         startExtent: ExtrudeStartExtent;
         extent: ExtrudeFeatureExtent;
         operation: AuthoredValue<FeatureBooleanOperation>;
         booleanScope: FeatureBooleanScope;
       }
     | {
         resultBodyType: "surface";
         profiles: NonEmptyReadonlyArray<ExtrudeSurfaceProfileRef>;
         startExtent: ExtrudeStartExtent;
         extent: ExtrudeFeatureExtent;
       };

   export type RevolveFeatureParameters =
     | {
         resultBodyType: "solid";
         profiles: NonEmptyReadonlyArray<RevolveSolidProfileRef>;
         axis: RevolveAxisRef;
         startAngle: AuthoredValue<number>;
         extent: RevolveFeatureExtent;
         operation: AuthoredValue<FeatureBooleanOperation>;
         booleanScope: FeatureBooleanScope;
       }
     | {
         resultBodyType: "surface";
         profiles: NonEmptyReadonlyArray<RevolveSurfaceProfileRef>;
         axis: RevolveAxisRef;
         startAngle: AuthoredValue<number>;
         extent: RevolveFeatureExtent;
       };
   ```

   The solid variant is today's exact parameter shape plus `resultBodyType: "solid"`. The surface variant has no `operation` and no `booleanScope`, making boolean states unrepresentable for sheet creation.

2. Model open sketch curves as surface-only profile refs.

   Mirror the durable sketch entity reference shape already used by `RevolveAxisRef`:

   ```text
   export type OpenSketchCurveProfileRef = {
     kind: "sketchEntity";
     sketchId: SketchId;
     entityId: import("@/contracts/shared/ids").SketchEntityId;
   };

   export type ExtrudeSurfaceProfileRef = ExtrudeProfileRef | OpenSketchCurveProfileRef;
   export type RevolveSurfaceProfileRef = RevolveProfileRef | OpenSketchCurveProfileRef;
   ```

   One ref names one sketch entity. The adapter groups connected entities into wires with `BRepBuilderAPI_MakeWire`; each connected chain yields one wire and the feature is valid only when the complete submitted profile set produces exactly one sheet body. The OCC build does not include Sewing, so disconnected wire sets are rejected rather than sewn into a shell.

3. Add body kind to tracked and persisted bodies.

   ```text
   export type BodyKind = "solid" | "sheet";

   OccTrackedBody.bodyKind: BodyKind;

   export interface BodySnapshotRecord extends SnapshotOwnershipRecord {
     bodyId: BodyId;
     label: string;
     bodyKind: BodyKind;
     topology: BodyTopologySnapshotRecord;
     topologyPresentation?: BodyTopologyPresentation;
   }
   ```

   Existing solid bodies become `bodyKind: "solid"`; surface extrude/revolve produce `bodyKind: "sheet"`. Object-tree labels derive from kind. Tessellation, picking, viewport materials, and STEP export stay shape-agnostic.

4. Use separate sheet topology source keys.

   Solid extrude/revolve source keys such as `profile:first-face` and `profile:last-face` assume face-typed cap results. Wire sweeps expose first/last boundary edges instead. Surface execution must record sheet-specific source keys, for example `profile:first-boundary-edge` and `profile:last-boundary-edge`, and must not reuse cap-face keys for edge topology.

5. Keep the UI generic.

   Extrude/revolve authoring definitions expose `resultBodyType` as an enum field. Boolean operation and target-body fields are absent from the surface variant schema. Draft/tapered-cap-irrelevant fields such as draft angle are hidden in surface mode. Draft state may remember inactive values, but built durable definitions must omit inactive variant fields according to the advanced option descriptor convention.

   Toggling rules:
   - Solid -> Surface preserves shared profiles/extents/axis/start values, drops `operation` and `booleanScope` from the durable payload, and accepts open sketch-curve refs.
   - Surface -> Solid preserves shared values that are solid-valid, removes open sketch-curve refs or reports profile diagnostics, and restores default `operation: newBody` with standalone scope.

6. Rewrite thicken around OCC thick-solid/offset APIs.

   Thicken participants become either durable body faces or one sheet body target. The OCC implementation uses `BRepOffsetAPI_MakeThickSolid` when constructing a solid from an existing shell/face context and `BRepOffsetAPI_MakeOffsetShape` for offset-shape construction where the binding is the correct fit. Curved faces are intended supported inputs when OCC can offset and close them successfully; failures from invalid offset distance, self-intersection, orientation ambiguity, non-manifold sheet boundaries, or unsupported kernel combinations return structured diagnostics.

7. Reject sheet bodies in solid-only paths.

   Fillet, shell, boolean operations as targets/tools, split, Combine, and any other solid-only feature path must check body kind before topology execution. Sheet inputs produce explicit unsupported diagnostics and never crash, silently skip, or coerce to solids.

8. Do not add a boolean-target-selector delta.

   Existing `boolean-target-selector` requirements already gate selectors by active boolean operations. Surface variants have no `operation` field at all, so operation-gated selectors are absent through the form schema rather than through a new boolean-selector rule.

## Risks / Trade-offs

- OCC shell output may vary between open and closed wire sweeps -> require exactly one sheet result and return diagnostics for no-shell, multi-shell, or unexpected-solid outputs.
- Without Sewing, disconnected open-curve chains cannot be healed into one sheet -> reject disconnected chains instead of inventing hidden sewing behavior.
- Topology naming source keys differ by result shape -> define sheet-specific boundary keys to avoid face/edge type confusion.
- Thicken reliability depends on OCC offset validity, especially on curved or self-intersecting inputs -> support curved faces where OCC succeeds and report kernel failures explicitly.

## Migration Plan

Regenerate fixtures, contract examples, operation-history samples, and snapshot examples in the new shapes. No legacy hydration, deprecation path, or migration code is required.

## Open Questions

None.
