import {
  testNegativeSolvedCircleRadiusIsFlaggedByGeometryValidation,
  testPositiveSolvedCircleRadiusIsNotFlaggedByGeometryValidation,
} from "./circle-validation.cases";
import {
  testCollinearSolvesAgainstProjectedLineWithoutMovingReference,
  testCollinearSolvesLocalLinesAndPointsAgainstInfiniteGeometry,
  testCollinearValidationReportsMissingAndDegenerateTargets,
} from "./collinear.cases";
import {
  testCompiledInteractiveDragKeepsInitiallyCoincidentPointsTogether,
  testCompiledInteractiveDragTranslatesRigidRectangle,
  testCompiledSolveProgramReuseAndInvalidation,
  testDefaultSolveRecoversFromStalledImportedProfile,
  testInteractiveSessionWarmStartStaleRejectionAndComponentIsolation,
} from "./compiled-session.cases";
import {
  testCircleDiameterDimensionDrivesSolvedCircleRadius,
  testCircleRadiusDimensionDrivesSolvedCircleRadius,
  testValidationRejectsDegenerateLine,
  testValidationRejectsDuplicateEntityRecords,
  testValidationRejectsDuplicatePointRecords,
  testValidationRejectsMissingConstraintReferences,
  testValidationRejectsPointIdsWithoutRecords,
} from "./definition-validation.cases";
import {
  testEditedParallelLineDistanceConverges,
  testEuclideanDistance,
  testFixPoint,
  testHorizontalDistance,
  testLineDistanceAdmissionAndStatusShareAngularTolerance,
  testLowLossStartsStillSolveUntilEveryRequirementHolds,
  testNeverAdmittedLineDimensionsAreUnsatisfied,
  testRequirementStatusesUseDocumentLinearAndAngularTolerance,
  testVerticalDistance,
} from "./distance-tolerances.cases";
import {
  testEqualOffsetClassifiesAngularAndLinearToleranceSeparately,
  testEqualOffsetFreeMagnitudeAndComponentCoupling,
  testEqualOffsetOrientationSideObliqueAndGradient,
  testEqualOffsetRejectsIncompatibleAndDegeneratePairs,
  testEqualOffsetUsesSeparateMagnitudeDriver,
} from "./equal-offset.cases";
import {
  testAngleBetweenPoints,
  testAngleBetweenPointsSpecificCase,
  testAxisQualifiedDistance,
  testEqualLength,
  testExpandedDimensionStatuses,
  testHorizontalLine,
  testObtuseLineAngleDimension,
  testParallelLines,
  testPerpendicularLines,
  testVerticalLine,
} from "./line-dimensions.cases";
import {
  testOffsetArcScalarStateFollowsDefiningPoints,
  testOffsetCircleScalarAuthorityMovesTheSource,
  testOffsetOutputRequirementDrivesSourceAuthority,
} from "./offset-authority.cases";
import {
  testArcEndPointCoincident,
  testArcStartPointCoincident,
  testAxisAlignedRectangle,
  testProjectedDatumConstraintSeedsLogoReferenceImageAnchorTranslation,
  testRotatedRectangle,
  testRotatedRectangleGaussNewton,
  testRotatedRectangleGradientDescent,
  testRotatedRectangleLevenbergMarquardt,
} from "./rectangle-strategies.cases";
import {
  testDimensionStatusUsesLinearAndAngularTolerancePolicies,
  testDrivenOutputConstraintUsesSourceAndAxisJacobians,
  testOrdinarySplineAliasClosureKeepsAutomaticTangentsDerivedAndExactZeroAuthored,
  testOrdinarySplineUsesAnalyticOwnerJacobiansAndAuthoredHandleVariables,
  testProjectedSourceSamplesAreRejectedAsDisplayOnly,
  testProjectionSupportClosesOverOrderedDerivedChains,
} from "./spline-projection.cases";
import {
  testInvalidOrdinarySplineSolveDoesNotMutateAuthoredInput,
  testSplinePointResidualPreservesSubnormalPhysicalGap,
} from "./spline-validation.cases";
import { test } from "vitest";

test("src/contracts/sketch/solver-core.spec.ts", async () => {

  async function run() {
    await testEqualOffsetFreeMagnitudeAndComponentCoupling();
    await testEqualOffsetUsesSeparateMagnitudeDriver();
    await testEqualOffsetOrientationSideObliqueAndGradient();
    await testEqualOffsetClassifiesAngularAndLinearToleranceSeparately();
    await testEqualOffsetRejectsIncompatibleAndDegeneratePairs();
    await testFixPoint();
    await testEuclideanDistance();
    await testHorizontalDistance();
    await testVerticalDistance();
    await testEditedParallelLineDistanceConverges();
    await testLineDistanceAdmissionAndStatusShareAngularTolerance();
    await testNeverAdmittedLineDimensionsAreUnsatisfied();
    await testRequirementStatusesUseDocumentLinearAndAngularTolerance();
    await testLowLossStartsStillSolveUntilEveryRequirementHolds();
    await testExpandedDimensionStatuses();
    await testAxisQualifiedDistance();
    await testObtuseLineAngleDimension();
    await testHorizontalLine();
    await testVerticalLine();
    await testAngleBetweenPoints();
    await testAngleBetweenPointsSpecificCase();
    await testEqualLength();
    await testParallelLines();
    await testPerpendicularLines();
    await testCollinearSolvesLocalLinesAndPointsAgainstInfiniteGeometry();
    await testCollinearSolvesAgainstProjectedLineWithoutMovingReference();
    await testCollinearValidationReportsMissingAndDegenerateTargets();
    await testArcStartPointCoincident();
    await testArcEndPointCoincident();
    await testAxisAlignedRectangle();
    await testProjectedDatumConstraintSeedsLogoReferenceImageAnchorTranslation();
    await testDefaultSolveRecoversFromStalledImportedProfile();
    await testRotatedRectangle();
    await testRotatedRectangleGradientDescent();
    await testRotatedRectangleGaussNewton();
    await testRotatedRectangleLevenbergMarquardt();
    await testValidationRejectsDegenerateLine();
    await testValidationRejectsPointIdsWithoutRecords();
    await testValidationRejectsMissingConstraintReferences();
    await testValidationRejectsDuplicatePointRecords();
    await testValidationRejectsDuplicateEntityRecords();
    await testCircleRadiusDimensionDrivesSolvedCircleRadius();
    await testCircleDiameterDimensionDrivesSolvedCircleRadius();
    await testCompiledSolveProgramReuseAndInvalidation();
    await testInteractiveSessionWarmStartStaleRejectionAndComponentIsolation();
    await testCompiledInteractiveDragKeepsInitiallyCoincidentPointsTogether();
    await testCompiledInteractiveDragTranslatesRigidRectangle();
    await testOrdinarySplineUsesAnalyticOwnerJacobiansAndAuthoredHandleVariables();
    await testOrdinarySplineAliasClosureKeepsAutomaticTangentsDerivedAndExactZeroAuthored();
    await testDrivenOutputConstraintUsesSourceAndAxisJacobians();
    await testProjectionSupportClosesOverOrderedDerivedChains();
    await testDimensionStatusUsesLinearAndAngularTolerancePolicies();
    await testOffsetOutputRequirementDrivesSourceAuthority();
    await testOffsetCircleScalarAuthorityMovesTheSource();
    await testOffsetArcScalarStateFollowsDefiningPoints();
    await testSplinePointResidualPreservesSubnormalPhysicalGap();
    await testProjectedSourceSamplesAreRejectedAsDisplayOnly();
    await testInvalidOrdinarySplineSolveDoesNotMutateAuthoredInput();
    await testNegativeSolvedCircleRadiusIsFlaggedByGeometryValidation();
    await testPositiveSolvedCircleRadiusIsNotFlaggedByGeometryValidation();
  }

  await run();
});
