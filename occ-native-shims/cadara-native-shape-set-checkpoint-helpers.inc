// Bit-exact shape-set checkpoint (cadara-3sq.7).
//
// Text BRep (BRepTools) writes 15 significant digits and rebuilds every
// location through gp_Trsf::SetValues, so neither geometry nor placements
// survive a round trip. BinTools stores every geometry double as raw IEEE-754
// bytes but still reads locations through SetValues and rebuilds every
// geometry axis through gp_Dir/gp_Ax2/gp_Ax3 constructors, which renormalize
// (a circle axis 0.70710678118654746 comes back ...57). This checkpoint
// therefore writes, ahead of the BinTools stream:
// - its own copy of the BinTools location table holding each datum's exact
//   gp_Trsf internals; the reader replaces BinTools' re-derived locations with
//   those before any shape refers to them;
// - the exact axes/directions of every analytic curve and surface the shapes
//   reference; the reader assigns them back through the direct setters;
// - the UV end points of every curve on surface. BinTools v4 stores none:
//   reading recomputes them from each pcurve (BRep_GCurve::SetRange ->
//   Update) while that pcurve still has the renormalized axis, and UV points
//   an algorithm set explicitly are lost; the reader assigns them back.
//
// Wire format: "<format>:<fnv1a64 hex>:<base64 body>", where body is
//   u32 location count, then per location (BinTools index order)
//     u8 1: elementary datum: i32 form, f64 scale, f64[9] matrix (row major),
//           f64[3] translation, u32 length + gp_Trsf::DumpJson text (17 digits)
//     u8 2: composite: (i32 datum index, i32 power)* then i32 0
//   u32 byte length, then the geometry axis records (CadaraVisitShapeGeometry
//   order, each distinct curve/surface once; see CadaraWriteGeometryTable)
//   and the UV point records (see CadaraWriteUVPoints), followed by the BinTools_ShapeSet stream (format version 4, triangles and
//   normals) and the BinTools reference to the root shape.
// The checksum covers the whole body, so a truncated or edited checkpoint is
// rejected before any native parser sees it.
#include <BinTools.hxx>
#include <BinTools_FormatVersion.hxx>
#include <BinTools_LocationSet.hxx>
#include <BinTools_ShapeSet.hxx>
#include <BRep_CurveOnClosedSurface.hxx>
#include <BRep_CurveOnSurface.hxx>
#include <BRep_CurveRepresentation.hxx>
#include <BRep_ListIteratorOfListOfCurveRepresentation.hxx>
#include <BRep_ListIteratorOfListOfPointRepresentation.hxx>
#include <BRep_PointRepresentation.hxx>
#include <BRep_TEdge.hxx>
#include <BRep_TFace.hxx>
#include <BRep_TVertex.hxx>
#include <Geom2d_Conic.hxx>
#include <Geom2d_Line.hxx>
#include <Geom2d_OffsetCurve.hxx>
#include <Geom_Conic.hxx>
#include <Geom_ElementarySurface.hxx>
#include <Geom_Line.hxx>
#include <Geom_OffsetCurve.hxx>
#include <Geom_OffsetSurface.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <Geom_SurfaceOfRevolution.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Standard_Failure.hxx>
#include <TColStd_IndexedMapOfTransient.hxx>
#include <type_traits>
#include <TopLoc_Datum3D.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS_Iterator.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Trsf.hxx>

namespace {
  const char* const CadaraShapeSetCheckpointFormat = "cadara-native-shape-set/v1";

  struct CadaraShapeSetCheckpointError {
    std::string message;
  };

  [[noreturn]] void CadaraShapeSetCheckpointFail(const std::string& message) {
    throw CadaraShapeSetCheckpointError{message};
  }

  uint64_t CadaraShapeSetCheckpointFnv1a64(const std::string& bytes) {
    uint64_t hash = 14695981039346656037ULL;
    for (const unsigned char byte : bytes) {
      hash ^= byte;
      hash *= 1099511628211ULL;
    }
    return hash;
  }

  const char CadaraBase64Alphabet[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  std::string CadaraBase64Encode(const std::string& bytes) {
    std::string out;
    out.reserve((bytes.size() + 2) / 3 * 4);
    size_t index = 0;
    for (; index + 2 < bytes.size(); index += 3) {
      const uint32_t chunk =
        (uint32_t(uint8_t(bytes[index])) << 16) |
        (uint32_t(uint8_t(bytes[index + 1])) << 8) |
        uint32_t(uint8_t(bytes[index + 2]));
      out.push_back(CadaraBase64Alphabet[(chunk >> 18) & 63]);
      out.push_back(CadaraBase64Alphabet[(chunk >> 12) & 63]);
      out.push_back(CadaraBase64Alphabet[(chunk >> 6) & 63]);
      out.push_back(CadaraBase64Alphabet[chunk & 63]);
    }
    const size_t rest = bytes.size() - index;
    if (rest > 0) {
      uint32_t chunk = uint32_t(uint8_t(bytes[index])) << 16;
      if (rest == 2) chunk |= uint32_t(uint8_t(bytes[index + 1])) << 8;
      out.push_back(CadaraBase64Alphabet[(chunk >> 18) & 63]);
      out.push_back(CadaraBase64Alphabet[(chunk >> 12) & 63]);
      out.push_back(rest == 2 ? CadaraBase64Alphabet[(chunk >> 6) & 63] : '=');
      out.push_back('=');
    }
    return out;
  }

  int CadaraBase64Value(const char character) {
    if (character >= 'A' && character <= 'Z') return character - 'A';
    if (character >= 'a' && character <= 'z') return character - 'a' + 26;
    if (character >= '0' && character <= '9') return character - '0' + 52;
    if (character == '+') return 62;
    if (character == '/') return 63;
    return -1;
  }

  std::string CadaraBase64Decode(const std::string& text, const size_t begin) {
    const size_t length = text.size() - begin;
    if (length % 4 != 0) CadaraShapeSetCheckpointFail("body is not padded base64");
    std::string out;
    out.reserve(length / 4 * 3);
    for (size_t index = begin; index < text.size(); index += 4) {
      const bool last = index + 4 == text.size();
      const int padding =
        last ? (text[index + 3] == '=' ? (text[index + 2] == '=' ? 2 : 1) : 0) : 0;
      uint32_t chunk = 0;
      for (int offset = 0; offset < 4; offset++) {
        const int value = offset >= 4 - padding ? 0 : CadaraBase64Value(text[index + offset]);
        if (value < 0) CadaraShapeSetCheckpointFail("body is not base64");
        chunk = (chunk << 6) | uint32_t(value);
      }
      out.push_back(char((chunk >> 16) & 255));
      if (padding < 2) out.push_back(char((chunk >> 8) & 255));
      if (padding < 1) out.push_back(char(chunk & 255));
    }
    return out;
  }

  template <typename T>
  void CadaraPutRaw(std::ostream& out, const T value) {
    out.write(reinterpret_cast<const char*>(&value), sizeof(T));
  }

  template <typename T>
  T CadaraGetRaw(std::istream& in) {
    T value;
    if (!in.read(reinterpret_cast<char*>(&value), sizeof(T))) {
      CadaraShapeSetCheckpointFail("checkpoint table is truncated");
    }
    return value;
  }

  bool CadaraSameBits(const double left, const double right) {
    return std::memcmp(&left, &right, sizeof(double)) == 0;
  }

  void CadaraWriteExactLocations(std::ostream& out, const BinTools_LocationSet& locations) {
    const int count = locations.NbLocations();
    CadaraPutRaw<uint32_t>(out, uint32_t(count));
    for (int index = 1; index <= count; index++) {
      const TopLoc_Location& location = locations.Location(index);
      TopLoc_Location next = location.NextLocation();
      const int power = location.FirstPower();
      if (next.IsIdentity() && power == 1) {
        // The datum, not the cached item product, holds the authored gp_Trsf.
        const gp_Trsf& trsf = location.FirstDatum()->Transformation();
        CadaraPutRaw<uint8_t>(out, 1);
        CadaraPutRaw<int32_t>(out, int32_t(trsf.Form()));
        CadaraPutRaw<double>(out, trsf.ScaleFactor());
        for (int row = 1; row <= 3; row++) {
          for (int column = 1; column <= 3; column++) {
            CadaraPutRaw<double>(out, trsf.HVectorialPart().Value(row, column));
          }
        }
        for (int axis = 1; axis <= 3; axis++) {
          CadaraPutRaw<double>(out, trsf.TranslationPart().Coord(axis));
        }
        // DumpJson places its ", " separators by reading the stream back,
        // which needs a read/write Standard_SStream.
        Standard_SStream json;
        json.imbue(std::locale::classic());
        json.precision(17);
        trsf.DumpJson(json);
        const std::string text = json.str();
        CadaraPutRaw<uint32_t>(out, uint32_t(text.size()));
        out.write(text.data(), std::streamsize(text.size()));
        continue;
      }
      // Same chain encoding as BinTools_LocationSet::Write.
      CadaraPutRaw<uint8_t>(out, 2);
      CadaraPutRaw<int32_t>(out, int32_t(locations.Index(TopLoc_Location(location.FirstDatum()))));
      CadaraPutRaw<int32_t>(out, int32_t(power));
      while (!next.IsIdentity()) {
        CadaraPutRaw<int32_t>(out, int32_t(locations.Index(TopLoc_Location(next.FirstDatum()))));
        CadaraPutRaw<int32_t>(out, int32_t(next.FirstPower()));
        next = next.NextLocation();
      }
      CadaraPutRaw<int32_t>(out, 0);
    }
  }

  // gp_Trsf::InitFromJson assigns form, scale, matrix and translation directly
  // (no SetValues/Orthogonalize); every field is then checked bit for bit.
  gp_Trsf CadaraReadExactTrsf(std::istream& in) {
    const int32_t form = CadaraGetRaw<int32_t>(in);
    double expected[13];
    for (double& value : expected) value = CadaraGetRaw<double>(in);
    const uint32_t length = CadaraGetRaw<uint32_t>(in);
    std::string text(length, '\0');
    if (!in.read(&text[0], std::streamsize(length))) {
      CadaraShapeSetCheckpointFail("location table is truncated");
    }
    Standard_SStream json;
    json << text;
    gp_Trsf trsf;
    Standard_Integer position = 1;
    if (!trsf.InitFromJson(json, position)) {
      CadaraShapeSetCheckpointFail("location transform text is not readable");
    }
    bool exact = int32_t(trsf.Form()) == form && CadaraSameBits(trsf.ScaleFactor(), expected[0]);
    for (int row = 1; row <= 3; row++) {
      for (int column = 1; column <= 3; column++) {
        exact = exact && CadaraSameBits(
          trsf.HVectorialPart().Value(row, column),
          expected[1 + (row - 1) * 3 + (column - 1)]
        );
      }
    }
    for (int axis = 1; axis <= 3; axis++) {
      exact = exact && CadaraSameBits(trsf.TranslationPart().Coord(axis), expected[9 + axis]);
    }
    if (!exact) CadaraShapeSetCheckpointFail("location transform did not restore exactly");
    return trsf;
  }

  std::vector<TopLoc_Location> CadaraReadExactLocations(std::istream& in) {
    const uint32_t count = CadaraGetRaw<uint32_t>(in);
    std::vector<TopLoc_Location> locations;
    for (uint32_t index = 0; index < count; index++) {
      const uint8_t kind = CadaraGetRaw<uint8_t>(in);
      if (kind == 1) {
        const Handle(TopLoc_Datum3D) datum = new TopLoc_Datum3D(CadaraReadExactTrsf(in));
        locations.push_back(TopLoc_Location(datum));
        continue;
      }
      if (kind != 2) CadaraShapeSetCheckpointFail("location table has an unknown entry");
      // Same composition as BinTools_LocationSet::Read, over the exact datums.
      TopLoc_Location location;
      for (int32_t datum = CadaraGetRaw<int32_t>(in); datum != 0; datum = CadaraGetRaw<int32_t>(in)) {
        const int32_t power = CadaraGetRaw<int32_t>(in);
        if (datum < 1 || uint32_t(datum) > locations.size()) {
          CadaraShapeSetCheckpointFail("location table refers to a later entry");
        }
        location = locations[size_t(datum - 1)].Powered(power) * location;
      }
      locations.push_back(location);
    }
    return locations;
  }

  // gp axes and directions hold only doubles (no padding, trivially
  // copyable): their bytes, copied back into the same type, are the exact
  // value, which no renormalizing gp constructor can rebuild.
  template <typename T, size_t Doubles>
  void CadaraPutGp(std::ostream& out, const T& value) {
    static_assert(std::is_trivially_copyable<T>::value, "gp value must be trivially copyable");
    static_assert(sizeof(T) == Doubles * sizeof(double), "gp value must be unpadded doubles");
    out.write(reinterpret_cast<const char*>(&value), sizeof(T));
  }

  // `rebuilt` is BinTools' renormalized value; it may differ from the exact one
  // only in the last bits, otherwise the records are not this shape set's.
  template <typename T, size_t Doubles>
  T CadaraGetGp(std::istream& in, const T& rebuilt) {
    static_assert(std::is_trivially_copyable<T>::value, "gp value must be trivially copyable");
    static_assert(sizeof(T) == Doubles * sizeof(double), "gp value must be unpadded doubles");
    T exact = rebuilt;
    if (!in.read(reinterpret_cast<char*>(&exact), sizeof(T))) {
      CadaraShapeSetCheckpointFail("checkpoint table is truncated");
    }
    double exactValues[Doubles];
    double rebuiltValues[Doubles];
    std::memcpy(exactValues, &exact, sizeof(T));
    std::memcpy(rebuiltValues, &rebuilt, sizeof(T));
    for (size_t index = 0; index < Doubles; index++) {
      const double scale = std::max(1.0, std::fabs(exactValues[index]));
      if (!(std::fabs(exactValues[index] - rebuiltValues[index]) <= 1e-9 * scale)) {
        CadaraShapeSetCheckpointFail("geometry table does not match the shape set");
      }
    }
    return exact;
  }

  // Record kinds; 0 means the geometry stores no renormalized axis.
  int CadaraCurveKind(const Handle(Geom_Curve)& curve) {
    if (!Handle(Geom_Line)::DownCast(curve).IsNull()) return 1;
    if (!Handle(Geom_Conic)::DownCast(curve).IsNull()) return 2;
    if (!Handle(Geom_TrimmedCurve)::DownCast(curve).IsNull()) return 3;
    if (!Handle(Geom_OffsetCurve)::DownCast(curve).IsNull()) return 4;
    return 0;
  }

  int CadaraCurve2dKind(const Handle(Geom2d_Curve)& curve) {
    if (!Handle(Geom2d_Line)::DownCast(curve).IsNull()) return 1;
    if (!Handle(Geom2d_Conic)::DownCast(curve).IsNull()) return 2;
    if (!Handle(Geom2d_TrimmedCurve)::DownCast(curve).IsNull()) return 3;
    if (!Handle(Geom2d_OffsetCurve)::DownCast(curve).IsNull()) return 4;
    return 0;
  }

  int CadaraSurfaceKind(const Handle(Geom_Surface)& surface) {
    if (!Handle(Geom_ElementarySurface)::DownCast(surface).IsNull()) return 1;
    if (!Handle(Geom_SurfaceOfLinearExtrusion)::DownCast(surface).IsNull()) return 2;
    if (!Handle(Geom_SurfaceOfRevolution)::DownCast(surface).IsNull()) return 3;
    if (!Handle(Geom_RectangularTrimmedSurface)::DownCast(surface).IsNull()) return 4;
    if (!Handle(Geom_OffsetSurface)::DownCast(surface).IsNull()) return 5;
    return 0;
  }

  void CadaraWriteCurveAxes(std::ostream& out, const Handle(Geom_Curve)& curve) {
    const int kind = CadaraCurveKind(curve);
    CadaraPutRaw<uint8_t>(out, uint8_t(kind));
    if (kind == 1) CadaraPutGp<gp_Ax1, 6>(out, Handle(Geom_Line)::DownCast(curve)->Position());
    if (kind == 2) CadaraPutGp<gp_Ax2, 12>(out, Handle(Geom_Conic)::DownCast(curve)->Position());
    if (kind == 3) CadaraWriteCurveAxes(out, Handle(Geom_TrimmedCurve)::DownCast(curve)->BasisCurve());
    if (kind == 4) {
      const Handle(Geom_OffsetCurve) offset = Handle(Geom_OffsetCurve)::DownCast(curve);
      CadaraPutGp<gp_Dir, 3>(out, offset->Direction());
      CadaraWriteCurveAxes(out, offset->BasisCurve());
    }
  }

  void CadaraWriteCurve2dAxes(std::ostream& out, const Handle(Geom2d_Curve)& curve) {
    const int kind = CadaraCurve2dKind(curve);
    CadaraPutRaw<uint8_t>(out, uint8_t(kind));
    if (kind == 1) CadaraPutGp<gp_Ax2d, 4>(out, Handle(Geom2d_Line)::DownCast(curve)->Position());
    if (kind == 2) CadaraPutGp<gp_Ax22d, 6>(out, Handle(Geom2d_Conic)::DownCast(curve)->Position());
    if (kind == 3) CadaraWriteCurve2dAxes(out, Handle(Geom2d_TrimmedCurve)::DownCast(curve)->BasisCurve());
    if (kind == 4) CadaraWriteCurve2dAxes(out, Handle(Geom2d_OffsetCurve)::DownCast(curve)->BasisCurve());
  }

  void CadaraWriteSurfaceAxes(std::ostream& out, const Handle(Geom_Surface)& surface) {
    const int kind = CadaraSurfaceKind(surface);
    CadaraPutRaw<uint8_t>(out, uint8_t(kind));
    if (kind == 1) {
      CadaraPutGp<gp_Ax3, 12>(out, Handle(Geom_ElementarySurface)::DownCast(surface)->Position());
    }
    if (kind == 2) {
      const Handle(Geom_SurfaceOfLinearExtrusion) extrusion =
        Handle(Geom_SurfaceOfLinearExtrusion)::DownCast(surface);
      CadaraPutGp<gp_Dir, 3>(out, extrusion->Direction());
      CadaraWriteCurveAxes(out, extrusion->BasisCurve());
    }
    if (kind == 3) {
      const Handle(Geom_SurfaceOfRevolution) revolution =
        Handle(Geom_SurfaceOfRevolution)::DownCast(surface);
      CadaraPutGp<gp_Ax1, 6>(out, revolution->Axis());
      CadaraWriteCurveAxes(out, revolution->BasisCurve());
    }
    if (kind == 4) {
      CadaraWriteSurfaceAxes(out, Handle(Geom_RectangularTrimmedSurface)::DownCast(surface)->BasisSurface());
    }
    if (kind == 5) {
      CadaraWriteSurfaceAxes(out, Handle(Geom_OffsetSurface)::DownCast(surface)->BasisSurface());
    }
  }

  void CadaraExpectKind(std::istream& in, const int kind) {
    if (CadaraGetRaw<uint8_t>(in) != kind) {
      CadaraShapeSetCheckpointFail("geometry table does not match the shape set");
    }
  }

  void CadaraRepairCurveAxes(std::istream& in, const Handle(Geom_Curve)& curve) {
    const int kind = CadaraCurveKind(curve);
    CadaraExpectKind(in, kind);
    if (kind == 1) {
      const Handle(Geom_Line) line = Handle(Geom_Line)::DownCast(curve);
      line->SetPosition(CadaraGetGp<gp_Ax1, 6>(in, line->Position()));
    }
    if (kind == 2) {
      const Handle(Geom_Conic) conic = Handle(Geom_Conic)::DownCast(curve);
      conic->SetPosition(CadaraGetGp<gp_Ax2, 12>(in, conic->Position()));
    }
    if (kind == 3) CadaraRepairCurveAxes(in, Handle(Geom_TrimmedCurve)::DownCast(curve)->BasisCurve());
    if (kind == 4) {
      const Handle(Geom_OffsetCurve) offset = Handle(Geom_OffsetCurve)::DownCast(curve);
      offset->SetDirection(CadaraGetGp<gp_Dir, 3>(in, offset->Direction()));
      CadaraRepairCurveAxes(in, offset->BasisCurve());
    }
  }

  void CadaraRepairCurve2dAxes(std::istream& in, const Handle(Geom2d_Curve)& curve) {
    const int kind = CadaraCurve2dKind(curve);
    CadaraExpectKind(in, kind);
    if (kind == 1) {
      const Handle(Geom2d_Line) line = Handle(Geom2d_Line)::DownCast(curve);
      line->SetPosition(CadaraGetGp<gp_Ax2d, 4>(in, line->Position()));
    }
    if (kind == 2) {
      const Handle(Geom2d_Conic) conic = Handle(Geom2d_Conic)::DownCast(curve);
      conic->SetAxis(CadaraGetGp<gp_Ax22d, 6>(in, conic->Position()));
    }
    if (kind == 3) CadaraRepairCurve2dAxes(in, Handle(Geom2d_TrimmedCurve)::DownCast(curve)->BasisCurve());
    if (kind == 4) CadaraRepairCurve2dAxes(in, Handle(Geom2d_OffsetCurve)::DownCast(curve)->BasisCurve());
  }

  void CadaraRepairSurfaceAxes(std::istream& in, const Handle(Geom_Surface)& surface) {
    const int kind = CadaraSurfaceKind(surface);
    CadaraExpectKind(in, kind);
    if (kind == 1) {
      const Handle(Geom_ElementarySurface) elementary = Handle(Geom_ElementarySurface)::DownCast(surface);
      elementary->SetPosition(CadaraGetGp<gp_Ax3, 12>(in, elementary->Position()));
    }
    if (kind == 2) {
      const Handle(Geom_SurfaceOfLinearExtrusion) extrusion =
        Handle(Geom_SurfaceOfLinearExtrusion)::DownCast(surface);
      extrusion->SetDirection(CadaraGetGp<gp_Dir, 3>(in, extrusion->Direction()));
      CadaraRepairCurveAxes(in, extrusion->BasisCurve());
    }
    if (kind == 3) {
      const Handle(Geom_SurfaceOfRevolution) revolution =
        Handle(Geom_SurfaceOfRevolution)::DownCast(surface);
      revolution->SetAxis(CadaraGetGp<gp_Ax1, 6>(in, revolution->Axis()));
      CadaraRepairCurveAxes(in, revolution->BasisCurve());
    }
    if (kind == 4) {
      CadaraRepairSurfaceAxes(in, Handle(Geom_RectangularTrimmedSurface)::DownCast(surface)->BasisSurface());
    }
    if (kind == 5) {
      const Handle(Geom_OffsetSurface) offset = Handle(Geom_OffsetSurface)::DownCast(surface);
      CadaraRepairSurfaceAxes(in, offset->BasisSurface());
      // Recomputes the equivalent surface cached from the renormalized basis.
      offset->SetOffsetValue(offset->Offset());
    }
  }

  // Every curve and surface BinTools_ShapeSet::AddShape stores for `shape`,
  // in representation order (BinTools reads representations back in order).
  template <typename Curve3d, typename Curve2d, typename Surface>
  void CadaraVisitShapeGeometry(
    const TopoDS_Shape& shape,
    Curve3d curve3d,
    Curve2d curve2d,
    Surface surface
  ) {
    if (shape.ShapeType() == TopAbs_VERTEX) {
      const Handle(BRep_TVertex) vertex = Handle(BRep_TVertex)::DownCast(shape.TShape());
      for (BRep_ListIteratorOfListOfPointRepresentation points(vertex->Points()); points.More(); points.Next()) {
        const Handle(BRep_PointRepresentation)& point = points.Value();
        if (point->IsPointOnCurve()) {
          curve3d(point->Curve());
        } else if (point->IsPointOnCurveOnSurface()) {
          curve2d(point->PCurve());
          surface(point->Surface());
        } else if (point->IsPointOnSurface()) {
          surface(point->Surface());
        }
      }
    } else if (shape.ShapeType() == TopAbs_EDGE) {
      const Handle(BRep_TEdge) edge = Handle(BRep_TEdge)::DownCast(shape.TShape());
      for (BRep_ListIteratorOfListOfCurveRepresentation curves(edge->Curves()); curves.More(); curves.Next()) {
        const Handle(BRep_CurveRepresentation)& curve = curves.Value();
        if (curve->IsCurve3D()) {
          curve3d(curve->Curve3D());
        } else if (curve->IsCurveOnSurface()) {
          surface(curve->Surface());
          curve2d(curve->PCurve());
          if (curve->IsCurveOnClosedSurface()) curve2d(curve->PCurve2());
        } else if (curve->IsRegularity()) {
          surface(curve->Surface());
          surface(curve->Surface2());
        } else if (curve->IsPolygonOnSurface()) {
          surface(curve->Surface());
        }
      }
    } else if (shape.ShapeType() == TopAbs_FACE) {
      surface(Handle(BRep_TFace)::DownCast(shape.TShape())->Surface());
    }
  }

  // Visits each distinct non-null geometry of the set's shapes once, in order.
  template <typename Curve3d, typename Curve2d, typename Surface>
  void CadaraVisitShapeSetGeometry(
    BinTools_ShapeSet& shapes,
    Curve3d curve3d,
    Curve2d curve2d,
    Surface surface
  ) {
    TColStd_IndexedMapOfTransient seen;
    const auto first = [&seen](const Handle(Standard_Transient)& geometry) {
      if (geometry.IsNull()) return false;
      const int before = seen.Extent();
      seen.Add(geometry);
      return seen.Extent() > before;
    };
    for (int index = 1; index <= shapes.NbShapes(); index++) {
      CadaraVisitShapeGeometry(
        shapes.Shape(index),
        [&](const Handle(Geom_Curve)& curve) { if (first(curve)) curve3d(curve); },
        [&](const Handle(Geom2d_Curve)& curve) { if (first(curve)) curve2d(curve); },
        [&](const Handle(Geom_Surface)& geometry) { if (first(geometry)) surface(geometry); }
      );
    }
  }

  // Every curve-on-surface representation of the set's edges, in
  // representation order.
  template <typename Visit>
  void CadaraVisitCurvesOnSurface(BinTools_ShapeSet& shapes, Visit visit) {
    for (int index = 1; index <= shapes.NbShapes(); index++) {
      const TopoDS_Shape& shape = shapes.Shape(index);
      if (shape.ShapeType() != TopAbs_EDGE) continue;
      const Handle(BRep_TEdge) edge = Handle(BRep_TEdge)::DownCast(shape.TShape());
      for (BRep_ListIteratorOfListOfCurveRepresentation curves(edge->Curves()); curves.More(); curves.Next()) {
        const Handle(BRep_CurveOnSurface) onSurface = Handle(BRep_CurveOnSurface)::DownCast(curves.Value());
        if (!onSurface.IsNull()) visit(onSurface, Handle(BRep_CurveOnClosedSurface)::DownCast(onSurface));
      }
    }
  }

  // Per curve on surface: u8 1 (open) or 2 (closed surface), then UV1, UV2
  // and, on a closed surface, UV21, UV22 as raw gp_Pnt2d.
  void CadaraWriteUVPoints(std::ostream& out, BinTools_ShapeSet& shapes) {
    CadaraVisitCurvesOnSurface(
      shapes,
      [&out](const Handle(BRep_CurveOnSurface)& onSurface, const Handle(BRep_CurveOnClosedSurface)& closed) {
        CadaraPutRaw<uint8_t>(out, closed.IsNull() ? 1 : 2);
        gp_Pnt2d first, last;
        onSurface->UVPoints(first, last);
        CadaraPutGp<gp_Pnt2d, 2>(out, first);
        CadaraPutGp<gp_Pnt2d, 2>(out, last);
        if (closed.IsNull()) return;
        closed->UVPoints2(first, last);
        CadaraPutGp<gp_Pnt2d, 2>(out, first);
        CadaraPutGp<gp_Pnt2d, 2>(out, last);
      }
    );
  }

  // Assigns the stored UV points without Update(), which would recompute them.
  void CadaraRestoreUVPoints(std::istream& in, BinTools_ShapeSet& shapes) {
    CadaraVisitCurvesOnSurface(
      shapes,
      [&in](const Handle(BRep_CurveOnSurface)& onSurface, const Handle(BRep_CurveOnClosedSurface)& closed) {
        CadaraExpectKind(in, closed.IsNull() ? 1 : 2);
        const gp_Pnt2d first = CadaraGetRaw<gp_Pnt2d>(in);
        const gp_Pnt2d last = CadaraGetRaw<gp_Pnt2d>(in);
        onSurface->SetUVPoints(first, last);
        if (closed.IsNull()) return;
        const gp_Pnt2d first2 = CadaraGetRaw<gp_Pnt2d>(in);
        const gp_Pnt2d last2 = CadaraGetRaw<gp_Pnt2d>(in);
        closed->SetUVPoints2(first2, last2);
      }
    );
  }

  // Axis records, then UV point records.
  std::string CadaraWriteGeometryTable(BinTools_ShapeSet& shapes) {
    std::ostringstream out(std::ios::out | std::ios::binary);
    CadaraVisitShapeSetGeometry(
      shapes,
      [&out](const Handle(Geom_Curve)& curve) { CadaraWriteCurveAxes(out, curve); },
      [&out](const Handle(Geom2d_Curve)& curve) { CadaraWriteCurve2dAxes(out, curve); },
      [&out](const Handle(Geom_Surface)& surface) { CadaraWriteSurfaceAxes(out, surface); }
    );
    CadaraWriteUVPoints(out, shapes);
    return out.str();
  }

  void CadaraRestoreGeometryTable(BinTools_ShapeSet& shapes, const std::string& table) {
    std::istringstream in(table, std::ios::in | std::ios::binary);
    CadaraVisitShapeSetGeometry(
      shapes,
      [&in](const Handle(Geom_Curve)& curve) { CadaraRepairCurveAxes(in, curve); },
      [&in](const Handle(Geom2d_Curve)& curve) { CadaraRepairCurve2dAxes(in, curve); },
      [&in](const Handle(Geom_Surface)& surface) { CadaraRepairSurfaceAxes(in, surface); }
    );
    CadaraRestoreUVPoints(in, shapes);
    if (in.peek() != std::char_traits<char>::eof()) {
      CadaraShapeSetCheckpointFail("geometry table does not match the shape set");
    }
  }

  // Swaps BinTools' SetValues-derived locations for the exact ones after the
  // location table and geometry are read and before any shape is read, and
  // restores every TShape flag as written.
  class CadaraExactLocationShapeSet : public BinTools_ShapeSet {
  public:
    explicit CadaraExactLocationShapeSet(const std::vector<TopLoc_Location>& exactLocations)
      : exact(exactLocations) {}

    void ReadGeometry(
      Standard_IStream& in,
      const Message_ProgressRange& range = Message_ProgressRange()
    ) override {
      BinTools_ShapeSet::ReadGeometry(in, range);
      BinTools_LocationSet& locations = ChangeLocations();
      if (locations.NbLocations() != int(exact.size())) {
        CadaraShapeSetCheckpointFail("location table does not match the shape set");
      }
      locations.Clear();
      for (size_t index = 0; index < exact.size(); index++) {
        if (locations.Add(exact[index]) != int(index + 1)) {
          CadaraShapeSetCheckpointFail("location table order does not match the shape set");
        }
      }
    }

    // BinTools_ShapeSet::ReadFlagsAndSubs, except that format version 4 there
    // clears Checked ("force check at reading"); a checkpoint keeps it so the
    // restored shapes re-export identically.
    void ReadFlagsAndSubs(
      TopoDS_Shape& shape,
      const TopAbs_ShapeEnum,
      Standard_IStream& in,
      const Standard_Integer shapeCount
    ) override {
      Standard_Boolean free, modified, checked, orientable, closed, infinite, convex;
      BinTools::GetBool(in, free);
      BinTools::GetBool(in, modified);
      BinTools::GetBool(in, checked);
      BinTools::GetBool(in, orientable);
      BinTools::GetBool(in, closed);
      BinTools::GetBool(in, infinite);
      BinTools::GetBool(in, convex);
      TopoDS_Shape child;
      do {
        ReadSubs(child, in, shapeCount);
        if (!child.IsNull()) AddShapes(shape, child);
      } while (!child.IsNull());
      shape.Free(free);
      shape.Modified(modified);
      shape.Checked(checked);
      shape.Orientable(orientable);
      shape.Closed(closed);
      shape.Infinite(infinite);
      shape.Convex(convex);
    }

  private:
    const std::vector<TopLoc_Location>& exact;
  };
}
