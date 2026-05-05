public:
  static std::string EntrypointName() {
    return "CadaraBuildNativeExactBrepPayload";
  }

  static std::string BuildJson(
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& topologyToken
  ) {
    return CadaraBuildTopologyJson(shape, bodyId, topologyToken, 0.1, 0.5, true);
  }
