public:
  static std::string EntrypointName() {
    return "CadaraBuildNativeMeshExportPayload";
  }

  static std::string BuildJson(
    const TopoDS_Shape& shape,
    const double linearDeflection,
    const double angularDeflection
  ) {
    std::ostringstream out;
    out
      << "{\"schemaVersion\":\"occ-native-topology-payload/v1alpha1\""
      << ",\"source\":\"occt7-shim\",";
    CadaraAppendMeshPayload(out, shape, "body_export", "t_export", linearDeflection, angularDeflection);
    out << ",\"diagnostics\":";
    CadaraAppendValidationDiagnostics(out, shape, "body_export");
    out << "}";
    return out.str();
  }
