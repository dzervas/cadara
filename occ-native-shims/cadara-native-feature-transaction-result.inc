public:
  CadaraNativeFeatureTransactionResult()
    : done(false) {}

  CadaraNativeFeatureTransactionResult(
    const TopoDS_Shape& committedShape,
    const std::string& committedPayloadJson,
    const std::string& committedHistoryJson,
    const bool transactionDone,
    const std::string& committedSplitToolHistoryJson = "",
    const std::string& committedBooleanOperandHistoryJson = ""
  )
    : shape(committedShape),
      payloadJson(committedPayloadJson),
      historyJson(committedHistoryJson),
      splitToolHistoryJson(committedSplitToolHistoryJson),
      booleanOperandHistoryJson(committedBooleanOperandHistoryJson),
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

  // Present only for the opt-in sheet-split transaction. Generic feature
  // history remains available exclusively through HistoryJson().
  std::string SplitToolHistoryJson() const {
    return splitToolHistoryJson;
  }

  // Present only for Boolean transactions. HistoryJson() continues to expose
  // the generic left-target successor history for backward compatibility.
  std::string BooleanOperandHistoryJson() const {
    return booleanOperandHistoryJson;
  }

  bool IsDone() const {
    return done;
  }

private:
  TopoDS_Shape shape;
  std::string payloadJson;
  std::string historyJson;
  std::string splitToolHistoryJson;
  std::string booleanOperandHistoryJson;
  bool done;
