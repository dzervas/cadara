import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  SketchPoint2D,
  SketchSolveDiagnostic,
  SolvedSketchSnapshot,
  SolvedSketchStatus,
} from "@/contracts/sketch/schema";

export interface SketchSolveTolerancePolicy {
  coincidence: number;
  angleRadians: number;
  minimumSegmentLength: number;
}

export interface SketchCoreSolveResult {
  status: SolvedSketchStatus;
  solvedSnapshot: SolvedSketchSnapshot;
  diagnostics: SketchSolveDiagnostic[];
}

export type SketchSolveStrategy =
  | "bfgs"
  /**
   * T13e (D11 as amended by review B-1): the BFGS stage of "bfgs" without its
   * Gauss–Newton fallback. Only the redundancy probe's trials use it; the
   * acceptance check and the rebuild retry are unchanged.
   */
  | "bfgsWithoutFallback"
  | "gradientDescent"
  | "gaussNewton"
  | "levenbergMarquardt";

export interface SketchDraggedPointTarget {
  kind: "sketchPoint";
  pointId: SketchPointId;
  position: SketchPoint2D;
}

export interface SketchDragTranslateTarget {
  kind: "sketchTranslate";
  pointIds: readonly SketchPointId[];
  delta: SketchPoint2D;
}

export interface SketchDragRadiusTarget {
  kind: "sketchRadius";
  entityId: SketchEntityId;
  targetRadius: number;
}

export interface SketchDragTangentVectorTarget {
  kind: "sketchTangentVector";
  entityId: SketchEntityId;
  occurrenceId: string;
  targetVector: SketchPoint2D;
  /**
   * When true, store the vector as exactly [0, 0] regardless of the soft
   * target's achieved value. The solver fixes both tangent variables at 0
   * for this frame. A later frame with exactZero=false and a non-zero
   * target leaves zero continuously through substeps.
   */
  exactZero?: boolean;
}

export type SketchDragTarget =
  | SketchDraggedPointTarget
  | SketchDragTranslateTarget
  | SketchDragRadiusTarget
  | SketchDragTangentVectorTarget;

export type SketchDraggedPointSolveResult =
  | {
      kind: "solved";
      solvedSnapshot: SolvedSketchSnapshot;
      diagnostics: SketchSolveDiagnostic[];
    }
  | {
      kind: "blocked";
      reason: "missingPoint" | "unsatisfied" | "nonConvergent" | "staleSession";
      solvedSnapshot: SolvedSketchSnapshot | null;
      diagnostics: SketchSolveDiagnostic[];
    };

export type SketchDragPreviewSolveResult =
  | SketchDraggedPointSolveResult
  | {
      kind: "pending";
      solvedSnapshot: SolvedSketchSnapshot;
      diagnostics: SketchSolveDiagnostic[];
    };

export interface SketchCoreValidationResult {
  isValid: boolean;
  diagnostics: SketchSolveDiagnostic[];
}
