import typia from "typia";

import type {
  CadaraBrepCurve2Record,
  CadaraBrepCurve3Record,
  CadaraBrepGeometryAssetData,
  CadaraBrepSurfaceRecord,
  BakedMeshGeometryAssetData,
  GeometryAssetHash,
  CadaraBrepTopologyRecord,
  GeometryAssetManifest,
  GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import { normalizeGeometryAssetManifest } from "@/contracts/modeling/geometry-assets";
import {
  GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION,
  GEOMETRY_ASSET_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import {
  ContractValidationError,
  requireContract,
  validateContract,
  type ContractValidationIssue,
  type ContractValidationResult,
} from "@/contracts/shared/validation";

const geometryAssetRecordValidator =
  typia.createValidateEquals<GeometryAssetRecord>();
const geometryAssetManifestValidator =
  typia.createValidateEquals<GeometryAssetManifest>();
const geometryAssetHashValidator =
  typia.createValidateEquals<GeometryAssetHash>();
const bakedMeshGeometryValidator =
  typia.createValidateEquals<BakedMeshGeometryAssetData>();
const GEOMETRY_ASSET_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function validateGeometryAssetHash(
  value: unknown,
): ContractValidationResult<GeometryAssetHash> {
  const structuralResult = validateContract(geometryAssetHashValidator, value);
  if (!structuralResult.success) {
    return structuralResult;
  }

  const invariantIssues = validateGeometryAssetHashInvariants(
    structuralResult.data,
    "hash",
  );
  return invariantIssues.length === 0
    ? structuralResult
    : {
        success: false,
        data: structuralResult.data,
        issues: invariantIssues,
      };
}

function invariantIssue(
  path: string,
  message: string,
): ContractValidationIssue {
  return { path, expected: "invariant", value: undefined, message };
}

function validateGeometryAssetHashInvariants(
  hash: GeometryAssetHash,
  path: string,
): ContractValidationIssue[] {
  return GEOMETRY_ASSET_HASH_PATTERN.test(hash)
    ? []
    : [
        {
          path,
          expected: "sha256:<64 lowercase hex characters>",
          value: hash,
          message:
            "Geometry asset hash must be a sha256 digest with 64 lowercase hex characters.",
        },
      ];
}

function validateCurve3Invariants(
  curve: CadaraBrepCurve3Record,
  path: string,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];

  if (curve.kind === "bezier" || curve.kind === "bSpline") {
    if (curve.weights && curve.weights.length !== curve.poles.length) {
      issues.push(
        invariantIssue(
          path,
          "Cadara B-rep spline weights must align 1:1 with poles.",
        ),
      );
    }
  }

  if (curve.kind === "bSpline") {
    if (curve.multiplicities.length !== curve.knots.length) {
      issues.push(
        invariantIssue(
          path,
          "Cadara B-rep spline multiplicities must align 1:1 with knots.",
        ),
      );
    }
  }

  return issues;
}

function validateCurve2Invariants(
  curve: CadaraBrepCurve2Record,
  path: string,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];

  if (curve.kind === "bezier" || curve.kind === "bSpline") {
    if (curve.weights && curve.weights.length !== curve.poles.length) {
      issues.push(
        invariantIssue(
          path,
          "Cadara B-rep spline weights must align 1:1 with poles.",
        ),
      );
    }
  }

  if (curve.kind === "bSpline") {
    if (curve.multiplicities.length !== curve.knots.length) {
      issues.push(
        invariantIssue(
          path,
          "Cadara B-rep spline multiplicities must align 1:1 with knots.",
        ),
      );
    }
  }

  return issues;
}

function validateSurfaceInvariants(
  surface: CadaraBrepSurfaceRecord,
  path: string,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];

  if (surface.kind === "bSpline") {
    const expectedPoleCount = surface.uPoleCount * surface.vPoleCount;
    if (surface.poles.length !== expectedPoleCount) {
      issues.push(
        invariantIssue(
          path,
          "Cadara B-rep surface poles must match the declared U/V pole counts.",
        ),
      );
    }
    if (surface.weights && surface.weights.length !== expectedPoleCount) {
      issues.push(
        invariantIssue(
          path,
          "Cadara B-rep surface weights must align 1:1 with poles.",
        ),
      );
    }
    if (surface.uMultiplicities.length !== surface.uKnots.length) {
      issues.push(
        invariantIssue(
          path,
          "Cadara B-rep U multiplicities must align 1:1 with U knots.",
        ),
      );
    }
    if (surface.vMultiplicities.length !== surface.vKnots.length) {
      issues.push(
        invariantIssue(
          path,
          "Cadara B-rep V multiplicities must align 1:1 with V knots.",
        ),
      );
    }
  }

  if (surface.kind === "bezier") {
    const expectedPoleCount = surface.uPoleCount * surface.vPoleCount;
    if (surface.poles.length !== expectedPoleCount) {
      issues.push(
        invariantIssue(
          path,
          "Cadara B-rep surface poles must match the declared U/V pole counts.",
        ),
      );
    }
    if (surface.weights && surface.weights.length !== expectedPoleCount) {
      issues.push(
        invariantIssue(
          path,
          "Cadara B-rep surface weights must align 1:1 with poles.",
        ),
      );
    }
  }

  if (
    surface.kind === "surfaceOfRevolution" ||
    surface.kind === "surfaceOfLinearExtrusion"
  ) {
    issues.push(
      ...validateCurve3Invariants(surface.basisCurve, `${path}.basisCurve`),
    );
  }

  return issues;
}

function validateTopologyInvariants(
  topology: CadaraBrepTopologyRecord,
  path: string,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  const vertexCount = topology.vertices.length;

  for (let i = 0; i < topology.edges.length; i++) {
    const edge = topology.edges[i]!;
    const edgePath = `${path}.edges[${i}]`;

    if (edge.vertices[0] >= vertexCount || edge.vertices[1] >= vertexCount) {
      issues.push(
        invariantIssue(
          edgePath,
          "Cadara B-rep edge references a missing vertex.",
        ),
      );
    }

    issues.push(...validateCurve3Invariants(edge.curve, `${edgePath}.curve`));
  }

  for (let i = 0; i < topology.coedges.length; i++) {
    const coedge = topology.coedges[i]!;
    issues.push(
      ...validateCurve2Invariants(
        coedge.curve2d,
        `${path}.coedges[${i}].curve2d`,
      ),
    );
  }

  for (let i = 0; i < topology.faces.length; i++) {
    const face = topology.faces[i]!;
    issues.push(
      ...validateSurfaceInvariants(face.surface, `${path}.faces[${i}].surface`),
    );
  }

  return issues;
}

function validateCadaraBrepInvariants(
  data: CadaraBrepGeometryAssetData,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];

  for (let i = 0; i < data.bodies.length; i++) {
    const body = data.bodies[i]!;
    issues.push(
      ...validateTopologyInvariants(
        body.topology,
        `data.bodies[${i}].topology`,
      ),
    );
  }

  return issues;
}

function validateBakedMeshGeometryInvariants(
  data: BakedMeshGeometryAssetData,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  for (const [index, point] of data.vertices.entries()) {
    if (point.some((coordinate) => !Number.isFinite(coordinate))) {
      issues.push(
        invariantIssue(
          `vertices[${index}]`,
          "Baked mesh vertices must be finite.",
        ),
      );
    }
  }
  for (const [index, triangle] of data.indices.entries()) {
    if (
      !triangle.every(
        (vertex) =>
          Number.isInteger(vertex) &&
          vertex >= 0 &&
          vertex < data.vertices.length,
      )
    ) {
      issues.push(
        invariantIssue(
          `indices[${index}]`,
          "Baked mesh triangles must reference existing vertices.",
        ),
      );
    }
  }

  if (!data.components) {
    return issues;
  }
  if (data.components.length === 0) {
    issues.push(
      invariantIssue(
        "components",
        "Baked mesh component metadata must declare at least one component.",
      ),
    );
    return issues;
  }

  let expectedStart = 0;
  const componentKeys = new Set<string>();
  for (const [index, component] of data.components.entries()) {
    const path = `components[${index}]`;
    if (!component.sourceComponentKey) {
      issues.push(
        invariantIssue(
          `${path}.sourceComponentKey`,
          "Baked mesh component keys must be non-empty.",
        ),
      );
    } else if (componentKeys.has(component.sourceComponentKey)) {
      issues.push(
        invariantIssue(
          `${path}.sourceComponentKey`,
          "Baked mesh component keys must be unique.",
        ),
      );
    }
    componentKeys.add(component.sourceComponentKey);
    if (
      !Number.isInteger(component.indexStart) ||
      component.indexStart !== expectedStart
    ) {
      issues.push(
        invariantIssue(
          `${path}.indexStart`,
          "Baked mesh component ranges must be contiguous and ordered.",
        ),
      );
    }
    if (!Number.isInteger(component.indexCount) || component.indexCount <= 0) {
      issues.push(
        invariantIssue(
          `${path}.indexCount`,
          "Baked mesh component ranges must contain at least one triangle.",
        ),
      );
    }
    expectedStart = component.indexStart + component.indexCount;
  }
  if (expectedStart !== data.indices.length) {
    issues.push(
      invariantIssue(
        "components",
        "Baked mesh component ranges must cover every triangle exactly once.",
      ),
    );
  }
  return issues;
}

export function validateBakedMeshGeometryAssetData(
  value: unknown,
): ContractValidationResult<BakedMeshGeometryAssetData> {
  const structuralResult = validateContract(bakedMeshGeometryValidator, value);
  if (!structuralResult.success) return structuralResult;
  const issues = validateBakedMeshGeometryInvariants(structuralResult.data);
  return issues.length === 0
    ? structuralResult
    : { success: false, data: structuralResult.data, issues };
}

export function requireBakedMeshGeometryAssetData(
  value: unknown,
): BakedMeshGeometryAssetData {
  const result = validateBakedMeshGeometryAssetData(value);
  if (!result.success) {
    throw new ContractValidationError(
      result.issues[0]?.message ?? "Baked mesh geometry validation failed.",
      value,
      result.issues,
    );
  }
  return result.data;
}

function validateRecordFormatInvariants(
  record: GeometryAssetRecord,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  issues.push(...validateGeometryAssetHashInvariants(record.hash, "hash"));

  if (record.provenance.sourceHash) {
    issues.push(
      ...validateGeometryAssetHashInvariants(
        record.provenance.sourceHash,
        "provenance.sourceHash",
      ),
    );
  }

  if (record.format !== "cadara-brep" && record.format !== "baked-mesh") {
    issues.push(
      invariantIssue(
        "format",
        "Only translated Cadara B-rep geometry and structured baked mesh geometry may be retained in authored documents.",
      ),
    );
    return issues;
  }

  if (record.format === "cadara-brep" && record.data?.kind !== "cadaraBrep") {
    issues.push(
      invariantIssue(
        "data.kind",
        "STEP-imported geometry must be stored as translated Cadara B-rep JSON data.",
      ),
    );
  }

  if (
    record.format === "baked-mesh" &&
    record.data?.kind !== "bakedMeshGeometry"
  ) {
    issues.push(
      invariantIssue(
        "data.kind",
        "Baked mesh geometry must be stored as structured JSON data.",
      ),
    );
  }

  if (record.data?.kind === "cadaraBrep") {
    issues.push(...validateCadaraBrepInvariants(record.data));
  }
  if (record.data?.kind === "bakedMeshGeometry") {
    issues.push(...validateBakedMeshGeometryInvariants(record.data));
  }

  return issues;
}

export function validateGeometryAssetRecord(
  value: unknown,
): ContractValidationResult<GeometryAssetRecord> {
  const structuralResult = validateContract(
    geometryAssetRecordValidator,
    value,
  );

  if (!structuralResult.success) {
    return structuralResult;
  }

  const invariantIssues = validateRecordFormatInvariants(structuralResult.data);

  if (invariantIssues.length > 0) {
    return {
      success: false,
      data: structuralResult.data,
      issues: invariantIssues,
    };
  }

  return structuralResult;
}

export function requireGeometryAssetRecord(
  value: unknown,
): GeometryAssetRecord {
  const result = validateGeometryAssetRecord(value);

  if (!result.success) {
    const firstIssue = result.issues[0];
    throw new ContractValidationError(
      firstIssue?.message ?? "Geometry asset record validation failed.",
      value,
      result.issues,
    );
  }

  if (result.data.schemaVersion !== GEOMETRY_ASSET_SCHEMA_VERSION) {
    throw new Error("Unsupported geometry asset schema version.");
  }

  return result.data;
}

export function validateGeometryAssetManifest(
  value: unknown,
): ContractValidationResult<GeometryAssetManifest> {
  const structuralResult = validateContract(
    geometryAssetManifestValidator,
    value,
  );

  if (!structuralResult.success) {
    return structuralResult;
  }

  for (const record of structuralResult.data.records) {
    const recordResult = validateGeometryAssetRecord(record);
    if (!recordResult.success) {
      return {
        success: false,
        data: structuralResult.data,
        issues: recordResult.issues,
      };
    }
  }

  return {
    success: true,
    data: normalizeGeometryAssetManifest(structuralResult.data),
  };
}

export function requireGeometryAssetManifest(
  value: unknown,
): GeometryAssetManifest {
  const manifest = requireContract(
    geometryAssetManifestValidator,
    value,
    "Geometry asset manifest",
  );

  if (manifest.schemaVersion !== GEOMETRY_ASSET_MANIFEST_SCHEMA_VERSION) {
    throw new Error("Unsupported geometry asset manifest schema version.");
  }

  for (const record of manifest.records) {
    requireGeometryAssetRecord(record);
  }

  return normalizeGeometryAssetManifest(manifest);
}
