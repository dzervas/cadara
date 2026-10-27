/**
 * Onshape expression -> cadara expression translation.
 *
 * Onshape authors unit-bearing expression strings (`4 mm`, `30 deg`,
 * `#nail * 2`). cadara's document-variable and feature-value grammar is mathjs
 * over bare identifiers producing unitless numbers in document units
 * (millimeters for length, degrees for angle). This module normalizes the
 * former into the latter.
 *
 * Fallback policy: when an expression cannot be translated (unsupported
 * construct), the value is recovered by parsing the *literal magnitude out of
 * the expression string itself* — never from a captured `BTMParameterQuantity`
 * evaluated value, which the spike showed can be absent/zero. A structured
 * diagnostic always records lost parametricity.
 */
import * as math from "mathjs";

export interface OnshapeExpressionInput {
  /** Raw Onshape expression text (e.g. `"4 mm"`, `"#nail * 2"`, `"30 deg"`). */
  expression?: string | null;
}

export interface ExpressionTranslationDiagnostic {
  code:
    | "onshape-expression-untranslatable"
    | "onshape-expression-missing-literal";
  message: string;
  originalExpression: string | null;
}

export interface ExpressionTranslationResult {
  /** cadara-grammar value text (a bare number or mathjs expression). */
  valueText: string;
  /** True when the source parametricity (variable refs/arithmetic) was preserved. */
  translated: boolean;
  diagnostic?: ExpressionTranslationDiagnostic;
}

const LENGTH_UNIT_TO_MM: Record<string, number> = {
  m: 1000,
  meter: 1000,
  meters: 1000,
  cm: 10,
  centimeter: 10,
  mm: 1,
  millimeter: 1,
  micron: 0.001,
  um: 0.001,
  in: 25.4,
  inch: 25.4,
  inches: 25.4,
  ft: 304.8,
  foot: 304.8,
  feet: 304.8,
  yd: 914.4,
};

const ANGLE_UNIT_TO_DEGREES: Record<string, number> = {
  deg: 1,
  degree: 1,
  degrees: 1,
  rad: 180 / Math.PI,
  radian: 180 / Math.PI,
  radians: 180 / Math.PI,
};

// `<number> <unit>` literal, e.g. "4 mm", "0.5in", "30 deg".
const UNIT_LITERAL = /(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)/g;
// First numeric literal anywhere in the string, with an optional trailing unit.
const ANY_LITERAL = /(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)?/;
const BARE_NUMBER = /^-?\d+(?:\.\d+)?$/;
const CADARA_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Normalize one `<number> <unit>` literal to document units, trying length
 * (-> millimeters) then angle (-> degrees). Returns null for unknown units.
 */
function normalizeUnitLiteral(magnitude: number, unit: string): number | null {
  const lower = unit.toLowerCase();
  const lengthFactor = LENGTH_UNIT_TO_MM[lower];
  if (lengthFactor !== undefined) {
    return magnitude * lengthFactor;
  }
  const angleFactor = ANGLE_UNIT_TO_DEGREES[lower];
  if (angleFactor !== undefined) {
    return magnitude * angleFactor;
  }
  return null;
}

function formatNumber(value: number): string {
  return Number.parseFloat(value.toPrecision(12)).toString();
}

/**
 * Lower a postfix unit on a parenthesized expression to multiplication by its
 * document-unit conversion factor. Scanning from the right handles nested
 * groups without needing to parse Onshape's unit-bearing grammar.
 */
function normalizeGroupedPostfixUnits(text: string): {
  text: string;
  hasUnknownUnit: boolean;
} {
  let normalized = text;

  while (true) {
    const groups: number[] = [];
    let match: { start: number; end: number; close: number; unit: string } | null = null;
    for (let index = 0; index < normalized.length; index += 1) {
      if (normalized[index] === "(") {
        groups.push(index);
      } else if (normalized[index] === ")") {
        const start = groups.pop();
        if (start === undefined) continue;
        const unitMatch = /^\s*([A-Za-z]+)\b/.exec(normalized.slice(index + 1));
        if (unitMatch) {
          match = {
            start,
            close: index,
            end: index + 1 + unitMatch[0].length,
            unit: unitMatch[1]!,
          };
        }
      }
    }

    if (!match) return { text: normalized, hasUnknownUnit: false };
    const factor = normalizeUnitLiteral(1, match.unit);
    if (factor === null) return { text: normalized, hasUnknownUnit: true };
    normalized = `${normalized.slice(0, match.start)}${normalized.slice(match.start, match.close + 1)} * ${formatNumber(factor)}${normalized.slice(match.end)}`;
  }
}

/**
 * Recover a document-unit literal from the expression string. Parses the first
 * numeric magnitude present and converts by its trailing unit when present.
 * Returns null when no numeric literal is present.
 */
function parseFirstLiteral(text: string): number | null {
  const match = ANY_LITERAL.exec(text);
  if (!match) {
    return null;
  }
  const magnitude = Number.parseFloat(match[1]!);
  const unit = match[2];
  if (!unit) {
    return magnitude;
  }
  const normalized = normalizeUnitLiteral(magnitude, unit);
  return normalized ?? magnitude;
}

function literalFallback(
  raw: string,
  reason: string,
): ExpressionTranslationResult {
  const literal = parseFirstLiteral(raw);
  if (literal === null) {
    return {
      valueText: "0",
      translated: false,
      diagnostic: {
        code: "onshape-expression-missing-literal",
        message: `${reason} No numeric literal could be recovered from "${raw}", so 0 was substituted.`,
        originalExpression: raw,
      },
    };
  }
  return {
    valueText: formatNumber(literal),
    translated: false,
    diagnostic: {
      code: "onshape-expression-untranslatable",
      message: `${reason} Recovered the literal value ${formatNumber(literal)} from the expression; the original parametricity was lost.`,
      originalExpression: raw,
    },
  };
}

/**
 * Translate an Onshape expression into cadara expression text. Preserves
 * variable references (`#name` -> `name`) and arithmetic when every unit literal
 * normalizes; otherwise recovers the literal magnitude from the expression
 * string with a diagnostic.
 */
export function translateOnshapeExpression(
  input: OnshapeExpressionInput,
): ExpressionTranslationResult {
  const raw = input.expression?.trim();

  if (!raw) {
    return literalFallback("", "The feature parameter had no expression.");
  }

  // Onshape variable references use a `#name` sigil; cadara references bare
  // identifiers. Rewrite before any other analysis.
  let text = raw.replace(/#([A-Za-z_][A-Za-z0-9_]*)/g, "$1");

  if (BARE_NUMBER.test(text)) {
    return { valueText: text, translated: true };
  }

  // Normalize postfix units on parenthesized expressions and every `<number>
  // <unit>` literal to document units. Unknown units make the expression
  // untranslatable.
  const groupedUnits = normalizeGroupedPostfixUnits(text);
  text = groupedUnits.text;
  let unitFailure = groupedUnits.hasUnknownUnit;
  text = text.replace(UNIT_LITERAL, (match, magnitudeText: string, unit: string) => {
    const normalized = normalizeUnitLiteral(Number.parseFloat(magnitudeText), unit);
    if (normalized === null) {
      unitFailure = true;
      return match;
    }
    return formatNumber(normalized);
  });

  if (unitFailure) {
    return literalFallback(
      raw,
      `The expression "${raw}" used a unit cadara could not normalize.`,
    );
  }

  if (BARE_NUMBER.test(text) || CADARA_IDENTIFIER.test(text)) {
    return { valueText: text, translated: true };
  }

  // Validate remaining arithmetic through mathjs, mirroring cadara's own
  // document-variable policy: only value expressions are supported.
  let node: math.MathNode;
  try {
    node = math.parse(text);
  } catch {
    return literalFallback(
      raw,
      `The expression "${raw}" could not be parsed into cadara's grammar.`,
    );
  }

  const nonValueNode = node.filter(
    (candidate) =>
      math.isAssignmentNode(candidate) ||
      math.isBlockNode(candidate) ||
      math.isFunctionAssignmentNode(candidate),
  )[0];
  if (nonValueNode) {
    return literalFallback(
      raw,
      `The expression "${raw}" used a ${nonValueNode.type}, which cadara's value grammar does not support.`,
    );
  }

  return { valueText: text, translated: true };
}
