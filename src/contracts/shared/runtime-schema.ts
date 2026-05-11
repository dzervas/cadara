import typia from "typia";

import type {
  BodyId,
  ConstructionId,
  ConstraintId,
  DimensionId,
  DocumentId,
  DocumentVariableId,
  EdgeId,
  FaceId,
  FeatureId,
  GeometryAssetId,
  FeatureTreeNodeId,
  LoopId,
  ObjectTreeNodeId,
  PickId,
  PreviewId,
  ProjectedGeometryId,
  ReferenceId,
  RegionId,
  RenderableId,
  RequestId,
  RevisionId,
  SketchAuthoringOperationId,
  SketchEntityId,
  SketchId,
  SketchPointId,
  SketchStyleId,
  SnapshotEntityId,
  VertexId,
} from "@/contracts/shared/ids";
import type { ContractVersion } from "@/contracts/shared/versioning";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import {
  requireContract,
  validateContract,
  type ContractValidationResult,
} from "@/contracts/shared/validation";

export type Point2D = readonly [number, number];
export type Point3D = readonly [number, number, number];

const contractVersionValidator = typia.createValidateEquals<ContractVersion>();
const point2dValidator = typia.createValidateEquals<Point2D>();
const point3dValidator = typia.createValidateEquals<Point3D>();

export function validateContractVersion(
  value: unknown,
): ContractValidationResult<ContractVersion> {
  const result = validateContract(contractVersionValidator, value);
  if (!result.success || result.data !== CONTRACT_VERSION) {
    return result.success
      ? {
          success: false,
          data: value,
          issues: [
            {
              path: "",
              expected: CONTRACT_VERSION,
              value,
              message: `Unsupported contract version; expected contractVersion ${CONTRACT_VERSION}.`,
            },
          ],
        }
      : result;
  }

  return result;
}

export function requirePoint2d(value: unknown): Point2D {
  return requireContract(point2dValidator, value, "2D point");
}

export function requirePoint3d(value: unknown): Point3D {
  return requireContract(point3dValidator, value, "3D point");
}

export type {
  BodyId,
  ConstructionId,
  ConstraintId,
  DimensionId,
  DocumentId,
  DocumentVariableId,
  EdgeId,
  FaceId,
  FeatureId,
  GeometryAssetId,
  FeatureTreeNodeId,
  LoopId,
  ObjectTreeNodeId,
  PickId,
  PreviewId,
  ProjectedGeometryId,
  ReferenceId,
  RegionId,
  RenderableId,
  RequestId,
  RevisionId,
  SketchAuthoringOperationId,
  SketchEntityId,
  SketchId,
  SketchPointId,
  SketchStyleId,
  SnapshotEntityId,
  VertexId,
};
