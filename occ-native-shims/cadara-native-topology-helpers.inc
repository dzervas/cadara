

// Temporary pre-8.0 native topology shim. Delete these bridge classes after
// the OCCT 8/BRepGraph migration owns topology identity, history,
// adjacency, meshing, exact B-rep extraction, and export payload generation.
namespace {
  std::string CadaraEscapeJson(const std::string& value) {
    std::ostringstream out;
    for (char character : value) {
      switch (character) {
        case '"':
          out << "\\\"";
          break;
        case '\\':
          out << "\\\\";
          break;
        case '\n':
          out << "\\n";
          break;
        case '\r':
          out << "\\r";
          break;
        case '\t':
          out << "\\t";
          break;
        default:
          out << character;
          break;
      }
    }
    return out.str();
  }

  int CadaraShapeCount(const TopoDS_Shape& shape, const TopAbs_ShapeEnum shapeType) {
    if (shape.IsNull()) {
      return 0;
    }

    TopTools_IndexedMapOfShape shapeMap;
    TopExp::MapShapes(shape, shapeType, shapeMap);
    return shapeMap.Size();
  }

  std::string CadaraTopologyKind(const TopAbs_ShapeEnum shapeType) {
    switch (shapeType) {
      case TopAbs_FACE:
        return "face";
      case TopAbs_EDGE:
        return "edge";
      case TopAbs_VERTEX:
        return "vertex";
      default:
        return "unknown";
    }
  }

  std::string CadaraTopologyIdPrefix(const TopAbs_ShapeEnum shapeType) {
    switch (shapeType) {
      case TopAbs_FACE:
        return "face_";
      case TopAbs_EDGE:
        return "edge_";
      case TopAbs_VERTEX:
        return "vertex_";
      default:
        return "topology_";
    }
  }

  double CadaraQuantizedDouble(const double value) {
    if (std::abs(value) < 1.0e-9) {
      return 0.0;
    }
    return std::round(value * 1000000.0) / 1000000.0;
  }

  std::string CadaraDoubleKey(const double value) {
    std::ostringstream out;
    out << std::fixed << std::setprecision(6) << CadaraQuantizedDouble(value);
    return out.str();
  }

  std::string CadaraPointKey(const gp_Pnt& point) {
    return CadaraDoubleKey(point.X())
      + ","
      + CadaraDoubleKey(point.Y())
      + ","
      + CadaraDoubleKey(point.Z());
  }

  std::string CadaraStableDigest(const std::string& value) {
    std::uint64_t hash = 14695981039346656037ULL;
    for (const unsigned char character : value) {
      hash ^= static_cast<std::uint64_t>(character);
      hash *= 1099511628211ULL;
    }

    std::ostringstream out;
    out << std::hex << hash;
    return out.str();
  }

  std::string CadaraStableShapeSignature(
    const TopAbs_ShapeEnum shapeType,
    const TopoDS_Shape& shape
  ) {
    if (shapeType == TopAbs_VERTEX) {
      const TopoDS_Vertex vertex = TopoDS::Vertex(shape);
      return "vertex:" + CadaraPointKey(BRep_Tool::Pnt(vertex));
    }

    if (shapeType == TopAbs_EDGE) {
      const TopoDS_Edge edge = TopoDS::Edge(shape);
      const TopoDS_Vertex firstVertex = TopExp::FirstVertex(edge, true);
      const TopoDS_Vertex lastVertex = TopExp::LastVertex(edge, true);
      std::string firstPointKey = CadaraPointKey(BRep_Tool::Pnt(firstVertex));
      std::string lastPointKey = CadaraPointKey(BRep_Tool::Pnt(lastVertex));
      if (lastPointKey < firstPointKey) {
        std::swap(firstPointKey, lastPointKey);
      }

      GProp_GProps properties;
      BRepGProp::LinearProperties(edge, properties);
      return "edge:"
        + firstPointKey
        + ":"
        + lastPointKey
        + ":length:"
        + CadaraDoubleKey(properties.Mass())
        + ":center:"
        + CadaraPointKey(properties.CentreOfMass());
    }

    if (shapeType == TopAbs_FACE) {
      const TopoDS_Face face = TopoDS::Face(shape);
      GProp_GProps properties;
      BRepGProp::SurfaceProperties(face, properties);
      const BRepAdaptor_Surface surface(face);
      return "face:type:"
        + std::to_string(static_cast<int>(surface.GetType()))
        + ":area:"
        + CadaraDoubleKey(properties.Mass())
        + ":center:"
        + CadaraPointKey(properties.CentreOfMass());
    }

    return CadaraTopologyKind(shapeType) + ":unsupported";
  }

  std::string CadaraKernelUidForShape(
    const TopAbs_ShapeEnum shapeType,
    const TopoDS_Shape& shape
  ) {
    std::ostringstream out;
    out
      << "occt7-shim:"
      << CadaraTopologyKind(shapeType)
      << ":"
      << CadaraStableShapeSignature(shapeType, shape);
    return out.str();
  }

  std::string CadaraTopologyIdForShape(
    const TopAbs_ShapeEnum shapeType,
    const std::string& bodyId,
    const TopoDS_Shape& shape
  ) {
    return CadaraTopologyIdPrefix(shapeType)
      + bodyId
      + "_g"
      + CadaraStableDigest(CadaraStableShapeSignature(shapeType, shape));
  }

  std::vector<std::string> CadaraCanonicalTopologyIdsForShapeMap(
    const TopTools_IndexedMapOfShape& shapeMap,
    const TopAbs_ShapeEnum shapeType,
    const std::string& bodyId
  ) {
    std::map<std::string, int> collisionCounts;
    std::vector<std::string> ids(shapeMap.Size() + 1);

    for (int index = 1; index <= shapeMap.Size(); index += 1) {
      const std::string baseId = CadaraTopologyIdForShape(
        shapeType,
        bodyId,
        shapeMap.FindKey(index)
      );
      const int collisionIndex = collisionCounts[baseId];
      collisionCounts[baseId] = collisionIndex + 1;
      ids[index] = collisionIndex == 0
        ? baseId
        : baseId + "_i" + std::to_string(collisionIndex);
    }

    return ids;
  }

  void CadaraAppendTopologyRecords(
    std::ostringstream& out,
    const TopoDS_Shape& shape,
    const TopAbs_ShapeEnum shapeType,
    const std::string& bodyId,
    const std::string& topologyToken,
    bool& needsComma
  ) {
    if (shape.IsNull()) {
      return;
    }

    TopTools_IndexedMapOfShape shapeMap;
    TopExp::MapShapes(shape, shapeType, shapeMap);
    const std::vector<std::string> canonicalIds = CadaraCanonicalTopologyIdsForShapeMap(
      shapeMap,
      shapeType,
      bodyId
    );

    for (int index = 1; index <= shapeMap.Size(); index += 1) {
      if (needsComma) {
        out << ",";
      }
      needsComma = true;

      const TopoDS_Shape subshape = shapeMap.FindKey(index);
      const std::string kind = CadaraTopologyKind(shapeType);
      const std::string& id = canonicalIds[index];
      const std::string kernelUid = CadaraKernelUidForShape(shapeType, subshape);

      out
        << "{\"id\":\"" << CadaraEscapeJson(id)
        << "\",\"kernelUid\":\"" << CadaraEscapeJson(kernelUid)
        << "\",\"kind\":\"" << kind
        << "\",\"bodyId\":\"" << CadaraEscapeJson(bodyId)
        << "\",\"index\":" << index
        << "}";
    }
  }

  void CadaraAppendEdgeVertexRecords(
    std::ostringstream& out,
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& topologyToken
  ) {
    if (shape.IsNull()) {
      return;
    }

    TopTools_IndexedMapOfShape edgeMap;
    TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);
    const std::vector<std::string> edgeIds = CadaraCanonicalTopologyIdsForShapeMap(
      edgeMap,
      TopAbs_EDGE,
      bodyId
    );

    for (int index = 1; index <= edgeMap.Size(); index += 1) {
      if (index > 1) {
        out << ",";
      }

      const TopoDS_Edge edge = TopoDS::Edge(edgeMap.FindKey(index));
      const TopoDS_Vertex firstVertex = TopExp::FirstVertex(edge, true);
      const TopoDS_Vertex lastVertex = TopExp::LastVertex(edge, true);
      const gp_Pnt firstPoint = BRep_Tool::Pnt(firstVertex);
      const gp_Pnt lastPoint = BRep_Tool::Pnt(lastVertex);
      const std::string& edgeId = edgeIds[index];

      out
        << "{\"edgeId\":\"" << CadaraEscapeJson(edgeId)
        << "\",\"start\":[" << firstPoint.X() << "," << firstPoint.Y() << "," << firstPoint.Z()
        << "],\"end\":[" << lastPoint.X() << "," << lastPoint.Y() << "," << lastPoint.Z()
        << "]}";
    }
  }

  void CadaraAppendVertexPointRecords(
    std::ostringstream& out,
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& topologyToken
  ) {
    if (shape.IsNull()) {
      return;
    }

    TopTools_IndexedMapOfShape vertexMap;
    TopExp::MapShapes(shape, TopAbs_VERTEX, vertexMap);
    const std::vector<std::string> vertexIds = CadaraCanonicalTopologyIdsForShapeMap(
      vertexMap,
      TopAbs_VERTEX,
      bodyId
    );

    for (int index = 1; index <= vertexMap.Size(); index += 1) {
      if (index > 1) {
        out << ",";
      }

      const TopoDS_Vertex vertex = TopoDS::Vertex(vertexMap.FindKey(index));
      const gp_Pnt point = BRep_Tool::Pnt(vertex);
      const std::string& vertexId = vertexIds[index];

      out
        << "{\"vertexId\":\"" << CadaraEscapeJson(vertexId)
        << "\",\"point\":[" << point.X() << "," << point.Y() << "," << point.Z()
        << "]}";
    }
  }

  void CadaraAppendFaceEdgeRecords(
    std::ostringstream& out,
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& topologyToken
  ) {
    if (shape.IsNull()) {
      return;
    }

    TopTools_IndexedMapOfShape faceMap;
    TopTools_IndexedMapOfShape edgeMap;
    TopExp::MapShapes(shape, TopAbs_FACE, faceMap);
    TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);
    const std::vector<std::string> faceIds = CadaraCanonicalTopologyIdsForShapeMap(
      faceMap,
      TopAbs_FACE,
      bodyId
    );
    const std::vector<std::string> edgeIds = CadaraCanonicalTopologyIdsForShapeMap(
      edgeMap,
      TopAbs_EDGE,
      bodyId
    );

    for (int faceIndex = 1; faceIndex <= faceMap.Size(); faceIndex += 1) {
      if (faceIndex > 1) {
        out << ",";
      }

      const TopoDS_Face face = TopoDS::Face(faceMap.FindKey(faceIndex));
      TopTools_IndexedMapOfShape faceEdgeMap;
      TopExp::MapShapes(face, TopAbs_EDGE, faceEdgeMap);
      const std::string& faceId = faceIds[faceIndex];

      out
        << "{\"faceId\":\"" << CadaraEscapeJson(faceId)
        << "\",\"edgeIds\":[";

      bool needsComma = false;
      for (int edgeIndex = 1; edgeIndex <= faceEdgeMap.Size(); edgeIndex += 1) {
        const int globalEdgeIndex = edgeMap.FindIndex(faceEdgeMap.FindKey(edgeIndex));
        if (globalEdgeIndex <= 0) {
          continue;
        }
        if (needsComma) {
          out << ",";
        }
        needsComma = true;
        const std::string& edgeId = edgeIds[globalEdgeIndex];
        out << "\"" << CadaraEscapeJson(edgeId) << "\"";
      }

      out << "]}";
    }
  }

  void CadaraAppendMeshPayload(
    std::ostringstream& out,
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    if (shape.IsNull()) {
      out
        << "\"mesh\":{\"nodeCount\":0"
        << ",\"triangleCount\":0"
        << ",\"linearDeflection\":" << linearDeflection
        << ",\"angularDeflection\":" << angularDeflection
        << ",\"positions\":[],\"triangleIndices\":[],\"triangleFaceBindings\":[]}";
      return;
    }

    BRepMesh_IncrementalMesh mesher(shape, linearDeflection, false, angularDeflection, false);
    TopTools_IndexedMapOfShape faceMap;
    TopExp::MapShapes(shape, TopAbs_FACE, faceMap);
    const std::vector<std::string> faceIds = CadaraCanonicalTopologyIdsForShapeMap(
      faceMap,
      TopAbs_FACE,
      bodyId
    );

    int nodeCount = 0;
    int triangleCount = 0;

    for (int index = 1; index <= faceMap.Size(); index += 1) {
      const TopoDS_Face face = TopoDS::Face(faceMap.FindKey(index));
      TopLoc_Location location;
      const Handle_Poly_Triangulation triangulation = BRep_Tool::Triangulation(face, location);

      if (!triangulation.IsNull()) {
        nodeCount += triangulation->NbNodes();
        triangleCount += triangulation->NbTriangles();
      }
    }

    out
      << "\"mesh\":{\"nodeCount\":" << nodeCount
      << ",\"triangleCount\":" << triangleCount
      << ",\"linearDeflection\":" << linearDeflection
      << ",\"angularDeflection\":" << angularDeflection
      << ",\"positions\":[";

    bool needsPositionComma = false;
    for (int faceIndex = 1; faceIndex <= faceMap.Size(); faceIndex += 1) {
      const TopoDS_Face face = TopoDS::Face(faceMap.FindKey(faceIndex));
      TopLoc_Location location;
      const Handle_Poly_Triangulation triangulation = BRep_Tool::Triangulation(face, location);

      if (triangulation.IsNull()) {
        continue;
      }

      for (int nodeIndex = 1; nodeIndex <= triangulation->NbNodes(); nodeIndex += 1) {
        if (needsPositionComma) {
          out << ",";
        }
        needsPositionComma = true;
        const gp_Pnt point = triangulation->Node(nodeIndex).Transformed(location.Transformation());
        out << "[" << point.X() << "," << point.Y() << "," << point.Z() << "]";
      }
    }

    out << "],\"triangleIndices\":[";

    bool needsTriangleComma = false;
    int nodeOffset = 0;
    for (int faceIndex = 1; faceIndex <= faceMap.Size(); faceIndex += 1) {
      const TopoDS_Face face = TopoDS::Face(faceMap.FindKey(faceIndex));
      TopLoc_Location location;
      const Handle_Poly_Triangulation triangulation = BRep_Tool::Triangulation(face, location);

      if (triangulation.IsNull()) {
        continue;
      }

      for (int triangleIndex = 1; triangleIndex <= triangulation->NbTriangles(); triangleIndex += 1) {
        if (needsTriangleComma) {
          out << ",";
        }
        needsTriangleComma = true;
        const Poly_Triangle triangle = triangulation->Triangle(triangleIndex);
        const bool isReversed = face.Orientation() == TopAbs_REVERSED;
        out
          << "[" << nodeOffset + triangle.Value(1) - 1
          << "," << nodeOffset + triangle.Value(isReversed ? 3 : 2) - 1
          << "," << nodeOffset + triangle.Value(isReversed ? 2 : 3) - 1
          << "]";
      }

      nodeOffset += triangulation->NbNodes();
    }

    out << "],\"triangleFaceBindings\":[";

    bool needsBindingComma = false;
    for (int faceIndex = 1; faceIndex <= faceMap.Size(); faceIndex += 1) {
      const TopoDS_Face face = TopoDS::Face(faceMap.FindKey(faceIndex));
      TopLoc_Location location;
      const Handle_Poly_Triangulation triangulation = BRep_Tool::Triangulation(face, location);

      if (triangulation.IsNull()) {
        continue;
      }

      const std::string& faceId = faceIds[faceIndex];
      for (int triangleIndex = 1; triangleIndex <= triangulation->NbTriangles(); triangleIndex += 1) {
        if (needsBindingComma) {
          out << ",";
        }
        needsBindingComma = true;
        out << "\"" << CadaraEscapeJson(faceId) << "\"";
      }
    }

    out << "]}";
  }

  std::string CadaraDiagnosticJson(
    const std::string& code,
    const std::string& severity,
    const std::string& message,
    const std::string& bodyId,
    const std::string& kind,
    const std::string& detailKey,
    const std::string& detailValue
  ) {
    std::ostringstream out;
    out
      << "{\"code\":\"" << CadaraEscapeJson(code) << "\""
      << ",\"severity\":\"" << CadaraEscapeJson(severity) << "\""
      << ",\"message\":\"" << CadaraEscapeJson(message) << "\""
      << ",\"target\":{\"kind\":\"body\",\"bodyId\":\"" << CadaraEscapeJson(bodyId) << "\"}"
      << ",\"detail\":{\"kind\":\"" << CadaraEscapeJson(kind) << "\""
      << ",\"" << CadaraEscapeJson(detailKey) << "\":\"" << CadaraEscapeJson(detailValue) << "\"}"
      << "}";
    return out.str();
  }

  void CadaraAppendValidationDiagnostics(
    std::ostringstream& out,
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& extraDiagnosticJson = ""
  ) {
    out << "[";
    bool needsComma = false;
    if (!extraDiagnosticJson.empty()) {
      out << extraDiagnosticJson;
      needsComma = true;
    }
    if (shape.IsNull()) {
      if (needsComma) {
        out << ",";
      }
      needsComma = true;
      out
        << "{\"code\":\"occ-native-topology-invalid-shape\""
        << ",\"severity\":\"error\""
        << ",\"message\":\"Native OCC validation rejected a null committed solid shape.\""
        << ",\"target\":{\"kind\":\"body\",\"bodyId\":\"" << CadaraEscapeJson(bodyId) << "\"}"
        << ",\"detail\":{\"kind\":\"shapeValidation\",\"validator\":\"TopoDS_Shape::IsNull\"}"
        << "}";
    } else {
      BRepCheck_Analyzer analyzer(shape, true);

      if (!analyzer.IsValid()) {
        if (needsComma) {
          out << ",";
        }
        needsComma = true;
        out
          << "{\"code\":\"occ-native-topology-invalid-shape\""
          << ",\"severity\":\"error\""
          << ",\"message\":\"Native OCC validation rejected the committed solid shape.\""
          << ",\"target\":{\"kind\":\"body\",\"bodyId\":\"" << CadaraEscapeJson(bodyId) << "\"}"
          << ",\"detail\":{\"kind\":\"shapeValidation\",\"validator\":\"BRepCheck_Analyzer\"}"
          << "}";
      }
    }
    out << "]";
  }

  TopoDS_Shape CadaraPrepareCommittedShape(
    const TopoDS_Shape& shape,
    const double linearTolerance,
    const double angularTolerance
  ) {
    if (shape.IsNull()) {
      return shape;
    }

    ShapeUpgrade_UnifySameDomain unifier(shape, true, true, true);
    unifier.SetLinearTolerance(linearTolerance);
    unifier.SetAngularTolerance(angularTolerance);
    unifier.Build();

    TopoDS_Shape preparedShape = unifier.Shape();
    BRep_Builder builder;
    TopTools_IndexedMapOfShape edgeMap;
    TopExp::MapShapes(preparedShape, TopAbs_EDGE, edgeMap);

    for (int edgeIndex = 1; edgeIndex <= edgeMap.Size(); edgeIndex += 1) {
      TopoDS_Edge edge = TopoDS::Edge(edgeMap.FindKey(edgeIndex));
      builder.SameParameter(edge, true);
      builder.SameRange(edge, true);
    }

    return preparedShape;
  }

  struct CadaraPreparedCommittedShape {
    TopoDS_Shape shape;
    Handle(BRepTools_History) history;
  };

  CadaraPreparedCommittedShape CadaraPrepareCommittedShapeWithHistory(
    const TopoDS_Shape& shape,
    const double linearTolerance,
    const double angularTolerance
  ) {
    if (shape.IsNull()) {
      return {shape, Handle(BRepTools_History)()};
    }

    ShapeUpgrade_UnifySameDomain unifier(shape, true, true, true);
    unifier.SetLinearTolerance(linearTolerance);
    unifier.SetAngularTolerance(angularTolerance);
    unifier.Build();

    TopoDS_Shape preparedShape = unifier.Shape();
    BRep_Builder builder;
    TopTools_IndexedMapOfShape edgeMap;
    TopExp::MapShapes(preparedShape, TopAbs_EDGE, edgeMap);

    for (int edgeIndex = 1; edgeIndex <= edgeMap.Size(); edgeIndex += 1) {
      TopoDS_Edge edge = TopoDS::Edge(edgeMap.FindKey(edgeIndex));
      builder.SameParameter(edge, true);
      builder.SameRange(edge, true);
    }

    return {preparedShape, unifier.History()};
  }

  std::string CadaraBuildTopologyJson(
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection,
    const bool includeMesh,
    const std::string& extraDiagnosticJson = ""
  ) {
    std::ostringstream out;
    out
      << "{\"schemaVersion\":\"occ-native-topology-payload/v1alpha1\""
      << ",\"source\":\"occt7-shim\""
      << ",\"bodyId\":\"" << CadaraEscapeJson(bodyId) << "\""
      << ",\"topologyToken\":\"" << CadaraEscapeJson(topologyToken) << "\""
      << ",\"counts\":{\"faces\":" << CadaraShapeCount(shape, TopAbs_FACE)
      << ",\"edges\":" << CadaraShapeCount(shape, TopAbs_EDGE)
      << ",\"vertices\":" << CadaraShapeCount(shape, TopAbs_VERTEX)
      << "},\"topology\":[";

    bool needsComma = false;
    CadaraAppendTopologyRecords(out, shape, TopAbs_FACE, bodyId, topologyToken, needsComma);
    CadaraAppendTopologyRecords(out, shape, TopAbs_EDGE, bodyId, topologyToken, needsComma);
    CadaraAppendTopologyRecords(out, shape, TopAbs_VERTEX, bodyId, topologyToken, needsComma);

    out << "],\"edgeVertices\":[";
    CadaraAppendEdgeVertexRecords(out, shape, bodyId, topologyToken);
    out << "],\"vertexPoints\":[";
    CadaraAppendVertexPointRecords(out, shape, bodyId, topologyToken);
    out << "],\"faceEdges\":[";
    CadaraAppendFaceEdgeRecords(out, shape, bodyId, topologyToken);
    out << "]";

    if (includeMesh) {
      out << ",";
      CadaraAppendMeshPayload(out, shape, bodyId, topologyToken, linearDeflection, angularDeflection);
    }

    out << ",\"diagnostics\":";
    CadaraAppendValidationDiagnostics(out, shape, bodyId, extraDiagnosticJson);
    out << "}";
    return out.str();
  }

  std::string CadaraBuildUnsupportedHistoryJson(
    const std::string& operation,
    const std::string& bodyId
  ) {
    std::ostringstream out;
    out
      << "{\"schemaVersion\":\"occ-native-history-payload/v1alpha1\""
      << ",\"source\":\"occt7-shim\""
      << ",\"status\":\"unsupported\""
      << ",\"diagnostics\":["
      << CadaraDiagnosticJson(
        "occ-native-topology-unsupported-history",
        "warning",
        "Native OCC feature transaction did not emit reliable topology successor history.",
        bodyId,
        "featureTransactionHistory",
        "operation",
        operation
      )
      << "]}";
    return out.str();
  }

  std::string CadaraTargetIdForKind(
    const TopAbs_ShapeEnum shapeType,
    const std::string& bodyId,
    const std::string& topologyToken,
    const int index
  ) {
    return CadaraTopologyIdPrefix(shapeType) + bodyId + "_" + topologyToken + "_" + std::to_string(index);
  }

  std::string CadaraTargetIdFieldForKind(const TopAbs_ShapeEnum shapeType) {
    switch (shapeType) {
      case TopAbs_FACE:
        return "faceId";
      case TopAbs_EDGE:
        return "edgeId";
      case TopAbs_VERTEX:
        return "vertexId";
      default:
        return "topologyId";
    }
  }

  void CadaraAppendDurableTopologyTargetJson(
    std::ostringstream& out,
    const TopAbs_ShapeEnum shapeType,
    const std::string& bodyId,
    const TopoDS_Shape& shape
  ) {
    out
      << "{\"kind\":\"" << CadaraTopologyKind(shapeType) << "\""
      << ",\"bodyId\":\"" << CadaraEscapeJson(bodyId) << "\""
      << ",\"" << CadaraTargetIdFieldForKind(shapeType) << "\":\""
      << CadaraEscapeJson(CadaraTopologyIdForShape(shapeType, bodyId, shape))
      << "\"}";
  }

  int CadaraAppendHistorySuccessorsFromList(
    std::ostringstream& out,
    const TopTools_ListOfShape& source,
    TopTools_IndexedMapOfShape& finalShapeMap,
    const TopAbs_ShapeEnum shapeType,
    const std::string& bodyId,
    const std::string& topologyToken,
    bool& needsSuccessorComma,
    std::vector<int>& successorIndexes
  ) {
    int appended = 0;
    TopTools_ListOfShape copy(source);

    while (copy.Size() > 0) {
      const int finalIndex = finalShapeMap.FindIndex(copy.First());
      copy.RemoveFirst();

      if (finalIndex <= 0) {
        continue;
      }

      bool alreadyIncluded = false;
      for (int existingIndex : successorIndexes) {
        if (existingIndex == finalIndex) {
          alreadyIncluded = true;
          break;
        }
      }

      if (alreadyIncluded) {
        continue;
      }

      if (needsSuccessorComma) {
        out << ",";
      }
      needsSuccessorComma = true;
      successorIndexes.push_back(finalIndex);
      CadaraAppendDurableTopologyTargetJson(out, shapeType, bodyId, finalShapeMap.FindKey(finalIndex));
      appended += 1;
    }

    return appended;
  }

  template <typename Builder>
  void CadaraAppendHistoryRecordsForKind(
    std::ostringstream& out,
    Builder& builder,
    const TopoDS_Shape& previousShape,
    const TopoDS_Shape& finalShape,
    const TopAbs_ShapeEnum shapeType,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    bool& needsRecordComma
  ) {
    TopTools_IndexedMapOfShape previousShapeMap;
    TopTools_IndexedMapOfShape finalShapeMap;
    TopExp::MapShapes(previousShape, shapeType, previousShapeMap);
    TopExp::MapShapes(finalShape, shapeType, finalShapeMap);

    for (int previousIndex = 1; previousIndex <= previousShapeMap.Size(); previousIndex += 1) {
      const TopoDS_Shape previousSubshape = previousShapeMap.FindKey(previousIndex);
      const bool deleted = builder.IsDeleted(previousSubshape);
      TopTools_ListOfShape modified = builder.Modified(previousSubshape);
      TopTools_ListOfShape generated = builder.Generated(previousSubshape);
      std::ostringstream successorsJson;
      bool needsSuccessorComma = false;
      std::vector<int> successorIndexes;

      CadaraAppendHistorySuccessorsFromList(
        successorsJson,
        modified,
        finalShapeMap,
        shapeType,
        bodyId,
        topologyToken,
        needsSuccessorComma,
        successorIndexes
      );
      CadaraAppendHistorySuccessorsFromList(
        successorsJson,
        generated,
        finalShapeMap,
        shapeType,
        bodyId,
        topologyToken,
        needsSuccessorComma,
        successorIndexes
      );

      if (successorIndexes.empty() && !deleted) {
        const int preservedIndex = finalShapeMap.FindIndex(previousSubshape);
        if (preservedIndex > 0) {
          CadaraAppendDurableTopologyTargetJson(successorsJson, shapeType, bodyId, finalShapeMap.FindKey(preservedIndex));
          successorIndexes.push_back(preservedIndex);
        }
      }

      std::string reason = "missing";
      if (deleted && successorIndexes.empty()) {
        reason = "deleted";
      } else if (successorIndexes.size() == 1) {
        reason = "unique-successor";
      } else if (successorIndexes.size() > 1) {
        reason = "ambiguous";
      }

      if (needsRecordComma) {
        out << ",";
      }
      needsRecordComma = true;

      out << "{\"target\":";
      CadaraAppendDurableTopologyTargetJson(out, shapeType, bodyId, previousSubshape);
      out
        << ",\"reason\":\"" << reason << "\""
        << ",\"successors\":[" << successorsJson.str() << "]}";
    }
  }

  /**
   * Producer-identity records for subtopology the builder CREATED.
   *
   * `CadaraAppendHistoryRecordsForKind` can only ever name successors of the
   * same kind as the prior subshape it iterates, so an entity the operation
   * generated (a chamfer's new face, and its edges/vertices) is named in no
   * record at all and reaches the TS side with no source key. `Generated` is
   * answerable only while the builder is alive, and this shim destroys it, so
   * the attribution has to be emitted here.
   *
   * Each record names the prior subshape it is attributed to and carries the
   * generated entities, whatever their own kind. Ordering and dedup follow the
   * modified/deleted records: previous-map order, first occurrence wins.
   */
  template <typename Builder>
  void CadaraAppendGeneratedHistoryRecordsForKind(
    std::ostringstream& out,
    Builder& builder,
    const TopoDS_Shape& previousShape,
    const TopoDS_Shape& finalShape,
    const TopAbs_ShapeEnum shapeType,
    const std::string& bodyId,
    bool& needsRecordComma
  ) {
    TopTools_IndexedMapOfShape previousShapeMap;
    TopTools_IndexedMapOfShape finalFaceMap;
    TopTools_IndexedMapOfShape finalEdgeMap;
    TopTools_IndexedMapOfShape finalVertexMap;
    TopExp::MapShapes(previousShape, shapeType, previousShapeMap);
    TopExp::MapShapes(finalShape, TopAbs_FACE, finalFaceMap);
    TopExp::MapShapes(finalShape, TopAbs_EDGE, finalEdgeMap);
    TopExp::MapShapes(finalShape, TopAbs_VERTEX, finalVertexMap);

    for (int previousIndex = 1; previousIndex <= previousShapeMap.Size(); previousIndex += 1) {
      const TopoDS_Shape previousSubshape = previousShapeMap.FindKey(previousIndex);
      TopTools_ListOfShape generated(builder.Generated(previousSubshape));
      std::ostringstream successorsJson;
      bool needsSuccessorComma = false;
      std::vector<std::string> successorIds;

      while (generated.Size() > 0) {
        const TopoDS_Shape generatedShape = generated.First();
        generated.RemoveFirst();

        if (generatedShape.IsNull()) {
          continue;
        }

        const TopAbs_ShapeEnum generatedType = generatedShape.ShapeType();
        const TopTools_IndexedMapOfShape* finalMap =
          generatedType == TopAbs_FACE ? &finalFaceMap
          : generatedType == TopAbs_EDGE ? &finalEdgeMap
          : generatedType == TopAbs_VERTEX ? &finalVertexMap
          : nullptr;

        if (finalMap == nullptr || finalMap->FindIndex(generatedShape) <= 0) {
          continue;
        }

        const std::string generatedId =
          CadaraTopologyIdForShape(generatedType, bodyId, generatedShape);
        if (std::find(successorIds.begin(), successorIds.end(), generatedId) != successorIds.end()) {
          continue;
        }
        successorIds.push_back(generatedId);

        if (needsSuccessorComma) {
          successorsJson << ",";
        }
        needsSuccessorComma = true;
        CadaraAppendDurableTopologyTargetJson(successorsJson, generatedType, bodyId, generatedShape);
      }

      if (successorIds.empty()) {
        continue;
      }

      if (needsRecordComma) {
        out << ",";
      }
      needsRecordComma = true;

      out << "{\"target\":";
      CadaraAppendDurableTopologyTargetJson(out, shapeType, bodyId, previousSubshape);
      out
        << ",\"reason\":\"generated\""
        << ",\"successors\":[" << successorsJson.str() << "]}";
    }
  }

  template <typename Builder>
  std::string CadaraBuildFeatureHistoryJson(
    Builder& builder,
    const std::string& operation,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const TopoDS_Shape& previousShape,
    const TopoDS_Shape& finalShape
  ) {
    std::ostringstream records;
    bool needsRecordComma = false;
    CadaraAppendHistoryRecordsForKind(records, builder, previousShape, finalShape, TopAbs_FACE, bodyId, previousTopologyToken, topologyToken, needsRecordComma);
    CadaraAppendHistoryRecordsForKind(records, builder, previousShape, finalShape, TopAbs_EDGE, bodyId, previousTopologyToken, topologyToken, needsRecordComma);
    CadaraAppendHistoryRecordsForKind(records, builder, previousShape, finalShape, TopAbs_VERTEX, bodyId, previousTopologyToken, topologyToken, needsRecordComma);
    CadaraAppendGeneratedHistoryRecordsForKind(records, builder, previousShape, finalShape, TopAbs_FACE, bodyId, needsRecordComma);
    CadaraAppendGeneratedHistoryRecordsForKind(records, builder, previousShape, finalShape, TopAbs_EDGE, bodyId, needsRecordComma);
    CadaraAppendGeneratedHistoryRecordsForKind(records, builder, previousShape, finalShape, TopAbs_VERTEX, bodyId, needsRecordComma);

    std::ostringstream out;
    out
      << "{\"schemaVersion\":\"occ-native-history-payload/v1alpha1\""
      << ",\"source\":\"occt7-shim\""
      << ",\"status\":\"available\""
      << ",\"operation\":\"" << CadaraEscapeJson(operation) << "\""
      << ",\"bodyId\":\"" << CadaraEscapeJson(bodyId) << "\""
      << ",\"previousTopologyToken\":\"" << CadaraEscapeJson(previousTopologyToken) << "\""
      << ",\"topologyToken\":\"" << CadaraEscapeJson(topologyToken) << "\""
      << ",\"records\":[" << records.str() << "]"
      << ",\"diagnostics\":[]}";
    return out.str();
  }

  int CadaraParseTargetIndex(
    const std::string& targetId,
    const TopAbs_ShapeEnum shapeType,
    const std::string& bodyId,
    const std::string& topologyToken
  ) {
    const std::string prefix = CadaraTopologyIdPrefix(shapeType) + bodyId + "_" + topologyToken + "_";

    if (targetId.rfind(prefix, 0) != 0) {
      return 0;
    }

    const std::string suffix = targetId.substr(prefix.size());
    if (suffix.empty()) {
      return 0;
    }

    for (char character : suffix) {
      if (character < '0' || character > '9') {
        return 0;
      }
    }

    return std::stoi(suffix);
  }

  std::vector<std::string> CadaraSplitTargetIds(const std::string& targetIdsCsv) {
    std::vector<std::string> targetIds;
    std::string current;

    for (char character : targetIdsCsv) {
      if (character == ',') {
        if (!current.empty()) {
          targetIds.push_back(current);
          current.clear();
        }
        continue;
      }
      current.push_back(character);
    }

    if (!current.empty()) {
      targetIds.push_back(current);
    }

    return targetIds;
  }

  bool CadaraFindEdgeById(
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& topologyToken,
    const std::string& edgeId,
    TopoDS_Edge& edge
  ) {
    const int index = CadaraParseTargetIndex(edgeId, TopAbs_EDGE, bodyId, topologyToken);

    TopTools_IndexedMapOfShape edgeMap;
    TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);
    const std::vector<std::string> edgeIds = CadaraCanonicalTopologyIdsForShapeMap(
      edgeMap,
      TopAbs_EDGE,
      bodyId
    );

    if (index > 0 && index <= edgeMap.Size()) {
      edge = TopoDS::Edge(edgeMap.FindKey(index));
      return true;
    }

    for (int edgeIndex = 1; edgeIndex <= edgeMap.Size(); edgeIndex += 1) {
      const TopoDS_Edge candidate = TopoDS::Edge(edgeMap.FindKey(edgeIndex));
      if (edgeIds[edgeIndex] == edgeId) {
        edge = candidate;
        return true;
      }
    }

    return false;
  }

  bool CadaraFindFaceById(
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& topologyToken,
    const std::string& faceId,
    TopoDS_Face& face
  ) {
    const int index = CadaraParseTargetIndex(faceId, TopAbs_FACE, bodyId, topologyToken);

    TopTools_IndexedMapOfShape faceMap;
    TopExp::MapShapes(shape, TopAbs_FACE, faceMap);
    const std::vector<std::string> faceIds = CadaraCanonicalTopologyIdsForShapeMap(
      faceMap,
      TopAbs_FACE,
      bodyId
    );

    if (index > 0 && index <= faceMap.Size()) {
      face = TopoDS::Face(faceMap.FindKey(index));
      return true;
    }

    for (int faceIndex = 1; faceIndex <= faceMap.Size(); faceIndex += 1) {
      const TopoDS_Face candidate = TopoDS::Face(faceMap.FindKey(faceIndex));
      if (faceIds[faceIndex] == faceId) {
        face = candidate;
        return true;
      }
    }

    return false;
  }

  bool CadaraFindFirstAdjacentFace(
    const TopoDS_Shape& shape,
    const TopoDS_Edge& edge,
    TopoDS_Face& face
  ) {
    TopTools_IndexedDataMapOfShapeListOfShape edgeFaceMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaceMap);
    const int index = edgeFaceMap.FindIndex(edge);

    if (index <= 0) {
      return false;
    }

    const TopTools_ListOfShape& faces = edgeFaceMap.FindFromIndex(index);
    if (faces.Size() <= 0) {
      return false;
    }

    face = TopoDS::Face(faces.First());
    return true;
  }

  int CadaraCountHistorySuccessorsFromList(
    const TopTools_ListOfShape& source,
    TopTools_IndexedMapOfShape& finalShapeMap,
    std::vector<int>& successorIndexes
  ) {
    int found = 0;
    TopTools_ListOfShape copy(source);

    while (copy.Size() > 0) {
      const int finalIndex = finalShapeMap.FindIndex(copy.First());
      copy.RemoveFirst();

      if (finalIndex <= 0) {
        continue;
      }

      bool alreadyIncluded = false;
      for (int existingIndex : successorIndexes) {
        if (existingIndex == finalIndex) {
          alreadyIncluded = true;
          break;
        }
      }

      if (alreadyIncluded) {
        continue;
      }

      successorIndexes.push_back(finalIndex);
      found += 1;
    }

    return found;
  }

  template <typename CutBuilder, typename CommonBuilder>
  void CadaraAppendSplitHistoryRecordsForKind(
    std::ostringstream& out,
    CutBuilder& cutBuilder,
    CommonBuilder& commonBuilder,
    const TopoDS_Shape& previousShape,
    const TopoDS_Shape& finalShape,
    const TopAbs_ShapeEnum shapeType,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    bool& needsRecordComma
  ) {
    TopTools_IndexedMapOfShape previousShapeMap;
    TopTools_IndexedMapOfShape finalShapeMap;
    TopExp::MapShapes(previousShape, shapeType, previousShapeMap);
    TopExp::MapShapes(finalShape, shapeType, finalShapeMap);

    for (int previousIndex = 1; previousIndex <= previousShapeMap.Size(); previousIndex += 1) {
      const TopoDS_Shape previousSubshape = previousShapeMap.FindKey(previousIndex);
      std::vector<int> successorIndexes;

      CadaraCountHistorySuccessorsFromList(cutBuilder.Modified(previousSubshape), finalShapeMap, successorIndexes);
      CadaraCountHistorySuccessorsFromList(cutBuilder.Generated(previousSubshape), finalShapeMap, successorIndexes);
      CadaraCountHistorySuccessorsFromList(commonBuilder.Modified(previousSubshape), finalShapeMap, successorIndexes);
      CadaraCountHistorySuccessorsFromList(commonBuilder.Generated(previousSubshape), finalShapeMap, successorIndexes);

      const bool deletedByBoth = cutBuilder.IsDeleted(previousSubshape) && commonBuilder.IsDeleted(previousSubshape);
      if (successorIndexes.empty() && !deletedByBoth) {
        const int preservedIndex = finalShapeMap.FindIndex(previousSubshape);
        if (preservedIndex > 0) {
          successorIndexes.push_back(preservedIndex);
        }
      }

      const std::string reason = successorIndexes.empty() ? "deleted" : "ambiguous";

      if (needsRecordComma) {
        out << ",";
      }
      needsRecordComma = true;

      out << "{\"target\":";
      CadaraAppendDurableTopologyTargetJson(out, shapeType, bodyId, previousSubshape);
      out
        << ",\"reason\":\"" << reason << "\""
        << ",\"successors\":[]}";
    }
  }

  template <typename CutBuilder, typename CommonBuilder>
  std::string CadaraBuildSplitFeatureHistoryJson(
    CutBuilder& cutBuilder,
    CommonBuilder& commonBuilder,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const TopoDS_Shape& previousShape,
    const TopoDS_Shape& finalShape
  ) {
    std::ostringstream records;
    bool needsRecordComma = false;
    CadaraAppendSplitHistoryRecordsForKind(records, cutBuilder, commonBuilder, previousShape, finalShape, TopAbs_FACE, bodyId, previousTopologyToken, needsRecordComma);
    CadaraAppendSplitHistoryRecordsForKind(records, cutBuilder, commonBuilder, previousShape, finalShape, TopAbs_EDGE, bodyId, previousTopologyToken, needsRecordComma);
    CadaraAppendSplitHistoryRecordsForKind(records, cutBuilder, commonBuilder, previousShape, finalShape, TopAbs_VERTEX, bodyId, previousTopologyToken, needsRecordComma);

    std::ostringstream out;
    out
      << "{\"schemaVersion\":\"occ-native-history-payload/v1alpha1\""
      << ",\"source\":\"occt7-shim\""
      << ",\"status\":\"available\""
      << ",\"operation\":\"split\""
      << ",\"bodyId\":\"" << CadaraEscapeJson(bodyId) << "\""
      << ",\"previousTopologyToken\":\"" << CadaraEscapeJson(previousTopologyToken) << "\""
      << ",\"topologyToken\":\"" << CadaraEscapeJson(topologyToken) << "\""
      << ",\"records\":[" << records.str() << "]"
      << ",\"diagnostics\":[]}";
    return out.str();
  }

  int CadaraFindExactShapeIndex(
    const TopTools_IndexedMapOfShape& shapeMap,
    const TopoDS_Shape& shape
  ) {
    for (int index = 1; index <= shapeMap.Size(); index += 1) {
      if (shapeMap.FindKey(index).IsSame(shape)) {
        return index;
      }
    }
    return 0;
  }

  void CadaraAppendExactFaceSuccessor(
    std::vector<int>& finalFaceIndexes,
    const TopTools_IndexedMapOfShape& finalFaceMap,
    const TopoDS_Shape& candidate
  ) {
    if (candidate.IsNull() || candidate.ShapeType() != TopAbs_FACE) {
      return;
    }

    const int finalFaceIndex = CadaraFindExactShapeIndex(finalFaceMap, candidate);
    if (
      finalFaceIndex > 0
      && std::find(finalFaceIndexes.begin(), finalFaceIndexes.end(), finalFaceIndex)
        == finalFaceIndexes.end()
    ) {
      finalFaceIndexes.push_back(finalFaceIndex);
    }
  }

  void CadaraAppendPreparedFaceSuccessors(
    std::vector<int>& finalFaceIndexes,
    const TopTools_ListOfShape& intermediateFaces,
    const Handle(BRepTools_History)& prepareHistory,
    const TopTools_IndexedMapOfShape& finalFaceMap
  ) {
    TopTools_ListOfShape remaining(intermediateFaces);
    while (remaining.Size() > 0) {
      const TopoDS_Shape intermediateFace = remaining.First();
      remaining.RemoveFirst();
      CadaraAppendExactFaceSuccessor(finalFaceIndexes, finalFaceMap, intermediateFace);

      if (prepareHistory.IsNull()) {
        continue;
      }

      TopTools_ListOfShape modified(prepareHistory->Modified(intermediateFace));
      while (modified.Size() > 0) {
        CadaraAppendExactFaceSuccessor(finalFaceIndexes, finalFaceMap, modified.First());
        modified.RemoveFirst();
      }

      TopTools_ListOfShape generated(prepareHistory->Generated(intermediateFace));
      while (generated.Size() > 0) {
        CadaraAppendExactFaceSuccessor(finalFaceIndexes, finalFaceMap, generated.First());
        generated.RemoveFirst();
      }
    }
  }

  template <typename Builder>
  std::vector<int> CadaraCollectPreparedFaceSuccessors(
    Builder& builder,
    const TopoDS_Face& sourceFace,
    const Handle(BRepTools_History)& prepareHistory,
    const TopTools_IndexedMapOfShape& finalFaceMap,
    const bool includeGenerated
  ) {
    std::vector<int> finalFaceIndexes;
    TopTools_ListOfShape modified(builder.Modified(sourceFace));
    CadaraAppendPreparedFaceSuccessors(
      finalFaceIndexes,
      modified,
      prepareHistory,
      finalFaceMap
    );

    if (includeGenerated) {
      TopTools_ListOfShape generated(builder.Generated(sourceFace));
      CadaraAppendPreparedFaceSuccessors(
        finalFaceIndexes,
        generated,
        prepareHistory,
        finalFaceMap
      );
    }

    if (finalFaceIndexes.empty() && !builder.IsDeleted(sourceFace)) {
      CadaraAppendExactFaceSuccessor(finalFaceIndexes, finalFaceMap, sourceFace);
    }

    std::sort(finalFaceIndexes.begin(), finalFaceIndexes.end());
    return finalFaceIndexes;
  }

  bool CadaraCollectUniqueFaceIds(
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    std::map<std::string, TopoDS_Face>& facesByNativeId,
    std::string& collisionId
  ) {
    TopTools_IndexedMapOfShape faceMap;
    TopExp::MapShapes(shape, TopAbs_FACE, faceMap);

    for (int index = 1; index <= faceMap.Size(); index += 1) {
      const TopoDS_Face face = TopoDS::Face(faceMap.FindKey(index));
      const std::string nativeId = CadaraTopologyIdForShape(TopAbs_FACE, bodyId, face);
      if (facesByNativeId.find(nativeId) != facesByNativeId.end()) {
        collisionId = nativeId;
        return false;
      }
      facesByNativeId[nativeId] = face;
    }

    return true;
  }

  std::vector<int> CadaraSortFinalFaceIndexesByNativeId(
    const std::vector<int>& finalFaceIndexes,
    const std::vector<std::string>& finalFaceNativeIds
  ) {
    std::vector<int> sortedIndexes(finalFaceIndexes);
    std::sort(
      sortedIndexes.begin(),
      sortedIndexes.end(),
      [&finalFaceNativeIds](const int left, const int right) {
        return finalFaceNativeIds[left] < finalFaceNativeIds[right];
      }
    );
    return sortedIndexes;
  }

  std::string CadaraBuildUnsupportedSheetSplitToolHistoryJson(
    const std::string& targetBodyId,
    const std::string& toolBodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const std::string& code,
    const std::string& message,
    const std::string& detailValue
  ) {
    std::ostringstream out;
    out
      << "{\"schemaVersion\":\"occ-native-sheet-split-tool-history-payload/v1alpha1\""
      << ",\"source\":\"occt7-shim\""
      << ",\"status\":\"unsupported\""
      << ",\"targetBodyId\":\"" << CadaraEscapeJson(targetBodyId) << "\""
      << ",\"toolBodyId\":\"" << CadaraEscapeJson(toolBodyId) << "\""
      << ",\"previousTopologyToken\":\"" << CadaraEscapeJson(previousTopologyToken) << "\""
      << ",\"topologyToken\":\"" << CadaraEscapeJson(topologyToken) << "\""
      << ",\"outputs\":[]"
      << ",\"toolFaceRelations\":[]"
      << ",\"diagnostics\":["
      << CadaraDiagnosticJson(
        code,
        "warning",
        message,
        targetBodyId,
        "sheetSplitToolHistory",
        "detail",
        detailValue
      )
      << "]}";
    return out.str();
  }

  struct CadaraSheetSplitOutputRecord {
    std::string slotKey;
    std::vector<int> finalFaceIndexes;
    std::vector<std::string> sourceTargetFaceNativeIds;
  };

  template <typename Builder>
  std::string CadaraBuildSheetSplitToolHistoryJson(
    Builder& builder,
    const TopoDS_Shape& target,
    const TopoDS_Shape& tool,
    const CadaraPreparedCommittedShape& prepared,
    const std::string& targetBodyId,
    const std::string& toolBodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken
  ) {
    TopTools_IndexedMapOfShape finalFaceMap;
    TopExp::MapShapes(prepared.shape, TopAbs_FACE, finalFaceMap);

    std::map<std::string, TopoDS_Face> targetFacesByNativeId;
    std::map<std::string, TopoDS_Face> toolFacesByNativeId;
    std::string collisionId;
    if (!CadaraCollectUniqueFaceIds(target, targetBodyId, targetFacesByNativeId, collisionId)) {
      return CadaraBuildUnsupportedSheetSplitToolHistoryJson(
        targetBodyId,
        toolBodyId,
        previousTopologyToken,
        topologyToken,
        "occ-native-sheet-split-history-source-id-collision",
        "Native sheet-split history refused ambiguous target-face native identity.",
        collisionId
      );
    }
    if (!CadaraCollectUniqueFaceIds(tool, toolBodyId, toolFacesByNativeId, collisionId)) {
      return CadaraBuildUnsupportedSheetSplitToolHistoryJson(
        targetBodyId,
        toolBodyId,
        previousTopologyToken,
        topologyToken,
        "occ-native-sheet-split-history-source-id-collision",
        "Native sheet-split history refused ambiguous tool-face native identity.",
        collisionId
      );
    }

    std::vector<std::string> finalFaceNativeIds(finalFaceMap.Size() + 1);
    std::set<std::string> seenFinalFaceNativeIds;
    for (int index = 1; index <= finalFaceMap.Size(); index += 1) {
      const std::string nativeId = CadaraTopologyIdForShape(
        TopAbs_FACE,
        targetBodyId,
        finalFaceMap.FindKey(index)
      );
      if (!seenFinalFaceNativeIds.insert(nativeId).second) {
        return CadaraBuildUnsupportedSheetSplitToolHistoryJson(
          targetBodyId,
          toolBodyId,
          previousTopologyToken,
          topologyToken,
          "occ-native-sheet-split-history-final-id-collision",
          "Native sheet-split history refused ambiguous final-face native identity.",
          nativeId
        );
      }
      finalFaceNativeIds[index] = nativeId;
    }

    std::map<std::string, std::vector<int>> targetFaceSuccessors;
    for (const auto& entry : targetFacesByNativeId) {
      targetFaceSuccessors[entry.first] = CadaraCollectPreparedFaceSuccessors(
        builder,
        entry.second,
        prepared.history,
        finalFaceMap,
        true
      );
    }

    TopTools_IndexedMapOfShape solidMap;
    TopExp::MapShapes(prepared.shape, TopAbs_SOLID, solidMap);
    if (solidMap.Size() == 0) {
      return CadaraBuildUnsupportedSheetSplitToolHistoryJson(
        targetBodyId,
        toolBodyId,
        previousTopologyToken,
        topologyToken,
        "occ-native-sheet-split-history-no-output-solids",
        "Native sheet-split history requires at least one final solid output.",
        "solid-output"
      );
    }
    std::map<std::string, CadaraSheetSplitOutputRecord> outputsBySlotKey;
    for (int solidIndex = 1; solidIndex <= solidMap.Size(); solidIndex += 1) {
      const TopoDS_Solid solid = TopoDS::Solid(solidMap.FindKey(solidIndex));
      TopTools_IndexedMapOfShape solidFaceMap;
      TopExp::MapShapes(solid, TopAbs_FACE, solidFaceMap);

      std::vector<int> finalFaceIndexes;
      for (int faceIndex = 1; faceIndex <= finalFaceMap.Size(); faceIndex += 1) {
        if (CadaraFindExactShapeIndex(solidFaceMap, finalFaceMap.FindKey(faceIndex)) > 0) {
          finalFaceIndexes.push_back(faceIndex);
        }
      }

      std::vector<std::string> sourceTargetFaceNativeIds;
      for (const auto& entry : targetFaceSuccessors) {
        const bool belongsToSolid = std::any_of(
          entry.second.begin(),
          entry.second.end(),
          [&solidFaceMap, &finalFaceMap](const int finalFaceIndex) {
            return CadaraFindExactShapeIndex(
              solidFaceMap,
              finalFaceMap.FindKey(finalFaceIndex)
            ) > 0;
          }
        );
        if (belongsToSolid) {
          sourceTargetFaceNativeIds.push_back(entry.first);
        }
      }

      if (sourceTargetFaceNativeIds.empty()) {
        return CadaraBuildUnsupportedSheetSplitToolHistoryJson(
          targetBodyId,
          toolBodyId,
          previousTopologyToken,
          topologyToken,
          "occ-native-sheet-split-history-output-membership-missing",
          "Native sheet-split history could not derive an exact input-history membership for an output solid.",
          "target-face-membership"
        );
      }

      // This key is the sorted set of exact target-face history memberships;
      // it has no output bounds, volume, traversal index, or proximity input.
      const std::string slotKey = "sheet-split-output:target:"
        + targetBodyId
        + ":target-face-membership:"
        + [&sourceTargetFaceNativeIds]() {
            std::ostringstream key;
            for (std::size_t index = 0; index < sourceTargetFaceNativeIds.size(); index += 1) {
              if (index > 0) {
                key << ",";
              }
              key << sourceTargetFaceNativeIds[index];
            }
            return key.str();
          }();
      if (outputsBySlotKey.find(slotKey) != outputsBySlotKey.end()) {
        return CadaraBuildUnsupportedSheetSplitToolHistoryJson(
          targetBodyId,
          toolBodyId,
          previousTopologyToken,
          topologyToken,
          "occ-native-sheet-split-history-output-slot-collision",
          "Native sheet-split history refused colliding semantic output slots.",
          slotKey
        );
      }
      outputsBySlotKey[slotKey] = {
        slotKey,
        finalFaceIndexes,
        sourceTargetFaceNativeIds
      };
    }

    std::map<int, std::vector<std::string>> outputSlotKeysByFinalFaceIndex;
    for (const auto& output : outputsBySlotKey) {
      for (const int finalFaceIndex : output.second.finalFaceIndexes) {
        outputSlotKeysByFinalFaceIndex[finalFaceIndex].push_back(output.first);
      }
    }

    std::ostringstream out;
    out
      << "{\"schemaVersion\":\"occ-native-sheet-split-tool-history-payload/v1alpha1\""
      << ",\"source\":\"occt7-shim\""
      << ",\"status\":\"available\""
      << ",\"targetBodyId\":\"" << CadaraEscapeJson(targetBodyId) << "\""
      << ",\"toolBodyId\":\"" << CadaraEscapeJson(toolBodyId) << "\""
      << ",\"previousTopologyToken\":\"" << CadaraEscapeJson(previousTopologyToken) << "\""
      << ",\"topologyToken\":\"" << CadaraEscapeJson(topologyToken) << "\""
      << ",\"outputs\":[";

    bool needsOutputComma = false;
    for (const auto& output : outputsBySlotKey) {
      if (needsOutputComma) {
        out << ",";
      }
      needsOutputComma = true;
      out << "{\"outputSlotKey\":\"" << CadaraEscapeJson(output.second.slotKey) << "\""
        << ",\"sourceTargetFaceNativeIds\":[";
      for (std::size_t index = 0; index < output.second.sourceTargetFaceNativeIds.size(); index += 1) {
        if (index > 0) {
          out << ",";
        }
        out << "\"" << CadaraEscapeJson(output.second.sourceTargetFaceNativeIds[index]) << "\"";
      }
      out << "],\"finalFaceNativeIds\":[";
      const std::vector<int> sortedFinalFaceIndexes = CadaraSortFinalFaceIndexesByNativeId(
        output.second.finalFaceIndexes,
        finalFaceNativeIds
      );
      for (std::size_t index = 0; index < sortedFinalFaceIndexes.size(); index += 1) {
        if (index > 0) {
          out << ",";
        }
        out << "\"" << CadaraEscapeJson(
          finalFaceNativeIds[sortedFinalFaceIndexes[index]]
        ) << "\"";
      }
      out << "]}";
    }

    out << "],\"toolFaceRelations\":[";
    bool needsRelationComma = false;
    for (const auto& toolFace : toolFacesByNativeId) {
      const std::vector<int> finalFaceIndexes = CadaraSortFinalFaceIndexesByNativeId(
        CadaraCollectPreparedFaceSuccessors(
          builder,
          toolFace.second,
          prepared.history,
          finalFaceMap,
          false
        ),
        finalFaceNativeIds
      );
      if (needsRelationComma) {
        out << ",";
      }
      needsRelationComma = true;
      out << "{\"sourceToolFace\":{\"bodyId\":\""
        << CadaraEscapeJson(toolBodyId)
        << "\",\"nativeFaceId\":\""
        << CadaraEscapeJson(toolFace.first)
        << "\"},\"cardinality\":\""
        << (finalFaceIndexes.empty() ? "zero" : finalFaceIndexes.size() == 1 ? "one" : "many")
        << "\",\"finalFaces\":[";
      for (std::size_t index = 0; index < finalFaceIndexes.size(); index += 1) {
        if (index > 0) {
          out << ",";
        }
        const int finalFaceIndex = finalFaceIndexes[index];
        const auto membership = outputSlotKeysByFinalFaceIndex.find(finalFaceIndex);
        if (membership == outputSlotKeysByFinalFaceIndex.end() || membership->second.empty()) {
          return CadaraBuildUnsupportedSheetSplitToolHistoryJson(
            targetBodyId,
            toolBodyId,
            previousTopologyToken,
            topologyToken,
            "occ-native-sheet-split-history-final-membership-missing",
            "Native sheet-split history found a tool-face successor outside every final output solid.",
            finalFaceNativeIds[finalFaceIndex]
          );
        }
        out << "{\"nativeFaceId\":\""
          << CadaraEscapeJson(finalFaceNativeIds[finalFaceIndex])
          << "\",\"outputSlotKeys\":[";
        for (std::size_t slotIndex = 0; slotIndex < membership->second.size(); slotIndex += 1) {
          if (slotIndex > 0) {
            out << ",";
          }
          out << "\"" << CadaraEscapeJson(membership->second[slotIndex]) << "\"";
        }
        out << "]}";
      }
      out << "]}";
    }

    out << "],\"diagnostics\":[]}";
    return out.str();
  }


  std::string CadaraBuildUnsupportedBooleanOperandHistoryJson(
    const std::string& operation,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const std::string& code,
    const std::string& message,
    const std::string& detailValue
  ) {
    std::ostringstream out;
    out
      << "{\"schemaVersion\":\"occ-native-boolean-operand-history-payload/v1alpha1\""
      << ",\"source\":\"occt7-shim\""
      << ",\"status\":\"unsupported\""
      << ",\"operation\":\"" << CadaraEscapeJson(operation) << "\""
      << ",\"bodyId\":\"" << CadaraEscapeJson(bodyId) << "\""
      << ",\"previousTopologyToken\":\"" << CadaraEscapeJson(previousTopologyToken) << "\""
      << ",\"topologyToken\":\"" << CadaraEscapeJson(topologyToken) << "\""
      << ",\"finalFaces\":[]"
      << ",\"diagnostics\":["
      << CadaraDiagnosticJson(
        code,
        "warning",
        message,
        bodyId,
        "booleanOperandHistory",
        "detail",
        detailValue
      )
      << "]}";
    return out.str();
  }

  bool CadaraAppendPreparedBooleanOperandFaceSuccessors(
    std::vector<int>& finalFaceIndexes,
    const TopTools_ListOfShape& intermediateFaces,
    const Handle(BRepTools_History)& prepareHistory,
    const TopTools_IndexedMapOfShape& finalFaceMap,
    std::string& malformedAssociation
  ) {
    TopTools_ListOfShape remaining(intermediateFaces);
    while (remaining.Size() > 0) {
      const TopoDS_Shape intermediateFace = remaining.First();
      remaining.RemoveFirst();
      if (intermediateFace.IsNull()) {
        malformedAssociation = "null-builder-successor";
        return false;
      }
      if (intermediateFace.ShapeType() != TopAbs_FACE) {
        continue;
      }

      CadaraAppendExactFaceSuccessor(finalFaceIndexes, finalFaceMap, intermediateFace);
      if (prepareHistory.IsNull()) {
        continue;
      }

      TopTools_ListOfShape modified(prepareHistory->Modified(intermediateFace));
      while (modified.Size() > 0) {
        const TopoDS_Shape preparedFace = modified.First();
        modified.RemoveFirst();
        if (preparedFace.IsNull()) {
          malformedAssociation = "null-preparation-modified-successor";
          return false;
        }
        if (preparedFace.ShapeType() != TopAbs_FACE) {
          continue;
        }
        CadaraAppendExactFaceSuccessor(finalFaceIndexes, finalFaceMap, preparedFace);
      }

      TopTools_ListOfShape generated(prepareHistory->Generated(intermediateFace));
      while (generated.Size() > 0) {
        const TopoDS_Shape preparedFace = generated.First();
        generated.RemoveFirst();
        if (preparedFace.IsNull()) {
          malformedAssociation = "null-preparation-generated-successor";
          return false;
        }
        if (preparedFace.ShapeType() != TopAbs_FACE) {
          continue;
        }
        CadaraAppendExactFaceSuccessor(finalFaceIndexes, finalFaceMap, preparedFace);
      }
    }
    return true;
  }

  template <typename Builder>
  bool CadaraCollectPreparedBooleanOperandFaceSuccessors(
    Builder& builder,
    const TopoDS_Face& sourceFace,
    const Handle(BRepTools_History)& prepareHistory,
    const TopTools_IndexedMapOfShape& finalFaceMap,
    std::vector<int>& finalFaceIndexes,
    std::string& malformedAssociation
  ) {
    finalFaceIndexes.clear();
    TopTools_ListOfShape modified(builder.Modified(sourceFace));
    if (!CadaraAppendPreparedBooleanOperandFaceSuccessors(
      finalFaceIndexes,
      modified,
      prepareHistory,
      finalFaceMap,
      malformedAssociation
    )) {
      return false;
    }

    TopTools_ListOfShape generated(builder.Generated(sourceFace));
    if (!CadaraAppendPreparedBooleanOperandFaceSuccessors(
      finalFaceIndexes,
      generated,
      prepareHistory,
      finalFaceMap,
      malformedAssociation
    )) {
      return false;
    }

    if (finalFaceIndexes.empty() && !builder.IsDeleted(sourceFace)) {
      CadaraAppendExactFaceSuccessor(finalFaceIndexes, finalFaceMap, sourceFace);
    }

    std::sort(finalFaceIndexes.begin(), finalFaceIndexes.end());
    return true;
  }

  template <typename Builder>
  std::string CadaraBuildBooleanOperandHistoryJson(
    Builder& builder,
    const std::string& operation,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const TopoDS_Shape& left,
    const TopoDS_Shape& right,
    const CadaraPreparedCommittedShape& prepared
  ) {
    std::map<std::string, TopoDS_Face> leftFacesByNativeId;
    std::map<std::string, TopoDS_Face> rightFacesByNativeId;
    std::string collisionId;
    if (!CadaraCollectUniqueFaceIds(left, bodyId, leftFacesByNativeId, collisionId)) {
      return CadaraBuildUnsupportedBooleanOperandHistoryJson(
        operation,
        bodyId,
        previousTopologyToken,
        topologyToken,
        "occ-native-boolean-operand-history-source-id-collision",
        "Native Boolean operand history refused ambiguous left source-face native identity.",
        collisionId
      );
    }
    if (!CadaraCollectUniqueFaceIds(right, bodyId, rightFacesByNativeId, collisionId)) {
      return CadaraBuildUnsupportedBooleanOperandHistoryJson(
        operation,
        bodyId,
        previousTopologyToken,
        topologyToken,
        "occ-native-boolean-operand-history-source-id-collision",
        "Native Boolean operand history refused ambiguous right source-face native identity.",
        collisionId
      );
    }

    TopTools_IndexedMapOfShape finalFaceMap;
    TopExp::MapShapes(prepared.shape, TopAbs_FACE, finalFaceMap);
    std::vector<std::string> finalFaceNativeIds(finalFaceMap.Size() + 1);
    std::set<std::string> seenFinalFaceNativeIds;
    for (int index = 1; index <= finalFaceMap.Size(); index += 1) {
      const std::string nativeId = CadaraTopologyIdForShape(
        TopAbs_FACE,
        bodyId,
        finalFaceMap.FindKey(index)
      );
      if (!seenFinalFaceNativeIds.insert(nativeId).second) {
        return CadaraBuildUnsupportedBooleanOperandHistoryJson(
          operation,
          bodyId,
          previousTopologyToken,
          topologyToken,
          "occ-native-boolean-operand-history-final-id-collision",
          "Native Boolean operand history refused ambiguous final-face native identity.",
          nativeId
        );
      }
      finalFaceNativeIds[index] = nativeId;
    }

    std::vector<std::vector<std::string>> leftSourceIdsByFinalFace(finalFaceMap.Size() + 1);
    std::vector<std::vector<std::string>> rightSourceIdsByFinalFace(finalFaceMap.Size() + 1);
    std::string malformedAssociation;
    for (const auto& source : leftFacesByNativeId) {
      std::vector<int> finalFaceIndexes;
      if (!CadaraCollectPreparedBooleanOperandFaceSuccessors(
        builder,
        source.second,
        prepared.history,
        finalFaceMap,
        finalFaceIndexes,
        malformedAssociation
      )) {
        return CadaraBuildUnsupportedBooleanOperandHistoryJson(
          operation,
          bodyId,
          previousTopologyToken,
          topologyToken,
          "occ-native-boolean-operand-history-malformed-association",
          "Native Boolean operand history received a malformed left-face association.",
          malformedAssociation
        );
      }
      if (finalFaceIndexes.size() == 1) {
        leftSourceIdsByFinalFace[finalFaceIndexes.front()].push_back(source.first);
      }
    }
    for (const auto& source : rightFacesByNativeId) {
      std::vector<int> finalFaceIndexes;
      if (!CadaraCollectPreparedBooleanOperandFaceSuccessors(
        builder,
        source.second,
        prepared.history,
        finalFaceMap,
        finalFaceIndexes,
        malformedAssociation
      )) {
        return CadaraBuildUnsupportedBooleanOperandHistoryJson(
          operation,
          bodyId,
          previousTopologyToken,
          topologyToken,
          "occ-native-boolean-operand-history-malformed-association",
          "Native Boolean operand history received a malformed right-face association.",
          malformedAssociation
        );
      }
      if (finalFaceIndexes.size() == 1) {
        rightSourceIdsByFinalFace[finalFaceIndexes.front()].push_back(source.first);
      }
    }

    std::ostringstream out;
    out
      << "{\"schemaVersion\":\"occ-native-boolean-operand-history-payload/v1alpha1\""
      << ",\"source\":\"occt7-shim\""
      << ",\"status\":\"available\""
      << ",\"operation\":\"" << CadaraEscapeJson(operation) << "\""
      << ",\"bodyId\":\"" << CadaraEscapeJson(bodyId) << "\""
      << ",\"previousTopologyToken\":\"" << CadaraEscapeJson(previousTopologyToken) << "\""
      << ",\"topologyToken\":\"" << CadaraEscapeJson(topologyToken) << "\""
      << ",\"finalFaces\":[";
    bool needsFaceComma = false;
    std::vector<int> allFinalFaceIndexes;
    for (int index = 1; index <= finalFaceMap.Size(); index += 1) {
      allFinalFaceIndexes.push_back(index);
    }
    const std::vector<int> sortedFinalFaceIndexes = CadaraSortFinalFaceIndexesByNativeId(
      allFinalFaceIndexes,
      finalFaceNativeIds
    );
    for (const int finalFaceIndex : sortedFinalFaceIndexes) {
      if (needsFaceComma) {
        out << ",";
      }
      needsFaceComma = true;
      out << "{\"nativeFaceId\":\"" << CadaraEscapeJson(finalFaceNativeIds[finalFaceIndex])
        << "\",\"leftSourceFaceNativeIds\":[";
      for (std::size_t index = 0; index < leftSourceIdsByFinalFace[finalFaceIndex].size(); index += 1) {
        if (index > 0) {
          out << ",";
        }
        out << "\"" << CadaraEscapeJson(leftSourceIdsByFinalFace[finalFaceIndex][index]) << "\"";
      }
      out << "],\"rightSourceFaceNativeIds\":[";
      for (std::size_t index = 0; index < rightSourceIdsByFinalFace[finalFaceIndex].size(); index += 1) {
        if (index > 0) {
          out << ",";
        }
        out << "\"" << CadaraEscapeJson(rightSourceIdsByFinalFace[finalFaceIndex][index]) << "\"";
      }
      out << "]}";
    }
    out << "],\"diagnostics\":[]}";
    return out.str();
  }

  template <typename Builder>
  CadaraNativeFeatureTransactionResult CadaraBuildBooleanTransactionResult(
    Builder& builder,
    const std::string& operation,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection,
    const TopoDS_Shape& leftOperand,
    const TopoDS_Shape& rightOperand
  ) {
    builder.SetToFillHistory(true);
    Message_ProgressRange progress;
    builder.Build(progress);

    if (!builder.IsDone()) {
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
          "Native OCC boolean feature transaction failed to build.",
          bodyId,
          "featureTransaction",
          "operation",
          operation
        )
      ), CadaraBuildUnsupportedHistoryJson(operation, bodyId), false, "",
        CadaraBuildUnsupportedBooleanOperandHistoryJson(
          operation,
          bodyId,
          previousTopologyToken,
          topologyToken,
          "occ-native-boolean-operand-history-transaction-failed",
          "Native Boolean operand history is unavailable because the feature transaction failed to build.",
          "transaction-failed"
        )
      );
    }

    builder.SimplifyResult(true, true, 1.0e-7);
    const CadaraPreparedCommittedShape prepared = CadaraPrepareCommittedShapeWithHistory(
      builder.Shape(),
      linearDeflection,
      angularDeflection
    );
    const std::string booleanOperandHistoryJson = CadaraBuildBooleanOperandHistoryJson(
      builder,
      operation,
      bodyId,
      previousTopologyToken,
      topologyToken,
      leftOperand,
      rightOperand,
      prepared
    );
    return CadaraNativeFeatureTransactionResult(
      prepared.shape,
      CadaraBuildTopologyJson(prepared.shape, bodyId, topologyToken, linearDeflection, angularDeflection, true),
      CadaraBuildFeatureHistoryJson(
        builder,
        operation,
        bodyId,
        previousTopologyToken,
        topologyToken,
        leftOperand,
        prepared.shape
      ),
      true,
      "",
      booleanOperandHistoryJson
    );
  }

  template <typename Builder>
  CadaraNativeFeatureTransactionResult CadaraBuildLocalOperationTransactionResult(
    Builder& builder,
    const std::string& operation,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection,
    const TopoDS_Shape& previousShape
  ) {
    Message_ProgressRange progress;
    builder.Build(progress);

    if (!builder.IsDone()) {
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
          "Native OCC feature transaction failed to build.",
          bodyId,
          "featureTransaction",
          "operation",
          operation
        )
      ), CadaraBuildUnsupportedHistoryJson(operation, bodyId), false);
    }

    const TopoDS_Shape preparedShape = CadaraPrepareCommittedShape(
      builder.Shape(),
      linearDeflection,
      angularDeflection
    );
    return CadaraNativeFeatureTransactionResult(
      preparedShape,
      CadaraBuildTopologyJson(preparedShape, bodyId, topologyToken, linearDeflection, angularDeflection, true),
      CadaraBuildFeatureHistoryJson(builder, operation, bodyId, previousTopologyToken, topologyToken, previousShape, preparedShape),
      true
    );
  }

  template <typename Builder>
  std::string CadaraBuildBooleanTransactionPayload(
    Builder& builder,
    const std::string& operation,
    const std::string& bodyId,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection,
    const TopoDS_Shape& leftOperand,
    const TopoDS_Shape& rightOperand
  ) {
    return CadaraBuildBooleanTransactionResult(
      builder,
      operation,
      bodyId,
      topologyToken,
      topologyToken,
      linearDeflection,
      angularDeflection,
      leftOperand,
      rightOperand
    ).PayloadJson();
}
}
