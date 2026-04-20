## Context

This change assumes the durable sketch contract already includes ellipse, elliptical arc, conic, Bezier, and profile-generating text entity kinds. The current spline tool is a fit-point workflow. The requested list also includes a spline control-point workflow, which should be a distinct authoring mode rather than a replacement for fit-point spline behavior.

## Goals / Non-Goals

**Goals:**
- Add direct authoring tools for ellipse, elliptical arc, conic, Bezier curve, spline control-point mode, and profile-generating text.
- Commit first-class entity records with stable references to defining points and parameters.
- Render staged previews and validation through the generic sketch tool presentation contract.
- Ensure profile-generating text can create downstream selectable profiles when supported.

**Non-Goals:**
- Add the durable entity contract itself.
- Add sketch edit operators or associative transforms.
- Replace the existing fit-point spline tool.

## Decisions

1. Keep fit-point spline and control-point spline as separate tool variants.

   Rationale: both workflows are common and have different user expectations. The existing `spline` behavior should remain stable while the new control-point workflow commits its own durable definition.

2. Author profile-generating text as semantic text plus deterministic outline/profile behavior.

   Rationale: text must be editable as text and usable for extrude/cut workflows. Persisting only generated outlines would lose editability.

3. Use multi-step tool state for advanced curves.

   Rationale: ellipse, conic, Bezier, and elliptical arc workflows need more than two inputs. The existing spline multi-point pattern is the closest local precedent.

## Risks / Trade-offs

- [Text outline generation may be complex] -> Start with deterministic built-in behavior and explicit diagnostics for unsupported glyph/profile cases.
- [Bezier and conic workflows can be ambiguous] -> Keep first workflows conventional and encode the prompt/step model in tool definitions.
- [Advanced previews can require sampling] -> Use transient sampled preview geometry only for display; commit the first-class authored entity.
- [Control-point spline may overlap Bezier behavior] -> Keep user-facing tool ids and committed entity semantics explicit.
