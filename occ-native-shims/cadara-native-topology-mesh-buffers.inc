// The display payload of CadaraBuildNativeTopologyPayload::BuildJson with the
// mesh as contiguous typed buffers instead of JSON arrays: TopologyJson() is
// the same payload without its "mesh" member; the mesh lives in wasm memory
// for as long as this object, and the caller reads it through the module's
// HEAPF32/HEAPU32 views at the byte addresses below. Writing the mesh as JSON
// text was most of a display payload's cost once meshing was bounded.
public:
  static CadaraNativeTopologyMeshBuffers Build(
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    CadaraNativeTopologyMeshBuffers result;
    result.topologyJson = CadaraBuildTopologyJson(
      shape,
      bodyId,
      topologyToken,
      linearDeflection,
      angularDeflection,
      false
    );
    if (shape.IsNull()) {
      return result;
    }

    // Same mesh parameters, face order, node order and triangle winding as
    // BuildJson (CadaraAppendMeshPayload).
    CadaraMeshShapeForPayload(shape, linearDeflection, angularDeflection, linearDeflection);
    TopTools_IndexedMapOfShape faceMap;
    TopExp::MapShapes(shape, TopAbs_FACE, faceMap);

    std::size_t nodeCount = 0;
    std::size_t triangleCount = 0;
    for (int faceIndex = 1; faceIndex <= faceMap.Size(); faceIndex += 1) {
      TopLoc_Location location;
      const Handle_Poly_Triangulation triangulation =
        BRep_Tool::Triangulation(TopoDS::Face(faceMap.FindKey(faceIndex)), location);
      if (!triangulation.IsNull()) {
        nodeCount += std::size_t(triangulation->NbNodes());
        triangleCount += std::size_t(triangulation->NbTriangles());
      }
    }
    result.positions.reserve(nodeCount * 3);
    result.triangleIndices.reserve(triangleCount * 3);
    result.triangleFaceIndices.reserve(triangleCount);

    std::uint32_t nodeOffset = 0;
    for (int faceIndex = 1; faceIndex <= faceMap.Size(); faceIndex += 1) {
      const TopoDS_Face face = TopoDS::Face(faceMap.FindKey(faceIndex));
      TopLoc_Location location;
      const Handle_Poly_Triangulation triangulation = BRep_Tool::Triangulation(face, location);
      if (triangulation.IsNull()) {
        continue;
      }

      for (int nodeIndex = 1; nodeIndex <= triangulation->NbNodes(); nodeIndex += 1) {
        const gp_Pnt point = triangulation->Node(nodeIndex).Transformed(location.Transformation());
        result.positions.push_back(float(point.X()));
        result.positions.push_back(float(point.Y()));
        result.positions.push_back(float(point.Z()));
      }

      const bool isReversed = face.Orientation() == TopAbs_REVERSED;
      for (int triangleIndex = 1; triangleIndex <= triangulation->NbTriangles(); triangleIndex += 1) {
        const Poly_Triangle triangle = triangulation->Triangle(triangleIndex);
        result.triangleIndices.push_back(nodeOffset + std::uint32_t(triangle.Value(1) - 1));
        result.triangleIndices.push_back(nodeOffset + std::uint32_t(triangle.Value(isReversed ? 3 : 2) - 1));
        result.triangleIndices.push_back(nodeOffset + std::uint32_t(triangle.Value(isReversed ? 2 : 3) - 1));
        // The face record with this "index" in TopologyJson() owns the triangle.
        result.triangleFaceIndices.push_back(std::uint32_t(faceIndex));
      }

      nodeOffset += std::uint32_t(triangulation->NbNodes());
    }

    return result;
  }

  std::string TopologyJson() const {
    return topologyJson;
  }

  int NodeCount() const {
    return int(positions.size() / 3);
  }

  int TriangleCount() const {
    return int(triangleFaceIndices.size());
  }

  // Byte addresses in wasm memory. Returned as doubles: with a 4 GB maximum
  // memory an address can exceed INT_MAX, and a double holds it exactly.
  // float32 x, y, z per node.
  double PositionsAddress() const {
    return double(reinterpret_cast<std::uintptr_t>(positions.data()));
  }

  // uint32 a, b, c per triangle, indices into the nodes.
  double TriangleIndicesAddress() const {
    return double(reinterpret_cast<std::uintptr_t>(triangleIndices.data()));
  }

  // uint32 per triangle: the owning face record's "index" in TopologyJson().
  double TriangleFaceIndicesAddress() const {
    return double(reinterpret_cast<std::uintptr_t>(triangleFaceIndices.data()));
  }

private:
  std::string topologyJson;
  std::vector<float> positions;
  std::vector<std::uint32_t> triangleIndices;
  std::vector<std::uint32_t> triangleFaceIndices;
