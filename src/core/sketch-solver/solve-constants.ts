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

// Cursor error dominates the minimum-motion anchor. Hard constraints are
// equalities, not competing penalty weights in this objective.
export const DRAG_TARGET_WEIGHT = 1e-2;

// Both budgets belong to the whole preview, across stages/substeps/retries.
// Release drains the same continuation without a budget.
export const DRAG_PREVIEW_ITERATIONS = 48;

export const DRAG_PREVIEW_RAW_BLOCKS = 2500;
