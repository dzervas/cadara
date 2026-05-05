public:
  static std::string SchemaVersion() {
    return "occ-native-topology-payload/v1alpha1";
  }

  static bool HasPre8Shim() {
    return true;
  }

  static std::string SummarizeShape(const TopoDS_Shape& shape) {
    std::ostringstream out;
    out
      << "{\"schemaVersion\":\"occ-native-topology-payload/v1alpha1\""
      << ",\"source\":\"occt7-shim\""
      << ",\"counts\":{\"faces\":" << CadaraShapeCount(shape, TopAbs_FACE)
      << ",\"edges\":" << CadaraShapeCount(shape, TopAbs_EDGE)
      << ",\"vertices\":" << CadaraShapeCount(shape, TopAbs_VERTEX)
      << "}}";
    return out.str();
  }
