/**
 * Screen-pixel radii shared by the sketch pick stack and sketch snapping
 * (T11-D2, T13-D13). Snapping stays a separate path from the pick stack
 * (T11-D3); only these constants are shared. A candidate enters within
 * `enter` px and an already active one stays until `exit` px (hysteresis).
 */

/** Sketch points; point-like snaps (endpoint, center, midpoint, intersection). */
export const SKETCH_POINT_RADII_PX = { enter: 12, exit: 16 } as const;

/** Sketch curves; on-curve and constructed-point (tangent, perpendicular foot) snaps. */
export const SKETCH_CURVE_RADII_PX = { enter: 10, exit: 14 } as const;

/** Horizontal and vertical alignment snaps. */
export const SKETCH_ALIGNMENT_SNAP_RADII_PX = { enter: 8, exit: 12 } as const;
