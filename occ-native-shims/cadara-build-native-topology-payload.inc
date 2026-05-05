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
    return CadaraBuildTopologyJson(shape, bodyId, topologyToken, linearDeflection, angularDeflection, true);
  }
