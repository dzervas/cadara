import type {
  CadaraBrepCoedgeRecord,
  CadaraBrepCurve2Record,
  CadaraBrepCurve3Record,
  CadaraBrepFaceRecord,
  CadaraBrepGeometryAssetBody,
  CadaraBrepSurfaceFrameRecord,
  CadaraBrepSurfaceRecord,
  GeometryAssetPoint2,
  GeometryAssetPoint3,
} from '@/contracts/modeling/geometry-assets'
import { createCadaraFacetedBrepTopologyFromTriangles } from '@/contracts/modeling/geometry-assets'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import { deleteOccObject } from '@/domain/modeling/occ/memory'
import { isOccEnumValue, describeOccEnumValue } from '@/domain/modeling/occ/features/shared'

export function createCadaraBrepTopologyFromShape(
  oc: OpenCascadeInstance,
  solid: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  keyPrefix: string,
) {
  try {
    return createCadaraExactBrepTopologyFromShape(oc, solid, keyPrefix)
  } catch (error) {
    if (!isRecoverableCadaraExactBrepFallbackError(error)) {
      throw error
    }

    try {
      return createCadaraExactBrepTopologyFromNurbsShape(oc, solid, keyPrefix)
    } catch (nurbsError) {
      if (!isRecoverableCadaraExactBrepFallbackError(nurbsError)) {
        throw nurbsError
      }
    }

    return createCadaraFacetedBrepTopologyFromTriangles(
      extractFacetedTrianglesFromShape(oc, solid),
      keyPrefix,
    )
  }
}

function isRecoverableCadaraExactBrepFallbackError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes('unsupported face surface type')
    || error.message.includes('unsupported edge curve type')
    || error.message.includes('unsupported basis curve type')
    || error.message.includes('unsupported non-analytic trimming curves')
}

function createCadaraExactBrepTopologyFromNurbsShape(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  keyPrefix: string,
) {
  const converter = new oc.BRepBuilderAPI_NurbsConvert_2(shape, true)
  if (!converter.IsDone()) {
    throw new Error('Translated STEP solid could not be converted to a NURBS-backed exact Cadara B-rep shape.')
  }
  return createCadaraExactBrepTopologyFromShape(oc, converter.Shape(), keyPrefix)
}

function createCadaraExactBrepTopologyFromShape(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  keyPrefix: string,
) {
  const mesher = new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false)
  const vertexMap = new oc.TopTools_IndexedMapOfShape_1()
  const edgeMap = new oc.TopTools_IndexedMapOfShape_1()
  const faceMap = new oc.TopTools_IndexedMapOfShape_1()
  const shellMap = new oc.TopTools_IndexedMapOfShape_1()
  const solidMap = new oc.TopTools_IndexedMapOfShape_1()
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never, vertexMap)
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE as never, edgeMap)
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE as never, faceMap)
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_SHELL as never, shellMap)
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID as never, solidMap)

  try {
    const vertices: CadaraBrepGeometryAssetBody['topology']['vertices'] = []
    for (let vertexIndex = 1; vertexIndex <= vertexMap.Size(); vertexIndex += 1) {
      const vertex = oc.TopoDS.Vertex_1(vertexMap.FindKey(vertexIndex))
      vertices.push({
        vertexKey: `${keyPrefix}_vertex_${vertexIndex}`,
        point: pointToGeometryAssetPoint(oc.BRep_Tool.Pnt(vertex)),
      })
    }

    const edges: CadaraBrepGeometryAssetBody['topology']['edges'] = []
    for (let edgeIndex = 1; edgeIndex <= edgeMap.Size(); edgeIndex += 1) {
      const edge = oc.TopoDS.Edge_1(edgeMap.FindKey(edgeIndex))
      if (oc.BRep_Tool.Degenerated(edge)) {
        throw new Error('Translated STEP solid contains degenerated analytic edges that Cadara B-rep v1alpha1 cannot persist exactly yet.')
      }
      edges.push({
        edgeKey: `${keyPrefix}_edge_${edgeIndex}`,
        vertices: getEdgeVertexPair(oc, edge, vertexMap),
        curve: extractCadaraBrepEdgeCurve(oc, edge),
      })
    }

    const coedges: CadaraBrepCoedgeRecord[] = []
    const loops: CadaraBrepGeometryAssetBody['topology']['loops'] = []
    const faces: CadaraBrepFaceRecord[] = []
    for (let faceIndex = 1; faceIndex <= faceMap.Size(); faceIndex += 1) {
      const face = oc.TopoDS.Face_1(faceMap.FindKey(faceIndex))
      const outerWire = oc.BRepTools.OuterWire(face)
      const wireExplorer = new oc.TopExp_Explorer_2(
        face,
        oc.TopAbs_ShapeEnum.TopAbs_WIRE as never,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
      )
      const loopIndices: number[] = []

      const wireEntries: Array<{ wire: InstanceType<OpenCascadeInstance['TopoDS_Wire']>; outer: boolean }> = []
      while (wireExplorer.More()) {
        const wire = oc.TopoDS.Wire_1(wireExplorer.Current())
        wireEntries.push({ wire, outer: wire.IsSame(outerWire) })
        wireExplorer.Next()
      }

      for (const { wire } of wireEntries.sort((left, right) => Number(right.outer) - Number(left.outer))) {
        const boundaryExplorer = new oc.BRepTools_WireExplorer_3(wire, face)
        const coedgeIndices: number[] = []
        while (boundaryExplorer.More()) {
          const coedgeEdge = oc.TopoDS.Edge_1(boundaryExplorer.Current())
          const coedgeIndex = coedges.length
          const canonicalEdge = oc.TopoDS.Edge_1(
            coedgeEdge.Oriented(oc.TopAbs_Orientation.TopAbs_FORWARD as never),
          )
          coedges.push({
            coedgeKey: `${keyPrefix}_coedge_${coedgeIndex + 1}`,
            edgeIndex: edgeMap.FindIndex(canonicalEdge) - 1,
            reversed: isShapeOrientationReversed(oc, coedgeEdge),
            curve2d: extractCadaraBrepCoedgeCurve2d(oc, coedgeEdge, face),
          })
          coedgeIndices.push(coedgeIndex)
          boundaryExplorer.Next()
        }
        if (coedgeIndices.length === 0) {
          continue
        }
        const loopIndex = loops.length
        loops.push({
          loopKey: `${keyPrefix}_loop_${loopIndex + 1}`,
          coedgeIndices,
        })
        loopIndices.push(loopIndex)
      }

      const mesh = extractCadaraBrepFaceMesh(oc, face)
      if (mesh.triangles.length === 0) {
        throw new Error('Translated STEP face did not produce tessellated fallback triangles.')
      }
      faces.push({
        faceKey: `${keyPrefix}_face_${faceIndex}`,
        loopIndices,
        surface: extractCadaraBrepSurface(oc, face),
        meshVertices: mesh.vertices,
        triangles: mesh.triangles,
      })
    }

    const shells: CadaraBrepGeometryAssetBody['topology']['shells'] = []
    for (let shellIndex = 1; shellIndex <= shellMap.Size(); shellIndex += 1) {
      const shell = oc.TopoDS.Shell_1(shellMap.FindKey(shellIndex))
      const containedFaceIndices = collectIndexedSubshapeIndices(oc, shell, faceMap, oc.TopAbs_ShapeEnum.TopAbs_FACE)
      shells.push({
        shellKey: `${keyPrefix}_shell_${shellIndex}`,
        faceIndices: containedFaceIndices,
        closed: Boolean(oc.BRep_Tool.IsClosed_1(shell)),
      })
    }

    const solids: CadaraBrepGeometryAssetBody['topology']['solids'] = []
    for (let solidIndex = 1; solidIndex <= solidMap.Size(); solidIndex += 1) {
      const solid = oc.TopoDS.Solid_1(solidMap.FindKey(solidIndex))
      solids.push({
        solidKey: `${keyPrefix}_solid_${solidIndex}`,
        shellIndices: collectIndexedSubshapeIndices(oc, solid, shellMap, oc.TopAbs_ShapeEnum.TopAbs_SHELL),
      })
    }

    if (faces.length === 0 || solids.length === 0) {
      throw new Error('Translated STEP solid did not produce exact Cadara B-rep topology.')
    }

    return {
      vertices,
      edges,
      coedges,
      loops,
      faces,
      shells,
      solids,
    }
  } finally {
    deleteOccObject(mesher)
    vertexMap.delete()
    edgeMap.delete()
    faceMap.delete()
    shellMap.delete()
    solidMap.delete()
  }
}

function collectIndexedSubshapeIndices(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  map: InstanceType<OpenCascadeInstance['TopTools_IndexedMapOfShape']>,
  kind: OpenCascadeInstance['TopAbs_ShapeEnum'][keyof OpenCascadeInstance['TopAbs_ShapeEnum']],
) {
  const explorer = new oc.TopExp_Explorer_2(
    shape,
    kind as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
  )
  const indices: number[] = []
  while (explorer.More()) {
    indices.push(map.FindIndex(explorer.Current()) - 1)
    explorer.Next()
  }
  return indices
}

function getEdgeVertexPair(
  oc: OpenCascadeInstance,
  edge: InstanceType<OpenCascadeInstance['TopoDS_Edge']>,
  vertexMap: InstanceType<OpenCascadeInstance['TopTools_IndexedMapOfShape']>,
): [number, number] {
  const firstVertex = oc.TopExp.FirstVertex(edge, true)
  const lastVertex = oc.TopExp.LastVertex(edge, true)
  return [vertexMap.FindIndex(firstVertex) - 1, vertexMap.FindIndex(lastVertex) - 1]
}

function extractCadaraBrepSurface(
  oc: OpenCascadeInstance,
  face: InstanceType<OpenCascadeInstance['TopoDS_Face']>,
): CadaraBrepSurfaceRecord {
  const surface = new oc.BRepAdaptor_Surface_2(face, true)
  try {
    const type = surface.GetType()
    if (isOccEnumValue(type, oc.GeomAbs_SurfaceType.GeomAbs_Plane)) {
      return {
        kind: 'plane',
        frame: frameFromAx3(surface.Plane().Position()),
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_SurfaceType.GeomAbs_Cylinder)) {
      const cylinder = surface.Cylinder()
      return {
        kind: 'cylinder',
        frame: frameFromAx3(cylinder.Position()),
        radius: normalizeOccNumber(cylinder.Radius()),
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_SurfaceType.GeomAbs_Cone)) {
      const cone = surface.Cone()
      return {
        kind: 'cone',
        frame: frameFromAx3(cone.Position()),
        radius: normalizeOccNumber(cone.RefRadius()),
        semiAngleRadians: normalizeOccNumber(cone.SemiAngle()),
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_SurfaceType.GeomAbs_Sphere)) {
      const sphere = surface.Sphere()
      return {
        kind: 'sphere',
        frame: frameFromAx3(sphere.Position()),
        radius: normalizeOccNumber(sphere.Radius()),
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_SurfaceType.GeomAbs_Torus)) {
      const torus = surface.Torus()
      return {
        kind: 'torus',
        frame: frameFromAx3(torus.Position()),
        majorRadius: normalizeOccNumber(torus.MajorRadius()),
        minorRadius: normalizeOccNumber(torus.MinorRadius()),
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_SurfaceType.GeomAbs_SurfaceOfRevolution)) {
      return extractCadaraBrepSurfaceOfRevolution(oc, surface.BasisCurve(), surface.AxeOfRevolution())
    }
    if (isOccEnumValue(type, oc.GeomAbs_SurfaceType.GeomAbs_SurfaceOfExtrusion)) {
      return extractCadaraBrepSurfaceOfLinearExtrusion(oc, surface.BasisCurve(), surface.Direction())
    }
    if (isOccEnumValue(type, oc.GeomAbs_SurfaceType.GeomAbs_BezierSurface)) {
      return extractCadaraBrepBezierSurface(surface.Bezier())
    }
    if (isOccEnumValue(type, oc.GeomAbs_SurfaceType.GeomAbs_BSplineSurface)) {
      return extractCadaraBrepBSplineSurface(surface.BSpline())
    }
    throw new Error(`Translated STEP solid contains unsupported face surface type ${describeOccEnumValue(oc.GeomAbs_SurfaceType, type)}; exact Cadara B-rep persistence currently supports planes, cylinders, cones, spheres, tori, surfaces of revolution, surfaces of extrusion, Bezier surfaces, and BSpline surfaces.`)
  } finally {
    surface.delete()
  }
}

function extractCadaraBrepEdgeCurve(
  oc: OpenCascadeInstance,
  edge: InstanceType<OpenCascadeInstance['TopoDS_Edge']>,
): CadaraBrepCurve3Record {
  const curve = new oc.BRepAdaptor_Curve_2(edge)
  try {
    const parameterRange = curveParameterRange(curve.FirstParameter(), curve.LastParameter())
    const type = curve.GetType()
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_Line)) {
      const line = curve.Line()
      return {
        kind: 'line',
        origin: pointToGeometryAssetPoint(line.Location()),
        direction: directionToGeometryAssetPoint(line.Direction()),
        parameterRange,
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_Circle)) {
      const circle = curve.Circle()
      return {
        kind: 'circle',
        center: pointToGeometryAssetPoint(circle.Location()),
        axisDirection: directionToGeometryAssetPoint(circle.Axis().Direction()),
        xDirection: directionToGeometryAssetPoint(circle.Position().XDirection()),
        radius: normalizeOccNumber(circle.Radius()),
        parameterRange,
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_Ellipse)) {
      const ellipse = curve.Ellipse()
      return {
        kind: 'ellipse',
        center: pointToGeometryAssetPoint(ellipse.Location()),
        axisDirection: directionToGeometryAssetPoint(ellipse.Axis().Direction()),
        xDirection: directionToGeometryAssetPoint(ellipse.Position().XDirection()),
        majorRadius: normalizeOccNumber(ellipse.MajorRadius()),
        minorRadius: normalizeOccNumber(ellipse.MinorRadius()),
        parameterRange,
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_BezierCurve)) {
      return extractCadaraBrepBezierCurve3(curve.Bezier(), parameterRange)
    }
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_BSplineCurve)) {
      return extractCadaraBrepBSplineCurve3(curve.BSpline(), parameterRange)
    }
    throw new Error(`Translated STEP solid contains unsupported edge curve type ${describeOccEnumValue(oc.GeomAbs_CurveType, type)}; exact Cadara B-rep persistence currently supports lines, circles, ellipses, Bezier curves, and BSpline curves.`)
  } finally {
    curve.delete()
  }
}

function extractCadaraBrepCoedgeCurve2d(
  oc: OpenCascadeInstance,
  edge: InstanceType<OpenCascadeInstance['TopoDS_Edge']>,
  face: InstanceType<OpenCascadeInstance['TopoDS_Face']>,
): CadaraBrepCurve2Record {
  const curve = new oc.BRepAdaptor_Curve2d_2(edge, face)
  try {
    const firstParameter = curve.FirstParameter()
    const lastParameter = curve.LastParameter()
    const parameterRange = curveParameterRange(firstParameter, lastParameter)
    const type = curve.GetType()
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_Line)) {
      const line = curve.Line()
      return {
        kind: 'line',
        origin: point2ToGeometryAssetPoint(line.Location()),
        direction: direction2ToGeometryAssetPoint(line.Direction()),
        parameterRange,
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_Circle)) {
      const circle = curve.Circle()
      return {
        kind: 'circle',
        center: point2ToGeometryAssetPoint(circle.Location()),
        xDirection: direction2ToGeometryAssetPoint(circle.Position().XDirection()),
        radius: normalizeOccNumber(circle.Radius()),
        parameterRange,
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_Ellipse)) {
      const ellipse = curve.Ellipse()
      return {
        kind: 'ellipse',
        center: point2ToGeometryAssetPoint(ellipse.Location()),
        xDirection: direction2ToGeometryAssetPoint(ellipse.XAxis().Direction()),
        majorRadius: normalizeOccNumber(ellipse.MajorRadius()),
        minorRadius: normalizeOccNumber(ellipse.MinorRadius()),
        parameterRange,
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_BezierCurve)) {
      return extractCadaraBrepBezierCurve2(curve.Bezier(), parameterRange)
    }
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_BSplineCurve)) {
      return extractCadaraBrepBSplineCurve2(curve.BSpline(), parameterRange)
    }
    const sampleCount = 8
    const points = Array.from({ length: sampleCount + 1 }, (_unused, index) => {
      const parameter = firstParameter + ((lastParameter - firstParameter) * index) / sampleCount
      return point2ToGeometryAssetPoint(curve.Value(parameter))
    })
    return {
      kind: 'polyline',
      points,
      parameterRange,
    }
  } finally {
    curve.delete()
  }
}

function extractCadaraBrepBezierSurface(
  surfaceHandle: {
    get(): {
      NbUPoles(): number
      NbVPoles(): number
      Pole(u: number, v: number): { X(): number; Y(): number; Z(): number }
      IsURational(): boolean
      IsVRational(): boolean
      Weight(u: number, v: number): number
    }
    delete?(): void
  },
): CadaraBrepSurfaceRecord {
  try {
    const surface = surfaceHandle.get()
    const uPoleCount = surface.NbUPoles()
    const vPoleCount = surface.NbVPoles()
    const poles: GeometryAssetPoint3[] = []
    const weights: number[] = []
    const rational = surface.IsURational() || surface.IsVRational()
    for (let u = 1; u <= uPoleCount; u += 1) {
      for (let v = 1; v <= vPoleCount; v += 1) {
        poles.push(pointToGeometryAssetPoint(surface.Pole(u, v)))
        if (rational) {
          weights.push(normalizeOccNumber(surface.Weight(u, v)))
        }
      }
    }
    return {
      kind: 'bezier',
      uPoleCount,
      vPoleCount,
      poles,
      ...(rational ? { weights } : {}),
    }
  } finally {
    deleteOccObject(surfaceHandle)
  }
}

function extractCadaraBrepSurfaceOfRevolution(
  oc: OpenCascadeInstance,
  basisCurveHandle: { get(): unknown; delete?(): void },
  axis: { Location(): { X(): number; Y(): number; Z(): number }; Direction(): { X(): number; Y(): number; Z(): number } },
): CadaraBrepSurfaceRecord {
  return {
    kind: 'surfaceOfRevolution',
    axisOrigin: pointToGeometryAssetPoint(axis.Location()),
    axisDirection: directionToGeometryAssetPoint(axis.Direction()),
    basisCurve: extractCadaraBrepGeomCurve3Handle(oc, basisCurveHandle),
  }
}

function extractCadaraBrepSurfaceOfLinearExtrusion(
  oc: OpenCascadeInstance,
  basisCurveHandle: { get(): unknown; delete?(): void },
  direction: { X(): number; Y(): number; Z(): number },
): CadaraBrepSurfaceRecord {
  return {
    kind: 'surfaceOfLinearExtrusion',
    direction: directionToGeometryAssetPoint(direction),
    basisCurve: extractCadaraBrepGeomCurve3Handle(oc, basisCurveHandle),
  }
}

function extractCadaraBrepGeomCurve3Handle(
  oc: OpenCascadeInstance,
  curveHandle: { get(): unknown; delete?(): void },
): CadaraBrepCurve3Record {
  const curve = curveHandle.get() as {
    FirstParameter(): number
    LastParameter(): number
    GetType(): unknown
    Line(): {
      Location(): { X(): number; Y(): number; Z(): number }
      Direction(): { X(): number; Y(): number; Z(): number }
    }
    Circle(): {
      Location(): { X(): number; Y(): number; Z(): number }
      Axis(): { Direction(): { X(): number; Y(): number; Z(): number } }
      Position(): { XDirection(): { X(): number; Y(): number; Z(): number } }
      Radius(): number
    }
    Ellipse(): {
      Location(): { X(): number; Y(): number; Z(): number }
      Axis(): { Direction(): { X(): number; Y(): number; Z(): number } }
      Position(): { XDirection(): { X(): number; Y(): number; Z(): number } }
      MajorRadius(): number
      MinorRadius(): number
    }
    Bezier(): {
      get(): {
        NbPoles(): number
        Pole(index: number): { X(): number; Y(): number; Z(): number }
        IsRational(): boolean
        Weight(index: number): number
      }
      delete?(): void
    }
    BSpline(): {
      get(): {
        Degree(): number
        IsPeriodic(): boolean
        NbPoles(): number
        Pole(index: number): { X(): number; Y(): number; Z(): number }
        IsRational(): boolean
        Weight(index: number): number
        NbKnots(): number
        Knot(index: number): number
        Multiplicity(index: number): number
      }
      delete?(): void
    }
  }
  try {
    const parameterRange = curveParameterRange(curve.FirstParameter(), curve.LastParameter())
    const type = curve.GetType()
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_Line)) {
      const line = curve.Line()
      return {
        kind: 'line',
        origin: pointToGeometryAssetPoint(line.Location()),
        direction: directionToGeometryAssetPoint(line.Direction()),
        parameterRange,
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_Circle)) {
      const circle = curve.Circle()
      return {
        kind: 'circle',
        center: pointToGeometryAssetPoint(circle.Location()),
        axisDirection: directionToGeometryAssetPoint(circle.Axis().Direction()),
        xDirection: directionToGeometryAssetPoint(circle.Position().XDirection()),
        radius: normalizeOccNumber(circle.Radius()),
        parameterRange,
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_Ellipse)) {
      const ellipse = curve.Ellipse()
      return {
        kind: 'ellipse',
        center: pointToGeometryAssetPoint(ellipse.Location()),
        axisDirection: directionToGeometryAssetPoint(ellipse.Axis().Direction()),
        xDirection: directionToGeometryAssetPoint(ellipse.Position().XDirection()),
        majorRadius: normalizeOccNumber(ellipse.MajorRadius()),
        minorRadius: normalizeOccNumber(ellipse.MinorRadius()),
        parameterRange,
      }
    }
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_BezierCurve)) {
      return extractCadaraBrepBezierCurve3(curve.Bezier(), parameterRange)
    }
    if (isOccEnumValue(type, oc.GeomAbs_CurveType.GeomAbs_BSplineCurve)) {
      return extractCadaraBrepBSplineCurve3(curve.BSpline(), parameterRange)
    }
    throw new Error(`Translated STEP solid contains unsupported basis curve type ${describeOccEnumValue(oc.GeomAbs_CurveType, type)} on an exact imported surface.`)
  } finally {
    deleteOccObject(curveHandle)
  }
}

function extractCadaraBrepBSplineSurface(
  surfaceHandle: {
    get(): {
      NbUPoles(): number
      NbVPoles(): number
      Pole(u: number, v: number): { X(): number; Y(): number; Z(): number }
      IsURational(): boolean
      IsVRational(): boolean
      Weight(u: number, v: number): number
      UDegree(): number
      VDegree(): number
      IsUPeriodic(): boolean
      IsVPeriodic(): boolean
      NbUKnots(): number
      NbVKnots(): number
      UKnot(index: number): number
      VKnot(index: number): number
      UMultiplicity(index: number): number
      VMultiplicity(index: number): number
    }
    delete?(): void
  },
): CadaraBrepSurfaceRecord {
  try {
    const surface = surfaceHandle.get()
    const uPoleCount = surface.NbUPoles()
    const vPoleCount = surface.NbVPoles()
    const poles: GeometryAssetPoint3[] = []
    const weights: number[] = []
    const rational = surface.IsURational() || surface.IsVRational()
    for (let u = 1; u <= uPoleCount; u += 1) {
      for (let v = 1; v <= vPoleCount; v += 1) {
        poles.push(pointToGeometryAssetPoint(surface.Pole(u, v)))
        if (rational) {
          weights.push(normalizeOccNumber(surface.Weight(u, v)))
        }
      }
    }
    return {
      kind: 'bSpline',
      uDegree: surface.UDegree(),
      vDegree: surface.VDegree(),
      uPeriodic: surface.IsUPeriodic(),
      vPeriodic: surface.IsVPeriodic(),
      uPoleCount,
      vPoleCount,
      poles,
      ...(rational ? { weights } : {}),
      uKnots: Array.from({ length: surface.NbUKnots() }, (_unused, index) => normalizeOccNumber(surface.UKnot(index + 1))),
      vKnots: Array.from({ length: surface.NbVKnots() }, (_unused, index) => normalizeOccNumber(surface.VKnot(index + 1))),
      uMultiplicities: Array.from({ length: surface.NbUKnots() }, (_unused, index) => surface.UMultiplicity(index + 1)),
      vMultiplicities: Array.from({ length: surface.NbVKnots() }, (_unused, index) => surface.VMultiplicity(index + 1)),
    }
  } finally {
    deleteOccObject(surfaceHandle)
  }
}

function extractCadaraBrepBezierCurve3(
  curveHandle: {
    get(): {
      NbPoles(): number
      Pole(index: number): { X(): number; Y(): number; Z(): number }
      IsRational(): boolean
      Weight(index: number): number
    }
    delete?(): void
  },
  parameterRange: readonly [number, number],
): CadaraBrepCurve3Record {
  try {
    const curve = curveHandle.get()
    const poleCount = curve.NbPoles()
    const poles = Array.from({ length: poleCount }, (_unused, index) =>
      pointToGeometryAssetPoint(curve.Pole(index + 1)),
    )
    const rational = curve.IsRational()
    return {
      kind: 'bezier',
      poles,
      ...(rational ? { weights: Array.from({ length: poleCount }, (_unused, index) => normalizeOccNumber(curve.Weight(index + 1))) } : {}),
      parameterRange,
    }
  } finally {
    deleteOccObject(curveHandle)
  }
}

function extractCadaraBrepBSplineCurve3(
  curveHandle: {
    get(): {
      Degree(): number
      IsPeriodic(): boolean
      NbPoles(): number
      Pole(index: number): { X(): number; Y(): number; Z(): number }
      IsRational(): boolean
      Weight(index: number): number
      NbKnots(): number
      Knot(index: number): number
      Multiplicity(index: number): number
    }
    delete?(): void
  },
  parameterRange: readonly [number, number],
): CadaraBrepCurve3Record {
  try {
    const curve = curveHandle.get()
    const poleCount = curve.NbPoles()
    const knotCount = curve.NbKnots()
    const rational = curve.IsRational()
    return {
      kind: 'bSpline',
      degree: curve.Degree(),
      periodic: curve.IsPeriodic(),
      poles: Array.from({ length: poleCount }, (_unused, index) => pointToGeometryAssetPoint(curve.Pole(index + 1))),
      ...(rational ? { weights: Array.from({ length: poleCount }, (_unused, index) => normalizeOccNumber(curve.Weight(index + 1))) } : {}),
      knots: Array.from({ length: knotCount }, (_unused, index) => normalizeOccNumber(curve.Knot(index + 1))),
      multiplicities: Array.from({ length: knotCount }, (_unused, index) => curve.Multiplicity(index + 1)),
      parameterRange,
    }
  } finally {
    deleteOccObject(curveHandle)
  }
}

function extractCadaraBrepBezierCurve2(
  curveHandle: {
    get(): {
      NbPoles(): number
      Pole(index: number): { X(): number; Y(): number }
      IsRational(): boolean
      Weight(index: number): number
    }
    delete?(): void
  },
  parameterRange: readonly [number, number],
): CadaraBrepCurve2Record {
  try {
    const curve = curveHandle.get()
    const poleCount = curve.NbPoles()
    const poles = Array.from({ length: poleCount }, (_unused, index) =>
      point2ToGeometryAssetPoint(curve.Pole(index + 1)),
    )
    const rational = curve.IsRational()
    return {
      kind: 'bezier',
      poles,
      ...(rational ? { weights: Array.from({ length: poleCount }, (_unused, index) => normalizeOccNumber(curve.Weight(index + 1))) } : {}),
      parameterRange,
    }
  } finally {
    deleteOccObject(curveHandle)
  }
}

function extractCadaraBrepBSplineCurve2(
  curveHandle: {
    get(): {
      Degree(): number
      IsPeriodic(): boolean
      NbPoles(): number
      Pole(index: number): { X(): number; Y(): number }
      IsRational(): boolean
      Weight(index: number): number
      NbKnots(): number
      Knot(index: number): number
      Multiplicity(index: number): number
    }
    delete?(): void
  },
  parameterRange: readonly [number, number],
): CadaraBrepCurve2Record {
  try {
    const curve = curveHandle.get()
    const poleCount = curve.NbPoles()
    const knotCount = curve.NbKnots()
    const rational = curve.IsRational()
    return {
      kind: 'bSpline',
      degree: curve.Degree(),
      periodic: curve.IsPeriodic(),
      poles: Array.from({ length: poleCount }, (_unused, index) => point2ToGeometryAssetPoint(curve.Pole(index + 1))),
      ...(rational ? { weights: Array.from({ length: poleCount }, (_unused, index) => normalizeOccNumber(curve.Weight(index + 1))) } : {}),
      knots: Array.from({ length: knotCount }, (_unused, index) => normalizeOccNumber(curve.Knot(index + 1))),
      multiplicities: Array.from({ length: knotCount }, (_unused, index) => curve.Multiplicity(index + 1)),
      parameterRange,
    }
  } finally {
    deleteOccObject(curveHandle)
  }
}

function extractCadaraBrepFaceMesh(
  oc: OpenCascadeInstance,
  face: InstanceType<OpenCascadeInstance['TopoDS_Face']>,
) {
  const location = new oc.TopLoc_Location_1()
  const triangulationHandle = oc.BRep_Tool.Triangulation(face, location, 0 as never)
  if (triangulationHandle.IsNull()) {
    return { vertices: [] as GeometryAssetPoint3[], triangles: [] as Array<[number, number, number]> }
  }

  const triangulation = triangulationHandle.get()
  const vertices = Array.from({ length: triangulation.NbNodes() }, (_unused, index) =>
    pointFromTriangulationNode(triangulation.Node(index + 1), location),
  )
  const reversed = isShapeOrientationReversed(oc, face)
  const triangles = Array.from({ length: triangulation.NbTriangles() }, (_unused, index) => {
    const triangle = triangulation.Triangle(index + 1)
    const first = triangle.Value(1) - 1
    const second = triangle.Value(2) - 1
    const third = triangle.Value(3) - 1
    return reversed ? [first, third, second] as const : [first, second, third] as const
  })
  return { vertices, triangles }
}

function extractFacetedTrianglesFromShape(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const mesher = new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false)
  const faceMap = new oc.TopTools_IndexedMapOfShape_1()
  try {
    oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE as never, faceMap)
    const triangles: Array<readonly [GeometryAssetPoint3, GeometryAssetPoint3, GeometryAssetPoint3]> = []
    for (let index = 1; index <= faceMap.Size(); index += 1) {
      const face = oc.TopoDS.Face_1(faceMap.FindKey(index))
      const location = new oc.TopLoc_Location_1()
      const triangulationHandle = oc.BRep_Tool.Triangulation(face, location, 0 as never)
      if (triangulationHandle.IsNull()) {
        continue
      }

      const triangulation = triangulationHandle.get()
      const reversed = isShapeOrientationReversed(oc, face)
      for (let triangleIndex = 1; triangleIndex <= triangulation.NbTriangles(); triangleIndex += 1) {
        const triangle = triangulation.Triangle(triangleIndex)
        const first = pointFromTriangulationNode(triangulation.Node(triangle.Value(1)), location)
        const second = pointFromTriangulationNode(triangulation.Node(triangle.Value(2)), location)
        const third = pointFromTriangulationNode(triangulation.Node(triangle.Value(3)), location)
        triangles.push(reversed ? [first, third, second] : [first, second, third])
      }
    }
    if (triangles.length === 0) {
      throw new Error('Translated STEP solid did not produce any fallback triangulation.')
    }
    return triangles
  } finally {
    deleteOccObject(mesher)
    faceMap.delete()
  }
}

function pointFromTriangulationNode(
  point: { Transformed(theT: InstanceType<OpenCascadeInstance['gp_Trsf']>): { X(): number; Y(): number; Z(): number } },
  location: InstanceType<OpenCascadeInstance['TopLoc_Location']>,
): GeometryAssetPoint3 {
  const transformed = point.Transformed(location.Transformation())
  return [
    normalizeOccNumber(transformed.X()),
    normalizeOccNumber(transformed.Y()),
    normalizeOccNumber(transformed.Z()),
  ]
}

function frameFromAx3(axis: { Location(): { X(): number; Y(): number; Z(): number }; Direction(): { X(): number; Y(): number; Z(): number }; XDirection(): { X(): number; Y(): number; Z(): number } }): CadaraBrepSurfaceFrameRecord {
  return {
    origin: pointToGeometryAssetPoint(axis.Location()),
    zDirection: directionToGeometryAssetPoint(axis.Direction()),
    xDirection: directionToGeometryAssetPoint(axis.XDirection()),
  }
}

function pointToGeometryAssetPoint(point: { X(): number; Y(): number; Z(): number }): GeometryAssetPoint3 {
  return [normalizeOccNumber(point.X()), normalizeOccNumber(point.Y()), normalizeOccNumber(point.Z())]
}

function directionToGeometryAssetPoint(direction: { X(): number; Y(): number; Z(): number }): GeometryAssetPoint3 {
  return normalizeVec3([
    normalizeOccNumber(direction.X()),
    normalizeOccNumber(direction.Y()),
    normalizeOccNumber(direction.Z()),
  ])
}

function point2ToGeometryAssetPoint(point: { X(): number; Y(): number }): GeometryAssetPoint2 {
  return [normalizeOccNumber(point.X()), normalizeOccNumber(point.Y())]
}

function direction2ToGeometryAssetPoint(direction: { X(): number; Y(): number }): GeometryAssetPoint2 {
  const length = Math.hypot(direction.X(), direction.Y())
  if (length <= 1e-12) {
    return [1, 0]
  }
  return [
    normalizeOccNumber(direction.X() / length),
    normalizeOccNumber(direction.Y() / length),
  ]
}

function curveParameterRange(first: number, last: number): readonly [number, number] {
  return [normalizeOccNumber(first), normalizeOccNumber(last)]
}

function normalizeOccNumber(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error('Cadara B-rep geometry contains a non-finite number.')
  }
  return Object.is(value, -0) ? 0 : Number(value.toFixed(12))
}

function normalizeVec3(value: GeometryAssetPoint3): GeometryAssetPoint3 {
  const length = Math.hypot(value[0], value[1], value[2])
  if (length <= 1e-12) {
    return [1, 0, 0]
  }
  return [
    normalizeOccNumber(value[0] / length),
    normalizeOccNumber(value[1] / length),
    normalizeOccNumber(value[2] / length),
  ]
}

function isShapeOrientationReversed(
  oc: OpenCascadeInstance,
  shape: { Orientation_1(): unknown },
) {
  return (shape.Orientation_1() as { value?: number }).value
    === (oc.TopAbs_Orientation.TopAbs_REVERSED as { value?: number }).value
}
