# CADara

Domain language for CADara's modeling tools.

## Language

**Ordinary spline**:
An interpolating sketch curve that passes through its authored fit points.

**Spline fit point**:
An authored point through which an ordinary spline passes.
_Avoid_: Fit/control point, control-polygon point

**Spline tangent handle**:
A direction-and-magnitude handle attached to a spline fit point that controls its tangent. At an interior fit point, it controls a shared smooth tangent rather than independent incoming and outgoing tangents.
_Avoid_: Fit point

**Driving dimension**:
An authored numeric requirement that constrains sketch geometry.

**Reference dimension**:
A measurement of sketch geometry that does not constrain it.

**Sketch mirror**:
A relationship that creates reflected copies of sketch geometry across a straight axis and maintains their reflection as the source or axis changes.

**Symmetric constraint**:
A relationship that makes existing sketch geometry symmetric about an axis without creating copies.

**Authored action**:
One completed user intent that changes authored document state. Pointer previews and canceled gestures are not authored actions.

**Author-scoped undo history**:
The undoable authored actions belonging to one active editing author. Undo never reverses a peer author's action.

**Compensating action**:
A new authored action that reverses an earlier action without deleting or rewriting shared history.

**Private sketch draft**:
The current author's in-progress sketch state. Peers do not receive its completed internal actions until it is published by finishing the sketch.

**Publish Sketch action**:
The document-level authored action created when a private sketch draft is finished and its resulting revision becomes shared state.
