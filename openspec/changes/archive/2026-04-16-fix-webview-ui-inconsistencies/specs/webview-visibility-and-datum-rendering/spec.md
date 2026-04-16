## ADDED Requirements

### Requirement: Sketch vertices render as spherical markers
The workbench SHALL render sketch vertex markers as small spherical markers for both active sketch-session overlays and durable viewport renderables so point picks remain visually consistent during editing.

#### Scenario: Durable sketch or topology vertex is displayed
- **WHEN** the viewport builds a render object for a marker geometry representing a sketch point or vertex target
- **THEN** it renders a sphere-shaped mesh at the marker position instead of a square point sprite

#### Scenario: Active sketch session displays control points
- **WHEN** an active sketch session exposes marker display renderables
- **THEN** the markers use the same sphere-style presentation and remain visually distinct from sketch edges and planes

### Requirement: Datum planes use transparent neutral styling
The workbench SHALL render seeded datum planes with a very transparent gray fill and subdued edges so they remain distinguishable from sketch curves when geometry overlaps in the viewport.

#### Scenario: Standard origin datum plane is visible in the scene
- **WHEN** the viewport renders an authoritative datum plane corresponding to a seeded standard plane
- **THEN** the plane fill uses a transparent gray material and the plane edges do not share the sketch-edge highlight color

#### Scenario: Sketch geometry overlaps a datum plane
- **WHEN** a sketch edge or profile is coplanar with or crosses a visible datum plane
- **THEN** the sketch geometry remains visually readable against the plane background

### Requirement: Authoritative datum planes drive viewport plane visuals
The workbench SHALL use the authoritative kernel-seeded datum plane renderables for origin plane display instead of relying on duplicate decorative origin-plane meshes that are not tied to selectable construction targets.

#### Scenario: Initial document snapshot includes standard datum planes
- **WHEN** the viewport scene is composed for a document containing the seeded `construction_plane-*` entries
- **THEN** those renderables provide the visible origin planes presented to the user

#### Scenario: Decorative origin planes would duplicate seeded constructions
- **WHEN** authoritative construction-plane renderables are available for the standard datum planes
- **THEN** the viewport does not render a second overlapping set of decorative origin planes

### Requirement: Sidebar visibility toggles control viewport rendering
The workbench SHALL expose hide/show controls for sidebar rows with viewport targets and SHALL suppress hidden targets from viewport rendering until the user shows them again.

#### Scenario: User hides a datum plane or object from the sidebar
- **WHEN** the user activates the hide control for a sidebar row that maps to a viewport target
- **THEN** the corresponding renderables stop drawing in the viewport and the row reflects the hidden state

#### Scenario: User shows a previously hidden target
- **WHEN** the user activates the show control for a hidden sidebar row
- **THEN** the corresponding renderables are restored to the viewport without requiring a document rebuild
