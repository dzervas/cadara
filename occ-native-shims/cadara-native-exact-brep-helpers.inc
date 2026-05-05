namespace {
  void CadaraAppendPoint3Json(std::ostringstream& out, const gp_Pnt& point) {
    out << "[" << point.X() << "," << point.Y() << "," << point.Z() << "]";
  }

  void CadaraAppendPoint2Json(std::ostringstream& out, const gp_Pnt2d& point) {
    out << "[" << point.X() << "," << point.Y() << "]";
  }

  void CadaraAppendDir2Json(std::ostringstream& out, const gp_Dir2d& direction) {
    out << "[" << direction.X() << "," << direction.Y() << "]";
  }

  void CadaraAppendDir3Json(std::ostringstream& out, const gp_Dir& direction) {
    out << "[" << direction.X() << "," << direction.Y() << "," << direction.Z() << "]";
  }

  void CadaraAppendRangeJson(std::ostringstream& out, const double first, const double last) {
    out << "[" << first << "," << last << "]";
  }

  void CadaraAppendFrameJson(std::ostringstream& out, const gp_Ax3& axis) {
    out << "{\"origin\":";
    CadaraAppendPoint3Json(out, axis.Location());
    out << ",\"zDirection\":";
    CadaraAppendDir3Json(out, axis.Direction());
    out << ",\"xDirection\":";
    CadaraAppendDir3Json(out, axis.XDirection());
    out << "}";
  }

  void CadaraAppendExactBrepDiagnostic(
    std::ostringstream& out,
    bool& needsComma,
    const std::string& code,
    const std::string& message,
    const std::string& bodyId,
    const std::string& detailKind,
    const std::string& detailKey,
    const std::string& detailValue
  ) {
    if (needsComma) {
      out << ",";
    }
    needsComma = true;
    out << CadaraDiagnosticJson(
      code,
      "warning",
      message,
      bodyId,
      detailKind,
      detailKey,
      detailValue
    );
  }

  std::string CadaraCurveTypeName(const GeomAbs_CurveType curveType) {
    switch (curveType) {
      case GeomAbs_Line:
        return "line";
      case GeomAbs_Circle:
        return "circle";
      case GeomAbs_Ellipse:
        return "ellipse";
      case GeomAbs_BezierCurve:
        return "bezier";
      case GeomAbs_BSplineCurve:
        return "bSpline";
      case GeomAbs_Hyperbola:
        return "hyperbola";
      case GeomAbs_Parabola:
        return "parabola";
      case GeomAbs_OffsetCurve:
        return "offset";
      default:
        return "other";
    }
  }

  std::string CadaraSurfaceTypeName(const GeomAbs_SurfaceType surfaceType) {
    switch (surfaceType) {
      case GeomAbs_Plane:
        return "plane";
      case GeomAbs_Cylinder:
        return "cylinder";
      case GeomAbs_Cone:
        return "cone";
      case GeomAbs_Sphere:
        return "sphere";
      case GeomAbs_Torus:
        return "torus";
      case GeomAbs_BezierSurface:
        return "bezier";
      case GeomAbs_BSplineSurface:
        return "bSpline";
      case GeomAbs_SurfaceOfRevolution:
        return "surfaceOfRevolution";
      case GeomAbs_SurfaceOfExtrusion:
        return "surfaceOfLinearExtrusion";
      case GeomAbs_OffsetSurface:
        return "offset";
      default:
        return "other";
    }
  }

  int CadaraFindShapeIndex(
    TopTools_IndexedMapOfShape& shapeMap,
    const TopoDS_Shape& shape
  ) {
    int index = shapeMap.FindIndex(shape);
    if (index > 0) {
      return index;
    }

    const TopoDS_Shape forwardShape = shape.Oriented(TopAbs_FORWARD);
    return shapeMap.FindIndex(forwardShape);
  }

  void CadaraAppendUnsupportedCurve3Json(
    std::ostringstream& out,
    const std::string& typeName
  ) {
    out << "{\"kind\":\"unsupported\",\"typeName\":\"" << CadaraEscapeJson(typeName) << "\"}";
  }

  void CadaraAppendUnsupportedCurve2Json(
    std::ostringstream& out,
    const std::string& typeName
  ) {
    out << "{\"kind\":\"unsupported\",\"typeName\":\"" << CadaraEscapeJson(typeName) << "\"}";
  }

  void CadaraAppendUnsupportedSurfaceJson(
    std::ostringstream& out,
    const std::string& typeName
  ) {
    out << "{\"kind\":\"unsupported\",\"typeName\":\"" << CadaraEscapeJson(typeName) << "\"}";
  }

  void CadaraAppendCurve3Json(
    std::ostringstream& out,
    const TopoDS_Edge& edge,
    const std::string& edgeKey,
    const std::string& bodyId,
    std::ostringstream& diagnostics,
    bool& needsDiagnosticComma
  ) {
    BRepAdaptor_Curve curve(edge);
    const GeomAbs_CurveType curveType = curve.GetType();

    switch (curveType) {
      case GeomAbs_Line: {
        const gp_Lin line = curve.Line();
        out << "{\"kind\":\"line\",\"origin\":";
        CadaraAppendPoint3Json(out, line.Location());
        out << ",\"direction\":";
        CadaraAppendDir3Json(out, line.Direction());
        out << ",\"parameterRange\":";
        CadaraAppendRangeJson(out, curve.FirstParameter(), curve.LastParameter());
        out << "}";
        return;
      }
      case GeomAbs_Circle: {
        const gp_Circ circle = curve.Circle();
        out << "{\"kind\":\"circle\",\"center\":";
        CadaraAppendPoint3Json(out, circle.Location());
        out << ",\"axisDirection\":";
        CadaraAppendDir3Json(out, circle.Axis().Direction());
        out << ",\"xDirection\":";
        CadaraAppendDir3Json(out, circle.Position().XDirection());
        out << ",\"radius\":" << circle.Radius() << ",\"parameterRange\":";
        CadaraAppendRangeJson(out, curve.FirstParameter(), curve.LastParameter());
        out << "}";
        return;
      }
      case GeomAbs_Ellipse: {
        const gp_Elips ellipse = curve.Ellipse();
        out << "{\"kind\":\"ellipse\",\"center\":";
        CadaraAppendPoint3Json(out, ellipse.Location());
        out << ",\"axisDirection\":";
        CadaraAppendDir3Json(out, ellipse.Axis().Direction());
        out << ",\"xDirection\":";
        CadaraAppendDir3Json(out, ellipse.Position().XDirection());
        out
          << ",\"majorRadius\":" << ellipse.MajorRadius()
          << ",\"minorRadius\":" << ellipse.MinorRadius()
          << ",\"parameterRange\":";
        CadaraAppendRangeJson(out, curve.FirstParameter(), curve.LastParameter());
        out << "}";
        return;
      }
      case GeomAbs_BezierCurve: {
        const Handle(Geom_BezierCurve) bezier = curve.Bezier();
        out << "{\"kind\":\"bezier\",\"poles\":[";
        for (int index = 1; index <= bezier->NbPoles(); index += 1) {
          if (index > 1) {
            out << ",";
          }
          CadaraAppendPoint3Json(out, bezier->Pole(index).Transformed(curve.Trsf()));
        }
        if (bezier->IsRational()) {
          out << "],\"weights\":[";
          for (int index = 1; index <= bezier->NbPoles(); index += 1) {
            if (index > 1) {
              out << ",";
            }
            out << bezier->Weight(index);
          }
        }
        out << "],\"parameterRange\":";
        CadaraAppendRangeJson(out, curve.FirstParameter(), curve.LastParameter());
        out << "}";
        return;
      }
      case GeomAbs_BSplineCurve: {
        const Handle(Geom_BSplineCurve) spline = curve.BSpline();
        out
          << "{\"kind\":\"bSpline\",\"degree\":" << spline->Degree()
          << ",\"periodic\":" << (spline->IsPeriodic() ? "true" : "false")
          << ",\"poles\":[";
        for (int index = 1; index <= spline->NbPoles(); index += 1) {
          if (index > 1) {
            out << ",";
          }
          CadaraAppendPoint3Json(out, spline->Pole(index).Transformed(curve.Trsf()));
        }
        if (spline->IsRational()) {
          out << "],\"weights\":[";
          for (int index = 1; index <= spline->NbPoles(); index += 1) {
            if (index > 1) {
              out << ",";
            }
            out << spline->Weight(index);
          }
        }
        out << "],\"knots\":[";
        for (int index = 1; index <= spline->NbKnots(); index += 1) {
          if (index > 1) {
            out << ",";
          }
          out << spline->Knot(index);
        }
        out << "],\"multiplicities\":[";
        for (int index = 1; index <= spline->NbKnots(); index += 1) {
          if (index > 1) {
            out << ",";
          }
          out << spline->Multiplicity(index);
        }
        out << "],\"parameterRange\":";
        CadaraAppendRangeJson(out, curve.FirstParameter(), curve.LastParameter());
        out << "}";
        return;
      }
      default:
        CadaraAppendExactBrepDiagnostic(
          diagnostics,
          needsDiagnosticComma,
          "occ-native-exact-brep-unsupported-curve",
          "Native exact B-rep extractor marked an unsupported 3D edge curve instead of approximating it as exact geometry.",
          bodyId,
          "edgeCurve",
          "edgeKey",
          edgeKey + ":" + CadaraCurveTypeName(curveType)
        );
        CadaraAppendUnsupportedCurve3Json(out, CadaraCurveTypeName(curveType));
        return;
    }
  }

  void CadaraAppendCurve2dJson(
    std::ostringstream& out,
    const TopoDS_Edge& edge,
    const TopoDS_Face& face,
    const std::string& coedgeKey,
    const std::string& bodyId,
    std::ostringstream& diagnostics,
    bool& needsDiagnosticComma
  ) {
    BRepAdaptor_Curve2d curve(edge, face);
    const GeomAbs_CurveType curveType = curve.GetType();

    switch (curveType) {
      case GeomAbs_Line: {
        const gp_Lin2d line = curve.Line();
        out << "{\"kind\":\"line\",\"origin\":";
        CadaraAppendPoint2Json(out, line.Location());
        out << ",\"direction\":";
        CadaraAppendDir2Json(out, line.Direction());
        out << ",\"parameterRange\":";
        CadaraAppendRangeJson(out, curve.FirstParameter(), curve.LastParameter());
        out << "}";
        return;
      }
      case GeomAbs_Circle: {
        const gp_Circ2d circle = curve.Circle();
        out << "{\"kind\":\"circle\",\"center\":";
        CadaraAppendPoint2Json(out, circle.Location());
        out << ",\"xDirection\":";
        CadaraAppendDir2Json(out, circle.Position().XDirection());
        out << ",\"radius\":" << circle.Radius() << ",\"parameterRange\":";
        CadaraAppendRangeJson(out, curve.FirstParameter(), curve.LastParameter());
        out << "}";
        return;
      }
      case GeomAbs_Ellipse: {
        const gp_Elips2d ellipse = curve.Ellipse();
        out << "{\"kind\":\"ellipse\",\"center\":";
        CadaraAppendPoint2Json(out, ellipse.Location());
        out << ",\"xDirection\":";
        CadaraAppendDir2Json(out, ellipse.XAxis().Direction());
        out
          << ",\"majorRadius\":" << ellipse.MajorRadius()
          << ",\"minorRadius\":" << ellipse.MinorRadius()
          << ",\"parameterRange\":";
        CadaraAppendRangeJson(out, curve.FirstParameter(), curve.LastParameter());
        out << "}";
        return;
      }
      case GeomAbs_BezierCurve: {
        const Handle(Geom2d_BezierCurve) bezier = curve.Bezier();
        out << "{\"kind\":\"bezier\",\"poles\":[";
        for (int index = 1; index <= bezier->NbPoles(); index += 1) {
          if (index > 1) {
            out << ",";
          }
          CadaraAppendPoint2Json(out, bezier->Pole(index));
        }
        if (bezier->IsRational()) {
          out << "],\"weights\":[";
          for (int index = 1; index <= bezier->NbPoles(); index += 1) {
            if (index > 1) {
              out << ",";
            }
            out << bezier->Weight(index);
          }
        }
        out << "],\"parameterRange\":";
        CadaraAppendRangeJson(out, curve.FirstParameter(), curve.LastParameter());
        out << "}";
        return;
      }
      case GeomAbs_BSplineCurve: {
        const Handle(Geom2d_BSplineCurve) spline = curve.BSpline();
        out
          << "{\"kind\":\"bSpline\",\"degree\":" << spline->Degree()
          << ",\"periodic\":" << (spline->IsPeriodic() ? "true" : "false")
          << ",\"poles\":[";
        for (int index = 1; index <= spline->NbPoles(); index += 1) {
          if (index > 1) {
            out << ",";
          }
          CadaraAppendPoint2Json(out, spline->Pole(index));
        }
        if (spline->IsRational()) {
          out << "],\"weights\":[";
          for (int index = 1; index <= spline->NbPoles(); index += 1) {
            if (index > 1) {
              out << ",";
            }
            out << spline->Weight(index);
          }
        }
        out << "],\"knots\":[";
        for (int index = 1; index <= spline->NbKnots(); index += 1) {
          if (index > 1) {
            out << ",";
          }
          out << spline->Knot(index);
        }
        out << "],\"multiplicities\":[";
        for (int index = 1; index <= spline->NbKnots(); index += 1) {
          if (index > 1) {
            out << ",";
          }
          out << spline->Multiplicity(index);
        }
        out << "],\"parameterRange\":";
        CadaraAppendRangeJson(out, curve.FirstParameter(), curve.LastParameter());
        out << "}";
        return;
      }
      default:
        CadaraAppendExactBrepDiagnostic(
          diagnostics,
          needsDiagnosticComma,
          "occ-native-exact-brep-unsupported-pcurve",
          "Native exact B-rep extractor marked an unsupported 2D trim curve instead of approximating it as exact geometry.",
          bodyId,
          "coedgeCurve2d",
          "coedgeKey",
          coedgeKey + ":" + CadaraCurveTypeName(curveType)
        );
        CadaraAppendUnsupportedCurve2Json(out, CadaraCurveTypeName(curveType));
        return;
    }
  }

  void CadaraAppendSurfaceJson(
    std::ostringstream& out,
    const TopoDS_Face& face,
    const std::string& faceKey,
    const std::string& bodyId,
    std::ostringstream& diagnostics,
    bool& needsDiagnosticComma
  ) {
    BRepAdaptor_Surface surface(face, true);
    const GeomAbs_SurfaceType surfaceType = surface.GetType();

    switch (surfaceType) {
      case GeomAbs_Plane: {
        out << "{\"kind\":\"plane\",\"frame\":";
        CadaraAppendFrameJson(out, surface.Plane().Position());
        out << "}";
        return;
      }
      case GeomAbs_Cylinder: {
        const gp_Cylinder cylinder = surface.Cylinder();
        out << "{\"kind\":\"cylinder\",\"frame\":";
        CadaraAppendFrameJson(out, cylinder.Position());
        out << ",\"radius\":" << cylinder.Radius() << "}";
        return;
      }
      case GeomAbs_Cone: {
        const gp_Cone cone = surface.Cone();
        out << "{\"kind\":\"cone\",\"frame\":";
        CadaraAppendFrameJson(out, cone.Position());
        out
          << ",\"radius\":" << cone.RefRadius()
          << ",\"semiAngleRadians\":" << cone.SemiAngle()
          << "}";
        return;
      }
      case GeomAbs_Sphere: {
        const gp_Sphere sphere = surface.Sphere();
        out << "{\"kind\":\"sphere\",\"frame\":";
        CadaraAppendFrameJson(out, sphere.Position());
        out << ",\"radius\":" << sphere.Radius() << "}";
        return;
      }
      case GeomAbs_Torus: {
        const gp_Torus torus = surface.Torus();
        out << "{\"kind\":\"torus\",\"frame\":";
        CadaraAppendFrameJson(out, torus.Position());
        out
          << ",\"majorRadius\":" << torus.MajorRadius()
          << ",\"minorRadius\":" << torus.MinorRadius()
          << "}";
        return;
      }
      case GeomAbs_BezierSurface: {
        const Handle(Geom_BezierSurface) bezier = surface.Bezier();
        out
          << "{\"kind\":\"bezier\""
          << ",\"uPoleCount\":" << bezier->NbUPoles()
          << ",\"vPoleCount\":" << bezier->NbVPoles()
          << ",\"poles\":[";
        bool needsPoleComma = false;
        for (int u = 1; u <= bezier->NbUPoles(); u += 1) {
          for (int v = 1; v <= bezier->NbVPoles(); v += 1) {
            if (needsPoleComma) {
              out << ",";
            }
            needsPoleComma = true;
            CadaraAppendPoint3Json(out, bezier->Pole(u, v).Transformed(surface.Trsf()));
          }
        }
        if (bezier->IsURational() || bezier->IsVRational()) {
          out << "],\"weights\":[";
          bool needsWeightComma = false;
          for (int u = 1; u <= bezier->NbUPoles(); u += 1) {
            for (int v = 1; v <= bezier->NbVPoles(); v += 1) {
              if (needsWeightComma) {
                out << ",";
              }
              needsWeightComma = true;
              out << bezier->Weight(u, v);
            }
          }
        }
        out << "]}";
        return;
      }
      case GeomAbs_BSplineSurface: {
        const Handle(Geom_BSplineSurface) spline = surface.BSpline();
        out
          << "{\"kind\":\"bSpline\""
          << ",\"uDegree\":" << spline->UDegree()
          << ",\"vDegree\":" << spline->VDegree()
          << ",\"uPeriodic\":" << (spline->IsUPeriodic() ? "true" : "false")
          << ",\"vPeriodic\":" << (spline->IsVPeriodic() ? "true" : "false")
          << ",\"uPoleCount\":" << spline->NbUPoles()
          << ",\"vPoleCount\":" << spline->NbVPoles()
          << ",\"poles\":[";
        bool needsPoleComma = false;
        for (int u = 1; u <= spline->NbUPoles(); u += 1) {
          for (int v = 1; v <= spline->NbVPoles(); v += 1) {
            if (needsPoleComma) {
              out << ",";
            }
            needsPoleComma = true;
            CadaraAppendPoint3Json(out, spline->Pole(u, v).Transformed(surface.Trsf()));
          }
        }
        if (spline->IsURational() || spline->IsVRational()) {
          out << "],\"weights\":[";
          bool needsWeightComma = false;
          for (int u = 1; u <= spline->NbUPoles(); u += 1) {
            for (int v = 1; v <= spline->NbVPoles(); v += 1) {
              if (needsWeightComma) {
                out << ",";
              }
              needsWeightComma = true;
              out << spline->Weight(u, v);
            }
          }
        }
        out << "],\"uKnots\":[";
        for (int index = 1; index <= spline->NbUKnots(); index += 1) {
          if (index > 1) {
            out << ",";
          }
          out << spline->UKnot(index);
        }
        out << "],\"vKnots\":[";
        for (int index = 1; index <= spline->NbVKnots(); index += 1) {
          if (index > 1) {
            out << ",";
          }
          out << spline->VKnot(index);
        }
        out << "],\"uMultiplicities\":[";
        for (int index = 1; index <= spline->NbUKnots(); index += 1) {
          if (index > 1) {
            out << ",";
          }
          out << spline->UMultiplicity(index);
        }
        out << "],\"vMultiplicities\":[";
        for (int index = 1; index <= spline->NbVKnots(); index += 1) {
          if (index > 1) {
            out << ",";
          }
          out << spline->VMultiplicity(index);
        }
        out << "]}";
        return;
      }
      default:
        CadaraAppendExactBrepDiagnostic(
          diagnostics,
          needsDiagnosticComma,
          "occ-native-exact-brep-unsupported-surface",
          "Native exact B-rep extractor marked an unsupported face surface instead of approximating it as exact geometry.",
          bodyId,
          "faceSurface",
          "faceKey",
          faceKey + ":" + CadaraSurfaceTypeName(surfaceType)
        );
        CadaraAppendUnsupportedSurfaceJson(out, CadaraSurfaceTypeName(surfaceType));
        return;
    }
  }

  void CadaraAppendFaceMeshJson(std::ostringstream& out, const TopoDS_Face& face) {
    TopLoc_Location location;
    const Handle_Poly_Triangulation triangulation = BRep_Tool::Triangulation(face, location);

    out << "\"meshVertices\":[";
    if (!triangulation.IsNull()) {
      for (int nodeIndex = 1; nodeIndex <= triangulation->NbNodes(); nodeIndex += 1) {
        if (nodeIndex > 1) {
          out << ",";
        }
        CadaraAppendPoint3Json(out, triangulation->Node(nodeIndex).Transformed(location.Transformation()));
      }
    }

    out << "],\"triangles\":[";
    if (!triangulation.IsNull()) {
      for (int triangleIndex = 1; triangleIndex <= triangulation->NbTriangles(); triangleIndex += 1) {
        if (triangleIndex > 1) {
          out << ",";
        }
        const Poly_Triangle triangle = triangulation->Triangle(triangleIndex);
        const bool isReversed = face.Orientation() == TopAbs_REVERSED;
        out
          << "[" << triangle.Value(1) - 1
          << "," << triangle.Value(isReversed ? 3 : 2) - 1
          << "," << triangle.Value(isReversed ? 2 : 3) - 1
          << "]";
      }
    }
    out << "]";
  }

  std::string CadaraExactTopologyKey(
    const std::string& kind,
    const std::string& bodyId,
    const std::string& topologyToken,
    const int index
  ) {
    return kind + "_" + bodyId + "_" + topologyToken + "_" + std::to_string(index);
  }

  struct CadaraOrderedCoedge {
    TopoDS_Edge edge;
    int edgeIndex;
    int startVertexIndex;
  };

  std::string CadaraBuildExactBrepJson(
    const TopoDS_Shape& shape,
    const std::string& bodyId,
    const std::string& topologyToken
  ) {
    BRepMesh_IncrementalMesh mesher(shape, 0.1, false, 0.5, false);

    TopTools_IndexedMapOfShape solidMap;
    TopTools_IndexedMapOfShape shellMap;
    TopTools_IndexedMapOfShape faceMap;
    TopTools_IndexedMapOfShape wireMap;
    TopTools_IndexedMapOfShape edgeMap;
    TopTools_IndexedMapOfShape vertexMap;

    TopExp::MapShapes(shape, TopAbs_SOLID, solidMap);
    TopExp::MapShapes(shape, TopAbs_SHELL, shellMap);
    TopExp::MapShapes(shape, TopAbs_FACE, faceMap);
    TopExp::MapShapes(shape, TopAbs_WIRE, wireMap);
    TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);
    TopExp::MapShapes(shape, TopAbs_VERTEX, vertexMap);

    std::ostringstream diagnostics;
    bool needsDiagnosticComma = false;

    std::ostringstream out;
    out
      << "{\"schemaVersion\":\"occ-native-topology-payload/v1alpha1\""
      << ",\"source\":\"occt7-shim\""
      << ",\"bodyId\":\"" << CadaraEscapeJson(bodyId) << "\""
      << ",\"topologyToken\":\"" << CadaraEscapeJson(topologyToken) << "\""
      << ",\"counts\":{\"faces\":" << faceMap.Size()
      << ",\"edges\":" << edgeMap.Size()
      << ",\"vertices\":" << vertexMap.Size()
      << "},\"topology\":[]"
      << ",\"edgeVertices\":[]"
      << ",\"vertexPoints\":[]"
      << ",\"faceEdges\":[]"
      << ",\"cadaraBrep\":{\"kind\":\"cadaraBrep\""
      << ",\"schemaVersion\":\"cadara-brep/v1alpha1\""
      << ",\"source\":{\"importedFormat\":\"step\",\"sourceStored\":false}"
      << ",\"bodies\":[{\"bodyKey\":\"" << CadaraEscapeJson(bodyId) << "\""
      << ",\"label\":\"" << CadaraEscapeJson(bodyId) << "\"";

    if (solidMap.Size() > 0) {
      out << ",\"solidKey\":\"" << CadaraEscapeJson(CadaraExactTopologyKey("solid", bodyId, topologyToken, 1)) << "\"";
    }

    out << ",\"topology\":{\"vertices\":[";
    for (int vertexIndex = 1; vertexIndex <= vertexMap.Size(); vertexIndex += 1) {
      if (vertexIndex > 1) {
        out << ",";
      }
      const TopoDS_Vertex vertex = TopoDS::Vertex(vertexMap.FindKey(vertexIndex));
      out << "{\"vertexKey\":\"" << CadaraEscapeJson(CadaraExactTopologyKey("vertex", bodyId, topologyToken, vertexIndex)) << "\",\"point\":";
      CadaraAppendPoint3Json(out, BRep_Tool::Pnt(vertex));
      out << "}";
    }

    out << "],\"edges\":[";
    for (int edgeIndex = 1; edgeIndex <= edgeMap.Size(); edgeIndex += 1) {
      if (edgeIndex > 1) {
        out << ",";
      }
      const TopoDS_Edge edge = TopoDS::Edge(edgeMap.FindKey(edgeIndex).Oriented(TopAbs_FORWARD));
      const TopoDS_Vertex firstVertex = TopExp::FirstVertex(edge, true);
      const TopoDS_Vertex lastVertex = TopExp::LastVertex(edge, true);
      const int firstVertexIndex = CadaraFindShapeIndex(vertexMap, firstVertex);
      const int lastVertexIndex = CadaraFindShapeIndex(vertexMap, lastVertex);
      const std::string edgeKey = CadaraExactTopologyKey("edge", bodyId, topologyToken, edgeIndex);

      out
        << "{\"edgeKey\":\"" << CadaraEscapeJson(edgeKey)
        << "\",\"vertices\":[" << firstVertexIndex - 1 << "," << lastVertexIndex - 1
        << "],\"curve\":";
      CadaraAppendCurve3Json(out, edge, edgeKey, bodyId, diagnostics, needsDiagnosticComma);
      out << "}";
    }

    std::vector<std::vector<int>> faceLoopIndexes(faceMap.Size());
    std::ostringstream coedges;
    std::ostringstream loops;
    int coedgeCount = 0;
    int loopCount = 0;
    bool needsCoedgeComma = false;
    bool needsLoopComma = false;

    for (int faceIndex = 1; faceIndex <= faceMap.Size(); faceIndex += 1) {
      const TopoDS_Face face = TopoDS::Face(faceMap.FindKey(faceIndex));
      for (TopExp_Explorer wireExplorer(face, TopAbs_WIRE); wireExplorer.More(); wireExplorer.Next()) {
        const TopoDS_Wire wire = TopoDS::Wire(wireExplorer.Current());
        std::vector<int> loopCoedgeIndexes;

        std::vector<CadaraOrderedCoedge> orderedCoedges;
        for (BRepTools_WireExplorer orderedWire(wire, face); orderedWire.More(); orderedWire.Next()) {
          const TopoDS_Edge coedge = orderedWire.Current();
          const int edgeIndex = CadaraFindShapeIndex(edgeMap, coedge);
          if (edgeIndex <= 0) {
            continue;
          }
          const int startVertexIndex = CadaraFindShapeIndex(vertexMap, orderedWire.CurrentVertex());
          if (startVertexIndex <= 0) {
            continue;
          }

          orderedCoedges.push_back({coedge, edgeIndex, startVertexIndex});
        }

        for (std::size_t orderedIndex = 0; orderedIndex < orderedCoedges.size(); orderedIndex += 1) {
          const CadaraOrderedCoedge& orderedCoedge = orderedCoedges[orderedIndex];
          const TopoDS_Edge canonicalEdge = TopoDS::Edge(edgeMap.FindKey(orderedCoedge.edgeIndex).Oriented(TopAbs_FORWARD));
          const int canonicalFirstVertexIndex = CadaraFindShapeIndex(vertexMap, TopExp::FirstVertex(canonicalEdge, true));
          const int canonicalLastVertexIndex = CadaraFindShapeIndex(vertexMap, TopExp::LastVertex(canonicalEdge, true));
          const int traversalFirstVertexIndex = orderedCoedge.startVertexIndex;
          const int traversalLastVertexIndex = orderedCoedges[(orderedIndex + 1) % orderedCoedges.size()].startVertexIndex;
          const bool matchesForward = traversalFirstVertexIndex == canonicalFirstVertexIndex
            && traversalLastVertexIndex == canonicalLastVertexIndex;
          const bool matchesReverse = traversalFirstVertexIndex == canonicalLastVertexIndex
            && traversalLastVertexIndex == canonicalFirstVertexIndex;
          const bool reversed = !matchesForward && matchesReverse;

          if (needsCoedgeComma) {
            coedges << ",";
          }
          needsCoedgeComma = true;
          coedgeCount += 1;
          loopCoedgeIndexes.push_back(coedgeCount - 1);
          const std::string coedgeKey = CadaraExactTopologyKey("coedge", bodyId, topologyToken, coedgeCount);

          if (!matchesForward && !matchesReverse) {
            CadaraAppendExactBrepDiagnostic(
              diagnostics,
              needsDiagnosticComma,
              "occ-native-exact-brep-disconnected-coedge",
              "Native exact B-rep extractor found a wire coedge whose traversal vertices do not match its canonical edge vertices.",
              bodyId,
              "coedge",
              "coedgeKey",
              coedgeKey
            );
          }

          coedges
            << "{\"coedgeKey\":\"" << CadaraEscapeJson(coedgeKey)
            << "\",\"edgeIndex\":" << orderedCoedge.edgeIndex - 1
            << ",\"reversed\":" << (reversed ? "true" : "false")
            << ",\"curve2d\":";
          CadaraAppendCurve2dJson(coedges, orderedCoedge.edge, face, coedgeKey, bodyId, diagnostics, needsDiagnosticComma);
          coedges << "}";
        }

        if (loopCoedgeIndexes.empty()) {
          continue;
        }

        if (needsLoopComma) {
          loops << ",";
        }
        needsLoopComma = true;
        loopCount += 1;
        faceLoopIndexes[faceIndex - 1].push_back(loopCount - 1);
        loops << "{\"loopKey\":\"" << CadaraEscapeJson(CadaraExactTopologyKey("loop", bodyId, topologyToken, loopCount)) << "\",\"coedgeIndices\":[";
        for (std::size_t index = 0; index < loopCoedgeIndexes.size(); index += 1) {
          if (index > 0) {
            loops << ",";
          }
          loops << loopCoedgeIndexes[index];
        }
        loops << "]}";
      }
    }

    out << "],\"coedges\":[" << coedges.str() << "],\"loops\":[" << loops.str() << "],\"faces\":[";
    for (int faceIndex = 1; faceIndex <= faceMap.Size(); faceIndex += 1) {
      if (faceIndex > 1) {
        out << ",";
      }
      const TopoDS_Face face = TopoDS::Face(faceMap.FindKey(faceIndex));
      const std::string faceKey = CadaraExactTopologyKey("face", bodyId, topologyToken, faceIndex);
      out << "{\"faceKey\":\"" << CadaraEscapeJson(faceKey) << "\",\"loopIndices\":[";
      for (std::size_t loopIndex = 0; loopIndex < faceLoopIndexes[faceIndex - 1].size(); loopIndex += 1) {
        if (loopIndex > 0) {
          out << ",";
        }
        out << faceLoopIndexes[faceIndex - 1][loopIndex];
      }
      out << "],\"surface\":";
      CadaraAppendSurfaceJson(out, face, faceKey, bodyId, diagnostics, needsDiagnosticComma);
      out << ",";
      CadaraAppendFaceMeshJson(out, face);
      out << "}";
    }

    out << "],\"shells\":[";
    for (int shellIndex = 1; shellIndex <= shellMap.Size(); shellIndex += 1) {
      if (shellIndex > 1) {
        out << ",";
      }
      const TopoDS_Shell shell = TopoDS::Shell(shellMap.FindKey(shellIndex));
      out << "{\"shellKey\":\"" << CadaraEscapeJson(CadaraExactTopologyKey("shell", bodyId, topologyToken, shellIndex)) << "\",\"faceIndices\":[";
      bool needsFaceComma = false;
      for (TopExp_Explorer faceExplorer(shell, TopAbs_FACE); faceExplorer.More(); faceExplorer.Next()) {
        const int faceIndex = CadaraFindShapeIndex(faceMap, faceExplorer.Current());
        if (faceIndex <= 0) {
          continue;
        }
        if (needsFaceComma) {
          out << ",";
        }
        needsFaceComma = true;
        out << faceIndex - 1;
      }
      out << "],\"closed\":true}";
    }

    out << "],\"solids\":[";
    for (int solidIndex = 1; solidIndex <= solidMap.Size(); solidIndex += 1) {
      if (solidIndex > 1) {
        out << ",";
      }
      const TopoDS_Solid solid = TopoDS::Solid(solidMap.FindKey(solidIndex));
      out << "{\"solidKey\":\"" << CadaraEscapeJson(CadaraExactTopologyKey("solid", bodyId, topologyToken, solidIndex)) << "\",\"shellIndices\":[";
      bool needsShellComma = false;
      for (TopExp_Explorer shellExplorer(solid, TopAbs_SHELL); shellExplorer.More(); shellExplorer.Next()) {
        const int shellIndex = CadaraFindShapeIndex(shellMap, shellExplorer.Current());
        if (shellIndex <= 0) {
          continue;
        }
        if (needsShellComma) {
          out << ",";
        }
        needsShellComma = true;
        out << shellIndex - 1;
      }
      out << "]}";
    }

    out << "]}}]}"
      << ",\"diagnostics\":";
    CadaraAppendValidationDiagnostics(out, shape, bodyId, diagnostics.str());
    out << "}";
    return out.str();
  }
}
