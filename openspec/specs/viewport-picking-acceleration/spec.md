# viewport-picking-acceleration Specification

## Purpose
TBD - created by archiving change add-bvh-viewport-picking. Update Purpose after archive.
## Requirements
### Requirement: Viewport picking SHALL support drei `<Bvh>`-backed geometric acceleration
The workbench viewport SHALL support drei `<Bvh>`-backed geometric acceleration for supported renderable geometry so hover and selection remain responsive as scene complexity grows.

#### Scenario: Hover a target in a dense scene
- **WHEN** the viewport evaluates hover against supported geometry in a dense scene
- **THEN** it uses the drei `<Bvh>`-accelerated intersection path for that geometry instead of only relying on unaccelerated full-scene ray intersection

#### Scenario: Select a target in a dense scene
- **WHEN** the user clicks supported geometry in a dense scene
- **THEN** the viewport uses the drei `<Bvh>`-accelerated intersection path before resolving the corresponding target binding

### Requirement: BVH acceleration SHALL preserve existing picking semantics
The workbench viewport SHALL preserve its current durable target binding, selection filtering, and hover-resolution semantics when BVH acceleration is enabled.

#### Scenario: Hover a valid durable target
- **WHEN** the pointer hovers a renderable whose durable target is valid for the current interaction context
- **THEN** the viewport resolves the same bound target and hover behavior as the non-accelerated path

#### Scenario: Click a valid durable target
- **WHEN** the user clicks a renderable whose durable target is valid for the current interaction context
- **THEN** the viewport resolves and dispatches the same bound target as the non-accelerated path

### Requirement: BVH state SHALL stay aligned with viewport geometry rebuilds
The workbench viewport SHALL rebuild or invalidate BVH state whenever supported viewport geometry is rebuilt so accelerated intersections do not target stale geometry.

#### Scenario: Document renderables change
- **WHEN** the viewport rebuilds its supported renderable geometry from updated renderable records
- **THEN** the associated BVH state is rebuilt or replaced before the next accelerated pick evaluation

### Requirement: Viewport picking SHALL use a deterministic coordinate frame per pick
The workbench viewport SHALL compute the canvas bounds once for each pick operation and use that same rectangle for ray pointer normalization, projected-point hit testing, and sketch-plane pointer projection performed by that operation.

#### Scenario: Canvas bounds change during one pick operation
- **WHEN** the browser could return different canvas bounds from repeated `getBoundingClientRect()` reads during a single viewport pick
- **THEN** all pick sub-resolvers use the first rectangle captured for that operation
- **AND** candidate ordering is not affected by intra-pick layout reads

#### Scenario: Sketch pointer projection follows the same pointer event frame
- **WHEN** a pointer move both resolves a hover target and projects the pointer onto the active sketch plane
- **THEN** the hover resolution and sketch projection use the same captured canvas rectangle for that pointer event

### Requirement: Viewport picking SHALL resolve all candidates through one ranked list
The workbench viewport SHALL collect raycast candidates and projected point candidates into a unified candidate list before applying selection filters, de-duplication, occlusion checks, and ranking.

#### Scenario: Projected vertex overlaps a face raycast
- **WHEN** a face raycast candidate and an in-radius projected vertex candidate are both present for one pick
- **THEN** the projected vertex candidate wins over the face candidate according to interaction rank

#### Scenario: Projected non-point candidate ties a raycast candidate
- **WHEN** a projected non-point candidate and a raycast candidate have the same interaction rank
- **THEN** the raycast candidate wins unless another ranking rule explicitly gives the projected candidate higher interaction rank

#### Scenario: Filter rejects higher-priority candidates
- **WHEN** the active selection filter rejects the highest-ranked candidate
- **THEN** the resolver continues evaluating lower-ranked candidates
- **AND** the first acceptable candidate is returned instead of returning no target

### Requirement: Viewport picking SHALL apply stable deterministic ranking boundaries
The workbench viewport SHALL rank equal or near-equal candidates deterministically using documented tolerances, semantic interaction rank, pick priority, and stable target keys.

#### Scenario: Candidates are inside the same-layer tolerance
- **WHEN** two raycast candidates are separated by no more than the same-layer tolerance
- **THEN** the higher interaction-rank candidate wins before pick priority or stable key ordering

#### Scenario: Candidates are outside the same-layer tolerance
- **WHEN** two raycast candidates are separated by more than the same-layer tolerance
- **THEN** the nearer candidate wins before interaction-rank ordering

#### Scenario: Wire candidate is at the face occlusion boundary
- **WHEN** a wire candidate is behind an occluding face by no more than the wire occlusion tolerance
- **THEN** the wire remains eligible for picking

#### Scenario: Wire candidate is beyond the face occlusion boundary
- **WHEN** a wire candidate is behind an occluding face by more than the wire occlusion tolerance
- **THEN** the wire candidate is skipped as occluded

#### Scenario: Multiple hits share one logical target
- **WHEN** multiple intersections resolve to the same logical pick id or target key
- **THEN** de-duplication keeps the highest-ranked sorted candidate
- **AND** the result is independent of raw raycaster hit order

### Requirement: Projected point hover SHALL use enter/exit hysteresis
The workbench viewport SHALL use a smaller enter radius and larger exit radius for projected point hover so an already-hovered projected point remains stable until the pointer leaves the exit radius.

#### Scenario: Pointer enters a projected point radius
- **WHEN** a projected point candidate is not currently hovered
- **THEN** the candidate becomes eligible only inside the projected point enter radius

#### Scenario: Current hover remains inside the exit radius
- **WHEN** the current hover target is a projected point and the pointer is outside the enter radius but still inside the exit radius
- **THEN** the current hover target remains eligible

#### Scenario: Current hover leaves the exit radius
- **WHEN** the current hover target is a projected point and the pointer moves outside the exit radius
- **THEN** the projected point candidate is no longer eligible

### Requirement: Viewport picking handlers SHALL remain stable across renderable changes
The workbench viewport SHALL keep pointer event handler registrations stable across renderable and sketch-display renderable updates by reading the latest renderable data through refs.

#### Scenario: Renderables update while the canvas stays mounted
- **WHEN** document renderables or sketch-display renderables change without replacing the canvas
- **THEN** the viewport updates the renderable refs used by picking
- **AND** it does not tear down and reattach the pointer event handlers solely because the renderable arrays changed

#### Scenario: Scene graph is not ready during initial cache fill
- **WHEN** binding collection runs before the scene graph contains pickable objects
- **THEN** the empty binding collection is not treated as a reusable stable cache
- **AND** a later pick retries binding collection until pickable objects are available

### Requirement: Viewport binding collection SHALL be cached with scene invalidation
The workbench viewport SHALL cache collected pick bindings between pointer moves and invalidate that cache when the scene key for pickable renderables changes.

#### Scenario: Consecutive picks without scene changes
- **WHEN** two pick operations occur without a pickable scene-key change
- **THEN** the second pick reuses the cached binding collection

#### Scenario: Pickable scene key changes
- **WHEN** the renderable scene key changes because pickable geometry or target bindings changed
- **THEN** the next pick rebuilds the binding collection before resolving candidates

### Requirement: Hover refs SHALL not overwrite event-owned hover state from stale props
The workbench viewport SHALL avoid overwriting event-handler-owned hover refs from stale React props while still reconciling external hover clears.

#### Scenario: Rapid hover changes occur before React renders
- **WHEN** pointer events change hover from one target to another and then to a final target before React commits a render
- **THEN** the hover ref retains the final event-owned target
- **AND** React prop synchronization does not restore an intermediate hover target

#### Scenario: External state clears hover
- **WHEN** editor state outside the viewport clears the hover target to `null`
- **THEN** the viewport clears the hover ref before the next pick uses hover hysteresis
