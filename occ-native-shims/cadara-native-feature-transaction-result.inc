public:
  CadaraNativeFeatureTransactionResult()
    : done(false) {}

  CadaraNativeFeatureTransactionResult(
    const TopoDS_Shape& committedShape,
    const std::string& committedPayloadJson,
    const std::string& committedHistoryJson,
    const bool transactionDone
  )
    : shape(committedShape),
      payloadJson(committedPayloadJson),
      historyJson(committedHistoryJson),
      done(transactionDone) {}

  TopoDS_Shape Shape() const {
    return shape;
  }

  std::string PayloadJson() const {
    return payloadJson;
  }

  std::string HistoryJson() const {
    return historyJson;
  }

  bool IsDone() const {
    return done;
  }

private:
  TopoDS_Shape shape;
  std::string payloadJson;
  std::string historyJson;
  bool done;
