## ADDED Requirements

### Requirement: Active sketch feedback SHALL maintain screen-space legibility during zoom
The workbench viewport SHALL render active sketch editing wires and point affordances with screen-space or pixel-clamped sizing so they remain legible and reachable across normal zoom levels. The underlying sketch geometry positions MUST continue to project according to the camera zoom; only authoring stroke thickness, marker radius, and related handle affordance sizing are screen-space presentation.

#### Scenario: Active sketch wires stay legible while zooming out
- **WHEN** the user is actively editing a sketch containing line, curve, construction, reference, hover, selection, or diagnostic wire feedback
- **AND** the user zooms the viewport out far enough that world-space stroke widths would become visually tiny
- **THEN** the rendered wire stroke remains within the active-sketch pixel-size bounds for that wire role
- **AND** the wire keeps its existing constraint-state, construction, reference, hover, selection, diagnostic, or authored SVG styling

#### Scenario: Active sketch point affordances stay legible while zooming out
- **WHEN** the user is actively editing a sketch containing vertices, endpoints, datum origin markers, projected-reference points, snap handles, reference-image anchors, or active tool point handles
- **AND** the user zooms the viewport out far enough that world-space marker radii would become visually tiny
- **THEN** the rendered point affordance remains within the active-sketch pixel-size bounds for that marker role
- **AND** the marker keeps its existing constraint-state, reference, hover, selection, overlay, or authored style treatment

#### Scenario: Pick targets track screen-space marker sizing
- **WHEN** an active sketch point affordance is rendered with pixel-clamped marker sizing
- **THEN** its pick target is derived from the same screen-space sizing model as the visible marker
- **AND** the pick target remains at least as reachable as the visible marker without changing the durable selected target reference

#### Scenario: Sketch geometry still zooms normally
- **WHEN** the user zooms in or out during active sketch editing
- **THEN** sketch entity positions, curve shapes, region boundaries, and distances continue to project according to the camera and sketch plane
- **AND** only authoring stroke thickness, marker radius, and related handle affordance sizing are stabilized in screen space

#### Scenario: Inactive and non-authoring geometry keeps its existing sizing rules
- **WHEN** the viewport renders model bodies, solid topology, datum planes, sketch regions, or sketches that are not being actively edited
- **THEN** those renderables keep their existing sizing and material behavior unless another viewport contract explicitly says otherwise
