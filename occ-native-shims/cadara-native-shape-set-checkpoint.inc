public:
  static std::string FormatVersion() {
    return CadaraShapeSetCheckpointFormat;
  }

  // Persists `root` (normally a compound of the shapes to keep) with every
  // double bit-exact. Never throws: on success IsDone() and Checkpoint() hold
  // the text; a null root or an OCCT/stream failure yields IsDone() == false
  // and an ErrorMessage().
  static CadaraNativeShapeSetCheckpoint Write(const TopoDS_Shape& root) {
    CadaraNativeShapeSetCheckpoint result;
    try {
      if (root.IsNull()) CadaraShapeSetCheckpointFail("root shape is null");
      BinTools_ShapeSet shapes;
      shapes.SetWithTriangles(Standard_True);
      shapes.SetWithNormals(Standard_True);
      shapes.SetFormatNb(BinTools_FormatVersion_VERSION_4);
      shapes.Add(root);
      std::ostringstream body(std::ios::out | std::ios::binary);
      CadaraWriteExactLocations(body, shapes.Locations());
      const std::string table = CadaraWriteGeometryTable(shapes);
      CadaraPutRaw<uint32_t>(body, uint32_t(table.size()));
      body.write(table.data(), std::streamsize(table.size()));
      shapes.Write(body);
      shapes.Write(root, body);
      if (!body.good()) CadaraShapeSetCheckpointFail("shape set stream failed while writing");
      const std::string bytes = body.str();
      std::ostringstream out;
      out << CadaraShapeSetCheckpointFormat << ':' << std::hex << std::setw(16)
          << std::setfill('0') << CadaraShapeSetCheckpointFnv1a64(bytes) << ':'
          << CadaraBase64Encode(bytes);
      result.checkpointText = out.str();
      result.done = true;
    } catch (const CadaraShapeSetCheckpointError& error) {
      result.Reset(error.message);
    } catch (const Standard_Failure& error) {
      result.Reset(
        std::string("OCCT could not write the shape set: ") + error.DynamicType()->Name() + " " +
        error.GetMessageString()
      );
    } catch (const std::exception& error) {
      result.Reset(std::string("shape set could not be written: ") + error.what());
    }
    return result;
  }

  // Never throws: a malformed, truncated or foreign checkpoint yields
  // IsDone() == false and an ErrorMessage().
  static CadaraNativeShapeSetCheckpoint Read(const std::string& checkpoint) {
    CadaraNativeShapeSetCheckpoint result;
    try {
      const std::string prefix = std::string(CadaraShapeSetCheckpointFormat) + ':';
      if (checkpoint.compare(0, prefix.size(), prefix) != 0) {
        CadaraShapeSetCheckpointFail("not a " + std::string(CadaraShapeSetCheckpointFormat) + " checkpoint");
      }
      const size_t bodyStart = prefix.size() + 17;
      if (checkpoint.size() < bodyStart || checkpoint[bodyStart - 1] != ':') {
        CadaraShapeSetCheckpointFail("checksum is missing");
      }
      const std::string checksumText = checkpoint.substr(prefix.size(), 16);
      if (checksumText.find_first_not_of("0123456789abcdef") != std::string::npos) {
        CadaraShapeSetCheckpointFail("checksum is not hexadecimal");
      }
      const std::string bytes = CadaraBase64Decode(checkpoint, bodyStart);
      if (std::stoull(checksumText, nullptr, 16) != CadaraShapeSetCheckpointFnv1a64(bytes)) {
        CadaraShapeSetCheckpointFail("checksum does not match the body");
      }
      std::istringstream body(bytes, std::ios::in | std::ios::binary);
      const std::vector<TopLoc_Location> locations = CadaraReadExactLocations(body);
      std::string table(CadaraGetRaw<uint32_t>(body), '\0');
      if (!body.read(&table[0], std::streamsize(table.size()))) {
        CadaraShapeSetCheckpointFail("checkpoint table is truncated");
      }
      CadaraExactLocationShapeSet shapes(locations);
      shapes.SetWithTriangles(Standard_True);
      shapes.Read(body);
      TopoDS_Shape root;
      shapes.ReadSubs(root, body, shapes.NbShapes());
      if (body.fail() || root.IsNull()) {
        CadaraShapeSetCheckpointFail("shape set has no root shape");
      }
      if (body.peek() != std::char_traits<char>::eof()) {
        CadaraShapeSetCheckpointFail("shape set has trailing data");
      }
      CadaraRestoreGeometryTable(shapes, table);
      result.root = root;
      for (TopoDS_Iterator children(root, Standard_False, Standard_False); children.More(); children.Next()) {
        result.children.push_back(children.Value());
      }
      result.done = true;
    } catch (const CadaraShapeSetCheckpointError& error) {
      result.Reset(error.message);
    } catch (const Standard_Failure& error) {
      result.Reset(
        std::string("OCCT rejected the shape set: ") + error.DynamicType()->Name() + " " +
        error.GetMessageString()
      );
    } catch (const std::exception& error) {
      result.Reset(std::string("shape set could not be read: ") + error.what());
    }
    return result;
  }

  bool IsDone() const {
    return done;
  }

  std::string ErrorMessage() const {
    return errorMessage;
  }

  // The text of a successful Write; empty for a read or a failure.
  std::string Checkpoint() const {
    return checkpointText;
  }

  TopoDS_Shape Root() const {
    return root;
  }

  // Top-level shapes in TopoDS_Iterator order, with their own orientation and
  // location (not composed with the root's).
  int ChildCount() const {
    return int(children.size());
  }

  // Returns a null shape outside [0, ChildCount()).
  TopoDS_Shape Child(const int index) const {
    if (index < 0 || index >= int(children.size())) return TopoDS_Shape();
    return children[size_t(index)];
  }

private:
  void Reset(const std::string& message) {
    root.Nullify();
    children.clear();
    checkpointText.clear();
    done = false;
    errorMessage = message;
  }

  std::string checkpointText;
  TopoDS_Shape root;
  std::vector<TopoDS_Shape> children;
  bool done = false;
  std::string errorMessage = "checkpoint has not been written or read";
