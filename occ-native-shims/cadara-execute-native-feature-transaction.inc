public:
  static std::string EntrypointName() {
    return "CadaraExecuteNativeFeatureTransaction";
  }

  static std::string BuildCommittedShapePayload(
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    const TopoDS_Shape preparedShape = CadaraPrepareCommittedShape(
      shape,
      linearDeflection,
      angularDeflection
    );
    return CadaraBuildTopologyJson(preparedShape, bodyId, topologyToken, linearDeflection, angularDeflection, true);
  }

  static std::string BuildBooleanCommittedShapePayload(
    const TopoDS_Shape& left,
    const TopoDS_Shape& right,
    const std::string& operation,
    const std::string& bodyId,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    if (operation == "join") {
      BRepAlgoAPI_Fuse builder(left, right);
      return CadaraBuildBooleanTransactionPayload(
        builder,
        operation,
        bodyId,
        topologyToken,
        linearDeflection,
        angularDeflection,
        left
      );
    }

    if (operation == "cut") {
      BRepAlgoAPI_Cut builder(left, right);
      return CadaraBuildBooleanTransactionPayload(
        builder,
        operation,
        bodyId,
        topologyToken,
        linearDeflection,
        angularDeflection,
        left
      );
    }

    if (operation == "intersect") {
      BRepAlgoAPI_Common builder(left, right);
      return CadaraBuildBooleanTransactionPayload(
        builder,
        operation,
        bodyId,
        topologyToken,
        linearDeflection,
        angularDeflection,
        left
      );
    }

    const TopoDS_Shape emptyShape;
    return CadaraBuildTopologyJson(
      emptyShape,
      bodyId,
      topologyToken,
      linearDeflection,
      angularDeflection,
      true,
      CadaraDiagnosticJson(
        "occ-native-feature-transaction-unsupported-operation",
        "error",
        "Native OCC boolean feature transaction received an unsupported operation.",
        bodyId,
        "featureTransaction",
        "operation",
        operation
      )
    );
  }

  static CadaraNativeFeatureTransactionResult BuildBooleanCommittedShapeTransaction(
    const TopoDS_Shape& left,
    const TopoDS_Shape& right,
    const std::string& operation,
    const std::string& bodyId,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    return BuildBooleanCommittedShapeTransactionWithHistory(
      left,
      right,
      operation,
      bodyId,
      topologyToken,
      topologyToken,
      linearDeflection,
      angularDeflection
    );
  }

  static CadaraNativeFeatureTransactionResult BuildBooleanCommittedShapeTransactionWithHistory(
    const TopoDS_Shape& left,
    const TopoDS_Shape& right,
    const std::string& operation,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    if (operation == "join") {
      BRepAlgoAPI_Fuse builder(left, right);
      return CadaraBuildBooleanTransactionResult(
        builder,
        operation,
        bodyId,
        previousTopologyToken,
        topologyToken,
        linearDeflection,
        angularDeflection,
        left
      );
    }

    if (operation == "cut") {
      BRepAlgoAPI_Cut builder(left, right);
      return CadaraBuildBooleanTransactionResult(
        builder,
        operation,
        bodyId,
        previousTopologyToken,
        topologyToken,
        linearDeflection,
        angularDeflection,
        left
      );
    }

    if (operation == "intersect") {
      BRepAlgoAPI_Common builder(left, right);
      return CadaraBuildBooleanTransactionResult(
        builder,
        operation,
        bodyId,
        previousTopologyToken,
        topologyToken,
        linearDeflection,
        angularDeflection,
        left
      );
    }

    const TopoDS_Shape emptyShape;
    return CadaraNativeFeatureTransactionResult(emptyShape, CadaraBuildTopologyJson(
      emptyShape,
      bodyId,
      topologyToken,
      linearDeflection,
      angularDeflection,
      true,
      CadaraDiagnosticJson(
        "occ-native-feature-transaction-unsupported-operation",
        "error",
        "Native OCC boolean feature transaction received an unsupported operation.",
        bodyId,
        "featureTransaction",
        "operation",
        operation
      )
    ), CadaraBuildUnsupportedHistoryJson(operation, bodyId), false);
  }

  static CadaraNativeFeatureTransactionResult BuildSplitCommittedShapeTransactionWithHistory(
    const TopoDS_Shape& target,
    const TopoDS_Shape& tool,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    BRepAlgoAPI_Cut cutBuilder(target, tool);
    BRepAlgoAPI_Common commonBuilder(target, tool);
    cutBuilder.SetToFillHistory(true);
    commonBuilder.SetToFillHistory(true);

    Message_ProgressRange cutProgress;
    cutBuilder.Build(cutProgress);
    Message_ProgressRange commonProgress;
    commonBuilder.Build(commonProgress);

    if (!cutBuilder.IsDone() || !commonBuilder.IsDone()) {
      const TopoDS_Shape emptyShape;
      return CadaraNativeFeatureTransactionResult(emptyShape, CadaraBuildTopologyJson(
        emptyShape,
        bodyId,
        topologyToken,
        linearDeflection,
        angularDeflection,
        true,
        CadaraDiagnosticJson(
          "occ-native-feature-transaction-failed",
          "error",
          "Native OCC split feature transaction failed to build.",
          bodyId,
          "featureTransaction",
          "operation",
          "split"
        )
      ), CadaraBuildUnsupportedHistoryJson("split", bodyId), false);
    }

    cutBuilder.SimplifyResult(true, true, 1.0e-7);
    commonBuilder.SimplifyResult(true, true, 1.0e-7);
    const TopoDS_Shape cutShape = CadaraPrepareCommittedShape(
      cutBuilder.Shape(),
      linearDeflection,
      angularDeflection
    );
    const TopoDS_Shape commonShape = CadaraPrepareCommittedShape(
      commonBuilder.Shape(),
      linearDeflection,
      angularDeflection
    );

    TopoDS_Compound compound;
    BRep_Builder compoundBuilder;
    compoundBuilder.MakeCompound(compound);
    if (!cutShape.IsNull()) {
      compoundBuilder.Add(compound, cutShape);
    }
    if (!commonShape.IsNull()) {
      compoundBuilder.Add(compound, commonShape);
    }

    const TopoDS_Shape preparedCompound = CadaraPrepareCommittedShape(
      compound,
      linearDeflection,
      angularDeflection
    );

    return CadaraNativeFeatureTransactionResult(
      preparedCompound,
      CadaraBuildTopologyJson(preparedCompound, bodyId, topologyToken, linearDeflection, angularDeflection, true),
      CadaraBuildSplitFeatureHistoryJson(
        cutBuilder,
        commonBuilder,
        bodyId,
        previousTopologyToken,
        topologyToken,
        target,
        preparedCompound
      ),
      true
    );
  }

  static CadaraNativeFeatureTransactionResult BuildFilletCommittedShapeTransactionWithHistory(
    const TopoDS_Shape& shape,
    const std::string& edgeIdsCsv,
    const double radius,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    if (radius <= 0.0) {
      const TopoDS_Shape emptyShape;
      return CadaraNativeFeatureTransactionResult(emptyShape, CadaraBuildTopologyJson(
        emptyShape,
        bodyId,
        topologyToken,
        linearDeflection,
        angularDeflection,
        true,
        CadaraDiagnosticJson(
          "occ-native-feature-transaction-invalid-parameter",
          "error",
          "Native OCC fillet feature transaction requires a positive radius.",
          bodyId,
          "featureTransaction",
          "operation",
          "fillet"
        )
      ), CadaraBuildUnsupportedHistoryJson("fillet", bodyId), false);
    }

    BRepFilletAPI_MakeFillet fillet(shape, ChFi3d_Rational);
    const std::vector<std::string> edgeIds = CadaraSplitTargetIds(edgeIdsCsv);

    if (edgeIds.empty()) {
      const TopoDS_Shape emptyShape;
      return CadaraNativeFeatureTransactionResult(emptyShape, CadaraBuildTopologyJson(
        emptyShape,
        bodyId,
        topologyToken,
        linearDeflection,
        angularDeflection,
        true,
        CadaraDiagnosticJson(
          "occ-native-feature-transaction-missing-target",
          "error",
          "Native OCC fillet feature transaction requires at least one target edge.",
          bodyId,
          "featureTransaction",
          "operation",
          "fillet"
        )
      ), CadaraBuildUnsupportedHistoryJson("fillet", bodyId), false);
    }

    for (const std::string& edgeId : edgeIds) {
      TopoDS_Edge edge;
      if (!CadaraFindEdgeById(shape, bodyId, previousTopologyToken, edgeId, edge)) {
        const TopoDS_Shape emptyShape;
        return CadaraNativeFeatureTransactionResult(emptyShape, CadaraBuildTopologyJson(
          emptyShape,
          bodyId,
          topologyToken,
          linearDeflection,
          angularDeflection,
          true,
          CadaraDiagnosticJson(
            "occ-native-feature-transaction-missing-target",
            "error",
            "Native OCC fillet feature transaction could not resolve a target edge.",
            bodyId,
            "featureTransaction",
            "edgeId",
            edgeId
          )
        ), CadaraBuildUnsupportedHistoryJson("fillet", bodyId), false);
      }

      fillet.Add(radius, edge);
    }

    return CadaraBuildLocalOperationTransactionResult(
      fillet,
      "fillet",
      bodyId,
      previousTopologyToken,
      topologyToken,
      linearDeflection,
      angularDeflection,
      shape
    );
  }

  static CadaraNativeFeatureTransactionResult BuildChamferCommittedShapeTransactionWithHistory(
    const TopoDS_Shape& shape,
    const std::string& edgeIdsCsv,
    const double distance,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    if (distance <= 0.0) {
      const TopoDS_Shape emptyShape;
      return CadaraNativeFeatureTransactionResult(emptyShape, CadaraBuildTopologyJson(
        emptyShape,
        bodyId,
        topologyToken,
        linearDeflection,
        angularDeflection,
        true,
        CadaraDiagnosticJson(
          "occ-native-feature-transaction-invalid-parameter",
          "error",
          "Native OCC chamfer feature transaction requires a positive distance.",
          bodyId,
          "featureTransaction",
          "operation",
          "chamfer"
        )
      ), CadaraBuildUnsupportedHistoryJson("chamfer", bodyId), false);
    }

    BRepFilletAPI_MakeChamfer chamfer(shape);
    const std::vector<std::string> edgeIds = CadaraSplitTargetIds(edgeIdsCsv);

    if (edgeIds.empty()) {
      const TopoDS_Shape emptyShape;
      return CadaraNativeFeatureTransactionResult(emptyShape, CadaraBuildTopologyJson(
        emptyShape,
        bodyId,
        topologyToken,
        linearDeflection,
        angularDeflection,
        true,
        CadaraDiagnosticJson(
          "occ-native-feature-transaction-missing-target",
          "error",
          "Native OCC chamfer feature transaction requires at least one target edge.",
          bodyId,
          "featureTransaction",
          "operation",
          "chamfer"
        )
      ), CadaraBuildUnsupportedHistoryJson("chamfer", bodyId), false);
    }

    for (const std::string& edgeId : edgeIds) {
      TopoDS_Edge edge;
      TopoDS_Face adjacentFace;
      if (
        !CadaraFindEdgeById(shape, bodyId, previousTopologyToken, edgeId, edge)
        || !CadaraFindFirstAdjacentFace(shape, edge, adjacentFace)
      ) {
        const TopoDS_Shape emptyShape;
        return CadaraNativeFeatureTransactionResult(emptyShape, CadaraBuildTopologyJson(
          emptyShape,
          bodyId,
          topologyToken,
          linearDeflection,
          angularDeflection,
          true,
          CadaraDiagnosticJson(
            "occ-native-feature-transaction-missing-target",
            "error",
            "Native OCC chamfer feature transaction could not resolve a target edge and adjacent face.",
            bodyId,
            "featureTransaction",
            "edgeId",
            edgeId
          )
        ), CadaraBuildUnsupportedHistoryJson("chamfer", bodyId), false);
      }

      chamfer.Add(distance, distance, edge, adjacentFace);
    }

    return CadaraBuildLocalOperationTransactionResult(
      chamfer,
      "chamfer",
      bodyId,
      previousTopologyToken,
      topologyToken,
      linearDeflection,
      angularDeflection,
      shape
    );
  }

  static CadaraNativeFeatureTransactionResult BuildShellCommittedShapeTransactionWithHistory(
    const TopoDS_Shape& shape,
    const std::string& faceIdsCsv,
    const double signedThickness,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    if (signedThickness == 0.0) {
      const TopoDS_Shape emptyShape;
      return CadaraNativeFeatureTransactionResult(emptyShape, CadaraBuildTopologyJson(
        emptyShape,
        bodyId,
        topologyToken,
        linearDeflection,
        angularDeflection,
        true,
        CadaraDiagnosticJson(
          "occ-native-feature-transaction-invalid-parameter",
          "error",
          "Native OCC shell feature transaction requires a non-zero signed thickness.",
          bodyId,
          "featureTransaction",
          "operation",
          "shell"
        )
      ), CadaraBuildUnsupportedHistoryJson("shell", bodyId), false);
    }

    const std::vector<std::string> faceIds = CadaraSplitTargetIds(faceIdsCsv);
    if (faceIds.empty()) {
      const TopoDS_Shape emptyShape;
      return CadaraNativeFeatureTransactionResult(emptyShape, CadaraBuildTopologyJson(
        emptyShape,
        bodyId,
        topologyToken,
        linearDeflection,
        angularDeflection,
        true,
        CadaraDiagnosticJson(
          "occ-native-feature-transaction-missing-target",
          "error",
          "Native OCC shell feature transaction requires at least one removable face.",
          bodyId,
          "featureTransaction",
          "operation",
          "shell"
        )
      ), CadaraBuildUnsupportedHistoryJson("shell", bodyId), false);
    }

    TopTools_ListOfShape closingFaces;
    for (const std::string& faceId : faceIds) {
      TopoDS_Face face;
      if (!CadaraFindFaceById(shape, bodyId, previousTopologyToken, faceId, face)) {
        const TopoDS_Shape emptyShape;
        return CadaraNativeFeatureTransactionResult(emptyShape, CadaraBuildTopologyJson(
          emptyShape,
          bodyId,
          topologyToken,
          linearDeflection,
          angularDeflection,
          true,
          CadaraDiagnosticJson(
            "occ-native-feature-transaction-missing-target",
            "error",
            "Native OCC shell feature transaction could not resolve a removable face.",
            bodyId,
            "featureTransaction",
            "faceId",
            faceId
          )
        ), CadaraBuildUnsupportedHistoryJson("shell", bodyId), false);
      }

      closingFaces.Append(face);
    }

    BRepOffsetAPI_MakeThickSolid shell;
    Message_ProgressRange progress;
    shell.MakeThickSolidByJoin(
      shape,
      closingFaces,
      signedThickness,
      linearDeflection,
      BRepOffset_Skin,
      false,
      false,
      GeomAbs_Arc,
      false,
      progress
    );

    return CadaraBuildLocalOperationTransactionResult(
      shell,
      "shell",
      bodyId,
      previousTopologyToken,
      topologyToken,
      linearDeflection,
      angularDeflection,
      shape
    );
  }

  static CadaraNativeFeatureTransactionResult BuildTransformCommittedShapeTransactionWithHistory(
    const TopoDS_Shape& shape,
    const gp_Trsf& transform,
    const bool copy,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    BRepBuilderAPI_Transform builder(shape, transform, copy);

    return CadaraBuildLocalOperationTransactionResult(
      builder,
      "transform",
      bodyId,
      previousTopologyToken,
      topologyToken,
      linearDeflection,
      angularDeflection,
      shape
    );
  }
