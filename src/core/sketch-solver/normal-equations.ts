import { identityMatrix } from "./bfgs";
import { cloneValues, zeroVector } from "./solver-geometry";

export function transpose(matrix: Float64Array[]) {
  const rows = matrix.length;
  const columns = matrix[0]?.length ?? 0;
  const result = Array.from({ length: columns }, () => zeroVector(rows));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      result[column]![row] = matrix[row]![column]!;
    }
  }
  return result;
}

export function multiplyMatrices(left: Float64Array[], right: Float64Array[]) {
  const result = Array.from({ length: left.length }, () =>
    zeroVector(right[0]?.length ?? 0),
  );
  for (let row = 0; row < left.length; row += 1) {
    for (let column = 0; column < (right[0]?.length ?? 0); column += 1) {
      let value = 0;
      for (let inner = 0; inner < right.length; inner += 1) {
        value += left[row]![inner]! * right[inner]![column]!;
      }
      result[row]![column] = value;
    }
  }
  return result;
}

export function addDiagonal(matrix: Float64Array[], value: number) {
  const result = matrix.map((row) => cloneValues(row));
  for (let index = 0; index < result.length; index += 1) {
    result[index]![index] += value;
  }
  return result;
}

export function symmetricPseudoInverse(matrix: Float64Array[], epsilon: number) {
  const size = matrix.length;
  const eigenvectors = identityMatrix(size);
  const diagonalized = matrix.map((row) => cloneValues(row));
  const maxIterations = Math.max(1, size * size * 25);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let maxOffDiagonal = 0;
    let pivotRow = 0;
    let pivotColumn = 0;

    for (let row = 0; row < size; row += 1) {
      for (let column = row + 1; column < size; column += 1) {
        const value = Math.abs(diagonalized[row]![column]!);
        if (value > maxOffDiagonal) {
          maxOffDiagonal = value;
          pivotRow = row;
          pivotColumn = column;
        }
      }
    }

    if (maxOffDiagonal < 1e-12) {
      break;
    }

    const app = diagonalized[pivotRow]![pivotRow]!;
    const aqq = diagonalized[pivotColumn]![pivotColumn]!;
    const apq = diagonalized[pivotRow]![pivotColumn]!;
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    for (let index = 0; index < size; index += 1) {
      if (index === pivotRow || index === pivotColumn) {
        continue;
      }

      const aip = diagonalized[index]![pivotRow]!;
      const aiq = diagonalized[index]![pivotColumn]!;
      const nextAip = cosine * aip - sine * aiq;
      const nextAiq = sine * aip + cosine * aiq;
      diagonalized[index]![pivotRow] = nextAip;
      diagonalized[pivotRow]![index] = nextAip;
      diagonalized[index]![pivotColumn] = nextAiq;
      diagonalized[pivotColumn]![index] = nextAiq;
    }

    diagonalized[pivotRow]![pivotRow] =
      cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
    diagonalized[pivotColumn]![pivotColumn] =
      sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
    diagonalized[pivotRow]![pivotColumn] = 0;
    diagonalized[pivotColumn]![pivotRow] = 0;

    for (let index = 0; index < size; index += 1) {
      const vip = eigenvectors[index]![pivotRow]!;
      const viq = eigenvectors[index]![pivotColumn]!;
      eigenvectors[index]![pivotRow] = cosine * vip - sine * viq;
      eigenvectors[index]![pivotColumn] = sine * vip + cosine * viq;
    }
  }

  const result = Array.from({ length: size }, () => zeroVector(size));
  for (let index = 0; index < size; index += 1) {
    const eigenvalue = diagonalized[index]![index]!;
    if (Math.abs(eigenvalue) <= epsilon) {
      continue;
    }
    const scale = 1 / eigenvalue;
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        result[row]![column] +=
          scale * eigenvectors[row]![index]! * eigenvectors[column]![index]!;
      }
    }
  }

  return result;
}

/**
 * T13e2 (C2): solves A·x = b for a symmetric positive semidefinite A by a
 * Cholesky factorization with diagonal pivoting, P·A·Pᵀ = L·Lᵀ, that stops
 * at pivots ≤ `epsilon`·(largest pivot) (rank-revealing). The variables
 * beyond the numerical rank get 0, so the result is a basic solution of the
 * retained block (not the minimum-norm one the pseudo-inverse gives); for a
 * right-hand side in the range of A it solves A·x = b up to rounding (review
 * B-1: the Schur update keeps the trailing block symmetric, because a later
 * pivot swap reads either triangle). O(n³/3), where the classic Jacobi
 * pseudo-inverse is about O(n⁴).
 */
export function solvePivotedCholesky(
  matrix: Float64Array[],
  rhs: Float64Array,
  epsilon: number,
) {
  const size = rhs.length;
  const factor = matrix.map((row) => cloneValues(row));
  const order = Array.from({ length: size }, (_, index) => index);
  let rank = 0;
  let largestPivot = 0;
  for (let step = 0; step < size; step += 1) {
    let best = step;
    for (let index = step + 1; index < size; index += 1) {
      if (
        factor[order[index]!]![order[index]!]! >
        factor[order[best]!]![order[best]!]!
      )
        best = index;
    }
    [order[step], order[best]] = [order[best]!, order[step]!];
    const pivotIndex = order[step]!;
    const pivot = factor[pivotIndex]![pivotIndex]!;
    if (step === 0) largestPivot = pivot;
    if (!(pivot > 0) || pivot <= epsilon * largestPivot) break;
    const root = Math.sqrt(pivot);
    factor[pivotIndex]![pivotIndex] = root;
    for (let index = step + 1; index < size; index += 1)
      factor[order[index]!]![pivotIndex] =
        factor[order[index]!]![pivotIndex]! / root;
    for (let column = step + 1; column < size; column += 1) {
      const columnIndex = order[column]!;
      const scale = factor[columnIndex]![pivotIndex]!;
      if (scale === 0) continue;
      for (let row = column; row < size; row += 1) {
        const rowIndex = order[row]!;
        const updated =
          factor[rowIndex]![columnIndex]! -
          factor[rowIndex]![pivotIndex]! * scale;
        factor[rowIndex]![columnIndex] = updated;
        factor[columnIndex]![rowIndex] = updated;
      }
    }
    rank += 1;
  }
  const forward = new Float64Array(rank);
  for (let step = 0; step < rank; step += 1) {
    let sum = rhs[order[step]!]!;
    for (let inner = 0; inner < step; inner += 1)
      sum -= factor[order[step]!]![order[inner]!]! * forward[inner]!;
    forward[step] = sum / factor[order[step]!]![order[step]!]!;
  }
  const solution = zeroVector(size);
  for (let step = rank - 1; step >= 0; step -= 1) {
    let sum = forward[step]!;
    for (let inner = step + 1; inner < rank; inner += 1)
      sum -= factor[order[inner]!]![order[step]!]! * solution[order[inner]!]!;
    solution[order[step]!] = sum / factor[order[step]!]![order[step]!]!;
  }
  return solution;
}

/** T13e2 (review B-1): the fallback's linear solve, for a reference check. */
export function solvePivotedCholeskyForTest(
  matrix: readonly (readonly number[])[],
  rhs: readonly number[],
  epsilon: number,
): number[] {
  return Array.from(
    solvePivotedCholesky(
      matrix.map((row) => Float64Array.from(row)),
      Float64Array.from(rhs),
      epsilon,
    ),
  );
}

/** T13e2 (C2): JᵀJ accumulated from each row's nonzeros (the rows are sparse). */
export function sparseNormalMatrix(jacobian: readonly Float64Array[], size: number) {
  const normal = Array.from({ length: size }, () => zeroVector(size));
  for (const row of jacobian) {
    const nonzero: number[] = [];
    for (let index = 0; index < size; index += 1)
      if (row[index] !== 0) nonzero.push(index);
    for (const first of nonzero)
      for (const second of nonzero)
        normal[first]![second] += row[first]! * row[second]!;
  }
  return normal;
}
