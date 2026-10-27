export const WOLFE_C1 = 1e-4;

export const WOLFE_C2 = 0.9;

export const LINE_SEARCH_MAX_ITERATIONS = 15;

export const SOLVED_LOSS_THRESHOLD = 1e-8;

export const BFGS_MIN_LOSS = 1e-12;

export const DEGENERATE_NORM_EPSILON = 1e-6;

export const EQUATION_SUPPORT_PERTURBATION = 1e-3;

export const EQUATION_SUPPORT_LOSS_EPSILON = 1e-18;

// Interactive drag tuning (minimum-motion-sketch-drag).
// DRAG_MINIMUM_MOTION_EPSILON is the uniform previous-frame anchoring weight
// (policy 1); it must stay far below the drag-target weight so a reachable
// cursor is still reached, while remaining large enough to break under-
// constrained null spaces. DRAG_* substep bounds keep large per-frame cursor
// deltas continuous by subdividing them (D3) instead of teleporting past
// singularities, with the last accepted frame as the lag fallback.
export const DRAG_MINIMUM_MOTION_EPSILON = 1e-6;

// The soft cursor objective is weighted BELOW the hard constraints (weight 1) so
// that authored constraints keep geometry on their manifold during a drag frame
// (it slides along remaining DOF) instead of being pulled off it or through a
// singularity, while staying far above the minimum-motion epsilon so a reachable
// cursor is still reached.
export const DRAG_TARGET_WEIGHT = 1e-2;

// Condition far targets only: near-cursor frames keep their existing BFGS path.
export const DRAG_CONDITIONING_TARGET_LOSS = 1e-4;

export const DRAG_CONDITIONING_MAX_ITERATIONS = 10;

// cadara-b3k.34: 48 iterative steps retain the complete small-delta trajectory
// (the T18 approval peaks at 43). 2500 raw block evaluations fit two T18
// Jacobians, instead of ten (~11210 blocks). Both budgets belong to the whole
// preview, not each phase/stage/substep/retry. Release drains without a budget.
export const DRAG_PREVIEW_ITERATIONS = 48;

export const DRAG_PREVIEW_RAW_BLOCKS = 2500;
