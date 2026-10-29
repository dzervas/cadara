// Feature transactions whose committed shape is only a tool body for a
// following Boolean transaction (a shell with operation add/subtract/intersect).
// The result equals CadaraExecuteNativeFeatureTransaction's except that
// PayloadJson() carries only counts and validation diagnostics: building the
// topology records and serialising the identity mesh of a body the Boolean
// re-identifies anyway was a third of the shell transaction. A separate class
// keeps the v8 baseline ABI and declaration hashes unchanged.
public:
  static CadaraNativeFeatureTransactionResult BuildShellWithHistory(
    const TopoDS_Shape& shape,
    const std::string& faceIdsCsv,
    const double signedThickness,
    const std::string& bodyId,
    const std::string& previousTopologyToken,
    const std::string& topologyToken,
    const double linearDeflection,
    const double angularDeflection
  ) {
    return CadaraBuildShellTransactionResult(
      shape,
      faceIdsCsv,
      signedThickness,
      bodyId,
      previousTopologyToken,
      topologyToken,
      linearDeflection,
      angularDeflection,
      true
    );
  }
