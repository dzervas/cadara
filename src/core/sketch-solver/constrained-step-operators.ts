import { dot } from "./solver-geometry";
import { traceConstrainedStepOperations as count } from "./solve-tracing";

type SparseRow = readonly (readonly [number, number])[];

function sparseRows(rows: readonly Float64Array[]): SparseRow[] {
  return rows.map((row) => {
    const entries: [number, number][] = [];
    row.forEach((value, index) => {
      if (value !== 0) entries.push([index, value]);
    });
    return entries;
  });
}

function rowDot(row: SparseRow, vector: Float64Array) {
  let sum = 0;
  for (const [index, value] of row) sum += value * vector[index]!;
  return sum;
}

/** Sparse Cholesky of JJᵀ + δI, with fill retained (never thresholded). */
export function rowSpaceSolver(
  rows: readonly Float64Array[],
  size: number,
  relativeRegularisation: number,
) {
  const sparse = sparseRows(rows);
  const columns: [number, number][][] = Array.from({ length: size }, () => []);
  sparse.forEach((row, index) => {
    for (const [column, value] of row) columns[column]!.push([index, value]);
  });
  const matrix = rows.map(() => new Map<number, number>());
  const below = rows.map(() => new Set<number>());
  const add = (row: number, column: number, value: number) => {
    matrix[row]!.set(column, (matrix[row]!.get(column) ?? 0) + value);
    if (row !== column) below[column]!.add(row);
  };
  let operations = 0;
  for (const column of columns)
    for (let first = 0; first < column.length; first += 1)
      for (let second = 0; second <= first; second += 1) {
        const [row, left] = column[first]!;
        const [other, right] = column[second]!;
        add(row, other, left * right);
        operations += 1;
      }
  count("Normal", operations);
  let largest = 0;
  matrix.forEach((row, index) => {
    largest = Math.max(largest, row.get(index) ?? 0);
  });
  const regularisation = relativeRegularisation * Math.max(largest, 1e-300);
  const diagonal = new Float64Array(rows.length);
  const factors: [number, number][][] = rows.map(() => []);
  operations = 0;
  for (let pivot = 0; pivot < rows.length; pivot += 1) {
    const value = (matrix[pivot]!.get(pivot) ?? 0) + regularisation;
    if (!(value > 0)) {
      count("Factor", operations);
      return null;
    }
    const root = Math.sqrt(value);
    diagonal[pivot] = root;
    // Ascending elimination order keeps the same summation order as dense Cholesky.
    const neighbors = [...below[pivot]!].sort((a, b) => a - b);
    for (const row of neighbors)
      factors[pivot]!.push([row, matrix[row]!.get(pivot)! / root]);
    const entries = factors[pivot]!;
    for (let first = 0; first < entries.length; first += 1) {
      const [row, left] = entries[first]!;
      for (let second = 0; second <= first; second += 1) {
        const [column, right] = entries[second]!;
        add(row, column, -left * right);
        operations += 1;
      }
      matrix[row]!.delete(pivot);
    }
    matrix[pivot]!.clear();
  }
  count("Factor", operations);
  // Absolute triangular solves bound ||L⁻¹||∞ and ||L⁻ᵀ||∞ without
  // materialising the inverse. Their product bounds ||(JJᵀ + δI)⁻¹||∞.
  // This is deliberately conservative: an unsafe projector uses the
  // rank-revealing reference, rather than treating damping as a rank test.
  const forwardBound = new Float64Array(rows.length).fill(1);
  const backwardBound = new Float64Array(rows.length).fill(1);
  let boundWork = 0;
  for (let column = 0; column < rows.length; column += 1) {
    forwardBound[column] /= diagonal[column]!;
    for (const [row, value] of factors[column]!) {
      forwardBound[row] += Math.abs(value) * forwardBound[column]!;
      boundWork += 1;
    }
  }
  for (let column = rows.length - 1; column >= 0; column -= 1) {
    for (const [row, value] of factors[column]!) {
      backwardBound[column] += Math.abs(value) * backwardBound[row]!;
      boundWork += 1;
    }
    backwardBound[column] /= diagonal[column]!;
  }
  let largestForward = 0;
  let largestBackward = 0;
  for (let index = 0; index < rows.length; index += 1) {
    largestForward = Math.max(largestForward, forwardBound[index]!);
    largestBackward = Math.max(largestBackward, backwardBound[index]!);
  }
  count("Factor", boundWork);
  const projectionLeakageBound =
    regularisation * largestForward * largestBackward;
  const solve = (rhs: Float64Array) => {
    const result = Float64Array.from(rhs);
    let work = 0;
    for (let column = 0; column < result.length; column += 1) {
      result[column] /= diagonal[column]!;
      for (const [row, value] of factors[column]!) {
        result[row] -= value * result[column]!;
        work += 1;
      }
    }
    for (let column = result.length - 1; column >= 0; column -= 1) {
      for (const [row, value] of factors[column]!) {
        result[column] -= value * result[row]!;
        work += 1;
      }
      result[column] /= diagonal[column]!;
    }
    count("Factor", work);
    return result;
  };
  const transpose = (multipliers: Float64Array) => {
    const result = new Float64Array(size);
    let work = 0;
    sparse.forEach((row, index) => {
      for (const [column, value] of row) {
        result[column] += value * multipliers[index]!;
        work += 1;
      }
    });
    count("Projection", work);
    return result;
  };
  const times = (vector: Float64Array) => {
    count(
      "Projection",
      sparse.reduce((sum, row) => sum + row.length, 0),
    );
    return Float64Array.from(sparse, (row) => rowDot(row, vector));
  };
  return {
    projectionLeakageBound,
    minimumNorm: (rhs: Float64Array) => transpose(solve(rhs)),
    multipliers: (gradient: Float64Array) =>
      solve(times(gradient)).map((v) => -v),
    project: (vector: Float64Array) => {
      const normal = transpose(solve(times(vector)));
      return vector.map((value, index) => value - normal[index]!);
    },
  };
}

/** Exact SR1 as a sum of rank-one terms; no history truncation or n×n storage. */
export class StepCurvature {
  private terms: { vector: Float64Array; denominator: number }[] = [];

  clear() {
    this.terms = [];
  }

  multiply(vector: Float64Array) {
    const result = new Float64Array(vector.length);
    for (const term of this.terms) {
      const weight = dot(term.vector, vector) / term.denominator;
      for (let index = 0; index < result.length; index += 1)
        result[index] += weight * term.vector[index]!;
    }
    count("Curvature", 2 * this.terms.length * vector.length);
    return result;
  }

  largestDiagonal(base: Float64Array) {
    const result = Float64Array.from(base);
    for (const { vector, denominator } of this.terms)
      for (let index = 0; index < result.length; index += 1)
        result[index] += vector[index]! ** 2 / denominator;
    count("Curvature", this.terms.length * base.length);
    let largest = 0;
    for (const value of result) largest = Math.max(largest, value);
    return largest;
  }

  addTo(matrix: Float64Array[]) {
    for (const { vector, denominator } of this.terms)
      for (let row = 0; row < matrix.length; row += 1)
        for (let column = 0; column < matrix.length; column += 1)
          matrix[row]![column] +=
            (vector[row]! * vector[column]!) / denominator;
    count("Curvature", this.terms.length * matrix.length ** 2);
    return matrix;
  }

  update(residual: Float64Array, denominator: number) {
    this.terms.push({ vector: residual, denominator });
  }
}

export function objectiveOperator(rows: readonly Float64Array[], size: number) {
  const sparse = sparseRows(rows);
  const diagonal = new Float64Array(size);
  for (const row of sparse)
    for (const [index, value] of row) diagonal[index] += value * value;
  count(
    "Normal",
    sparse.reduce((sum, row) => sum + row.length, 0),
  );
  return {
    diagonal,
    multiply: (vector: Float64Array) => {
      const result = new Float64Array(size);
      let work = 0;
      for (const row of sparse) {
        const value = rowDot(row, vector);
        for (const [index, coefficient] of row)
          result[index] += coefficient * value;
        work += 2 * row.length;
      }
      count("Normal", work);
      return result;
    },
  };
}

/** Solve the same regularised PHP system without forming its columns. */
export function operatorTangentStep(
  project: (vector: Float64Array) => Float64Array,
  gradient: Float64Array,
  multiply: (vector: Float64Array) => Float64Array,
  hessianScale: number,
  relativeRegularisation: number,
): Float64Array | null {
  const projectedGradient = project(gradient);
  let rhsScale = 0;
  for (const value of projectedGradient)
    rhsScale = Math.max(rhsScale, Math.abs(value));
  if (rhsScale === 0) return new Float64Array(gradient.length);
  // Normalise both sides before squaring residuals. The stopping test is
  // relative to the system, not an absolute floor in objective units.
  const rhs = projectedGradient.map((value) => -value / rhsScale);
  const solution = new Float64Array(gradient.length);
  const residual = Float64Array.from(rhs);
  let direction = Float64Array.from(residual);
  let norm = dot(residual, residual);
  const tolerance = norm * 1e-22;
  for (
    let iteration = 0;
    norm > tolerance && iteration < gradient.length;
    iteration += 1
  ) {
    const applied = project(multiply(project(direction)));
    for (let index = 0; index < applied.length; index += 1)
      applied[index] =
        applied[index]! / hessianScale +
        relativeRegularisation * direction[index]!;
    const denominator = dot(direction, applied);
    if (!(denominator > 0)) return null;
    const alpha = norm / denominator;
    for (let index = 0; index < solution.length; index += 1) {
      solution[index] += alpha * direction[index]!;
      residual[index] -= alpha * applied[index]!;
    }
    const nextNorm = dot(residual, residual);
    const beta = nextNorm / norm;
    direction = residual.map(
      (value, index) => value + beta * direction[index]!,
    );
    norm = nextNorm;
    count("Projection", 7 * gradient.length);
  }
  return norm <= tolerance
    ? project(solution).map((value) => value * (rhsScale / hessianScale))
    : null;
}
