public:
  static std::string EntrypointName() {
    return "CadaraBuildNativeTopologyPayload";
  }

  static std::string BuildJson(
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    // Display tiers and the identity payload: no segment shorter than the
    // linear deflection (see CadaraAppendMeshPayload).
    return CadaraBuildTopologyJson(
      shape,
      bodyId,
      topologyToken,
      linearDeflection,
      angularDeflection,
      true,
      "",
      linearDeflection
    );
  }
